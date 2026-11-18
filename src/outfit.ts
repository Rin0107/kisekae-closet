// 着せ替えの決まり (純粋な関数。UI も保存も知らない)。
// - 服は種類ごとに 1 枚。同じ種類を着ると入れ替わる。ワンピースは上下と入れ替わる
// - 暖かさゲージ: 着ている服の暖かさの合計が、天気から決めた帯 (寒い・ちょうどいい・暑い) のどこに入るか
import { average, targetWarmth, type Item } from "./recommend";
import type { Weather } from "./weather";

/**
 * アバターの台の中で、種類ごとに服の写真を置く場所 (台に対する %)。重なりの順は z。
 * - fit "width": 写真の幅を width に合わせ、縦は写真の縦横比のまま (曲げない・縮めて細くしない)。丈は服しだいで、height は目安
 * - fit "box": width × height の箱に収める (くつ・こもの)
 */
export interface Slot {
  top: number;
  left: number;
  width: number;
  height: number;
  z: number;
  fit: "width" | "box";
}

/**
 * 体の絵 (public/avatar/body.webp、400×800) の目印 (台に対する %)。絵の画素を測った値 (2026-11-19)。
 * 下着 (白) は首の付け根から腰の下まで、幅は胸と腰で一番広い。腕は肩から斜め下に開く。
 */
export const BODY = {
  /** 下着の上の端 (首の付け根)・下の端 (腰の下) */
  neck: 16.3,
  hip: 52,
  /** 下着の左右の端 (一番広いところ) */
  torsoLeft: 32.8,
  torsoRight: 67,
  /** 肩の高さ */
  shoulder: 17.5,
  /** 腕の外側の線: 肩 (shoulder の高さ) で torsoLeft、そこから下へ 1% ごとに外へ armSlope % 開く */
  armSlope: 1.4,
  /** 足首の高さ・足の裏 (2026-11-19 に測り直した、#32 #33) */
  ankle: 88.5,
  sole: 93,
  /** 左右の足の真ん中 (足は左右に開いている。足の幅は 22.8〜33.3% と 66.8〜77.3%) */
  feet: [28, 72],
  footWidth: 10.5,
} as const;

/**
 * ハンガーにかけて撮ったトップスの、袖を除いた身ごろの幅が写真の幅に占める割合のうち、狭いほう (半袖を広げた形)。
 * これでも胴を覆うように、トップスの幅を決める。
 */
export const BODICE_SHARE = 0.52;

/**
 * shoes は写真の形が分からないときの目安 (着せるときは shoeFeet で左右の足に分ける、#32)。
 * outer はトップスより一回り大きく、少し下から始める (中のトップスの襟元がのぞく、#33)。
 */
export const SLOTS: Record<string, Slot> = {
  shoes: { top: 86, left: 22, width: 56, height: 8, z: 1, fit: "box" },
  bottom: { top: 42, left: 26, width: 48, height: 50, z: 2, fit: "width" },
  top: { top: 12.5, left: 16, width: 68, height: 36, z: 3, fit: "width" },
  dress: { top: 12.5, left: 16, width: 68, height: 56, z: 3, fit: "width" },
  outer: { top: 14.2, left: 13, width: 74, height: 42, z: 4, fit: "width" },
  accessory: { top: 38, left: 72, width: 24, height: 17, z: 5, fit: "box" },
};

/** 台の縦横比 (幅 ÷ 高さ)。幅の % を高さの % に直すのに使う。どの画面幅でも同じ (#34)。 */
export const STAGE_RATIO = 1 / 2;

/** 台の上の箱 (台に対する %)。height が null なら写真の縦横比のまま (曲げない)。 */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number | null;
}

/** ボトムスの幅の範囲 (%)。下は腰の下着を覆う幅 (写真の幅の 3/4 が腰)、上は太く見えすぎない幅。 */
export const BOTTOM_MIN_WIDTH = 46;
export const BOTTOM_MAX_WIDTH = 60;

/**
 * 服を置く箱。ratio は写真の 縦 ÷ 横 (分からなければ null)。
 * - ボトムス: 丈を先に決める (#33)。腰から足首まで届く幅にし、腰を覆う幅を下回らず、太すぎない範囲に収める
 * - ほかは SLOTS のまま (幅で合わせ、縦は写真のまま)
 */
export function place(kind: string, ratio: number | null): Box | null {
  const s = SLOTS[kind];
  if (s === undefined) return null;
  if (kind === "bottom" && ratio !== null && ratio > 0) {
    const want = (BODY.ankle - s.top) / (STAGE_RATIO * ratio);
    const width = Math.min(BOTTOM_MAX_WIDTH, Math.max(BOTTOM_MIN_WIDTH, want));
    return { top: s.top, left: 50 - width / 2, width, height: null };
  }
  return { top: s.top, left: s.left, width: s.width, height: s.fit === "box" ? s.height : null };
}

/** 片足のくつの箱の大きさの上限 (%)。 */
export const FOOT_BOX = { width: 13, height: 8 };

/**
 * くつの写真 (2 足を並べて撮ったもの) を左右の半分に分け、それぞれを左右の足に置く箱 (#32)。
 * ratio は写真全体の 縦 ÷ 横 (分からなければ 2 足が正方形ずつ並んだ形とみなす)。
 * 半分の写真は曲げず、FOOT_BOX に収まる大きさにして、足の真ん中・足の裏にそろえる。
 */
export function shoeFeet(ratio: number | null): [Box, Box] {
  const half = ratio !== null && ratio > 0 ? 2 * ratio : 1; // 半分の 縦 ÷ 横
  // 高さ (%) = 幅 (%) × STAGE_RATIO × half
  const width = Math.min(FOOT_BOX.width, FOOT_BOX.height / (STAGE_RATIO * half));
  const height = width * STAGE_RATIO * half;
  const at = (cx: number): Box => ({ top: BODY.sole + 0.5 - height, left: cx - width / 2, width, height });
  return [at(BODY.feet[0]), at(BODY.feet[1])];
}

/** 一緒に着られない種類 (着ると外れる)。 */
const CLASHES: Record<string, string[]> = {
  dress: ["top", "bottom"],
  top: ["dress"],
  bottom: ["dress"],
};

/** item を着た後の服。同じ種類・一緒に着られない種類は外れる。並びは重なりの順。 */
export function wear<T extends Item>(worn: T[], item: T): T[] {
  const off = new Set([item.kind, ...(CLASHES[item.kind] ?? [])]);
  return [...worn.filter((i) => !off.has(i.kind)), item].sort(
    (a, b) => (SLOTS[a.kind]?.z ?? 9) - (SLOTS[b.kind]?.z ?? 9),
  );
}

/** item を脱いだ後の服。 */
export function takeOff<T extends Item>(worn: T[], id: string): T[] {
  return worn.filter((i) => i.id !== id);
}

/** 暖かさに数える種類 (おすすめと同じ。くつ・こものは数えない)。 */
const COUNTED = new Set(["top", "bottom", "dress", "outer"]);

export type Band = "cold" | "ok" | "hot";
export const BAND_NAMES: Record<Band, string> = { cold: "寒い", ok: "ちょうどいい", hot: "暑い" };

export interface Gauge {
  band: Band;
  /** 帯の上のつまみの位置 (0 = 一番寒い、1 = 一番暑い)。 */
  position: number;
}

/** 天気から、ちょうどいい暖かさの合計。雨の日は 1 つ上げる。 */
export function idealWarmth(w: Weather): number {
  return targetWarmth(average(w)) + (w.precip >= 1 ? 1 : 0);
}

/** ちょうどいいの帯の幅 (目標から ±この値)。 */
export const OK_RANGE = 1;
/** ゲージの端 (目標から ±この値で端に着く)。 */
export const GAUGE_SPAN = 5;

export function gauge(worn: Item[], w: Weather): Gauge {
  const sum = worn.filter((i) => COUNTED.has(i.kind)).reduce((s, i) => s + i.warmth, 0);
  const diff = sum - idealWarmth(w);
  const band: Band = diff < -OK_RANGE ? "cold" : diff > OK_RANGE ? "hot" : "ok";
  const position = Math.min(1, Math.max(0, 0.5 + diff / (2 * GAUGE_SPAN)));
  return { band, position };
}

/** ID の並びから、手持ちにある服だけを着せる (消した服は飛ばす)。 */
export function dressIn<T extends Item>(items: T[], ids: string[]): T[] {
  let worn: T[] = [];
  for (const id of ids) {
    const it = items.find((i) => i.id === id);
    if (it !== undefined) worn = wear(worn, it);
  }
  return worn;
}

// ---- 袖を腕に沿わせる・アウターを前開きに (#37 #38) ----

/** 腕の向き (縦から外へ何度)。台の 1% は横と縦で 1:2 なので、横 armSlope % ÷ 縦 1% を px に直す。 */
export const ARM_ANGLE = (Math.atan((BODY.armSlope * STAGE_RATIO) / 1) * 180) / Math.PI;

/** 写真の袖 (左右の端の BODICE_SHARE の外の帯) の形。px の値は写真の大きさに対する割合。 */
export interface Sleeve {
  /** 袖の付け根 (身ごろとの境の、袖の一番上) の高さ (写真の高さに対する 0〜1) */
  pivot: number;
  /** 写真の中の袖の向き (縦から外へ何度) */
  angle: number;
  /** 袖の先 (付け根から一番遠いところ)。写真の幅・高さに対する 0〜1 */
  tip: { x: number; y: number };
}

/** 写真の左右の帯の幅 (写真の幅に対する割合)。袖を除いた身ごろが BODICE_SHARE。 */
export const SLEEVE_SHARE = (1 - BODICE_SHARE) / 2;

/**
 * 切り抜いた写真の不透明な画素 (opaque(x, y)) から、左の袖の付け根と向きを測る。
 * 付け根は、左の帯の内側の端の一番上の画素。袖の先は、帯の中で付け根から一番遠い画素。
 * 帯の画素がほとんど全部不透明 (切り抜けていない写真) や、ほとんどない (袖なし) なら null (回さない)。
 * 右の袖は写真を左右反転して同じに測る (opaque に反転したものを渡す)。
 */
export function measureSleeve(
  opaque: (x: number, y: number) => boolean,
  w: number,
  h: number,
): Sleeve | null {
  const band = Math.max(1, Math.floor(w * SLEEVE_SHARE));
  let on = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < band; x++) if (opaque(x, y)) on++;
  const share = on / (band * h);
  if (share > 0.9 || share < 0.02) return null;
  // 付け根: 内側の端 (身ごろとの境) の列で一番上の不透明な画素
  const edge = band - 1;
  let top = -1;
  for (let y = 0; y < h && top < 0; y++) if (opaque(edge, y)) top = y;
  if (top < 0) return null;
  let best = 0;
  let tip = { x: edge, y: top };
  for (let y = top; y < h; y++)
    for (let x = 0; x < band; x++) {
      if (!opaque(x, y)) continue;
      const d = (edge - x) ** 2 + (y - top) ** 2;
      if (d > best) {
        best = d;
        tip = { x, y };
      }
    }
  if (best === 0) return null;
  const angle = (Math.atan2(edge - tip.x, tip.y - top) * 180) / Math.PI;
  return { pivot: top / h, angle, tip: { x: tip.x / w, y: tip.y / h } };
}

/** 袖を回す角度の範囲 (度)。測り違えても、袖が上を向いたり大きく回りすぎたりしない。 */
export const TURN_MIN = -10;
export const TURN_MAX = 40;

/** 腕の外の線の x (台の %)。 */
export function armX(y: number): number {
  return BODY.torsoLeft - (y - BODY.shoulder) * BODY.armSlope;
}

/** 台の % の点 p を、o を中心に deg 度 (時計回り) 回す。台の 1% は横と縦で 1:2 なので px に直して回す。 */
export function turnPoint(p: { x: number; y: number }, o: { x: number; y: number }, deg: number) {
  const k = 1 / STAGE_RATIO;
  const dx = p.x - o.x;
  const dy = (p.y - o.y) * k;
  const r = (deg * Math.PI) / 180;
  return { x: o.x + dx * Math.cos(r) - dy * Math.sin(r), y: o.y + (dx * Math.sin(r) + dy * Math.cos(r)) / k };
}

/**
 * 左の袖を、付け根を中心に回して、袖の先が腕の外の線に来る角度 (時計回り = 外へ正)。
 * box は写真全体の台の上の箱 (左右の真ん中にそろえてあるので、右の袖も反転して同じ箱で求められる)。
 * TURN_MIN〜TURN_MAX の中で探す (測り違えても回りすぎない)。
 */
export function sleeveTurn(
  box: { top: number; left: number; width: number; height: number },
  s: Sleeve | null,
): number {
  if (s === null) return 0;
  const o = { x: box.left + SLEEVE_SHARE * box.width, y: box.top + s.pivot * box.height };
  const tip = { x: box.left + s.tip.x * box.width, y: box.top + s.tip.y * box.height };
  // 先が腕の線の内側なら正 (回すほど外へ出て小さくなる)
  const f = (deg: number) => {
    const p = turnPoint(tip, o, deg);
    return p.x - armX(p.y);
  };
  if (f(TURN_MAX) > 0) return TURN_MAX;
  if (f(TURN_MIN) < 0) return TURN_MIN;
  let [lo, hi] = [TURN_MIN, TURN_MAX];
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** アウターの前を開ける幅 (台の幅に対する %)。 */
export const OPEN_GAP = 8;

/** 切り分けた写真の 1 片。 */
export interface Piece {
  /** 写真の幅のどこからどこまで (0〜1) */
  from: number;
  to: number;
  /** 台の上の箱 (%) */
  box: { top: number; left: number; width: number; height: number };
  /** 回す角度 (度、時計回りが正) と、回す中心 (片の箱に対する %) */
  turn: number;
  origin: { x: number; y: number };
}

/**
 * 袖のある服 (トップス・アウター) を、左の袖・身ごろ・右の袖 (アウターで前を開けるなら身ごろを左右 2 つ) に切り分けて置く。
 * box は写真全体の箱 (place の結果、height は写真の縦横比から決めたもの)。写真は曲げない: 片は切り分けて、動かす・回すだけ。
 * left・right は左右の袖の測った形 (右は反転して測ったもの)。
 */
export function pieces(
  box: { top: number; left: number; width: number; height: number },
  left: Sleeve | null,
  right: Sleeve | null,
  open: boolean,
): Piece[] {
  const s = SLEEVE_SHARE;
  const shift = open ? OPEN_GAP / 2 : 0;
  const at = (from: number, to: number, dx: number) => ({
    top: box.top,
    left: box.left + from * box.width + dx,
    width: (to - from) * box.width,
    height: box.height,
  });
  const flat = { x: 50, y: 0 };
  const body: Piece[] = open
    ? [
        { from: s, to: 0.5, box: at(s, 0.5, -shift), turn: 0, origin: flat },
        { from: 0.5, to: 1 - s, box: at(0.5, 1 - s, shift), turn: 0, origin: flat },
      ]
    : [{ from: s, to: 1 - s, box: at(s, 1 - s, 0), turn: 0, origin: flat }];
  return [
    // 左の袖は付け根 (右の端) を中心に時計回り (外へ)、右の袖は反時計回り
    {
      from: 0,
      to: s,
      box: at(0, s, -shift),
      turn: sleeveTurn(box, left),
      origin: { x: 100, y: (left?.pivot ?? 0) * 100 },
    },
    ...body,
    {
      from: 1 - s,
      to: 1,
      box: at(1 - s, 1, shift),
      turn: -sleeveTurn(box, right),
      origin: { x: 0, y: (right?.pivot ?? 0) * 100 },
    },
  ];
}
