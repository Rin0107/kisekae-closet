// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { CACHE_SIZE, cutout, cutoutUrl, forgetCutout } from "../../src/cutout";

/** w×h の画像。中の (x, y, cw, ch) だけ色 fg、ほかは bg。 */
function image(w: number, h: number, box: [number, number, number, number], fg: number[], bg: number[]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3];
      px.set(inside ? fg : bg, (y * w + x) * 4);
    }
  return px;
}

describe("cutout", () => {
  test("四辺につながった背景を透明にし、服を囲む箱を返す", () => {
    const px = image(10, 8, [3, 2, 4, 5], [200, 40, 80, 255], [250, 250, 248, 255]);
    expect(cutout(px, 10, 8)).toEqual({ x: 3, y: 2, w: 4, h: 5 });
    expect(px[3]).toBe(0); // 角は背景
    expect(px[(3 * 10 + 4) * 4 + 3]).toBe(255); // 服は残る
  });

  test("背景に近い色でも、服に囲まれていれば消さない (つながりでたどる)", () => {
    const px = image(9, 9, [2, 2, 5, 5], [30, 30, 30, 255], [255, 255, 255, 255]);
    px.set([255, 255, 255, 255], (4 * 9 + 4) * 4); // 服の真ん中の白いボタン
    expect(cutout(px, 9, 9)).toEqual({ x: 2, y: 2, w: 5, h: 5 });
    expect(px[(4 * 9 + 4) * 4 + 3]).toBe(255);
  });

  test("全部が背景なら切り抜かない (null、元のまま)", () => {
    const px = image(4, 4, [0, 0, 0, 0], [0, 0, 0, 255], [10, 10, 10, 255]);
    expect(cutout(px, 4, 4)).toBeNull();
    expect(px[3]).toBe(255);
  });

  test("もう透明な画素は背景", () => {
    const px = image(5, 5, [1, 1, 3, 3], [0, 0, 255, 255], [0, 255, 0, 0]);
    px.set([255, 0, 0, 0], 0); // 色はちがうが透明
    expect(cutout(px, 5, 5)).toEqual({ x: 1, y: 1, w: 3, h: 3 });
  });
});

describe("cutoutUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("createImageBitmap のない端末は元の URL", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect(await cutoutUrl("/api/clothes/a/photo")).toBe("/api/clothes/a/photo");
  });

  test("読めない・描けないときは元の URL (同じ URL は使い回す)", async () => {
    const f = vi.fn(async () => new Response("x", { status: 404 }));
    vi.stubGlobal("fetch", f);
    vi.stubGlobal("createImageBitmap", vi.fn());
    expect(await cutoutUrl("/api/clothes/b/photo")).toBe("/api/clothes/b/photo");
    expect(await cutoutUrl("/api/clothes/b/photo")).toBe("/api/clothes/b/photo");
    expect(f).toHaveBeenCalledTimes(1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await cutoutUrl("/api/clothes/c/photo")).toBe("/api/clothes/c/photo");
  });
});

describe("覚えておく数", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("最近使った CACHE_SIZE 件だけ覚え、消した服は忘れる", async () => {
    const f = vi.fn(async () => new Response("x", { status: 404 }));
    vi.stubGlobal("fetch", f);
    vi.stubGlobal("createImageBitmap", vi.fn());
    await cutoutUrl("/p/first");
    for (let i = 0; i < CACHE_SIZE - 1; i++) await cutoutUrl(`/p/${i}`);
    await cutoutUrl("/p/first"); // 使ったので後ろへ
    await cutoutUrl("/p/new"); // いちばん古い /p/0 が追い出される
    expect(f).toHaveBeenCalledTimes(CACHE_SIZE + 1);
    await cutoutUrl("/p/first");
    expect(f).toHaveBeenCalledTimes(CACHE_SIZE + 1);
    await cutoutUrl("/p/0");
    expect(f).toHaveBeenCalledTimes(CACHE_SIZE + 2);
    forgetCutout("/p/first");
    forgetCutout("/p/never");
    await cutoutUrl("/p/first");
    expect(f).toHaveBeenCalledTimes(CACHE_SIZE + 3);
  });
});
