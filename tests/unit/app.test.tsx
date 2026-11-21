// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const pk = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn() }));
vi.mock("../../src/passkey", () => pk);
const sh = vi.hoisted(() => ({ shrinkPhoto: vi.fn() }));
vi.mock("../../src/shrink", () => sh);
// 天気の読み直しの間 (#31) は待たない
const sl = vi.hoisted(() => ({ sleep: vi.fn() }));
vi.mock("../../src/sleep", () => sl);

import { App, KIND_NAMES, shelfOf, today } from "../../src/App";

type Handler = (method: string, body: unknown) => [number, unknown];
let routes: Record<string, Handler>;
let calls: string[];
let weatherBody: unknown;

// 日付は固定する (月のはじめでも「前の日」の見本が過去になるように)
const DAY = "2026-11-17";
const NOW = new Date(2026, 10, 17, 9, 0, 0);

const WEATHER = {
  daily: {
    time: [DAY],
    temperature_2m_max: [30],
    temperature_2m_min: [24],
    relative_humidity_2m_mean: [60],
    precipitation_sum: [0],
  },
};
const CLOTHES = [
  { id: "t1", kind: "top", warmth: 1, label: "白T", createdAt: 1 },
  { id: "b1", kind: "bottom", warmth: 1, label: "デニム", createdAt: 2 },
  { id: "t2", kind: "top", warmth: 3, label: "ニット", createdAt: 3 },
  { id: "d1", kind: "dress", warmth: 2, label: "花柄", createdAt: 4 },
  { id: "o1", kind: "outer", warmth: 4, label: "コート", createdAt: 5 },
  { id: "s1", kind: "shoes", warmth: 1, label: "スニーカー", createdAt: 6 },
  { id: "a1", kind: "accessory", warmth: 1, label: "", createdAt: 7 },
];
const PAST = [
  {
    id: "o1",
    wornOn: "2025-08-01",
    tempMax: 30,
    tempMin: 24,
    humidity: 60,
    precip: 0,
    itemIds: ["t1", "gone"],
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  calls = [];
  weatherBody = WEATHER;
  routes = {
    me: () => [200, { signedIn: true }],
    clothes: (m) => (m === "POST" ? [201, { id: "n" }] : [200, { clothes: CLOTHES }]),
    outfits: (m) => (m === "POST" ? [201, { id: "o" }] : [200, { outfits: PAST }]),
    "auth/logout": () => [200, { ok: true }],
    account: () => [200, { ok: true }],
    "clothes/t1": () => [200, { ok: true }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url.startsWith("https://api.open-meteo.com/")) return new Response(JSON.stringify(weatherBody));
      const path = url.replace("/api/", "");
      const m = init?.method ?? "GET";
      calls.push(`${m} ${path}${init?.body ? " " + init.body : ""}`);
      const h = routes[path];
      const [status, body] = h ? h(m, init?.body) : [404, { error: "見つからない" }];
      return new Response(JSON.stringify(body), { status });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
});

async function render(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<App />));
  await act(async () => {});
  return el;
}

/** 読み直しの続き (待たない sleep・fetch の答え) を流し切る。 */
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => {});
};
const click = async (el: Element | null | undefined) => {
  await act(async () => (el as HTMLElement).click());
  await act(async () => {});
};
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === text);
const change = async (el: Element | null, value: string) => {
  await act(async () => {
    const input = el as HTMLInputElement;
    const proto = Object.getPrototypeOf(input) as object;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

test("today は手元の日付 (YYYY-MM-DD)", () => {
  expect(today(new Date(2026, 0, 5))).toBe("2026-01-05");
  expect(today(new Date(2026, 10, 15))).toBe("2026-11-15");
  expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

describe("ログインの前", () => {
  beforeEach(() => {
    routes.me = () => [401, { error: "ログインしていない" }];
  });

  test("目標と、パスキーで始める・ログインのボタン", async () => {
    const el = await render();
    expect(el.querySelector("h1")?.textContent).toBe("kisekae-closet");
    // prettier-ignore
    expect(el.querySelector('[data-testid="goal"]')?.textContent).toBe("開くと今日の天気とおすすめを着たアバターが出て、クローゼットから服を引っ張り出して着せ替え、ワンタップで今日のコーデに決められる");
    expect(button(el, "はじめる")).toBeDefined();
    expect(button(el, "パスキーでログイン")).toBeDefined();
  });

  test("はじめる: 入れた名前 (なければアプリの名前) でパスキーを作り、入る", async () => {
    pk.register.mockResolvedValue(undefined);
    let el = await render();
    await change(el.querySelector("input"), " わたし ");
    routes.me = () => [200, { signedIn: true }];
    await click(button(el, "はじめる"));
    expect(pk.register).toHaveBeenCalledWith("わたし");
    expect(el.querySelector('section[aria-label="クローゼット"]')).not.toBeNull();
    // 見本の写真が読めない (このテストの fetch は 404) ときは、入らなかった枚数を一言知らせる
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(
      "見本の服を 6 枚入れられませんでした。服は「クローゼット」から入れられます。",
    );
    document.body.replaceChildren();
    routes.me = () => [401, { error: "x" }];
    el = await render();
    await click(button(el, "はじめる"));
    expect(pk.register).toHaveBeenLastCalledWith("kisekae-closet");
  });

  test("ログインに失敗すれば理由を出す", async () => {
    pk.login.mockRejectedValue(new Error("パスキーを確かめられない"));
    const el = await render();
    await click(button(el, "パスキーでログイン"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("パスキーを確かめられない");
    pk.login.mockRejectedValue("文字");
    await click(button(el, "パスキーでログイン"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("失敗した");
  });
});

const tab = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('[role="tab"], nav button')].find((b) => b.textContent === text);
const account = async (el: HTMLElement, text: string) => {
  await click(button(el, "クローゼット"));
  if (button(el, "設定")?.getAttribute("aria-expanded") !== "true") await click(button(el, "設定"));
  return button(el, text);
};
const worn = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-testid="stage"] [data-testid="worn"]')].map((i) => i.getAttribute("alt"));
const pointer = async (el: Element, type: string, x: number, y: number) => {
  await act(async () => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  });
};

describe("ログインのあと: 今日の画面", () => {
  test("AC-5-1 AC-5-2: MVP の 3 画面 (今日・クローゼット・カレンダー) を下のタブで行き来できる", async () => {
    const el = await render();
    const tabs = [...el.querySelectorAll('nav[aria-label="画面"] button')];
    expect(tabs.map((b) => b.textContent)).toEqual(["今日", "クローゼット", "カレンダー"]);
    expect(tabs[0]?.getAttribute("aria-current")).toBe("page");
    await click(tabs[2]);
    expect(tabs[2]?.getAttribute("aria-current")).toBe("page");
    expect(tabs[0]?.getAttribute("aria-current")).toBeNull();
    await click(tabs[0]);
    expect(el.querySelector('[data-testid="weather"]')).not.toBeNull();
  });

  test("AC-1-1: 天気と、おすすめの服を重ねたアバターが出る", async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="weather"]')?.textContent).toBe("30℃ / 24℃・湿度 60%・雨 0mm");
    expect(el.querySelector('svg[aria-label="晴れ"]')).not.toBeNull();
    expect(worn(el)).toEqual(["白T", "デニム", "スニーカー"]);
    const img = el.querySelector('[data-testid="worn"]') as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/clothes/t1/photo");
    expect(img.style.top).toBe("12.5%");
    expect(el.querySelector('[data-testid="labels"]')?.textContent).toBe("白Tデニムスニーカー");
  });

  test("AC-1-2: 台の大きさは固定 (CSS の変数)。ラベルは台の外の 1 行で、多ければ +N", async () => {
    const css = readFileSync("src/style.css", "utf8");
    const rule = /\.stage \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("width: var(--stage-w)");
    expect(rule).toContain("height: var(--stage-h)");
    expect(rule).toContain("flex: none");
    expect(/\.chips \{([^}]*)\}/.exec(css)?.[1]).toContain("height: 32px");
    routes.outfits = (m) =>
      m === "POST"
        ? [201, { id: "o" }]
        : [
            200,
            {
              outfits: [
                { ...PAST[0], id: "today", wornOn: today(), itemIds: ["t1", "b1", "o1", "s1", "a1"] },
              ],
            },
          ];
    const el = await render();
    const stage = el.querySelector('[data-testid="stage"]') as HTMLElement;
    expect(stage.querySelectorAll('[data-testid="worn"]')).toHaveLength(5);
    expect(stage.querySelector('[data-testid="labels"]')).toBeNull();
    expect(el.querySelector('[data-testid="labels"]')?.textContent).toBe("デニムスニーカー白T+2"); // 重なりの順 (くつは裾より前、#39)
    expect(stage.className).toBe("stage");
  });

  test("AC-1-3: ゲージは数字を出さず、着替えるとつまみが動く", async () => {
    const el = await render();
    const g = () => el.querySelector('[data-testid="gauge"]') as HTMLElement;
    const left = () => (el.querySelector('[data-testid="gauge-thumb"]') as HTMLElement).style.left;
    expect(g().textContent).not.toMatch(/\d/);
    expect(g().dataset.band).toBe("ok");
    expect(g().textContent).toContain("ちょうどいい");
    const before = left();
    await click(tab(el, "アウター"));
    await click(el.querySelector('[aria-label="コートを着る"]'));
    expect(g().dataset.band).toBe("hot");
    expect(g().textContent).toContain("暑い");
    // 暖かさの数字は出さない (一言の「1枚」は服の枚数なので除く)
    expect((g().textContent ?? "").replace(/\d枚/g, "")).not.toMatch(/\d/);
    expect(parseFloat(left())).toBeGreaterThan(parseFloat(before));
  });

  test("AC-1-4: 「これに決めた」で今日のコーデを天気と一緒に保存し、スタンプが出る", async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="stamp"]')).toBeNull();
    routes.outfits = (m) =>
      m === "POST"
        ? [201, { id: "o" }]
        : [200, { outfits: [{ ...PAST[0], id: "o", wornOn: today(), itemIds: ["t1", "b1", "s1"] }] }];
    await click(button(el, "これに決めた"));
    const post = calls.find((c) => c.startsWith("POST outfits"));
    expect(JSON.parse(post?.slice("POST outfits ".length) ?? "{}")).toEqual({
      wornOn: today(),
      itemIds: ["t1", "b1", "s1"],
      tempMax: 30,
      tempMin: 24,
      humidity: 60,
      precip: 0,
    });
    expect(el.querySelector('[data-testid="stamp"]')?.textContent).toBe("決めた!");
    expect(button(el, "これに決めた")).toBeUndefined();
  });

  test("決めたあとに着替えて決め直すと、前の今日のコーデを消して新しくする", async () => {
    routes.outfits = (m) =>
      m === "POST"
        ? [201, { id: "o2" }]
        : [200, { outfits: [{ ...PAST[0], id: "o1", wornOn: today(), itemIds: ["t1", "b1"] }] }];
    routes["outfits/o1"] = () => [200, { ok: true }];
    const el = await render();
    expect(worn(el)).toEqual(["デニム", "白T"]);
    expect(el.querySelector('[data-testid="stamp"]')).not.toBeNull();
    await click(el.querySelector('[aria-label="ニットを着る"]'));
    expect(worn(el)).toEqual(["デニム", "ニット"]);
    expect(el.querySelector('[data-testid="stamp"]')).toBeNull();
    await click(button(el, "これに決めた"));
    expect(calls.filter((c) => /^(POST outfits|DELETE outfits)/.test(c)).map((c) => c.slice(0, 20))).toEqual([
      'POST outfits {"wornO',
      "DELETE outfits/o1",
    ]);
  });

  test("決め直しで前のコーデを消せなくても、新しいコーデは残して読み直し、そう伝える", async () => {
    routes.outfits = (m) =>
      m === "POST"
        ? [201, { id: "o2" }]
        : [200, { outfits: [{ ...PAST[0], id: "o1", wornOn: today(), itemIds: ["t1", "b1"] }] }];
    routes["outfits/o1"] = () => [500, { error: "x" }];
    const el = await render();
    await click(el.querySelector('[aria-label="ニットを着る"]'));
    const before = calls.filter((c) => c === "GET outfits").length;
    await click(button(el, "これに決めた"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(
      "前のコーデを消せませんでした (新しいコーデは保存しました)",
    );
    expect(calls.filter((c) => c === "GET outfits").length).toBe(before + 1);
    routes["outfits/o1"] = () => [401, { error: "ログインしていない" }];
    await click(el.querySelector('[aria-label="ニットを着る"]'));
    await click(button(el, "これに決めた"));
    expect(button(el, "はじめる")).toBeDefined();
  });
  test("コーデの保存に失敗すれば理由を出す", async () => {
    routes.outfits = (m) => (m === "POST" ? [400, { error: "知らない服がある" }] : [200, { outfits: [] }]);
    const el = await render();
    await click(button(el, "これに決めた"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("知らない服がある");
  });

  test("市を変えると端末に覚え、天気を読み直す。天気が読めなければ決めるボタンもない", async () => {
    const el = await render();
    const api = vi.mocked(fetch).getMockImplementation() as typeof fetch;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).startsWith("https://api.open-meteo.com/")) throw new Error("offline");
      return api(url, init);
    });
    await change(el.querySelector('select[aria-label="市"]'), "osaka");
    await settle();
    expect(localStorage.getItem("kisekae-closet:city")).toBe('"osaka"');
    expect(el.querySelector('[data-testid="weather"]')).toBeNull();
    expect(el.querySelector('[role="alert"][data-testid="weather-failed"]')?.textContent).toContain(
      "天気を読めませんでした",
    );
    expect(button(el, "これに決めた")).toBeUndefined();
  });

  test("AC-46-1: 天気が読めず前回の予報もなくても、服を着せれば「これに決めた」で決められ、天気が読めたらカレンダーに保存する", async () => {
    const api = vi.mocked(fetch).getMockImplementation() as typeof fetch;
    let offline = true;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (offline && String(url).startsWith("https://api.open-meteo.com/")) throw new Error("offline");
      return api(url, init);
    });
    const el = await render();
    await settle();
    expect(el.querySelector('[data-testid="weather-failed"]')).not.toBeNull();
    expect(button(el, "これに決めた")).toBeUndefined(); // まだ何も着ていない
    await click(el.querySelector('[aria-label="ニットを着る"]'));
    await click(button(el, "これに決めた"));
    expect(calls.some((c) => c.startsWith("POST outfits"))).toBe(false); // 天気の数字がまだない
    expect(el.querySelector('[data-testid="stamp"]')?.textContent).toBe("決めた!");
    expect(el.textContent).toContain("天気が読めたら、その日の天気と一緒にカレンダーに保存します");
    expect(button(el, "これに決めた")).toBeUndefined();
    expect(JSON.parse(localStorage.getItem("kisekae-closet:pending") ?? "null")).toEqual({
      wornOn: today(),
      itemIds: ["t2"],
    });
    // 天気が読めたら、決めたコーデをその日の天気と一緒に保存し、端末からは消す
    offline = false;
    routes.outfits = (m) =>
      m === "POST"
        ? [201, { id: "o" }]
        : [200, { outfits: [{ ...PAST[0], id: "o", wornOn: today(), itemIds: ["t2"] }] }];
    await click(button(el, "もう一度読む"));
    await settle();
    const post = calls.find((c) => c.startsWith("POST outfits"));
    expect(JSON.parse(post?.slice("POST outfits ".length) ?? "{}")).toEqual({
      wornOn: today(),
      itemIds: ["t2"],
      tempMax: 30,
      tempMin: 24,
      humidity: 60,
      precip: 0,
    });
    expect(localStorage.getItem("kisekae-closet:pending")).toBeNull();
    expect(el.querySelector('[data-testid="stamp"]')?.textContent).toBe("決めた!");
    expect(el.textContent).toContain("今日のコーデはカレンダーに載りました");
  });

  test("AC-46-2: 天気なしで決めた日のカレンダーのマスは、天気の印なしでスタンプが出て、押すと保存待ちと分かる", async () => {
    const api = vi.mocked(fetch).getMockImplementation() as typeof fetch;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).startsWith("https://api.open-meteo.com/")) throw new Error("offline");
      return api(url, init);
    });
    const el = await render();
    await settle();
    await click(el.querySelector('[aria-label="ニットを着る"]'));
    await click(button(el, "これに決めた"));
    await click(tab(el, "カレンダー"));
    const cell = el.querySelector(`[data-testid="day-${today()}"]`) as HTMLElement;
    expect(cell.querySelector('[data-testid="mini"]')).toBeNull();
    expect(cell.querySelector('[data-testid="day-stamp"]')).not.toBeNull();
    expect(cell.getAttribute("aria-label")).toContain("決めた日");
    await click(cell);
    expect(el.querySelector('[data-testid="picked-held"]')?.textContent).toContain("天気が読めたら");
    // 開き直しても、決めたコーデは残る (端末に置いてある)。昨日より前のものは捨てる
    document.body.replaceChildren();
    const again = await render();
    await settle();
    expect(again.querySelector('[data-testid="stamp"]')).not.toBeNull();
    expect(worn(again)).toEqual(["ニット"]);
    document.body.replaceChildren();
    localStorage.setItem("kisekae-closet:pending", JSON.stringify({ wornOn: "2000-01-01", itemIds: ["t2"] }));
    const old = await render();
    await settle();
    expect(old.querySelector('[data-testid="stamp"]')).toBeNull();
  });

  test("天気: 読み込み中と、読めなかった (200 でない・形が違う) を分けて出す", async () => {
    let release = () => {};
    const api = vi.mocked(fetch).getMockImplementation() as typeof fetch;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (!String(url).startsWith("https://api.open-meteo.com/")) return api(url, init);
      // 天気の答えを待たせる
      await new Promise<void>((r) => (release = r));
      return new Response(JSON.stringify(WEATHER));
    });
    const el = await render();
    expect(el.textContent).toContain("天気を読んでいます…");
    expect(el.querySelector('[role="alert"]')).toBeNull();
    await act(async () => release());
    await act(async () => {});
    expect(el.querySelector('[data-testid="weather"]')).not.toBeNull();

    for (const res of [
      () => new Response("oops", { status: 503 }),
      () => new Response(JSON.stringify({ daily: {} })),
    ]) {
      document.body.replaceChildren();
      // 前回の予報がなければ (初めて開いたとき)、読めなかったと出す
      localStorage.clear();
      vi.mocked(fetch).mockImplementation(async (url, init) =>
        String(url).startsWith("https://api.open-meteo.com/") ? res() : api(url, init),
      );
      const e = await render();
      await settle();
      expect(e.querySelector('[data-testid="weather-failed"]')?.getAttribute("role")).toBe("alert");
      expect(button(e, "これに決めた")).toBeUndefined();
    }
  });

  test("服がなければ、しまうように案内してクローゼットへ", async () => {
    routes.clothes = () => [200, { clothes: [] }];
    const el = await render();
    expect(button(el, "これに決めた")).toBeUndefined();
    expect(el.textContent).toContain("まだ服がありません");
    await click(button(el, "服をしまう"));
    expect(el.querySelector('section[aria-label="服をしまう"]')).not.toBeNull();
  });
});

describe("クローゼットから着せる", () => {
  test("AC-2-1: 種類ごとのタブで、その種類の服だけが並ぶ", async () => {
    const el = await render();
    const names = () => [...el.querySelectorAll('[data-testid="garment"]')].map((b) => b.textContent);
    expect(names()).toEqual(["白T", "ニット"]);
    await click(tab(el, "ワンピース"));
    expect(names()).toEqual(["花柄"]);
    await click(tab(el, "ボトムス"));
    expect(names()).toEqual(["デニム"]);
    await click(tab(el, "くつ"));
    expect(names()).toEqual(["スニーカー"]);
    await click(tab(el, "こもの"));
    expect(names()).toEqual(["こもの"]);
    expect(tab(el, "こもの")?.getAttribute("aria-selected")).toBe("true");
    routes.clothes = () => [200, { clothes: [CLOTHES[0]] }];
    document.body.replaceChildren();
    const e2 = await render();
    await click(tab(e2, "アウター"));
    expect(e2.textContent).toContain("この棚はからっぽです");
  });

  test("AC-2-2: カードをタップすると、その種類が入れ替わり、キラッが出る", async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="sparkle"]')).toBeNull();
    await click(el.querySelector('[aria-label="ニットを着る"]'));
    expect(worn(el)).toEqual(["デニム", "スニーカー", "ニット"]); // 重なりの順 (#39)
    expect(el.querySelector('[data-testid="sparkle"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="ニットを着る"]')?.getAttribute("aria-pressed")).toBe("true");
    await click(tab(el, "ワンピース"));
    await click(el.querySelector('[aria-label="花柄を着る"]'));
    expect(worn(el)).not.toContain("デニム");
    expect(worn(el)).toContain("花柄");
  });

  test("AC-45-1: 棚の着ている服をもう一度タップすると脱げ、アバターから消え、ゲージのつまみが動く", async () => {
    const el = await render();
    const left = () => (el.querySelector('[data-testid="gauge-thumb"]') as HTMLElement).style.left;
    await click(tab(el, "アウター"));
    const coat = () => el.querySelector('[aria-label="コートを着る"]') as HTMLElement;
    await click(coat());
    expect(worn(el)).toContain("コート");
    expect(coat().getAttribute("aria-pressed")).toBe("true");
    const on = parseFloat(left());
    const sparkles = el.querySelectorAll('[data-testid="sparkle"]').length;
    await click(coat()); // もう一度押すと脱ぐ
    expect(worn(el)).not.toContain("コート");
    expect(coat().getAttribute("aria-pressed")).toBe("false");
    expect(parseFloat(left())).toBeLessThan(on);
    expect(el.querySelectorAll('[data-testid="sparkle"]').length).toBe(sparkles); // 脱ぐときはキラッとしない
    await click(coat()); // また押すと着る
    expect(worn(el)).toContain("コート");
  });

  test("AC-45-2: 着ている服をドラッグして台に落としても脱がない (タップで脱ぐ)", async () => {
    const el = await render();
    const stage = el.querySelector('[data-testid="stage"]') as HTMLElement;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 400 }) as DOMRect;
    const knit = el.querySelector('[aria-label="ニットを着る"]') as HTMLElement;
    await click(knit);
    expect(worn(el)).toContain("ニット");
    await pointer(knit, "pointerdown", 100, 600);
    await pointer(knit, "pointermove", 100, 300);
    await pointer(knit, "pointerup", 100, 300);
    await click(knit); // ドラッグのあとの click
    expect(worn(el)).toContain("ニット");
    await click(knit);
    expect(worn(el)).not.toContain("ニット");
  });

  test("AC-2-3: カードをアバターにドラッグして離すと着る。外で離せば着ない", async () => {
    const el = await render();
    const stage = el.querySelector('[data-testid="stage"]') as HTMLElement;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 400 }) as DOMRect;
    const knit = el.querySelector('[aria-label="ニットを着る"]') as HTMLElement;
    await pointer(knit, "pointerdown", 100, 600);
    await pointer(knit, "pointermove", 102, 602); // まだ動かしていない
    expect(el.querySelector('[data-testid="ghost"]')).toBeNull();
    await pointer(knit, "pointermove", 100, 300);
    expect(el.querySelector('[data-testid="ghost"]')).not.toBeNull();
    await pointer(knit, "pointerup", 100, 300);
    await click(knit); // ドラッグのあとの click では二度着ない
    expect(worn(el)).toContain("ニット");
    expect(el.querySelector('[data-testid="ghost"]')).toBeNull();
    await click(tab(el, "ワンピース"));
    const flower = el.querySelector('[aria-label="花柄を着る"]') as HTMLElement;
    await pointer(flower, "pointerdown", 100, 600);
    await pointer(flower, "pointermove", 300, 500);
    await pointer(flower, "pointerup", 300, 500);
    await click(flower);
    expect(worn(el)).not.toContain("花柄");
    await pointer(flower, "pointerdown", 100, 600);
    await pointer(flower, "pointercancel", 100, 600);
    await pointer(flower, "pointermove", 100, 300);
    await pointer(flower, "pointerup", 100, 300);
    expect(worn(el)).not.toContain("花柄");
  });
});

describe("服をしまう", () => {
  const pickFile = async (el: HTMLElement, files: File[] | null) => {
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  };

  test("AC-2-4: 最初からトップスの枠と撮り方が出ていて、種類を選ぶと枠が変わり、暖かさとラベルを付けてしまうと、その棚に並ぶ", async () => {
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }),
    );
    const el = await render();
    await click(button(el, "クローゼット"));
    expect(el.querySelector('[data-testid="frame"]')?.getAttribute("data-kind")).toBe("top");
    await click(button(el, "アウター"));
    expect(el.querySelector('[data-testid="frame"]')?.getAttribute("data-kind")).toBe("outer");
    expect(el.querySelector('[data-testid="guide"]')?.textContent).toContain(
      "ハンガーにかけて、正面からまっすぐ",
    );
    await click(button(el, "クローゼットにしまう"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("写真を選ぶ");
    const f = new File(["x"], "a.jpg", { type: "image/jpeg" });
    await pickFile(el, [f]);
    expect(el.querySelector('[data-testid="frame"] img')?.getAttribute("src")).toBe("blob:x");
    sh.shrinkPhoto.mockResolvedValue(null);
    await click(button(el, "クローゼットにしまう"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(
      "写真を保存できませんでした。もう一度撮り直してください。",
    );
    sh.shrinkPhoto.mockResolvedValue("AAAA");
    await click(el.querySelector('[aria-label="暖かさ 4"]'));
    await change(el.querySelector('input[aria-label="ラベル"]'), "通勤");
    routes.clothes = (m) =>
      m === "POST"
        ? [201, { id: "n" }]
        : [
            200,
            { clothes: [...CLOTHES, { id: "n", kind: "outer", warmth: 4, label: "通勤", createdAt: 9 }] },
          ];
    await click(button(el, "クローゼットにしまう"));
    expect(sh.shrinkPhoto).toHaveBeenLastCalledWith(f);
    const post = calls.find((c) => c.startsWith("POST clothes"));
    expect(JSON.parse(post?.slice("POST clothes ".length) ?? "{}")).toEqual({
      kind: "outer",
      warmth: 4,
      label: "通勤",
      photo: "AAAA",
    });
    const shelf = el.querySelector('[data-testid="shelf"]') as HTMLElement;
    expect(shelf.dataset.shelf).toBe("outer");
    expect(shelf.textContent).toContain("通勤");
    expect(el.querySelector('[data-testid="frame"]')?.getAttribute("data-kind")).toBe("outer");
    await click(button(el, "ワンピース"));
    await pickFile(el, null);
    await click(button(el, "クローゼットにしまう"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("写真を選ぶ");
  });

  test("AC-2-5: DATA.md に、サーバーに置く服の欄とブラウザに置くキーが書かれている", () => {
    const data = readFileSync("DATA.md", "utf8");
    const row = data.split("\n").find((l) => l.startsWith("| `clothes`")) ?? "";
    for (const w of ["写真", "種類", "暖かさ", "ラベル"]) expect(row).toContain(w);
    expect(data).toContain("`kisekae-closet:city`");
  });

  test("しまうのに失敗しても、サーバーの理由は出さず撮り直しを頼む", async () => {
    routes.clothes = (m) => (m === "POST" ? [400, { error: "服の形が違う" }] : [200, { clothes: CLOTHES }]);
    sh.shrinkPhoto.mockResolvedValue("AAAA");
    const el = await render();
    await click(button(el, "クローゼット"));
    await click(button(el, "トップス"));
    await pickFile(el, [new File(["x"], "a.jpg")]);
    await click(button(el, "クローゼットにしまう"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(
      "写真を保存できませんでした。もう一度撮り直してください。",
    );
  });

  test("服を消す (失敗すれば理由)", async () => {
    const el = await render();
    await click(button(el, "クローゼット"));
    await click(el.querySelector('[data-testid="shelf"] li button'));
    expect(calls).toContain("DELETE clothes/t1");
    routes["clothes/t1"] = () => [404, { error: "見つからない" }];
    await click(el.querySelector('[data-testid="shelf"] li button'));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("見つからない");
  });
});

describe("天気を 2 秒以内に出す (#21)", () => {
  const SAVED = {
    city: "tokyo",
    at: new Date(2026, 10, 17, 7, 5).getTime(),
    days: [
      ["2026-11-16", { tempMax: 9, tempMin: 1, humidity: 40, precip: 0 }],
      [DAY, { tempMax: 18, tempMin: 10, humidity: 55, precip: 1 }],
    ],
  };
  // Open-Meteo の答えを待たせる (release で返す。fail なら読めない)
  let release: (ok: boolean) => void;
  beforeEach(() => {
    localStorage.setItem("kisekae-closet:forecast", JSON.stringify(SAVED));
    const api = vi.mocked(fetch).getMockImplementation() as typeof fetch;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (!String(url).startsWith("https://api.open-meteo.com/")) return api(url, init);
      const ok = await new Promise<boolean>((r) => (release = r));
      return ok ? new Response(JSON.stringify(WEATHER)) : new Response("oops", { status: 503 });
    });
  });

  test("AC-21-1: 2 回目からは、Open-Meteo の答えを待たずに前回の予報 (今日の分) が出て、決められる", async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="weather"]')?.textContent).toBe("18℃ / 10℃・湿度 55%・雨 1mm");
    expect(el.textContent).not.toContain("天気を読んでいます…");
    expect(button(el, "これに決めた")).toBeDefined();
  });

  test("AC-21-1: 前回の予報が別の市・今日の分がない・壊れているなら、使わずに読み込み中と出す", async () => {
    for (const saved of [
      { ...SAVED, city: "osaka" },
      { ...SAVED, days: SAVED.days.slice(0, 1) },
      { ...SAVED, at: "きのう" },
    ]) {
      document.body.replaceChildren();
      localStorage.setItem("kisekae-closet:forecast", JSON.stringify(saved));
      const el = await render();
      expect(el.querySelector('[data-testid="weather"]')).toBeNull();
      expect(el.textContent).toContain("天気を読んでいます…");
    }
  });

  test("AC-21-2: 天気の読み込みは、ログインの確かめ (/api/me) の答えを待たずに始まる", async () => {
    let signIn = () => {};
    const inner = vi.mocked(fetch).getMockImplementation() as typeof fetch;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === "/api/me") await new Promise<void>((r) => (signIn = r));
      return inner(url, init);
    });
    const el = await render();
    expect(el.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.startsWith("https://api.open-meteo.com/"))).toBe(true);
    await act(async () => signIn());
    await act(async () => {});
    // 先に始めた読み込みを使い回す (2 回読まない)
    expect(
      vi.mocked(fetch).mock.calls.filter(([u]) => String(u).startsWith("https://api.open-meteo.com/")),
    ).toHaveLength(1);
    expect(el.querySelector('[data-testid="weather"]')).not.toBeNull();
  });

  test("AC-21-2: 使ったことのない端末では、ログインの確かめが済むまで外へ通信しない。ログアウト・未ログインで前回の予報を消す", async () => {
    localStorage.clear();
    let wait = true;
    let signIn = () => {};
    const inner = vi.mocked(fetch).getMockImplementation() as typeof fetch;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === "/api/me" && wait) await new Promise<void>((r) => (signIn = r));
      return inner(url, init);
    });
    const el = await render();
    const meteo = () =>
      vi.mocked(fetch).mock.calls.filter(([u]) => String(u).startsWith("https://api.open-meteo.com/"));
    expect(meteo()).toHaveLength(0);
    await act(async () => signIn());
    await act(async () => {});
    expect(meteo()).toHaveLength(1);
    await act(async () => release(true));
    await act(async () => {});
    expect(localStorage.getItem("kisekae-closet:forecast")).not.toBeNull();
    await click(el.querySelector('nav[aria-label="画面"] button:nth-child(2)'));
    await click(button(el, "設定"));
    await click(button(el, "ログアウト"));
    expect(button(el, "はじめる")).toBeDefined();
    expect(localStorage.getItem("kisekae-closet:forecast")).toBeNull();

    // ログインしていない (セッション切れ) と分かったら消す
    wait = false;
    document.body.replaceChildren();
    localStorage.setItem("kisekae-closet:forecast", JSON.stringify(SAVED));
    routes.me = () => [401, { error: "ログインしていない" }];
    await render();
    expect(localStorage.getItem("kisekae-closet:forecast")).toBeNull();
  });

  test("AC-21-3: 前回の予報には読んだ時刻の一言が付き、新しい答えが来たら置きかわる。読めなければ前回のまま、そう添える", async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="weather-old"]')?.textContent).toBe(
      "7:05の予報 (新しい予報を読んでいます)",
    );
    await act(async () => release(true));
    await act(async () => {});
    expect(el.querySelector('[data-testid="weather"]')?.textContent).toBe("30℃ / 24℃・湿度 60%・雨 0mm");
    expect(el.querySelector('[data-testid="weather-old"]')).toBeNull();

    document.body.replaceChildren();
    localStorage.setItem("kisekae-closet:forecast", JSON.stringify(SAVED));
    const e = await render();
    // 自動の読み直し (#31) も全部読めない
    for (let i = 0; i < 3; i++) {
      await act(async () => release(false));
      await act(async () => {});
    }
    expect(e.querySelector('[data-testid="weather"]')?.textContent).toBe("18℃ / 10℃・湿度 55%・雨 1mm");
    expect(e.querySelector('[data-testid="weather-old"]')?.textContent).toBe(
      "7:05の予報 (新しい予報を読めませんでした)",
    );
    expect(e.querySelector('[data-testid="weather-failed"]')).toBeNull();
  });

  test("AC-21-3: 市を変えると、その市の前回の予報があればすぐ出す", async () => {
    localStorage.setItem("kisekae-closet:forecast", JSON.stringify({ ...SAVED, city: "osaka" }));
    const el = await render();
    expect(el.textContent).toContain("天気を読んでいます…");
    await change(el.querySelector('select[aria-label="市"]'), "osaka");
    expect(el.querySelector('[data-testid="weather"]')?.textContent).toBe("18℃ / 10℃・湿度 55%・雨 1mm");
  });

  test("AC-21-4: 端末に置く予報は市の ID・時刻・日ごとの数字だけ。DATA.md にキーが書いてある", async () => {
    localStorage.clear();
    const el = await render();
    await act(async () => release(true));
    await act(async () => {});
    expect(el.querySelector('[data-testid="weather"]')).not.toBeNull();
    const saved = JSON.parse(localStorage.getItem("kisekae-closet:forecast") ?? "null") as Record<
      string,
      unknown
    >;
    expect(Object.keys(saved).sort()).toEqual(["at", "city", "days"]);
    expect(saved.city).toBe("tokyo");
    expect(saved.days).toEqual([[DAY, { tempMax: 30, tempMin: 24, humidity: 60, precip: 0 }]]);
    const data = readFileSync("DATA.md", "utf8");
    expect(data).toContain("`kisekae-closet:forecast`");
  });
});

describe("カレンダー", () => {
  const d = DAY;
  const other = `${d.slice(0, 8)}${d.slice(8) === "01" ? "02" : "01"}`;
  const far = `${d.slice(0, 8)}${d.slice(8) === "03" ? "04" : "03"}`;
  beforeEach(() => {
    routes.outfits = (m) =>
      m === "POST"
        ? [201, { id: "o" }]
        : [
            200,
            {
              outfits: [
                {
                  id: "near",
                  wornOn: other,
                  tempMax: 29,
                  tempMin: 24,
                  humidity: 62,
                  precip: 0,
                  itemIds: ["d1", "s1"],
                },
                {
                  id: "far",
                  wornOn: far,
                  tempMax: 10,
                  tempMin: 2,
                  humidity: 40,
                  precip: 0,
                  itemIds: ["t2", "b1"],
                },
              ],
            },
          ];
  });

  test("AC-3-1: タブバーで今日・クローゼット・カレンダーを 1 タップで行き来できる", async () => {
    const el = await render();
    const nav = el.querySelector('nav[aria-label="画面"]') as HTMLElement;
    expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "今日",
      "クローゼット",
      "カレンダー",
    ]);
    for (const [t, region] of [
      ["カレンダー", "カレンダー"],
      ["クローゼット", "服をしまう"],
      ["今日", "今日"],
      ["カレンダー", "カレンダー"],
      ["今日", "今日"],
    ] as const) {
      await click([...nav.querySelectorAll("button")].find((b) => b.textContent === t));
      expect(el.querySelector(`section[aria-label="${region}"]`)).not.toBeNull();
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(t);
    }
  });

  test("AC-3-2: 決めた日のマスにスタンプと気温・湿度が出る", async () => {
    const el = await render();
    await click(button(el, "カレンダー"));
    const cell = el.querySelector(`[data-testid="day-${other}"]`) as HTMLElement;
    expect(cell.querySelector('[data-testid="day-stamp"]')).not.toBeNull();
    expect(cell.querySelector('[data-testid="mini"]')?.textContent).toBe("29°62%");
    expect(cell.getAttribute("aria-label")).toContain("決めた日");
    const todayCell = el.querySelector(`[data-testid="day-${d}"]`) as HTMLElement;
    expect(todayCell.querySelector('[data-testid="day-stamp"]')).toBeNull();
    expect(todayCell.querySelector('[data-testid="mini"]')?.textContent).toBe("30°60%");
  });

  test("AC-3-3: 今日と天気が近い日のマスは、凡例と同じ背景色になる", async () => {
    const el = await render();
    await click(button(el, "カレンダー"));
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/\.legend \.same::before,\s*\.day\.same \{/);
    expect(css).toMatch(/\.legend \.near::before,\s*\.day\.near \{/);
    const near = el.querySelector(`[data-testid="day-${other}"]`) as HTMLElement;
    expect(near.dataset.like).toBe("same");
    expect(near.classList.contains("same")).toBe(true);
    expect(el.querySelector(".legend .same")?.textContent).toBe("今日とほぼ同じ");
    expect((el.querySelector(`[data-testid="day-${far}"]`) as HTMLElement).dataset.like).toBe("far");
  });

  test("AC-3-4: 日を押すとその日のコーデが見え、「この日のコーデにする」で今日の画面に戻って着る", async () => {
    const el = await render();
    await click(button(el, "カレンダー"));
    await click(el.querySelector(`[data-testid="day-${other}"]`));
    const picked = el.querySelector('[data-testid="picked"]') as HTMLElement;
    expect(worn(picked)).toEqual(["スニーカー", "花柄"]);
    await click(button(el, "今日"));
    expect(worn(el)).toEqual(["白T", "デニム", "スニーカー"]); // 押しただけでは替わらない
    await click(button(el, "カレンダー"));
    await click(el.querySelector(`[data-testid="day-${other}"]`));
    await click(button(el, "この日のコーデにする"));
    expect(el.querySelector('section[aria-label="今日"]')).not.toBeNull();
    expect(worn(el)).toEqual(["スニーカー", "花柄"]);
  });

  test("決めていない日はそう出る。月を前後に動かせる", async () => {
    const el = await render();
    await click(button(el, "カレンダー"));
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    const empty = [...el.querySelectorAll('[data-testid^="day-20"]')].find(
      (b) => !b.querySelector('[data-testid="day-stamp"]') && b.getAttribute("data-testid") !== `day-${d}`,
    );
    await click(empty);
    expect(el.querySelector('[data-testid="picked"]')?.textContent).toContain("まだコーデを決めていません");
    await click(el.querySelector('[aria-label="次の月"]'));
    expect(el.querySelector(".month h2")?.textContent).toBe(m === 12 ? `${y + 1}年1月` : `${y}年${m + 1}月`);
    await click(el.querySelector('[aria-label="前の月"]'));
    await click(el.querySelector('[aria-label="前の月"]'));
    expect(el.querySelector(".month h2")?.textContent).toBe(m === 1 ? `${y - 1}年12月` : `${y}年${m - 1}月`);
  });
});

describe("先の日のコーデを決めておく (#7)", () => {
  const AHEAD = "2026-11-20"; // 3 日先
  const LAST = "2026-12-02"; // 15 日先 (予報の最後の日)
  const TOO_FAR = "2026-12-03"; // 16 日先
  let saved: Record<string, unknown>[];
  beforeEach(() => {
    // 16 日分の予報。3 日先だけ寒い
    const time = Array.from({ length: 16 }, (_, i) => {
      const t = new Date(Date.UTC(2026, 10, 17 + i));
      return t.toISOString().slice(0, 10);
    });
    weatherBody = {
      daily: {
        time,
        temperature_2m_max: time.map((t) => (t === AHEAD ? 8 : 30)),
        temperature_2m_min: time.map((t) => (t === AHEAD ? 2 : 24)),
        relative_humidity_2m_mean: time.map(() => 60),
        precipitation_sum: time.map((t) => (t === AHEAD ? 3 : 0)),
      },
    };
    saved = [];
    routes.outfits = (m, body) => {
      if (m === "POST") {
        saved.push({ id: `o${saved.length}`, ...(JSON.parse(body as string) as object) });
        return [201, { id: `o${saved.length - 1}` }];
      }
      return [200, { outfits: saved }];
    };
  });

  const openDay = async (el: HTMLElement, day: string) => {
    await click(button(el, "カレンダー"));
    if (day.slice(0, 7) !== DAY.slice(0, 7)) await click(el.querySelector('[aria-label="次の月"]'));
    await click(el.querySelector(`[data-testid="day-${day}"]`));
  };

  test("AC-7-1: カレンダーで先の日を押すと、その日の予報と、それに合うおすすめを着たアバターが出る", async () => {
    const el = await render();
    await click(button(el, "カレンダー"));
    const cell = el.querySelector(`[data-testid="day-${AHEAD}"]`) as HTMLElement;
    expect(cell.querySelector('[data-testid="mini"]')?.textContent).toBe("8°60%");
    await openDay(el, AHEAD);
    expect(worn(el.querySelector('[data-testid="picked"]') as HTMLElement)).toEqual([]); // 押しただけでは替わらない
    await click(button(el, "この日のコーデを決める"));
    expect(el.querySelector('section[aria-label="今日"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="plan-bar"]')?.textContent).toContain("11月20日");
    expect(el.querySelector('[data-testid="weather"]')?.textContent).toBe("8℃ / 2℃・湿度 60%・雨 3mm");
    expect(el.querySelector('svg[aria-label="雨"]')).not.toBeNull();
    // 寒い日のおすすめ (ニット・デニム・コート・スニーカー)。今日 (30℃) のおすすめとは違う
    expect(worn(el)).toEqual(expect.arrayContaining(["ニット", "コート"]));
    await click(button(el, "今日に戻る"));
    expect(el.querySelector('[data-testid="plan-bar"]')).toBeNull();
    expect(worn(el)).toEqual(["白T", "デニム", "スニーカー"]);
  });

  test("AC-7-1: 15 日先 (予報の最後の日) まで決めておける", async () => {
    const el = await render();
    await openDay(el, LAST);
    expect(button(el, "この日のコーデを決める")).toBeDefined();
  });

  test("AC-7-2: 着せ替えて決めると、その日の分として保存され、カレンダーに「決めておいた」印が付く", async () => {
    const el = await render();
    await openDay(el, AHEAD);
    await click(button(el, "この日のコーデを決める"));
    await click(el.querySelector('button[aria-label="白Tを着る"]'));
    await click(button(el, "これに決めた"));
    expect(el.querySelector('[data-testid="stamp"]')).not.toBeNull();
    expect(el.textContent).toContain("11月20日のコーデとしてカレンダーに載りました");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ wornOn: AHEAD, tempMax: 8, tempMin: 2, humidity: 60, precip: 3 });
    expect(saved[0]?.itemIds).toContain("t1");
    await click(button(el, "カレンダー"));
    const cell = el.querySelector(`[data-testid="day-${AHEAD}"]`) as HTMLElement;
    expect(cell.querySelector('[data-testid="day-plan"]')?.textContent).toBe("♡");
    expect(cell.querySelector('[data-testid="day-stamp"]')).toBeNull();
    expect(cell.getAttribute("aria-label")).toContain("決めておいた日");
    // 決めておいた日を押すと、そのコーデが見え、着せ替え直せる
    await click(cell);
    expect(worn(el.querySelector('[data-testid="picked"]') as HTMLElement)).toContain("白T");
    await click(button(el, "この日のコーデを着せ替える"));
    expect(el.querySelector('[data-testid="plan-bar"]')?.textContent).toContain("11月20日");
    expect(worn(el)).toContain("白T");
    expect(el.querySelector('[data-testid="stamp"]')).not.toBeNull();
  });

  test("AC-7-3: 今日の分を先に決めておいたら、今日の画面はおすすめより先にそれを出す", async () => {
    saved.push({
      id: "p",
      wornOn: DAY,
      tempMax: 20,
      tempMin: 10,
      humidity: 50,
      precip: 0,
      itemIds: ["d1", "s1"],
    });
    const el = await render();
    expect(el.querySelector('[data-testid="plan-bar"]')).toBeNull();
    expect(worn(el)).toEqual(["スニーカー", "花柄"]);
    expect(el.querySelector('[data-testid="stamp"]')).not.toBeNull();
  });

  test("AC-7-4: 送るのは日付・服・気温・湿度・降水量の数字だけ。16 日以上先は選べない", async () => {
    const el = await render();
    await openDay(el, AHEAD);
    await click(button(el, "この日のコーデを決める"));
    await click(button(el, "これに決めた"));
    const post = calls.find((c) => c.startsWith("POST outfits ")) as string;
    expect(Object.keys(JSON.parse(post.slice("POST outfits ".length)) as object).sort()).toEqual([
      "humidity",
      "itemIds",
      "precip",
      "tempMax",
      "tempMin",
      "wornOn",
    ]);
    expect(readFileSync("DATA.md", "utf8")).toContain("先の日");
    await click(button(el, "今日に戻る"));
    await openDay(el, TOO_FAR);
    expect(el.querySelector('[data-testid="too-far"]')?.textContent).toContain("15 日先まで");
    expect(button(el, "この日のコーデを決める")).toBeUndefined();
  });

  test("AC-7-5: 予報の読めない先の日は、天気の代わりにそう出し、決めるボタンを出さない", async () => {
    weatherBody = WEATHER; // 今日の分しかない
    const el = await render();
    await openDay(el, AHEAD);
    await click(button(el, "この日のコーデを決める"));
    expect(el.textContent).toContain("この日の予報がありません");
    expect(button(el, "これに決めた")).toBeUndefined();
  });
});

describe("テーマ (#8)", () => {
  test("AC-8-1: クローゼットの画面でテーマを選ぶと、全画面の色 (:root の変数) がすぐ変わる", async () => {
    const el = await render();
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("strawberry");
    await click(button(el, "クローゼット"));
    await click(button(el, "設定"));
    const group = el.querySelector('[aria-label="テーマの色"]') as HTMLElement;
    expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "いちごミルク",
      "ミントソーダ",
      "ラベンダー",
      "ミルクティー",
    ]);
    await click(button(el, "ミントソーダ"));
    expect(root.dataset.theme).toBe("mint");
    expect(root.style.getPropertyValue("--c-primary-strong")).toBe("#2b7a62");
    expect(button(el, "ミントソーダ")?.getAttribute("aria-pressed")).toBe("true");
    expect(button(el, "いちごミルク")?.getAttribute("aria-pressed")).toBe("false");
    // アバターの台の大きさはテーマで変えない
    expect(root.style.getPropertyValue("--stage-w")).toBe("");
  });

  test("AC-8-2: 再読み込みしても選んだテーマのまま (壊れた値なら既定)", async () => {
    localStorage.setItem("kisekae-closet:theme", JSON.stringify("lavender"));
    await render();
    expect(document.documentElement.dataset.theme).toBe("lavender");
    document.body.replaceChildren();
    localStorage.setItem("kisekae-closet:theme", JSON.stringify("<script>"));
    await render();
    expect(document.documentElement.dataset.theme).toBe("strawberry");
  });

  test("AC-8-4: DATA.md にテーマのキーが書かれている", () => {
    const data = readFileSync("DATA.md", "utf8");
    expect(data).toContain("`kisekae-closet:theme`");
  });
});

describe("アカウント", () => {
  test("途中でセッションが切れたら、ログインの前に戻る。ほかの失敗は理由を出す", async () => {
    routes.clothes = () => [401, { error: "ログインしていない" }];
    let el = await render();
    expect(button(el, "はじめる")).toBeDefined();
    document.body.replaceChildren();
    routes.clothes = () => [500, { error: "失敗した" }];
    el = await render();
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("失敗した");
  });

  test("ログアウトで戻る (失敗しても)", async () => {
    let el = await render();
    await click(await account(el, "ログアウト"));
    expect(calls).toContain("POST auth/logout");
    expect(button(el, "はじめる")).toBeDefined();
    document.body.replaceChildren();
    routes["auth/logout"] = () => [500, { error: "x" }];
    el = await render();
    await click(await account(el, "ログアウト"));
    expect(button(el, "はじめる")).toBeDefined();
  });

  test("アカウントを消す: 確かめてから消して戻る。やめれば消さない", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    let el = await render();
    await click(await account(el, "アカウントと全データを消す"));
    expect(calls).not.toContain("DELETE account");
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    await click(await account(el, "アカウントと全データを消す"));
    expect(calls).toContain("DELETE account");
    expect(button(el, "はじめる")).toBeDefined();
    document.body.replaceChildren();
    routes.account = () => [500, { error: "x" }];
    el = await render();
    await click(await account(el, "アカウントと全データを消す"));
    expect(button(el, "はじめる")).toBeDefined();
  });

  test("書き出しのリンクと、種類の名前と棚", async () => {
    const el = await render();
    expect(el.querySelector("a")).toBeNull(); // 今日の画面には出さない
    await click(button(el, "クローゼット"));
    expect(el.querySelector("a")).toBeNull(); // 設定を開くまで出さない
    await click(button(el, "設定"));
    expect(el.querySelector("a")?.getAttribute("href")).toBe("/api/export");
    expect(Object.keys(KIND_NAMES)).toEqual(["top", "bottom", "outer", "dress", "shoes", "accessory"]);
    expect(shelfOf("dress")).toBe("dress");
    expect(shelfOf("hat")).toBe("top");
  });
});

describe("天気の読み直し (#31)", () => {
  const meteo = () =>
    vi.mocked(fetch).mock.calls.filter(([u]) => String(u).startsWith("https://api.open-meteo.com/")).length;
  /** Open-Meteo が、はじめの n 回だけ読めない。 */
  const failFirst = (n: number) => {
    let left = n;
    const api = vi.mocked(fetch).getMockImplementation() as typeof fetch;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).startsWith("https://api.open-meteo.com/") && left-- > 0)
        return new Response("oops", { status: 503 });
      return api(url, init);
    });
  };

  test("AC-31-1: 最初の読み込みが 1 回失敗しても、自動で読み直して天気・おすすめ・『これに決めた』が出る", async () => {
    failFirst(1);
    const el = await render();
    await settle();
    expect(sl.sleep).toHaveBeenCalledWith(1000);
    expect(meteo()).toBe(2);
    expect(el.querySelector('[data-testid="weather"]')?.textContent).toBe("30℃ / 24℃・湿度 60%・雨 0mm");
    expect(el.querySelector('[data-testid="weather-failed"]')).toBeNull();
    expect(el.querySelectorAll('[data-testid="stage"] [data-testid="worn"]').length).toBeGreaterThan(0);
    expect(button(el, "これに決めた")).toBeDefined();
  });

  test("AC-31-1: 前回の予報がある端末で、開いた瞬間の読み込みが失敗しても読み直す", async () => {
    localStorage.setItem(
      "kisekae-closet:forecast",
      JSON.stringify({
        city: "tokyo",
        at: NOW.getTime() - 3600_000,
        days: [[DAY, { tempMax: 18, tempMin: 10, humidity: 55, precip: 1 }]],
      }),
    );
    failFirst(2);
    const el = await render();
    await settle();
    expect(meteo()).toBe(3);
    expect(el.querySelector('[data-testid="weather"]')?.textContent).toBe("30℃ / 24℃・湿度 60%・雨 0mm");
    expect(el.querySelector('[data-testid="weather-old"]')).toBeNull();
  });

  test("AC-31-2: 読み直しも失敗したら『もう一度読む』が出て、押すと読み直す", async () => {
    failFirst(3);
    const el = await render();
    await settle();
    expect(el.querySelector('[data-testid="weather-failed"]')?.textContent).toContain(
      "天気を読めませんでした",
    );
    expect(button(el, "これに決めた")).toBeUndefined();
    const again = button(el, "もう一度読む");
    expect(again).toBeDefined();
    await click(again);
    await settle();
    expect(meteo()).toBe(4);
    expect(el.querySelector('[data-testid="weather"]')?.textContent).toBe("30℃ / 24℃・湿度 60%・雨 0mm");
    expect(button(el, "もう一度読む")).toBeUndefined();
    expect(button(el, "これに決めた")).toBeDefined();
  });

  test("AC-31-2: 前回の予報を出したまま読めなかったときも『もう一度読む』が出る", async () => {
    localStorage.setItem(
      "kisekae-closet:forecast",
      JSON.stringify({
        city: "tokyo",
        at: NOW.getTime() - 3600_000,
        days: [[DAY, { tempMax: 18, tempMin: 10, humidity: 55, precip: 1 }]],
      }),
    );
    failFirst(3);
    const el = await render();
    await settle();
    expect(el.querySelector('[data-testid="weather-old"]')?.textContent).toContain(
      "新しい予報を読めませんでした",
    );
    await click(button(el, "もう一度読む"));
    await settle();
    expect(el.querySelector('[data-testid="weather-old"]')).toBeNull();
    expect(el.querySelector('[data-testid="weather"]')?.textContent).toBe("30℃ / 24℃・湿度 60%・雨 0mm");
  });

  test("AC-31-3: 自動の読み直しには上限がある (読めなくても 3 回で止まり、待つ間は 1 秒・3 秒)", async () => {
    failFirst(1_000);
    const el = await render();
    await settle();
    await settle();
    expect(meteo()).toBe(3);
    expect(sl.sleep.mock.calls).toEqual([[1000], [3000]]);
    // 押すたびに、また上限まで (押さなければ通信しない)
    await click(button(el, "もう一度読む"));
    await settle();
    await settle();
    expect(meteo()).toBe(6);
  });
});

describe("ワンピースの居場所 (#35)", () => {
  test("AC-35-1: ワンピースを登録すると、その名前の入ったタブで見つけられる (今日の画面とクローゼットの両方)", async () => {
    const el = await render();
    const names = () => [...el.querySelectorAll('[data-testid="garment"]')].map((b) => b.textContent);
    expect(tab(el, "ワンピース")).toBeDefined();
    expect(names()).not.toContain("花柄");
    await click(tab(el, "ワンピース"));
    expect(names()).toEqual(["花柄"]);
    await click(button(el, "クローゼット"));
    await click(tab(el, "ワンピース"));
    expect(el.querySelector('[data-testid="shelf"]')?.getAttribute("data-shelf")).toBe("dress");
    expect(el.querySelector('[data-testid="shelf"]')?.textContent).toContain("花柄");
  });
});

describe("開いた瞬間の絵 (#28)", () => {
  test("AC-28-1 AC-28-2: 服の一覧が届くまで、ゲージは寒いを示さず、アバターは下着だけの姿で出ない", async () => {
    let release = () => {};
    const gate = new Promise<void>((ok) => {
      release = ok;
    });
    const inner = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (url === "/api/clothes" && (init?.method ?? "GET") === "GET") await gate;
        return inner(url, init);
      }),
    );
    const el = await render();
    const g = el.querySelector('[data-testid="gauge"]') as HTMLElement;
    expect(g.dataset.band).toBe("loading");
    expect(el.querySelector('[data-testid="gauge-thumb"]')).toBeNull();
    expect(g.textContent).toContain("服を読んでいます");
    const stage = el.querySelector('[data-testid="stage"]') as HTMLElement;
    expect(stage.querySelector('[data-testid="wear-pending"]')).not.toBeNull();
    expect(stage.getAttribute("aria-busy")).toBe("true");
    expect(el.textContent).not.toContain("まだ服がありません");
    expect(button(el, "これに決めた")).toBeUndefined();
    await act(async () => release());
    await act(async () => {});
    expect((el.querySelector('[data-testid="gauge"]') as HTMLElement).dataset.band).toBe("ok");
    expect(stage.querySelector('[data-testid="wear-pending"]')).toBeNull();
    expect(worn(el)).toEqual(["白T", "デニム", "スニーカー"]);
  });

  test("服の一覧が読めなくても、読み込み中のままにしない", async () => {
    routes.clothes = () => [500, { error: "x" }];
    const el = await render();
    expect(el.querySelector('[data-testid="wear-pending"]')).toBeNull();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe("細かい見た目と後始末 (#29)", () => {
  test("AC-29-1: カレンダーで選んだ日は枠で示し、背景を凡例の色 (ピンク) にしない", () => {
    const css = readFileSync("src/style.css", "utf8");
    const rule = /\.day\[aria-pressed="true"\] \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("background: transparent");
    expect(rule).toContain("box-shadow: inset 0 0 0 2px");
    expect(rule).not.toMatch(/--c-(primary-soft|same|near)/);
    // 似た天気の日を選んでも、その日の背景 (凡例の色) は変えない
    expect(css).toMatch(/\.day\.same\[aria-pressed="true"\] \{\s*background: var\(--c-same\);/);
    expect(css).toMatch(/\.day\.near\[aria-pressed="true"\] \{\s*background: var\(--c-near\);/);
  });

  test("AC-29-2: 天気の行は、気温・湿度・雨のまとまりの途中で折り返さない", async () => {
    const el = await render();
    const w = el.querySelector('[data-testid="weather"]') as HTMLElement;
    expect([...w.querySelectorAll(".nb")].map((s) => s.textContent)).toEqual([
      "30℃ / 24℃",
      "湿度 60%",
      "雨 0mm",
    ]);
    expect(/\.nb \{([^}]*)\}/.exec(readFileSync("src/style.css", "utf8"))?.[1]).toContain(
      "white-space: nowrap",
    );
  });

  test("AC-29-3: アカウントと全データを消すと、端末のこのアプリのキー (市・テーマ・前回の予報) も残らない", async () => {
    vi.stubGlobal("confirm", () => true);
    localStorage.setItem("kisekae-closet:theme", JSON.stringify("mint"));
    localStorage.setItem("other-app", "1");
    const el = await render();
    await click(button(el, "クローゼット"));
    expect(Object.keys(localStorage).filter((k) => k.startsWith("kisekae-closet:"))).toContain(
      "kisekae-closet:city",
    );
    await click(button(el, "設定"));
    await click(button(el, "アカウントと全データを消す"));
    expect(calls).toContain("DELETE account");
    expect(Object.keys(localStorage).filter((k) => k.startsWith("kisekae-closet:"))).toEqual([]);
    expect(localStorage.getItem("other-app")).toBe("1");
  });
});
