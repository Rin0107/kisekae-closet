import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { checkPhoto, MAX_PHOTO_BYTES } from "../../src/worker/photo";
import { runs } from "./fc";

// JPEG を組み立てる: SOI + セグメント + SOS
function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}
function jpeg(...segs: number[][]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...segs.flat(), 0xff, 0xda, 0, 2, 1, 2, 3]);
}
const app0 = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]); // JFIF
const exif = seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0]);

// WebP を組み立てる: RIFF <size> WEBP + チャンク
function chunk(id: string, payload: number[]): number[] {
  const n = payload.length;
  return [...id]
    .map((c) => c.charCodeAt(0))
    .concat([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24], payload, n % 2 ? [0] : []);
}
function webp(...chunks: number[][]): Uint8Array {
  const body = [..."WEBP"].map((c) => c.charCodeAt(0)).concat(chunks.flat());
  const n = body.length;
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    n >>> 24,
    ...body,
  ]);
}
const vp8 = chunk("VP8 ", [1, 2, 3, 4]);

describe("JPEG", () => {
  test("Exif のない JPEG は通る (JFIF・ICC・再起動の印・詰め物があってもよい)", () => {
    expect(checkPhoto(jpeg(app0))).toEqual({ ok: true, type: "image/jpeg" });
    expect(checkPhoto(jpeg(app0, seg(0xe2, [1, 2]), [0xff, 0xd0], [0xff, 0x01], [0xff]))).toEqual({
      ok: true,
      type: "image/jpeg",
    });
  });
  test("Exif・XMP (APP1)・IPTC (APP13) が残っていれば拒む", () => {
    expect(checkPhoto(jpeg(app0, exif))).toEqual({
      ok: false,
      reason: "Exif・XMP (撮った場所など) が残っている",
    });
    expect(checkPhoto(jpeg(seg(0xed, [1])))).toEqual({
      ok: false,
      reason: "IPTC (撮った場所など) が残っている",
    });
  });
  test("つくりが壊れていれば拒む", () => {
    const broken = { ok: false, reason: "JPEG のつくりが壊れている" };
    expect(checkPhoto(new Uint8Array([0xff, 0xd8]))).toEqual(broken); // 本体がない
    expect(checkPhoto(new Uint8Array([0xff, 0xd8, 0x00, 0xda]))).toEqual(broken); // 印でない
    expect(checkPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toEqual(broken); // 長さが読めない
    expect(checkPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xda]))).toEqual(broken); // 長さ < 2
    expect(checkPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x09, 0xff, 0xda]))).toEqual(broken); // はみ出す
    expect(checkPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]))).toEqual(broken); // 本体の前で終わる
  });
  test("長さ 2 の空のセグメントは通る (境界)", () => {
    expect(checkPhoto(jpeg([0xff, 0xe0, 0x00, 0x02]))).toEqual({ ok: true, type: "image/jpeg" });
  });
  test("長さを持つ印 (SOF0 など 0xD0 より小さいもの) は長さだけ飛ばし、RST7 (0xD7) は長さなし", () => {
    const ok = { ok: true, type: "image/jpeg" };
    expect(checkPhoto(jpeg(seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0])))).toEqual(ok);
    expect(checkPhoto(jpeg(seg(0xdb, [0, 1, 2])))).toEqual(ok);
    expect(checkPhoto(jpeg([0xff, 0xd7], [0xff, 0xd0]))).toEqual(ok);
    // 0xD8 は長さを持つ扱い (長さなしにすると次の印の位置がずれる)
    expect(checkPhoto(jpeg([0xff, 0xd8, 0x00, 0x02]))).toEqual(ok);
    expect(checkPhoto(jpeg([0xff, 0xcf, 0x00, 0x02]))).toEqual(ok);
  });
  test("長さが足りない・はみ出すセグメントは、位置がずれて壊れている", () => {
    const broken = { ok: false, reason: "JPEG のつくりが壊れている" };
    expect(checkPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xda]))).toEqual(broken);
    expect(checkPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xda]))).toEqual(broken);
    expect(checkPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x05, 0xff, 0xda]))).toEqual(broken);
  });
  test("先頭が FF でなければ JPEG ではない", () => {
    expect(checkPhoto(new Uint8Array([0x00, 0xd8, 0xff, 0xda]))).toEqual({
      ok: false,
      reason: "WebP か JPEG だけ",
    });
  });
});

describe("WebP", () => {
  test("Exif のない WebP は通る (VP8 でも VP8L でも、奇数の長さの詰め物つきでも)", () => {
    expect(checkPhoto(webp(vp8))).toEqual({ ok: true, type: "image/webp" });
    expect(checkPhoto(webp(chunk("VP8X", [0, 0, 0]), chunk("VP8L", [1])))).toEqual({
      ok: true,
      type: "image/webp",
    });
  });
  test("EXIF・XMP のチャンクがあれば拒む", () => {
    const why = { ok: false, reason: "Exif・XMP (撮った場所など) が残っている" };
    expect(checkPhoto(webp(vp8, chunk("EXIF", [1, 2])))).toEqual(why);
    expect(checkPhoto(webp(chunk("XMP ", [1]), vp8))).toEqual(why);
  });
  test("画像のチャンクがなければ拒む", () => {
    expect(checkPhoto(webp(chunk("VP8X", [0])))).toEqual({ ok: false, reason: "WebP に画像がない" });
    expect(checkPhoto(webp())).toEqual({ ok: false, reason: "WebP に画像がない" });
  });
  test("中身が空のチャンクで終わってもよい (境界)", () => {
    expect(checkPhoto(webp(vp8, chunk("ICCP", [])))).toEqual({ ok: true, type: "image/webp" });
  });
  test("つくりが壊れていれば拒む", () => {
    const broken = { ok: false, reason: "WebP のつくりが壊れている" };
    const ok = webp(vp8);
    const big = new Uint8Array(ok);
    big[4] = (big[4] as number) + 1; // RIFF の長さが合わない
    expect(checkPhoto(big)).toEqual(broken);
    const small = new Uint8Array(ok);
    small[4] = (small[4] as number) - 1;
    expect(checkPhoto(small)).toEqual(broken);
    const over = webp(chunk("VP8 ", [1, 2]));
    over[16] = 9; // チャンクがはみ出す
    expect(checkPhoto(over)).toEqual(broken);
    // チャンクの見出しが途中で終わる
    expect(checkPhoto(webp(vp8, [0x41, 0x42, 0x43]))).toEqual(broken);
    // 見出しの最後の 1 byte (i + 8 > length の境界)
    expect(checkPhoto(webp(vp8, [0x41, 0x42, 0x43, 0x44, 0, 0, 0]))).toEqual(broken);
  });
  test("RIFF の長さの上位の byte も読む", () => {
    const b = webp(vp8);
    b[7] = 1;
    expect(checkPhoto(b)).toEqual({ ok: false, reason: "WebP のつくりが壊れている" });
    const c = webp(vp8);
    c[6] = 1;
    expect(checkPhoto(c)).toEqual({ ok: false, reason: "WebP のつくりが壊れている" });
    const d = webp(vp8);
    d[5] = 1;
    expect(checkPhoto(d)).toEqual({ ok: false, reason: "WebP のつくりが壊れている" });
  });
});

describe("形と大きさ", () => {
  test("WebP・JPEG 以外は拒む", () => {
    const why = { ok: false, reason: "WebP か JPEG だけ" };
    expect(checkPhoto(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual(why); // PNG
    expect(checkPhoto(new Uint8Array([]))).toEqual(why);
    expect(checkPhoto(new Uint8Array([0xff, 0xd9]))).toEqual(why);
    const riff = webp(vp8);
    riff[8] = 0x41; // WEBP でない RIFF
    expect(checkPhoto(riff)).toEqual(why);
    const notRiff = webp(vp8);
    notRiff[0] = 0x41;
    expect(checkPhoto(notRiff)).toEqual(why);
  });
  test("300KB ちょうどは中身を見て、1 byte 超えると拒む", () => {
    // SOI 2 + 本体 7 を除いた残りを、長さ 65535 までの APP2 のセグメントで埋める
    const pad = (n: number) => {
      const segs: number[][] = [];
      for (let left = n - 9; left > 0;) {
        const size = Math.min(left, 65_537);
        const payload = size === left || left - size >= 4 ? size - 4 : size - 8;
        segs.push(seg(0xe2, new Array(payload).fill(0)));
        left -= payload + 4;
      }
      return jpeg(...segs);
    };
    expect(pad(MAX_PHOTO_BYTES).length).toBe(MAX_PHOTO_BYTES);
    expect(checkPhoto(pad(MAX_PHOTO_BYTES))).toEqual({ ok: true, type: "image/jpeg" });
    expect(checkPhoto(pad(MAX_PHOTO_BYTES + 1))).toEqual({
      ok: false,
      reason: "写真が大きすぎる (300KB まで)",
    });
  });
  test("fuzz: どんな byte 列でも落ちず、通すなら JPEG か WebP の印がある", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.uint8Array({ maxLength: 64 }),
          fc.uint8Array({ maxLength: 64 }).map((b) => new Uint8Array([0xff, 0xd8, ...b])),
          fc.uint8Array({ maxLength: 64 }).map((b) => webp([...b])),
        ),
        (b) => {
          const r = checkPhoto(b);
          return !r.ok || (r.type === "image/jpeg" ? b[0] === 0xff : b[0] === 0x52);
        },
      ),
      runs(),
    );
  });
});
