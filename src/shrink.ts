// 服の写真を端末で縮める。canvas で描き直すので、撮った場所などの情報 (Exif・XMP) は落ちる。
// 長辺 1024px、WebP (書けない端末は JPEG)。300KB に収まるまで画質を下げる (サーバーも 300KB で止める)。
export const MAX_SIDE = 1024;
export const MAX_BYTES = 300 * 1024;
export const QUALITIES = [0.85, 0.7, 0.55, 0.4] as const;

/** 縮めたあとの大きさ (長辺を MAX_SIDE まで。小さいものは大きくしない)。 */
export function fitSize(w: number, h: number): { w: number; h: number } {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

export type Encode = (type: string, quality: number) => Promise<Blob | null>;

/** 画質を下げながら、MAX_BYTES に収まる WebP (だめなら JPEG) を探す。収まらなければ null。 */
export async function encodeSmall(encode: Encode): Promise<Blob | null> {
  for (const q of QUALITIES) {
    const webp = await encode("image/webp", q);
    const b = webp !== null && webp.type === "image/webp" ? webp : await encode("image/jpeg", q);
    if (b !== null && b.size <= MAX_BYTES) return b;
  }
  return null;
}

/** ファイルを読み、縮めて base64 にする。 */
export async function shrinkPhoto(file: Blob): Promise<string | null> {
  const img = await createImageBitmap(file);
  const { w, h } = fitSize(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
  img.close();
  const blob = await encodeSmall((type, q) => new Promise((ok) => canvas.toBlob(ok, type, q)));
  if (blob === null) return null;
  let s = "";
  for (const b of stripMetadata(new Uint8Array(await blob.arrayBuffer()))) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * 送る前に、付け足しの情報 (Exif・XMP・IPTC) を落とす。
 * iPhone の Safari は canvas から WebP を書けず、書いた JPEG にも APP1 (Exif) が付くため。
 * JPEG でも WebP でもないもの・つくりが壊れて読めないものは、元の b をそのまま返す。
 */
export function stripMetadata(b: Uint8Array): Uint8Array {
  if (b[0] === 0xff && b[1] === 0xd8) return stripJpeg(b);
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return stripWebp(b);
  return b;
}

function ascii(b: Uint8Array, at: number, n: number): string {
  return String.fromCharCode(...b.subarray(at, at + n));
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return b;
    const m = b[i + 1] as number;
    if (m === 0xff) {
      parts.push(b.subarray(i, i + 1)); // 詰め物の 0xFF
      i += 1;
    } else if (m === 0xda) {
      parts.push(b.subarray(i)); // 画像の本体。1 byte も変えない
      return concat(parts);
    } else if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
    } else {
      if (i + 3 >= b.length) return b;
      const end = i + 2 + (((b[i + 2] as number) << 8) | (b[i + 3] as number));
      if (end > b.length || end < i + 4) return b;
      if (m !== 0xe1 && m !== 0xed) parts.push(b.subarray(i, end));
      i = end;
    }
  }
  return b;
}

function stripWebp(b: Uint8Array): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts: Uint8Array[] = [b.slice(0, 12)];
  let i = 12;
  while (i < b.length) {
    if (i + 8 > b.length) return b;
    const id = ascii(b, i, 4);
    const size = view.getUint32(i + 4, true);
    if (i + 8 + size > b.length) return b;
    const end = i + 8 + size + (size % 2);
    if (id !== "EXIF" && id !== "XMP ") {
      const c = b.slice(i, Math.min(end, b.length));
      if (id === "VP8X" && size >= 1) c[8] = (c[8] as number) & ~0x0c;
      parts.push(c);
    }
    i = end;
  }
  const out = concat(parts);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
