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

// 持ち主の #49「暖かさが分かりづらい。普通のスマホ幅で暖かさのところが折り返されている」。
// ゲージに「いまの服でどうすればいいか」の一言を足し、帯の言葉はスマホの幅で折り返さない。
import { readFileSync } from "node:fs";
import { advice, type Band } from "../../../src/outfit";

const css = readFileSync("src/style.css", "utf8");
const rule = (sel: string) =>
  new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";

test("AC-1: 帯ごとの一言: 寒いなら重ねる、暑いなら減らす、ちょうどいいならそのまま", () => {
  expect(advice("cold")).toContain("重ね");
  expect(advice("hot")).toMatch(/減ら|脱/);
  expect(advice("ok")).toContain("ちょうどいい");
  for (const b of ["cold", "ok", "hot"] as const) expect(advice(b).length).toBeLessThanOrEqual(20);
});

test("AC-2: 今日の画面のゲージに、いまの帯の一言が出る。着せ替えると一言も変わる", async () => {
  const el = await render();
  const g = () => el.querySelector('[data-testid="gauge"]') as HTMLElement;
  expect(g()).toBeTruthy();
  const say = () => g().querySelector('[data-testid="gauge-advice"]')?.textContent;
  expect(say()).toBe(advice(g().dataset.band as Band));
  // 棚の服を全部脱がせると (着ているものを押す)、寒い側の一言になる
  for (const b of [...el.querySelectorAll<HTMLButtonElement>('[data-testid="garment"][aria-pressed="true"]')])
    await click(b);
  for (const shelf of [
    ...el.querySelectorAll<HTMLButtonElement>('section[aria-label="クローゼット"] [role="tab"]'),
  ]) {
    await click(shelf);
    for (const b of [
      ...el.querySelectorAll<HTMLButtonElement>('[data-testid="garment"][aria-pressed="true"]'),
    ])
      await click(b);
  }
  expect(g().dataset.band).toBe("cold");
  expect(say()).toBe(advice("cold"));
});

test("AC-3: 帯の言葉 (寒い・ちょうどいい・暑い) と「暖かさ: ○○」は、スマホの幅でも折り返さない", () => {
  expect(rule(".gauge-words")).toContain("white-space: nowrap");
  expect(rule(".gauge-word")).toContain("white-space: nowrap");
});
