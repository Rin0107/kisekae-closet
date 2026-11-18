import fc from "fast-check";
import { expect, test, vi } from "vitest";
import {
  canPlan,
  CITIES,
  cityById,
  daysAhead,
  FORECAST_DAYS,
  fetchForecast,
  fromSaved,
  parseForecast,
  parseWeather,
  SavedForecast,
  toSaved,
  weatherUrl,
} from "../../src/weather";
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

test("URL は Open-Meteo で、市の代表の緯度・経度と、今日を含めて 16 日分 (先の日のコーデのため)", () => {
  const u = new URL(weatherUrl(cityById("tokyo")));
  expect(u.origin + u.pathname).toBe("https://api.open-meteo.com/v1/forecast");
  expect(Object.fromEntries(u.searchParams)).toEqual({
    latitude: "35.69",
    longitude: "139.69",
    daily: "temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,precipitation_sum",
    timezone: "Asia/Tokyo",
    forecast_days: "16",
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

const DAILY = {
  time: ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"],
  temperature_2m_max: [15, 12, null, 9],
  temperature_2m_min: [8, 5, 3, 10],
  relative_humidity_2m_mean: [70, 60, 50, 40],
  precipitation_sum: [0, 2.5, 0, 0],
};

test("予報の答えから、日ごとの天気を取り出す (欠けた日・最低が最高より高い日は入れない)", () => {
  const f = parseForecast({ daily: DAILY });
  expect([...f.keys()]).toEqual(["2026-11-17", "2026-11-18"]);
  expect(f.get("2026-11-18")).toEqual({ tempMax: 12, tempMin: 5, humidity: 60, precip: 2.5 });
  // 配列が日付より短ければ、その先の日は入れない
  const short = parseForecast({ daily: { ...DAILY, precipitation_sum: [0] } });
  expect([...short.keys()]).toEqual(["2026-11-17"]);
});

test("予報の形が違えば空 (日付がない・日付の形が違う・多すぎる)", () => {
  expect(parseForecast(null).size).toBe(0);
  expect(parseForecast({ daily: { ...DAILY, time: [] } }).size).toBe(0);
  expect(parseForecast({ daily: { ...DAILY, time: ["11/17"] } }).size).toBe(0);
  const many = Array.from({ length: 40 }, () => "2026-11-17");
  expect(parseForecast({ daily: { ...DAILY, time: many } }).size).toBe(0);
});

test("AC-7-4: 先に決めておけるのは今日から 15 日先まで (予報のある日)。過去と 16 日先からは選べない", () => {
  expect(FORECAST_DAYS).toBe(16);
  expect(canPlan("2026-11-17", "2026-11-17")).toBe(true);
  expect(canPlan("2026-11-17", "2026-11-18")).toBe(true);
  expect(canPlan("2026-11-17", "2026-12-02")).toBe(true);
  expect(canPlan("2026-11-17", "2026-12-03")).toBe(false);
  expect(canPlan("2026-11-17", "2026-11-16")).toBe(false);
  expect(daysAhead("2026-12-31", "2027-01-01")).toBe(1);
  expect(daysAhead("2026-03-28", "2026-03-30")).toBe(2);
});

test("fuzz: どんな JSON でも予報の読み取りは落ちず、値は全部有限で最低 ≦ 最高", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (v) => {
      for (const w of parseForecast(v).values())
        if (!Number.isFinite(w.tempMax) || w.tempMin > w.tempMax) return false;
      return true;
    }),
    runs(),
  );
});

test("前回の予報: 同じ市の今日から先だけを取り出す。別の市・今日の分がなければ null", () => {
  const w = { tempMax: 10, tempMin: 2, humidity: 50, precip: 0 };
  const days = new Map([
    ["2026-11-16", w],
    ["2026-11-17", w],
    ["2026-11-18", { ...w, tempMax: 12 }],
  ]);
  const saved = toSaved("tokyo", days, 1000);
  expect(SavedForecast.parse(saved)).toEqual(saved);
  const got = fromSaved(saved, "tokyo", "2026-11-17");
  expect(got?.at).toBe(1000);
  expect([...(got?.days.keys() ?? [])]).toEqual(["2026-11-17", "2026-11-18"]);
  expect(fromSaved(saved, "osaka", "2026-11-17")).toBeNull();
  expect(fromSaved(saved, "tokyo", "2026-11-19")).toBeNull();
  expect(fromSaved(null, "tokyo", "2026-11-17")).toBeNull();
});

test("fetchForecast: 読めれば日ごとの予報、200 でない・形が違う・通信が落ちたら failed", async () => {
  const ok = {
    daily: {
      time: ["2026-11-17"],
      temperature_2m_max: [10],
      temperature_2m_min: [2],
      relative_humidity_2m_mean: [50],
      precipitation_sum: [0],
    },
  };
  for (const [res, want] of [
    [() => Promise.resolve(new Response(JSON.stringify(ok))), 1],
    [() => Promise.resolve(new Response("x", { status: 500 })), "failed"],
    [() => Promise.resolve(new Response(JSON.stringify({ daily: {} }))), "failed"],
    [() => Promise.reject(new Error("offline")), "failed"],
  ] as const) {
    vi.stubGlobal("fetch", vi.fn(res));
    const got = await fetchForecast("tokyo");
    expect(got === "failed" ? got : got.size).toBe(want);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(weatherUrl(cityById("tokyo")));
  }
  vi.unstubAllGlobals();
});
