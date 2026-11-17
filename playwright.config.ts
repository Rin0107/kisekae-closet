import { defineConfig, devices } from "@playwright/test";

const base = process.env.BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  retries: process.env.CI ? 1 : 0,
  // 手元の機械を守る: ブラウザは同時に 2 つまで (npm run e2e は 3G・2 コアの cgroup の中で動く)
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  // パスキーは IP では使えないので localhost (wrangler.jsonc の ORIGIN と同じ)
  use: { baseURL: base ?? "http://localhost:8787", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
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
