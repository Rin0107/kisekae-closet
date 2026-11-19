// 計画 v0.10 の受け入れテスト (wk が sha256 で固定する。変えない)
// 持ち主の #49「写真の画質が粗い」。背景のごみ・小さな影のかけら (服から離れた小さな点) が残ると、
// 切り抜きの箱が写真いっぱいに広がり、服が小さく・ざらついて見える。服から離れた小さなかけらは消す。
import { expect, test } from "vitest";
import { cutout } from "../../../src/cutout";

const W = 100;
const H = 100;
function blank(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) px.set([240, 240, 236, 255], i * 4);
  return px;
}
function fill(px: Uint8ClampedArray, x0: number, y0: number, w: number, h: number, c: number[]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px.set([...c, 255], (y * W + x) * 4);
}

test("AC-1: 服から離れた小さなかけらは透明にし、箱は服だけを囲む", () => {
  const px = blank();
  fill(px, 30, 25, 40, 50, [30, 60, 140]); // 服
  // 服から離れた小さなかけら (ごみ・影): 2×2 が 4 つ、3×1 が 1 つ
  fill(px, 3, 3, 2, 2, [40, 40, 40]);
  fill(px, 94, 6, 2, 2, [40, 40, 40]);
  fill(px, 5, 92, 2, 2, [90, 70, 60]);
  fill(px, 92, 93, 2, 2, [40, 40, 40]);
  fill(px, 10, 50, 3, 1, [40, 40, 40]);
  expect(cutout(px, W, H)).toEqual({ x: 30, y: 25, w: 40, h: 50 });
  for (const [x, y] of [
    [3, 3],
    [95, 7],
    [5, 92],
    [93, 94],
    [11, 50],
  ] as const)
    expect(px[(y * W + x) * 4 + 3], `${x},${y}`).toBe(0);
  expect(px[(50 * W + 50) * 4 + 3]).toBe(255);
});

test("AC-2: 服の大きなかたまりが 2 つ (くつの左右・身ごろから離れた袖) なら、どちらも残す", () => {
  const px = blank();
  fill(px, 10, 60, 30, 20, [20, 20, 20]);
  fill(px, 60, 60, 30, 20, [20, 20, 20]);
  expect(cutout(px, W, H)).toEqual({ x: 10, y: 60, w: 80, h: 20 });
});
