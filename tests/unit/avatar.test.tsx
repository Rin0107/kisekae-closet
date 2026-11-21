// @vitest-environment happy-dom
// アバターの台 (着せ替え v2: マネキンが服に合わせる、docs/spec-v2-fitting.md)。
// 古い版の受け入れ条件 (#22 #26 #32 #33 #37 #38 #39 #44 #47) は、v2 で置きかえた決まりで確かめる。
import { existsSync, readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Clothing } from "../../src/client";
import type { Cut } from "../../src/cutout";

const cuts = vi.hoisted(() => new Map<string, Cut>());
vi.mock("../../src/cutout", async (orig) => ({
  ...(await orig<typeof import("../../src/cutout")>()),
  cutoutInfo: async (src: string): Promise<Cut> =>
    cuts.get(src) ?? { url: src, ok: true, full: null, box: null, mask: null },
}));

import { pieceOf, Stage } from "../../src/Avatar";
import { body, DEFAULT_FIT, NO_POSE } from "../../src/fit";

afterEach(() => {
  document.body.replaceChildren();
  cuts.clear();
});

const item = (kind: string, over: Partial<Clothing> = {}): Clothing => ({
  id: kind,
  kind,
  warmth: 2,
  label: kind,
  createdAt: 1,
  ...over,
});

async function show(
  worn: Clothing[],
  props: Partial<Parameters<typeof Stage>[0]> = {},
): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<Stage worn={worn} {...props} />));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return el;
}

/** SVG の matrix(a b c d e f) を数に。 */
const mat = (el: Element | null) =>
  (/matrix\(([^)]*)\)/.exec(el?.getAttribute("transform") ?? "")?.[1] ?? "").split(" ").map(Number);

describe("マネキン (#82)", () => {
  test("AC-82-1 AC-22-1 AC-22-4: 顔・髪のないマネキンを repo の中の SVG で描く (外の絵・人の写真を読まない)", async () => {
    const el = await show([]);
    const m = el.querySelector('[data-testid="mannequin"]');
    expect(m).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="arm"]')).toHaveLength(2);
    expect(el.querySelectorAll('[data-testid="leg"]')).toHaveLength(2);
    // 1 色の面 (m-fill) と継ぎ目の線 (m-seam) だけ。画像は使わない
    expect(m?.querySelectorAll("image, img")).toHaveLength(0);
    for (const e of m?.querySelectorAll("path, ellipse") ?? [])
      expect(e.getAttribute("class")).toMatch(/^m-(fill|seam)$/);
    expect(existsSync("public/avatar")).toBe(false);
  });

  test("AC-22-2 AC-26-4: 台の大きさは CSS の変数で固定。中は cm の世界 (viewBox)", async () => {
    const el = await show([item("top")]);
    expect(el.querySelector("svg")?.getAttribute("viewBox")).toBe("-45 0 90 180");
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toContain("--stage-w: 200px;");
    expect(css).toContain("--stage-h: 400px;");
    expect(/\.stage \{([^}]*)\}/.exec(css)?.[1]).toContain("flex: none");
  });

  test("服がなくても、何を着ているかを読み上げる。届くまでは淡い形", async () => {
    expect((await show([])).querySelector("figure")?.getAttribute("aria-label")).toBe("着ている服: なし");
    const p = await show([], { pending: true, caption: "11月1日のコーデ" });
    expect(p.querySelector("figure")?.getAttribute("aria-label")).toBe("11月1日のコーデ: 読み込み中");
    expect(p.querySelector('[data-testid="wear-pending"]')).not.toBeNull();
    const s = await show([], { sparkle: 2 });
    expect(s.querySelector('[data-testid="sparkle"]')).not.toBeNull();
  });
});

describe("服を置く (#82)", () => {
  test("AC-82-2 AC-26-3 AC-37-3 AC-38-3: 写真は曲げない (行列は相似変換)、印の肩先が体の肩先に重なる", async () => {
    const el = await show([
      item("top", {
        fit: {
          v: 1,
          p: [
            [0.2, 0.1],
            [0.8, 0.1],
            [0.05, 0.9],
            [0.95, 0.9],
          ],
        },
      }),
    ]);
    const img = el.querySelector('[data-testid="worn"]');
    expect(img?.getAttribute("data-kind")).toBe("top");
    expect(img?.getAttribute("preserveAspectRatio")).toBe("none");
    const [a, b, c, d, e, f] = mat(img) as [number, number, number, number, number, number];
    expect(a).toBeCloseTo(d, 4);
    expect(b).toBeCloseTo(-c, 4);
    // 写真は仮の大きさ 100×100 (切り抜けない端末)。肩先 (20, 10) → 体の左の肩先
    const bd = body();
    expect(a * 20 + c * 10 + e).toBeCloseTo(-bd.shoulder, 2);
    expect(b * 20 + d * 10 + f).toBeCloseTo(bd.shoulderY, 2);
  });

  test("AC-82-5 AC-33-2 AC-38-1: 重ねる順はマネキン → ボトムス → くつ → トップス → アウター。中に着ていればアウターの前が開く", async () => {
    const el = await show([item("outer"), item("top"), item("shoes"), item("bottom")]);
    const kinds = [...el.querySelectorAll('[data-testid="worn"]')].map((e) => e.getAttribute("data-kind"));
    expect(kinds).toEqual(["bottom", "shoes", "top", "outer"]);
    const svg = el.querySelector("svg") as SVGElement;
    expect(svg.firstElementChild?.getAttribute("data-testid")).toBe("mannequin");
    expect(el.querySelector('[data-testid="open"]')).not.toBeNull();
  });

  test("AC-38-2: 中に何も着ていなければ、アウターの前は閉じたまま", async () => {
    const el = await show([item("outer")]);
    expect(el.querySelector('[data-testid="open"]')).toBeNull();
  });

  test("AC-32-1 AC-39-1 AC-84-1: くつは左右の半分を、それぞれの足に (2 つの片)", async () => {
    const el = await show([item("shoes")]);
    const feet = [...el.querySelectorAll('[data-testid="foot"]')];
    expect(feet.map((f) => f.getAttribute("data-foot"))).toEqual(["left", "right"]);
    expect(el.querySelectorAll('[data-testid="worn"]')).toHaveLength(1);
    expect(el.querySelectorAll("clipPath rect")).toHaveLength(2);
  });

  test("AC-39-2 AC-33-1: くつはボトムスの上に重ね、長い裾は床で隠す", async () => {
    const el = await show([item("bottom"), item("shoes")]);
    const kinds = [...el.querySelectorAll("image")].map((e) => e.getAttribute("class"));
    expect(kinds[0]).toContain("wear-bottom");
    expect(kinds.slice(1).every((k) => k?.includes("wear-shoes"))).toBe(true);
    expect(el.querySelector('[data-testid="hemmed"]')).not.toBeNull();
  });

  test("AC-84-3: インすると、トップスの腰より下を隠す", async () => {
    const el = await show([item("top"), item("bottom")], { tuck: true });
    expect(el.querySelector('[data-testid="tucked"] image')?.getAttribute("data-kind")).toBe("top");
  });

  test("AC-37-1 AC-44-1 AC-82-3: 袖を切って回すのをやめ、腕が袖口の向きに開く", async () => {
    const wide = await show([
      item("top", {
        fit: {
          v: 1,
          p: [
            [0.3, 0.05],
            [0.7, 0.05],
            [0.0, 0.5],
            [1, 0.5],
          ],
        },
      }),
    ]);
    const narrow = await show([
      item("top", {
        fit: {
          v: 1,
          p: [
            [0.3, 0.05],
            [0.7, 0.05],
            [0.25, 0.9],
            [0.75, 0.9],
          ],
        },
      }),
    ]);
    const angle = (el: HTMLElement) =>
      Number(el.querySelector('[data-testid="arm"]')?.getAttribute("data-angle"));
    expect(angle(wide)).toBeGreaterThan(angle(narrow));
    expect(wide.querySelectorAll('[data-testid="piece"]')).toHaveLength(0);
  });

  test("AC-83-3 AC-83-5: 服の直し・マネキンの直しを渡すと、その姿で描く", async () => {
    const el = await show([item("top")], {
      adj: { top: [3, 0, 1, 0] },
      pose: { ...NO_POSE, dx: 2, arm: [45, null] },
      body: body(170, "sturdy"),
    });
    expect(el.querySelector('[data-testid="arm"]')?.getAttribute("data-angle")).toBe("45");
    expect(el.querySelector('[data-testid="mannequin"]')?.getAttribute("transform")).toBe(
      "matrix(1 0 0 1 2 0)",
    );
    const plain = await show([item("top")]);
    const e1 = mat(el.querySelector('[data-testid="worn"]'))[4] as number;
    const e0 = mat(plain.querySelector('[data-testid="worn"]'))[4] as number;
    expect(e1).not.toBe(e0);
  });
});

describe("印 (保存したもの・推し量ったもの)", () => {
  const cut: Cut = {
    url: "blob:x",
    ok: true,
    full: { w: 200, h: 400 },
    box: { x: 20, y: 40, w: 100, h: 200 },
    mask: { w: 4, h: 2, data: new Uint8Array([1, 1, 1, 1, 0, 1, 1, 0]) },
  };

  test("AC-81-4: 保存した印は、切り詰めた写真の上の位置に直して使う", () => {
    const p = pieceOf(
      item("top", {
        fit: {
          v: 1,
          p: [
            [0.1, 0.1],
            [0.6, 0.1],
          ],
        },
      }),
      cut,
    );
    expect([p.w, p.h]).toEqual([100, 200]);
    expect(p.fit.p).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  test("AC-81-6: 印のない服は、切り抜いた形から推し量る。形も分からなければふつうの印", () => {
    expect(pieceOf(item("accessory"), cut).fit.at).toBe("head");
    const bare = { ...cut, mask: null, box: null, full: null };
    expect(pieceOf(item("bottom"), bare).fit).toEqual(DEFAULT_FIT.bottom);
    expect(pieceOf(item("hat"), bare).fit).toEqual(DEFAULT_FIT.top);
    expect([pieceOf(item("bottom"), bare).w, pieceOf(item("bottom"), bare).h]).toEqual([100, 100]);
    const saved = pieceOf(
      item("top", {
        fit: {
          v: 1,
          p: [
            [0.2, 0.2],
            [0.8, 0.2],
          ],
        },
      }),
      bare,
    );
    expect(saved.fit.p).toEqual([
      [0.2, 0.2],
      [0.8, 0.2],
    ]);
    expect(pieceOf(item("top"), { ...cut, box: null }).w).toBe(200);
  });

  test("切り抜いた写真が届いたら、それを描く", async () => {
    cuts.set("/api/clothes/top/photo", { ...cut, url: "blob:cut" });
    const el = await show([item("top")]);
    expect(el.querySelector('[data-testid="worn"]')?.getAttribute("href")).toBe("blob:cut");
    expect(el.querySelector('[data-testid="worn"]')?.getAttribute("width")).toBe("100");
  });
});

describe("広い画面の台 (#34)", () => {
  const css = readFileSync("src/style.css", "utf8");
  const wide = /@media \(min-width: 768px\) \{\s*:root \{([^}]*)\}/.exec(css)?.[1] ?? "";
  const px = (src: string, name: string) => Number(new RegExp(`${name}: (\\d+)px;`).exec(src)?.[1]);

  test("AC-34-1: 幅 1280px (768px 以上) で台が 200×400 より大きい。縦横比は同じ", () => {
    expect(px(wide, "--stage-w")).toBeGreaterThan(200);
    expect(px(wide, "--stage-h")).toBeGreaterThan(400);
    expect(px(wide, "--stage-w") / px(wide, "--stage-h")).toBe(0.5);
  });

  test("AC-34-2: 同じ幅では、服を着せても台の大きさは変わらない (大きさは変数だけで決まる)", () => {
    const rule = /\.stage \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("width: var(--stage-w)");
    expect(rule).toContain("height: var(--stage-h)");
    expect([...css.matchAll(/--stage-w:/g)]).toHaveLength(2);
    expect([...css.matchAll(/--stage-h:/g)]).toHaveLength(2);
  });

  test("AC-34-3: 幅 360px では今と同じ大きさ (200×400)", () => {
    const base = /:root \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(px(base, "--stage-w")).toBe(200);
    expect(px(base, "--stage-h")).toBe(400);
  });
});
