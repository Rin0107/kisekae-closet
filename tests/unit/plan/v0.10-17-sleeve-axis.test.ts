// 計画 v0.10 の受け入れテスト (wk が sha256 で固定する。変えない)
// 評価 9 の一番の弱点・持ち主の #19:「長袖とアウターの袖がまだ腕と違う角度の板として離れて付く。
// 袖が真下に垂れた長袖でも回すのは 12° ほど」。
// 袖の向きを「付け根から袖の重心へ」で測っていたので、真下に垂れた袖でも 20° 以上外を向いていると測っていた。
// 袖の帯の画素の主軸 (分散の一番大きい向き) で測る。
import { expect, test } from "vitest";
import { ARM_ANGLE, measureSleeve } from "../../../src/outfit";

const W = 200;
const H = 200;
/** 身ごろ (x 60〜139) と、左右の袖。袖は付け根 (48, 12) から、縦から外へ deg 度の向きに、長さ len・幅 16 で垂れる。 */
function shirt(deg: number, len = 120) {
  const r = (deg * Math.PI) / 180;
  const sleeve = (x: number, y: number) => {
    const dx = x - 48;
    const dy = y - 12;
    const along = -dx * Math.sin(r) + dy * Math.cos(r);
    const across = dx * Math.cos(r) + dy * Math.sin(r);
    return x < 56 && along >= 0 && along <= len && Math.abs(across) <= 8;
  };
  return (x: number, y: number) => {
    if (x >= 60 && x < 140 && y >= 6) return true;
    return sleeve(x < 100 ? x : W - 1 - x, y);
  };
}

test("AC-1: 真下に垂れた長袖は、写真の中の袖の向きを 0° (±3°) と測る", () => {
  const s = measureSleeve(shirt(0), W, H);
  expect(s).not.toBeNull();
  expect(Math.abs(s?.angle ?? 99)).toBeLessThanOrEqual(3);
});

test("AC-2: 斜めに垂れた袖 (外へ 10°・20°) は、その角度 (±3°) と測る", () => {
  for (const deg of [10, 20]) {
    const s = measureSleeve(shirt(deg, 100), W, H);
    expect(s, `${deg}`).not.toBeNull();
    expect(Math.abs((s?.angle ?? 99) - deg), `${deg}`).toBeLessThanOrEqual(3);
  }
});

test("AC-3: 左右対称の写真は、右の袖も (左右反転して) 同じ角度と測る。どれも腕 (約 35°) より真っすぐ下", () => {
  const f = shirt(10, 100);
  const left = measureSleeve(f, W, H);
  const right = measureSleeve((x, y) => f(W - 1 - x, y), W, H);
  expect(right?.angle).toBeCloseTo(left?.angle ?? 99, 5);
  expect(left?.angle).toBeLessThan(ARM_ANGLE);
});
