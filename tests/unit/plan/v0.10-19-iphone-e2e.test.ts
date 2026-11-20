// 計画 v0.10 の受け入れテスト (wk が sha256 で固定する。変えない)
// 持ち主の #49「スマホ (iPhone) であることを最優先、前提に作って。テストのときはかならずスマホ幅でスマホとしてテストするようにして」。
// e2e (Playwright) の最初の project を iPhone の大きさ・タッチ・モバイルにする。広い画面の検査も残す。
import { expect, test } from "vitest";
import config from "../../../playwright.config";

const projects = config.projects ?? [];

test("AC-1: e2e の最初の project は iphone: 幅 390px 前後・タッチ・モバイル (CI のイメージにある chromium で)", () => {
  const first = projects[0];
  expect(first?.name).toBe("iphone");
  const use = first?.use ?? {};
  expect(use.viewport?.width).toBeGreaterThanOrEqual(375);
  expect(use.viewport?.width).toBeLessThanOrEqual(393);
  expect(use.viewport?.height).toBeGreaterThanOrEqual(660);
  expect(use.isMobile).toBe(true);
  expect(use.hasTouch).toBe(true);
  expect(use.browserName).toBe("chromium");
});

test("AC-2: 広い画面 (幅 1280px) の project も残す。project は 2 つまで (CI の 5 分に収める)", () => {
  expect(projects.length).toBeLessThanOrEqual(2);
  expect(projects.some((p) => (p.use?.viewport?.width ?? 0) >= 1280)).toBe(true);
});
