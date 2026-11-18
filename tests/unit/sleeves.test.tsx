// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { Stage } from "../../src/Avatar";
import type { Clothing } from "../../src/client";
import {
  ARM_ANGLE,
  BODY,
  measureSleeve,
  OPEN_GAP,
  pieces,
  place,
  sleeveTurn,
  SLEEVE_SHARE,
  armX,
  STAGE_RATIO,
  turnPoint,
  TURN_MAX,
  TURN_MIN,
  type Piece,
} from "../../src/outfit";

afterEach(() => document.body.replaceChildren());

/** 100×100 のシャツの形: 身ごろは真ん中、袖は左右の帯に真っすぐ下へ垂れる (長袖をハンガーにかけた形)。 */
const W = 100;
const H = 100;
function shirt(x: number, y: number): boolean {
  if (x >= 24 && x < 76) return true; // 身ごろ
  const sx = x < 50 ? x : W - 1 - x; // 左右同じ
  return sx >= 4 && sx < 24 && y >= 5 && y < 70; // 袖
}

/** 左の袖の先 (写真の袖の帯の左下、x 4%・y 70% のあたり) が、回したあとに台のどこに来るか。 */
function leftTip(p: Piece) {
  const o = {
    x: p.box.left + (p.origin.x / 100) * p.box.width,
    y: p.box.top + (p.origin.y / 100) * p.box.height,
  };
  const fx = 0.04 / SLEEVE_SHARE; // 片の中の割合
  return turnPoint({ x: p.box.left + fx * p.box.width, y: p.box.top + 0.69 * p.box.height }, o, p.turn);
}

const BOX = (() => {
  const b = place("top", 1);
  if (b === null) throw new Error("top");
  return { top: b.top, left: b.left, width: b.width, height: b.width * STAGE_RATIO * 1 };
})();

async function stage(worn: Clothing[]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<Stage worn={worn} />));
  return el;
}

async function loaded(img: HTMLImageElement, w: number, h: number) {
  Object.defineProperty(img, "naturalWidth", { value: w, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: h, configurable: true });
  await act(async () => img.dispatchEvent(new Event("load")));
}

const item = (id: string, kind: string): Clothing => ({ id, kind, warmth: 2, label: id, createdAt: 1 });

/** 着せて、写真を読んだことにする (切り分けた片が出る)。 */
async function wearLoaded(worn: Clothing[]): Promise<HTMLElement> {
  const el = await stage(worn);
  for (const img of [...el.querySelectorAll<HTMLImageElement>('[data-testid="worn"]')])
    await loaded(img, 300, 300);
  return el;
}

describe("袖を腕の向きに (#37)", () => {
  test("AC-37-1: トップスの袖は腕の向きに回って置かれ、袖の先が腕の外の線の近くにある", () => {
    expect(ARM_ANGLE).toBeCloseTo((Math.atan(0.7) * 180) / Math.PI, 5); // 約 35 度
    const s = measureSleeve(shirt, W, H);
    expect(s).not.toBeNull();
    expect(s?.pivot).toBeCloseTo(0.05, 5);
    expect(s?.angle).toBeLessThan(ARM_ANGLE); // 写真の袖は腕より真っすぐ下を向いている
    const right = measureSleeve((x, y) => shirt(W - 1 - x, y), W, H);
    expect(right).toEqual(s); // 左右同じ形なら同じ
    const ps = pieces(BOX, s, right, false);
    expect(ps.map((p) => [p.from, p.to])).toEqual([
      [0, SLEEVE_SHARE],
      [SLEEVE_SHARE, 1 - SLEEVE_SHARE],
      [1 - SLEEVE_SHARE, 1],
    ]);
    const [l, , r] = ps as [Piece, Piece, Piece];
    expect(l.turn).toBeGreaterThan(0); // 左は外 (時計回り)
    expect(l.turn).toBeLessThanOrEqual(TURN_MAX);
    expect(r.turn).toBeCloseTo(-l.turn, 5); // 右は反時計回り
    // 回す前より、回したあとのほうが、袖の先が腕の外の線に近い (台の幅の 5% 以内)
    const flat = leftTip({ ...l, turn: 0 });
    const tip = leftTip(l);
    expect(Math.abs(tip.x - armX(tip.y))).toBeLessThan(Math.abs(flat.x - armX(flat.y)));
    expect(Math.abs(tip.x - armX(tip.y))).toBeLessThanOrEqual(1);
  });

  test("AC-37-1: 回す角度には上限がある。袖のない写真・切り抜けていない写真は回さない", () => {
    expect(sleeveTurn(BOX, null)).toBe(0);
    // 袖の先が上を向いていて、どれだけ回しても腕の線の内側なら、回しても上限まで。ずっと外なら下限まで
    expect(sleeveTurn(BOX, { pivot: 0.9, angle: 160, tip: { x: 0, y: 0 } })).toBe(TURN_MAX);
    expect(sleeveTurn(BOX, { pivot: 0.05, angle: 80, tip: { x: -2, y: 0.5 } })).toBe(TURN_MIN);
    expect(measureSleeve(() => true, W, H)).toBeNull(); // 全部不透明 (背景が残った写真)
    expect(measureSleeve((x) => x >= 24 && x < 76, W, H)).toBeNull(); // 袖なし
  });

  test("AC-37-2: 身ごろは今のまま胴の下着を覆う (評価5・#26 の基準を保つ)", () => {
    const s = measureSleeve(shirt, W, H);
    const body = pieces(BOX, s, s, false)[1] as Piece;
    expect(body.turn).toBe(0);
    expect(body.box.left).toBeLessThanOrEqual(BODY.torsoLeft);
    expect(body.box.left + body.box.width).toBeGreaterThanOrEqual(BODY.torsoRight);
    expect(body.box.top).toBeLessThan(BODY.neck - 2);
  });

  test("AC-37-3: 写真は曲げない: 片は縦横比のまま、回す・動かす・大きさを変えるだけ", async () => {
    const el = await wearLoaded([item("t1", "top")]);
    const ps = [...el.querySelectorAll<HTMLElement>('[data-testid="piece"]')];
    expect(ps).toHaveLength(3);
    for (const p of ps) {
      // 片の回し方は rotate だけ (skew・片方だけの拡大を使わない)
      expect(p.style.transform).toMatch(/^(rotate\(-?[\d.e-]+deg\))?$/);
      const img = p.querySelector("img") as HTMLImageElement;
      expect(img.style.transform).toBe("");
      expect(img.style.height).toBe("100%");
    }
    // 中の写真は、片の幅 × (1 ÷ 片の割合) の幅: 写真全体の大きさは片ごとに同じ
    const widths = ps.map((p) => {
      const img = p.querySelector("img") as HTMLImageElement;
      return (Number.parseFloat(p.style.width) * Number.parseFloat(img.style.width)) / 100;
    });
    for (const w of widths) expect(w).toBeCloseTo(widths[0] as number, 5);
    // 片の高さ = 写真の縦横比どおり (300×300 → 幅 × STAGE_RATIO)
    const total = widths[0] as number;
    for (const p of ps) expect(Number.parseFloat(p.style.height)).toBeCloseTo(total * STAGE_RATIO, 5);
    // 読み上げは 1 回だけ
    expect(el.querySelectorAll('img[alt="t1"]')).toHaveLength(1);
    const css = readFileSync("src/style.css", "utf8");
    expect(/\.wear-piece \{([^}]*)\}/.exec(css)?.[1]).toContain("overflow: hidden");
  });
});

describe("アウターを前開きに (#38)", () => {
  const outerPieces = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('[data-testid="piece"][data-kind="outer"]')].map((p) => ({
      left: Number.parseFloat(p.style.left),
      width: Number.parseFloat(p.style.width),
    }));

  test("AC-38-1: トップスの上にアウターを着せると、左右の前身ごろの間が開き、中のトップスの前が縦に見える", async () => {
    const ps = pieces(BOX, null, null, true);
    expect(ps).toHaveLength(4);
    const [, fl, fr] = ps as [Piece, Piece, Piece, Piece];
    expect(fr.box.left - (fl.box.left + fl.box.width)).toBeCloseTo(OPEN_GAP, 5);
    expect(fl.box.left + fl.box.width).toBeLessThanOrEqual(50 - OPEN_GAP / 2 + 1e-9);
    // 描いた台の上でも: アウターは 4 片、真ん中に開き。中のトップスはそこに見える (重なりはアウターが上)
    for (const inner of ["top", "dress"]) {
      document.body.replaceChildren();
      const el = await wearLoaded([item("i1", inner), item("o1", "outer")]);
      const o = outerPieces(el);
      expect(o, inner).toHaveLength(4);
      const gap = (o[2]?.left ?? 0) - ((o[1]?.left ?? 0) + (o[1]?.width ?? 0));
      expect(gap, inner).toBeCloseTo(OPEN_GAP, 5);
    }
  });

  test("AC-38-2: アウターだけを着せたとき (中に何もない) は前を閉じ、胴の下着を覆う", async () => {
    const el = await wearLoaded([item("b1", "bottom"), item("o1", "outer")]);
    const o = outerPieces(el);
    expect(o).toHaveLength(3);
    const body = o[1] as { left: number; width: number };
    expect(body.left).toBeLessThanOrEqual(BODY.torsoLeft);
    expect(body.left + body.width).toBeGreaterThanOrEqual(BODY.torsoRight);
  });

  test("AC-38-3: 写真は曲げない (切り分けと位置・大きさだけ。前身ごろは回さない)", async () => {
    const ps = pieces(BOX, null, null, true);
    expect(ps[1]?.turn).toBe(0);
    expect(ps[2]?.turn).toBe(0);
    const el = await wearLoaded([item("t1", "top"), item("o1", "outer")]);
    for (const p of el.querySelectorAll<HTMLElement>('[data-testid="piece"]')) {
      expect(p.style.transform).toMatch(/^(rotate\(-?[\d.e-]+deg\))?$/);
      expect((p.querySelector("img") as HTMLImageElement).style.transform).toBe("");
    }
  });
});

describe("広い画面の並び (#40)・服をしまう画面の見出し (#41)", () => {
  const css = readFileSync("src/style.css", "utf8");

  test("AC-40-1: 幅 768px 以上では、台の右にゲージ・決めるボタン・棚を並べる (棚がタブバーの裏に隠れない)", () => {
    const blocks = [...css.matchAll(/@media \(min-width: 768px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? "");
    const wide = blocks.find((b) => b.includes(".dresser {")) ?? "";
    expect(wide).toContain("display: grid");
    expect(wide).toContain("grid-template-columns: var(--stage-w) minmax(0, 1fr)");
  });

  test("AC-40-2: 幅 360px の並びは今のまま (台の下に続く)", () => {
    // メディアの外には .dresser の並びの決まりを書かない (縦に続く)
    const outside = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/\.dresser \{/);
  });

  test("AC-41-1: 服をしまう画面の見出しは折り返さず、入らなければファイルの欄が次の行に回る", () => {
    expect(/\.file-title \{([^}]*)\}/.exec(css)?.[1]).toContain("white-space: nowrap");
    expect(/\.file \{([^}]*display: inline-flex[^}]*)\}/.exec(css)?.[1]).toContain("flex-wrap: wrap");
  });
});
