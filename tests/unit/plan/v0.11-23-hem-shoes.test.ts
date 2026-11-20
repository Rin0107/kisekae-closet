// 計画 v0.11 の受け入れテスト (wk が sha256 で固定する。変えない)
// 評価10: 「長いパンツの裾が台の下の端まで伸び、くつがすねの上に乗って見える (裾がくつより下に出る)」。
// 縦長の写真 (縦 ÷ 横が 2 を超える長ズボン) は、腰を覆う幅 (BOTTOM_MIN_WIDTH) より細くできないので、丈が足の裏より下まで伸びる。
// 写真は曲げず、足の裏より下に出る分を下から隠す (Box.clip: 写真の高さのうち下から隠す割合 0〜1)。見える裾は HEM_MAX まで。
import { expect, test } from "vitest";
import * as outfit from "../../../src/outfit";
import { BODY, BOTTOM_MIN_WIDTH, place, STAGE_RATIO } from "../../../src/outfit";

const HEM_MAX = (outfit as unknown as Record<string, number>).HEM_MAX ?? Number.NaN;

test("AC-1: 見える裾の下限 HEM_MAX は、足の裏より 1% 上 (くつの中に隠れる)", () => {
  expect(HEM_MAX).toBe(BODY.sole - 1);
});

test("AC-2: どの縦横比のボトムスも、見える裾は HEM_MAX より下に出ない。幅は腰を覆うまま", () => {
  for (let ratio = 0.5; ratio <= 4.001; ratio += 0.1) {
    const b = place("bottom", ratio) as (outfit.Box & { clip?: number }) | null;
    if (b === null) throw new Error("bottom");
    expect(b.width).toBeGreaterThanOrEqual(BOTTOM_MIN_WIDTH);
    const clip = b.clip ?? 0;
    expect(clip, `縦横比 ${ratio.toFixed(1)}`).toBeGreaterThanOrEqual(0);
    expect(clip, `縦横比 ${ratio.toFixed(1)}`).toBeLessThan(1);
    const hem = b.top + b.width * STAGE_RATIO * ratio * (1 - clip);
    expect(hem, `縦横比 ${ratio.toFixed(1)}`).toBeLessThanOrEqual(HEM_MAX + 0.01);
  }
});

test("AC-3: 足首までで収まる写真は隠さない (clip は 0 か無い)", () => {
  for (const ratio of [1, 1.5, 2]) {
    const b = place("bottom", ratio) as (outfit.Box & { clip?: number }) | null;
    expect(b?.clip ?? 0, `縦横比 ${ratio}`).toBe(0);
  }
});

test("AC-4: 隠す分は、長い写真ほど大きい (縦横比 3 は 2.5 より多く隠す)", () => {
  const c = (r: number) => (place("bottom", r) as { clip?: number }).clip ?? 0;
  expect(c(2.5)).toBeGreaterThan(0);
  expect(c(3)).toBeGreaterThan(c(2.5));
});
