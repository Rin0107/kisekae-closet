// @vitest-environment happy-dom
// 計画 v0.10 の受け入れテスト (wk が sha256 で固定する。変えない)
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const pk = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn() }));
vi.mock("../../../src/passkey", () => pk);
const sl = vi.hoisted(() => ({ sleep: vi.fn() }));
vi.mock("../../../src/sleep", () => sl);

import { App } from "../../../src/App";

type Handler = (method: string, body: unknown) => [number, unknown];
let routes: Record<string, Handler>;
let weatherOk = true;

const DAY = "2026-11-17";
const WEATHER = {
  daily: {
    time: [DAY],
    temperature_2m_max: [12],
    temperature_2m_min: [5],
    relative_humidity_2m_mean: [60],
    precipitation_sum: [0],
  },
};
const CLOTHES = [
  { id: "t1", kind: "top", warmth: 2, label: "白T", createdAt: 1 },
  { id: "b1", kind: "bottom", warmth: 2, label: "デニム", createdAt: 2 },
  { id: "o1", kind: "outer", warmth: 4, label: "コート", createdAt: 3 },
  { id: "s1", kind: "shoes", warmth: 1, label: "スニーカー", createdAt: 4 },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 17, 9, 0, 0));
  weatherOk = true;
  routes = {
    me: () => [200, { signedIn: true }],
    clothes: (m) => (m === "POST" ? [201, { id: "n" }] : [200, { clothes: CLOTHES }]),
    outfits: (m) => (m === "POST" ? [201, { id: "o" }] : [200, { outfits: [] }]),
    "auth/logout": () => [200, { ok: true }],
    account: () => [200, { ok: true }],
    "clothes/t1": () => [200, { ok: true }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url.startsWith("https://api.open-meteo.com/"))
        return weatherOk ? new Response(JSON.stringify(WEATHER)) : new Response("", { status: 503 });
      const path = url.replace("/api/", "");
      const h = routes[path];
      const [status, body] = h ? h(init?.method ?? "GET", init?.body) : [404, { error: "見つからない" }];
      return new Response(JSON.stringify(body), { status });
    }),
  );
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }),
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
  for (let i = 0; i < 6; i++) await act(async () => {});
  return el;
}
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => {});
};
const click = async (el: Element | null | undefined) => {
  expect(el, "押すもの").toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await settle();
};
const buttons = (root: Element) => [...root.querySelectorAll("button")];
const button = (root: Element, text: string) => buttons(root).find((b) => b.textContent?.trim() === text);
const screen = async (el: HTMLElement, name: string) =>
  click(buttons(el.querySelector('nav[aria-label="画面"]') as Element).find((b) => b.textContent === name));
const pickFile = async (input: Element | null, files: File[]) => {
  expect(input, "ファイルの欄").toBeTruthy();
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => (input as HTMLInputElement).dispatchEvent(new Event("change", { bubbles: true })));
  await settle();
};
void [render, screen, click, settle, button, pickFile, test];

// 評価 9:「天気が読めないと、おすすめは何も着せない (手で着せれば決められる)」。
// 天気が読めず前回の予報もないときは、その月のふだんの天気 (東京の平年に近い値) でおすすめを着せ、そう一言添える。
import { normalWeather } from "../../../src/weather";

const avg = (m: number) => {
  const w = normalWeather(m);
  return (w.tempMax + w.tempMin) / 2;
};

test("AC-1: 1〜12 月のふだんの天気がある。冬は寒く夏は暑い。雨は決めつけない (0mm)", () => {
  for (let m = 1; m <= 12; m++) {
    const w = normalWeather(m);
    expect(w.tempMax, `${m}`).toBeGreaterThan(w.tempMin);
    expect(w.humidity, `${m}`).toBeGreaterThanOrEqual(30);
    expect(w.humidity, `${m}`).toBeLessThanOrEqual(90);
    expect(w.precip, `${m}`).toBe(0);
  }
  expect(avg(1)).toBeLessThan(avg(4));
  expect(avg(4)).toBeLessThan(avg(8));
  expect(avg(11)).toBeLessThan(avg(9));
  expect(avg(1)).toBeLessThan(10);
  expect(avg(8)).toBeGreaterThan(24);
});

test("AC-2: 天気が読めず前回の予報もないときも、ふだんの天気でおすすめを着せ、そのことを一言で出す。決めることもできる", async () => {
  weatherOk = false;
  const el = await render();
  await settle();
  await settle();
  expect(el.querySelector('[data-testid="weather-failed"]')).not.toBeNull();
  const worn = el.querySelectorAll('[data-testid="stage"] [data-testid="worn"]');
  expect(worn.length).toBeGreaterThan(0);
  expect(el.querySelector('[data-testid="weather-normal"]')?.textContent).toContain("ふだん");
  expect(button(el, "これに決めた")).toBeDefined();
});

test("AC-3: 天気が読めたときは、ふだんの天気の一言は出ない", async () => {
  const el = await render();
  await settle();
  expect(el.querySelector('[data-testid="weather"]')).not.toBeNull();
  expect(el.querySelector('[data-testid="weather-normal"]')).toBeNull();
});
