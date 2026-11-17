// API の道と答えの形を細かく確かめる (ミューテーションで見つけた抜けを埋める)。
import { beforeEach, describe, expect, test, vi } from "vitest";

const sw = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(async (o: unknown) => ({ challenge: "c", o })),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: "c" })),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock("@simplewebauthn/server", () => sw);

import { DEFAULT_OUTFITS, MAX_PHOTO_BASE64, routeKey } from "../../src/worker/api";
import worker, { type Env } from "../../src/worker/index";
import { MAX_PHOTO_BYTES } from "../../src/worker/photo";
import { fakeEnv } from "./fake-d1";

const ORIGIN = "https://closet.example.workers.dev";
let env: Env;
let d1: ReturnType<typeof fakeEnv>["d1"];

beforeEach(() => {
  const f = fakeEnv();
  d1 = f.d1;
  env = { ...f.env, ORIGIN, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher };
  let n = 0;
  sw.verifyRegistrationResponse.mockImplementation(async () => ({
    verified: true,
    registrationInfo: { credential: { id: `cred-${++n}`, publicKey: new Uint8Array([1]), counter: 0 } },
  }));
});

type Opts = { body?: unknown; cookie?: string; origin?: string | null; type?: string };

async function call(method: string, path: string, opts: Opts = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = opts.type ?? "application/json";
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers, body }), env);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

async function signUp(displayName = "わたし"): Promise<string> {
  const o = await call("POST", "/api/auth/register/options", { body: { displayName } });
  const v = await call("POST", "/api/auth/register/verify", {
    body: { challengeId: o.body.challengeId, response: { id: "x" } },
  });
  expect(v.body).toEqual({ ok: true });
  return (v.res.headers.get("Set-Cookie") as string).split(";")[0] as string;
}

const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xda, 0, 2, 1));
const clothing = { kind: "top", warmth: 2, label: "", photo: JPEG };
const outfit = (itemIds: string[]) => ({
  wornOn: "2026-11-15",
  itemIds,
  tempMax: 10,
  tempMin: 5,
  humidity: 50,
  precip: 0,
});

test("定数", () => {
  expect(MAX_PHOTO_BASE64).toBe(Math.ceil(MAX_PHOTO_BYTES / 3) * 4);
  expect(DEFAULT_OUTFITS).toBe(60);
});

test("routeKey: ID を :id に。形の違う ID は null", () => {
  expect(routeKey("GET", "clothes")).toBe("GET clothes");
  expect(routeKey("GET", "clothes/abc/photo")).toBe("GET clothes/:id/photo");
  expect(routeKey("DELETE", "outfits/abc")).toBe("DELETE outfits/:id");
  expect(routeKey("GET", "clothes/a.b")).toBeNull();
});

describe("道と答えの形", () => {
  test("答えは JSON (charset つき)。知らない道は「見つからない」、形の違う ID は 400", async () => {
    const cookie = await signUp();
    const nf = await call("GET", "/api/nope", { cookie });
    expect(nf.res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(nf.body).toEqual({ error: "見つからない" });
    for (const id of ["a.b", ".ab", "ab.", "x".repeat(65)]) {
      const r = await call("DELETE", `/api/clothes/${id}`, { cookie });
      expect(r.res.status, id).toBe(400);
      expect(r.body).toEqual({ error: "ID の形が違う" });
    }
    expect((await call("DELETE", `/api/clothes/${"x".repeat(64)}`, { cookie })).res.status).toBe(404);
  });

  test("道と方法の組が合わなければ 404 (服もコーデも作らない)", async () => {
    const cookie = await signUp();
    const id = (await call("POST", "/api/clothes", { cookie, body: clothing })).body.id as string;
    const cases: [string, string, unknown][] = [
      ["POST", `/api/clothes/${id}`, clothing],
      ["GET", `/api/clothes/${id}`, undefined],
      ["PATCH", "/api/clothes", { label: "x" }],
      ["DELETE", "/api/clothes", undefined],
      ["DELETE", `/api/clothes/${id}/photo`, undefined],
      ["PATCH", `/api/clothes/${id}/photo`, { label: "x" }],
      ["GET", `/api/clothes/${id}/photo/x`, undefined],
      ["GET", `/api/clothes/${id}/x`, undefined],
      ["DELETE", `/api/clothes/${id}/x`, undefined],
      ["GET", `/api/outfits/${id}`, undefined],
      ["POST", `/api/outfits/${id}`, outfit([id])],
      ["DELETE", "/api/outfits", undefined],
      ["DELETE", `/api/outfits/${id}/x`, undefined],
      ["POST", "/api/export", undefined],
      ["GET", `/api/export/${id}`, undefined],
    ];
    for (const [m, p, body] of cases) {
      expect((await call(m, p, { cookie, body })).res.status, `${m} ${p}`).toBe(404);
    }
    expect((await call("GET", "/api/clothes", { cookie })).body.clothes).toHaveLength(1);
    expect((await call("GET", "/api/outfits", { cookie })).body.outfits).toHaveLength(0);
  });

  test("Content-Type: charset つきの JSON は読み、ないときは 400", async () => {
    const cookie = await signUp();
    const r = await call("POST", "/api/clothes", {
      cookie,
      body: clothing,
      type: "application/json; charset=utf-8",
    });
    expect(r.res.status).toBe(201);
    const none = await worker.fetch(
      new Request(`${ORIGIN}/api/clothes`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie } }),
      env,
    );
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: "服の形が違う" });
  });

  test("写真: 300KB ちょうどの JPEG は通る。base64 の前後に余計なものがあれば形が違う", async () => {
    const cookie = await signUp();
    const big = new Uint8Array(MAX_PHOTO_BYTES);
    big.set([0xff, 0xd8]);
    // SOI 2 byte・本体 7 byte の間を、長さ 65535 までの APP2 で埋める
    let i = 2;
    let left = big.length - 2 - 7;
    while (left > 0) {
      let seg = Math.min(left, 65_537);
      if (left - seg > 0 && left - seg < 4) seg -= 4;
      big.set([0xff, 0xe2, (seg - 2) >> 8, (seg - 2) & 0xff], i);
      i += seg;
      left -= seg;
    }
    big.set([0xff, 0xda, 0, 2, 1, 2, 3], big.length - 7);
    let s = "";
    for (const b of big) s += String.fromCharCode(b);
    const photo = btoa(s);
    expect(photo.length).toBe(MAX_PHOTO_BASE64);
    const ok = await call("POST", "/api/clothes", { cookie, body: { ...clothing, photo } });
    expect(ok.body).toEqual({ id: expect.any(String) });
    for (const p of ["!!" + JPEG, JPEG + "!!"]) {
      const r = await call("POST", "/api/clothes", { cookie, body: { ...clothing, photo: p } });
      expect(r.body).toEqual({ error: "服の形が違う" });
    }
  });

  test("コーデ: 日付の前後に余計なものがあれば形が違う。作ると ID が返り、一覧に出る", async () => {
    const cookie = await signUp();
    const id = (await call("POST", "/api/clothes", { cookie, body: clothing })).body.id as string;
    for (const wornOn of ["x2026-11-15", "2026-11-15x"]) {
      const r = await call("POST", "/api/outfits", { cookie, body: { ...outfit([id]), wornOn } });
      expect(r.res.status).toBe(400);
    }
    const r = await call("POST", "/api/outfits", { cookie, body: outfit([id]) });
    expect(r.body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const list = (await call("GET", "/api/outfits", { cookie })).body.outfits as { id: string }[];
    expect(list.map((o) => o.id)).toEqual([r.body.id]);
  });

  test("コーデの一覧の数: 既定は 60、1〜1000 はその数、外は既定", async () => {
    const cookie = await signUp();
    const user = (d1.rows("SELECT id FROM users")[0] as { id: string }).id;
    const ins = d1.db.prepare(
      "INSERT INTO outfits (id, user_id, worn_on, temp_max, temp_min, humidity, precip, created_at) VALUES (?, ?, '2026-01-01', 0, 0, 0, 0, 0)",
    );
    for (let k = 0; k < 61; k++) ins.run(`o${k}`, user);
    const count = async (q: string) =>
      ((await call("GET", `/api/outfits${q}`, { cookie })).body.outfits as unknown[]).length;
    expect(await count("")).toBe(60);
    expect(await count("?limit=1")).toBe(1);
    expect(await count("?limit=2")).toBe(2);
    expect(await count("?limit=1000")).toBe(61);
    expect(await count("?limit=1001")).toBe(60);
    expect(await count("?limit=0")).toBe(60);
    expect(await count("?limit=x")).toBe(60);
  });

  test("GET は Origin がなくても通る (読むだけ)。ログインの道は POST だけ", async () => {
    const cookie = await signUp();
    expect((await call("GET", "/api/me", { cookie, origin: null })).body).toEqual({ signedIn: true });
    for (const p of [
      "auth/register/options",
      "auth/login/options",
      "auth/register/verify",
      "auth/login/verify",
      "auth/logout",
    ]) {
      expect((await call("GET", `/api/${p}`)).res.status, p).toBe(401);
    }
  });

  test("ログイン・ログアウトの答えは {ok: true}。表示名は前後の空白を落とし、空なら「形が違う」", async () => {
    const cookie = await signUp(" わたし ");
    expect((sw.generateRegistrationOptions.mock.calls as unknown[][]).at(-1)?.[0]).toMatchObject({
      userName: "わたし",
    });
    expect((await call("POST", "/api/auth/logout", { cookie })).body).toEqual({ ok: true });
    const blank = await call("POST", "/api/auth/register/options", { body: { displayName: "   " } });
    expect(blank.body).toEqual({ error: "形が違う" });
    expect((await call("POST", "/api/auth/login/verify", { body: {} })).body).toEqual({ error: "形が違う" });
  });

  test("アカウントを消すのは DELETE だけ", async () => {
    const cookie = await signUp();
    expect((await call("GET", "/api/account", { cookie })).res.status).toBe(404);
    expect((await call("POST", "/api/account", { cookie })).res.status).toBe(404);
    expect(d1.rows("SELECT * FROM users")).toHaveLength(1);
  });
});
