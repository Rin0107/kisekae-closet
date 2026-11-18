// 服の写真の切り抜き (端末の中だけ。サーバーには元の写真だけがある)。
// 写真の四辺につながった「背景の色」の画素を透明にし、服のところだけに切り詰める。
// 表示するときに 1 回だけ計算し、blob: の URL にしておく (同じ写真は使い回す)。

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 背景とみなす色の差 (RGB の距離の 2 乗の上限)。 */
export const TOLERANCE = 48 * 48 * 3;

/**
 * 服が写真のこの割合より小さくしか残らなければ、背景と服の色が近すぎて服まで消えたとみなし、
 * 背景のばらつきから決めた狭い差 (tight) でやり直す (白い背景の白いシャツ、#27)。
 */
export const MIN_KEEP = 0.15;
/** やり直しの差の下限 (RGB の距離の 2 乗)。むらのない背景でも、これくらいの差は背景とみなす。 */
export const TIGHT_MIN = 8 * 8 * 3;

/** 四辺の画素の平均の色と、ばらつき (各色の分散の和)。 */
function borderStats(px: Uint8ClampedArray, w: number, h: number) {
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const mean = [0, 0, 0];
  const sq = [0, 0, 0];
  for (const i of border)
    for (let c = 0; c < 3; c++) {
      const v = px[i * 4 + c] as number;
      mean[c] = (mean[c] as number) + v;
      sq[c] = (sq[c] as number) + v * v;
    }
  const k = border.length;
  let spread = 0;
  for (let c = 0; c < 3; c++) {
    const m = (mean[c] as number) / k;
    mean[c] = m;
    spread += Math.max(0, (sq[c] as number) / k - m * m);
  }
  return { border, mean: mean as [number, number, number], spread };
}

/** 四辺から、背景の色 (平均) との差が tol 以下の画素をたどった印 (1 が背景) と、背景の画素の数。 */
function flood(px: Uint8ClampedArray, w: number, h: number, st: ReturnType<typeof borderStats>, tol: number) {
  const n = w * h;
  const [r, g, b] = st.mean;
  const near = (i: number) => {
    const dr = (px[i * 4] as number) - r;
    const dg = (px[i * 4 + 1] as number) - g;
    const db = (px[i * 4 + 2] as number) - b;
    return dr * dr + dg * dg + db * db <= tol || (px[i * 4 + 3] as number) === 0;
  };
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const i of st.border)
    if (bg[i] === 0 && near(i)) {
      bg[i] = 1;
      queue[tail++] = i;
    }
  while (head < tail) {
    const i = queue[head++] as number;
    const x = i % w;
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const j of next)
      if (j >= 0 && j < n && bg[j] === 0 && near(j)) {
        bg[j] = 1;
        queue[tail++] = j;
      }
  }
  return { bg, count: tail };
}

/**
 * px (RGBA) の背景を透明にする。背景の色は四辺の画素の平均。四辺から、背景の色に近い画素を塗りつぶしでたどる。
 * 服がほとんど残らなければ (MIN_KEEP)、背景のばらつきの 3 倍 (下限 TIGHT_MIN) までの差でやり直し、服が多く残るほうを使う。
 * 残った (服の) 画素を囲む箱を返す。全部が背景なら null (切り抜かない: px は元のまま)。
 */
export function cutout(px: Uint8ClampedArray, w: number, h: number, tol = TOLERANCE): Box | null {
  const n = w * h;
  const st = borderStats(px, w, h);
  let m = flood(px, w, h, st, tol);
  if (n - m.count < n * MIN_KEEP) {
    const tight = Math.min(tol, Math.max(TIGHT_MIN, 9 * st.spread));
    const e = flood(px, w, h, st, tight);
    if (e.count < m.count) m = e;
  }
  const { bg, count } = m;
  if (count === n) return null;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < n; i++) {
    if (bg[i] === 1) {
      px[i * 4 + 3] = 0;
      continue;
    }
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * 切り抜いたあと、透明になった (背景だった) 画素がこの割合より少なければ、切り抜けなかったとみなす (#47)。
 * 白い背景の白い服などで背景が残ると、写真全体の四角が体にかぶる。撮るときに知らせて撮り直しを選べるようにする。
 */
export const MIN_CLEAR = 0.08;

/** 切り抜いたあとの px (RGBA) で、背景を切り抜けたか (透明な画素が MIN_CLEAR 以上)。 */
export function cutoutWorked(px: Uint8ClampedArray, w: number, h: number): boolean {
  const n = w * h;
  let clear = 0;
  for (let i = 0; i < n; i++) if ((px[i * 4 + 3] as number) === 0) clear++;
  return clear >= n * MIN_CLEAR;
}

/** 切り抜く前に縮める大きさ (長辺)。 */
export const CUT_SIDE = 512;

/** 端末の中の写真 (選んだばかりの写真の下見)。 */
export const isLocal = (src: string) => src.startsWith("blob:") || src.startsWith("data:");

/**
 * 写真を描ける形で読む。blob:・data: は fetch しない: CSP の connect-src に blob: はなく (足さない)、
 * fetch すると CSP 違反になる (#25)。img-src は blob: を許すので <img> で読む。サーバーの写真は同じ origin から fetch する。
 */
async function decode(
  src: string,
): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void } | null> {
  if (isLocal(src)) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => undefined };
  }
  const res = await fetch(src, { credentials: "same-origin" });
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob());
  return { img: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
}

/** 切り抜いた写真の URL と、切り抜けたか (分からないときは true: 知らせない)。 */
interface Cut {
  url: string;
  ok: boolean;
}

async function render(src: string): Promise<Cut> {
  const plain = { url: src, ok: true };
  const d = await decode(src);
  if (d === null) return plain;
  const { img } = d;
  const s = Math.min(1, CUT_SIDE / Math.max(d.w, d.h));
  const w = Math.max(1, Math.round(d.w * s));
  const h = Math.max(1, Math.round(d.h * s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g === null) {
    d.done();
    return plain;
  }
  g.drawImage(img, 0, 0, w, h);
  d.done();
  const data = g.getImageData(0, 0, w, h);
  const box = cutout(data.data, w, h);
  const ok = cutoutWorked(data.data, w, h);
  if (box === null) return { url: src, ok };
  g.putImageData(data, 0, 0);
  const out = document.createElement("canvas");
  out.width = box.w;
  out.height = box.h;
  out.getContext("2d")?.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const blob = await new Promise<Blob | null>((done) => out.toBlob(done, "image/png"));
  return { url: blob === null ? src : URL.createObjectURL(blob), ok };
}

/** 切り抜いた写真を覚えておく数 (最近使ったものから)。追い出したものは blob: を手放す。 */
export const CACHE_SIZE = 60;
const cache = new Map<string, Promise<Cut>>();

function release(src: string, p: Promise<Cut>) {
  void p.then(({ url }) => {
    if (url !== src) URL.revokeObjectURL(url);
  });
}

function cut(src: string): Promise<Cut> {
  if (typeof createImageBitmap !== "function") return Promise.resolve({ url: src, ok: true });
  let p = cache.get(src);
  if (p === undefined) p = render(src).catch(() => ({ url: src, ok: true }));
  cache.delete(src);
  cache.set(src, p); // 最近使ったものを後ろへ
  while (cache.size > CACHE_SIZE) {
    const [old, q] = cache.entries().next().value as [string, Promise<Cut>];
    cache.delete(old);
    release(old, q);
  }
  return p;
}

/** 切り抜いた写真の URL (blob:)。できない端末・失敗は元の URL。 */
export function cutoutUrl(src: string): Promise<string> {
  return cut(src).then((c) => c.url);
}

/** 背景を切り抜けたか (#47)。切り抜けない端末・読めない写真は true (知らせない)。 */
export function cutoutOk(src: string): Promise<boolean> {
  return cut(src).then((c) => c.ok);
}

/** 消した服の切り抜きを手放す。 */
export function forgetCutout(src: string): void {
  const p = cache.get(src);
  if (p === undefined) return;
  cache.delete(src);
  release(src, p);
}
