import fc from "fast-check";
import { expect, test } from "vitest";
import { CITIES, cityById, parseWeather, weatherUrl } from "../../src/weather";
import { runs } from "./fc";

test("市の一覧 (代表の緯度・経度)", () => {
  expect(CITIES.map((c) => [c.id, c.name, c.lat, c.lon])).toEqual([
    ["sapporo", "札幌", 43.06, 141.35],
    ["sendai", "仙台", 38.27, 140.87],
    ["tokyo", "東京", 35.69, 139.69],
    ["nagoya", "名古屋", 35.18, 136.91],
    ["osaka", "大阪", 34.69, 135.5],
    ["hiroshima", "広島", 34.39, 132.46],
    ["fukuoka", "福岡", 33.59, 130.4],
    ["naha", "那覇", 26.21, 127.68],
  ]);
});

test("市は ID で引け、知らない ID は東京", () => {
  expect(cityById("osaka").name).toBe("大阪");
  expect(cityById("nope").id).toBe("tokyo");
  expect(new Set(CITIES.map((c) => c.id)).size).toBe(CITIES.length);
});

test("URL は Open-Meteo で、市の代表の緯度・経度と今日 1 日分だけ", () => {
  const u = new URL(weatherUrl(cityById("tokyo")));
  expect(u.origin + u.pathname).toBe("https://api.open-meteo.com/v1/forecast");
  expect(Object.fromEntries(u.searchParams)).toEqual({
    latitude: "35.69",
    longitude: "139.69",
    daily: "temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,precipitation_sum",
    timezone: "Asia/Tokyo",
    forecast_days: "1",
  });
});

test("答えから今日の値を取り出す", () => {
  const body = {
    daily: {
      temperature_2m_max: [15.2, 1],
      temperature_2m_min: [8.1],
      relative_humidity_2m_mean: [70],
      precipitation_sum: [1.5],
    },
  };
  expect(parseWeather(body)).toEqual({ tempMax: 15.2, tempMin: 8.1, humidity: 70, precip: 1.5 });
});

test("形が違えば null (空の配列・文字・欠け)", () => {
  const ok = {
    temperature_2m_max: [1],
    temperature_2m_min: [1],
    relative_humidity_2m_mean: [1],
    precipitation_sum: [1],
  };
  for (const k of Object.keys(ok)) {
    expect(parseWeather({ daily: { ...ok, [k]: [] } })).toBeNull();
    expect(parseWeather({ daily: { ...ok, [k]: ["1"] } })).toBeNull();
  }
  expect(parseWeather(null)).toBeNull();
  expect(parseWeather({})).toBeNull();
});

test("fuzz: どんな JSON でも落ちない", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (v) => {
      const r = parseWeather(v);
      return r === null || Number.isFinite(r.tempMax);
    }),
    runs(),
  );
});
