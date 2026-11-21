import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * 手元 (NixOS) では、npm の Playwright が求めるブラウザの版が PLAYWRIGHT_BROWSERS_PATH に無いことがある (#75)。
 * CI でないときは、そこにある chromium を使う (無ければ Playwright の決まりのまま)。
 */
function localChromium(): string | undefined {
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.env.CI || dir === undefined || !existsSync(dir)) return undefined;
  const found = readdirSync(dir)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)))
    .pop();
  const exe = found === undefined ? "" : join(dir, found, "chrome-linux64", "chrome");
  return existsSync(exe) ? exe : undefined;
}
const executablePath = localChromium();
const launch = executablePath === undefined ? {} : { launchOptions: { executablePath } };

const base = process.env.BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  retries: process.env.CI ? 1 : 0,
  // 手元の機械を守る: ブラウザは同時に 2 つまで (npm run e2e は 3G・2 コアの cgroup の中で動く)
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  // パスキーは IP では使えないので localhost (wrangler.jsonc の ORIGIN と同じ)
  use: { baseURL: base ?? "http://localhost:8787", trace: "retain-on-failure" },
  // 持ち主 (Rin0107/kisekae-closet-archive#49): スマホが最優先。まず iPhone の大きさ・タッチで、次に広い画面で
  projects: [
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "chromium", ...launch } },
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...launch } },
  ],
  webServer: base
    ? undefined
    : {
        // 手元の D1 (SQLite) を毎回作り直して migrations を流す
        command:
          "rm -rf .wrangler/state && npm run build && npx wrangler d1 migrations apply DB --local && npx wrangler dev --port 8787 --ip 127.0.0.1",
        url: "http://127.0.0.1:8787/",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
