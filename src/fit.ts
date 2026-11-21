// 着せ替え v2 の幾何 (docs/spec-v2-fitting.md)。写真を体に合わせるのではなく、体 (マネキン) を服に合わせる。
// 台の上はセンチの世界: x は体の真ん中が 0 (画面の左が負)、y は台の上の端が 0 (下へ正)。
// 服の写真は「印 2 点を体の 2 点に重ねる相似変換」だけで置く (曲げない・切らない)。
// 腕は一番外の服の袖口へ、脚はボトムスの裾へ向けて描く。

export type Pt = [number, number];
export type Place = "head" | "neck" | "hand";

/** 型紙の印。点は写真の幅・高さに対する割合 (0〜1)。並びは種類ごとに ANCHORS のとおり。 */
export interface Fit {
  v: 1;
  p: Pt[];
  at?: Place | undefined;
}

/** 台の大きさ (cm)。画面の台 (200×400px) と同じ縦横比。 */
export const STAGE = { w: 90, h: 180 } as const;

/** 身長 (cm) と体格の段。端末にだけ置く (DATA.md)。 */
export const HEIGHTS = [150, 160, 170] as const;
export const BUILDS = ["slim", "regular", "sturdy"] as const;
export type Height = (typeof HEIGHTS)[number];
export type Build = (typeof BUILDS)[number];
export const BUILD_NAMES: Record<Build, string> = { slim: "ほそめ", regular: "ふつう", sturdy: "しっかり" };
const BUILD_K: Record<Build, number> = { slim: 0.92, regular: 1, sturdy: 1.1 };

/** マネキンの寸法 (cm)。x は真ん中からの距離、y は台の上の端から。 */
export interface Body {
  headTop: number;
  headW: number;
  chin: number;
  neckW: number;
  /** 肩の線の高さと、肩先の x (服の肩先を重ねる点) */
  shoulderY: number;
  shoulder: number;
  /** 腕の付け根 (関節) */
  armJoint: Pt;
  armLen: number;
  handLen: number;
  chest: [number, number];
  waist: [number, number];
  hip: [number, number];
  /** ボトムスのウエスト (平置きの幅の半分) を重ねる x と高さ (腰骨のあたり) */
  waistFlat: Pt;
  crotch: number;
  legJoint: Pt;
  legLen: number;
  footLen: number;
  footW: number;
}

export function body(height: Height = 160, build: Build = "regular"): Body {
  const k = height / 160;
  const b = BUILD_K[build];
  const y = (v: number) => 10 + (v - 10) * k;
  const x = (v: number) => v * b * (0.5 + 0.5 * k);
  return {
    headTop: 10 + (160 - height) * 0.6,
    headW: 15 * (0.5 + 0.5 * k),
    chin: y(32) + (160 - height) * 0.6,
    neckW: x(10),
    shoulderY: y(38) + (160 - height) * 0.6,
    shoulder: x(19.5),
    armJoint: [x(17), y(40.5) + (160 - height) * 0.6],
    armLen: 52 * k,
    handLen: 16 * k,
    chest: [y(50) + (160 - height) * 0.6, x(15)],
    waist: [y(68) + (160 - height) * 0.6, x(13)],
    hip: [y(82) + (160 - height) * 0.6, x(17)],
    waistFlat: [x(18), y(74) + (160 - height) * 0.6],
    crotch: y(88) + (160 - height) * 0.6,
    legJoint: [x(8.5), y(88) + (160 - height) * 0.6],
    legLen: 72 * k,
    footLen: 7 * k,
    footW: 8 * (0.5 + 0.5 * k),
  };
}

/** 種類ごとの印の名前 (画面の左から)。最初の 2 つが置く場所を決め、残りは腕・脚・くつのため。 */
export const ANCHORS: Record<string, string[]> = {
  top: ["左の肩先", "右の肩先", "左の袖口", "右の袖口"],
  outer: ["左の肩先", "右の肩先", "左の袖口", "右の袖口"],
  dress: ["左の肩先", "右の肩先", "左の袖口", "右の袖口"],
  bottom: ["ウエストの左端", "ウエストの右端", "左の裾の真ん中", "右の裾の真ん中"],
  shoes: ["左のくつの左端", "左のくつの右端", "右のくつの左端", "右のくつの右端"],
  accessory: ["左の端", "右の端"],
};

/** こものの置き場所の名前。 */
export const PLACE_NAMES: Record<Place, string> = { head: "頭", neck: "首", hand: "手" };

/** 写真のことが何も分からないときの印 (切り抜きの箱いっぱいに服があるとみなす)。 */
export const DEFAULT_FIT: Record<string, Fit> = {
  top: {
    v: 1,
    p: [
      [0.22, 0.06],
      [0.78, 0.06],
      [0.04, 0.55],
      [0.96, 0.55],
    ],
  },
  outer: {
    v: 1,
    p: [
      [0.22, 0.06],
      [0.78, 0.06],
      [0.04, 0.7],
      [0.96, 0.7],
    ],
  },
  dress: {
    v: 1,
    p: [
      [0.3, 0.04],
      [0.7, 0.04],
    ],
  },
  bottom: {
    v: 1,
    p: [
      [0.08, 0.02],
      [0.92, 0.02],
      [0.27, 0.98],
      [0.73, 0.98],
    ],
  },
  shoes: {
    v: 1,
    p: [
      [0.02, 0.98],
      [0.46, 0.98],
      [0.54, 0.98],
      [0.98, 0.98],
    ],
  },
  accessory: {
    v: 1,
    p: [
      [0.02, 0.7],
      [0.98, 0.7],
    ],
    at: "head",
  },
};

// ---- 行列 (SVG の matrix(a b c d e f) と同じ: x' = a x + c y + e, y' = b x + d y + f) ----

export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function apply(m: Mat, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** m2 のあとに m1 (m1 · m2)。 */
export function mul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** 中心 o のまわりに、倍率 s・角度 deg (時計回り) だけ回し、(dx, dy) ずらす。 */
export function around(o: Pt, s: number, deg: number, dx = 0, dy = 0): Mat {
  const r = (deg * Math.PI) / 180;
  const a = s * Math.cos(r);
  const b = s * Math.sin(r);
  return [a, b, -b, a, o[0] + dx - (a * o[0] - b * o[1]), o[1] + dy - (b * o[0] + a * o[1])];
}

/** p0→q0・p1→q1 に重ねる相似変換 (拡大縮小・回転・平行移動だけ。曲げない)。p0 と p1 が重なれば null。 */
export function similarity(p0: Pt, p1: Pt, q0: Pt, q1: Pt): Mat | null {
  const vx = p1[0] - p0[0];
  const vy = p1[1] - p0[1];
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-9) return null;
  const ux = q1[0] - q0[0];
  const uy = q1[1] - q0[1];
  // 複素数で (u / v) = a + b i
  const a = (ux * vx + uy * vy) / len2;
  const b = (uy * vx - ux * vy) / len2;
  return [a, b, -b, a, q0[0] - (a * p0[0] - b * p0[1]), q0[1] - (b * p0[0] + a * p0[1])];
}

// ---- 着せる ----

/** 台に置く写真のこと。w・h は写真 (切り抜いたもの) の画素の大きさ、fit はその写真に対する印。 */
export interface Piece {
  id: string;
  kind: string;
  w: number;
  h: number;
  fit: Fit;
}

/** 指の直し: [横にずらす cm, 縦にずらす cm, 倍率, 角度]。 */
export type Adj = [number, number, number, number];

/** マネキンの指の直し。arm・leg は真下が 0、外へ正 (度)。null は自動。 */
export interface Pose {
  s: number;
  r: number;
  dx: number;
  dy: number;
  arm: [number | null, number | null];
  leg: [number | null, number | null];
}

export const NO_POSE: Pose = { s: 1, r: 0, dx: 0, dy: 0, arm: [null, null], leg: [null, null] };

/** 腕・脚の角度の範囲 (度。真下が 0、外へ正)。 */
export const ARM_RANGE = [3, 60] as const;
export const LEG_RANGE = [1, 20] as const;
export const ARM_DEFAULT = 10;
export const LEG_DEFAULT = 3;
/** 袖口が付け根からこれより近ければ (cm)、袖なしとみなして腕は既定の角度。 */
export const SLEEVELESS = 8;
/** 帽子のつばの幅の半分 (頭の幅に対する倍率)。 */
export const HAT_BRIM = 1.25;
/** くつの写真の左右の端を重ねる幅 (cm)。横から・斜めから撮ったくつが多いので、足の幅より長さに近い */
export const SHOE_W = 15;
/** アウターの前を開ける幅の半分 (cm)。 */
export const OPEN_GAP = 1.8;

export interface Limb {
  /** 付け根 (台の cm) */
  from: Pt;
  /** 先 (腕は手首、脚は足首) */
  to: Pt;
  /** 角度 (真下が 0、外へ正) */
  angle: number;
}

export interface Placed {
  id: string;
  kind: string;
  /** 写真の画素 → 台の cm */
  m: Mat;
  w: number;
  h: number;
  /** くつ: 左右どちらの半分か (写真の画素で x < split が左) */
  half?: "left" | "right";
  split?: number;
  /** この高さ (cm) より下を隠す (インするトップス・床より長いボトムス) */
  clipBelow?: number;
  /** 前を開けるアウターは、この x (cm) のまわり ±OPEN_GAP を、この高さより下で隠す */
  open?: { x: number; below: number };
}

export interface Dressed {
  body: Body;
  /** マネキン全体の変換 (指の直し) */
  pose: Mat;
  arms: [Limb, Limb];
  legs: [Limb, Limb];
  placed: Placed[];
}

/** 重ねる順 (下から)。マネキンはいつも一番下。 */
export const LAYER: Record<string, number> = {
  bottom: 1,
  shoes: 2,
  top: 3,
  dress: 3,
  outer: 4,
  accessory: 5,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** 印の点 i を写真の画素に (なければ null)。 */
function px(p: Piece, i: number): Pt | null {
  const f = p.fit.p[i];
  return f === undefined ? null : [f[0] * p.w, f[1] * p.h];
}

/** 付け根から角度 a (外へ正) の向き。side は -1 (画面の左) か 1。 */
function dir(side: -1 | 1, a: number): Pt {
  return [side * Math.sin(rad(a)), Math.cos(rad(a))];
}

/** 付け根 j から点 c へ向けた角度 (真下が 0、外へ正)。 */
function angleTo(side: -1 | 1, j: Pt, c: Pt): number {
  return deg(Math.atan2(side * (c[0] - j[0]), c[1] - j[1]));
}

function limb(side: -1 | 1, from: Pt, angle: number, len: number): Limb {
  const d = dir(side, angle);
  return { from, to: [from[0] + d[0] * len, from[1] + d[1] * len], angle };
}

/** 服の 2 点を重ねる体の点。こものの手は、手首 (wrist) に下げる。 */
function targets(kind: string, b: Body, at: Place | undefined, wrist: Pt): [Pt, Pt] | null {
  switch (kind) {
    case "top":
    case "dress":
      return [
        [-b.shoulder, b.shoulderY],
        [b.shoulder, b.shoulderY],
      ];
    case "outer":
      return [
        [-b.shoulder * 1.08, b.shoulderY - 0.5],
        [b.shoulder * 1.08, b.shoulderY - 0.5],
      ];
    case "bottom":
      return [
        [-b.waistFlat[0], b.waistFlat[1]],
        [b.waistFlat[0], b.waistFlat[1]],
      ];
    case "accessory":
      if (at === "neck")
        return [
          [-b.neckW, b.chin + 4],
          [b.neckW, b.chin + 4],
        ];
      if (at === "hand")
        return [
          [wrist[0] - 4, wrist[1] + 8],
          [wrist[0] + 4, wrist[1] + 8],
        ];
      return [
        [-b.headW * HAT_BRIM, b.headTop + 8],
        [b.headW * HAT_BRIM, b.headTop + 8],
      ];
  }
  return null;
}

export interface DressOptions {
  body?: Body;
  adj?: Record<string, Adj>;
  pose?: Pose;
  /** トップスをボトムスにインする */
  tuck?: boolean;
}

/** 着た服から、マネキンの姿と写真の置き方を決める。pieces は重ねる順でなくてよい。 */
export function dress(pieces: Piece[], o: DressOptions = {}): Dressed {
  const b = o.body ?? body();
  const pose = o.pose ?? NO_POSE;
  const poseM = around([0, STAGE.h / 2], pose.s, pose.r, pose.dx, pose.dy);
  const toBody = invert(poseM);
  const sorted = [...pieces].sort((p, q) => (LAYER[p.kind] ?? 9) - (LAYER[q.kind] ?? 9));
  const adjOf = (id: string, t: [Pt, Pt], m: Mat): Mat => {
    const a = o.adj?.[id];
    if (a === undefined) return m;
    const mid: Pt = [(t[0][0] + t[1][0]) / 2, (t[0][1] + t[1][1]) / 2];
    return mul(around(mid, a[2], a[3], a[0], a[1]), m);
  };

  // 腕: 一番外の袖のある服 (アウター > トップス・ワンピース) の袖口へ。マネキンの中の座標で決める
  const placeOf = (p: Piece, wrist: Pt): Mat | null => {
    const t = targets(p.kind, b, p.fit.at, wrist);
    const p0 = px(p, 0);
    const p1 = px(p, 1);
    if (t === null || p0 === null || p1 === null) return null;
    const m = similarity(p0, p1, t[0], t[1]);
    return m === null ? null : adjOf(p.id, t, m);
  };
  const sleeved = [...sorted]
    .reverse()
    .find((p) => p.kind === "outer" || p.kind === "top" || p.kind === "dress");
  const sides: [-1, 1] = [-1, 1];
  const arms = sides.map((side, i) => {
    const j: Pt = [side * b.armJoint[0], b.armJoint[1]];
    const manual = pose.arm[i];
    if (manual !== null && manual !== undefined) return limb(side, j, clamp(manual, -90, 90), b.armLen);
    const m = sleeved === undefined ? null : placeOf(sleeved, [0, 0]);
    const cuffPx = sleeved === undefined ? null : px(sleeved, 2 + i);
    if (m === null || cuffPx === null) return limb(side, j, ARM_DEFAULT, b.armLen);
    // 服は台の座標で置くので、袖口をマネキンの中の座標に直す
    const c = apply(toBody, apply(m, cuffPx));
    const d = Math.hypot(c[0] - j[0], c[1] - j[1]);
    if (d < SLEEVELESS) return limb(side, j, ARM_DEFAULT, b.armLen);
    const a = clamp(angleTo(side, j, c), ARM_RANGE[0], ARM_RANGE[1]);
    // 長袖は手首が袖口に (腕より少し長くてもよい)、半袖は腕の長さまで
    return limb(side, j, a, clamp(d, b.armLen, b.armLen * 1.15));
  }) as [Limb, Limb];

  // 脚: ボトムスの裾の真ん中へ。スカート (裾の印がない) とワンピースは既定の開き
  const bottom = sorted.find((p) => p.kind === "bottom");
  const legs = sides.map((side, i) => {
    const j: Pt = [side * b.legJoint[0], b.legJoint[1]];
    const manual = pose.leg[i];
    if (manual !== null && manual !== undefined) return limb(side, j, clamp(manual, -45, 45), b.legLen);
    const m = bottom === undefined ? null : placeOf(bottom, [0, 0]);
    const hemPx = bottom === undefined ? null : px(bottom, 2 + i);
    if (m === null || hemPx === null) return limb(side, j, LEG_DEFAULT, b.legLen);
    const hem = apply(toBody, apply(m, hemPx));
    return limb(side, j, clamp(angleTo(side, j, hem), LEG_RANGE[0], LEG_RANGE[1]), b.legLen);
  }) as [Limb, Limb];

  const toStage = (p: Pt) => apply(poseM, p);
  const wrist = toStage(arms[1].to);
  const tucked = o.tuck === true && sorted.some((p) => p.kind === "bottom");
  const inner = sorted.some((p) => p.kind === "top" || p.kind === "dress");
  const placed: Placed[] = [];
  for (const p of sorted) {
    if (p.kind === "shoes") {
      placed.push(...shoes(p, b, legs, poseM, o.adj?.[p.id]));
      continue;
    }
    const m = placeOf(p, wrist);
    if (m === null) continue;
    const it: Placed = { id: p.id, kind: p.kind, m, w: p.w, h: p.h };
    if (p.kind === "top" && tucked) it.clipBelow = b.waistFlat[1] + 3;
    // 床より下に出る裾は隠す (写真は曲げない)
    if (p.kind === "bottom" || p.kind === "dress") it.clipBelow = floorOf(b, legs, poseM) - 1;
    if (p.kind === "outer" && inner) {
      // 前の真ん中は肩先の真ん中の真下 (印から決める)
      const [q0, q1] = [px(p, 0) as Pt, px(p, 1) as Pt];
      const mid = apply(m, [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2]);
      it.open = { x: mid[0], below: mid[1] + 3 };
    }
    placed.push(it);
  }
  return { body: b, pose: poseM, arms, legs, placed };
}

/** 床 (足の裏) の高さ (台の cm)。 */
function floorOf(b: Body, legs: [Limb, Limb], poseM: Mat): number {
  return Math.max(...legs.map((l) => apply(poseM, l.to)[1])) + b.footLen;
}

/** くつ: 左右のくつを、それぞれの足に。履き口は足首、底の幅は足の幅より一回り大きく。 */
function shoes(p: Piece, b: Body, legs: [Limb, Limb], poseM: Mat, a: Adj | undefined): Placed[] {
  const out: Placed[] = [];
  const l0 = px(p, 0);
  const l1 = px(p, 1);
  const r0 = px(p, 2);
  const r1 = px(p, 3);
  if (l0 === null || l1 === null || r0 === null || r1 === null) return out;
  const split = (Math.max(l0[0], l1[0]) + Math.min(r0[0], r1[0])) / 2;
  const pairs: [Pt, Pt][] = [
    [l0, l1],
    [r0, r1],
  ];
  pairs.forEach(([e0, e1], i) => {
    const ankle = apply(poseM, legs[i]?.to ?? [0, 0]);
    const sole = ankle[1] + b.footLen;
    const half = (SHOE_W / 2) * (b.footW / 8);
    const t: [Pt, Pt] = [
      [ankle[0] - half, sole],
      [ankle[0] + half, sole],
    ];
    let m = similarity(e0, e1, t[0], t[1]);
    if (m === null) return;
    if (a !== undefined) m = mul(around([ankle[0], sole], a[2], a[3], a[0], a[1]), m);
    out.push({ id: p.id, kind: "shoes", m, w: p.w, h: p.h, half: i === 0 ? "left" : "right", split });
  });
  return out;
}

// ---- 写真から印を推し量る (登録のはじめの位置・印のない服) ----

/** a(x, y) が服の画素か。w・h は写真の大きさ。 */
export type Mask = (x: number, y: number) => boolean;

function rowSpan(a: Mask, w: number, y: number): [number, number] | null {
  let lo = -1;
  let hi = -1;
  for (let x = 0; x < w; x++)
    if (a(x, y)) {
      if (lo < 0) lo = x;
      hi = x;
    }
  return lo < 0 ? null : [lo, hi];
}

/** 行 y の、服の画素のつながり (始まり・終わり) の並び。 */
function runs(a: Mask, w: number, y: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && a(x, y);
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      out.push([start, x - 1]);
      start = -1;
    }
  }
  return out;
}

/** 服の画素を囲む箱 (なければ null)。 */
function bounds(a: Mask, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (a(x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const frac = (w: number, h: number, x: number, y: number): Pt => [
  Math.round((clamp(x + 0.5, 0, w) / w) * 1e4) / 1e4,
  Math.round((clamp(y + 0.5, 0, h) / h) * 1e4) / 1e4,
];

/**
 * 肩先: 服の左 (side -1) か右 (1) の輪郭を上から y1 までたどり、なだらかに外へ広がる肩の線 (傾き 1 より寝ている) が
 * 終わって、袖・身ごろで下へ折れるところ。襟の縦の線は飛ばす。肩の線が見つからなければ y1 の行の端。
 */
function shoulderOf(a: Mask, w: number, y0: number, y1: number, side: -1 | 1, k: number): Pt {
  const edge = (y: number): number | null => {
    const sp = rowSpan(a, w, y);
    return sp === null ? null : side < 0 ? sp[0] : sp[1];
  };
  let last: Pt | null = null;
  for (let y = y0; y + k <= y1; y++) {
    const e0 = edge(y);
    const e1 = edge(y + k);
    if (e0 === null || e1 === null) continue;
    // 外へ k 行で k より多く広がる (45° より寝ている) なら、肩の線の途中
    if (side * (e1 - e0) > k) last = [e1, y + k];
  }
  return last ?? [edge(y1) ?? 0, y1];
}

/** 服の形 (切り抜いたあとの画素) から、種類ごとの印を推し量る。人が確かめる前のはじめの位置。 */
export function guessFit(kind: string, a: Mask, w: number, h: number): Fit {
  const fallback = DEFAULT_FIT[kind] ?? (DEFAULT_FIT.top as Fit);
  const bx = bounds(a, w, h);
  if (bx === null) return fallback;
  const bh = bx.y1 - bx.y0 + 1;
  const at = (fy: number) => Math.min(bx.y1, bx.y0 + Math.round(bh * fy));
  const f = (x: number, y: number) => frac(w, h, x, y);
  if (kind === "top" || kind === "outer" || kind === "dress") {
    const k = Math.max(2, Math.round(bh * 0.03));
    const l = shoulderOf(a, w, bx.y0, at(0.5), -1, k);
    const r = shoulderOf(a, w, bx.y0, at(0.5), 1, k);
    // 袖口: 肩先より外の画素のうち、肩先から遠いところ (一番遠い距離の 9 割より先) の真ん中。
    // ワンピースのすそ (広がった裾) を拾わないよう、上の方だけ
    const lowest = kind === "dress" ? at(0.5) : bx.y1;
    const margin = Math.max(1, Math.round((bx.x1 - bx.x0) * 0.02));
    const cuff = (sh: Pt, outside: (x: number) => boolean): Pt => {
      const pts: [number, number, number][] = [];
      let far = 0;
      for (let y = sh[1]; y <= lowest; y++)
        for (let x = bx.x0; x <= bx.x1; x++)
          if (a(x, y) && outside(x)) {
            const d = Math.hypot(x - sh[0], y - sh[1]);
            far = Math.max(far, d);
            pts.push([x, y, d]);
          }
      const tip = pts.filter((q) => q[2] >= far * 0.9);
      if (tip.length === 0) return sh;
      return [tip.reduce((s, q) => s + q[0], 0) / tip.length, tip.reduce((s, q) => s + q[1], 0) / tip.length];
    };
    const lc = cuff(l, (x) => x <= l[0] - margin);
    const rc = cuff(r, (x) => x >= r[0] + margin);
    return { v: 1, p: [f(...l), f(...r), f(...lc), f(...rc)] };
  }
  if (kind === "bottom") {
    const yw = at(0.02);
    const sp = rowSpan(a, w, yw) as [number, number];
    const yh = at(0.97);
    const rs = runs(a, w, yh);
    const p: Pt[] = [f(sp[0], yw), f(sp[1], yw)];
    const first = rs[0] as [number, number];
    const last = rs[rs.length - 1] as [number, number];
    // 裾が 2 つに分かれていればズボン。1 つならスカート (裾の印なし)
    if (rs.length >= 2) p.push(f((first[0] + first[1]) / 2, yh), f((last[0] + last[1]) / 2, yh));
    return { v: 1, p };
  }
  if (kind === "shoes") {
    // 列ごとに服の画素があるか。一番広いすき間で左右に分ける (なければ真ん中)
    const col = (x: number) => {
      for (let y = bx.y0; y <= bx.y1; y++) if (a(x, y)) return true;
      return false;
    };
    let gap: [number, number] | null = null;
    let start = -1;
    for (let x = bx.x0; x <= bx.x1; x++) {
      if (!col(x)) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        if (gap === null || x - start > gap[1] - gap[0]) gap = [start, x];
        start = -1;
      }
    }
    const split = gap === null ? (bx.x0 + bx.x1) / 2 : (gap[0] + gap[1]) / 2;
    const sole = (x0: number, x1: number): [Pt, Pt] => {
      let lo = x1;
      let hi = x0;
      let low = bx.y0;
      for (let y = bx.y0; y <= bx.y1; y++)
        for (let x = Math.ceil(x0); x <= Math.floor(x1); x++)
          if (a(x, y)) {
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
            low = Math.max(low, y);
          }
      return [f(lo, low), f(hi, low)];
    };
    return { v: 1, p: [...sole(bx.x0, split), ...sole(split, bx.x1)] };
  }
  // こもの: 一番幅の広い行の両端 (帽子ならつば)
  let best: [number, number, number] = [bx.x0, bx.x1, bx.y1];
  let bw = -1;
  for (let y = bx.y0; y <= bx.y1; y++) {
    const sp = rowSpan(a, w, y);
    if (sp !== null && sp[1] - sp[0] > bw) {
      bw = sp[1] - sp[0];
      best = [sp[0], sp[1], y];
    }
  }
  return { v: 1, p: [f(best[0], best[2]), f(best[1], best[2])], at: "head" };
}

/**
 * 保存した写真に対する印を、切り抜いた写真 (box で切り詰めたもの) に対する印に直す。
 * w・h は切り抜く前の写真の大きさ (box と同じ縮尺)。
 */
export function cropFit(
  fit: Fit,
  w: number,
  h: number,
  box: { x: number; y: number; w: number; h: number },
): Fit {
  return {
    ...fit,
    p: fit.p.map(([x, y]) => [(x * w - box.x) / box.w, (y * h - box.y) / box.h] as Pt),
  };
}

/** cropFit の逆 (切り抜いた写真の上で合わせた印を、保存した写真に対する印に)。 */
export function uncropFit(
  fit: Fit,
  w: number,
  h: number,
  box: { x: number; y: number; w: number; h: number },
): Fit {
  return {
    ...fit,
    p: fit.p.map(
      ([x, y]) =>
        [
          Math.round(clamp((x * box.w + box.x) / w, 0, 1) * 1e4) / 1e4,
          Math.round(clamp((y * box.h + box.y) / h, 0, 1) * 1e4) / 1e4,
        ] as Pt,
    ),
  };
}
