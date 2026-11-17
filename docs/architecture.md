# kisekae-closet — 設計

持ち主: **engineer**。設計を変えたら、同じ PR でここを書き直す。

## ドメインの言葉
- **服** (clothing): 写真・種類 (top / bottom / outer / dress / shoes / accessory)・暖かさ (1〜5)・名前
- **コーデ** (outfit): ある日に着た服の組と、その日の最高/最低気温・湿度・降水量
- **おすすめ**: 今日の天気から要る暖かさの合計を決め、手持ちの服から一番近い組を選ぶ (`src/recommend.ts`)
- **似た日**: 平均気温 ±2℃・湿度 ±15% の過去のコーデ

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
  - 決まり (純粋な関数): `recommend.ts`・`weather.ts`・`shrink.ts` の `fitSize`/`encodeSmall`
  - 通信: `client.ts` (zod で答えを検査)・`passkey.ts` (@simplewebauthn/browser)
  - 端末の保存: `storage.ts` (選んだ市だけ)
  - UI: `App.tsx`

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
