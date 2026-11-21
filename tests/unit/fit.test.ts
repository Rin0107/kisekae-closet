// 着せ替え v2 の幾何 (src/fit.ts、docs/spec-v2-fitting.md)。
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  ANCHORS,
  apply,
  ARM_DEFAULT,
  ARM_RANGE,
  around,
  body,
  BUILDS,
  cropFit,
  DEFAULT_FIT,
  dress,
  guessFit,
  HEIGHTS,
  IDENTITY,
  invert,
  LEG_DEFAULT,
  LEG_RANGE,
  mul,
  NO_POSE,
  OPEN_GAP,
  similarity,
  uncropFit,
  type Fit,
  type Mask,
  type Mat,
  type Piece,
  type Pt,
} from "../../src/fit";
import { runs } from "./fc";

const close = (a: Pt, b: Pt, eps = 1e-6) => {
  expect(a[0]).toBeCloseTo(b[0], -Math.log10(eps));
  expect(a[1]).toBeCloseTo(b[1], -Math.log10(eps));
};
const coord = fc.double({ min: -500, max: 500, noNaN: true });
const pt = fc.tuple(coord, coord);
/** 縦横の伸び方が同じで、ねじれがない (相似変換) */
const isSimilar = (m: Mat) => {
  expect(m[0]).toBeCloseTo(m[3], 9);
  expect(m[1]).toBeCloseTo(-m[2], 9);
};

const piece = (kind: string, p: Pt[], over: Partial<Piece> = {}): Piece => ({
  id: kind,
  kind,
  w: 100,
  h: 100,
  fit: { v: 1, p },
  ...over,
});
/** 長袖のトップス: 肩は (25,10)・(75,10)、袖口は下の左右 */
const longTop = piece("top", [
  [0.25, 0.1],
  [0.75, 0.1],
  [0.05, 0.95],
  [0.95, 0.95],
]);

describe("相似変換 (写真は曲げない)", () => {
  test("AC-82-2: 印 2 点が体の 2 点にぴったり重なり、縦横比が変わらない (PBT)", () => {
    fc.assert(
      fc.property(pt, pt, pt, pt, (p0, p1, q0, q1) => {
        fc.pre(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1e-3);
        const m = similarity(p0, p1, q0, q1) as Mat;
        close(apply(m, p0), q0, 1e-5);
        close(apply(m, p1), q1, 1e-5);
        isSimilar(m);
      }),
      runs(),
    );
  });

  test("AC-82-2: 2 点が重なっていれば置けない (null)", () => {
    expect(similarity([1, 1], [1, 1], [0, 0], [1, 0])).toBeNull();
  });

  test("invert・mul・around: 逆に戻せて、around は中心を動かさない", () => {
    fc.assert(
      fc.property(
        pt,
        fc.double({ min: 0.2, max: 3, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        pt,
        (o, s, d, p) => {
          const m = around(o, s, d);
          close(apply(m, o), o, 1e-6);
          close(apply(mul(invert(m), m), p), p, 1e-5);
          isSimilar(m);
        },
      ),
      runs(),
    );
    expect(apply(IDENTITY, [3, 4])).toEqual([3, 4]);
    close(apply(around([0, 0], 1, 0, 5, -2), [1, 1]), [6, -1]);
  });
});

describe("マネキンが服に合わせる", () => {
  const b = body();

  test("AC-82-2: トップスの肩先は体の肩先に重なる", () => {
    const d = dress([longTop]);
    const t = d.placed[0];
    if (t === undefined) throw new Error("top");
    close(apply(t.m, [25, 10]), [-b.shoulder, b.shoulderY]);
    close(apply(t.m, [75, 10]), [b.shoulder, b.shoulderY]);
  });

  test("AC-82-3: 長袖なら手首が袖口に、半袖なら腕の長さまで。袖口の向きに腕が開く (左右対称)", () => {
    const d = dress([longTop]);
    const t = d.placed[0];
    if (t === undefined) throw new Error("top");
    const cuffL = apply(t.m, [5, 95]);
    const cuffR = apply(t.m, [95, 95]);
    const [l, r] = d.arms;
    expect(l.angle).toBeCloseTo(r.angle, 6);
    expect(l.angle).toBeGreaterThanOrEqual(ARM_RANGE[0]);
    const reach = Math.hypot(cuffL[0] - l.from[0], cuffL[1] - l.from[1]);
    if (reach >= b.armLen && reach <= b.armLen * 1.15) {
      close(l.to, cuffL, 1e-6);
      close(r.to, cuffR, 1e-6);
    }
    // 半袖: 袖口は肩のすぐ外。腕はその向きに、腕の長さだけ
    const short = piece("top", [
      [0.25, 0.1],
      [0.75, 0.1],
      [0.08, 0.35],
      [0.92, 0.35],
    ]);
    const s = dress([short]).arms[0];
    expect(Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1])).toBeCloseTo(b.armLen, 6);
  });

  test("AC-82-3: 袖口がどこにあっても、腕の角度は範囲の中 (PBT)", () => {
    const u = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(u, u, u, u, (x, y, x2, y2) => {
        const d = dress([
          piece("outer", [
            [0.3, 0.1],
            [0.7, 0.1],
            [x, y],
            [x2, y2],
          ]),
        ]);
        for (const a of d.arms) {
          expect(a.angle).toBeGreaterThanOrEqual(ARM_RANGE[0]);
          expect(a.angle).toBeLessThanOrEqual(ARM_RANGE[1]);
        }
      }),
      runs(),
    );
  });

  test("AC-82-3: 袖なし (袖口の印がない・肩のすぐそば)・服なしは既定の角度", () => {
    expect(dress([]).arms.map((a) => a.angle)).toEqual([ARM_DEFAULT, ARM_DEFAULT]);
    const noCuff = piece("dress", [
      [0.3, 0.05],
      [0.7, 0.05],
    ]);
    expect(dress([noCuff]).arms[0].angle).toBe(ARM_DEFAULT);
    const atShoulder = piece("top", [
      [0.25, 0.1],
      [0.75, 0.1],
      [0.25, 0.12],
      [0.75, 0.12],
    ]);
    expect(dress([atShoulder]).arms[1].angle).toBe(ARM_DEFAULT);
  });

  test("AC-82-3: 腕は一番外の服 (アウター) の袖口に合わせる", () => {
    const outer = piece("outer", [
      [0.25, 0.1],
      [0.75, 0.1],
      [0.0, 0.6],
      [1.0, 0.6],
    ]);
    const withOuter = dress([longTop, outer]).arms[0].angle;
    expect(withOuter).toBe(dress([outer]).arms[0].angle);
    expect(withOuter).not.toBe(dress([longTop]).arms[0].angle);
  });

  test("AC-82-4: 脚はボトムスの裾の真ん中へ向く。スカート (裾の印なし)・ワンピースは既定の開き", () => {
    const pants = piece("bottom", [
      [0.1, 0.02],
      [0.9, 0.02],
      [0.2, 0.98],
      [0.8, 0.98],
    ]);
    const d = dress([pants]);
    const t = d.placed[0];
    if (t === undefined) throw new Error("bottom");
    const hem = apply(t.m, [20, 98]);
    const [l] = d.legs;
    // 足首は、付け根から裾の真ん中への線の上 (角度が範囲の中なら)
    const cross = (l.to[0] - l.from[0]) * (hem[1] - l.from[1]) - (l.to[1] - l.from[1]) * (hem[0] - l.from[0]);
    if (l.angle > LEG_RANGE[0] && l.angle < LEG_RANGE[1]) expect(Math.abs(cross)).toBeLessThan(1e-6);
    expect(l.angle).toBeGreaterThanOrEqual(LEG_RANGE[0]);
    expect(l.angle).toBeLessThanOrEqual(LEG_RANGE[1]);
    const skirt = piece("bottom", [
      [0.1, 0.02],
      [0.9, 0.02],
    ]);
    expect(dress([skirt]).legs.map((x) => x.angle)).toEqual([LEG_DEFAULT, LEG_DEFAULT]);
    expect(
      dress([
        piece("dress", [
          [0.3, 0.05],
          [0.7, 0.05],
        ]),
      ]).legs[1].angle,
    ).toBe(LEG_DEFAULT);
  });

  test("AC-82-5: 重ねる順は ボトムス・くつ・トップス・アウター・こもの (マネキンはいつも一番下)", () => {
    const all = ["accessory", "outer", "top", "shoes", "bottom"].map((k) =>
      piece(k, (DEFAULT_FIT[k] as Fit).p, { fit: DEFAULT_FIT[k] as Fit }),
    );
    const kinds = dress(all).placed.map((p) => p.kind);
    expect(kinds).toEqual(["bottom", "shoes", "shoes", "top", "outer", "accessory"]);
  });

  test("置く場所のない種類・印の足りない服は置かない", () => {
    expect(
      dress([
        piece("hat", [
          [0, 0],
          [1, 1],
        ]),
      ]).placed,
    ).toEqual([]);
    expect(dress([piece("top", [[0.5, 0.5]])]).placed).toEqual([]);
    expect(
      dress([
        piece("top", [
          [0.5, 0.5],
          [0.5, 0.5],
        ]),
      ]).placed,
    ).toEqual([]);
    expect(
      dress([
        piece("shoes", [
          [0, 1],
          [0.4, 1],
        ]),
      ]).placed,
    ).toEqual([]);
    expect(
      dress([
        piece("shoes", [
          [0, 1],
          [0, 1],
          [0.6, 1],
          [0.9, 1],
        ]),
      ]).placed,
    ).toHaveLength(1);
  });

  test("どの印の種類にも名前がある", () => {
    for (const [k, f] of Object.entries(DEFAULT_FIT))
      expect(ANCHORS[k]?.length).toBeGreaterThanOrEqual(f.p.length);
  });
});

describe("くつ・こもの・インする・前を開ける (#84)", () => {
  const b = body();
  const shoes = piece("shoes", (DEFAULT_FIT.shoes as Fit).p);

  test("AC-84-1: 左右のくつは、それぞれの足首の下 (底が床) に履く", () => {
    const d = dress([shoes]);
    const [l, r] = d.placed;
    if (l === undefined || r === undefined) throw new Error("shoes");
    expect([l.half, r.half]).toEqual(["left", "right"]);
    expect(l.split).toBeCloseTo(50, 6);
    const sole = (m: Mat, x: number) => apply(m, [x, 98]);
    const lMid = sole(l.m, 24);
    expect(lMid[0]).toBeCloseTo(d.legs[0].to[0], 6);
    expect(lMid[1]).toBeCloseTo(d.legs[0].to[1] + b.footLen, 6);
    expect(sole(r.m, 76)[0]).toBeCloseTo(d.legs[1].to[0], 6);
  });

  test("AC-84-2: こものは置き場所 (頭・首・手) に合わせる。手は手首に下げる", () => {
    const at = (place: "head" | "neck" | "hand") =>
      dress([
        piece(
          "accessory",
          [
            [0, 0.5],
            [1, 0.5],
          ],
          {
            fit: {
              v: 1,
              p: [
                [0, 0.5],
                [1, 0.5],
              ],
              at: place,
            },
          },
        ),
      ]);
    const mid = (d: ReturnType<typeof dress>) => apply((d.placed[0] as { m: Mat }).m, [50, 50]);
    expect(mid(at("head"))[1]).toBeLessThan(b.chin);
    expect(mid(at("neck"))[1]).toBeGreaterThan(b.chin);
    expect(mid(at("neck"))[1]).toBeLessThan(b.shoulderY);
    const hand = at("hand");
    close(mid(hand), [hand.arms[1].to[0], hand.arms[1].to[1] + 8]);
  });

  test("AC-84-3: インすると、トップスの腰より下を隠す。ボトムスがなければインしない", () => {
    const bottom = piece("bottom", (DEFAULT_FIT.bottom as Fit).p);
    const tucked = dress([longTop, bottom], { tuck: true }).placed.find((p) => p.kind === "top");
    expect(tucked?.clipBelow).toBeCloseTo(b.waistFlat[1] + 3, 6);
    expect(dress([longTop, bottom]).placed.find((p) => p.kind === "top")?.clipBelow).toBeUndefined();
    expect(dress([longTop], { tuck: true }).placed[0]?.clipBelow).toBeUndefined();
  });

  test("AC-84-4: 中にトップスかワンピースがあれば、アウターの前を肩先の真ん中の真下で開ける", () => {
    const outer = piece("outer", [
      [0.2, 0.1],
      [0.8, 0.1],
      [0, 0.8],
      [1, 0.8],
    ]);
    const open = dress([longTop, outer]).placed.find((p) => p.kind === "outer")?.open;
    expect(open?.x).toBeCloseTo(0, 6);
    expect(open?.below).toBeCloseTo(b.shoulderY - 0.5 + 3, 6);
    expect(OPEN_GAP).toBeGreaterThan(0);
    expect(dress([outer]).placed[0]?.open).toBeUndefined();
  });

  test("床より長いボトムス・ワンピースの裾は床で隠す (写真は曲げない)", () => {
    const d = dress([piece("bottom", (DEFAULT_FIT.bottom as Fit).p)]);
    const floor = Math.max(d.legs[0].to[1], d.legs[1].to[1]) + b.footLen;
    expect(d.placed[0]?.clipBelow).toBeCloseTo(floor - 1, 6);
  });

  test("AC-84-5: 体型は身長 3 段・体格 3 段。高いほど脚が長く、しっかりほど肩が広い", () => {
    expect(HEIGHTS).toEqual([150, 160, 170]);
    expect(BUILDS).toEqual(["slim", "regular", "sturdy"]);
    expect(body(170).legLen).toBeGreaterThan(body(150).legLen);
    expect(body(160, "sturdy").shoulder).toBeGreaterThan(body(160, "slim").shoulder);
    // どの体型でも足の裏が台の中
    for (const h of HEIGHTS)
      for (const k of BUILDS) {
        const d = dress([], { body: body(h, k) });
        expect(d.legs[0].to[1] + d.body.footLen).toBeLessThan(180);
        expect(d.body.headTop).toBeGreaterThan(0);
      }
  });
});

describe("指の直し (#83)", () => {
  test("AC-83-5: 服の直しは、肩先の真ん中を中心にずらす・大きさ・傾き。相似変換のまま", () => {
    const plain = dress([longTop]).placed[0]?.m as Mat;
    const moved = dress([longTop], { adj: { top: [2, -1, 1.2, 10] } }).placed[0]?.m as Mat;
    isSimilar(moved);
    const b = body();
    const mid = apply(plain, [50, 10]);
    close(mid, [0, b.shoulderY]);
    close(apply(moved, [50, 10]), [mid[0] + 2, mid[1] - 1]);
    expect(Math.hypot(moved[0], moved[1]) / Math.hypot(plain[0], plain[1])).toBeCloseTo(1.2, 9);
  });

  test("AC-83-3: マネキンの直し: 手で決めた腕・脚の角度は袖口より優先。全体の大きさ・傾き・位置", () => {
    const pose = {
      ...NO_POSE,
      s: 1.1,
      r: 5,
      dx: 1,
      dy: 2,
      arm: [40, null] as [number, null],
      leg: [null, 12] as [null, number],
    };
    const d = dress([longTop], { pose });
    expect(d.arms[0].angle).toBe(40);
    expect(d.arms[1].angle).toBe(dress([longTop], { pose: { ...pose, arm: [null, null] } }).arms[1].angle);
    expect(d.legs[1].angle).toBe(12);
    isSimilar(d.pose);
    close(apply(d.pose, [0, 90]), [1, 92]);
    // マネキンを動かしても、腕は (マネキンの中で) 服の袖口へ向く
    const moved = dress([longTop], { pose: { ...NO_POSE, dx: 3 } });
    expect(moved.arms[0].angle).not.toBe(dress([longTop]).arms[0].angle);
  });

  test("AC-83-3: くつは直したマネキンの足に付いていく", () => {
    const shoes = piece("shoes", (DEFAULT_FIT.shoes as Fit).p);
    const d = dress([shoes], { pose: { ...NO_POSE, dx: 5 }, adj: { shoes: [0, 0, 1.1, 0] } });
    const foot = apply(d.pose, d.legs[0].to);
    expect(apply((d.placed[0] as { m: Mat }).m, [24, 98])[0]).toBeCloseTo(foot[0], 6);
  });
});

/** 文字の絵 (# が服) を Mask に。 */
function art(rows: string[]): { a: Mask; w: number; h: number } {
  return { a: (x, y) => rows[y]?.[x] === "#", w: rows[0]?.length ?? 0, h: rows.length };
}

describe("印を推し量る (#81 のはじめの位置・印のない服)", () => {
  test("AC-81-3: T シャツ形: 肩先は襟より外の角、袖口は肩先より外で一番遠いところ", () => {
    const { a, w, h } = art([
      "........####........",
      "......########......",
      ".....##########.....",
      "....############....",
      "..################..",
      ".##################.",
      "####.##########.####",
      "###..##########..###",
      ".....##########.....",
      ".....##########.....",
      ".....##########.....",
      ".....##########.....",
    ]);
    const f = guessFit("top", a, w, h);
    expect(f.p).toHaveLength(4);
    const [l, r, lc, rc] = f.p as [Pt, Pt, Pt, Pt];
    expect(l[0]).toBeLessThan(r[0]);
    expect(lc[0]).toBeLessThan(l[0]);
    expect(rc[0]).toBeGreaterThan(r[0]);
    for (const p of f.p) for (const v of p) expect(v).toBeGreaterThanOrEqual(0);
  });

  test("AC-81-3: ワンピースは広がった裾を袖口と取り違えない (上半分だけ)", () => {
    const { a, w, h } = art([
      "....######....",
      "....######....",
      "....######....",
      "...########...",
      "..##########..",
      ".############.",
      "##############",
      "##############",
    ]);
    const f = guessFit("dress", a, w, h);
    expect((f.p[2] as Pt)[1]).toBeLessThanOrEqual(0.6);
  });

  test("AC-81-3: ズボンは裾の真ん中 2 つ、スカートは裾の印なし", () => {
    const pants = art(["##########", "##########", "####..####", "###....###", "###....###"]);
    const fp = guessFit("bottom", pants.a, pants.w, pants.h);
    expect(fp.p).toHaveLength(4);
    expect((fp.p[2] as Pt)[0]).toBeCloseTo(0.15, 6);
    expect((fp.p[3] as Pt)[0]).toBeCloseTo(0.85, 6);
    const skirt = art(["..######..", ".########.", "##########"]);
    expect(guessFit("bottom", skirt.a, skirt.w, skirt.h).p).toHaveLength(2);
  });

  test("AC-81-3: くつは左右のすき間で分け、それぞれの底の両端。すき間がなければ真ん中で", () => {
    const pair = art(["............", "###....####.", "####...#####"]);
    const f = guessFit("shoes", pair.a, pair.w, pair.h);
    expect(f.p.map((p) => p[0])).toEqual([0.0417, 0.2917, 0.625, 0.9583]);
    const one = art(["########"]);
    expect(guessFit("shoes", one.a, one.w, one.h).p).toHaveLength(4);
  });

  test("AC-81-3: こもの (帽子) は一番幅の広い行の両端、置き場所は頭", () => {
    const hat = art(["...####...", "..######..", "##########", "..######.."]);
    const f = guessFit("accessory", hat.a, hat.w, hat.h);
    expect(f.at).toBe("head");
    expect(f.p).toEqual([
      [0.05, 0.625],
      [0.95, 0.625],
    ]);
  });

  test("服の画素がなければ、その種類のふつうの印", () => {
    const empty = art(["....", "...."]);
    expect(guessFit("bottom", empty.a, empty.w, empty.h)).toEqual(DEFAULT_FIT.bottom);
    expect(guessFit("socks", empty.a, empty.w, empty.h)).toEqual(DEFAULT_FIT.top);
  });

  test("cropFit と uncropFit は逆 (切り抜いた写真の上と、保存した写真の上)", () => {
    const u = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(fc.array(fc.tuple(u, u), { minLength: 2, maxLength: 6 }), (p) => {
        const box = { x: 10, y: 20, w: 300, h: 500 };
        const fit: Fit = { v: 1, p: p as Pt[], at: "neck" };
        const back = uncropFit(cropFit(fit, 400, 600, box), 400, 600, box);
        expect(back.at).toBe("neck");
        back.p.forEach((q, i) => close(q, p[i] as Pt, 1e-3));
      }),
      runs(),
    );
  });
});
