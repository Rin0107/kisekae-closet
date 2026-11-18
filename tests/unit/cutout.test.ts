// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CACHE_SIZE,
  cutout,
  cutoutOk,
  cutoutUrl,
  cutoutWorked,
  forgetCutout,
  MIN_CLEAR,
  isLocal,
  MIN_KEEP,
  TIGHT_MIN,
  TOLERANCE,
} from "../../src/cutout";

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

describe("服をしまう画面の下見 (#25)", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("AC-25-1 AC-25-2: 選んだばかりの写真 (blob:) は fetch せず <img> で読む (connect-src に止められない)", async () => {
    const f = vi.fn(async () => new Response("x"));
    vi.stubGlobal("fetch", f);
    vi.stubGlobal("createImageBitmap", vi.fn());
    const seen: string[] = [];
    class FakeImage {
      naturalWidth = 4;
      naturalHeight = 4;
      set src(v: string) {
        seen.push(v);
      }
      decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Image", FakeImage);
    expect(isLocal("blob:https://x/1")).toBe(true);
    expect(isLocal("data:image/png;base64,AA")).toBe(true);
    expect(isLocal("/api/clothes/a/photo")).toBe(false);
    // happy-dom の canvas は描けないので元の URL に戻るが、fetch は呼ばれない
    expect(await cutoutUrl("blob:https://x/preview-1")).toBe("blob:https://x/preview-1");
    expect(seen).toEqual(["blob:https://x/preview-1"]);
    expect(f).not.toHaveBeenCalled();
    // サーバーの写真は今のまま同じ origin から fetch する
    await cutoutUrl("/api/clothes/z/photo");
    expect(f).toHaveBeenCalledTimes(1);
  });

  test("AC-25-3: CSP の connect-src は変えない (blob: を足さない)", () => {
    const src = readFileSync("src/worker/security.ts", "utf8");
    expect(src).toContain(`"connect-src 'self' https://api.open-meteo.com",`);
    expect(src).not.toMatch(/connect-src[^"]*blob:/);
  });
});

/** 白い背景 (248) の上の白いシャツ (244)。縁に 2 画素の薄い影 (228) がある。T の形。 */
function whiteShirt(w: number, h: number) {
  const px = new Uint8ClampedArray(w * h * 4);
  const inShirt = (x: number, y: number) =>
    (y >= 10 && y < 30 && x >= 10 && x < w - 10) || (y >= 10 && y < h - 8 && x >= 25 && x < w - 25);
  let area = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = inShirt(x, y);
      if (inside) area++;
      const edge =
        inside && (!inShirt(x - 2, y) || !inShirt(x + 2, y) || !inShirt(x, y - 2) || !inShirt(x, y + 2));
      const v = !inside ? 248 : edge ? 228 : 244;
      px.set([v, v, v, 255], (y * w + x) * 4);
    }
  return { px, area };
}

describe("白い服 (#27)", () => {
  test("AC-27-1: 白い背景の上の白いシャツ (縁に薄い影) は、形の 7 割以上が残る", () => {
    const w = 80;
    const h = 100;
    const { px, area } = whiteShirt(w, h);
    const box = cutout(px, w, h);
    expect(box).not.toBeNull();
    let kept = 0;
    for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] === 255) kept++;
    expect(kept).toBeGreaterThanOrEqual(area * 0.7);
    expect(kept).toBeLessThanOrEqual(area * 1.05); // 背景は消えている
    expect(px[3]).toBe(0);
    expect(box).toEqual({ x: 10, y: 10, w: w - 20, h: h - 18 });
    // 影のない生成りのシャツ (#f4f1ea) を真っ白の背景で: 背景にむらがないので、狭い差でやり直して残る
    const plain = image(40, 40, [8, 6, 24, 30], [244, 241, 234, 255], [255, 255, 255, 255]);
    expect(cutout(plain, 40, 40)).toEqual({ x: 8, y: 6, w: 24, h: 30 });
  });

  test("AC-27-2: ふつうの写真 (服が背景とはっきり違う) は、これまでどおりの切り抜き。小さいこものも消さない", () => {
    const px = image(40, 40, [17, 17, 6, 6], [200, 40, 80, 255], [250, 250, 248, 255]);
    expect(cutout(px, 40, 40)).toEqual({ x: 17, y: 17, w: 6, h: 6 });
    expect(MIN_KEEP).toBeGreaterThan(0);
    expect(TIGHT_MIN).toBeLessThan(TOLERANCE);
  });
});

describe("切り抜けなかった写真 (#47)", () => {
  test("AC-47-1: 背景がほとんど残った写真 (白い背景の白い服) は切り抜けなかったと分かり、普通の写真は切り抜けたと分かる", () => {
    // 白い背景に、ほとんど同じ白の服 (背景との差がわずか): 背景を切り抜けず、ほぼ全部が残る
    const white = image(40, 40, [4, 4, 32, 32], [252, 252, 252, 255], [250, 250, 250, 255]);
    cutout(white, 40, 40);
    expect(cutoutWorked(white, 40, 40)).toBe(false);
    // 全部が背景と同じ (服が見つからない) も、切り抜けなかった
    const flat = image(20, 20, [0, 0, 0, 0], [0, 0, 0, 255], [250, 250, 250, 255]);
    expect(cutout(flat, 20, 20)).toBeNull();
    expect(
      cutoutWorked(image(20, 20, [2, 2, 16, 16], [252, 252, 252, 255], [250, 250, 250, 255]), 20, 20),
    ).toBe(false);
    // 色のある服: 背景が透明になり、切り抜けた
    const pink = image(40, 40, [8, 6, 24, 30], [200, 40, 80, 255], [250, 250, 248, 255]);
    cutout(pink, 40, 40);
    expect(cutoutWorked(pink, 40, 40)).toBe(true);
    // 境目: 透明が MIN_CLEAR ちょうどなら切り抜けた
    const n = 100;
    const px = new Uint8ClampedArray(n * 4).fill(255);
    for (let i = 0; i < Math.ceil(n * MIN_CLEAR); i++) px[i * 4 + 3] = 0;
    expect(cutoutWorked(px, 10, 10)).toBe(true);
    px[3] = 255;
    expect(cutoutWorked(px, 10, 10)).toBe(false);
  });

  test("AC-47-1: 切り抜けない端末では知らせない (切り抜けたとみなす)", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(cutoutOk("/api/clothes/x/photo")).resolves.toBe(true);
    vi.unstubAllGlobals();
  });

  test("AC-47-3: 決めたスタンプは台の右上に置く (下に置くと右のくつ・服に重なる)", () => {
    const css = readFileSync("src/style.css", "utf8");
    const stamp = /\n\.stamp \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(stamp).toContain("top: 0;");
    expect(stamp).not.toMatch(/\bbottom:/);
  });
});
