// 画面。決まり (おすすめ・着せ替え・カレンダー) は純粋な関数 (recommend.ts・outfit.ts・calendar.ts)。
// 見た目の決まりは docs/design-system.md。
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { z } from "zod";
import { Stage } from "./Avatar";
import { cutoutOk, forgetCutout } from "./cutout";
import { Photo } from "./Photo";
import { LIKENESS_NAMES, likeness, monthGrid, shiftMonth, sky, SKY_NAMES, type Sky } from "./calendar";
import { api, ApiError, type Clothing, type Outfit } from "./client";
import { BAND_NAMES, dressIn, gauge, takeOff, wear } from "./outfit";
import { login, register } from "./passkey";
import { recommend } from "./recommend";
import { shrinkPhoto } from "./shrink";
import { clearAll, forget, load, save } from "./storage";
import { applyTheme, DEFAULT_THEME, ThemeId, themeById, THEMES } from "./theme";
import {
  canPlan,
  CITIES,
  fetchForecastRetrying,
  fromSaved,
  SavedForecast,
  toSaved,
  type Weather,
} from "./weather";

export const KIND_NAMES: Record<string, string> = {
  top: "トップス",
  bottom: "ボトムス",
  outer: "アウター",
  dress: "ワンピース",
  shoes: "くつ",
  accessory: "こもの",
};

/** クローゼットのタブ。種類ごとに 1 つ (ワンピースにも自分のタブ、#35)。 */
export const SHELVES: { id: string; name: string; kinds: string[] }[] = [
  { id: "top", name: "トップス", kinds: ["top"] },
  { id: "dress", name: "ワンピース", kinds: ["dress"] },
  { id: "bottom", name: "ボトムス", kinds: ["bottom"] },
  { id: "outer", name: "アウター", kinds: ["outer"] },
  { id: "shoes", name: "くつ", kinds: ["shoes"] },
  { id: "accessory", name: "こもの", kinds: ["accessory"] },
];

export function shelfOf(kind: string): string {
  return SHELVES.find((s) => s.kinds.includes(kind))?.id ?? "top";
}

export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : "失敗した";
}

const nameOf = (c: Clothing) => c.label || (KIND_NAMES[c.kind] ?? "服");

const City = z.string();

/** 開いた瞬間に始めた予報の読み込み (ログインの確かめを待たない、#21)。 */
interface FirstForecast {
  city: string;
  at: number;
  promise: Promise<Map<string, Weather> | "failed">;
}
/** 最初の読み込みを使い回してよい間 (これより後に同じ市を選び直したら読み直す)。 */
const FIRST_FRESH_MS = 60_000;

function cachedWx(city: string): Wx | null {
  const c = fromSaved(load<SavedForecast | null>("forecast", SavedForecast.nullable(), null), city, today());
  return c === null ? null : { city, days: c.days, at: c.at, fresh: false, failed: false };
}

/** 予報の状態。fresh: 今読んだもの。false なら端末に置いた前回の予報 (at に読んだ時刻)。 */
type Wx =
  | { city: string; days: Map<string, Weather>; at: number; fresh: boolean; failed: boolean }
  | { city: string; days: "failed" };

export function App() {
  const [state, setState] = useState<"loading" | "out" | "in">("loading");
  // この端末でログインして使ったことがあれば (前回の予報がある)、天気はログインの確かめと同時に読み始める。
  // 使ったことのない端末では、ログインの前に外へ通信しない (確かめのあと Home が読む)
  const [first] = useState<FirstForecast | null>(() => {
    if (load<SavedForecast | null>("forecast", SavedForecast.nullable(), null) === null) return null;
    const city = load("city", City, "tokyo");
    return { city, at: Date.now(), promise: fetchForecastRetrying(city) };
  });
  const out = useCallback(() => {
    // ログインしていない端末に予報を残さない (次に開いたとき、ログインの前に読みに行かないように)
    forget("forecast");
    forget("pending");
    setState("out");
  }, []);
  useEffect(() => applyTheme(themeById(load("theme", ThemeId, DEFAULT_THEME))), []);
  useEffect(() => {
    api.me().then(() => setState("in"), out);
  }, [out]);
  if (state === "loading") return <main aria-busy="true" />;
  return state === "in" ? <Home first={first} onOut={out} /> : <Welcome onIn={() => setState("in")} />;
}

function Welcome({ onIn }: { onIn: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const run = (f: () => Promise<void>) => () => {
    setError("");
    f().then(onIn, (e: unknown) => setError(message(e)));
  };
  return (
    <main className="welcome">
      <h1>{"kisekae-closet"}</h1>
      {/* prettier-ignore */}
      <p data-testid="goal">{"開くと今日の天気とおすすめを着たアバターが出て、クローゼットから服を引っ張り出して着せ替え、ワンタップで今日のコーデに決められる"}</p>
      <p className="muted">ログインはパスキーだけ。パスワードもメールアドレスも要りません。</p>
      <label className="field">
        パスキーの名前 (端末の一覧に出るだけ。保存しません)
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      <button
        type="button"
        className="primary"
        onClick={run(() => register(name.trim() || "kisekae-closet"))}
      >
        はじめる
      </button>
      <button type="button" className="ghost" onClick={run(login)}>
        パスキーでログイン
      </button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

const NO_FORECAST: ReadonlyMap<string, Weather> = new Map();

/**
 * 天気が読めないうちに決めたコーデ (#46)。サーバーはその日の気温と湿度が要るので、天気が読めたら保存する。
 * 端末だけに置く (服の ID と日付だけ)。
 */
const Pending = z.object({
  wornOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  itemIds: z.array(z.string().min(1).max(64)).min(1).max(20),
});
type Pending = z.infer<typeof Pending>;

const sameItems = (ids: string[], items: Clothing[]) =>
  ids.length === items.length && items.every((c) => ids.includes(c.id));
type Tab = "today" | "closet" | "calendar";
const TABS: { id: Tab; name: string }[] = [
  { id: "today", name: "今日" },
  { id: "closet", name: "クローゼット" },
  { id: "calendar", name: "カレンダー" },
];

function Home({ first, onOut }: { first: FirstForecast | null; onOut: () => void }) {
  const [clothes, setClothes] = useState<Clothing[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  // 服とコーデが 1 度届くまでは、アバターを下着姿にせず、ゲージも寒いにしない (#28)
  const [loaded, setLoaded] = useState(false);
  const [city, setCity] = useState(() => load("city", City, "tokyo"));
  // 前回の予報があれば、読み終わるのを待たずにまずそれを出す (#21)
  const [wx, setWx] = useState<Wx | null>(() => cachedWx(city));
  const [tab, setTab] = useState<Tab>("today");
  // 「もう一度読む」を押した回数 (#31)。増えるたびに予報を読み直す
  const [again, setAgain] = useState(0);
  // 着せ替えている日 (今日か、先に決めておく日)
  const [plan, setPlan] = useState(() => today());
  // null: まだ触っていない (決めたコーデか、おすすめを着る)
  const [worn, setWorn] = useState<Clothing[] | null>(null);
  const [sparkle, setSparkle] = useState(0);
  const [error, setError] = useState("");
  // 天気が読めないうちに決めたコーデ (#46)。今日より前の日のものは、もう保存できないので捨てる
  const [pending, setPending] = useState<Pending | null>(() => {
    const p = load("pending", Pending.nullable(), null);
    return p !== null && p.wornOn >= today() ? p : null;
  });
  const sending = useRef(false);

  const fail = useCallback(
    (e: unknown) => (e instanceof ApiError && e.status === 401 ? onOut() : setError(message(e))),
    [onOut],
  );
  const reload = useCallback(() => {
    Promise.all([api.clothes(), api.outfits()]).then(
      ([c, o]) => {
        setClothes(c);
        setOutfits(o);
        setLoaded(true);
      },
      (e: unknown) => {
        setLoaded(true);
        fail(e);
      },
    );
  }, [fail]);
  useEffect(reload, [reload]);
  useEffect(() => {
    save("city", city);
    // 前の市の答えが後から届いても使わない
    let stale = false;
    const p =
      again === 0 && first !== null && first.city === city && Date.now() - first.at < FIRST_FRESH_MS
        ? first.promise
        : fetchForecastRetrying(city);
    void p.then((days) => {
      if (stale) return;
      if (days === "failed") {
        // 前回の予報があれば、それを出したまま一言だけ添える
        setWx((w) =>
          w !== null && w.city === city && w.days !== "failed" ? { ...w, failed: true } : { city, days },
        );
        return;
      }
      const at = Date.now();
      save("forecast", toSaved(city, days, at));
      setWx({ city, days, at, fresh: true, failed: false });
    });
    return () => {
      stale = true;
    };
  }, [city, first, again]);
  const readAgain = () => {
    // 読み直している間は「読んでいます」に戻す (前回の予報があれば、それを出したまま)
    setWx((w) => (w !== null && w.city === city && w.days !== "failed" ? { ...w, failed: false } : null));
    setAgain((n) => n + 1);
  };
  const againButton = (
    <button type="button" className="ghost small" data-testid="weather-again" onClick={readAgain}>
      もう一度読む
    </button>
  );
  const old = wx !== null && wx.city === city && wx.days !== "failed" && !wx.fresh ? wx : null;
  const wxState = wx === null || wx.city !== city ? "loading" : wx.days === "failed" ? "failed" : "ok";
  const forecast = wx !== null && wx.city === city && wx.days !== "failed" ? wx.days : NO_FORECAST;

  const day = plan;
  const isToday = plan === today();
  const weather = forecast.get(plan) ?? null;
  const decided = outfits.find((o) => o.wornOn === day);
  const held = pending !== null && pending.wornOn === day ? pending : null;
  const base =
    held !== null
      ? dressIn(clothes, held.itemIds)
      : decided !== undefined
        ? dressIn(clothes, decided.itemIds)
        : weather === null
          ? []
          : recommend(clothes, outfits, weather, day);
  // 消した服は着ていられない
  const current = (worn ?? base).filter((c) => clothes.some((x) => x.id === c.id));

  const choose = (d: string) => {
    setPlan(d);
    setWorn(null);
  };
  const put = (items: Clothing[]) => {
    setWorn(items);
    setSparkle((n) => n + 1);
  };
  /** その日のコーデを天気と一緒に保存する。決め直しなら前のものを消す。 */
  const store = (wornOn: string, itemIds: string[], w: Weather) => {
    const before = outfits.find((o) => o.wornOn === wornOn);
    return api.addOutfit({ wornOn, itemIds, ...w }).then(() => {
      // 決め直し: 新しいものを足せたら、前のものを消す。消せなくても新しいほうが今日のコーデ
      const old =
        before === undefined ? Promise.resolve() : api.deleteOutfit(before.id).then(() => undefined);
      old
        .catch((e: unknown) =>
          e instanceof ApiError && e.status === 401
            ? onOut()
            : setError("前のコーデを消せませんでした (新しいコーデは保存しました)"),
        )
        .finally(reload);
    });
  };
  const decide = (w: Weather) => () => {
    setError("");
    store(
      day,
      current.map((i) => i.id),
      w,
    ).then(() => setWorn(null), fail);
  };
  // 天気が読めないときは、端末に置いておき、読めたら保存する (#46)
  const decideLater = () => {
    setError("");
    const p = { wornOn: day, itemIds: current.map((i) => i.id) };
    save("pending", p);
    setPending(p);
    setWorn(null);
    setSparkle((n) => n + 1);
  };
  const pendingWeather = pending === null ? null : (forecast.get(pending.wornOn) ?? null);
  useEffect(() => {
    if (pending === null || pendingWeather === null || !loaded || sending.current) return;
    sending.current = true;
    store(pending.wornOn, pending.itemIds, pendingWeather)
      .then(() => {
        forget("pending");
        setPending(null);
      }, fail)
      .finally(() => {
        sending.current = false;
      });
    // store は毎回作り直すので、保存するきっかけ (天気・決めておいたもの・服の一覧) だけを見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, pendingWeather, loaded]);
  const isHeld = held !== null && sameItems(held.itemIds, current);
  const isDecided = isHeld || (held === null && decided !== undefined && sameItems(decided.itemIds, current));

  return (
    <div className="app">
      <main>
        {tab === "today" && (
          <section aria-label="今日" className="today">
            {!isToday && (
              <div className="plan-bar" data-testid="plan-bar">
                <p>
                  <strong>{md(plan)}</strong>のコーデを先に決めています (予報)
                </p>
                <button type="button" className="ghost" onClick={() => choose(today())}>
                  今日に戻る
                </button>
              </div>
            )}
            <header className="weather-bar">
              {weather ? (
                <p className="weather">
                  <SkyIcon sky={sky(weather)} />
                  <span data-testid="weather">
                    <span className="nb">
                      {weather.tempMax}℃ / {weather.tempMin}℃
                    </span>
                    ・<span className="nb">湿度 {weather.humidity}%</span>・
                    <span className="nb">雨 {weather.precip}mm</span>
                  </span>
                  {old && (
                    <span className="muted wx-old" data-testid="weather-old">
                      {hm(old.at)}の予報
                      {old.failed ? " (新しい予報を読めませんでした)" : " (新しい予報を読んでいます)"}
                    </span>
                  )}
                  {old?.failed && againButton}
                </p>
              ) : wxState === "failed" ? (
                <p className="weather" role="alert" data-testid="weather-failed">
                  天気を読めませんでした。
                  {againButton}
                </p>
              ) : (
                <p className="weather muted">
                  {wxState === "loading" ? "天気を読んでいます…" : "この日の予報がありません"}
                </p>
              )}
              <select
                className="city"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setWx(cachedWx(e.target.value));
                }}
                aria-label="市"
              >
                {CITIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </header>
            <Dresser
              clothes={clothes}
              pending={!loaded}
              worn={current}
              sparkle={sparkle}
              onWear={(c) => put(wear(current, c))}
              onTakeOff={(c) => setWorn(takeOff(current, c.id))}
              weather={weather}
              stamp={isDecided}
              stampNote={
                isHeld
                  ? "天気が読めたら、その日の天気と一緒にカレンダーに保存します"
                  : isToday
                    ? "今日のコーデはカレンダーに載りました"
                    : `${md(plan)}のコーデとしてカレンダーに載りました`
              }
              onGoCloset={() => setTab("closet")}
              decide={
                current.length > 0 && !isDecided ? (
                  <button
                    type="button"
                    className="primary decide"
                    onClick={weather ? decide(weather) : decideLater}
                  >
                    これに決めた
                  </button>
                ) : null
              }
            />
          </section>
        )}
        {tab === "closet" && <ClosetRoom clothes={clothes} onChange={reload} onError={fail} />}
        {tab === "calendar" && (
          <CalendarRoom
            clothes={clothes}
            outfits={outfits}
            pending={pending}
            today={today()}
            weather={forecast.get(today()) ?? null}
            forecast={forecast}
            onUse={(items) => {
              choose(today());
              put(items);
              setTab("today");
            }}
            onPlan={(d) => {
              choose(d);
              setTab("today");
            }}
          />
        )}
        {error && <p role="alert">{error}</p>}
        {tab === "closet" && <ThemePicker />}
        {tab === "closet" && (
          <footer className="account">
            <a href="/api/export" download="closet.json">
              データを書き出す
            </a>
            <button type="button" className="ghost" onClick={() => api.logout().then(onOut, onOut)}>
              ログアウト
            </button>
            <button
              type="button"
              className="ghost danger"
              onClick={() => {
                if (confirm("アカウントと全データを消します。よろしいですか?"))
                  api.deleteAccount().then(() => {
                    // 端末に置いたもの (市・テーマ・前回の予報) も残さない (#29)
                    clearAll();
                    applyTheme(themeById(DEFAULT_THEME));
                    onOut();
                  }, onOut);
              }}
            >
              アカウントと全データを消す
            </button>
          </footer>
        )}
      </main>
      <nav className="tabbar" aria-label="画面">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** サイト全体の色を選ぶ。選んだものは端末にだけ覚える。 */
function ThemePicker() {
  const [id, setId] = useState(() => load("theme", ThemeId, DEFAULT_THEME));
  const pick = (t: string) => {
    setId(themeById(t).id as typeof id);
    applyTheme(themeById(t));
    save("theme", themeById(t).id);
  };
  return (
    <section aria-label="テーマ" className="theme-room">
      <h2>テーマ</h2>
      <div className="themes" role="group" aria-label="テーマの色">
        {THEMES.map((t) => (
          <button key={t.id} type="button" aria-pressed={id === t.id} onClick={() => pick(t.id)}>
            <span
              className="swatch"
              aria-hidden="true"
              style={{ background: t.colors["--c-primary"], borderColor: t.colors["--c-primary-strong"] }}
            />
            {t.name}
          </button>
        ))}
      </div>
    </section>
  );
}

export function SkyIcon({ sky: s }: { sky: Sky }) {
  return (
    <svg className={`sky sky-${s}`} viewBox="0 0 24 24" role="img" aria-label={SKY_NAMES[s]}>
      {s === "sun" ? (
        <g>
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </g>
      ) : (
        <path d="M7 17h10a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.5A3.5 3.5 0 0 0 7 17Z" />
      )}
      {s === "rain" && <path d="M9 19l-1 3M13 19l-1 3M17 19l-1 3" />}
    </svg>
  );
}

/** 着ている服のラベル。高さ固定の 1 行 (アバターには重ねない)。入りきらない分は +N。 */
export const MAX_CHIPS = 3;
function LabelRow({ worn }: { worn: Clothing[] }) {
  const shown = worn.slice(0, MAX_CHIPS);
  const rest = worn.length - shown.length;
  return (
    <ul className="chips" data-testid="labels" aria-label="着ている服のラベル">
      {shown.map((c) => (
        <li key={c.id} className="chip">
          {nameOf(c)}
        </li>
      ))}
      {rest > 0 && <li className="chip more">+{rest}</li>}
    </ul>
  );
}

function GaugeView({ worn, weather }: { worn: Clothing[]; weather: Weather | null }) {
  // 天気か服がまだ届いていないあいだは、つまみを出さない (寒いと言わない、#28)
  if (weather === null)
    return (
      <div
        className="gauge"
        data-testid="gauge"
        data-band="loading"
        role="group"
        aria-label="暖かさ"
        aria-busy="true"
      >
        <div className="gauge-track" aria-hidden="true">
          <span className="cold" />
          <span className="ok" />
          <span className="hot" />
        </div>
        <div className="gauge-words" aria-hidden="true">
          <span>寒い</span>
          <span>ちょうどいい</span>
          <span>暑い</span>
        </div>
        <p className="gauge-word muted">暖かさ: 服を読んでいます…</p>
      </div>
    );
  const g = gauge(worn, weather);
  return (
    <div className="gauge" data-testid="gauge" data-band={g.band} role="group" aria-label="暖かさ">
      <div className="gauge-track" aria-hidden="true">
        <span className="cold" />
        <span className="ok" />
        <span className="hot" />
        <span className="gauge-thumb" data-testid="gauge-thumb" style={{ left: `${g.position * 100}%` }} />
      </div>
      <div className="gauge-words" aria-hidden="true">
        <span>寒い</span>
        <span>ちょうどいい</span>
        <span>暑い</span>
      </div>
      <p className="gauge-word">
        暖かさ: <strong>{BAND_NAMES[g.band]}</strong>
      </p>
    </div>
  );
}

/** 今日の着せ替え: アバターの台・ラベル・ゲージ・決めるボタン・クローゼットの棚。 */
function Dresser({
  clothes,
  pending,
  worn,
  sparkle,
  onWear,
  onTakeOff,
  weather,
  stamp,
  stampNote,
  decide,
  onGoCloset,
}: {
  clothes: Clothing[];
  /** 服の一覧がまだ届いていない */
  pending: boolean;
  worn: Clothing[];
  sparkle: number;
  onWear: (c: Clothing) => void;
  /** 着ている服をもう一度押すと脱ぐ (#45) */
  onTakeOff: (c: Clothing) => void;
  weather: Weather | null;
  stamp: boolean;
  stampNote: string;
  decide: ReactNode;
  onGoCloset: () => void;
}) {
  const stage = useRef<HTMLElement>(null);
  const [shelf, setShelf] = useState("top");
  const [drag, setDrag] = useState<{ item: Clothing; x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    start.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const move = (item: Clothing) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (s === null) return;
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8) return;
    if (!s.moved) {
      s.moved = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // 取れなくても動く (指が外に出ると止まるだけ)
      }
    }
    setDrag({ item, x: e.clientX, y: e.clientY });
  };
  const up = (item: Clothing) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    setDrag(null);
    if (s === null || !s.moved) return;
    const r = stage.current?.getBoundingClientRect();
    if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)
      onWear(item);
  };
  const tap = (item: Clothing) => () => {
    // ドラッグのあとの click は、もう着せたか、外に落としたもの
    const dragged = start.current?.moved === true;
    start.current = null;
    if (dragged) return;
    // 着ている服をもう一度押すと脱ぐ (#45)。ドラッグで台に落としたときは着たまま
    if (worn.some((w) => w.id === item.id)) onTakeOff(item);
    else onWear(item);
  };

  const kinds = SHELVES.find((s) => s.id === shelf)?.kinds ?? [];
  const onShelf = clothes.filter((c) => kinds.includes(c.kind));
  return (
    <div className="dresser">
      <div className="stage-wrap">
        <Stage ref={stage} worn={worn} sparkle={sparkle} pending={pending} />
        {stamp && (
          <span className="stamp" data-testid="stamp">
            決めた!
          </span>
        )}
      </div>
      {/* 広い画面では台の右に並べる (#40)。狭い画面では台の下に続く */}
      <div className="dresser-side">
        <LabelRow worn={worn} />
        {(weather || pending) && <GaugeView worn={worn} weather={pending ? null : weather} />}
        <div className="decide-row">
          {decide}
          {stamp && <p className="muted">{stampNote}</p>}
        </div>
        <section aria-label="クローゼット" className="closet">
          <div role="tablist" aria-label="服の種類" className="shelves">
            {SHELVES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={shelf === s.id}
                onClick={() => setShelf(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
          {pending ? (
            <p className="empty muted">服を読んでいます…</p>
          ) : clothes.length === 0 ? (
            <div className="empty">
              <p>まだ服がありません。クローゼットに服をしまうと、ここから着せられます。</p>
              <button type="button" className="primary" onClick={onGoCloset}>
                服をしまう
              </button>
            </div>
          ) : onShelf.length === 0 ? (
            <p className="empty muted">この棚はからっぽです</p>
          ) : (
            <ul className="rack" role="tabpanel" data-testid="rack">
              {onShelf.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="garment"
                    data-testid="garment"
                    aria-pressed={worn.some((w) => w.id === c.id)}
                    aria-label={`${nameOf(c)}を着る`}
                    onPointerDown={down}
                    onPointerMove={move(c)}
                    onPointerUp={up(c)}
                    onPointerCancel={() => {
                      start.current = null;
                      setDrag(null);
                    }}
                    onClick={tap(c)}
                  >
                    <Photo src={api.photoUrl(c.id)} alt="" />
                    <span className="garment-label">{nameOf(c)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {drag && (
        <Photo
          className="ghost-drag"
          data-testid="ghost"
          src={api.photoUrl(drag.item.id)}
          alt=""
          aria-hidden="true"
          style={{ left: drag.x, top: drag.y }}
        />
      )}
    </div>
  );
}

/** 登録の枠 (種類ごとの切り抜きの目安)。 */
const FRAMES: Record<string, string> = {
  top: "M30 20 L45 12 Q60 22 75 12 L90 20 L100 45 L85 50 L82 40 L82 108 L38 108 L38 40 L35 50 L20 45 Z",
  outer: "M28 16 L46 8 Q60 18 74 8 L92 16 L104 70 L88 72 L86 44 L86 112 L34 112 L34 44 L32 72 L16 70 Z",
  dress: "M42 10 L52 8 Q60 16 68 8 L78 10 L80 40 L96 112 L24 112 L40 40 Z",
  bottom: "M34 10 L86 10 L92 112 L66 112 L60 40 L54 112 L28 112 Z",
  shoes: "M14 80 L40 74 Q52 86 60 86 L60 100 L14 100 Z M64 86 Q72 86 84 74 L108 80 L108 100 L64 100 Z",
  accessory: "M38 44 Q38 20 60 20 Q82 20 82 44 L94 44 L98 104 L22 104 L26 44 Z",
};

function ClosetRoom({
  clothes,
  onChange,
  onError,
}: {
  clothes: Clothing[];
  onChange: () => void;
  onError: (e: unknown) => void;
}) {
  const [kind, setKind] = useState<string | null>(null);
  const [warmth, setWarmth] = useState(3);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [shelf, setShelf] = useState("top");
  const [note, setNote] = useState("");
  // 選んだ写真の下見 (端末の中の blob: だけ。送らない)
  const preview = useMemo(
    () => (file !== null && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : ""),
    [file],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  // 背景を切り抜けなかった写真 (白い背景の白い服など、#47)。知らせて、撮り直しを選べる
  const [badCut, setBadCut] = useState<string | null>(null);
  useEffect(() => {
    if (!preview) return;
    let live = true;
    void cutoutOk(preview).then((ok) => {
      if (live) setBadCut(ok ? null : preview);
    });
    return () => {
      live = false;
    };
  }, [preview]);
  // 撮り直すとき、ファイルの欄を空に戻す (同じ写真を選び直しても読み込む)
  const [picker, setPicker] = useState(0);

  const add = async (k: string) => {
    setNote("");
    if (file === null) return setNote("写真を選ぶ");
    const photo = await shrinkPhoto(file);
    if (photo === null) return setNote("写真を小さくできない");
    await api.addClothing({ kind: k, warmth, label, photo });
    setShelf(shelfOf(k));
    setKind(null);
    setLabel("");
    setFile(null);
    setPicker((n) => n + 1);
    setWarmth(3);
    onChange();
  };
  const kinds = SHELVES.find((s) => s.id === shelf)?.kinds ?? [];
  return (
    <section aria-label="服をしまう" className="closet-room">
      <h2>服をしまう</h2>
      <div className="kinds" role="group" aria-label="種類">
        {Object.entries(KIND_NAMES).map(([k, v]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {v}
          </button>
        ))}
      </div>
      {kind === null ? (
        <p className="muted">まず、しまう服の種類を選んでください。</p>
      ) : (
        <div className="register" data-testid="register">
          <div className="frame" data-testid="frame" data-kind={kind}>
            {preview && <Photo src={preview} alt="選んだ写真" />}
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <path d={FRAMES[kind]} />
            </svg>
          </div>
          <p className="guide" data-testid="guide">
            ハンガーにかけて、正面からまっすぐ撮ってください。服が枠に収まるように (顔や部屋は写さない)。
            <span data-testid="guide-bg">背景は服と違う色に (白い服なら色のある壁や布の前で)。</span>
          </p>
          <label className="file">
            <span className="file-title">写真を撮る・選ぶ</span>
            <input
              key={picker}
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="写真"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {preview && badCut === preview && (
            <div className="cut-bad" role="status" data-testid="cut-bad">
              <p>
                背景と服の色が近くて、切り抜けませんでした。このままだと写真の四角ごとアバターに重なります。色のちがう壁や布の前で撮ってください。
              </p>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setFile(null);
                  setPicker((n) => n + 1);
                }}
              >
                撮り直す
              </button>
            </div>
          )}
          <div className="warmth" role="group" aria-label="暖かさ">
            <span>暖かさ</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={warmth === n}
                aria-label={`暖かさ ${n}`}
                onClick={() => setWarmth(n)}
              >
                {"●".repeat(n)}
              </button>
            ))}
          </div>
          <label className="field">
            ラベル (例: 通勤・お気に入り)
            <input
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="ラベル"
            />
          </label>
          <button type="button" className="primary" onClick={() => add(kind).catch(onError)}>
            クローゼットにしまう
          </button>
          {note && <p role="alert">{note}</p>}
        </div>
      )}
      <h2>クローゼット ({clothes.length})</h2>
      <div role="tablist" aria-label="服の種類" className="shelves">
        {SHELVES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={shelf === s.id}
            onClick={() => setShelf(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>
      <ul className="rack grid" role="tabpanel" data-testid="shelf" data-shelf={shelf}>
        {clothes
          .filter((c) => kinds.includes(c.kind))
          .map((c) => (
            <li key={c.id} className="garment">
              <Photo src={api.photoUrl(c.id)} alt={nameOf(c)} />
              <span className="garment-label">{nameOf(c)}</span>
              <span className="muted">暖かさ {"●".repeat(c.warmth)}</span>
              <button
                type="button"
                className="ghost small"
                onClick={() =>
                  api.deleteClothing(c.id).then(() => {
                    forgetCutout(api.photoUrl(c.id));
                    onChange();
                  }, onError)
                }
              >
                消す
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}

const WEEK = ["月", "火", "水", "木", "金", "土", "日"];
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`;

function CalendarRoom({
  clothes,
  outfits,
  pending,
  today: day,
  weather,
  forecast,
  onUse,
  onPlan,
}: {
  clothes: Clothing[];
  outfits: Outfit[];
  /** 天気が読めたら保存する、決めたコーデ (#46) */
  pending: Pending | null;
  today: string;
  weather: Weather | null;
  forecast: ReadonlyMap<string, Weather>;
  onUse: (items: Clothing[]) => void;
  onPlan: (day: string) => void;
}) {
  const [ym, setYm] = useState(() => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) }));
  const [picked, setPicked] = useState<string | null>(null);
  const byDay = new Map<string, Outfit>();
  for (const o of outfits) if (!byDay.has(o.wornOn)) byDay.set(o.wornOn, o);
  const chosen = picked === null ? undefined : byDay.get(picked);
  const items = chosen === undefined ? [] : dressIn(clothes, chosen.itemIds);
  return (
    <section aria-label="カレンダー" className="calendar">
      <header className="month">
        <button
          type="button"
          className="ghost"
          aria-label="前の月"
          onClick={() => setYm(shiftMonth(ym.year, ym.month, -1))}
        >
          ‹
        </button>
        <h2>
          {ym.year}年{ym.month}月
        </h2>
        <button
          type="button"
          className="ghost"
          aria-label="次の月"
          onClick={() => setYm(shiftMonth(ym.year, ym.month, 1))}
        >
          ›
        </button>
      </header>
      <ul className="legend" aria-label="背景色の意味">
        <li className="same">{LIKENESS_NAMES.same}</li>
        <li className="near">{LIKENESS_NAMES.near}</li>
      </ul>
      <table className="month-grid">
        <thead>
          <tr>
            {WEEK.map((w) => (
              <th key={w} scope="col">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(ym.year, ym.month).map((week, i) => (
            <tr key={i}>
              {week.map((d, j) => {
                if (d === null) return <td key={j} />;
                const o = byDay.get(d);
                const held = o === undefined && pending !== null && pending.wornOn === d;
                const w = o ?? forecast.get(d) ?? null;
                const ahead = d > day;
                const like = o && weather && d !== day ? likeness(weather, o) : undefined;
                const words = [
                  `${md(d)}`,
                  o || held ? (ahead ? "決めておいた日" : "決めた日") : "",
                  like && like !== "far" ? LIKENESS_NAMES[like] : "",
                ];
                return (
                  <td key={d}>
                    <button
                      type="button"
                      className={`day ${like ?? ""} ${d === day ? "is-today" : ""}`}
                      data-testid={`day-${d}`}
                      data-like={like}
                      aria-pressed={picked === d}
                      aria-label={words.filter(Boolean).join(" ")}
                      onClick={() => setPicked(d)}
                    >
                      <span className="num">{Number(d.slice(8))}</span>
                      {w && (
                        <span className="mini" data-testid="mini">
                          <SkyIcon sky={sky(w)} />
                          <span>{Math.round(w.tempMax)}°</span>
                          <span>{Math.round(w.humidity)}%</span>
                        </span>
                      )}
                      {(o || held) && (
                        <span
                          className={`day-stamp ${ahead ? "plan" : ""} ${held ? "held" : ""}`}
                          data-testid={ahead ? "day-plan" : "day-stamp"}
                          aria-hidden="true"
                        >
                          {ahead ? "♡" : "♥"}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {picked !== null && (
        <div className="picked" data-testid="picked">
          {chosen === undefined && picked > day ? (
            canPlan(day, picked) ? (
              <>
                <p className="muted">{md(picked)}のコーデを、予報を見ながら先に決めておけます。</p>
                <button type="button" className="primary" onClick={() => onPlan(picked)}>
                  この日のコーデを決める
                </button>
              </>
            ) : (
              <p className="muted" data-testid="too-far">
                {md(picked)}は先すぎて、まだ天気の予報がありません (15 日先まで決めておけます)。
              </p>
            )
          ) : chosen === undefined && pending !== null && pending.wornOn === picked ? (
            <p className="muted" data-testid="picked-held">
              {md(picked)}のコーデは決めてあります。天気が読めたら、その日の天気と一緒に保存します。
            </p>
          ) : chosen === undefined ? (
            <p className="muted">{md(picked)}は、まだコーデを決めていません。</p>
          ) : (
            <>
              <p>
                {md(picked)}のコーデ ({chosen.tempMax}℃ / {chosen.tempMin}℃・湿度 {chosen.humidity}%)
              </p>
              <div className="stage-wrap">
                <Stage worn={items} caption={`${md(picked)}のコーデ`} />
              </div>
              <LabelRow worn={items} />
              {picked >= day && canPlan(day, picked) ? (
                <button type="button" className="primary" onClick={() => onPlan(picked)}>
                  {picked === day ? "今日のコーデを着せ替える" : "この日のコーデを着せ替える"}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={items.length === 0}
                  onClick={() => onUse(items)}
                >
                  この日のコーデにする
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** 読んだ時刻 (例: 7:05)。 */
function hm(at: number): string {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}
