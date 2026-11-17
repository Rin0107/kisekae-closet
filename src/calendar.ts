// カレンダーの決まり (純粋な関数)。
// - 月のマス (月曜はじまり。前後の月の日は null)
// - 今日の天気と、その日の天気の近さ (ほぼ同じ・近い・遠い)
import { average } from "./recommend";
import type { Weather } from "./weather";

/** その月のマス。週ごとに 7 つ (月〜日)。月の外は null。 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const p = (n: number) => String(n).padStart(2, "0");
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${p(month)}-${p(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 月を n だけ動かす。 */
export function shiftMonth(year: number, month: number, n: number): { year: number; month: number } {
  const i = year * 12 + (month - 1) + n;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

export type Likeness = "same" | "near" | "far";
export const LIKENESS_NAMES: Record<Likeness, string> = {
  same: "今日とほぼ同じ",
  near: "今日に近い",
  far: "ちがう",
};

/** 二つの日の天気の近さ。平均気温・湿度・雨の有無で決める。 */
export function likeness(a: Weather, b: Weather): Likeness {
  const dt = Math.abs(average(a) - average(b));
  const dh = Math.abs(a.humidity - b.humidity);
  const sameRain = a.precip >= 1 === b.precip >= 1;
  if (dt <= 1.5 && dh <= 10 && sameRain) return "same";
  if (dt <= 4 && dh <= 20) return "near";
  return "far";
}

export type Sky = "sun" | "cloud" | "rain";
export const SKY_NAMES: Record<Sky, string> = { sun: "晴れ", cloud: "くもり", rain: "雨" };

/** 天気のアイコンの種類。降水 1mm 以上は雨、湿度 75% 以上はくもり、ほかは晴れ。 */
export function sky(w: Weather): Sky {
  if (w.precip >= 1) return "rain";
  if (w.humidity >= 75) return "cloud";
  return "sun";
}
