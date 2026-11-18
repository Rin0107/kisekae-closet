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
} as const;

/**
 * ハンガーにかけて撮ったトップスの、袖を除いた身ごろの幅が写真の幅に占める割合のうち、狭いほう (半袖を広げた形)。
 * これでも胴を覆うように、トップスの幅を決める。
 */
export const BODICE_SHARE = 0.52;

export const SLOTS: Record<string, Slot> = {
  shoes: { top: 86, left: 31, width: 38, height: 12, z: 1, fit: "box" },
  bottom: { top: 42, left: 26, width: 48, height: 50, z: 2, fit: "width" },
  top: { top: 14, left: 16, width: 68, height: 36, z: 3, fit: "width" },
  dress: { top: 14, left: 16, width: 68, height: 56, z: 3, fit: "width" },
  outer: { top: 14, left: 13, width: 74, height: 42, z: 4, fit: "width" },
  accessory: { top: 38, left: 72, width: 24, height: 17, z: 5, fit: "box" },
};

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
