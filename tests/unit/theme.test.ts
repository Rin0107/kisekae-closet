// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  applyTheme,
  contrast,
  DEFAULT_THEME,
  luminance,
  TEXT_PAIRS,
  THEME_TOKENS,
  themeById,
  ThemeId,
  THEMES,
} from "../../src/theme";

test("AC-8-3: 4 つのテーマすべてで、本文の字と地のコントラストが 4.5:1 以上", () => {
  expect(THEMES).toHaveLength(4);
  for (const t of THEMES)
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = contrast(t.colors[fg], t.colors[bg]);
      expect(r, `${t.id}: ${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
});

test("コントラストの計算は WCAG の値どおり (白と黒は 21、同じ色は 1)", () => {
  expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#c94a6c", "#c94a6c")).toBe(1);
  expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  expect(() => luminance("red")).toThrow();
});

test("既定のいちごミルクは style.css の :root と同じ値", () => {
  const css = readFileSync("src/style.css", "utf8");
  const root = /:root \{([^}]*)\}/.exec(css)?.[1] ?? "";
  const t = themeById(DEFAULT_THEME);
  for (const k of THEME_TOKENS) expect(root, k).toContain(`${k}: ${t.colors[k]};`);
});

test("テーマはどれも同じトークンを全部持ち、ID は ThemeId と一致する", () => {
  expect(THEMES.map((t) => t.id)).toEqual(ThemeId.options);
  for (const t of THEMES) expect(Object.keys(t.colors).sort()).toEqual([...THEME_TOKENS].sort());
  expect(themeById("nope").id).toBe(DEFAULT_THEME);
});

test("applyTheme は :root の変数と data-theme だけを変える", () => {
  const el = document.createElement("div");
  applyTheme(themeById("milktea"), el);
  expect(el.dataset.theme).toBe("milktea");
  expect(el.style.getPropertyValue("--c-bg")).toBe("#fbf7f2");
  expect(el.style.getPropertyValue("--stage-h")).toBe("");
});
