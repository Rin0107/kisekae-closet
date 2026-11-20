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

// 持ち主の #49「最初から、トップスが選ばれている状態にして。最初にクローゼットにきたとき、ぱっと見でなにをすればいいかわからない」。
const sh = vi.hoisted(() => ({ shrinkPhoto: vi.fn() }));
vi.mock("../../../src/shrink", () => sh);

const kinds = (el: HTMLElement) => el.querySelector('[role="group"][aria-label="種類"]') as HTMLElement;
const pressed = (el: HTMLElement) =>
  buttons(kinds(el))
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent?.trim());

test("AC-1: クローゼットを開くと、しまう服の種類はトップスが選ばれていて、枠と写真のボタンがすぐ出ている", async () => {
  const el = await render();
  await screen(el, "クローゼット");
  expect(kinds(el)).toBeTruthy();
  expect(pressed(el)).toEqual(["トップス"]);
  expect(el.querySelector('[data-testid="frame"]')?.getAttribute("data-kind")).toBe("top");
  expect(el.querySelector('input[type="file"]')).not.toBeNull();
  expect(el.textContent).not.toContain("まず、しまう服の種類を選んでください");
});

test("AC-2: しまったあとも種類はそのまま (続けて同じ種類の 2 枚目を撮れる)", async () => {
  sh.shrinkPhoto.mockResolvedValue("AAAA");
  const el = await render();
  await screen(el, "クローゼット");
  await click(buttons(kinds(el)).find((b) => b.textContent?.includes("アウター")));
  await pickFile(el.querySelector('input[type="file"]'), [new File(["x"], "a.jpg", { type: "image/jpeg" })]);
  await click(button(el, "クローゼットにしまう"));
  expect(sh.shrinkPhoto).toHaveBeenCalled();
  expect(pressed(el)).toEqual(["アウター"]);
  expect(el.querySelector('[data-testid="frame"]')?.getAttribute("data-kind")).toBe("outer");
});
