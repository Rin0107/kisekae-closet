// D1 に触れてよいのはこのファイルだけ (scripts/db-guard.mjs が CI で止める)。守りの部分 (wakuwaku guard で書き換え禁止)。
// 利用者のデータを読む・書く関数は全部 userId を受け取り、必ず `WHERE user_id = ?` を付ける (他人のデータを読めない・消せない)。
// 利用者をまたいで引くのは、ログインの途中 (パスキーの ID・セッションの指紋から誰かを知る) だけ。

export interface DbEnv {
  DB: D1Database;
}

/** 1 人が持てる量の上限 (無料枠と、壊れたクライアントからサーバーを守る)。 */
export const LIMITS = { clothes: 500, outfits: 5000, itemsPerOutfit: 12 } as const;

export interface Passkey {
  userId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
}

export interface Challenge {
  challenge: string;
  pendingUser: string | null;
}

export interface Clothing {
  id: string;
  kind: string;
  warmth: number;
  label: string;
  createdAt: number;
}

export interface NewClothing {
  id: string;
  kind: string;
  warmth: number;
  label: string;
  photo: Uint8Array;
  photoType: string;
}

export interface ClothingPatch {
  kind?: string | undefined;
  warmth?: number | undefined;
  label?: string | undefined;
}

export interface Outfit {
  id: string;
  wornOn: string;
  tempMax: number;
  tempMin: number;
  humidity: number;
  precip: number;
  itemIds: string[];
}

/** D1 の BLOB は、版によって ArrayBuffer・Uint8Array・数の配列で返る。どれでも Uint8Array にする。 */
export function toBytes(v: unknown): Uint8Array<ArrayBuffer> {
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  throw new Error("BLOB でない");
}

interface ClothingRow {
  id: string;
  kind: string;
  warmth: number;
  label: string;
  created_at: number;
}

interface OutfitRow {
  id: string;
  worn_on: string;
  temp_max: number;
  temp_min: number;
  humidity: number;
  precip: number;
}

export class Store {
  readonly #db: D1Database;

  constructor(env: DbEnv) {
    this.#db = env.DB;
  }

  // ---- ログイン (利用者をまたぐのはここだけ) ----

  async putChallenge(
    id: string,
    challenge: string,
    purpose: string,
    pendingUser: string | null,
    expiresAt: number,
  ) {
    await this.#db
      .prepare(
        "INSERT INTO challenges (id, challenge, purpose, pending_user, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(id, challenge, purpose, pendingUser, expiresAt)
      .run();
  }

  /** 問題を取り出して消す (1 回しか使えない)。期限切れ・用途違いは null。古い問題もここで掃除する。 */
  async takeChallenge(id: string, purpose: string, now: number): Promise<Challenge | null> {
    const row = await this.#db
      .prepare("SELECT challenge, purpose, pending_user, expires_at FROM challenges WHERE id = ?")
      .bind(id)
      .first<{ challenge: string; purpose: string; pending_user: string | null; expires_at: number }>();
    await this.#db.batch([
      this.#db.prepare("DELETE FROM challenges WHERE id = ?").bind(id),
      this.#db.prepare("DELETE FROM challenges WHERE expires_at <= ?").bind(now),
    ]);
    if (row === null || row.purpose !== purpose || row.expires_at <= now) return null;
    return { challenge: row.challenge, pendingUser: row.pending_user };
  }

  async createUserWithPasskey(
    userId: string,
    credentialId: string,
    key: Omit<Passkey, "userId">,
    now: number,
  ) {
    await this.#db.batch([
      this.#db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").bind(userId, now),
      this.#db
        .prepare(
          "INSERT INTO passkeys (credential_id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(credentialId, userId, key.publicKey, key.counter, JSON.stringify(key.transports), now),
    ]);
  }

  async findPasskey(credentialId: string): Promise<Passkey | null> {
    const row = await this.#db
      .prepare("SELECT user_id, public_key, counter, transports FROM passkeys WHERE credential_id = ?")
      .bind(credentialId)
      .first<{ user_id: string; public_key: unknown; counter: number; transports: string }>();
    if (row === null) return null;
    return {
      userId: row.user_id,
      publicKey: toBytes(row.public_key),
      counter: row.counter,
      transports: JSON.parse(row.transports) as string[],
    };
  }

  async updateCounter(userId: string, credentialId: string, counter: number) {
    await this.#db
      .prepare("UPDATE passkeys SET counter = ? WHERE credential_id = ? AND user_id = ?")
      .bind(counter, credentialId, userId)
      .run();
  }

  async putLogin(userId: string, sidHash: string, expiresAt: number, now: number) {
    await this.#db
      .prepare("INSERT INTO logins (sid_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(sidHash, userId, expiresAt, now)
      .run();
  }

  /** セッションの指紋から利用者を引く。期限切れは null (消す)。 */
  async findLogin(sidHash: string, now: number): Promise<string | null> {
    const row = await this.#db
      .prepare("SELECT user_id, expires_at FROM logins WHERE sid_hash = ?")
      .bind(sidHash)
      .first<{ user_id: string; expires_at: number }>();
    if (row === null) return null;
    if (row.expires_at <= now) {
      await this.deleteLogin(sidHash);
      return null;
    }
    return row.user_id;
  }

  async deleteLogin(sidHash: string) {
    await this.#db.prepare("DELETE FROM logins WHERE sid_hash = ?").bind(sidHash).run();
  }

  /** アカウントと全データを消す。 */
  async deleteUser(userId: string) {
    await this.#db.batch(
      ["outfit_items", "outfits", "clothes", "logins", "passkeys"]
        .map((t) => this.#db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(userId))
        .concat([this.#db.prepare("DELETE FROM users WHERE id = ?").bind(userId)]),
    );
  }

  // ---- 利用者のデータ (全部 user_id で絞る) ----

  async listClothes(userId: string): Promise<Clothing[]> {
    const { results } = await this.#db
      .prepare(
        "SELECT id, kind, warmth, label, created_at FROM clothes WHERE user_id = ? ORDER BY created_at, id",
      )
      .bind(userId)
      .all<ClothingRow>();
    return results.map((r) => ({
      id: r.id,
      kind: r.kind,
      warmth: r.warmth,
      label: r.label,
      createdAt: r.created_at,
    }));
  }

  /** 服を足す。上限に達していれば false。 */
  async addClothing(userId: string, c: NewClothing, now: number): Promise<boolean> {
    const n = await this.#count("clothes", userId);
    if (n >= LIMITS.clothes) return false;
    await this.#db
      .prepare(
        "INSERT INTO clothes (id, user_id, kind, warmth, label, photo, photo_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(c.id, userId, c.kind, c.warmth, c.label, c.photo, c.photoType, now)
      .run();
    return true;
  }

  async getPhoto(
    userId: string,
    id: string,
  ): Promise<{ photo: Uint8Array<ArrayBuffer>; photoType: string } | null> {
    const row = await this.#db
      .prepare("SELECT photo, photo_type FROM clothes WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<{ photo: unknown; photo_type: string }>();
    return row === null ? null : { photo: toBytes(row.photo), photoType: row.photo_type };
  }

  async updateClothing(userId: string, id: string, p: ClothingPatch): Promise<boolean> {
    const r = await this.#db
      .prepare(
        "UPDATE clothes SET kind = coalesce(?, kind), warmth = coalesce(?, warmth), label = coalesce(?, label) WHERE id = ? AND user_id = ?",
      )
      .bind(p.kind ?? null, p.warmth ?? null, p.label ?? null, id, userId)
      .run();
    return r.meta.changes > 0;
  }

  async deleteClothing(userId: string, id: string): Promise<boolean> {
    const res = await this.#db.batch([
      this.#db.prepare("DELETE FROM outfit_items WHERE item_id = ? AND user_id = ?").bind(id, userId),
      this.#db.prepare("DELETE FROM clothes WHERE id = ? AND user_id = ?").bind(id, userId),
    ]);
    return (res[1] as D1Result).meta.changes > 0;
  }

  async listOutfits(userId: string, limit: number): Promise<Outfit[]> {
    const { results } = await this.#db
      .prepare(
        "SELECT id, worn_on, temp_max, temp_min, humidity, precip FROM outfits WHERE user_id = ? ORDER BY worn_on DESC, created_at DESC LIMIT ?",
      )
      .bind(userId, limit)
      .all<OutfitRow>();
    const items = await this.#db
      .prepare("SELECT outfit_id, item_id FROM outfit_items WHERE user_id = ? ORDER BY item_id")
      .bind(userId)
      .all<{ outfit_id: string; item_id: string }>();
    const byOutfit = new Map<string, string[]>();
    for (const it of items.results)
      byOutfit.set(it.outfit_id, [...(byOutfit.get(it.outfit_id) ?? []), it.item_id]);
    return results.map((r) => ({
      id: r.id,
      wornOn: r.worn_on,
      tempMax: r.temp_max,
      tempMin: r.temp_min,
      humidity: r.humidity,
      precip: r.precip,
      itemIds: byOutfit.get(r.id) ?? [],
    }));
  }

  /** コーデを足す。上限なら "limit"、自分の服でない ID があれば "unknown-item"。 */
  async addOutfit(userId: string, o: Outfit, now: number): Promise<"ok" | "limit" | "unknown-item"> {
    if ((await this.#count("outfits", userId)) >= LIMITS.outfits) return "limit";
    const marks = o.itemIds.map(() => "?").join(", ");
    const own = await this.#db
      .prepare(`SELECT count(*) AS n FROM clothes WHERE user_id = ? AND id IN (${marks})`)
      .bind(userId, ...o.itemIds)
      .first<{ n: number }>();
    if ((own as { n: number }).n !== o.itemIds.length) return "unknown-item";
    await this.#db.batch([
      this.#db
        .prepare(
          "INSERT INTO outfits (id, user_id, worn_on, temp_max, temp_min, humidity, precip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(o.id, userId, o.wornOn, o.tempMax, o.tempMin, o.humidity, o.precip, now),
      ...o.itemIds.map((item) =>
        this.#db
          .prepare("INSERT INTO outfit_items (outfit_id, item_id, user_id) VALUES (?, ?, ?)")
          .bind(o.id, item, userId),
      ),
    ]);
    return "ok";
  }

  async deleteOutfit(userId: string, id: string): Promise<boolean> {
    const res = await this.#db.batch([
      this.#db.prepare("DELETE FROM outfit_items WHERE outfit_id = ? AND user_id = ?").bind(id, userId),
      this.#db.prepare("DELETE FROM outfits WHERE id = ? AND user_id = ?").bind(id, userId),
    ]);
    return (res[1] as D1Result).meta.changes > 0;
  }

  /** 書き出し用に、自分の服を写真つきで全部。 */
  async exportClothes(
    userId: string,
  ): Promise<(Clothing & { photo: Uint8Array<ArrayBuffer>; photoType: string })[]> {
    const { results } = await this.#db
      .prepare(
        "SELECT id, kind, warmth, label, created_at, photo, photo_type FROM clothes WHERE user_id = ? ORDER BY created_at, id",
      )
      .bind(userId)
      .all<ClothingRow & { photo: unknown; photo_type: string }>();
    return results.map((r) => ({
      id: r.id,
      kind: r.kind,
      warmth: r.warmth,
      label: r.label,
      createdAt: r.created_at,
      photo: toBytes(r.photo),
      photoType: r.photo_type,
    }));
  }

  async #count(table: "clothes" | "outfits", userId: string): Promise<number> {
    const row = await this.#db
      .prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`)
      .bind(userId)
      .first<{ n: number }>();
    return (row as { n: number }).n;
  }
}
