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

// 持ち主の #50「クローゼットのところにテーマとかログアウトがあるのがわかりづらい。クローゼットの一番の目的である
// 服をしまう・服を確認するが一番メインで、ユーザーがアクションすればクローゼットの中からユーザー設定にアクセスできる」。
const settingsButton = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
    (b) => b.textContent?.trim() === "設定",
  );

test("AC-1: クローゼットの画面では、テーマ・ログアウト・書き出し・アカウントを消すは「設定」を開くまで出ない", async () => {
  const el = await render();
  await screen(el, "クローゼット");
  expect(el.querySelector('section[aria-label="テーマ"]')).toBeNull();
  expect(button(el, "ログアウト")).toBeUndefined();
  expect(button(el, "アカウントと全データを消す")).toBeUndefined();
  expect(el.textContent).not.toContain("データを書き出す");
  const gear = settingsButton(el);
  expect(gear?.getAttribute("aria-expanded")).toBe("false");
  await click(gear);
  expect(gear?.getAttribute("aria-expanded")).toBe("true");
  const panel = document.getElementById(gear?.getAttribute("aria-controls") ?? "");
  expect(panel).not.toBeNull();
  expect(panel?.querySelector('section[aria-label="テーマ"]')).not.toBeNull();
  expect(button(panel as HTMLElement, "ログアウト")).toBeDefined();
  expect(panel?.textContent).toContain("データを書き出す");
  await click(gear);
  expect(el.querySelector('section[aria-label="テーマ"]')).toBeNull();
});

test("AC-2: 服をしまう欄と服の棚が先 (上)、設定の入口はその後ろ (下)", async () => {
  const el = await render();
  await screen(el, "クローゼット");
  const put = el.querySelector('section[aria-label="服をしまう"]');
  const shelf = el.querySelector('[data-testid="shelf"]');
  const gear = settingsButton(el);
  expect(put).not.toBeNull();
  expect(shelf).not.toBeNull();
  expect(gear).toBeDefined();
  const after = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(after(put as Node, gear as Node)).toBe(true);
  expect(after(shelf as Node, gear as Node)).toBe(true);
});

test("AC-3: 今日・カレンダーの画面には設定を出さない", async () => {
  const el = await render();
  expect(settingsButton(el)).toBeUndefined();
  await screen(el, "カレンダー");
  expect(settingsButton(el)).toBeUndefined();
});
