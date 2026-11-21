// 計画 v0.10 の受け入れテスト (wk が sha256 で固定する。変えない)
// 評価 9 の一番の弱点・持ち主の #19:「長袖とアウターの袖が腕より 15〜25° 立った角度で置かれ、手が袖の途中から突き出る。
// 袖の先が台からはみ出して切れる (1280px でアウター左右約 36px)」。
// 袖の先が台の外に出るとき、今は角度を内へ戻していた (腕と違う角度になる)。角度は腕のまま、袖の片を付け根を中心に
// 少し小さくして (縦横同じ割合。写真は曲げない) 台の中に収める。小さくしても収まらないときだけ角度を戻す。
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  ARM_ANGLE,
  EDGE_MARGIN,
  pieces,
  pieceTransform,
  place,
  SCALE_MIN,
  sleeveFit,
  sleevePoints,
  STAGE_RATIO,
  turnPoint,
  type Piece,
  type Sleeve,
} from "../../../src/outfit";

const boxOf = (kind: string, ratio: number) => {
  const b = place(kind, ratio);
  if (b === null) throw new Error(kind);
  return { top: b.top, left: b.left, width: b.width, height: b.width * STAGE_RATIO * ratio };
};
/** 付け根を中心に k 倍してから turn 度回した、袖の先の台の上の位置。 */
const tipAt = (box: ReturnType<typeof boxOf>, s: Sleeve, turn: number, k: number) => {
  const { pivot, tip } = sleevePoints(box, s, turn);
  return turnPoint({ x: pivot.x + (tip.x - pivot.x) * k, y: pivot.y + (tip.y - pivot.y) * k }, pivot, turn);
};

// 真下に垂れた長い袖 (アウターをハンガーにかけた形)
const LONG: Sleeve = { cut: 0.22, top: 0.04, pivot: 0.1, angle: 0, tip: { x: 0.02, y: 0.6 } };
// 斜めに張った半袖
const SHORT: Sleeve = { cut: 0.2, top: 0.05, pivot: 0.15, angle: 20, tip: { x: 0.06, y: 0.38 } };

test("AC-1: 腕の向きまで回すと台の外に出る長い袖は、角度を腕のまま (±0.5°) にし、小さくして台の中に収める", () => {
  const box = boxOf("outer", 1.1);
  expect(tipAt(box, LONG, ARM_ANGLE, 1).x).toBeLessThan(EDGE_MARGIN); // そのままだと外に出る
  const f = sleeveFit(box, LONG);
  expect(Math.abs(LONG.angle + f.turn - ARM_ANGLE)).toBeLessThanOrEqual(0.5);
  expect(f.scale).toBeLessThan(1);
  expect(f.scale).toBeGreaterThanOrEqual(SCALE_MIN);
  expect(tipAt(box, LONG, f.turn, f.scale).x).toBeGreaterThanOrEqual(EDGE_MARGIN);
  expect(SCALE_MIN).toBeGreaterThanOrEqual(0.7); // 小さくしすぎない (腕より細い袖にしない)
});

test("AC-2: 台に収まる袖は、大きさを変えず (scale 1) に腕の向きへ回す。袖がない (測れない) なら回さない", () => {
  const box = boxOf("top", 1);
  const f = sleeveFit(box, SHORT);
  expect(f.scale).toBe(1);
  expect(f.turn).toBeCloseTo(ARM_ANGLE - SHORT.angle, 5);
  expect(sleeveFit(box, null)).toEqual({ turn: 0, scale: 1 });
});

test("AC-3: 小さくしても収まらないほど長い袖だけ、角度を内へ戻す (袖の先は必ず台の中)", () => {
  const box = { top: 10, left: 16, width: 68, height: 70 };
  const huge: Sleeve = { cut: 0.2, top: 0, pivot: 0.05, angle: 0, tip: { x: 0, y: 1.6 } };
  const f = sleeveFit(box, huge);
  expect(f.scale).toBe(SCALE_MIN);
  expect(f.turn).toBeLessThan(ARM_ANGLE);
  expect(tipAt(box, huge, f.turn, f.scale).x).toBeGreaterThanOrEqual(EDGE_MARGIN);
});

test("AC-4: pieces は袖の片に同じ角度と大きさを持たせる (左右対称)。身ごろの片は回さず大きさも変えない", () => {
  const box = boxOf("outer", 1.1);
  const f = sleeveFit(box, LONG);
  for (const open of [false, true]) {
    const ps = pieces(box, LONG, LONG, open);
    const l = ps[0] as Piece;
    const r = ps.at(-1) as Piece;
    expect(l.turn).toBeCloseTo(f.turn, 5);
    expect(r.turn).toBeCloseTo(-f.turn, 5);
    expect(l.scale).toBeCloseTo(f.scale, 5);
    expect(r.scale).toBeCloseTo(f.scale, 5);
    for (const b of ps.slice(1, -1)) {
      expect(b.turn).toBe(0);
      expect(b.scale).toBe(1);
    }
  }
});

test("AC-5: 片の動かし方は rotate と、縦横同じ scale だけ (写真は曲げない)。アバターの台はこの決まりで描く", () => {
  const base = {
    from: 0,
    to: 0.2,
    box: { top: 0, left: 0, width: 10, height: 10 },
    origin: { x: 100, y: 10 },
  };
  expect(pieceTransform({ ...base, turn: 0, scale: 1 })).toBeUndefined();
  expect(pieceTransform({ ...base, turn: 30, scale: 1 })).toBe("rotate(30deg)");
  expect(pieceTransform({ ...base, turn: -30, scale: 0.85 })).toBe("rotate(-30deg) scale(0.85)");
  expect(readFileSync("src/Avatar.tsx", "utf8")).toContain("pieceTransform(");
});
