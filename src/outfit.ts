// 着せ替えの決まり (純粋な関数。UI も保存も知らない)。
// - 服は種類ごとに 1 枚。同じ種類を着ると入れ替わる。ワンピースは上下と入れ替わる
// - 暖かさゲージ: 着ている服の暖かさの合計が、天気から決めた帯 (寒い・ちょうどいい・暑い) のどこに入るか
import { average, targetWarmth, type Item } from "./recommend";
import { LAYER } from "./fit";
import type { Weather } from "./weather";

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
    (a, b) => (LAYER[a.kind] ?? 9) - (LAYER[b.kind] ?? 9),
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
