// 計画 v0.10 の受け入れテスト (wk が sha256 で固定する。変えない)
// 持ち主の #49「型枠に出てくる写真の色が抜けている」。
// 淡い色の服を白い壁の前で撮ると、背景とみなす色の差 (TOLERANCE) が広すぎて、服の淡いところまで透明になる。
// 背景がむらのない色なら、背景のばらつきから決めた狭い差で切り抜く。
import { expect, test } from "vitest";
import { cutout, cutoutWorked } from "../../../src/cutout";

const W = 100;
const H = 100;
/** 白い壁 (少しむらがある) の前の、淡いピンクのシャツ。胸に濃い柄 (シャツの 3 割)。 */
function paleShirt(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = ((x * 7 + y * 13) % 5) - 2; // ±2 のむら
      let c = [250 + n, 250 + n, 248 + n];
      if (inShirt(x, y)) c = y >= 30 && y < 58 ? [70, 40, 60] : [244, 214, 224];
      px.set([...c, 255], (y * W + x) * 4);
    }
  return px;
}
function inShirt(x: number, y: number): boolean {
  return x >= 20 && x < 80 && y >= 10 && y < 90;
}

test("AC-1: 白い壁の前の淡い色の服は、淡いところも透明にならない (服の画素の 98% 以上が残る)", () => {
  const px = paleShirt();
  const box = cutout(px, W, H);
  let kept = 0;
  let all = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (inShirt(x, y)) {
        all++;
        if (px[(y * W + x) * 4 + 3] === 255) kept++;
      }
  expect(kept / all).toBeGreaterThanOrEqual(0.98);
  expect(box).toEqual({ x: 20, y: 10, w: 60, h: 80 });
});

test("AC-2: 背景 (壁) は全部透明になり、切り抜けたと分かる", () => {
  const px = paleShirt();
  cutout(px, W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (!inShirt(x, y)) expect(px[(y * W + x) * 4 + 3], `${x},${y}`).toBe(0);
  expect(cutoutWorked(px, W, H)).toBe(true);
});

test("AC-3: 背景にむらの大きい写真 (明るさの変わる床など) は、今までどおり広い差で背景を消す", () => {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const g = 170 + Math.round((x / W) * 60); // 左から右へ 170 → 230 と明るさの変わる床
      const c = x >= 30 && x < 70 && y >= 20 && y < 80 ? [20, 30, 120] : [g, g, g];
      px.set([...c, 255], (y * W + x) * 4);
    }
  expect(cutout(px, W, H)).toEqual({ x: 30, y: 20, w: 40, h: 60 });
  expect(px[3]).toBe(0);
  expect(px[(50 * W + 99) * 4 + 3]).toBe(0);
});
