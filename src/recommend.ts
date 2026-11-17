// 今日のおすすめ (純粋な関数。UI も保存も知らない)。
// - 気温から要る暖かさの合計を決め、手持ちの服から一番近い組み合わせを選ぶ
// - 最近 (3 日以内) 着た服は避ける
// - 似た天気の日 (平均気温 ±2℃・湿度 ±15%) の過去のコーデを出す
// 仕様: spec/recommend.smt2 (要る暖かさは寒いほど下がらない)
import type { Weather } from "./weather";

export interface Item {
  id: string;
  kind: string;
  warmth: number;
}

export interface PastOutfit extends Weather {
  id: string;
  wornOn: string;
  itemIds: string[];
}

/** 平均気温 (℃) から、要る暖かさの合計。寒いほど大きい (下がらない)。 */
export function targetWarmth(avg: number): number {
  if (avg >= 25) return 2;
  if (avg >= 20) return 3;
  if (avg >= 15) return 5;
  if (avg >= 10) return 7;
  if (avg >= 5) return 9;
  return 11;
}

export function average(w: Weather): number {
  return (w.tempMax + w.tempMin) / 2;
}

/** 日付 (YYYY-MM-DD) の差 (日)。 */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** 最近 (today から days 日以内) 着た服の ID。 */
export function recentlyWorn(past: PastOutfit[], today: string, days = 3): Set<string> {
  const out = new Set<string>();
  for (const o of past) {
    const d = daysBetween(o.wornOn, today);
    if (d >= 0 && d <= days) for (const id of o.itemIds) out.add(id);
  }
  return out;
}

function best<T extends Item>(items: T[], kind: string): T[] {
  return items.filter((i) => i.kind === kind);
}

/**
 * おすすめの組み合わせ。上下 (または ワンピース)・寒ければ上着・靴があれば靴。
 * 暖かさの合計と目標の差が一番小さいもの。同じなら最近着ていないもの、さらに同じなら並びの先のもの。
 * 組めなければ空。
 */
export function recommend<T extends Item>(items: T[], past: PastOutfit[], w: Weather, today: string): T[] {
  const target = targetWarmth(average(w));
  const recent = recentlyWorn(past, today);
  const bases: T[][] = [];
  for (const t of best(items, "top")) for (const b of best(items, "bottom")) bases.push([t, b]);
  for (const d of best(items, "dress")) bases.push([d]);
  const outers: (T | null)[] = [null, ...best(items, "outer")];
  let pick: T[] = [];
  let score = Infinity;
  for (const base of bases) {
    for (const o of outers) {
      const set = o === null ? base : [...base, o];
      const sum = set.reduce((s, i) => s + i.warmth, 0);
      const s = Math.abs(sum - target) * 10 + set.filter((i) => recent.has(i.id)).length;
      if (s < score) {
        score = s;
        pick = set;
      }
    }
  }
  if (pick.length === 0) return [];
  const shoes = best(items, "shoes").find((i) => !recent.has(i.id)) ?? best(items, "shoes")[0];
  return shoes === undefined ? pick : [...pick, shoes];
}

/** 似た天気の日の過去のコーデ (近い順に n 件)。 */
export function similarDays(past: PastOutfit[], w: Weather, n = 3): PastOutfit[] {
  const avg = average(w);
  return past
    .map((o) => ({ o, d: Math.abs(average(o) - avg) + Math.abs(o.humidity - w.humidity) / 10 }))
    .filter(({ o }) => Math.abs(average(o) - avg) <= 2 && Math.abs(o.humidity - w.humidity) <= 15)
    .sort((a, b) => a.d - b.d || b.o.wornOn.localeCompare(a.o.wornOn))
    .slice(0, n)
    .map(({ o }) => o);
}
