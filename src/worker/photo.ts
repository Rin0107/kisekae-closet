// 受け取る写真の検査。守りの部分 (wakuwaku guard で書き換え禁止)。
// - WebP か JPEG だけ。中身の先頭 (マジックバイト) と、つくり (JPEG のセグメント・WebP のチャンク) を確かめる
// - 300KB まで
// - 撮った場所などが入る Exif・XMP・IPTC が残っていれば拒む (端末で再エンコードすれば消える。src/shrink.ts)

export const MAX_PHOTO_BYTES = 307_200; // 300KB

export type PhotoCheck = { ok: true; type: "image/webp" | "image/jpeg" } | { ok: false; reason: string };

const BROKEN_JPEG: PhotoCheck = { ok: false, reason: "JPEG のつくりが壊れている" };
const BROKEN_WEBP: PhotoCheck = { ok: false, reason: "WebP のつくりが壊れている" };
const METADATA: PhotoCheck = { ok: false, reason: "Exif・XMP (撮った場所など) が残っている" };

export function checkPhoto(b: Uint8Array): PhotoCheck {
  if (b.length > MAX_PHOTO_BYTES) return { ok: false, reason: "写真が大きすぎる (300KB まで)" };
  if (b[0] === 0xff && b[1] === 0xd8) return checkJpeg(b);
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return checkWebp(b);
  return { ok: false, reason: "WebP か JPEG だけ" };
}

function ascii(b: Uint8Array, at: number, n: number): string {
  return String.fromCharCode(...b.subarray(at, at + n));
}

/**
 * JPEG のセグメントを、画像の本体 (SOS) まで長さに沿ってたどる。
 * 長さが足りない・はみ出すものは、次の印の位置がずれて 0xFF でなくなるか、終わりに着くので「壊れている」になる。
 */
function checkJpeg(b: Uint8Array): PhotoCheck {
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return BROKEN_JPEG;
    const m = b[i + 1] as number;
    if (m === 0xff) {
      i += 1; // 詰め物の 0xFF
    } else if (m === 0xda) {
      return { ok: true, type: "image/jpeg" }; // 画像の本体の始まり。ここまでに付け足しの情報はない
    } else if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      i += 2; // 長さを持たない印
    } else if (m === 0xe1) {
      return METADATA; // APP1 (Exif・XMP)
    } else if (m === 0xed) {
      return { ok: false, reason: "IPTC (撮った場所など) が残っている" };
    } else {
      i += 2 + (((b[i + 2] as number) << 8) | (b[i + 3] as number));
    }
  }
  return BROKEN_JPEG;
}

function checkWebp(b: Uint8Array): PhotoCheck {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (view.getUint32(4, true) + 8 !== b.length) return BROKEN_WEBP;
  let i = 12;
  let image = false;
  while (i < b.length) {
    if (i + 8 > b.length) return BROKEN_WEBP;
    const id = ascii(b, i, 4);
    const size = view.getUint32(i + 4, true);
    if (i + 8 + size > b.length) return BROKEN_WEBP;
    if (id === "EXIF" || id === "XMP ") return METADATA;
    image = image || id === "VP8 " || id === "VP8L";
    i += 8 + size + (size % 2);
  }
  return image ? { ok: true, type: "image/webp" } : { ok: false, reason: "WebP に画像がない" };
}
