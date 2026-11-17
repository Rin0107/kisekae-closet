// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const pk = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn() }));
vi.mock("../../src/passkey", () => pk);
const sh = vi.hoisted(() => ({ shrinkPhoto: vi.fn() }));
vi.mock("../../src/shrink", () => sh);

import { App, KIND_NAMES, today } from "../../src/App";

type Handler = (method: string, body: unknown) => [number, unknown];
let routes: Record<string, Handler>;
let calls: string[];

const WEATHER = {
  daily: {
    temperature_2m_max: [30],
    temperature_2m_min: [24],
    relative_humidity_2m_mean: [60],
    precipitation_sum: [0],
  },
};
const CLOTHES = [
  { id: "t1", kind: "top", warmth: 1, label: "白T", createdAt: 1 },
  { id: "b1", kind: "bottom", warmth: 1, label: "デニム", createdAt: 2 },
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
  calls = [];
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
      if (url.startsWith("https://api.open-meteo.com/")) return new Response(JSON.stringify(WEATHER));
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

describe("ログインのあと", () => {
  test("天気・おすすめ・似た日・クローゼットを出す", async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="weather"]')?.textContent).toBe("30℃ / 24℃・湿度 60%・雨 0mm");
    const recs = [...el.querySelectorAll('section[aria-label="今日"] ul')][0]?.textContent;
    expect(recs).toContain("トップス 白T");
    expect(recs).toContain("ボトムス デニム");
    expect(el.textContent).toContain("2025-08-01 (30℃): 白T・");
    expect(el.textContent).toContain("クローゼット (2)");
    expect(el.querySelector("img")?.getAttribute("src")).toBe("/api/clothes/t1/photo");
  });

  test("「これを着た」で今日のコーデを天気と一緒に記録する", async () => {
    const el = await render();
    await click(button(el, "これを着た"));
    const post = calls.find((c) => c.startsWith("POST outfits"));
    expect(JSON.parse(post?.slice("POST outfits ".length) ?? "{}")).toEqual({
      wornOn: today(),
      itemIds: ["t1", "b1"],
      tempMax: 30,
      tempMin: 24,
      humidity: 60,
      precip: 0,
    });
  });

  test("市を変えると端末に覚え、天気を読み直す。天気が読めなければ出さない", async () => {
    const el = await render();
    vi.mocked(fetch).mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await change(el.querySelector('select[aria-label="市"]'), "osaka");
    expect(localStorage.getItem("kisekae-closet:city")).toBe('"osaka"');
    expect(el.querySelector('[data-testid="weather"]')).toBeNull();
    expect(button(el, "これを着た")).toBeUndefined();
  });

  test("服がそろっていなければ、おすすめと「これを着た」はない", async () => {
    routes.clothes = () => [200, { clothes: [CLOTHES[0]] }];
    const el = await render();
    expect(button(el, "これを着た")).toBeUndefined();
  });

  test("服を足す: 写真を縮めて送る。写真がない・縮められなければ理由を出す", async () => {
    const el = await render();
    await click(button(el, "服を足す"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("写真を選ぶ");
    const file = el.querySelector('input[type="file"]') as HTMLInputElement;
    const f = new File(["x"], "a.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "files", { value: [f], configurable: true });
    await act(async () => file.dispatchEvent(new Event("change", { bubbles: true })));
    sh.shrinkPhoto.mockResolvedValue(null);
    await click(button(el, "服を足す"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("写真を小さくできない");
    sh.shrinkPhoto.mockResolvedValue("AAAA");
    await change(el.querySelector('select[aria-label="種類"]'), "outer");
    await change(el.querySelector('select[aria-label="暖かさ"]'), "4");
    await change(el.querySelector('input[aria-label="名前"]'), "コート");
    await click(button(el, "服を足す"));
    expect(sh.shrinkPhoto).toHaveBeenLastCalledWith(f);
    const post = calls.find((c) => c.startsWith("POST clothes"));
    expect(JSON.parse(post?.slice("POST clothes ".length) ?? "{}")).toEqual({
      kind: "outer",
      warmth: 4,
      label: "コート",
      photo: "AAAA",
    });
    expect((el.querySelector('input[aria-label="名前"]') as HTMLInputElement).value).toBe("");
    Object.defineProperty(file, "files", { value: null, configurable: true });
    await act(async () => file.dispatchEvent(new Event("change", { bubbles: true })));
    await click(button(el, "服を足す"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("写真を選ぶ");
  });

  test("服を足すのに失敗すれば理由を出す", async () => {
    routes.clothes = (m) => (m === "POST" ? [400, { error: "服の形が違う" }] : [200, { clothes: CLOTHES }]);
    sh.shrinkPhoto.mockResolvedValue("AAAA");
    const el = await render();
    const file = el.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(file, "files", { value: [new File(["x"], "a.jpg")], configurable: true });
    await act(async () => file.dispatchEvent(new Event("change", { bubbles: true })));
    await click(button(el, "服を足す"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("服の形が違う");
  });

  test("服を消す (失敗すれば理由)", async () => {
    const el = await render();
    await click(el.querySelector('section[aria-label="クローゼット"] li button'));
    expect(calls).toContain("DELETE clothes/t1");
    routes["clothes/t1"] = () => [404, { error: "見つからない" }];
    await click(el.querySelector('section[aria-label="クローゼット"] li button'));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("見つからない");
  });

  test("コーデの記録に失敗すれば理由を出す", async () => {
    routes.outfits = (m) => (m === "POST" ? [400, { error: "知らない服がある" }] : [200, { outfits: [] }]);
    const el = await render();
    await click(button(el, "これを着た"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("知らない服がある");
  });

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
    await click(button(el, "ログアウト"));
    expect(calls).toContain("POST auth/logout");
    expect(button(el, "はじめる")).toBeDefined();
    document.body.replaceChildren();
    routes["auth/logout"] = () => [500, { error: "x" }];
    el = await render();
    await click(button(el, "ログアウト"));
    expect(button(el, "はじめる")).toBeDefined();
  });

  test("アカウントを消す: 確かめてから消して戻る。やめれば消さない", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    let el = await render();
    await click(button(el, "アカウントと全データを消す"));
    expect(calls).not.toContain("DELETE account");
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    await click(button(el, "アカウントと全データを消す"));
    expect(calls).toContain("DELETE account");
    expect(button(el, "はじめる")).toBeDefined();
    document.body.replaceChildren();
    routes.account = () => [500, { error: "x" }];
    el = await render();
    await click(button(el, "アカウントと全データを消す"));
    expect(button(el, "はじめる")).toBeDefined();
  });

  test("書き出しのリンクと、種類の名前", async () => {
    const el = await render();
    expect(el.querySelector("a")?.getAttribute("href")).toBe("/api/export");
    expect(Object.keys(KIND_NAMES)).toEqual(["top", "bottom", "outer", "dress", "shoes", "accessory"]);
  });
});
