// 計画 v0.10 の受け入れテスト (wk が sha256 で固定する。変えない)
// 評価 9:「ハンガーにかけて撮れと案内するのに、写真のハンガーのフックが切り抜きに残り、アバターの顔・首の上に縦の線として出る」。
// 服の上に細く突き出たもの (フック) は切り抜きから外す。
import { expect, test } from "vitest";
import { cutout } from "../../../src/cutout";

const W = 100;
const H = 100;
function blank(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) px.set([235, 225, 210, 255], i * 4);
  return px;
}
function fill(px: Uint8ClampedArray, x0: number, y0: number, w: number, h: number, c: number[]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px.set([...c, 255], (y * W + x) * 4);
}
const alpha = (px: Uint8ClampedArray, x: number, y: number) => px[(y * W + x) * 4 + 3];

test("AC-1: ハンガーのフック (服の真ん中の上に細く突き出た線) は透明にし、箱は服の肩から始まる", () => {
  const px = blank();
  fill(px, 20, 20, 60, 75, [40, 90, 60]); // 服 (肩は 20 行目)
  fill(px, 49, 4, 3, 16, [60, 60, 70]); // フックの軸 (幅 3px、服の上の端につながる)
  fill(px, 44, 2, 8, 3, [60, 60, 70]); // フックの曲がった先
  expect(cutout(px, W, H)).toEqual({ x: 20, y: 20, w: 60, h: 75 });
  for (let y = 2; y < 20; y++) expect(alpha(px, 50, y), `50,${y}`).toBe(0);
  expect(alpha(px, 45, 3)).toBe(0);
  expect(alpha(px, 50, 20)).toBe(255);
});

test("AC-2: 幅のあるもの (バッグの持ち手) は消さない", () => {
  const px = blank();
  fill(px, 20, 30, 60, 60, [40, 90, 60]); // バッグの本体
  fill(px, 30, 10, 40, 4, [40, 90, 60]); // 持ち手の上 (幅 40)
  fill(px, 30, 10, 4, 20, [40, 90, 60]); // 持ち手の左
  fill(px, 66, 10, 4, 20, [40, 90, 60]); // 持ち手の右
  expect(cutout(px, W, H)).toEqual({ x: 20, y: 10, w: 60, h: 80 });
  expect(alpha(px, 50, 11)).toBe(255);
  expect(alpha(px, 31, 20)).toBe(255);
});
