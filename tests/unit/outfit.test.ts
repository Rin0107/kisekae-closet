import { describe, expect, test } from "vitest";
import { dressIn, gauge, idealWarmth, SLOTS, takeOff, wear } from "../../src/outfit";

const W = { tempMax: 14, tempMin: 8, humidity: 60, precip: 0 }; // 平均 11℃ → 目標 7
const t1 = { id: "t1", kind: "top", warmth: 2 };
const t2 = { id: "t2", kind: "top", warmth: 3 };
const b1 = { id: "b1", kind: "bottom", warmth: 2 };
const d1 = { id: "d1", kind: "dress", warmth: 3 };
const o1 = { id: "o1", kind: "outer", warmth: 3 };
const s1 = { id: "s1", kind: "shoes", warmth: 5 };

describe("wear", () => {
  test("同じ種類は入れ替わり、重なりの順に並ぶ", () => {
    expect(wear([o1, t1], b1).map((i) => i.id)).toEqual(["b1", "t1", "o1"]);
    expect(wear([t1, b1], t2).map((i) => i.id)).toEqual(["b1", "t2"]);
  });
  test("ワンピースは上下と入れ替わる (逆も)", () => {
    expect(wear([t1, b1, o1], d1).map((i) => i.id)).toEqual(["d1", "o1"]);
    expect(wear([d1, o1], t1).map((i) => i.id)).toEqual(["t1", "o1"]);
  });
  test("知らない種類は最後", () => {
    expect(wear([t1], { id: "x", kind: "hat", warmth: 1 }).map((i) => i.id)).toEqual(["t1", "x"]);
    expect(wear([{ id: "x", kind: "hat", warmth: 1 }], t1).map((i) => i.id)).toEqual(["t1", "x"]);
  });
  test("takeOff と dressIn (ない服は飛ばす)", () => {
    expect(takeOff([t1, b1], "t1")).toEqual([b1]);
    expect(dressIn([t1, b1, o1], ["o1", "gone", "t1"]).map((i) => i.id)).toEqual(["t1", "o1"]);
  });
  test("どの種類にも台の上の場所がある", () => {
    for (const k of ["top", "bottom", "outer", "dress", "shoes", "accessory"]) expect(SLOTS[k]).toBeDefined();
  });
});

describe("gauge", () => {
  test("目標の ±1 はちょうどいい。足りなければ寒い、多すぎれば暑い。くつは数えない", () => {
    expect(idealWarmth(W)).toBe(7);
    expect(idealWarmth({ ...W, precip: 3 })).toBe(8);
    expect(gauge([t1, b1, o1, s1], W)).toEqual({ band: "ok", position: 0.5 });
    expect(gauge([t1, b1], W).band).toBe("cold");
    expect(gauge([t2, b1, o1, { id: "o2", kind: "outer", warmth: 5 }], W).band).toBe("hot");
  });
  test("つまみは 0〜1 に収まり、暖かいほど右", () => {
    const a = gauge([t1], W).position;
    const b = gauge([t1, b1], W).position;
    expect(a).toBeLessThan(b);
    expect(gauge([], W).position).toBe(0);
    expect(
      gauge(
        Array.from({ length: 9 }, (_, i) => ({ id: `${i}`, kind: "top", warmth: 5 })),
        W,
      ).position,
    ).toBe(1);
  });
});
