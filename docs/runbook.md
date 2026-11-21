# kisekae-closet — 運用の手引き

持ち主: **sre**。壊れたときに、これだけを読めば戻せるように書く。

## 動かし方と確かめ方
- 手元: `npm ci && npm run verify` (lint・型・テスト・ビルド・守りの検査)、`npm run e2e` (wrangler dev と手元の D1。パスキーは Chromium の仮想の認証器)
- 本番: `wk deploy` (工場がやる)。`npm run bundle` の `dist/` と `bundle/worker.js` と `migrations/` を deploy ブランチに置き、Cloudflare (Workers Builds) が版固定の wrangler で `d1 migrations apply` と `deploy` をする
- 鍵はこのマシンにも repo にも置かない。D1 の database_id と ORIGIN は秘密ではない (wk が本番の wrangler.jsonc に書く)

## 失敗の種類と扱い
| 失敗 | 利用者に見えるもの | 確かめ方 |
| --- | --- | --- |
| セッションの期限切れ・消えた | ログインの前の画面に戻る (401) | `GET /api/me` が 401 |
| パスキーを確かめられない | 「パスキーを確かめられない」 | 問題 (5 分) の期限、rp ID (= ORIGIN のホスト名) が合っているか |
| 写真が大きい・Exif が残る | 理由を出す (400) | `src/worker/photo.ts` の理由の文 |
| 上限 (服 500・コーデ 5000) | 「服は 500 着まで」など (400) | `LIMITS` (db.ts) |
| Worker の中の失敗 | 「失敗した」(500)。ログは固定の文だけ | Cloudflare のダッシュボードの数 (中身は残らない) |
| 天気が読めない | 自動で 2 回読み直し、だめなら「もう一度読む」を出す。前回の予報があればそれで決められる (クローゼットは使える) | Open-Meteo の答え (`src/weather.ts` の parseWeather) |

## 戻し方
- 壊れた版を出したとき: 直す PR を出して `wk merge` → `wk deploy`。前の版に戻すなら revert の PR
- migrations は足すだけ (消す・名前を変えるものは書かない)。戻すときも新しい migration で
- 利用者のデータを消してしまったときに戻す手段は持たない (バックアップに個人のデータを置かない)。だから消す処理は db.ts の決まった関数だけ

## テストの体制
- e2e はまず iphone (iPhone 13 の大きさ 390×664・タッチ・モバイル、chromium) で、次に広い画面 (Desktop Chrome、1280) で走る (`playwright.config.ts` の projects。持ち主 Rin0107/kisekae-closet-archive#49「スマホ最優先、テストは必ずスマホ幅で」)
- 認可: 別の利用者からは届かないことを `tests/unit/db.test.ts`・`worker.test.ts`・`routes.test.ts` で (Spec_OwnerOnly)
- D1 は `tests/unit/fake-d1.ts` (Node の SQLite に migrations を流したもの)
<!-- 不安定なテストの記録 (日付・どのテスト・原因・直し方)。再実行で通すのは直したことにならない -->

## 依存
- `@simplewebauthn/server` 14.0.3・`@simplewebauthn/browser` 14.0.0 — パスキー (2026-11-15。2 週間より前に出た版)
- `zod` — 入力の検査。`react`・`react-dom` — 画面
