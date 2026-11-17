import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  average,
  daysBetween,
  recentlyWorn,
  recommend,
  similarDays,
  targetWarmth,
  type Item,
  type PastOutfit,
} from "../../src/recommend";
import { runs } from "./fc";

const w = (tempMax: number, tempMin: number, humidity = 60, precip = 0) => ({
  tempMax,
  tempMin,
  humidity,
  precip,
});
const item = (id: string, kind: string, warmth: number): Item => ({ id, kind, warmth });
const past = (
  id: string,
  wornOn: string,
  itemIds: string[],
  tempMax = 15,
  tempMin = 5,
  humidity = 60,
): PastOutfit => ({
  id,
  wornOn,
  itemIds,
  tempMax,
  tempMin,
  humidity,
  precip: 0,
});

describe("targetWarmth", () => {
  test("境界値 (端とその 1 つ外)", () => {
    const cases: [number, number][] = [
      [30, 2],
      [25, 2],
      [24.9, 3],
      [20, 3],
      [19.9, 5],
      [15, 5],
      [14.9, 7],
      [10, 7],
      [9.9, 9],
      [5, 9],
      [4.9, 11],
      [-10, 11],
    ];
    for (const [t, want] of cases) expect(targetWarmth(t), `${t}℃`).toBe(want);
  });
  test("寒いほど下がらない (PBT。spec/recommend.smt2 と同じ性質)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        (a, b) => (a <= b ? targetWarmth(a) >= targetWarmth(b) : targetWarmth(a) <= targetWarmth(b)),
      ),
      runs(),
    );
  });
});

test("average と daysBetween", () => {
  expect(average(w(20, 10))).toBe(15);
  expect(daysBetween("2026-11-12", "2026-11-15")).toBe(3);
  expect(daysBetween("2026-11-15", "2026-11-12")).toBe(-3);
});

test("recentlyWorn: 今日から 3 日前まで (未来・4 日前は入らない)", () => {
  const p = [
    past("a", "2026-11-15", ["t0"]),
    past("b", "2026-11-12", ["t3"]),
    past("c", "2026-11-11", ["t4"]),
    past("d", "2026-11-16", ["future"]),
  ];
  expect([...recentlyWorn(p, "2026-11-15")].sort()).toEqual(["t0", "t3"]);
  expect([...recentlyWorn(p, "2026-11-15", 4)].sort()).toEqual(["t0", "t3", "t4"]);
});

describe("recommend", () => {
  const closet = [
    item("t1", "top", 1),
    item("t2", "top", 3),
    item("b1", "bottom", 1),
    item("b2", "bottom", 2),
    item("o1", "outer", 4),
    item("d1", "dress", 2),
    item("s1", "shoes", 1),
    item("s2", "shoes", 1),
  ];
  test("暑い日は軽い上下、寒い日は上着まで", () => {
    expect(recommend(closet, [], w(30, 24), "2026-11-15").map((i) => i.id)).toEqual(["t1", "b1", "s1"]);
    expect(recommend(closet, [], w(8, 2), "2026-11-15").map((i) => i.id)).toEqual(["t2", "b2", "o1", "s1"]);
  });
  test("合計が同じなら、最近着ていないものを選ぶ (靴も)", () => {
    const p = [past("x", "2026-11-14", ["t1", "b1", "s1"])];
    expect(recommend(closet, p, w(30, 24), "2026-11-15").map((i) => i.id)).toEqual(["d1", "s2"]);
  });
  test("靴が全部最近なら、最初の靴", () => {
    const p = [past("x", "2026-11-14", ["s1", "s2"])];
    expect(recommend(closet, p, w(30, 24), "2026-11-15").at(-1)?.id).toBe("s1");
  });
  test("ワンピースだけでも組める。靴がなければ靴なし", () => {
    expect(recommend([item("d", "dress", 2)], [], w(25, 21), "2026-11-15").map((i) => i.id)).toEqual(["d"]);
  });
  test("上か下が欠けていて、ワンピースもなければ空", () => {
    expect(recommend([item("t", "top", 1), item("s", "shoes", 1)], [], w(20, 10), "2026-11-15")).toEqual([]);
    expect(recommend([], [], w(20, 10), "2026-11-15")).toEqual([]);
  });
  test("差の重み (10) は、最近着た数より強い", () => {
    const c = [item("t", "top", 1), item("b", "bottom", 1), item("t9", "top", 4)];
    const p = [past("x", "2026-11-15", ["t", "b"])];
    // 目標 2 (30℃): t+b (差 0・最近 2 = 2) と t9+b (差 3 → 30+1) なら t+b
    expect(recommend(c, p, w(30, 30), "2026-11-15").map((i) => i.id)).toEqual(["t", "b"]);
  });
  test("PBT: 選ぶのは手持ちの服だけ、同じ服を 2 回選ばない、上下かワンピースがある", () => {
    const kinds = ["top", "bottom", "outer", "dress", "shoes"];
    fc.assert(
      fc.property(
        fc.array(fc.record({ kind: fc.constantFrom(...kinds), warmth: fc.integer({ min: 1, max: 5 }) }), {
          maxLength: 10,
        }),
        fc.double({ min: -20, max: 40, noNaN: true }),
        (raw, t) => {
          const items = raw.map((r, i) => item(`i${i}`, r.kind, r.warmth));
          const got = recommend(items, [], w(t, t), "2026-11-15");
          const ids = got.map((i) => i.id);
          if (new Set(ids).size !== ids.length || got.some((g) => !items.includes(g))) return false;
          const hasBase =
            got.some((g) => g.kind === "dress") ||
            (got.some((g) => g.kind === "top") && got.some((g) => g.kind === "bottom"));
          return got.length === 0 || hasBase;
        },
      ),
      runs(),
    );
  });
});

describe("similarDays", () => {
  test("平均気温 ±2℃・湿度 ±15% の中で、近い順 (同じなら新しい順)、n 件まで", () => {
    const p = [
      past("far", "2026-01-01", [], 30, 20),
      past("wet", "2026-01-02", [], 15, 5, 80),
      past("edge", "2026-01-03", [], 17, 7, 75), // 平均 12 (差 2)・湿度差 15
      past("same-old", "2026-01-04", [], 15, 5, 60),
      past("same-new", "2026-01-05", [], 15, 5, 60),
      past("near", "2026-01-06", [], 16, 5, 60),
    ];
    expect(similarDays(p, w(15, 5, 60)).map((o) => o.id)).toEqual(["same-new", "same-old", "near"]);
    expect(similarDays(p, w(15, 5, 60), 10).map((o) => o.id)).toEqual([
      "same-new",
      "same-old",
      "near",
      "edge",
    ]);
    expect(similarDays(p, w(15, 5, 60), 1)).toHaveLength(1);
  });
  test("近さは 平均気温の差 + 湿度の差 / 10 (寒い側・湿度の低い側でも同じ)", () => {
    const base = w(15, 5, 60); // 平均 10
    // P: 平均 8.5 (差 1.5)・湿度同じ → 1.5。Q: 平均同じ・湿度 72 (差 12) → 1.2
    const p = [past("P", "2026-01-01", [], 12, 5, 60), past("Q", "2026-01-02", [], 15, 5, 72)];
    expect(similarDays(p, base).map((o) => o.id)).toEqual(["Q", "P"]);
    // A: 平均同じ・湿度 75 (差 15) → 1.5。B: 平均 10.2・湿度 45 (差 15) → 1.7
    const q = [past("B", "2026-01-01", [], 15.4, 5, 45), past("A", "2026-01-02", [], 15, 5, 75)];
    expect(similarDays(q, base).map((o) => o.id)).toEqual(["A", "B"]);
  });
  test("湿度の差は 1/10 で近さに効く", () => {
    const p = [past("h10", "2026-01-01", [], 15, 5, 70), past("t05", "2026-01-02", [], 16, 5, 60)];
    // h10: 0 + 1.0、t05: 0.5 + 0
    expect(similarDays(p, w(15, 5, 60)).map((o) => o.id)).toEqual(["t05", "h10"]);
  });
});
