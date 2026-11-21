# kisekae-closet — 設計

持ち主: **engineer**。設計を変えたら、同じ PR でここを書き直す。

## ドメインの言葉
- **服** (clothing): 写真・種類 (top / bottom / outer / dress / shoes / accessory)・暖かさ (1〜5)・名前
- **コーデ** (outfit): ある日に着た服の組と、その日の最高/最低気温・湿度・降水量
- **おすすめ**: 今日の天気から要る暖かさの合計を決め、手持ちの服から一番近い組を選ぶ (`src/recommend.ts`)
- **似た日**: 平均気温 ±2℃・湿度 ±15% の過去のコーデ
- **着せ替え**: 服は種類ごとに 1 枚。同じ種類を着ると入れ替わり、ワンピースは上下と入れ替わる (`src/outfit.ts` の `wear`)
- **暖かさゲージ**: 着ている服 (くつ・こものは数えない) の暖かさの合計が、天気から決めた目標 (雨なら +1) の ±1 なら「ちょうどいい」。画面には数字を出さない (`gauge`)
- **今日のコーデ**: その日の `outfits` の 1 件。決め直すと、新しいものを足してから前のものを消す
- **先に決めておいたコーデ**: 今日から 15 日先までの日の `outfits` (worn_on が未来の日付。欄は足さない)。天気はその日の予報 (`weather.ts` の `parseForecast`・`canPlan`)。その日が来ると今日のコーデになる。最近着た服 (`recentlyWorn`) には数えない。サーバーも `api.ts` の `latestDay` で今日 (Asia/Tokyo) から 15 日先までに限る
- **テーマ**: サイト全体の色の組 (`src/theme.ts`)。端末の localStorage にだけ置く
- **天気の近さ**: 平均気温 ±1.5℃・湿度 ±10%・雨の有無が同じなら「ほぼ同じ」、±4℃・±20% なら「近い」 (`src/calendar.ts`)
- **前回の予報** (#21): 読めた予報を端末に置き (`kisekae-closet:forecast`、`weather.ts` の `SavedForecast`)、次に開いたら新しい答えを待たずに出す。この端末で使ったことがあれば、`App` がログインの確かめ (`/api/me`) と同時に読み始め、`Home` はその読み込みを使い回す。使ったことのない端末ではログインの前に外へ通信しない。ログアウト・未ログインで消す
- **天気の読み直し** (#31): 読めなければ `weather.ts` の `fetchForecastRetrying` が 1 秒・3 秒おいて 2 回まで読み直す (`RETRY_DELAYS_MS`。回数に上限があり、無限に通信しない)。それでも読めなければ画面の「もう一度読む」で、押したときだけまた上限まで読む。待つのは `sleep.ts` (テストで差しかえる)。それでも読めず前回の予報もなければ、その月のふだんの天気 (`normalWeather`、東京の平年に近い値) でおすすめを着せ、「この時期のふだんの天気でえらびました」と添える (評価 9)
- **写真の送り方**: 端末で送る前に Exif・XMP・IPTC を落とす (iPhone の Safari の JPEG は canvas から書いても Exif が付くため。src/shrink.ts の stripMetadata)
- **切り抜き**: 表示するときに端末で、写真の四辺につながった背景の色を透明にして服に切り詰める (`src/cutout.ts`)。サーバーには元の写真だけ。まず背景のむらから決めた狭い差でたどり (白い壁の前の淡い色の服を消さない)、背景がほとんど消えなければ (むらのある床など) 広い差でやり直す (#27、Rin0107/kisekae-closet-archive#49)。選んだばかりの写真 (blob:) は fetch せず <img> で読む (CSP の connect-src に blob: を足さない、#25)。服の上の細い突き出し (ハンガーのフック) は外す。服から離れた小さなかけらは消す (`MIN_PART`)

## 層と依存の向き
- Worker (`src/worker/`)
  - `index.ts` — 入口。`/api/` の外は静的ファイル (`ASSETS`)。`/api/` は Origin の検査 → ログイン → セッションから利用者 ID → `api.ts`
  - `api.ts` — 利用者の API (機能を足す場所)。`Store` の関数だけを呼ぶ
  - `db.ts` (守り) — D1 に触れる唯一の場所。全部 userId で絞る。件数の上限 (`LIMITS`)
  - `auth.ts` (守り) — パスキーの登録とログイン (@simplewebauthn/server)。問題は D1 に 5 分
  - `session.ts` (守り) — `__Host-sid` Cookie と、D1 の指紋 (SHA-256)
  - `photo.ts` (守り) — 写真の検査 (WebP/JPEG・300KB・Exif/XMP/IPTC なし)
  - `security.ts` (守り) — 守りのヘッダー
- 画面 (`src/`)
  - 決まり (純粋な関数): `theme.ts` (色の組・コントラスト)・`recommend.ts`・`outfit.ts` (着せ替え・ゲージ)・`calendar.ts` (月のマス・天気の近さ)・`cutout.ts` の `cutout`・`weather.ts`・`shrink.ts` の `fitSize`/`encodeSmall`
  - 通信: `client.ts` (zod で答えを検査)・`passkey.ts` (@simplewebauthn/browser)
  - 端末の保存: `storage.ts` (選んだ市とテーマだけ)
  - UI: `App.tsx` (今日・クローゼット・カレンダーの 3 画面と下のタブバー)・`Avatar.tsx` (アバターの台)・`Photo.tsx` (切り抜いた写真)

## API
| 方法 | 道 | 中身 |
| --- | --- | --- |
| POST | `/api/auth/register/options` | `{displayName?}` → `{challengeId, options}` |
| POST | `/api/auth/register/verify` | `{challengeId, response}` → Cookie |
| POST | `/api/auth/login/options` | → `{challengeId, options}` |
| POST | `/api/auth/login/verify` | `{challengeId, response}` → Cookie |
| POST | `/api/auth/logout` | Cookie を消す |
| GET | `/api/me` | `{signedIn: true}` か 401 |
| DELETE | `/api/account` | アカウントと全データを消す |
| GET/POST | `/api/clothes` | 一覧 (写真なし) / `{kind, warmth, label, photo(base64)}` |
| GET | `/api/clothes/:id/photo` | 写真 (本人だけ、no-store) |
| PATCH/DELETE | `/api/clothes/:id` | `{kind?, warmth?, label?}` / 消す |
| GET/POST | `/api/outfits` | `?limit=` / `{wornOn, itemIds, tempMax, tempMin, humidity, precip}` |
| DELETE | `/api/outfits/:id` | 消す |
| GET | `/api/export` | 服 (写真つき) とコーデの JSON |

GET 以外は `Origin` が `env.ORIGIN` と同じときだけ。応答は `Cache-Control: private, no-store`。

## 仕様との対応
- `spec/Access.tla` の `OwnerOnly` — `tests/unit/db.test.ts`・`worker.test.ts` の `Spec_OwnerOnly`
- `spec/Access.tla` の `NoExpiredAccess` — `tests/unit/db.test.ts` の `Spec_NoExpiredAccess`
- `spec/recommend.smt2` — `tests/unit/recommend.test.ts` の PBT (寒いほど下がらない)

## 配り方
`npm run bundle` が `dist/` (静的) と `bundle/worker.js` (Worker を 1 ファイルに) を作る。
`wk deploy` がそれと `migrations/` を deploy ブランチに置き、本番の `wrangler.jsonc` (名前・D1 の database_id・ORIGIN) を作る。
Cloudflare で動くのは版固定の wrangler だけ (工場の書いたコードは鍵のある所で動かない)。

## 決めたこと
- 2026-11-15 ログインはパスキーだけ (Google 認証は OAuth の secret とメールが付くのでやめた)。持ち主の決定
- 2026-11-15 服は写真で登録 (持ち主の指定)。R2 は無料でもカードが要るので、D1 に 1 枚 300KB まで
- 2026-11-17 ラベルは今は服に 1 つ (`clothes.label`)。複数のラベル (labels 表) は migrations の変更なので、要ると分かったら人に頼む
- 2026-11-17 アバターは今は repo の中の SVG (正面・すらっとした等身)。CC0 の 3D モデルから作った正面の姿への置きかえは次の版
- 2026-11-19 アバターの体を CC0 の 3D の人体 (MakeHuman の base mesh と体型の target) を Blender (Cycles、正面の正投影) で描いた WebP に置きかえた (#22)。枠は前の SVG と同じ (頭のてっぺん 3.5%・足の裏 93%) にそろえたので、`SLOTS` は変えていない。描き出しのスクリプトは repo に置かない (使い捨て。手順は `public/avatar/LICENSE.md`)
- 2026-11-17 先の日のコーデは今の `outfits` に未来の日付で置く (migrations を変えない)。予報は Open-Meteo の上限の 16 日 (今日を含む) を 1 回で読む。それより先 (例年の値)・旅行先の市は次の版
- 2026-11-19 服を幅で合わせて重ねるようにした (#26)。体の絵の画素を測った目印を `outfit.ts` の `BODY` に置き、`SLOTS` はそれに合わせた。zod の JIT を切った (`src/zod-setup.ts`、new Function の下調べが CSP 違反として報告されるため、#25)
- 2026-11-20 袖の先が台の外に出るなら、角度を腕のまま、付け根を中心に袖を小さくして収める (`outfit.ts` の `sleeveFit`、`SCALE_MIN` まで)。小さくしても出るときだけ角度を内へ戻す (#19)

## 天気が読めないうちに決めたコーデ (#46)
D1 のコーデはその日の気温・湿度・降水量を必ず持つ (migrations は守りの部分で、欄を空にできない)。
天気が読めないうちに「これに決めた」を押したら、日付と服の ID だけを端末 (`kisekae-closet:pending`) に置き、
その日の天気が読めたら いつものコーデとして保存して端末から消す (`App.tsx` の `decideLater` と保存の effect)。今日より前のものは捨てる。
