// @vitest-environment happy-dom
// 計画 v0.10 の受け入れテスト (wk が sha256 で固定する。変えない)
// 持ち主の #49「写真を撮ってしまおうとすると、Exif があるとかでいつも保存できない」。
// iPhone の Safari は canvas から WebP を書けず JPEG になり、その JPEG に APP1 (Exif) が付く。
// 端末で送る前に付け足しの情報を落とし、サーバーの検査 (src/worker/photo.ts) を必ず通るようにする。
import { afterEach, expect, test, vi } from "vitest";
import { shrinkPhoto, stripMetadata } from "../../../src/shrink";
import { checkPhoto } from "../../../src/worker/photo";

afterEach(() => vi.unstubAllGlobals());

const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));
const seg = (marker: number, payload: number[]) => [
  0xff,
  marker,
  (payload.length + 2) >> 8,
  (payload.length + 2) & 0xff,
  ...payload,
];
const APP0 = seg(0xe0, [...bytes("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const APP1_EXIF = seg(0xe1, [...bytes("Exif"), 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]);
const APP1_XMP = seg(0xe1, [...bytes("http://ns.adobe.com/xap/1.0/"), 0, ...bytes("<x/>")]);
const APP2_ICC = seg(0xe2, [...bytes("ICC_PROFILE"), 0, 1, 1, 9, 9, 9]);
const APP13 = seg(0xed, [...bytes("Photoshop 3.0"), 0, 1, 2]);
const DQT = seg(0xdb, [0, ...new Array<number>(64).fill(1)]);
const SOS_AND_DATA = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0x56, 0xff, 0xd9];
const jpeg = (...parts: number[][]) => new Uint8Array([0xff, 0xd8, ...parts.flat(), ...SOS_AND_DATA]);

const chunk = (id: string, data: number[]) => {
  const n = data.length;
  return [
    ...bytes(id),
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    n >>> 24,
    ...data,
    ...(n % 2 ? [0] : []),
  ];
};
const riff = (...chunks: number[][]) => {
  const body = [...bytes("WEBP"), ...chunks.flat()];
  const n = body.length;
  return new Uint8Array([...bytes("RIFF"), n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24, ...body]);
};
// VP8X: 拡張の印 (0x08 が EXIF あり、0x04 が XMP あり)
const VP8X = (flags: number) => chunk("VP8X", [flags, 0, 0, 0, 99, 0, 0, 99, 0, 0]);
const VP8 = chunk("VP8 ", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

test("AC-1: Safari の JPEG (APP1 の Exif・XMP、APP13 の IPTC 付き) から付け足しの情報を落とすと、サーバーの検査を通る", () => {
  const raw = jpeg(APP0, APP1_EXIF, APP1_XMP, APP13, APP2_ICC, DQT);
  expect(checkPhoto(raw).ok).toBe(false);
  const out = stripMetadata(raw);
  expect(checkPhoto(out)).toEqual({ ok: true, type: "image/jpeg" });
  // 画像の本体 (SOS から後) は 1 byte も変えない。APP0 と色の情報 (APP2 の ICC) と量子化の表は残す (色が抜けない)
  expect([...out.slice(out.length - SOS_AND_DATA.length)]).toEqual(SOS_AND_DATA);
  expect([...out]).toEqual([0xff, 0xd8, ...APP0, ...APP2_ICC, ...DQT, ...SOS_AND_DATA]);
});

test("AC-2: WebP の EXIF・XMP のチャンクを落とし、VP8X の印と RIFF の長さを直すと、サーバーの検査を通る", () => {
  const raw = riff(VP8X(0x08 | 0x04 | 0x10), VP8, chunk("EXIF", [1, 2, 3]), chunk("XMP ", [4, 5, 6, 7]));
  expect(checkPhoto(raw).ok).toBe(false);
  const out = stripMetadata(raw);
  expect(checkPhoto(out)).toEqual({ ok: true, type: "image/webp" });
  expect(out[20]).toBe(0x10); // EXIF・XMP の印だけを消す (ほかの印 0x10 = alpha は残す)
  expect([...out]).toEqual([...riff(VP8X(0x10), VP8)]);
});

test("AC-3: 付け足しの情報のない写真は、そのまま (同じ中身) 返す。JPEG でも WebP でもないものも変えない", () => {
  const clean = jpeg(APP0, DQT);
  expect([...stripMetadata(clean)]).toEqual([...clean]);
  const webp = riff(VP8);
  expect([...stripMetadata(webp)]).toEqual([...webp]);
  const other = new Uint8Array([1, 2, 3, 4]);
  expect([...stripMetadata(other)]).toEqual([1, 2, 3, 4]);
});

test("AC-4: shrinkPhoto は、canvas が Exif 付きの JPEG を返す端末 (iPhone の Safari) でも、サーバーの検査を通る写真を返す", async () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 800, height: 600, close: vi.fn() }));
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    // Safari: WebP を頼んでも PNG が返り、JPEG には APP1 (Exif) が付く
    toBlob: (cb: (b: Blob | null) => void, type: string) =>
      cb(
        type === "image/webp"
          ? new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" })
          : new Blob([jpeg(APP0, APP1_EXIF, DQT)], { type: "image/jpeg" }),
      ),
  };
  const create = vi.spyOn(document, "createElement").mockReturnValue(canvas as never);
  const b64 = await shrinkPhoto(new Blob(["x"]));
  create.mockRestore();
  expect(b64).not.toBeNull();
  const sent = Uint8Array.from(atob(b64 ?? ""), (c) => c.charCodeAt(0));
  expect(checkPhoto(sent)).toEqual({ ok: true, type: "image/jpeg" });
});
