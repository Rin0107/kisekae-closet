// 今日の天気。ブラウザが Open-Meteo (鍵の要らない公開 API) を直接読む。サーバーには場所を送らない (DATA.md)。
// 場所は「市」を選ぶだけ (代表の緯度・経度。端末の localStorage に置く)。
// 予報は今日を含めて 16 日分 (Open-Meteo の forecast_days の上限)。先の日のコーデを決めておくのに使う。
import { z } from "zod";

/** 予報のある日数 (今日を含む)。 */
export const FORECAST_DAYS = 16;

export interface City {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export const CITIES: readonly City[] = [
  { id: "sapporo", name: "札幌", lat: 43.06, lon: 141.35 },
  { id: "sendai", name: "仙台", lat: 38.27, lon: 140.87 },
  { id: "tokyo", name: "東京", lat: 35.69, lon: 139.69 },
  { id: "nagoya", name: "名古屋", lat: 35.18, lon: 136.91 },
  { id: "osaka", name: "大阪", lat: 34.69, lon: 135.5 },
  { id: "hiroshima", name: "広島", lat: 34.39, lon: 132.46 },
  { id: "fukuoka", name: "福岡", lat: 33.59, lon: 130.4 },
  { id: "naha", name: "那覇", lat: 26.21, lon: 127.68 },
];

export interface Weather {
  tempMax: number;
  tempMin: number;
  humidity: number;
  precip: number;
}

export function cityById(id: string): City {
  return CITIES.find((c) => c.id === id) ?? (CITIES[2] as City);
}

export function weatherUrl(c: City): string {
  const q = new URLSearchParams({
    latitude: String(c.lat),
    longitude: String(c.lon),
    daily: "temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,precipitation_sum",
    timezone: "Asia/Tokyo",
    forecast_days: String(FORECAST_DAYS),
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

const Num = z.number().finite();
const Daily = z.object({
  daily: z.object({
    temperature_2m_max: z.array(Num).min(1),
    temperature_2m_min: z.array(Num).min(1),
    relative_humidity_2m_mean: z.array(Num).min(1),
    precipitation_sum: z.array(Num).min(1),
  }),
});

/** Open-Meteo の答えから今日 (先頭の日) の天気を取り出す。形が違えば null。 */
export function parseWeather(body: unknown): Weather | null {
  const p = Daily.safeParse(body);
  if (!p.success) return null;
  const d = p.data.daily;
  return {
    tempMax: d.temperature_2m_max[0] as number,
    tempMin: d.temperature_2m_min[0] as number,
    humidity: d.relative_humidity_2m_mean[0] as number,
    precip: d.precipitation_sum[0] as number,
  };
}

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Series = z.array(Num.nullable()).max(FORECAST_DAYS * 2);
const Forecast = z.object({
  daily: z.object({
    time: z
      .array(Day)
      .min(1)
      .max(FORECAST_DAYS * 2),
    temperature_2m_max: Series,
    temperature_2m_min: Series,
    relative_humidity_2m_mean: Series,
    precipitation_sum: Series,
  }),
});

/**
 * Open-Meteo の答えから、日ごとの予報 (日付 → 天気) を取り出す。形が違えば空。
 * 値の欠けた日 (null・配列が短い) は入れない。最高より最低が高い日も入れない (サーバーが受け取らないため)。
 */
export function parseForecast(body: unknown): Map<string, Weather> {
  const out = new Map<string, Weather>();
  const p = Forecast.safeParse(body);
  if (!p.success) return out;
  const d = p.data.daily;
  d.time.forEach((day, i) => {
    const tempMax = d.temperature_2m_max[i];
    const tempMin = d.temperature_2m_min[i];
    const humidity = d.relative_humidity_2m_mean[i];
    const precip = d.precipitation_sum[i];
    if (tempMax == null || tempMin == null || humidity == null || precip == null) return;
    if (tempMin > tempMax) return;
    out.set(day, { tempMax, tempMin, humidity, precip });
  });
  return out;
}

/** today から何日先か (過去は負)。 */
export function daysAhead(today: string, day: string): number {
  return Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000);
}

/** その日のコーデを先に決めておけるか (今日から予報のある日まで)。 */
export function canPlan(today: string, day: string): boolean {
  const n = daysAhead(today, day);
  return n >= 0 && n < FORECAST_DAYS;
}

/** 予報の読み込みを諦めるまで (ミリ秒)。それまでは前回の予報を出しておく。 */
export const FORECAST_TIMEOUT_MS = 10_000;

/** 市の予報を Open-Meteo から読む。読めなければ "failed"。 */
export function fetchForecast(cityId: string): Promise<Map<string, Weather> | "failed"> {
  const signal =
    typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(FORECAST_TIMEOUT_MS) : undefined;
  return fetch(weatherUrl(cityById(cityId)), signal ? { signal } : undefined)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((b: unknown) => {
      const days = parseForecast(b);
      return days.size === 0 ? ("failed" as const) : days;
    })
    .catch(() => "failed" as const);
}

const W = z.object({ tempMax: Num, tempMin: Num, humidity: Num, precip: Num });
/** 端末に置く前回の予報 (DATA.md)。市の ID・読んだ時刻・日ごとの数字だけ。 */
export const SavedForecast = z.object({
  city: z.string().max(20),
  at: z.number().int().nonnegative(),
  days: z.array(z.tuple([Day, W])).max(FORECAST_DAYS * 2),
});
export type SavedForecast = z.infer<typeof SavedForecast>;

export function toSaved(city: string, days: ReadonlyMap<string, Weather>, at: number): SavedForecast {
  return { city, at, days: [...days] };
}

/** 前回の予報から、その市の今日より先 (今日を含む) の日だけを取り出す。なければ null。 */
export function fromSaved(
  saved: SavedForecast | null,
  city: string,
  today: string,
): { days: Map<string, Weather>; at: number } | null {
  if (saved === null || saved.city !== city) return null;
  const days = new Map(saved.days.filter(([d]) => d >= today));
  return days.has(today) ? { days, at: saved.at } : null;
}
