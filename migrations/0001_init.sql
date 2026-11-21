-- 守りの部分 (wakuwaku guard で書き換え禁止)。欄を足すときは DATA.md を先に直し、人に頼む。
-- 持つのは: ランダムな利用者 ID・パスキーの公開鍵・セッションの指紋 (SHA-256)・服 (写真)・コーデと、その日の気温と湿度の数字だけ。
-- 名前・メール・パスワード・場所・IP・User-Agent は持たない (scripts/data-guard.mjs が欄の名前を検査する)。

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX passkeys_user ON passkeys(user_id);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,
  pending_user TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE logins (
  sid_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX logins_user ON logins(user_id);

CREATE TABLE clothes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  warmth INTEGER NOT NULL,
  label TEXT NOT NULL,
  photo BLOB NOT NULL,
  photo_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX clothes_user ON clothes(user_id);

CREATE TABLE outfits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worn_on TEXT NOT NULL,
  temp_max REAL NOT NULL,
  temp_min REAL NOT NULL,
  humidity REAL NOT NULL,
  precip REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX outfits_user ON outfits(user_id, worn_on);

CREATE TABLE outfit_items (
  outfit_id TEXT NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES clothes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (outfit_id, item_id)
);
CREATE INDEX outfit_items_user ON outfit_items(user_id);
