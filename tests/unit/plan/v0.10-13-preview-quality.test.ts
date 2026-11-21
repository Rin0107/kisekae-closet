// 計画 v0.10 の受け入れテスト (wk が sha256 で固定する。変えない)
// 持ち主の #49「写真を撮ったあと型枠に出てくる写真の画質が粗すぎる」。
// 切り抜きを長辺 512px で作っていたので、iPhone (画素が 3 倍) の枠では粗く見える。
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { CUT_SIDE } from "../../../src/cutout";
import { MAX_SIDE } from "../../../src/shrink";

const css = readFileSync("src/style.css", "utf8");
const outside = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** メディアの外の、その選び方ちょうどの決まりの中身。 */
const rule = (sel: string) => new RegExp(`(?:^|\\n)${esc(sel)} \\{([^}]*)\\}`).exec(outside)?.[1] ?? "";

test("AC-1: 切り抜きは送る写真と同じ細かさ (長辺 MAX_SIDE = 1024px) で作る", () => {
  expect(CUT_SIDE).toBeGreaterThanOrEqual(MAX_SIDE);
});

test("AC-2: 撮った写真の下見の枠は、スマホの幅いっぱい近く (最大 320px) の正方形で、写真は縦横比のまま", () => {
  const frame = rule(".frame");
  expect(frame).toMatch(/width: min\(\d+vw, 320px\)/);
  expect(frame).toContain("aspect-ratio: 1");
  expect(frame).not.toMatch(/\bheight: 220px/);
  expect(rule(".frame img")).toContain("object-fit: contain");
});
