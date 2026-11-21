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

// 持ち主の #49「登録が難しい」。写真を選ぶ前は押せないようにし、しまえたら何が起きたかを知らせる。
const sh = vi.hoisted(() => ({ shrinkPhoto: vi.fn() }));
vi.mock("../../../src/shrink", () => sh);

async function closet(): Promise<HTMLElement> {
  const el = await render();
  await screen(el, "クローゼット");
  const kinds = el.querySelector('[role="group"][aria-label="種類"]') as HTMLElement;
  await click(buttons(kinds).find((b) => b.textContent?.includes("トップス")));
  return el;
}

test("AC-1: 写真を選ぶまで「クローゼットにしまう」は押せない。選ぶと押せる", async () => {
  const el = await closet();
  const put = () => button(el, "クローゼットにしまう") as HTMLButtonElement;
  expect(put().disabled).toBe(true);
  await pickFile(el.querySelector('input[type="file"]'), [new File(["x"], "a.jpg", { type: "image/jpeg" })]);
  expect(put().disabled).toBe(false);
});

test("AC-2: しまうと「トップスにしまいました」と知らせ (role=status)、トップスの棚にいま撮った服が並ぶ", async () => {
  sh.shrinkPhoto.mockResolvedValue("AAAA");
  let added = false;
  routes.clothes = (m) => {
    if (m === "POST") {
      added = true;
      return [201, { id: "n1" }];
    }
    const extra = added ? [{ id: "n1", kind: "top", warmth: 3, label: "新しいシャツ", createdAt: 9 }] : [];
    return [200, { clothes: [...CLOTHES, ...extra] }];
  };
  const el = await closet();
  await pickFile(el.querySelector('input[type="file"]'), [new File(["x"], "a.jpg", { type: "image/jpeg" })]);
  const label = el.querySelector('input[aria-label="ラベル"]');
  expect(label).not.toBeNull();
  await click(button(el, "クローゼットにしまう"));
  const status = [...el.querySelectorAll('[role="status"]')].map((s) => s.textContent).join(" ");
  expect(status).toContain("トップスにしまいました");
  const shelf = el.querySelector('[data-testid="shelf"]') as HTMLElement;
  expect(shelf.getAttribute("data-shelf")).toBe("top");
  expect(shelf.textContent).toContain("新しいシャツ");
  // 選んだ写真は空に戻る (次の 1 枚を撮れる)
  expect((button(el, "クローゼットにしまう") as HTMLButtonElement).disabled).toBe(true);
});
