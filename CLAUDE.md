# kisekae-closet — エージェントの決まり

wakuwaku factory が作るアプリ (stack: web-db。ログインと D1 を持つ)。工場の設計: `~/src/okuos/repos/ideas/docs/DESIGN.md`・`docs/DESIGN-v3.md` §10。

## 一番大事: 重要な情報を持たない (持つものは最小)

- ログインは**パスキーだけ**。パスワード・メールアドレス・名前・住所・電話・IP・User-Agent・位置・支払いを**作らない・受け取らない・残さない**
- サーバー (D1) に何を置くかは `DATA.md` と `migrations/` で決まっている。欄を足すときは、人に頼む (migrations は守りの部分)
- **D1 に触れてよいのは `src/worker/db.ts` だけ** (`scripts/db-guard.mjs` が止める)。db.ts の関数は全部 userId で絞る。要る読み書きがなければ、db.ts に関数を足すよう人に頼む
- 利用者 ID はセッションから決まる (`src/worker/index.ts`)。クライアントから受け取らない
- Cookie はセッション (`__Host-sid`) だけ。読むのは `src/worker/session.ts` だけ。`document.cookie`・IndexedDB・Service Worker は使わない (eslint が止める)
- 写真は端末で縮めて (Exif・XMP が落ちる) から送る (`src/shrink.ts`)。サーバーは `src/worker/photo.ts` で検査する
- 場所はサーバーに送らない。天気はブラウザが Open-Meteo を直接読む (`src/weather.ts`)
- 外部のスクリプト・フォント・解析・広告を入れない。外部 API は wk.json の egress_allow だけ (ユーザーだけが変える)
- 生の HTML を差し込まない。入力は全部 zod で検査し、大きさの上限をかける (サーバーもクライアントも)
- Worker でログを出さない (`console.error` に固定の文だけ)。失敗の中身を応答に出さない
- 秘密情報を repo に置かない。鍵の要るものを作らない

## 層 (docs/architecture.md)

- `src/worker/index.ts` — 入口。Origin の検査・ログイン・セッション・アカウントの削除
- `src/worker/api.ts` — ログインした利用者の API。**機能はここに足す** (Store の関数を呼ぶだけ)
- 守りの部分: `src/worker/security.ts` `auth.ts` `session.ts` `db.ts` `photo.ts`、`migrations/`
- 画面: `src/App.tsx` など。決まり (おすすめ・天気) は純粋な関数 (`src/recommend.ts` `src/weather.ts`)

## 正しさの決まり (docs/TESTING.md)

**v3: 関門は段階に合わせる** (工場の docs/DESIGN-v3.md §5)。
- **いつも**: lint・型・AC のテスト・ビルド・守りの検査 (`npm run verify`)・e2e (パスキーの登録とログインを、Chromium の仮想の認証器で)。セキュリティの決まり (上) はいつも全部
- **認可のテスト**: データに触れる機能を足したら、**別の利用者からは届かない** (読めない・変えられない・消せない) ことを `tests/unit/worker.test.ts` の形でテストする
- **出す前**: カバレッジ 100%・ミューテーション 95% (`npm run verify-ship`、CI の fuzz・mutation・formal を手で起動)
- **仕様が先**: 誰のデータに届くかは `spec/Access.tla`、おすすめの性質は `spec/recommend.smt2`。cfg の INVARIANT ごとに `"Spec_<名前>: …"` のテスト
- **テストの種類**: 境界値・全件ループ・PBT (fast-check、`tests/unit/fc.ts` の `runs()`)・fuzz (名前に `fuzz`)・M (`tests/e2e`、手元の Worker と D1)
- D1 のテストは `tests/unit/fake-d1.ts` (Node の SQLite に migrations を流したもの。本物と同じ SQL)
- **速さ**: CI のジョブはどれも 5 分で打ち切り

## 進め方

- 1 版 = 1 ブランチ = 1 PR (`Closes #N` を issue の数だけ並べる)。main に直接 push しない
- issue の受け入れ条件ごとにテストを書く。テスト名に `AC-<issue>-<n>` を入れる (`scripts/ac-coverage.mjs` が CI で検査)
- `npm run verify` が通ってから PR。`wk review` → `wk merge` (gh pr merge は使わない)。配るのは `wk deploy`
- 依存を足すのは最後の手段。足すなら `npm install -E` で固定し、PR に理由を書く

## ロールと持ち場の文書 (工場の docs/ROLES.md)
変えるときは、同じ PR で持ち場の文書も直す。レビューは sre の目 (セキュリティと壊れ方)。
- `docs/design-system.md` — **designer**: トークン・部品・状態・文言・アクセシビリティ
- `docs/architecture.md` — **engineer**: ドメインの言葉・層と依存の向き・API・仕様との対応
- `docs/runbook.md` — **sre**: 動かし方・失敗の種類と扱い・戻し方・テストの体制

## 変えてはいけないもの (guard が止める)

`.github/` `.claude/` `scripts/` `wk.json` `wrangler.jsonc` `vitest.config.ts` `stryker.config.json` `spec/README.md`、
`src/worker/security.ts` `src/worker/auth.ts` `src/worker/session.ts` `src/worker/db.ts` `src/worker/photo.ts` `migrations/` (wk.json の protected)
