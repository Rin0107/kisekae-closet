// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { Stage } from "../../src/Avatar";
import {
  BODICE_SHARE,
  BODY,
  BOTTOM_MIN_WIDTH,
  FOOT_BOX,
  place,
  shoeFeet,
  SLOTS,
  STAGE_RATIO as RATIO,
} from "../../src/outfit";

afterEach(() => document.body.replaceChildren());

async function stage(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () =>
    createRoot(el).render(
      <Stage worn={[{ id: "t1", kind: "top", warmth: 2, label: "白T", createdAt: 1 }]} />,
    ),
  );
  return el;
}

describe("リアルなアバター (#22)", () => {
  test("AC-22-1: 体は手描きの図形ではなく repo の中の絵。出どころとライセンス (CC0) が LICENSE.md にある", async () => {
    const el = await stage();
    const body = el.querySelector("img.body");
    expect(body?.getAttribute("src")).toBe("/avatar/body.webp");
    expect(el.querySelector("svg.body")).toBeNull();
    const license = readFileSync("public/avatar/LICENSE.md", "utf8");
    expect(license).toContain("CC0 1.0 Universal");
    expect(license).toContain("https://github.com/makehumancommunity/makehuman");
    expect(license).toContain("body.webp");
  });

  test("AC-22-2: 絵は自分の origin から読み (CSP のまま)、WebP で 400KB 以下。台の大きさは変わらない", async () => {
    const el = await stage();
    expect(el.querySelector("img.body")?.getAttribute("src")).toMatch(/^\/[^/]/);
    const file = "public/avatar/body.webp";
    expect(statSync(file).size).toBeLessThanOrEqual(400 * 1024);
    const head = readFileSync(file).subarray(0, 12);
    expect(head.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(head.subarray(8, 12).toString("latin1")).toBe("WEBP");
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toContain("--stage-w: 200px;");
    expect(css).toContain("--stage-h: 400px;");
  });

  test("AC-22-3: 服を重ねる枠は、絵の肩 (約 20%)・腰 (約 44%)・足首 (約 89%) に合う", () => {
    const { top, bottom, shoes } = SLOTS as Record<
      "top" | "bottom" | "shoes",
      { top: number; height: number }
    >;
    // トップスは肩の少し上から腰の下まで
    expect(top.top).toBeLessThanOrEqual(19.8);
    expect(top.top + top.height).toBeGreaterThanOrEqual(43.5);
    // ボトムスは腰から足首まで
    expect(bottom.top).toBeLessThanOrEqual(44.6);
    expect(bottom.top + bottom.height).toBeGreaterThanOrEqual(86);
    // くつは足首から足の裏 (93%) まで
    expect(shoes.top).toBeLessThanOrEqual(89.2);
    expect(shoes.top + shoes.height).toBeGreaterThanOrEqual(93);
  });

  test("AC-22-4: 実在の人の写真・顔写真を使っていない (置いてあるのは描いた絵とライセンスだけ)", () => {
    expect(readdirSync("public/avatar").sort()).toEqual(["LICENSE.md", "body.webp"]);
    expect(readFileSync("public/avatar/LICENSE.md", "utf8")).toContain(
      "実在の人の写真・顔写真は使っていない",
    );
  });
});

/** 台の縦横比 (幅 ÷ 高さ)。width の % を、高さの % に直すのに使う。 */
const STAGE_RATIO = 200 / 400;
/** 幅で合わせた服の、台の高さに対する丈 (%)。ratio は写真の 縦 ÷ 横。 */
const length = (width: number, ratio: number) => width * STAGE_RATIO * ratio;

describe("服が体を覆う (#26)", () => {
  test("AC-26-1: トップス・ワンピース・アウターの身ごろは、胴の下着の幅と首元を覆う。ボトムスは腰を覆う", () => {
    for (const k of ["top", "dress", "outer"]) {
      const s = SLOTS[k];
      if (s === undefined) throw new Error(k);
      // 袖を除いた身ごろ (写真の幅の BODICE_SHARE) が、下着の左右の端より外まである
      const side = (s.width * (1 - BODICE_SHARE)) / 2;
      expect(s.left + side, k).toBeLessThanOrEqual(BODY.torsoLeft);
      expect(s.left + s.width - side, k).toBeGreaterThanOrEqual(BODY.torsoRight);
      // 首元: 下着の上の端より上から始まる
      expect(s.top, k).toBeLessThan(BODY.neck - 2);
      expect(s.left + s.width / 2, k).toBe(50); // 真ん中にそろえる
    }
    // ふつうの丈のトップス (縦 ÷ 横 0.9 以上) は、ボトムスの上の端まで届く (腰で下着がのぞかない)
    const { top, bottom } = SLOTS as Record<"top" | "bottom", { top: number; left: number; width: number }>;
    expect(top.top + length(top.width, 0.9)).toBeGreaterThanOrEqual(bottom.top);
    // ボトムスの腰 (写真の幅の 3/4 ほど) が、下着の腰の幅を覆い、下着の下の端より上から始まる
    const waist = (bottom.width * (1 - 0.75)) / 2;
    expect(bottom.left + waist).toBeLessThanOrEqual(BODY.torsoLeft);
    expect(bottom.left + bottom.width - waist).toBeGreaterThanOrEqual(BODY.torsoRight);
    expect(bottom.top).toBeLessThan(BODY.hip - 6);
  });

  test("AC-26-2: トップスの袖の先は、腕の外の線の近くにあり、腕だけが袖の外に大きく出ない", () => {
    const top = SLOTS.top as { top: number; left: number; width: number };
    // ハンガーにかけた半袖の袖の先: 写真の左の端、上から 4 割 (e2e の見本の服と同じ形)
    for (const ratio of [0.9, 1.04, 1.2]) {
      const y = top.top + 0.4 * length(top.width, ratio);
      const arm = BODY.torsoLeft - (y - BODY.shoulder) * BODY.armSlope;
      // 袖が腕の外の線まで覆う (はみ出す腕は台の幅の 3% = 6px まで)
      expect(top.left, `縦横比 ${ratio}`).toBeLessThanOrEqual(arm + 3);
      expect(arm - top.left, `縦横比 ${ratio}`).toBeLessThanOrEqual(8); // 袖だけが大きく張り出さない
    }
  });

  test("AC-26-3: 服の写真は曲げず、大きさと位置だけを変える (幅で合わせ、縦は写真のまま)", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const worn = ["top", "bottom", "outer", "shoes"].map((kind, i) => ({
      id: `c${i}`,
      kind,
      warmth: 2,
      label: kind,
      createdAt: i,
    }));
    await act(async () => createRoot(el).render(<Stage worn={worn} />));
    const imgs = [...el.querySelectorAll<HTMLImageElement>('[data-testid="worn"]')];
    const byKind = Object.fromEntries(imgs.map((i) => [i.dataset.kind, i.style]));
    expect(byKind.top?.width).toBe("68%");
    expect(byKind.top?.height).toBe("auto");
    expect(byKind.outer?.height).toBe("auto");
    expect(byKind.bottom?.height).toBe("auto");
    // くつは片足の箱 (半分の写真と同じ縦横比) に、箱の 2 倍の幅の写真を入れる (#32)
    expect(byKind.shoes?.width).toBe("200%");
    expect(byKind.shoes?.height).toBe("100%");
    for (const s of imgs.map((i) => i.style)) expect(s.transform).toBe("");
    const css = readFileSync("src/style.css", "utf8");
    for (const m of css.matchAll(/\.wear[^{]*\{([^}]*)\}/g))
      expect(m[1]).not.toMatch(/transform|skew|perspective/);
  });

  test("AC-26-4: 服を重ねても、アバターの台の大きさは変わらない (CSS の変数で固定)", () => {
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toContain("--stage-w: 200px;");
    expect(css).toContain("--stage-h: 400px;");
    expect(/\.stage \{([^}]*)\}/.exec(css)?.[1]).toContain("flex: none");
  });
});

/** 写真を読み込んだことにする (横 × 縦)。 */
async function loaded(img: HTMLImageElement, w: number, h: number) {
  Object.defineProperty(img, "naturalWidth", { value: w, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: h, configurable: true });
  await act(async () => img.dispatchEvent(new Event("load")));
}

async function wearOne(kind: string): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () =>
    createRoot(el).render(<Stage worn={[{ id: "x", kind, warmth: 2, label: kind, createdAt: 1 }]} />),
  );
  return el;
}

const pct = (v: string | undefined) => Number.parseFloat(v ?? "NaN");

describe("くつを足に (#32)", () => {
  test("AC-32-1: くつを着せると、左右の足の上にくつが重なる (足の間に浮かない)", async () => {
    for (const ratio of [null, 0.3, 0.5, 0.8, 1.2]) {
      const feet = shoeFeet(ratio);
      feet.forEach((b, i) => {
        const cx = BODY.feet[i] as number;
        // 箱の真ん中が足の真ん中、箱は足の幅にかかり、足の間までは広がらない
        expect(b.left + b.width / 2, `${ratio}`).toBeCloseTo(cx, 5);
        expect(b.left, `${ratio}`).toBeLessThan(cx - BODY.footWidth / 4);
        expect(b.left + b.width, `${ratio}`).toBeGreaterThan(cx + BODY.footWidth / 4);
        // 足より一回り大きいところまで (#39 で上限を FOOT_BOX の 16% に)。足の間には届かない (下の 40% / 60%)
        expect(b.width, `${ratio}`).toBeLessThanOrEqual(FOOT_BOX.width);
        // 足の裏にそろう
        expect(b.top + (b.height ?? 0), `${ratio}`).toBeCloseTo(BODY.sole + 0.5, 5);
      });
      const [l, r] = feet;
      expect(l.left + l.width).toBeLessThan(50 - 10);
      expect(r.left).toBeGreaterThan(50 + 10);
    }
    // 描いた台の上でも: 左右の足の箱が 2 つ、それぞれの足の位置に
    const el = await wearOne("shoes");
    const boxes = [...el.querySelectorAll<HTMLElement>('[data-testid="foot"]')];
    expect(boxes.map((b) => b.dataset.foot)).toEqual(["left", "right"]);
    for (const [i, b] of boxes.entries()) {
      const cx = pct(b.style.left) + pct(b.style.width) / 2;
      expect(cx).toBeCloseTo(BODY.feet[i] as number, 5);
    }
    // 読み上げは 1 足として 1 回だけ
    expect(el.querySelectorAll('img[alt="shoes"]')).toHaveLength(1);
  });

  test("AC-32-2: 写真は曲げず、切り分けと大きさ・位置だけ変える", async () => {
    const el = await wearOne("shoes");
    const img = el.querySelector<HTMLImageElement>('[data-testid="worn"]') as HTMLImageElement;
    await loaded(img, 240, 90); // 2 足を並べた横長の写真
    const boxes = [...el.querySelectorAll<HTMLElement>('[data-testid="foot"]')];
    for (const [i, b] of boxes.entries()) {
      // 片足の箱の縦横比 = 写真の半分の縦横比 (台の幅 1% と高さ 1% は 1:2)
      const w = pct(b.style.width);
      const h = pct(b.style.height);
      expect(h / RATIO / w).toBeCloseTo(90 / 120, 5);
      // 中の写真は箱の 2 倍の幅・同じ高さ: 左の足は左半分、右の足は右半分
      const p = b.querySelector("img")?.style;
      expect(p?.width).toBe("200%");
      expect(p?.height).toBe("100%");
      expect(p?.left).toBe(i === 0 ? "0px" : "-100%");
      expect(p?.transform).toBe("");
      expect(b.style.transform).toBe("");
    }
    const css = readFileSync("src/style.css", "utf8");
    expect(/\.wear-foot \{([^}]*)\}/.exec(css)?.[1]).toContain("overflow: hidden");
    for (const m of css.matchAll(/\.wear-foot[^{]*\{([^}]*)\}/g))
      expect(m[1]).not.toMatch(/transform|skew|object-fit: fill/);
  });
});

describe("くつを形の分かる大きさで (#39)", () => {
  const RATIOS = [null, 0.3, 90 / 240, 0.5, 0.8, 1.2];

  test("AC-39-1: くつの片足の箱が、足の幅 (BODY.footWidth) より大きい", async () => {
    for (const ratio of RATIOS)
      for (const b of shoeFeet(ratio)) {
        expect(b.width, `${ratio}`).toBeGreaterThan(BODY.footWidth);
        // 形が分かる高さもある (台の高さの 4.5% 以上。2 足を並べた平たい写真 0.3 でも)
        expect(b.height ?? 0, `${ratio}`).toBeGreaterThanOrEqual(4.5);
      }
    // 描いた台の上でも (横長の 2 足の写真)
    const el = await wearOne("shoes");
    await loaded(el.querySelector<HTMLImageElement>('[data-testid="worn"]') as HTMLImageElement, 240, 90);
    for (const f of el.querySelectorAll<HTMLElement>('[data-testid="foot"]'))
      expect(pct(f.style.width)).toBeGreaterThan(BODY.footWidth);
  });

  test("AC-39-2: 長ズボンを履いていても、くつの甲の部分が見える (裾に全部隠れない)", async () => {
    // 足首まで届く長ズボン (縦 ÷ 横 2.3) の裾は、くつの上の端より下まで来る (重なる)
    const pants = place("bottom", 2.3);
    if (pants === null) throw new Error("bottom");
    const hem = pants.top + pants.width * RATIO * 2.3;
    for (const ratio of RATIOS) for (const b of shoeFeet(ratio)) expect(b.top, `${ratio}`).toBeLessThan(hem);
    // だから、くつは裾より前に重ねる
    expect(SLOTS.shoes?.z ?? 0).toBeGreaterThan(SLOTS.bottom?.z ?? 0);
    // 描いた台の上でも: くつの箱の重なりの順が、ボトムスの写真より上
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () =>
      createRoot(el).render(
        <Stage
          worn={[
            { id: "b", kind: "bottom", warmth: 2, label: "長ズボン", createdAt: 1 },
            { id: "s", kind: "shoes", warmth: 1, label: "くつ", createdAt: 2 },
          ]}
        />,
      ),
    );
    const bottom = el.querySelector<HTMLElement>('[data-kind="bottom"]') as HTMLElement;
    const feet = [...el.querySelectorAll<HTMLElement>('[data-testid="foot"]')];
    expect(feet).toHaveLength(2);
    for (const f of feet) expect(Number(f.style.zIndex)).toBeGreaterThan(Number(bottom.style.zIndex));
  });

  test("AC-39-3: 左右の足の上にあることと、写真を曲げないことは #32 のまま", () => {
    for (const ratio of RATIOS) {
      const half = ratio === null ? 1 : 2 * ratio;
      shoeFeet(ratio).forEach((b, i) => {
        const cx = BODY.feet[i] as number;
        expect(b.left + b.width / 2, `${ratio}`).toBeCloseTo(cx, 5);
        expect(b.top + (b.height ?? 0), `${ratio}`).toBeCloseTo(BODY.sole + 0.5, 5);
        // 箱の縦横比 = 写真の半分の縦横比 (曲げない)
        expect((b.height ?? 0) / RATIO / b.width, `${ratio}`).toBeCloseTo(half, 5);
      });
      const [l, r] = shoeFeet(ratio);
      expect(l.left + l.width).toBeLessThan(50 - 10);
      expect(r.left).toBeGreaterThan(50 + 10);
    }
  });
});

describe("服の丈 (#33)", () => {
  test("AC-33-1: 縦に長いパンツの写真 (縦 ÷ 横 2.3) を着せると、裾が足首の近く (台の 85% より下) まで届く", async () => {
    for (const ratio of [1.5, 1.8, 2.3, 3]) {
      const b = place("bottom", ratio);
      if (b === null) throw new Error("bottom");
      expect(b.height).toBeNull(); // 縦は写真のまま
      expect(b.top + b.width * RATIO * ratio, `${ratio}`).toBeGreaterThan(85);
    }
    // 描いた台の上でも: 写真を読むと、丈から幅が決まる
    const el = await wearOne("bottom");
    const img = el.querySelector<HTMLImageElement>('[data-testid="worn"]') as HTMLImageElement;
    await loaded(img, 100, 230);
    expect(img.style.height).toBe("auto");
    expect(pct(img.style.top) + pct(img.style.width) * RATIO * 2.3).toBeGreaterThan(85);
  });

  test("AC-33-2: アウターを着せると、中のトップスの襟元の一部が見える (全部は隠れない)", () => {
    const top = place("top", 1) as { top: number; left: number; width: number };
    const outer = place("outer", 1) as { top: number; left: number; width: number };
    // アウターは少し下から始まり、トップスの襟元が台の高さの 1.5% 以上のぞく
    expect(outer.top - top.top).toBeGreaterThanOrEqual(1.5);
    // アウターはトップスより一回り大きい (両側に袖が出る)
    expect(outer.left).toBeLessThan(top.left);
    expect(outer.left + outer.width).toBeGreaterThan(top.left + top.width);
    expect(SLOTS.outer?.z ?? 0).toBeGreaterThan(SLOTS.top?.z ?? 0);
  });

  test("AC-33-3: どの服も胴の下着を覆う (評価5の基準を保つ)。ボトムスはどの縦横比でも腰を覆う", () => {
    for (const k of ["top", "dress", "outer"]) {
      const s = place(k, 1);
      if (s === null) throw new Error(k);
      const side = (s.width * (1 - BODICE_SHARE)) / 2;
      expect(s.left + side, k).toBeLessThanOrEqual(BODY.torsoLeft);
      expect(s.left + s.width - side, k).toBeGreaterThanOrEqual(BODY.torsoRight);
      expect(s.top, k).toBeLessThan(BODY.neck - 2);
    }
    for (let ratio = 0.5; ratio <= 4; ratio += 0.1) {
      const b = place("bottom", ratio);
      if (b === null) throw new Error("bottom");
      expect(b.width).toBeGreaterThanOrEqual(BOTTOM_MIN_WIDTH);
      const waist = (b.width * (1 - 0.75)) / 2;
      expect(b.left + waist).toBeLessThanOrEqual(BODY.torsoLeft);
      expect(b.left + b.width - waist).toBeGreaterThanOrEqual(BODY.torsoRight);
      expect(b.top).toBeLessThan(BODY.hip - 6);
      expect(b.left + b.width / 2).toBeCloseTo(50, 5);
    }
    // ふつうの丈のトップスは、ボトムスの上の端まで届く
    const top = place("top", 0.9) as { top: number; width: number };
    expect(top.top + top.width * RATIO * 0.9).toBeGreaterThanOrEqual(SLOTS.bottom?.top ?? 0);
  });
});

describe("広い画面の台 (#34)", () => {
  const css = readFileSync("src/style.css", "utf8");
  const wide = /@media \(min-width: 768px\) \{\s*:root \{([^}]*)\}/.exec(css)?.[1] ?? "";
  const px = (src: string, name: string) => Number(new RegExp(`${name}: (\\d+)px;`).exec(src)?.[1]);

  test("AC-34-1: 幅 1280px (768px 以上) で台が 200×400 より大きい。縦横比は同じ", () => {
    expect(px(wide, "--stage-w")).toBeGreaterThan(200);
    expect(px(wide, "--stage-h")).toBeGreaterThan(400);
    expect(px(wide, "--stage-w") / px(wide, "--stage-h")).toBe(RATIO);
  });

  test("AC-34-2: 同じ幅では、服を着せても台の大きさは変わらない (大きさは変数だけで決まる)", () => {
    const rule = /\.stage \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("width: var(--stage-w)");
    expect(rule).toContain("height: var(--stage-h)");
    expect(rule).toContain("flex: none");
    // 変数を決めるのは :root の 2 か所 (ふつうと広い画面) だけ。服や中身の数では変えない
    expect([...css.matchAll(/--stage-w:/g)]).toHaveLength(2);
    expect([...css.matchAll(/--stage-h:/g)]).toHaveLength(2);
  });

  test("AC-34-3: 幅 360px では今と同じ大きさ (200×400)", () => {
    const base = /:root \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(px(base, "--stage-w")).toBe(200);
    expect(px(base, "--stage-h")).toBe(400);
    expect(wide).not.toBe("");
    expect(css.indexOf("@media (min-width: 768px)")).toBeGreaterThan(css.indexOf("--stage-w: 200px;"));
  });
});
