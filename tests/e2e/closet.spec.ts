import { expect, test, type Page } from "@playwright/test";

// 体験の核を通しで: 服をしまう → 今日の画面でおすすめを着る → 着せ替える → 決める → カレンダーに載る
// 手元 (wrangler dev と手元の D1) だけで流す。本番・プレビューにはアカウントを作らない。

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

/** ブラウザの canvas で服の絵 (PNG) を描く。 */
async function garment(page: Page, color: string, shape: "top" | "bottom" | "outer"): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([c, s]) => {
      const cv = document.createElement("canvas");
      cv.width = 300;
      cv.height = 300;
      const g = cv.getContext("2d") as CanvasRenderingContext2D;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, 300, 300);
      g.fillStyle = c as string;
      g.beginPath();
      if (s === "bottom") {
        g.moveTo(80, 20);
        g.lineTo(220, 20);
        g.lineTo(240, 290);
        g.lineTo(165, 290);
        g.lineTo(150, 100);
        g.lineTo(135, 290);
        g.lineTo(60, 290);
      } else {
        g.moveTo(75, 40);
        g.lineTo(115, 20);
        g.lineTo(185, 20);
        g.lineTo(225, 40);
        g.lineTo(270, 120);
        g.lineTo(225, 135);
        g.lineTo(210, 100);
        g.lineTo(210, s === "outer" ? 290 : 270);
        g.lineTo(90, s === "outer" ? 290 : 270);
        g.lineTo(90, 100);
        g.lineTo(75, 135);
        g.lineTo(30, 120);
      }
      g.closePath();
      g.fill();
      return cv.toDataURL("image/png").split(",")[1] as string;
    },
    [color, shape],
  );
  return Buffer.from(b64, "base64");
}

async function stash(page: Page, kind: string, label: string, warmth: number, png: Buffer) {
  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "クローゼット" }).click();
  await page.getByRole("group", { name: "種類" }).getByRole("button", { name: kind }).click();
  await expect(page.getByTestId("guide")).toBeVisible();
  await page
    .getByLabel("写真", { exact: true })
    .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: `暖かさ ${warmth}` }).click();
  await page.getByLabel("ラベル").fill(label);
  await page.getByRole("button", { name: "クローゼットにしまう" }).click();
  await expect(page.getByTestId("shelf")).toContainText(label);
}

test("服をしまい、着せ替えて、今日のコーデに決めると、カレンダーに載る", async ({ page, baseURL }) => {
  test.skip(baseURL?.startsWith("https://") === true, "本番・プレビューにはアカウントを作らない");
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticator(page);
  await page.route("https://api.open-meteo.com/**", (r) =>
    r.fulfill({
      json: {
        daily: {
          temperature_2m_max: [14],
          temperature_2m_min: [8],
          relative_humidity_2m_mean: [70],
          precipitation_sum: [0],
        },
      },
    }),
  );
  await page.goto("./");
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.getByRole("region", { name: "クローゼット" })).toBeVisible();

  await stash(page, "トップス", "白シャツ", 2, await garment(page, "#f4f1ea", "top"));
  await stash(page, "トップス", "ピンクニット", 3, await garment(page, "#f2a7bb", "top"));
  await stash(page, "ボトムス", "デニム", 2, await garment(page, "#4a6fa5", "bottom"));
  await stash(page, "アウター", "トレンチ", 3, await garment(page, "#c8a97e", "outer"));

  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "今日" }).click();
  const stage = page.getByTestId("stage");
  await expect(stage.getByTestId("worn")).not.toHaveCount(0);
  const size = await stage.boundingBox();
  await page.screenshot({ path: "test-results/today.png", fullPage: true });

  // 棚から引っ張り出して着せる (ドラッグ)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const knit = page.getByRole("button", { name: "ピンクニットを着る" });
  const from = await knit.boundingBox();
  const to = await stage.boundingBox();
  if (from === null || to === null) throw new Error("箱がない");
  await page.screenshot({ path: "test-results/scrolled.png" });
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 40, { steps: 4 });
  // 台の見えているところ (下のほう) に落とす
  await page.mouse.move(to.x + to.width / 2, Math.max(to.y + 10, to.y + to.height - 60), { steps: 8 });
  await page.mouse.up();
  await expect(stage.getByRole("img", { name: "ピンクニット" })).toBeAttached();
  await expect(page.getByTestId("sparkle")).toBeAttached();
  const after = await stage.boundingBox();
  expect([after?.width, after?.height]).toEqual([size?.width, size?.height]); // 台の大きさは変わらない
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole("button", { name: "これに決めた" }).click();
  await expect(page.getByTestId("stamp")).toBeVisible();
  await page.screenshot({ path: "test-results/decided.png", fullPage: true });

  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "カレンダー" }).click();
  await expect(page.getByTestId("day-stamp")).toHaveCount(1);
  await page.screenshot({ path: "test-results/calendar.png", fullPage: true });
});
