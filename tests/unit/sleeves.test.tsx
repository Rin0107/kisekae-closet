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
  bodiceEdge,
  CUT_SAFE,
  EDGE_MARGIN,
  measureSleeve,
  sleeveOrigin,
  sleevePoints,
  OPEN_GAP,
  pieces,
  place,
  sleeveTurn,
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
  test("AC-37-1: トップスの袖は腕の向きに回って置かれる (外へ回す。左右対称)", () => {
    expect(ARM_ANGLE).toBeCloseTo((Math.atan(0.7) * 180) / Math.PI, 5); // 約 35 度
    const s = measureSleeve(shirt, W, H);
    expect(s).not.toBeNull();
    expect(s?.top).toBeCloseTo(0.05, 5);
    expect(s?.angle).toBeLessThan(ARM_ANGLE); // 写真の袖は腕より真っすぐ下を向いている
    const right = measureSleeve((x, y) => shirt(W - 1 - x, y), W, H);
    expect(right).toEqual(s); // 左右同じ形なら同じ
    const cut = s?.cut ?? 0;
    const ps = pieces(BOX, s, right, false);
    expect(ps.map((p) => [p.from, p.to])).toEqual([
      [0, cut],
      [cut, 1 - cut],
      [1 - cut, 1],
    ]);
    const [l, , r] = ps as [Piece, Piece, Piece];
    expect(l.turn).toBeGreaterThan(0); // 左は外 (時計回り)
    expect(l.turn).toBeLessThanOrEqual(TURN_MAX);
    expect(r.turn).toBeCloseTo(-l.turn, 5); // 右は反時計回り
    expect((s?.angle ?? 0) + l.turn).toBeCloseTo(ARM_ANGLE, 5); // 回したあとは腕の向き
  });

  test("AC-37-1: 回す角度には上限がある。袖のない写真・切り抜けていない写真は回さない", () => {
    expect(sleeveTurn(BOX, null)).toBe(0);
    const base = { cut: 0.24, top: 0.05, pivot: 0.2, tip: { x: 0.2, y: 0.4 } };
    expect(sleeveTurn(BOX, { ...base, angle: -60 })).toBe(TURN_MAX);
    expect(sleeveTurn(BOX, { ...base, angle: 170 })).toBe(TURN_MIN);
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
      expect(p.style.transform).toMatch(/^(rotate\(-?[\d.e-]+deg\)( scale\([\d.]+\))?)?$/);
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

/** 多角形を塗った W×H の写真 (切り抜いたあとの形。服の外は透明)。 */
function poly(shapes: number[][][], w: number, h: number) {
  const inside = (pts: number[][], x: number, y: number) => {
    let on = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i] as [number, number];
      const [xj, yj] = pts[j] as [number, number];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) on = !on;
    }
    return on;
  };
  return (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && shapes.some((p) => inside(p, x + 0.5, y + 0.5));
}

/** 見本の服 (e2e と同じ形を、切り抜いて服の大きさに詰めたもの)。 */
const GARMENTS = {
  // 袖が斜めに張り出した半袖 (240×250)
  tee: {
    w: 240,
    h: 250,
    shapes: [
      [
        [45, 20],
        [85, 0],
        [155, 0],
        [195, 20],
        [240, 100],
        [195, 115],
        [180, 80],
        [180, 250],
        [60, 250],
        [60, 80],
        [45, 115],
        [0, 100],
      ],
    ],
  },
  // 袖を横に広げた T シャツ (260×255)
  wide: {
    w: 260,
    h: 255,
    shapes: [
      [
        [0, 15],
        [90, 0],
        [170, 0],
        [260, 15],
        [260, 65],
        [190, 70],
        [190, 255],
        [70, 255],
        [70, 70],
        [0, 65],
      ],
    ],
  },
  // 袖が真っすぐ垂れた長袖 (220×270)。袖は身ごろから離れている
  long: {
    w: 220,
    h: 270,
    shapes: [
      [
        [55, 10],
        [90, 0],
        [130, 0],
        [165, 10],
        [165, 270],
        [55, 270],
      ],
      [
        [55, 10],
        [30, 20],
        [0, 235],
        [30, 240],
        [52, 75],
      ],
      [
        [165, 10],
        [190, 20],
        [220, 235],
        [190, 240],
        [168, 75],
      ],
    ],
  },
} as const;

const measured = (g: { w: number; h: number; shapes: readonly (readonly (readonly number[])[])[] }) => {
  const op = poly(g.shapes as number[][][], g.w, g.h);
  return {
    op,
    left: measureSleeve(op, g.w, g.h),
    right: measureSleeve((x, y) => op(g.w - 1 - x, y), g.w, g.h),
    box: (() => {
      const b = place("top", g.h / g.w);
      if (b === null) throw new Error("top");
      return { top: b.top, left: b.left, width: b.width, height: b.width * STAGE_RATIO * (g.h / g.w) };
    })(),
  };
};

describe("袖を腕と同じ角度に (#44)", () => {
  test("AC-44-1: 長袖・アウター・T シャツの袖の向き (袖の帯の画素の主軸) が、回したあとアバターの腕の向きと 10° 以内", () => {
    for (const [name, g] of Object.entries(GARMENTS)) {
      const { left, right, box } = measured(g);
      expect(left, name).not.toBeNull();
      const [l, , r] = pieces(box, left, right, false) as [Piece, Piece, Piece];
      expect(Math.abs((left?.angle ?? 0) + l.turn - ARM_ANGLE), name).toBeLessThanOrEqual(10);
      expect(Math.abs((right?.angle ?? 0) - r.turn - ARM_ANGLE), name).toBeLessThanOrEqual(10);
    }
    // アウター (前を開けて着る) でも袖は同じに回る
    const { left, right, box } = measured(GARMENTS.long);
    const o = pieces(box, left, right, true);
    expect(o).toHaveLength(4);
    expect(Math.abs((left?.angle ?? 0) + (o[0] as Piece).turn - ARM_ANGLE)).toBeLessThanOrEqual(10);
  });

  test("AC-44-2: 広げた T シャツ (袖が水平) の写真でも、袖は下向きに回って腕に沿い、上向きに回らない", () => {
    const { left, box } = measured(GARMENTS.wide);
    expect(left?.angle).toBeGreaterThan(70); // 写真ではほぼ水平
    const t = sleeveTurn(box, left);
    expect(t).toBeLessThan(0); // 内 (下) へ回す
    const a = (left?.angle ?? 0) + t;
    expect(a).toBeGreaterThan(0); // 下を向いている (上へ回らない)
    expect(a).toBeLessThan(90);
    // 回したあとの袖の先は、回す中心より下
    if (left === null) throw new Error("袖");
    const { pivot, tip } = sleevePoints(box, left, t);
    expect(turnPoint(tip, pivot, t).y).toBeGreaterThan(pivot.y);
  });

  test("AC-44-3 AC-47-2: 袖の片に身ごろの縁が入らず (細い線のかけらが出ない)、内へ回すときは肩の縫い目を中心にする (肩にすき間がない)。影は服 1 枚にまとめて付け、継ぎ目に線を出さない", async () => {
    for (const [name, g] of Object.entries(GARMENTS)) {
      const { op, left } = measured(g);
      const edge = bodiceEdge(op, g.w, g.h) ?? 0;
      expect((left?.cut ?? 0) * g.w, name).toBeCloseTo(edge - Math.round(g.w * CUT_SAFE), 5);
      // 袖の片 (0〜cut) の、裾に近い行 (袖より下) には何もない: 身ごろの縁を袖と一緒に回さない
      const band = Math.round((left?.cut ?? 0) * g.w);
      for (let y = Math.floor(g.h * 0.92); y < g.h; y++)
        for (let x = 0; x < band; x++) expect(op(x, y), `${name} ${x},${y}`).toBe(false);
    }
    const tee = measured(GARMENTS.tee).left;
    if (tee === null) throw new Error("袖");
    expect(sleeveOrigin(tee, -5)).toBe(tee.top); // 内へ: 肩の縫い目
    expect(sleeveOrigin(tee, 5)).toBe(tee.pivot); // 外へ: 付け根の真ん中
    expect(tee.pivot).toBeGreaterThan(tee.top);
    // 影は片に付け、中の写真には付けない。袖は身ごろより先に (下に) 描く
    const css = readFileSync("src/style.css", "utf8");
    expect(/\.wear-piece \{([^}]*)\}/.exec(css)?.[1]).not.toContain("drop-shadow");
    expect(/\.wear-cut \{([^}]*)\}/.exec(css)?.[1]).toContain("drop-shadow");
    expect(/\.wear-piece \.wear \{([^}]*)\}/.exec(css)?.[1]).toContain("filter: none");
    const el = await wearLoaded([item("t1", "top")]);
    const turns = [...el.querySelectorAll<HTMLElement>('[data-testid="piece"]')].map((p) =>
      Number(p.dataset.turn),
    );
    expect(turns.at(-1)).toBe(0); // 最後 (一番上) は身ごろ
  });

  test("AC-44-4: 袖の先は台の外に出ない (1280px でも 360px でも、台の % は同じ)", () => {
    for (const [name, g] of Object.entries(GARMENTS)) {
      const { left, box } = measured(g);
      if (left === null) throw new Error(name);
      const t = sleeveTurn(box, left);
      const { pivot, tip } = sleevePoints(box, left, t);
      expect(turnPoint(tip, pivot, t).x, name).toBeGreaterThanOrEqual(EDGE_MARGIN);
    }
    // 腕の向きまで回すと台の外に出てしまう長い袖は、出ないところまで内へ戻す
    const long = { cut: 0.2, top: 0, pivot: 0.05, angle: 0, tip: { x: 0, y: 1.6 } };
    const box = { top: 10, left: 16, width: 68, height: 70 };
    const t = sleeveTurn(box, long);
    expect(t).toBeLessThan(ARM_ANGLE);
    const { pivot, tip } = sleevePoints(box, long, t);
    expect(turnPoint(tip, pivot, t).x).toBeGreaterThanOrEqual(EDGE_MARGIN);
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
      expect(p.style.transform).toMatch(/^(rotate\(-?[\d.e-]+deg\)( scale\([\d.]+\))?)?$/);
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
