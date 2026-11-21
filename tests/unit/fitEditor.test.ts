// 型紙合わせの決まり (#81)。
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { cutout, MIN_HOLE, WHITE } from "../../src/cutout";
import type { Fit } from "../../src/fit";
import {
  BRUSH,
  fitInBox,
  maskBox,
  moveTo,
  onWhite,
  OPTIONAL,
  paint,
  withOptional,
} from "../../src/fitEditor";
import { runs } from "./fc";

describe("なぞって直す (#81)", () => {
  test("AC-81-2: 円の中だけを消す・戻す。変えた箱は写真の中に収まる (PBT)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        fc.double({ min: -10, max: 40, noNaN: true }),
        fc.double({ min: -10, max: 40, noNaN: true }),
        fc.double({ min: 0.5, max: 8, noNaN: true }),
        fc.constantFrom<0 | 1>(0, 1),
        (w, h, x, y, r, val) => {
          const m = new Uint8Array(w * h).fill(val === 1 ? 0 : 1);
          const box = paint(m, w, h, x, y, r, val);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w).toBeLessThanOrEqual(w);
          expect(box.y + box.h).toBeLessThanOrEqual(h);
          for (let yy = 0; yy < h; yy++)
            for (let xx = 0; xx < w; xx++) {
              const inside = (xx - x) ** 2 + (yy - y) ** 2 <= r * r;
              expect(m[yy * w + xx]).toBe(inside ? val : 1 - val);
            }
        },
      ),
      runs(),
    );
    expect(BRUSH).toBeGreaterThan(0);
  });

  test("AC-81-4: 服の箱 (余白つき、写真の外に出ない)。服がなければ null", () => {
    const m = new Uint8Array(25);
    expect(maskBox(m, 5, 5)).toBeNull();
    m[1 * 5 + 2] = 1;
    m[3 * 5 + 3] = 1;
    expect(maskBox(m, 5, 5)).toEqual({ x: 2, y: 1, w: 2, h: 3 });
    expect(maskBox(m, 5, 5, 2)).toEqual({ x: 0, y: 0, w: 5, h: 5 });
  });

  test("AC-81-4: 写真全体の上の印を、切り詰めた写真の上の印に (0〜1 に収める)", () => {
    const fit: Fit = {
      v: 1,
      p: [
        [0.5, 0.5],
        [0, 1],
      ],
      at: "hand",
    };
    expect(fitInBox(fit, 100, 200, { x: 25, y: 50, w: 50, h: 100 })).toEqual({
      v: 1,
      at: "hand",
      p: [
        [0.5, 0.5],
        [0, 1],
      ],
    });
  });

  test("AC-81-4: 送る写真は背景を白に (服はそのまま、透けない)", () => {
    const px = new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 255]);
    expect([...onWhite(px, new Uint8Array([0, 1]))]).toEqual([255, 255, 255, 255, 40, 50, 60, 255]);
  });

  test("印は写真の中で動く (0〜1、小数 4 桁)", () => {
    expect(moveTo([0.995, 0.2], 0.01, -0.3)).toEqual([1, 0]);
    expect(moveTo([0.12345, 0.5], 0, 0)).toEqual([0.1235, 0.5]);
  });

  test("AC-81-3: ワンピースの袖口・ボトムスの裾の印は付けたり外したりできる", () => {
    expect(Object.keys(OPTIONAL).sort()).toEqual(["bottom", "dress"]);
    const two: Fit = {
      v: 1,
      p: [
        [0.2, 0.1],
        [0.8, 0.1],
      ],
    };
    const guess: Fit = {
      v: 1,
      p: [
        [0, 0],
        [1, 0],
        [0.1, 0.9],
        [0.9, 0.9],
      ],
    };
    expect(withOptional(two, true, guess).p).toEqual([
      [0.2, 0.1],
      [0.8, 0.1],
      [0.1, 0.9],
      [0.9, 0.9],
    ]);
    expect(withOptional(two, true, two).p).toEqual([
      [0.2, 0.1],
      [0.8, 0.1],
      [0.17, 0.5],
      [0.83, 0.5],
    ]);
    const four = withOptional(two, true, guess);
    expect(withOptional(four, true, guess)).toBe(four);
    expect(withOptional(four, false, guess).p).toEqual(two.p);
  });
});

describe("白い地の写真の切り抜き (#81)", () => {
  /** 白い地に、真ん中に白い穴 (s×s) のある色の四角 */
  function holed(n: number, s: number): Uint8ClampedArray {
    const px = new Uint8ClampedArray(n * n * 4).fill(255);
    for (let y = 2; y < n - 2; y++)
      for (let x = 2; x < n - 2; x++) {
        const hole = Math.abs(x - n / 2) < s / 2 && Math.abs(y - n / 2) < s / 2;
        if (!hole) px.set([90, 40, 40, 255], (y * n + x) * 4);
      }
    return px;
  }

  test("AC-81-4: 服に囲まれた大きな白 (腕と胴のすき間) も背景にする。小さな白 (ボタン) は服のまま", () => {
    const big = holed(40, 10);
    cutout(big, 40, 40);
    expect(big[(20 * 40 + 20) * 4 + 3]).toBe(0);
    const small = holed(40, 2);
    cutout(small, 40, 40);
    expect(small[(20 * 40 + 20) * 4 + 3]).toBe(255);
    expect(WHITE).toBeGreaterThan(240);
    expect(MIN_HOLE).toBeLessThan(0.01);
  });

  test("白くない地なら、囲まれた白は服のまま (今までどおり)", () => {
    const px = holed(40, 10);
    for (let i = 0; i < 40 * 40; i++)
      if (px[i * 4] === 255 && (i % 40 < 2 || i % 40 >= 38 || i < 80 || i >= 40 * 38))
        px.set([200, 230, 200, 255], i * 4);
    cutout(px, 40, 40);
    expect(px[(20 * 40 + 20) * 4 + 3]).toBe(255);
  });
});
