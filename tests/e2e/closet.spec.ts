import { expect, test, type Page } from "@playwright/test";

// 体験の核を通しで: 服をしまう → 今日の画面でおすすめを着る → 着せ替える → 決める → カレンダーに載る
//   → 3 日先の日のコーデを先に決めておく (AC-7-5)
// 手元 (wrangler dev と手元の D1) だけで流す。本番・プレビューにはアカウントを作らない。
// README の画像 (docs/shots/) もここで撮る: `npm run shots` (AC-9-2)。服は canvas で描いた絵で、人の写真は使わない。

/** 画像の置き場所。npm run shots のときだけ docs/shots/ (README が貼る)。 */
const shot = (name: string) => (process.env.SHOTS ? `docs/shots/${name}.png` : `test-results/${name}.png`);

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 今日を含めて 16 日分の予報。3 日先だけ寒くて雨。 */
function forecast(now: Date) {
  const time = Array.from({ length: 16 }, (_, i) =>
    ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)),
  );
  return {
    daily: {
      time,
      temperature_2m_max: time.map((_, i) => (i === 3 ? 9 : 14)),
      temperature_2m_min: time.map((_, i) => (i === 3 ? 3 : 8)),
      relative_humidity_2m_mean: time.map((_, i) => (i === 3 ? 85 : 70)),
      precipitation_sum: time.map((_, i) => (i === 3 ? 4 : 0)),
    },
  };
}

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
async function garment(
  page: Page,
  color: string,
  shape: "top" | "bottom" | "outer" | "shoes",
): Promise<Buffer> {
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
      if (s === "shoes") {
        // 2 足を並べて上から撮った形 (左右にひとつずつ)
        for (const x of [40, 170]) {
          g.moveTo(x, 200);
          g.lineTo(x + 20, 120);
          g.lineTo(x + 70, 120);
          g.lineTo(x + 90, 250);
          g.lineTo(x, 250);
          g.closePath();
        }
      } else if (s === "bottom") {
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

/** 新しいアカウントに入る見本の服を消す (自分でしまった服だけで確かめるテスト用)。消したら読み直す。 */
async function clearSamples(page: Page) {
  await expect(page.getByRole("button", { name: "見本 ニットを着る" })).toBeVisible();
  await page.evaluate(async () => {
    const r = (await (await fetch("/api/clothes")).json()) as { clothes: { id: string; label: string }[] };
    for (const c of r.clothes)
      if (c.label.startsWith("見本")) await fetch(`/api/clothes/${c.id}`, { method: "DELETE" });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "見本 ニットを着る" })).toHaveCount(0);
}

async function stash(page: Page, kind: string, label: string, warmth: number, png: Buffer) {
  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "クローゼット" }).click();
  await page.getByRole("group", { name: "種類" }).getByRole("button", { name: kind }).click();
  await expect(page.getByTestId("guide")).toBeVisible();
  // AC-27-3: 撮り方の案内に背景の色のこと
  await expect(page.getByTestId("guide-bg")).toContainText("背景は服と違う色");
  await page
    .getByLabel("写真から選ぶ", { exact: true })
    .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: png });
  // AC-25-1: 下見は切り抜かれて出る (白い背景の 300×300 から、服のところだけの大きさになる)
  const preview = page.getByAltText("選んだ写真");
  await expect
    .poll(() => preview.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0)))
    .toBeGreaterThan(0);
  await expect.poll(() => preview.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeLessThan(300);
  await page.getByRole("button", { name: `暖かさ ${warmth}` }).click();
  await page.getByLabel("ラベル").fill(label);
  await page.getByRole("button", { name: "クローゼットにしまう" }).click();
  await expect(page.getByTestId("shelf")).toContainText(label);
}

test("AC-21-1: 2 回目に開くと、Open-Meteo が 3 秒遅れても 2 秒以内に天気が出る", async ({
  page,
  baseURL,
}) => {
  test.skip(baseURL?.startsWith("https://") === true, "本番・プレビューにはアカウントを作らない");
  await authenticator(page);
  const now = new Date();
  await page.route("https://api.open-meteo.com/**", (r) => r.fulfill({ json: forecast(now) }));
  await page.goto("./");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "今日" }).click();
  await expect(page.getByTestId("weather")).toHaveText("14℃ / 8℃・湿度 70%・雨 0mm");

  await page.unroute("https://api.open-meteo.com/**");
  await page.route("https://api.open-meteo.com/**", async (r) => {
    await new Promise((ok) => setTimeout(ok, 3000));
    await r.fulfill({ json: forecast(now) }).catch(() => {});
  });
  const start = Date.now();
  await page.reload();
  await expect(page.getByTestId("weather")).toHaveText("14℃ / 8℃・湿度 70%・雨 0mm", { timeout: 2000 });
  expect(Date.now() - start).toBeLessThan(2000);
  await expect(page.getByTestId("weather-old")).toContainText("の予報");
  // 遅れて届いた新しい予報に置きかわる
  await expect(page.getByTestId("weather-old")).toHaveCount(0, { timeout: 5000 });
});

test("AC-46-1 AC-47-1: 天気が読めない新しい端末でも、服を着せて決められ、天気が読めたらカレンダーに保存される。切り抜けない写真は知らせる", async ({
  page,
  baseURL,
}) => {
  test.skip(baseURL?.startsWith("https://") === true, "本番・プレビューにはアカウントを作らない");
  await authenticator(page);
  await page.route("https://api.open-meteo.com/**", (r) => r.abort());
  await page.goto("./");
  await page.getByRole("button", { name: "はじめる" }).click();
  // 見本の服は消す (自分でしまった服 1 枚だけで確かめる)
  await clearSamples(page);

  // AC-47-1: 白い背景の白い服は切り抜けないと知らせ、撮り直しを選べる
  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "クローゼット" }).click();
  await page.getByRole("group", { name: "種類" }).getByRole("button", { name: "トップス" }).click();
  await page
    .getByLabel("写真から選ぶ", { exact: true })
    .setInputFiles({ name: "w.png", mimeType: "image/png", buffer: await garment(page, "#fefefe", "top") });
  await expect(page.getByTestId("cut-bad")).toContainText("切り抜けませんでした");
  await page.getByRole("button", { name: "撮り直す" }).click();
  await expect(page.getByTestId("cut-bad")).toHaveCount(0);
  await expect(page.getByAltText("選んだ写真")).toHaveCount(0);
  // 色のある服は知らせない
  await stash(page, "トップス", "ピンクニット", 3, await garment(page, "#f2a7bb", "top"));
  await expect(page.getByTestId("cut-bad")).toHaveCount(0);

  // AC-46-1: 天気が読めなくても、着せれば決められる (保存は天気が読めてから)
  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "今日" }).click();
  await expect(page.getByTestId("weather-failed")).toBeVisible();
  // 天気が読めなくても、ふだんの天気でおすすめを着ていることがある (評価 9)。着ていなければ着せる
  const knit = page.getByRole("button", { name: "ピンクニットを着る" });
  if ((await knit.getAttribute("aria-pressed")) !== "true") await knit.click();
  await expect(knit).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "これに決めた" }).click();
  await expect(page.getByTestId("stamp")).toBeVisible();
  await expect(page.getByText("天気が読めたら、その日の天気と一緒にカレンダーに保存します")).toBeVisible();
  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "カレンダー" }).click();
  await expect(page.getByTestId(`day-${ymd(new Date())}`).getByTestId("day-stamp")).toBeVisible();

  // 天気が読めたら保存する
  const now = new Date();
  await page.unroute("https://api.open-meteo.com/**");
  await page.route("https://api.open-meteo.com/**", (r) => r.fulfill({ json: forecast(now) }));
  const saved = page.waitForRequest((r) => r.url().endsWith("/api/outfits") && r.method() === "POST");
  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "今日" }).click();
  await page.getByTestId("weather-again").click();
  const body = (await saved).postDataJSON() as { tempMax: number; itemIds: string[] };
  expect(body.tempMax).toBe(14);
  expect(body.itemIds).toHaveLength(1);
  await expect(page.getByText("今日のコーデはカレンダーに載りました")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("kisekae-closet:pending"))).toBeNull();
});

test("AC-7-5 AC-9-2 AC-22-3 AC-25-1 AC-25-2 AC-27-3 AC-28-1 AC-28-2 AC-29-2 AC-32-1 AC-33-1 AC-34-1 AC-34-3 AC-37-1 AC-40-1 AC-40-2 AC-41-1 AC-44-1 AC-44-3 AC-45-1 AC-45-2 AC-47-3: 服をしまい、着せ替えて、今日のコーデに決めると、カレンダーに載る。先の日の分も決めておける", async ({
  page,
  baseURL,
}) => {
  test.skip(baseURL?.startsWith("https://") === true, "本番・プレビューにはアカウントを作らない");
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticator(page);
  // AC-25-2: どの画面でも CSP 違反を数える (最後に 0)
  await page.addInitScript(() => {
    const w = window as unknown as { cspViolations: string[] };
    w.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      w.cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const violations = () =>
    page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);
  const now = new Date();
  await page.route("https://api.open-meteo.com/**", (r) => r.fulfill({ json: forecast(now) }));
  await page.goto("./");
  await page.getByRole("button", { name: "はじめる" }).click();
  await clearSamples(page);
  await expect(page.getByRole("region", { name: "クローゼット" })).toBeVisible();

  await stash(page, "トップス", "白シャツ", 2, await garment(page, "#f4f1ea", "top"));
  await stash(page, "トップス", "ピンクニット", 3, await garment(page, "#f2a7bb", "top"));
  await stash(page, "ボトムス", "デニム", 2, await garment(page, "#4a6fa5", "bottom"));
  await stash(page, "アウター", "トレンチ", 3, await garment(page, "#c8a97e", "outer"));
  await stash(page, "くつ", "スニーカー", 1, await garment(page, "#3d3d4a", "shoes"));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot("closet") });

  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "今日" }).click();
  const stage = page.getByTestId("stage");
  await expect(stage.getByTestId("worn")).not.toHaveCount(0);
  // AC-82-1: マネキン (repo の中の SVG) が出ている
  await expect(stage.getByTestId("mannequin")).toBeVisible();
  const size = await stage.boundingBox();
  await page.screenshot({ path: shot("today") });

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
  await expect(stage.locator('[data-testid="worn"][data-label="ピンクニット"]')).toBeAttached();
  await expect(page.getByTestId("sparkle")).toBeAttached();
  // AC-45-1 AC-45-2: 着ている服をもう一度タップすると脱げ、また押すと着る
  await expect(knit).toHaveAttribute("aria-pressed", "true");
  await knit.click();
  await expect(stage.locator('[data-testid="worn"][data-label="ピンクニット"]')).toHaveCount(0);
  await expect(knit).toHaveAttribute("aria-pressed", "false");
  await knit.click();
  await expect(stage.locator('[data-testid="worn"][data-label="ピンクニット"]')).toBeAttached();
  const after = await stage.boundingBox();
  expect([after?.width, after?.height]).toEqual([size?.width, size?.height]); // 台の大きさは変わらない
  await page.evaluate(() => window.scrollTo(0, 0));

  // AC-32-1: くつは左右の足に 1 足ずつ (足の間に浮かない)
  await page.getByRole("tab", { name: "くつ" }).click();
  // おすすめで履いていればそのまま (もう一度押すと脱ぐ、#45)
  const sneaker = page.getByRole("button", { name: "スニーカーを着る" });
  if ((await sneaker.getAttribute("aria-pressed")) !== "true") await sneaker.click();
  await expect(sneaker).toHaveAttribute("aria-pressed", "true");
  // AC-84-1: くつの片は、マネキンの左右の足の真下
  const rel = (sel: string) =>
    stage.locator(sel).evaluateAll((els) =>
      els.map((e) => {
        const s = (e.closest("figure") as HTMLElement).getBoundingClientRect();
        const b = e.getBoundingClientRect();
        return { cx: (b.left + b.width / 2 - s.left) / s.width, bottom: (b.bottom - s.top) / s.height };
      }),
    );
  const feet = await rel('[data-testid="foot"]');
  const legs = await rel('[data-testid="leg"]');
  expect(feet).toHaveLength(2);
  for (const [i, f] of feet.entries()) {
    expect(Math.abs((f.cx ?? 0) - (legs[i]?.cx ?? 9))).toBeLessThan(0.08);
    expect(f.bottom).toBeGreaterThan(0.85);
  }
  expect(feet[0]?.cx).toBeLessThan(0.5);
  expect(feet[1]?.cx).toBeGreaterThan(0.5);
  // AC-33-1 (v2): パンツの丈は写真の縦横比のまま (ウエスト 36cm を腰に重ねる)。描いたデニムは
  // ウエスト 140px・丈 270px なので、裾は 腰 (74cm) + 36 × 270 / 140 cm ≈ 台の 80%。長いパンツほど下へ届く
  const hem = await rel('[data-testid="worn"][data-label="デニム"]');
  expect(hem[0]?.bottom).toBeGreaterThan((74 + (36 * 270) / 140) / 180 - 0.03);
  expect(hem[0]?.bottom).toBeLessThan((74 + (36 * 270) / 140) / 180 + 0.03);
  // AC-82-3: 写真は切らずに 1 枚のまま。腕は袖口の向きに左右対称に開く (袖を回すのはやめた、v2)
  await expect(stage.locator('[data-testid="worn"][data-kind="top"]')).toHaveCount(1);
  const angles = await stage
    .getByTestId("arm")
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-angle"))));
  expect(angles).toHaveLength(2);
  expect(Math.abs((angles[0] ?? 0) - (angles[1] ?? 99))).toBeLessThan(3);

  await page.getByRole("button", { name: "これに決めた" }).click();
  await expect(page.getByTestId("stamp")).toBeVisible();
  await page.screenshot({ path: "test-results/decided.png", fullPage: true });
  await stage.screenshot({ path: shot("avatar") }); // #26: 服が体を覆っているか、目で見る絵

  // AC-29-2: 幅 360px でも、天気のまとまり (気温・湿度・雨) の途中で折り返さない
  await page.setViewportSize({ width: 360, height: 800 });
  for (const part of await page.getByTestId("weather").locator(".nb").all())
    // 行の数 (矩形の上端の種類)。React の文字のかたまりごとに矩形が出るので、数ではなく行で見る
    expect(
      await part.evaluate((e) => new Set([...e.getClientRects()].map((r) => Math.round(r.top))).size),
    ).toBe(1);
  // AC-34-3: 幅 360px では今と同じ 200×400
  expect(await stage.boundingBox()).toMatchObject({ width: 200, height: 400 });
  // AC-47-3: 幅 360px で『決めた!』のスタンプが、くつ・ボトムス・トップスの身ごろに重ならない
  const stampBox = await page.getByTestId("stamp").boundingBox();
  if (stampBox === null) throw new Error("スタンプがない");
  const covers = [
    ...(await stage.getByTestId("foot").all()),
    stage.locator('[data-testid="worn"][data-label="デニム"]'),
    stage.locator('[data-testid="worn"][data-kind="top"]'),
  ];
  for (const c of covers) {
    const b = await c.boundingBox();
    if (b === null) continue;
    const apart =
      stampBox.x + stampBox.width <= b.x ||
      b.x + b.width <= stampBox.x ||
      stampBox.y + stampBox.height <= b.y ||
      b.y + b.height <= stampBox.y;
    expect(apart, JSON.stringify({ stamp: stampBox, other: b })).toBe(true);
  }
  // AC-40-2: 幅 360px でも棚は台の右 (台と棚が 1 画面に並ぶ)
  const rackBox = await page.getByTestId("rack").boundingBox();
  const narrow = await stage.boundingBox();
  expect(rackBox?.x ?? 0).toBeGreaterThanOrEqual((narrow?.x ?? 0) + (narrow?.width ?? 0));
  // AC-41-1: 服をしまう画面の写真のボタンの文字は 1 行
  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "クローゼット" }).click();
  await page.getByRole("group", { name: "種類" }).getByRole("button", { name: "トップス" }).click();
  for (const [i, text] of ["カメラで撮る", "写真から選ぶ"].entries()) {
    const title = page.locator(".photo-button").nth(i);
    await expect(title).toHaveText(text);
    expect(
      await title.evaluate((e) => new Set([...e.getClientRects()].map((r) => Math.round(r.top))).size),
    ).toBe(1);
  }
  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "今日" }).click();
  // AC-34-1: デスクトップ幅 (1280px) では台が大きい
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const wide = await stage.boundingBox();
  expect(wide?.width).toBeGreaterThan(200);
  expect(wide?.height).toBeGreaterThan(400);
  await stage.screenshot({ path: "test-results/avatar-wide.png" });
  // AC-40-1: スクロールせずに、台・棚のタブ・服のカードが見え、下のタブバーに隠れない
  const bar = await page.getByRole("navigation", { name: "画面" }).boundingBox();
  const card = await page.getByTestId("garment").first().boundingBox();
  const tabs = await page.getByRole("tablist", { name: "服の種類" }).boundingBox();
  expect(card).not.toBeNull();
  expect((card?.y ?? 0) + (card?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
  expect((tabs?.y ?? 0) + (tabs?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
  expect((wide?.y ?? 0) + (wide?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
  await page.screenshot({ path: "test-results/today-wide.png" });
  await page.setViewportSize({ width: 390, height: 844 });

  expect(await violations()).toEqual([]); // AC-25-2: 服をしまう・今日・着せ替えの画面 (読み直すと数え直しになる)

  // AC-28-1 AC-28-2: 再読み込みして服が届くまで、ゲージは寒いを示さず、下着だけの姿を見せない
  await page.route("**/api/clothes", async (r) => {
    await new Promise((ok) => setTimeout(ok, 1500));
    await r.continue().catch(() => {});
  });
  await page.reload();
  await expect(page.getByTestId("wear-pending")).toBeVisible();
  await expect(page.getByTestId("gauge")).toHaveAttribute("data-band", "loading");
  await expect(stage.getByTestId("worn")).toHaveCount(0);
  await expect(stage.getByTestId("worn")).not.toHaveCount(0, { timeout: 5000 });
  await expect(page.getByTestId("wear-pending")).toHaveCount(0);
  await expect(page.getByTestId("gauge")).not.toHaveAttribute("data-band", "loading");
  await page.unroute("**/api/clothes");

  // 3 日先の日のコーデを先に決めておく
  const ahead = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "カレンダー" }).click();
  if (ahead.getMonth() !== now.getMonth()) await page.getByRole("button", { name: "次の月" }).click();
  await page.getByTestId(`day-${ymd(ahead)}`).click();
  await page.getByRole("button", { name: "この日のコーデを決める" }).click();
  await expect(page.getByTestId("plan-bar")).toContainText(`${ahead.getMonth() + 1}月${ahead.getDate()}日`);
  await expect(page.getByTestId("weather")).toHaveText("9℃ / 3℃・湿度 85%・雨 4mm");
  await expect(stage.locator('[data-testid="worn"][data-label="トレンチ"]')).toBeAttached(); // 寒い日はアウターまで
  await page.getByRole("button", { name: "これに決めた" }).click();
  await expect(page.getByTestId("stamp")).toBeVisible();
  await page.getByRole("button", { name: "今日に戻る" }).click();
  await expect(page.getByTestId("plan-bar")).toHaveCount(0);

  await page.getByRole("navigation", { name: "画面" }).getByRole("button", { name: "カレンダー" }).click();
  if (ahead.getMonth() !== now.getMonth()) {
    await expect(page.getByTestId("day-plan")).toHaveCount(0);
    await page.getByRole("button", { name: "次の月" }).click();
    await expect(page.getByTestId("day-plan")).toHaveCount(1);
    await page.getByRole("button", { name: "前の月" }).click();
  } else {
    await expect(page.getByTestId("day-plan")).toHaveCount(1);
  }
  await expect(page.getByTestId("day-stamp")).toHaveCount(1);
  await page.screenshot({ path: shot("calendar") });
  expect(await violations()).toEqual([]); // AC-25-2
});

test("見本: 新しいアカウントには 6 種類の見本の服が 1 枚ずつ入っていて、すぐ着せられる (持ち主 2026-11-21)", async ({
  page,
  baseURL,
}) => {
  test.skip(baseURL?.startsWith("https://") === true, "本番・プレビューにはアカウントを作らない");
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticator(page);
  await page.route("https://api.open-meteo.com/**", (r) => r.fulfill({ json: forecast(new Date()) }));
  await page.goto("./");
  await page.getByRole("button", { name: "はじめる" }).click();
  const names = ["トップス", "ワンピース", "ボトムス", "アウター", "くつ", "こもの"];
  for (const n of names) {
    await page.getByRole("tab", { name: n }).click();
    const g = page.getByTestId("rack").getByTestId("garment");
    await expect(g).toHaveCount(1);
    await expect(g.first()).toHaveAccessibleName(/^見本 /);
    // 写真が読めている (切り抜き前でも後でも、幅がある)
    await expect
      .poll(() =>
        g
          .first()
          .locator("img")
          .evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0)),
      )
      .toBeGreaterThan(0);
  }
  // おすすめで見本を着ている
  await expect(page.getByTestId("stage").getByTestId("worn")).not.toHaveCount(0);
  // 上部はステータスバーの下から (ホーム画面から開いたときの重なりよけ)
  const pad = await page.locator("main").evaluate((m) => getComputedStyle(m).paddingTop);
  expect(parseFloat(pad)).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: shot("today-samples") });
});
