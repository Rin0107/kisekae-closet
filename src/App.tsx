// 最小の画面 (雛形)。見た目は docs/design-system.md を決めてから作り直す。
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { api, ApiError, type Clothing, type Outfit } from "./client";
import { login, register } from "./passkey";
import { recommend, similarDays } from "./recommend";
import { shrinkPhoto } from "./shrink";
import { load, save } from "./storage";
import { CITIES, cityById, parseWeather, weatherUrl, type Weather } from "./weather";

export const KIND_NAMES: Record<string, string> = {
  top: "トップス",
  bottom: "ボトムス",
  outer: "アウター",
  dress: "ワンピース",
  shoes: "くつ",
  accessory: "こもの",
};

export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : "失敗した";
}

export function App() {
  const [state, setState] = useState<"loading" | "out" | "in">("loading");
  useEffect(() => {
    api.me().then(
      () => setState("in"),
      () => setState("out"),
    );
  }, []);
  if (state === "loading") return <main aria-busy="true" />;
  return state === "in" ? <Home onOut={() => setState("out")} /> : <Welcome onIn={() => setState("in")} />;
}

function Welcome({ onIn }: { onIn: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const run = (f: () => Promise<void>) => () => {
    setError("");
    f().then(onIn, (e: unknown) => setError(message(e)));
  };
  return (
    <main>
      <h1>{"kisekae-closet"}</h1>
      {/* prettier-ignore */}
      <p data-testid="goal">{"開くと今日の天気とおすすめを着たアバターが出て、クローゼットから服を引っ張り出して着せ替え、ワンタップで今日のコーデに決められる"}</p>
      <p>ログインはパスキーだけ。パスワードもメールアドレスも要りません。</p>
      <label>
        パスキーの名前 (端末の一覧に出るだけ。保存しません)
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="button" onClick={run(() => register(name.trim() || "kisekae-closet"))}>
        はじめる
      </button>
      <button type="button" onClick={run(login)}>
        パスキーでログイン
      </button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

const City = z.string();

function Home({ onOut }: { onOut: () => void }) {
  const [clothes, setClothes] = useState<Clothing[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [city, setCity] = useState(() => load("city", City, "tokyo"));
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    Promise.all([api.clothes(), api.outfits()]).then(
      ([c, o]) => {
        setClothes(c);
        setOutfits(o);
      },
      (e: unknown) => (e instanceof ApiError && e.status === 401 ? onOut() : setError(message(e))),
    );
  }, [onOut]);
  useEffect(reload, [reload]);
  useEffect(() => {
    save("city", city);
    fetch(weatherUrl(cityById(city)))
      .then((r) => r.json())
      .then((b: unknown) => setWeather(parseWeather(b)))
      .catch(() => setWeather(null));
  }, [city]);

  const pick = weather === null ? [] : recommend(clothes, outfits, weather, today());
  const similar = weather === null ? [] : similarDays(outfits, weather);
  // ボタンは、天気とおすすめがあるときだけ出る
  const wear = (w: Weather) => () => {
    api
      .addOutfit({ wornOn: today(), itemIds: pick.map((i) => i.id), ...w })
      .then(reload, (e: unknown) => setError(message(e)));
  };

  return (
    <main>
      <h1>{"kisekae-closet"}</h1>
      <section aria-label="今日">
        <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="市">
          {CITIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {weather && (
          <p data-testid="weather">
            {weather.tempMax}℃ / {weather.tempMin}℃・湿度 {weather.humidity}%・雨 {weather.precip}mm
          </p>
        )}
        <h2>今日のおすすめ</h2>
        <ul>
          {pick.map((i) => (
            <li key={i.id}>
              <img src={api.photoUrl(i.id)} alt={i.label} width={96} />
              {KIND_NAMES[i.kind]} {i.label}
            </li>
          ))}
        </ul>
        {weather && pick.length > 0 && (
          <button type="button" onClick={wear(weather)}>
            これを着た
          </button>
        )}
        <h2>似た天気の日に着たもの</h2>
        <ul>
          {similar.map((o) => (
            <li key={o.id}>
              {o.wornOn} ({o.tempMax}℃):{" "}
              {o.itemIds.map((id) => clothes.find((c) => c.id === id)?.label ?? "").join("・")}
            </li>
          ))}
        </ul>
      </section>
      <Closet clothes={clothes} onChange={reload} onError={setError} />
      {error && <p role="alert">{error}</p>}
      <footer>
        <a href="/api/export" download="closet.json">
          データを書き出す
        </a>
        <button type="button" onClick={() => api.logout().then(onOut, onOut)}>
          ログアウト
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm("アカウントと全データを消します。よろしいですか?"))
              api.deleteAccount().then(onOut, onOut);
          }}
        >
          アカウントと全データを消す
        </button>
      </footer>
    </main>
  );
}

function Closet({
  clothes,
  onChange,
  onError,
}: {
  clothes: Clothing[];
  onChange: () => void;
  onError: (s: string) => void;
}) {
  const [kind, setKind] = useState("top");
  const [warmth, setWarmth] = useState(2);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const add = async () => {
    if (file === null) return onError("写真を選ぶ");
    const photo = await shrinkPhoto(file);
    if (photo === null) return onError("写真を小さくできない");
    await api.addClothing({ kind, warmth, label, photo });
    setLabel("");
    setFile(null);
    onChange();
  };
  return (
    <section aria-label="クローゼット">
      <h2>クローゼット ({clothes.length})</h2>
      <p>服だけが写るように撮ってください (顔や部屋が写らないように)。</p>
      <input
        type="file"
        accept="image/*"
        aria-label="写真"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="種類">
        {Object.entries(KIND_NAMES).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <select value={warmth} onChange={(e) => setWarmth(Number(e.target.value))} aria-label="暖かさ">
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            暖かさ {n}
          </option>
        ))}
      </select>
      <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} aria-label="名前" />
      <button type="button" onClick={() => add().catch((e: unknown) => onError(message(e)))}>
        服を足す
      </button>
      <ul>
        {clothes.map((c) => (
          <li key={c.id}>
            <img src={api.photoUrl(c.id)} alt={c.label} width={96} />
            {KIND_NAMES[c.kind]} {c.label} (暖かさ {c.warmth})
            <button
              type="button"
              onClick={() => api.deleteClothing(c.id).then(onChange, (e: unknown) => onError(message(e)))}
            >
              消す
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
