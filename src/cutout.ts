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

/** 服の上の細い突き出し (ハンガーのフック): 1 行の服の画素がこの割合 × 幅 以下で、真ん中 ± HOOK_SPAN × 幅 の中なら外す。 */
export const HOOK_MAX = 0.1;
export const HOOK_SPAN = 0.15;

/** 写真の画素のこの割合より小さい、服から離れたかけら (ごみ・影の点) は消す。 */
export const MIN_PART = 0.002;

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
 * まず背景のばらつきの 3 倍 (下限 TIGHT_MIN、上限 tol) までの狭い差でたどる (白い壁の前の淡い色の服を消さない)。
 * それで消えた背景が MIN_CLEAR より少なければ (背景にむらがある)、広い差 tol でやり直し、服が MIN_KEEP 以上残るならそちらを使う。
 * 残った (服の) 画素を囲む箱を返す。全部が背景なら null (切り抜かない: px は元のまま)。
 */
export function cutout(px: Uint8ClampedArray, w: number, h: number, tol = TOLERANCE): Box | null {
  const n = w * h;
  const st = borderStats(px, w, h);
  const tight = Math.min(tol, Math.max(TIGHT_MIN, 9 * st.spread));
  let m = flood(px, w, h, st, tight);
  if (m.count < n * MIN_CLEAR) {
    const wide = flood(px, w, h, st, tol);
    if (n - wide.count >= n * MIN_KEEP) m = wide;
  }
  const { bg } = m;
  let count = m.count;
  // 服の上に細く突き出たもの (ハンガーのフック) は外す。上の行から、細くて真ん中にある行だけを背景にし、幅のある行で止める
  for (let y = 0; y < h; y++) {
    let c = 0;
    let lo = w;
    let hi = -1;
    for (let x = 0; x < w; x++)
      if (bg[y * w + x] === 0) {
        c++;
        if (x < lo) lo = x;
        hi = x;
      }
    if (c === 0) continue;
    if (c > w * HOOK_MAX || lo < w * (0.5 - HOOK_SPAN) || hi > w * (0.5 + HOOK_SPAN)) break;
    for (let x = lo; x <= hi; x++) bg[y * w + x] = 1;
    count += c;
  }
  // 服から離れた小さなかけら (背景のごみ・影の点) は消す。服の画素を 4 方向のつながりでかたまりに分け、小さいものを背景にする
  const seen = new Uint8Array(n);
  const part = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (bg[s] === 1 || seen[s] === 1) continue;
    seen[s] = 1;
    part[0] = s;
    let tail = 1;
    for (let head = 0; head < tail; head++) {
      const i = part[head] as number;
      const x = i % w;
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of next)
        if (j >= 0 && j < n && bg[j] === 0 && seen[j] === 0) {
          seen[j] = 1;
          part[tail++] = j;
        }
    }
    if (tail < n * MIN_PART) {
      for (let k = 0; k < tail; k++) bg[part[k] as number] = 1;
      count += tail;
    }
  }
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

/** 切り抜く前に縮める大きさ (長辺)。送る写真と同じ細かさ (iPhone の画素 3 倍の枠でも粗くしない)。 */
export const CUT_SIDE = 1024; // shrink.ts の MAX_SIDE と同じ (import すると、shrink をモックするテストで読めない)

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

/** 印を推し量るために覚えておく、切り抜いた形の大きさの上限 (長辺、px)。 */
export const MASK_SIDE = 96;

/**
 * 切り抜いた写真の URL と、切り抜けたか (分からないときは true: 知らせない)。
 * full は切り抜く前の (縮めた) 写真の大きさ、box はその中の服の箱 (切り詰めた写真の大きさは box.w × box.h)。
 * mask は切り詰めた写真の形 (服の画素が 1) を MASK_SIDE まで縮めたもの。分からなければ null。
 */
export interface Cut {
  url: string;
  ok: boolean;
  full: { w: number; h: number } | null;
  box: Box | null;
  mask: { w: number; h: number; data: Uint8Array } | null;
}

/** 切り詰めた写真 (px は box の外も含む切り抜く前の全体) の形を、長辺 MASK_SIDE まで縮める。 */
export function shrinkMask(
  px: Uint8ClampedArray,
  w: number,
  box: Box,
): { w: number; h: number; data: Uint8Array } {
  const k = Math.min(1, MASK_SIDE / Math.max(box.w, box.h));
  const mw = Math.max(1, Math.round(box.w * k));
  const mh = Math.max(1, Math.round(box.h * k));
  const data = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++) {
      const sx = box.x + Math.min(box.w - 1, Math.floor((x + 0.5) / k));
      const sy = box.y + Math.min(box.h - 1, Math.floor((y + 0.5) / k));
      data[y * mw + x] = (px[(sy * w + sx) * 4 + 3] as number) > 0 ? 1 : 0;
    }
  return { w: mw, h: mh, data };
}

const plainCut = (src: string): Cut => ({ url: src, ok: true, full: null, box: null, mask: null });

async function render(src: string): Promise<Cut> {
  const plain = plainCut(src);
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
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, w, h);
  d.done();
  const data = g.getImageData(0, 0, w, h);
  const box = cutout(data.data, w, h);
  const ok = cutoutWorked(data.data, w, h);
  if (box === null) return { ...plain, ok, full: { w, h } };
  g.putImageData(data, 0, 0);
  const out = document.createElement("canvas");
  out.width = box.w;
  out.height = box.h;
  out.getContext("2d")?.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const blob = await new Promise<Blob | null>((done) => out.toBlob(done, "image/png"));
  if (blob === null) return { ...plain, ok, full: { w, h } };
  return { url: URL.createObjectURL(blob), ok, full: { w, h }, box, mask: shrinkMask(data.data, w, box) };
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
  if (typeof createImageBitmap !== "function") return Promise.resolve(plainCut(src));
  let p = cache.get(src);
  if (p === undefined) p = render(src).catch(() => plainCut(src));
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

/** 切り抜いた写真と、その大きさ・箱・形 (着せる位置を決めるため)。 */
export function cutoutInfo(src: string): Promise<Cut> {
  return cut(src);
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
