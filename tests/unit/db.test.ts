import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { LIMITS, Store, toBytes } from "../../src/worker/db";
import { fakeEnv } from "./fake-d1";
import { runs } from "./fc";

const NOW = 1_800_000_000_000;
const KEY = { publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] };

async function setup(...users: string[]) {
  return setupWith(true, ...users);
}

async function setupWith(foreignKeys: boolean, ...users: string[]) {
  const { d1, env } = fakeEnv(foreignKeys);
  const s = new Store(env);
  for (const u of users) await s.createUserWithPasskey(u, `cred-${u}`, KEY, NOW);
  return { d1, s };
}

const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xda]);
const shirt = (id: string, over: Partial<{ kind: string; warmth: number; label: string }> = {}) => ({
  id,
  kind: "top",
  warmth: 2,
  label: "白シャツ",
  photo,
  photoType: "image/jpeg",
  ...over,
});
const day = (id: string, itemIds: string[], wornOn = "2026-11-15") => ({
  id,
  wornOn,
  tempMax: 15,
  tempMin: 8,
  humidity: 60,
  precip: 0,
  itemIds,
});

describe("toBytes", () => {
  test("ArrayBuffer・Uint8Array・数の配列を同じ中身の Uint8Array にする", () => {
    for (const v of [new Uint8Array([1, 2]), new Uint8Array([1, 2]).buffer, [1, 2]]) {
      expect(Array.from(toBytes(v))).toEqual([1, 2]);
    }
  });
  test("BLOB でなければ止まる", () => {
    expect(() => toBytes("x")).toThrow("BLOB でない");
  });
});

describe("ログインの問題 (challenge)", () => {
  test("1 回だけ取り出せ、用途・期限が合わなければ null", async () => {
    const { s, d1 } = await setup();
    await s.putChallenge("c1", "abc", "login", null, NOW + 10);
    expect(await s.takeChallenge("c1", "login", NOW)).toEqual({ challenge: "abc", pendingUser: null });
    expect(await s.takeChallenge("c1", "login", NOW)).toBeNull();
    await s.putChallenge("c2", "x", "register", "u", NOW + 10);
    expect(await s.takeChallenge("c2", "login", NOW)).toBeNull(); // 用途違いでも消える
    expect(d1.rows("SELECT * FROM challenges")).toHaveLength(0);
    await s.putChallenge("c3", "x", "register", "u", NOW + 10);
    expect(await s.takeChallenge("c3", "register", NOW + 10)).toBeNull(); // 期限ちょうどは切れている
    await s.putChallenge("c4", "y", "register", "u", NOW + 11);
    expect(await s.takeChallenge("c4", "register", NOW + 10)).toEqual({ challenge: "y", pendingUser: "u" });
  });
  test("取り出すたびに、期限の切れた問題を掃除する", async () => {
    const { s, d1 } = await setup();
    await s.putChallenge("old", "x", "login", null, NOW);
    await s.putChallenge("live", "y", "login", null, NOW + 1);
    await s.takeChallenge("none", "login", NOW);
    expect(d1.rows("SELECT id FROM challenges")).toEqual([{ id: "live" }]);
  });
});

describe("パスキー", () => {
  test("ID から持ち主・公開鍵・回数・つなぎ方を引き、回数は持ち主のものだけ変わる", async () => {
    const { s } = await setup("a", "b");
    const k = await s.findPasskey("cred-a");
    expect(k).toEqual({
      userId: "a",
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
      transports: ["internal"],
    });
    await s.updateCounter("b", "cred-a", 9); // 持ち主でなければ変わらない
    expect((await s.findPasskey("cred-a"))?.counter).toBe(0);
    await s.updateCounter("a", "cred-a", 9);
    expect((await s.findPasskey("cred-a"))?.counter).toBe(9);
    expect(await s.findPasskey("nope")).toBeNull();
  });
});

describe("セッション", () => {
  test("Spec_NoExpiredAccess: 期限の前だけ利用者が分かり、期限ちょうどからは消える", async () => {
    const { s, d1 } = await setup("a");
    await s.putLogin("a", "h", NOW + 100, NOW);
    expect(await s.findLogin("h", NOW + 99)).toBe("a");
    expect(await s.findLogin("h", NOW + 100)).toBeNull();
    expect(d1.rows("SELECT * FROM logins")).toHaveLength(0);
    expect(await s.findLogin("none", NOW)).toBeNull();
    await s.putLogin("a", "h2", NOW + 100, NOW);
    await s.deleteLogin("h2");
    expect(await s.findLogin("h2", NOW)).toBeNull();
  });
});

describe("服とコーデ", () => {
  test("足して・並べて・写真を引き・変えて・消せる", async () => {
    const { s } = await setup("a");
    expect(await s.addClothing("a", shirt("s1"), NOW)).toBe(true);
    expect(await s.addClothing("a", shirt("s0", { kind: "bottom" }), NOW)).toBe(true);
    expect(await s.listClothes("a")).toEqual([
      { id: "s0", kind: "bottom", warmth: 2, label: "白シャツ", createdAt: NOW },
      { id: "s1", kind: "top", warmth: 2, label: "白シャツ", createdAt: NOW },
    ]);
    expect(await s.getPhoto("a", "s1")).toEqual({ photo, photoType: "image/jpeg" });
    expect(await s.updateClothing("a", "s1", { label: "青" })).toBe(true);
    expect(await s.updateClothing("a", "s1", { kind: "outer", warmth: 4 })).toBe(true);
    expect((await s.listClothes("a")).find((c) => c.id === "s1")).toMatchObject({
      kind: "outer",
      warmth: 4,
      label: "青",
    });
    expect(await s.deleteClothing("a", "s1")).toBe(true);
    expect(await s.deleteClothing("a", "s1")).toBe(false);
    expect(await s.getPhoto("a", "s1")).toBeNull();
  });

  test("コーデは新しい順で、服の ID が並び、服を消すとコーデからも抜ける", async () => {
    const { s } = await setup("a");
    await s.addClothing("a", shirt("s1"), NOW);
    await s.addClothing("a", shirt("s2"), NOW);
    expect(await s.addOutfit("a", day("o1", ["s2", "s1"], "2026-11-14"), NOW)).toBe("ok");
    expect(await s.addOutfit("a", day("o2", ["s1"], "2026-11-15"), NOW)).toBe("ok");
    const list = await s.listOutfits("a", 10);
    expect(list.map((o) => [o.id, o.itemIds])).toEqual([
      ["o2", ["s1"]],
      ["o1", ["s1", "s2"]],
    ]);
    expect(list[1]).toMatchObject({ wornOn: "2026-11-14", tempMax: 15, tempMin: 8, humidity: 60, precip: 0 });
    expect(await s.listOutfits("a", 1)).toHaveLength(1);
    await s.deleteClothing("a", "s1");
    expect((await s.listOutfits("a", 10)).map((o) => o.itemIds)).toEqual([[], ["s2"]]);
    expect(await s.deleteOutfit("a", "o1")).toBe(true);
    expect(await s.deleteOutfit("a", "o1")).toBe(false);
  });

  test("Spec_OwnerOnly: ほかの人の服・写真・コーデは読めず、変えられず、消せず、コーデに入れられない", async () => {
    const { s } = await setup("a", "b");
    await s.addClothing("a", shirt("s1"), NOW);
    await s.addOutfit("a", day("o1", ["s1"]), NOW);
    expect(await s.listClothes("b")).toEqual([]);
    expect(await s.getPhoto("b", "s1")).toBeNull();
    expect(await s.updateClothing("b", "s1", { label: "x" })).toBe(false);
    expect(await s.deleteClothing("b", "s1")).toBe(false);
    expect(await s.listOutfits("b", 10)).toEqual([]);
    expect(await s.deleteOutfit("b", "o1")).toBe(false);
    expect(await s.addOutfit("b", day("o2", ["s1"]), NOW)).toBe("unknown-item");
    expect(await s.exportClothes("b")).toEqual([]);
    // a のものは残っている
    expect(await s.listClothes("a")).toHaveLength(1);
    expect(await s.listOutfits("a", 10)).toHaveLength(1);
  });

  test("Spec_OwnerOnly: PBT (2 人がでたらめな順に操作しても、相手のものは見えない)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ who: fc.constantFrom("a", "b"), op: fc.integer({ min: 0, max: 3 }), n: fc.nat(3) }),
          {
            maxLength: 12,
          },
        ),
        async (ops) => {
          const { s } = await setup("a", "b");
          for (const o of ops) {
            const other = o.who === "a" ? "b" : "a";
            const id = `${other}-${o.n}`;
            if (o.op === 0) await s.addClothing(o.who, shirt(`${o.who}-${o.n}-${ops.indexOf(o)}`), NOW);
            if (o.op === 1) expect(await s.deleteClothing(o.who, id)).toBe(false);
            if (o.op === 2) expect(await s.getPhoto(o.who, id)).toBeNull();
            if (o.op === 3) expect(await s.updateClothing(o.who, id, { label: "x" })).toBe(false);
          }
          for (const u of ["a", "b"])
            for (const c of await s.listClothes(u)) expect(c.id.startsWith(`${u}-`)).toBe(true);
        },
      ),
      { ...runs(), numRuns: Math.min(runs().numRuns ?? 50, 50) },
    );
  });

  test("服は上限まで、コーデも上限まで", async () => {
    const { s, d1 } = await setup("a");
    const insert = d1.db.prepare(
      "INSERT INTO clothes (id, user_id, kind, warmth, label, photo, photo_type, created_at) VALUES (?, 'a', 'top', 1, '', x'00', 'image/jpeg', 0)",
    );
    for (let i = 0; i < LIMITS.clothes - 1; i++) insert.run(`c${i}`);
    expect(await s.addClothing("a", shirt("last"), NOW)).toBe(true);
    expect(await s.addClothing("a", shirt("over"), NOW)).toBe(false);
    const o = d1.db.prepare(
      "INSERT INTO outfits (id, user_id, worn_on, temp_max, temp_min, humidity, precip, created_at) VALUES (?, 'a', '2026-01-01', 0, 0, 0, 0, 0)",
    );
    for (let i = 0; i < LIMITS.outfits - 1; i++) o.run(`o${i}`);
    expect(await s.addOutfit("a", day("last", ["last"]), NOW)).toBe("ok");
    expect(await s.addOutfit("a", day("over", ["last"]), NOW)).toBe("limit");
  });

  test("書き出しは自分の服を写真つきで", async () => {
    const { s } = await setup("a");
    await s.addClothing("a", shirt("s1"), NOW);
    expect(await s.exportClothes("a")).toEqual([
      { id: "s1", kind: "top", warmth: 2, label: "白シャツ", createdAt: NOW, photo, photoType: "image/jpeg" },
    ]);
  });

  test("アカウントを消すと、その人の行は全部消え、ほかの人は残る", async () => {
    // 外部キーに頼らない (D1 の設定がどうでも、自分で全部消す)
    const { s, d1 } = await setupWith(false, "a", "b");
    for (const u of ["a", "b"]) {
      await s.addClothing(u, shirt(`${u}1`), NOW);
      await s.addOutfit(u, day(`${u}o`, [`${u}1`]), NOW);
      await s.putLogin(u, `h${u}`, NOW + 1, NOW);
    }
    await s.deleteUser("a");
    for (const t of ["users", "passkeys", "logins", "clothes", "outfits", "outfit_items"]) {
      const col = t === "users" ? "id" : "user_id";
      expect(d1.rows(`SELECT * FROM ${t} WHERE ${col} = 'a'`)).toHaveLength(0);
      expect(d1.rows(`SELECT * FROM ${t} WHERE ${col} = 'b'`)).toHaveLength(1);
    }
  });
});
