import { expect, test, type Page } from "@playwright/test";

// 手元 (wrangler dev) とプレビュー・本番 (BASE_URL=https://… を指定) の両方で流す
test("トップが開き、守りのヘッダーが付いている", async ({ page }) => {
  const res = await page.goto("./");
  expect(res?.status()).toBe(200);
  const h = res?.headers() ?? {};
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["set-cookie"]).toBeUndefined();
  await expect(page.getByTestId("goal")).toBeVisible();
});

test("ログインの前は、自分の origin の外へ通信しない", async ({ page, baseURL }) => {
  const own = new URL(baseURL ?? "http://invalid.test").origin;
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin !== own && u.protocol !== "data:" && u.protocol !== "blob:") external.push(r.url());
  });
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  expect(external).toEqual([]);
});

test("CSP 違反がない", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  expect(violations).toEqual([]);
});

test("ホーム画面に追加できる (manifest とアイコン)", async ({ page, request }) => {
  await page.goto("./");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const url = new URL(href ?? "", page.url());
  const manifest = await (await request.get(url.toString())).json();
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons as { src: string }[]) {
    const res = await request.get(new URL(icon.src, url).toString());
    expect(res.status()).toBe(200);
  }
});

test("API: ログインなしは 401、ほかのサイトからの書き込みは 403", async ({ request, baseURL }) => {
  expect((await request.get("/api/clothes")).status()).toBe(401);
  const res = await request.post("/api/auth/login/options", { headers: { Origin: "https://evil.example" } });
  expect(res.status()).toBe(403);
  const ok = await request.post("/api/auth/login/options", {
    headers: { Origin: new URL(baseURL ?? "").origin },
  });
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toBe("private, no-store");
});

/** Chromium の仮想の認証器 (本物の暗号でパスキーを作る)。 */
async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test("パスキーで始め、ログアウトし、もう一度ログインできる。アカウントを消せる", async ({
  page,
  baseURL,
}) => {
  test.skip(baseURL?.startsWith("https://") === true, "本番・プレビューにはアカウントを作らない");
  await authenticator(page);
  await page.route("https://api.open-meteo.com/**", (r) =>
    r.fulfill({
      json: {
        daily: {
          temperature_2m_max: [16],
          temperature_2m_min: [8],
          relative_humidity_2m_mean: [60],
          precipitation_sum: [0],
        },
      },
    }),
  );
  await page.goto("./");
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.getByRole("region", { name: "クローゼット" })).toBeVisible();
  await expect(page.getByTestId("weather")).toHaveText("16℃ / 8℃・湿度 60%・雨 0mm");
  const cookies = await page.context().cookies();
  const sid = cookies.find((c) => c.name === "__Host-sid");
  expect(sid?.httpOnly).toBe(true);
  expect(sid?.sameSite).toBe("Strict");

  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page.getByRole("button", { name: "パスキーでログイン" })).toBeVisible();
  await page.getByRole("button", { name: "パスキーでログイン" }).click();
  await expect(page.getByRole("region", { name: "クローゼット" })).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "アカウントと全データを消す" }).click();
  await expect(page.getByRole("button", { name: "はじめる" })).toBeVisible();
  await page.getByRole("button", { name: "パスキーでログイン" }).click();
  await expect(page.getByRole("alert")).toBeVisible(); // 消したアカウントには入れない
});
