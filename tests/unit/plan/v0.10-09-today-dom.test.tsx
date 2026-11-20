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

// 持ち主の #50「服を選ぶためには下にスクロールが必要で、スクロールするとアバターが見えない。常にどちらも見えるように。
// 例えばアバターの位置を左寄せにして、空いたところに服選びの UI を置くとか」。
// 今日の画面の並び: 台 (左) と服の棚 (右) を隣どうしに、ラベル・ゲージ・決めるボタンはその下。
test("AC-1: 今日の画面では、アバターの台のすぐ隣 (次の子) に服の棚を置く", async () => {
  const el = await render();
  const dresser = el.querySelector(".dresser") as HTMLElement;
  expect(dresser).toBeTruthy();
  const kids = [...dresser.children];
  expect(kids[0]?.classList.contains("stage-wrap")).toBe(true);
  expect(kids[1]?.matches('section[aria-label="クローゼット"]')).toBe(true);
  expect(dresser.querySelector('.dresser-side section[aria-label="クローゼット"]')).toBeNull();
});

test("AC-2: ラベル・暖かさゲージ・「これに決めた」は台と棚の下 (.dresser-side) に並ぶ", async () => {
  const el = await render();
  const side = el.querySelector(".dresser > .dresser-side") as HTMLElement;
  expect(side).toBeTruthy();
  expect(side.querySelector('[data-testid="labels"]')).not.toBeNull();
  expect(side.querySelector('[data-testid="gauge"]')).not.toBeNull();
  const kids = [...(el.querySelector(".dresser") as HTMLElement).children];
  expect(kids.indexOf(side)).toBeGreaterThan(1);
});

test("AC-3: 並びを変えても、棚の服を押すと着る・もう一度押すと脱ぐ", async () => {
  const el = await render();
  const rack = el.querySelector(
    '.dresser > section[aria-label="クローゼット"] [data-testid="rack"]',
  ) as HTMLElement;
  expect(rack).toBeTruthy();
  const g = rack.querySelector<HTMLButtonElement>('[data-testid="garment"]') as HTMLButtonElement;
  const before = g.getAttribute("aria-pressed");
  await click(g);
  expect(g.getAttribute("aria-pressed")).toBe(before === "true" ? "false" : "true");
  await click(g);
  expect(g.getAttribute("aria-pressed")).toBe(before);
});
