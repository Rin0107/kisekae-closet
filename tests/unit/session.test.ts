import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { Store } from "../../src/worker/db";
import {
  clearCookie,
  COOKIE,
  currentUser,
  endSession,
  fingerprint,
  randomId,
  readSid,
  startSession,
  TTL_MS,
} from "../../src/worker/session";
import { fakeEnv } from "./fake-d1";
import { runs } from "./fc";

const NOW = 1_800_000_000_000;
const SID = "A".repeat(43);

async function setup() {
  const { d1, env } = fakeEnv();
  const s = new Store(env);
  await s.createUserWithPasskey(
    "u",
    "cred",
    { publicKey: new Uint8Array([1]), counter: 0, transports: [] },
    NOW,
  );
  return { d1, s };
}

const withCookie = (c: string) => new Request("https://x.test/api/me", { headers: { Cookie: c } });

describe("値", () => {
  test("randomId は base64url で、長さはバイト数から決まり、毎回違う", () => {
    expect(randomId(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomId(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomId(32)).not.toBe(randomId(32));
  });
  test("randomId は + / = を使わない (PBT)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), (n) => /^[A-Za-z0-9_-]+$/.test(randomId(n))),
      runs(),
    );
  });
  test("指紋は SHA-256 の 16 進", async () => {
    expect(await fingerprint("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("readSid", () => {
  test("このアプリの Cookie で、形の合う値だけ", () => {
    expect(readSid(`a=1; ${COOKIE}=${SID}; b=2`)).toBe(SID);
    expect(readSid(`${COOKIE}=${SID}`)).toBe(SID);
    expect(readSid(`${COOKIE}=${SID}x`)).toBeNull(); // 長さが違う
    expect(readSid(`${COOKIE}=${"A".repeat(42)}`)).toBeNull();
    expect(readSid(`${COOKIE}=${"A".repeat(42)}+`)).toBeNull();
    expect(readSid(`other=${SID}`)).toBeNull();
    expect(readSid(`x${COOKIE}=${SID}`)).toBeNull();
    expect(readSid(` ${COOKIE}=${SID} `)).toBe(SID);
    expect(readSid(COOKIE)).toBeNull();
    expect(readSid(null)).toBeNull();
    expect(readSid("")).toBeNull();
  });
  test("fuzz: どんな見出しでも落ちず、返すのは形の合う値か null", () => {
    fc.assert(
      fc.property(fc.string(), (h) => {
        const v = readSid(h);
        return v === null || /^[A-Za-z0-9_-]{43}$/.test(v);
      }),
      runs(),
    );
  });
});

describe("セッション", () => {
  test("始めると Cookie を返し、D1 には指紋だけを置く", async () => {
    const { s, d1 } = await setup();
    const set = await startSession(s, "u", NOW);
    expect(set).toMatch(
      new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Strict$`),
    );
    const sid = (set.split(";")[0] as string).split("=")[1] as string;
    const rows = d1.rows("SELECT sid_hash, user_id, expires_at FROM logins");
    expect(rows).toEqual([{ sid_hash: await fingerprint(sid), user_id: "u", expires_at: NOW + TTL_MS }]);
    expect(JSON.stringify(rows)).not.toContain(sid);
    expect(await currentUser(withCookie(`${COOKIE}=${sid}`), s, NOW + TTL_MS - 1)).toBe("u");
    expect(await currentUser(withCookie(`${COOKIE}=${sid}`), s, NOW + TTL_MS)).toBeNull();
  });
  test("Cookie がない・知らない値なら利用者はいない", async () => {
    const { s } = await setup();
    expect(await currentUser(new Request("https://x.test/"), s, NOW)).toBeNull();
    expect(await currentUser(withCookie(`${COOKIE}=${SID}`), s, NOW)).toBeNull();
  });
  test("終えると D1 から消え、Cookie を消す見出しを返す", async () => {
    const { s, d1 } = await setup();
    const sid = ((await startSession(s, "u", NOW)).split(";")[0] as string).split("=")[1] as string;
    expect(await endSession(withCookie(`${COOKIE}=${sid}`), s)).toBe(clearCookie());
    expect(d1.rows("SELECT * FROM logins")).toHaveLength(0);
    expect(await endSession(new Request("https://x.test/"), s)).toBe(clearCookie());
    expect(clearCookie()).toBe(`${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`);
  });
});
