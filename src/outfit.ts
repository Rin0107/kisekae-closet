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
  /** あごの下の端 (2026-11-20 に絵を測った。ここから下は首で幅 9% ほど) */
  chin: 13.5,
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
// トップス・ワンピース・アウターは BODY.chin より下から始める (評価10、あごを覆わない)
export const SLOTS: Record<string, Slot> = {
  // くつはボトムスの裾より前 (長ズボンでも甲が見える、#39)
  bottom: { top: 42, left: 26, width: 48, height: 50, z: 1, fit: "width" },
  shoes: { top: 86, left: 22, width: 56, height: 8, z: 2, fit: "box" },
  top: { top: 14, left: 16, width: 68, height: 36, z: 3, fit: "width" },
  dress: { top: 14, left: 16, width: 68, height: 56, z: 3, fit: "width" },
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
  /** 写真の高さのうち、下から隠す割合 (0〜1)。無ければ隠さない */
  clip?: number;
}

/** ボトムスの幅の範囲 (%)。下は腰の下着を覆う幅 (写真の幅の 3/4 が腰)、上は太く見えすぎない幅。 */
export const BOTTOM_MIN_WIDTH = 46;
export const BOTTOM_MAX_WIDTH = 60;
/** 見えるボトムスの裾の下限 (%)。足の裏の 1% 上 (くつの中に隠れる、評価10) */
export const HEM_MAX = BODY.sole - 1;

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
    const box: Box = { top: s.top, left: 50 - width / 2, width, height: null };
    // 縦長の写真は腰を覆う幅より細くできず丈が伸びる。写真は曲げず、足の裏より下に出る分を下から隠す (評価10)
    const height = width * STAGE_RATIO * ratio;
    const end = s.top + height;
    return end > HEM_MAX ? { ...box, clip: (end - HEM_MAX) / height } : box;
  }
  return { top: s.top, left: s.left, width: s.width, height: s.fit === "box" ? s.height : null };
}

/**
 * 片足のくつの箱の大きさの上限 (%)。足 (BODY.footWidth) より一回り大きい (#39)。
 * 縦長の写真でも幅は FOOT_MIN_WIDTH を下回らない (足より細い小さなかたまりにしない)。ただし高さは FOOT_MAX_HEIGHT まで。
 */
export const FOOT_BOX = { width: 16, height: 10 };
export const FOOT_MIN_WIDTH = BODY.footWidth + 1.5;
export const FOOT_MAX_HEIGHT = 2 * FOOT_BOX.height;

/**
 * くつの写真 (2 足を並べて撮ったもの) を左右の半分に分け、それぞれを左右の足に置く箱 (#32)。
 * ratio は写真全体の 縦 ÷ 横 (分からなければ 2 足が正方形ずつ並んだ形とみなす)。
 * 半分の写真は曲げず、FOOT_BOX に収まる大きさ (細すぎるなら FOOT_MIN_WIDTH) にして、足の真ん中・足の裏にそろえる。
 */
export function shoeFeet(ratio: number | null): [Box, Box] {
  const half = ratio !== null && ratio > 0 ? 2 * ratio : 1; // 半分の 縦 ÷ 横
  // 高さ (%) = 幅 (%) × STAGE_RATIO × half
  const k = STAGE_RATIO * half;
  const fit = Math.min(FOOT_BOX.width, FOOT_BOX.height / k);
  const width = Math.min(Math.max(fit, FOOT_MIN_WIDTH), FOOT_MAX_HEIGHT / k);
  const height = width * k;
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

/** いまの服でどうすればいいかの一言 (数字は出さない)。 */
export const ADVICE: Record<Band, string> = {
  cold: "少し寒そう。もう1枚重ねよう",
  ok: "ちょうどいい。このままでOK",
  hot: "少し暑そう。1枚減らそう",
};
export function advice(b: Band): string {
  return ADVICE[b];
}

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

// ---- 袖を腕に沿わせる・アウターを前開きに (#37 #38 #44) ----

/** 腕の向き (縦から外へ何度)。台の 1% は横と縦で 1:2 なので、横 armSlope % ÷ 縦 1% を px に直す。 */
export const ARM_ANGLE = (Math.atan((BODY.armSlope * STAGE_RATIO) / 1) * 180) / Math.PI;

/** 写真の袖の形。値は写真の大きさに対する割合。 */
export interface Sleeve {
  /** 袖の帯の幅 (写真の幅に対する 0〜1)。身ごろの外の端より CUT_SAFE だけ外で切り分ける (#44) */
  cut: number;
  /** 袖の付け根の一番上 (肩の縫い目) の高さ (写真の高さに対する 0〜1)。内へ回すときの中心 */
  top: number;
  /** 袖の付け根の上下の真ん中の高さ (写真の高さに対する 0〜1)。外へ回すときの中心。横はどちらも cut */
  pivot: number;
  /** 写真の中の袖の向き (付け根の真ん中から袖の重心へ。縦から外へ何度) */
  angle: number;
  /** 袖の先 (付け根の真ん中から一番遠いところ)。写真の幅・高さに対する 0〜1 */
  tip: { x: number; y: number };
}

/** 身ごろを測れないときの、写真の左右の帯の幅 (写真の幅に対する割合)。袖を除いた身ごろが BODICE_SHARE。 */
export const SLEEVE_SHARE = (1 - BODICE_SHARE) / 2;

/** 身ごろの幅を測る行 (写真の高さに対する割合)。袖より下の、裾に近いところ (#44) */
export const BODICE_ROWS = [0.75, 0.9] as const;
/** 袖の帯の幅として受け入れる範囲 (写真の幅に対する割合)。外れたら袖がない・測れないとみなす */
export const CUT_MIN = 0.06;
export const CUT_MAX = 0.42;

/**
 * 身ごろの左の端 (画素の列)。裾に近い行 (BODICE_ROWS) で、真ん中から左へ続く不透明な画素の端を測り、一番狭いところ。
 * 袖は裾まで届かないので、ここより外が袖。固定の割合で切ると、袖のかけらが身ごろの片に残って細い線に見える (評価8)。
 * 測れない・帯が狭すぎる / 広すぎるなら null。前を開けて撮ったアウターのように真ん中が空いていても、少し外まで探す。
 */
export function bodiceEdge(opaque: (x: number, y: number) => boolean, w: number, h: number): number | null {
  const cx = Math.floor(w / 2);
  const stop = cx - Math.floor(w * 0.15);
  let edge = -1;
  const last = Math.min(h - 1, Math.floor(h * BODICE_ROWS[1]));
  for (let y = Math.floor(h * BODICE_ROWS[0]); y <= last; y++) {
    let x = cx;
    while (x > stop && !opaque(x, y)) x--;
    if (!opaque(x, y)) continue;
    while (x > 0 && opaque(x - 1, y)) x--;
    edge = Math.max(edge, x);
  }
  if (edge < 0) return null;
  const cut = edge / w;
  return cut < CUT_MIN || cut > CUT_MAX ? null : edge;
}

/**
 * 身ごろの端から外へ、これだけ (写真の幅に対する割合) 離して切る。身ごろの縁のにじんだ画素を袖の片に入れない
 * (入れると、袖と一緒に回って腕に沿った細い線に見える、評価8)。
 */
export const CUT_SAFE = 0.02;

/**
 * 切り抜いた写真の不透明な画素 (opaque(x, y)) から、左の袖の切れ目・付け根・向きを測る。
 * 切れ目は身ごろの端 (bodiceEdge) の少し外。付け根は切れ目のすぐ外の列の、一番上から続く不透明な画素 (帯の幅まで) の真ん中。
 * 向きは付け根から袖の帯の画素の重心へ (袖の先の角ではなく袖の軸。広げた T シャツも垂れた長袖も同じに測れる)。
 * 帯の画素がほとんど全部不透明 (切り抜けていない写真) や、ほとんどない (袖なし) なら null (回さない)。
 * 右の袖は写真を左右反転して同じに測る (opaque に反転したものを渡す)。
 */
export function measureSleeve(
  opaque: (x: number, y: number) => boolean,
  w: number,
  h: number,
): Sleeve | null {
  const found = bodiceEdge(opaque, w, h);
  if (found === null) return null;
  const band = Math.max(1, found - Math.round(w * CUT_SAFE));
  let on = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < band; x++)
      if (opaque(x, y)) {
        on++;
        sx += x;
        sy += y;
      }
  const share = on / (band * h);
  if (share > 0.9 || share < 0.02) return null;
  const edge = band - 1;
  let top = -1;
  for (let y = 0; y < h && top < 0; y++) if (opaque(edge, y)) top = y;
  if (top < 0) return null;
  // 付け根 (袖ぐり) の深さは袖の帯の幅まで。垂れた袖が身ごろに沿って続いていても、付け根を袖の真ん中まで下げない
  let bottom = top;
  while (bottom + 1 < h && bottom - top < band && opaque(edge, bottom + 1)) bottom++;
  const jy = (top + bottom) / 2;
  const cx = sx / on;
  const cy = sy / on;
  if (Math.hypot(edge - cx, cy - jy) < 1) return null;
  let best = 0;
  let tip = { x: edge, y: jy };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < band; x++) {
      if (!opaque(x, y)) continue;
      const d = (edge - x) ** 2 + (y - jy) ** 2;
      if (d > best) {
        best = d;
        tip = { x, y };
      }
    }
  const angle = (Math.atan2(edge - cx, cy - jy) * 180) / Math.PI;
  return { cut: band / w, top: top / h, pivot: jy / h, angle, tip: { x: tip.x / w, y: tip.y / h } };
}

/** 袖を回す角度の範囲 (度)。横に広げた袖 (約 80 度) も腕の向きまで下ろせる。測り違えても回りすぎない。 */
export const TURN_MIN = -70;
export const TURN_MAX = 45;
/** 袖の先を台の端からこれだけ内に収める (台の幅の %) */
export const EDGE_MARGIN = 1;

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
 * 袖を回す中心の高さ (写真の高さに対する 0〜1)。外へ回すなら付け根の真ん中 (袖の軸が腕の付け根を通る)、
 * 内へ回すなら肩の縫い目 (付け根の上が身ごろから離れず、肩にすき間ができない、#44)。
 */
export function sleeveOrigin(s: Sleeve, turn: number): number {
  return turn > 0 ? s.pivot : s.top;
}

/** 左の袖を turn 度回すときの、回す中心と袖の先の、台の上の位置 (%)。 */
export function sleevePoints(
  box: { top: number; left: number; width: number; height: number },
  s: Sleeve,
  turn: number,
) {
  return {
    pivot: { x: box.left + s.cut * box.width, y: box.top + sleeveOrigin(s, turn) * box.height },
    tip: { x: box.left + s.tip.x * box.width, y: box.top + s.tip.y * box.height },
  };
}

/**
 * 左の袖を回す角度 (中心は sleeveOrigin) (時計回り = 外へ正)。回したあとの袖の向き (付け根→袖の重心) が腕の向き (ARM_ANGLE) にそろう (#44)。
 * 写真は縦横同じ割合で縮めるので、写真の中の角度は台の上でも同じ。
 * TURN_MIN〜TURN_MAX に収め、袖の先が台の外に出るなら、出ないところまで内へ戻す (袖の先が台の端で切れない)。
 * box は写真全体の台の上の箱 (左右の真ん中にそろえてあるので、右の袖も反転して同じ箱で求められる)。
 */
export function sleeveTurn(
  box: { top: number; left: number; width: number; height: number },
  s: Sleeve | null,
): number {
  if (s === null) return 0;
  let t = Math.min(TURN_MAX, Math.max(TURN_MIN, ARM_ANGLE - s.angle));
  const out = (deg: number) => {
    const { pivot, tip } = sleevePoints(box, s, deg);
    return turnPoint(tip, pivot, deg).x < EDGE_MARGIN;
  };
  while (t > TURN_MIN && out(t)) t = Math.max(TURN_MIN, t - 1);
  return t;
}

/** 袖を小さくして収めるときの下限 (これより小さくしない。腕より細い袖にしない)。 */
export const SCALE_MIN = 0.7;

/**
 * 左の袖を回す角度と大きさ。角度は腕のまま (ARM_ANGLE にそろえる)、袖の先が台の外に出るなら、
 * 付け根を中心に縦横同じ割合で小さくして収める (SCALE_MIN まで。写真は曲げない)。
 * 小さくしても出るときだけ、sleeveTurn と同じに角度を内へ戻す。
 */
export function sleeveFit(
  box: { top: number; left: number; width: number; height: number },
  s: Sleeve | null,
): { turn: number; scale: number } {
  if (s === null) return { turn: 0, scale: 1 };
  const want = Math.min(TURN_MAX, Math.max(TURN_MIN, ARM_ANGLE - s.angle));
  const outAt = (deg: number, k: number) => {
    const { pivot, tip } = sleevePoints(box, s, deg);
    const scaled = { x: pivot.x + (tip.x - pivot.x) * k, y: pivot.y + (tip.y - pivot.y) * k };
    return turnPoint(scaled, pivot, deg).x < EDGE_MARGIN;
  };
  const steps = Math.round((1 - SCALE_MIN) * 100);
  for (let i = 0; i <= steps; i++) {
    const k = i === steps ? SCALE_MIN : 1 - i / 100;
    if (!outAt(want, k)) return { turn: want, scale: k };
  }
  let t = want;
  while (t > TURN_MIN && outAt(t, SCALE_MIN)) t = Math.max(TURN_MIN, t - 1);
  return { turn: t, scale: SCALE_MIN };
}

/** 片の動かし方 (CSS の transform)。rotate と、縦横同じ scale だけ。 */
export function pieceTransform(p: Piece): string | undefined {
  if (p.turn === 0 && p.scale === 1) return undefined;
  if (p.scale === 1) return `rotate(${p.turn}deg)`;
  return `rotate(${p.turn}deg) scale(${p.scale})`;
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
  /** 付け根を中心に縦横同じ割合で小さくする (1 = そのまま) */
  scale: number;
  origin: { x: number; y: number };
}

/**
 * 袖のある服 (トップス・アウター) を、左の袖・身ごろ・右の袖 (アウターで前を開けるなら身ごろを左右 2 つ) に切り分けて置く。
 * 切れ目は測った身ごろの端 (測れなければ SLEEVE_SHARE)。
 * box は写真全体の箱 (place の結果、height は写真の縦横比から決めたもの)。写真は曲げない: 片は切り分けて、動かす・回すだけ。
 * left・right は左右の袖の測った形 (右は反転して測ったもの)。
 */
export function pieces(
  box: { top: number; left: number; width: number; height: number },
  left: Sleeve | null,
  right: Sleeve | null,
  open: boolean,
): Piece[] {
  const lc = left?.cut ?? SLEEVE_SHARE;
  const rc = 1 - (right?.cut ?? SLEEVE_SHARE);
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
        { from: lc, to: 0.5, box: at(lc, 0.5, -shift), turn: 0, scale: 1, origin: flat },
        { from: 0.5, to: rc, box: at(0.5, rc, shift), turn: 0, scale: 1, origin: flat },
      ]
    : [{ from: lc, to: rc, box: at(lc, rc, 0), turn: 0, scale: 1, origin: flat }];
  const lf = sleeveFit(box, left);
  const rf = sleeveFit(box, right);
  const lt = lf.turn;
  const rt = rf.turn;
  const oy = (s: Sleeve | null, t: number) => (s === null ? 0 : sleeveOrigin(s, t) * 100);
  return [
    // 左の袖は付け根 (右の端) を中心に時計回り (外へ)、右の袖は反時計回り
    {
      from: 0,
      to: lc,
      box: at(0, lc, -shift),
      turn: lt,
      scale: lf.scale,
      origin: { x: 100, y: oy(left, lt) },
    },
    ...body,
    {
      from: rc,
      to: 1,
      box: at(rc, 1, shift),
      turn: -rt,
      scale: rf.scale,
      origin: { x: 0, y: oy(right, rt) },
    },
  ];
}
