// Worker の入口と API を、通しで確かめる (D1 はテスト用の SQLite、パスキーの暗号は差し替え)。
import { beforeEach, describe, expect, test, vi } from "vitest";

const sw = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: "c" })),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: "c" })),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock("@simplewebauthn/server", () => sw);

import { latestDay, MAX_BODY_BYTES, readJson } from "../../src/worker/api";
import { LIMITS } from "../../src/worker/db";
import worker, { route, type Env } from "../../src/worker/index";
import { fakeEnv } from "./fake-d1";

const ORIGIN = "https://closet.example.workers.dev";
const NOW = 1_800_000_000_000;
let env: Env;
let d1: ReturnType<typeof fakeEnv>["d1"];

beforeEach(() => {
  const f = fakeEnv();
  d1 = f.d1;
  env = {
    ...f.env,
    ORIGIN,
    ASSETS: {
      fetch: async (r: Request) => new Response(`asset ${new URL(r.url).pathname}`),
    } as unknown as Fetcher,
  };
  let n = 0;
  sw.verifyRegistrationResponse.mockImplementation(async () => ({
    verified: true,
    registrationInfo: {
      credential: { id: `cred-${++n}`, publicKey: new Uint8Array([1]), counter: 0, transports: [] },
    },
  }));
  sw.verifyAuthenticationResponse.mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  });
});

function req(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; origin?: string | null; type?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = opts.type ?? "application/json";
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body:
      opts.body === undefined
        ? undefined
        : typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body),
  });
}

async function call(method: string, path: string, opts: Parameters<typeof req>[2] = {}) {
  const res = await worker.fetch(req(method, path, opts), env);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

/** 登録してログインした Cookie を返す。 */
async function signUp(): Promise<string> {
  const o = await call("POST", "/api/auth/register/options", { body: { displayName: "わたし" } });
  const v = await call("POST", "/api/auth/register/verify", {
    body: { challengeId: o.body.challengeId, response: { id: "x" } },
  });
  return (v.res.headers.get("Set-Cookie") as string).split(";")[0] as string;
}

// 1x1 の JPEG (Exif なし) を base64 で
const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xda, 0, 2, 1));
const EXIF = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe1, 0, 2, 0xff, 0xda, 0, 2, 1));

describe("入口", () => {
  test("/api/ の外は静的ファイルに守りのヘッダーを付けて返す", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/a/b`), env);
    expect(await res.text()).toBe("asset /a/b");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  test("GET 以外は Origin が同じときだけ (ないとき・違うときは 403)", async () => {
    for (const origin of [null, "https://evil.example", "http://closet.example.workers.dev"]) {
      const { res, body } = await call("POST", "/api/auth/login/options", { origin });
      expect(res.status).toBe(403);
      expect(body).toEqual({ error: "origin が違う" });
    }
    expect((await call("POST", "/api/auth/login/options")).res.status).toBe(200);
  });

  test("ログインしていなければ 401 で、Cookie を消す", async () => {
    for (const [m, p] of [
      ["GET", "/api/me"],
      ["GET", "/api/clothes"],
      ["DELETE", "/api/account"],
    ] as const) {
      const { res, body } = await call(m, p, { cookie: "__Host-sid=" + "A".repeat(43) });
      expect(res.status).toBe(401);
      expect(body).toEqual({ error: "ログインしていない" });
      expect(res.headers.get("Set-Cookie")).toBe(
        "__Host-sid=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict",
      );
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  test("中で失敗すれば中身を出さず 500 (ログは固定の文だけ)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    env.DB = {
      prepare: () => {
        throw new Error("secret detail");
      },
    } as never;
    const cookie = "__Host-sid=" + "A".repeat(43);
    const { res, body } = await call("GET", "/api/me", { cookie });
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "失敗した" });
    expect(err).toHaveBeenCalledWith("api: 処理に失敗した");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    err.mockRestore();
  });
});

describe("ログイン", () => {
  test("登録すると、セッションの Cookie が付き、me が通る。表示名は保存しない", async () => {
    const cookie = await signUp();
    expect(cookie).toMatch(/^__Host-sid=[A-Za-z0-9_-]{43}$/);
    expect((await call("GET", "/api/me", { cookie })).body).toEqual({ signedIn: true });
    expect(JSON.stringify(d1.rows("SELECT * FROM users"))).not.toContain("わたし");
    expect((sw.generateRegistrationOptions.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      userName: "わたし",
    });
  });

  test("表示名がなければアプリの名前", async () => {
    await call("POST", "/api/auth/register/options", { body: {} });
    expect((sw.generateRegistrationOptions.mock.calls as unknown[][]).at(-1)?.[0]).toMatchObject({
      userName: "kisekae-closet",
    });
  });

  test("ログインすると新しいセッション。ログアウトで消える", async () => {
    await signUp();
    const o = await call("POST", "/api/auth/login/options");
    const v = await call("POST", "/api/auth/login/verify", {
      body: { challengeId: o.body.challengeId, response: { id: "cred-1" } },
    });
    expect(v.res.status).toBe(200);
    const cookie = (v.res.headers.get("Set-Cookie") as string).split(";")[0] as string;
    expect((await call("GET", "/api/me", { cookie })).res.status).toBe(200);
    const out = await call("POST", "/api/auth/logout", { cookie });
    expect(out.res.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await call("GET", "/api/me", { cookie })).res.status).toBe(401);
  });

  test("確かめられなければ 401、形が違えば 400", async () => {
    const o = await call("POST", "/api/auth/login/options");
    const bad = await call("POST", "/api/auth/login/verify", {
      body: { challengeId: o.body.challengeId, response: { id: "nope" } },
    });
    expect(bad.res.status).toBe(401);
    expect(bad.body).toEqual({ error: "パスキーを確かめられない" });
    expect(bad.res.headers.get("Set-Cookie")).toBeNull();
    for (const body of [
      {},
      { challengeId: "a/b", response: { id: "x" } },
      { challengeId: "a", response: {} },
      { challengeId: "a", response: { id: "" } },
    ]) {
      expect((await call("POST", "/api/auth/register/verify", { body })).res.status).toBe(400);
    }
    expect(
      (await call("POST", "/api/auth/register/options", { body: { displayName: "x".repeat(41) } })).res
        .status,
    ).toBe(400);
    expect(
      (await call("POST", "/api/auth/register/options", { body: "{", type: "application/json" })).res.status,
    ).toBe(400);
  });
});

describe("服とコーデ", () => {
  test("足して・並べて・写真を見て・変えて・消せる。写真は本人にだけ、キャッシュさせない", async () => {
    const cookie = await signUp();
    const add = await call("POST", "/api/clothes", {
      cookie,
      body: { kind: "top", warmth: 2, label: " 白シャツ ", photo: JPEG },
    });
    expect(add.res.status).toBe(201);
    const id = add.body.id as string;
    const list = await call("GET", "/api/clothes", { cookie });
    expect(list.body.clothes).toEqual([
      { id, kind: "top", warmth: 2, label: "白シャツ", createdAt: expect.any(Number) },
    ]);
    const photo = await worker.fetch(req("GET", `/api/clothes/${id}/photo`, { cookie }), env);
    expect(photo.headers.get("Content-Type")).toBe("image/jpeg");
    expect(photo.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await photo.arrayBuffer())[0]).toBe(0xff);
    expect((await call("PATCH", `/api/clothes/${id}`, { cookie, body: { warmth: 3 } })).body).toEqual({
      ok: true,
    });
    expect((await call("DELETE", `/api/clothes/${id}`, { cookie })).body).toEqual({ ok: true });
    expect((await call("DELETE", `/api/clothes/${id}`, { cookie })).res.status).toBe(404);
  });

  test("Spec_OwnerOnly: API でも、ほかの人の服・写真・コーデには届かない (404)", async () => {
    const a = await signUp();
    const b = await signUp();
    const id = (
      await call("POST", "/api/clothes", {
        cookie: a,
        body: { kind: "top", warmth: 2, label: "", photo: JPEG },
      })
    ).body.id as string;
    const o = (
      await call("POST", "/api/outfits", {
        cookie: a,
        body: { wornOn: "2026-11-15", itemIds: [id], tempMax: 10, tempMin: 5, humidity: 50, precip: 0 },
      })
    ).body.id as string;
    expect((await worker.fetch(req("GET", `/api/clothes/${id}/photo`, { cookie: b }), env)).status).toBe(404);
    expect((await call("PATCH", `/api/clothes/${id}`, { cookie: b, body: { label: "x" } })).res.status).toBe(
      404,
    );
    expect((await call("DELETE", `/api/clothes/${id}`, { cookie: b })).res.status).toBe(404);
    expect((await call("DELETE", `/api/outfits/${o}`, { cookie: b })).res.status).toBe(404);
    expect((await call("GET", "/api/clothes", { cookie: b })).body).toEqual({ clothes: [] });
    expect((await call("GET", "/api/outfits", { cookie: b })).body).toEqual({ outfits: [] });
    const steal = await call("POST", "/api/outfits", {
      cookie: b,
      body: { wornOn: "2026-11-15", itemIds: [id], tempMax: 10, tempMin: 5, humidity: 50, precip: 0 },
    });
    expect(steal.body).toEqual({ error: "知らない服がある" });
    expect((await call("GET", "/api/export", { cookie: b })).body).toEqual({ clothes: [], outfits: [] });
  });

  test("写真の検査: Exif あり・形の違うものは拒む", async () => {
    const cookie = await signUp();
    const exif = await call("POST", "/api/clothes", {
      cookie,
      body: { kind: "top", warmth: 2, label: "", photo: EXIF },
    });
    expect(exif.body).toEqual({ error: "Exif・XMP (撮った場所など) が残っている" });
    const png = await call("POST", "/api/clothes", {
      cookie,
      body: { kind: "top", warmth: 2, label: "", photo: btoa("\x89PNG") },
    });
    expect(png.body).toEqual({ error: "WebP か JPEG だけ" });
  });

  test("入力の検査: 種類・暖かさの範囲・名前の長さ・base64・本文の形", async () => {
    const cookie = await signUp();
    const ok = { kind: "top", warmth: 2, label: "", photo: JPEG };
    for (const body of [
      { ...ok, kind: "hat" },
      { ...ok, warmth: 0 },
      { ...ok, warmth: 6 },
      { ...ok, warmth: 2.5 },
      { ...ok, label: "x".repeat(41) },
      { ...ok, photo: "!!" },
      { ...ok, photo: "A".repeat(409_604) },
    ]) {
      expect((await call("POST", "/api/clothes", { cookie, body })).body).toEqual({ error: "服の形が違う" });
    }
    for (const w of [1, 5])
      expect((await call("POST", "/api/clothes", { cookie, body: { ...ok, warmth: w } })).res.status).toBe(
        201,
      );
    expect(
      (await call("POST", "/api/clothes", { cookie, body: { ...ok, label: "x".repeat(40) } })).res.status,
    ).toBe(201);
    expect(
      (await call("POST", "/api/clothes", { cookie, body: JSON.stringify(ok), type: "text/plain" })).res
        .status,
    ).toBe(400);
    expect((await call("PATCH", "/api/clothes/abc", { cookie, body: {} })).body).toEqual({
      error: "変える中身の形が違う",
    });
    expect((await call("PATCH", "/api/clothes/abc", { cookie, body: { label: "x" } })).res.status).toBe(404);
    expect((await call("PATCH", "/api/clothes/abc", { cookie, body: { kind: "outer" } })).res.status).toBe(
      404,
    );
  });

  test("AC-7-4: 先のコーデは今日 (Asia/Tokyo) から 15 日先まで。それより先はサーバーも 400 で拒む", async () => {
    // NOW は 2027-01-15 17:00 (Asia/Tokyo)
    expect(latestDay(NOW)).toBe("2027-01-30");
    // 日本の真夜中で日が替わる
    expect(latestDay(Date.UTC(2026, 10, 16, 15, 0, 0))).toBe("2026-12-02");
    expect(latestDay(Date.UTC(2026, 10, 16, 14, 59, 59, 999))).toBe("2026-12-01");
    const cookie = await signUp();
    const id = (
      await call("POST", "/api/clothes", { cookie, body: { kind: "top", warmth: 2, label: "", photo: JPEG } })
    ).body.id as string;
    const body = { itemIds: [id], tempMax: 10, tempMin: 5, humidity: 50, precip: 0 };
    // ここからの API は本物の時計で動く。真夜中をまたがないよう、送る直前に決める
    const last = latestDay(Date.now());
    const next = new Date(Date.parse(last) + 86_400_000).toISOString().slice(0, 10);
    for (const wornOn of [next, "2099-12-31"]) {
      const r = await call("POST", "/api/outfits", { cookie, body: { ...body, wornOn } });
      expect(r.res.status).toBe(400);
      expect(r.body).toEqual({ error: "コーデを決めておけるのは 15 日先まで" });
    }
    expect((await call("POST", "/api/outfits", { cookie, body: { ...body, wornOn: last } })).res.status).toBe(
      201,
    );
    // 過去の日はこれまでどおり置ける
    expect(
      (await call("POST", "/api/outfits", { cookie, body: { ...body, wornOn: "2020-01-01" } })).res.status,
    ).toBe(201);
    const list = (await call("GET", "/api/outfits", { cookie })).body.outfits as { wornOn: string }[];
    expect(list.map((o) => o.wornOn).sort()).toEqual(["2020-01-01", last]);
  });

  test("コーデ: 日付・気温・湿度の形を確かめ、上下逆の気温・同じ服 2 回・空は拒む", async () => {
    const cookie = await signUp();
    const id = (
      await call("POST", "/api/clothes", { cookie, body: { kind: "top", warmth: 2, label: "", photo: JPEG } })
    ).body.id as string;
    const ok = { wornOn: "2026-11-15", itemIds: [id], tempMax: 10, tempMin: 5, humidity: 50, precip: 0 };
    for (const body of [
      { ...ok, wornOn: "2026/11/15" },
      { ...ok, itemIds: [] },
      { ...ok, itemIds: [id, id] },
      { ...ok, itemIds: Array.from({ length: LIMITS.itemsPerOutfit + 1 }, (_, i) => `x${i}`) },
      { ...ok, tempMin: 11 },
      { ...ok, humidity: 101 },
      { ...ok, precip: -1 },
      { ...ok, tempMax: 61 },
    ]) {
      expect((await call("POST", "/api/outfits", { cookie, body })).body).toEqual({
        error: "コーデの形が違う",
      });
    }
    expect((await call("POST", "/api/outfits", { cookie, body: { ...ok, tempMin: 10 } })).res.status).toBe(
      201,
    );
    const list = await call("GET", "/api/outfits?limit=1", { cookie });
    expect((list.body.outfits as unknown[]).length).toBe(1);
    const own = (list.body.outfits as { id: string }[])[0]?.id as string;
    expect((await call("DELETE", `/api/outfits/${own}`, { cookie })).body).toEqual({ ok: true });
    for (const q of ["0", "1001", "x", "1.5"])
      expect((await call("GET", `/api/outfits?limit=${q}`, { cookie })).res.status).toBe(200);
  });

  test("上限に達すると拒む", async () => {
    const cookie = await signUp();
    const user = (d1.rows("SELECT id FROM users")[0] as { id: string }).id;
    const ins = d1.db.prepare(
      "INSERT INTO clothes (id, user_id, kind, warmth, label, photo, photo_type, created_at) VALUES (?, ?, 'top', 1, '', x'00', 'image/jpeg', 0)",
    );
    for (let i = 0; i < LIMITS.clothes; i++) ins.run(`c${i}`, user);
    expect(
      (
        await call("POST", "/api/clothes", {
          cookie,
          body: { kind: "top", warmth: 2, label: "", photo: JPEG },
        })
      ).body,
    ).toEqual({
      error: "服は 500 着まで",
    });
    const o = d1.db.prepare(
      "INSERT INTO outfits (id, user_id, worn_on, temp_max, temp_min, humidity, precip, created_at) VALUES (?, ?, '2026-01-01', 0, 0, 0, 0, 0)",
    );
    for (let i = 0; i < LIMITS.outfits; i++) o.run(`o${i}`, user);
    const r = await call("POST", "/api/outfits", {
      cookie,
      body: { wornOn: "2026-11-15", itemIds: ["c1"], tempMax: 10, tempMin: 5, humidity: 50, precip: 0 },
    });
    expect(r.body).toEqual({ error: "コーデは 5000 件まで" });
  });

  test("書き出し: 写真は base64 で、コーデもつく", async () => {
    const cookie = await signUp();
    const id = (
      await call("POST", "/api/clothes", {
        cookie,
        body: { kind: "top", warmth: 2, label: "a", photo: JPEG },
      })
    ).body.id as string;
    await call("POST", "/api/outfits", {
      cookie,
      body: { wornOn: "2026-11-15", itemIds: [id], tempMax: 10, tempMin: 5, humidity: 50, precip: 0 },
    });
    const { body } = await call("GET", "/api/export", { cookie });
    expect(body.clothes).toEqual([
      {
        id,
        kind: "top",
        warmth: 2,
        label: "a",
        createdAt: expect.any(Number),
        photo: JPEG,
        photoType: "image/jpeg",
      },
    ]);
    expect((body.outfits as { itemIds: string[] }[])[0]?.itemIds).toEqual([id]);
  });

  test("アカウントを消すと全部消え、Cookie も消える", async () => {
    const cookie = await signUp();
    await call("POST", "/api/clothes", { cookie, body: { kind: "top", warmth: 2, label: "a", photo: JPEG } });
    const del = await call("DELETE", "/api/account", { cookie });
    expect(del.body).toEqual({ ok: true });
    expect(del.res.headers.get("Set-Cookie")).toContain("Max-Age=0");
    for (const t of ["users", "passkeys", "logins", "clothes"])
      expect(d1.rows(`SELECT * FROM ${t}`)).toHaveLength(0);
  });

  test("知らない道・形の違う ID・深すぎる道は 404", async () => {
    const cookie = await signUp();
    for (const [m, p] of [
      ["GET", "/api/nope"],
      ["GET", "/api/clothes/a/photo/x"],
      ["GET", "/api/clothes/a"],
      ["PUT", "/api/clothes"],
      ["GET", "/api/clothes/a/other"],
      ["POST", "/api/outfits/a"],
      ["GET", "/api/export/a"],
      ["POST", "/api/me"],
    ] as const) {
      expect((await call(m, p, { cookie })).res.status, `${m} ${p}`).toBe(404);
    }
  });
});

describe("本文", () => {
  test("JSON でなければ・上限を超えれば・壊れていれば null。上限ちょうどは読む", async () => {
    const mk = (body: string, type = "application/json") =>
      new Request(ORIGIN, { method: "POST", body, headers: { "Content-Type": type } });
    expect(await readJson(mk('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(mk('{"a":1}', "text/plain"))).toBeNull();
    expect(await readJson(new Request(ORIGIN, { method: "POST", body: "{}" }))).toBeNull();
    expect(await readJson(new Request(ORIGIN, { method: "POST" }))).toBeNull();
    expect(await readJson(mk("{"))).toBeNull();
    const at = `"${"a".repeat(MAX_BODY_BYTES - 2)}"`;
    expect(await readJson(mk(at))).toBe("a".repeat(MAX_BODY_BYTES - 2));
    expect(await readJson(mk(`"${"a".repeat(MAX_BODY_BYTES - 1)}"`))).toBeNull();
  });
  test("route は時刻を受け取る (期限の切れたセッションは通らない)", async () => {
    const cookie = await signUp();
    expect(
      (await route(req("GET", "/api/me", { cookie }), env, Date.now() + 31 * 24 * 3600 * 1000)).status,
    ).toBe(401);
    expect(NOW).toBeGreaterThan(0);
  });
});

describe("今日のコーデ", () => {
  test("AC-1-5: 決めたコーデは、別の利用者からは読めない・消せない", async () => {
    const a = await signUp();
    const b = await signUp();
    const id = (
      await call("POST", "/api/clothes", {
        cookie: a,
        body: { kind: "top", warmth: 2, label: "白T", photo: JPEG },
      })
    ).body.id as string;
    const day = { wornOn: "2026-11-17", itemIds: [id], tempMax: 14, tempMin: 8, humidity: 60, precip: 0 };
    const o = (await call("POST", "/api/outfits", { cookie: a, body: day })).body.id as string;
    expect((await call("GET", "/api/outfits", { cookie: b })).body).toEqual({ outfits: [] });
    expect((await call("DELETE", `/api/outfits/${o}`, { cookie: b })).res.status).toBe(404);
    expect((await call("GET", "/api/export", { cookie: b })).body).toEqual({ clothes: [], outfits: [] });
    expect((await call("GET", "/api/outfits", { cookie: a })).body).toEqual({ outfits: [{ id: o, ...day }] });
    expect((await call("DELETE", `/api/outfits/${o}`, { cookie: a })).body).toEqual({ ok: true });
  });
});
