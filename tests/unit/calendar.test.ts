import { describe, expect, test } from "vitest";
import { likeness, monthGrid, shiftMonth, sky } from "../../src/calendar";

const W = { tempMax: 14, tempMin: 8, humidity: 60, precip: 0 };

describe("monthGrid", () => {
  test("月曜はじまりで、月の外は null。週は 7 マス", () => {
    const g = monthGrid(2026, 11); // 2026-11-01 は日曜
    expect(g[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    expect(g.at(-1)?.[0]).toBe("2026-11-30");
    expect(monthGrid(2026, 6)[0]?.[0]).toBe("2026-06-01"); // 月曜
    expect(monthGrid(2028, 2).flat().filter(Boolean)).toHaveLength(29);
  });
  test("shiftMonth は年をまたぐ", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 5, 0)).toEqual({ year: 2026, month: 5 });
  });
});

describe("likeness と sky", () => {
  test("ほぼ同じ・近い・ちがう", () => {
    expect(likeness(W, { ...W, tempMax: 15, humidity: 65 })).toBe("same");
    expect(likeness(W, { ...W, precip: 5 })).toBe("near");
    expect(likeness(W, { ...W, tempMax: 20, tempMin: 10 })).toBe("near");
    expect(likeness(W, { ...W, tempMax: 25, tempMin: 18 })).toBe("far");
    expect(likeness(W, { ...W, humidity: 90 })).toBe("far");
  });
  test("雨・くもり・晴れ", () => {
    expect(sky({ ...W, precip: 1 })).toBe("rain");
    expect(sky({ ...W, humidity: 80 })).toBe("cloud");
    expect(sky(W)).toBe("sun");
  });
});
