// 計画 v0.10 の受け入れテスト (wk が sha256 で固定する。変えない。2026-11-21 に持ち主の決定で AC-3 だけ書き直した)
// 持ち主の #50「服を選ぶためには下にスクロールが必要で、スクロールするとアバターが見えない。常にどちらも見えるように。
// 例えばアバターの位置を左寄せにして、空いたところに服選びの UI を置くとか。暖かさバーも 1 画面に収まっているのは良い」。
// スマホの幅 (メディアの外) でも、台 (左) と棚 (右) を 2 列に並べ、棚は台の高さの中で縦に流れる。台は縮めない。
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync("src/style.css", "utf8");
const outside = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** メディアの外の、その選び方ちょうどの決まりの中身。 */
const rule = (sel: string) => new RegExp(`(?:^|\\n)${esc(sel)} \\{([^}]*)\\}`).exec(outside)?.[1] ?? "";

test("AC-1: スマホの幅でも、.dresser は台の幅の列と残りの列の 2 列 (台が左、棚が右)。ゲージと決めるボタンは 2 列にまたがって下", () => {
  const d = rule(".dresser");
  expect(d).toContain("display: grid");
  expect(d).toContain("grid-template-columns: var(--stage-w) minmax(0, 1fr)");
  expect(rule(".dresser-side")).toContain("grid-column: 1 / -1");
});

test("AC-2: 台の大きさは今のまま (幅 200px・高さ 400px)。棚のために縮めない", () => {
  expect(outside).toContain("--stage-w: 200px");
  expect(outside).toContain("--stage-h: 400px");
});

// 2026-11-21 持ち主が今日の画面を案 B (服の列 + 種類のレール) に決めた。AC-3 はその並びに合わせて書き直した
// (元は「服は 2 列・種類のタブは横に流れる」)。台が画面から消えないことは同じ。
test("AC-3: 棚は台と同じ高さで、服の列だけが縦に流れる (台が画面から消えない)。種類は右の縦のレール", () => {
  const closet = rule(".dresser > .closet");
  expect(closet).toContain("height: var(--stage-h)");
  expect(closet).toContain("grid-template-columns: minmax(0, 1fr) var(--rail-w)");
  const rack = rule(".dresser > .closet .rack");
  expect(rack).toContain("flex-direction: column");
  expect(rack).toContain("overflow-y: auto");
  const rail = rule(".dresser > .closet .rail");
  expect(rail).toContain("flex-direction: column");
});
