// 今日の天気。ブラウザが Open-Meteo (鍵の要らない公開 API) を直接読む。サーバーには場所を送らない (DATA.md)。
// 場所は「市」を選ぶだけ (代表の緯度・経度。端末の localStorage に置く)。
import { z } from "zod";

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
    forecast_days: "1",
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

/** Open-Meteo の答えから今日の天気を取り出す。形が違えば null。 */
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
