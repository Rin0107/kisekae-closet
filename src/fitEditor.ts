// 型紙合わせ (#81) の決まり (純粋な関数)。画面は FitEditor.tsx。
// 写真の画素の上で「服か背景か」の印 (mask: 1 が服) をなぞって直し、送る写真を服の箱に切り詰める。
import type { Fit, Pt } from "./fit";

/** なぞる太さ (写真の長辺に対する半径の割合)。細かい道具は作らない (1 種だけ) */
export const BRUSH = 0.035;

/** 円 (中心 x, y・半径 r) の中を val にする。変えた箱 (はみ出しは切る) を返す。 */
export function paint(
  mask: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
  val: 0 | 1,
): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(0, Math.floor(x - r));
  const y0 = Math.max(0, Math.floor(y - r));
  const x1 = Math.min(w - 1, Math.ceil(x + r));
  const y1 = Math.min(h - 1, Math.ceil(y + r));
  // 写真の外をなぞったときは何も変えない
  if (x0 > x1 || y0 > y1) return { x: 0, y: 0, w: 0, h: 0 };
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) mask[yy * w + xx] = val;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 服の画素を囲む箱 (まわりに margin 画素の余白、写真の外には出ない)。服がなければ null。 */
export function maskBox(
  mask: Uint8Array,
  w: number,
  h: number,
  margin = 0,
): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (mask[i] !== 1) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    y1 = y;
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(w - 1, x1 + margin);
  y1 = Math.min(h - 1, y1 + margin);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 写真全体の上の印を、box に切り詰めた写真の上の印に (0〜1 に収め、小数 4 桁)。 */
export function fitInBox(
  fit: Fit,
  w: number,
  h: number,
  box: { x: number; y: number; w: number; h: number },
): Fit {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;
  return { ...fit, p: fit.p.map(([x, y]) => [c((x * w - box.x) / box.w), c((y * h - box.y) / box.h)] as Pt) };
}

/** 背景 (mask が 0) を白にした RGBA (送る写真。表示するときに白を切り抜く)。 */
export function onWhite(px: Uint8ClampedArray, mask: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < mask.length; i++) {
    const on = mask[i] === 1;
    out[i * 4] = on ? (px[i * 4] as number) : 255;
    out[i * 4 + 1] = on ? (px[i * 4 + 1] as number) : 255;
    out[i * 4 + 2] = on ? (px[i * 4 + 2] as number) : 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 印を [0, 1] に収めて動かす (つまみのドラッグ・ボタン)。 */
export function moveTo(p: Pt, dx: number, dy: number): Pt {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;
  return [c(p[0] + dx), c(p[1] + dy)];
}

/**
 * 印の数を変えられる種類 (ワンピースの袖口・ボトムスの裾)。on で 4 点、off で 2 点。
 * 足すときは、推し量った点 (guess) があればそれを、なければ肩・ウエストの少し下に置く。
 */
export const OPTIONAL: Record<string, string> = { dress: "袖口の印を使う", bottom: "裾が 2 つ (ズボン)" };

export function withOptional(fit: Fit, on: boolean, guess: Fit): Fit {
  const two = fit.p.slice(0, 2);
  if (!on) return { ...fit, p: two };
  if (fit.p.length >= 4) return fit;
  const [a, b] = two as [Pt, Pt];
  const extra: Pt[] =
    guess.p.length >= 4 ? guess.p.slice(2, 4) : [moveTo(a, -0.03, 0.4), moveTo(b, 0.03, 0.4)];
  return { ...fit, p: [...two, ...extra] };
}
