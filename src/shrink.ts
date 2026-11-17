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
  for (const b of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(b);
  return btoa(s);
}
