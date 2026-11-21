// 指で直す (#83) の決まり。
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { dress, NO_POSE, type Fit, type Piece, type Pt } from "../../src/fit";
import {
  ADJ_LIMITS,
  below,
  clampAdj,
  clampPose,
  hit,
  limbAngle,
  limbTips,
  moveAdj,
  movePose,
  NO_ADJ,
  nudge,
  NUDGE_NAMES,
  POSE_LIMITS,
  toCm,
  twoFinger,
  type Nudge,
} from "../../src/gesture";
import { runs } from "./fc";

const coord = fc.double({ min: -300, max: 300, noNaN: true });
const pt = fc.tuple(coord, coord);

describe("2 本の指 (#83)", () => {
  test("AC-83-8: 指を入れかえても同じ倍率・角度・ずれ。動かさなければ何も変わらない (PBT)", () => {
    fc.assert(
      fc.property(pt, pt, pt, pt, (a0, b0, a1, b1) => {
        fc.pre(Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) > 1 && Math.hypot(b1[0] - a1[0], b1[1] - a1[1]) > 1);
        const g = twoFinger(a0, b0, a1, b1);
        const h = twoFinger(b0, a0, b1, a1);
        expect(h.scale).toBeCloseTo(g.scale, 9);
        expect(Math.abs(((((h.rot - g.rot) % 360) + 540) % 360) - 180)).toBeLessThan(1e-6);
        expect(h.dx).toBeCloseTo(g.dx, 9);
        expect(h.dy).toBeCloseTo(g.dy, 9);
        expect(g.rot).toBeGreaterThanOrEqual(-180);
        expect(g.rot).toBeLessThanOrEqual(180);
        const still = twoFinger(a0, b0, a0, b0);
        for (const [v, want] of [
          [still.scale, 1],
          [still.rot, 0],
          [still.dx, 0],
          [still.dy, 0],
        ] as const)
          expect(v).toBeCloseTo(want, 9);
      }),
      runs(),
    );
  });

  test("AC-83-2: 広げると大きく、ひねると傾く (例)", () => {
    const g = twoFinger([0, 0], [10, 0], [0, 0], [0, 20]);
    expect(g.scale).toBeCloseTo(2, 9);
    expect(g.rot).toBeCloseTo(90, 9);
    expect(twoFinger([0, 0], [0, 0], [1, 1], [2, 2]).scale).toBe(1);
  });

  test("AC-83-2 AC-83-8: 服の直しは範囲の端で止まる (倍率 0.7〜1.4・角度 ±30°・±50cm)", () => {
    const n = fc.double({ min: -1000, max: 1000, noNaN: true });
    fc.assert(
      fc.property(n, n, fc.double({ min: 0.01, max: 100, noNaN: true }), n, (dx, dy, s, r) => {
        const a = moveAdj(NO_ADJ, { scale: s, rot: r, dx, dy });
        expect(Math.abs(a[0])).toBeLessThanOrEqual(ADJ_LIMITS.move);
        expect(Math.abs(a[1])).toBeLessThanOrEqual(ADJ_LIMITS.move);
        expect(a[2]).toBeGreaterThanOrEqual(ADJ_LIMITS.scale[0]);
        expect(a[2]).toBeLessThanOrEqual(ADJ_LIMITS.scale[1]);
        expect(Math.abs(a[3])).toBeLessThanOrEqual(ADJ_LIMITS.rot);
      }),
      runs(),
    );
    expect(clampAdj([1.234, 0, 1.23456, 4.567])).toEqual([1.23, 0, 1.235, 4.57]);
  });

  test("AC-83-3 AC-83-8: マネキンの直しは範囲の端で止まる (倍率 0.85〜1.15・角度 ±10°・腕と脚 ±90°)", () => {
    const p = movePose(NO_POSE, { scale: 3, rot: 40, dx: 80, dy: -80 });
    expect([p.s, p.r, p.dx, p.dy]).toEqual([POSE_LIMITS.scale[1], POSE_LIMITS.rot, 50, -50]);
    expect(clampPose({ ...NO_POSE, arm: [120, null], leg: [null, -100] })).toMatchObject({
      arm: [90, null],
      leg: [null, -90],
    });
  });

  test("AC-83-7: ボタンで少しずつ (8 つ)", () => {
    expect(Object.keys(NUDGE_NAMES)).toHaveLength(8);
    const moved = (n: Nudge) => moveAdj(NO_ADJ, nudge(n));
    expect(moved("left")[0]).toBeLessThan(0);
    expect(moved("right")[0]).toBeGreaterThan(0);
    expect(moved("up")[1]).toBeLessThan(0);
    expect(moved("down")[1]).toBeGreaterThan(0);
    expect(moved("bigger")[2]).toBeGreaterThan(1);
    expect(moved("smaller")[2]).toBeLessThan(1);
    expect(moved("tiltLeft")[3]).toBeLessThan(0);
    expect(moved("tiltRight")[3]).toBeGreaterThan(0);
  });

  test("台の画素を cm に (左上が (-45, 0)、右下が (45, 180))", () => {
    expect(toCm(0, 0, 200, 400)).toEqual([-45, 0]);
    expect(toCm(200, 400, 200, 400)).toEqual([45, 180]);
  });
});

describe("選ぶ (#83)", () => {
  const top: Piece = {
    id: "t",
    kind: "top",
    w: 10,
    h: 10,
    fit: {
      v: 1,
      p: [
        [0.2, 0.1],
        [0.8, 0.1],
      ],
    } as Fit,
  };
  const bottom: Piece = {
    id: "b",
    kind: "bottom",
    w: 10,
    h: 10,
    fit: {
      v: 1,
      p: [
        [0.1, 0],
        [0.9, 0],
      ],
    },
  };
  const shoes: Piece = {
    id: "s",
    kind: "shoes",
    w: 10,
    h: 10,
    fit: {
      v: 1,
      p: [
        [0, 1],
        [0.4, 1],
        [0.6, 1],
        [1, 1],
      ],
    },
  };

  test("AC-83-2: 上に重なった服から選ぶ。透明なところは通して下の服", () => {
    const d = dress([top, bottom]);
    const t = d.placed.find((p) => p.id === "t") as (typeof d.placed)[number];
    const centerOfTop = (x: number, y: number): Pt => {
      const m = t.m;
      return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    };
    const p = centerOfTop(5, 9);
    expect(hit(d, new Map(), p)).toBe("t");
    // トップスの形の下半分が透明なら、下のボトムス (か、何もなければ null)
    const half = new Uint8Array(100).fill(1).fill(0, 50);
    const under = hit(d, new Map([["t", { w: 10, h: 10, data: half }]]), p);
    expect(under === "b" || under === null).toBe(true);
    expect(hit(d, new Map(), [44, 2])).toBeNull();
  });

  test("くつは左右の半分ごとに当てる", () => {
    const d = dress([shoes]);
    const [l, r] = d.placed as [(typeof d.placed)[number], (typeof d.placed)[number]];
    const on = (pl: typeof l, x: number): Pt => [
      pl.m[0] * x + pl.m[2] * 9 + pl.m[4],
      pl.m[1] * x + pl.m[3] * 9 + pl.m[5],
    ];
    expect(hit(d, new Map(), on(l, 2))).toBe("s");
    expect(hit(d, new Map(), on(r, 8))).toBe("s");
    // 左の片の、右の半分 (写っていないところ) は当たらない
    expect(hit({ ...d, placed: [l] }, new Map(), on(l, 8))).toBeNull();
    expect(hit({ ...d, placed: [r] }, new Map(), on(r, 2))).toBeNull();
  });

  test("AC-83-2: 「うしろの服」は 1 つ下へ、一番下からは一番上へ", () => {
    const d = dress([top, bottom]);
    expect(below(d, "t")).toBe("b");
    expect(below(d, "b")).toBe("t");
    expect(below(dress([]), "t")).toBeNull();
  });

  test("AC-83-3: 手首・足首のつまみを動かした先へ、腕・脚の角度が向く", () => {
    const d = dress([], { pose: { ...NO_POSE, dx: 3, s: 1.1 } });
    const tips = limbTips(d);
    expect(limbAngle(d, "arm", 0, tips.arm[0])).toBeCloseTo(d.arms[0].angle, 1);
    expect(limbAngle(d, "leg", 1, tips.leg[1])).toBeCloseTo(d.legs[1].angle, 1);
    const from = d.arms[1].from;
    const wide = limbAngle(d, "arm", 1, [from[0] + 3 + 30, from[1] * 1.1 + 30]);
    expect(wide).toBeGreaterThan(d.arms[1].angle);
  });
});
