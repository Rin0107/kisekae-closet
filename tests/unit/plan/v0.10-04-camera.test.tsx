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

// 持ち主の #49「写真撮るのがよくわからない。スマホ向きな UI じゃない。Choose File とかになってて全然ピンとこない」。
// ブラウザのファイルの欄は隠し、「カメラで撮る」「写真から選ぶ」の大きなボタン (label) で選ぶ。
import { readFileSync } from "node:fs";

const sh = vi.hoisted(() => ({ shrinkPhoto: vi.fn() }));
vi.mock("../../../src/shrink", () => sh);

const css = readFileSync("src/style.css", "utf8");
const rule = (sel: string) =>
  new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";

async function closet(): Promise<HTMLElement> {
  const el = await render();
  await screen(el, "クローゼット");
  const kinds = el.querySelector('[role="group"][aria-label="種類"]') as HTMLElement;
  await click(buttons(kinds).find((b) => b.textContent?.includes("トップス")));
  return el;
}

test("AC-1: 写真は「カメラで撮る」と「写真から選ぶ」の 2 つのボタンで選ぶ。ブラウザのファイルの欄は見せない", async () => {
  const el = await closet();
  const inputs = [...el.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  expect(inputs).toHaveLength(2);
  const cam = inputs.find((i) => i.getAttribute("capture") === "environment");
  const lib = inputs.find((i) => !i.hasAttribute("capture"));
  expect(cam).toBeDefined();
  expect(lib).toBeDefined();
  for (const i of inputs) {
    expect(i.getAttribute("accept")).toBe("image/*");
    expect(i.classList.contains("visually-hidden")).toBe(true);
    expect(i.closest("label")?.classList.contains("photo-button")).toBe(true);
  }
  expect(cam?.closest("label")?.textContent?.trim()).toBe("カメラで撮る");
  expect(lib?.closest("label")?.textContent?.trim()).toBe("写真から選ぶ");
  expect(el.textContent).not.toContain("写真を撮る・選ぶ");
});

test("AC-2: 隠した欄は画面に出ないが、読み上げとタップは届く。ボタンは押しやすい大きさ (48px 以上)", () => {
  const hidden = rule(".visually-hidden");
  expect(hidden).toContain("position: absolute");
  expect(hidden).toContain("width: 1px");
  expect(hidden).toContain("height: 1px");
  expect(hidden).toContain("overflow: hidden");
  expect(hidden).not.toContain("display: none");
  const btn = rule(".photo-button");
  expect(btn).toContain("min-height: var(--tap)");
  expect(btn).toMatch(/display: (inline-)?flex/);
});

test("AC-3: どちらのボタンで選んでも、選んだ写真が枠に出て、しまえる", async () => {
  sh.shrinkPhoto.mockResolvedValue("AAAA");
  for (const capture of [true, false]) {
    document.body.replaceChildren();
    const el = await closet();
    const input = [...el.querySelectorAll<HTMLInputElement>('input[type="file"]')].find(
      (i) => i.hasAttribute("capture") === capture,
    );
    const f = new File(["x"], "a.jpg", { type: "image/jpeg" });
    await pickFile(input ?? null, [f]);
    // 着せ替え v2 (#81): 選んだ写真は型紙合わせの欄に出る
    expect(el.querySelector('[data-testid="fit-editor"]'), `${capture}`).not.toBeNull();
    await click(button(el, "クローゼットにしまう"));
    expect(sh.shrinkPhoto).toHaveBeenLastCalledWith(f);
  }
});
