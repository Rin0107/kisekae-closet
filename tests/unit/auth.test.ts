// パスキーの確かめ (暗号) は @simplewebauthn/server に任せる。ここでは、その前後 (問題・利用者・パスキーの扱い) を確かめる。
// 本物の暗号を通す確かめは e2e (Chromium の仮想の認証器) が受け持つ。
import { beforeEach, describe, expect, test, vi } from "vitest";

const sw = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock("@simplewebauthn/server", () => sw);

import {
  CHALLENGE_TTL_MS,
  loginOptions,
  loginVerify,
  registerOptions,
  registerVerify,
  RP_NAME,
  rpId,
} from "../../src/worker/auth";
import { Store } from "../../src/worker/db";
import { fakeEnv } from "./fake-d1";

const NOW = 1_800_000_000_000;
const ORIGIN = "https://closet.example.workers.dev";
const reg = { id: "cred-1" } as never;

let store: Store;
let d1: ReturnType<typeof fakeEnv>["d1"];
beforeEach(() => {
  vi.resetAllMocks();
  const f = fakeEnv();
  d1 = f.d1;
  store = new Store(f.env);
  sw.generateRegistrationOptions.mockResolvedValue({ challenge: "reg-chal" });
  sw.generateAuthenticationOptions.mockResolvedValue({ challenge: "login-chal" });
});

test("問題は 5 分、rp の名前はアプリの名前", () => {
  expect(CHALLENGE_TTL_MS).toBe(300_000);
  expect(RP_NAME).toBe("kisekae-closet");
});

test("rp ID は origin のホスト名", () => {
  expect(rpId(ORIGIN)).toBe("closet.example.workers.dev");
  expect(rpId("http://localhost:8787")).toBe("localhost");
});

describe("登録", () => {
  test("options: 表示名は options に入れるだけで、問題と仮の利用者 ID を 5 分置く", async () => {
    const r = await registerOptions(store, ORIGIN, "わたし", NOW);
    const arg = sw.generateRegistrationOptions.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      rpName: RP_NAME,
      rpID: "closet.example.workers.dev",
      userName: "わたし",
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    const rows = d1.rows("SELECT * FROM challenges") as {
      id: string;
      challenge: string;
      purpose: string;
      pending_user: string;
      expires_at: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: r.challengeId,
      challenge: "reg-chal",
      purpose: "register",
      expires_at: NOW + CHALLENGE_TTL_MS,
    });
    expect(new TextDecoder().decode(arg.userID)).toBe(rows[0]?.pending_user);
    expect(rows[0]?.pending_user).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(JSON.stringify(d1.rows("SELECT * FROM users"))).not.toContain("わたし");
    expect(r.options).toEqual({ challenge: "reg-chal" });
  });

  test("verify: 確かめられたら利用者とパスキーを作り、利用者 ID を返す", async () => {
    const { challengeId } = await registerOptions(store, ORIGIN, "x", NOW);
    sw.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "cred-1", publicKey: new Uint8Array([7]), counter: 3, transports: ["hybrid"] },
      },
    });
    const user = await registerVerify(store, ORIGIN, challengeId, reg, NOW + 1);
    expect(sw.verifyRegistrationResponse.mock.calls[0]?.[0]).toEqual({
      response: reg,
      expectedChallenge: "reg-chal",
      expectedOrigin: ORIGIN,
      expectedRPID: "closet.example.workers.dev",
      requireUserVerification: false,
    });
    expect(user).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await store.findPasskey("cred-1")).toEqual({
      userId: user,
      publicKey: new Uint8Array([7]),
      counter: 3,
      transports: ["hybrid"],
    });
    // 問題は 1 回だけ
    expect(await registerVerify(store, ORIGIN, challengeId, reg, NOW + 1)).toBeNull();
  });

  test("verify: つなぎ方が分からなければ空", async () => {
    const { challengeId } = await registerOptions(store, ORIGIN, "x", NOW);
    sw.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: { credential: { id: "cred-2", publicKey: new Uint8Array([7]), counter: 0 } },
    });
    await registerVerify(store, ORIGIN, challengeId, reg, NOW);
    expect((await store.findPasskey("cred-2"))?.transports).toEqual([]);
  });

  test("verify: 問題がない・期限切れ・ログインの問題・確かめられない・例外なら null で、何も作らない", async () => {
    expect(await registerVerify(store, ORIGIN, "none", reg, NOW)).toBeNull();
    const a = await registerOptions(store, ORIGIN, "x", NOW);
    expect(await registerVerify(store, ORIGIN, a.challengeId, reg, NOW + CHALLENGE_TTL_MS)).toBeNull();
    const l = await loginOptions(store, ORIGIN, NOW);
    expect(await registerVerify(store, ORIGIN, l.challengeId, reg, NOW)).toBeNull();
    const b = await registerOptions(store, ORIGIN, "x", NOW);
    sw.verifyRegistrationResponse.mockResolvedValue({ verified: false });
    expect(await registerVerify(store, ORIGIN, b.challengeId, reg, NOW)).toBeNull();
    const c = await registerOptions(store, ORIGIN, "x", NOW);
    sw.verifyRegistrationResponse.mockRejectedValue(new Error("bad"));
    expect(await registerVerify(store, ORIGIN, c.challengeId, reg, NOW)).toBeNull();
    expect(d1.rows("SELECT * FROM users")).toHaveLength(0);
  });

  test("verify: 仮の利用者のない問題 (壊れた行) なら null", async () => {
    await store.putChallenge("odd", "c", "register", null, NOW + 10);
    expect(await registerVerify(store, ORIGIN, "odd", reg, NOW)).toBeNull();
    expect(sw.verifyRegistrationResponse).not.toHaveBeenCalled();
  });
});

describe("ログイン", () => {
  async function withUser() {
    await store.createUserWithPasskey(
      "u1",
      "cred-1",
      { publicKey: new Uint8Array([5]), counter: 2, transports: ["internal"] },
      NOW,
    );
  }

  test("options: 利用者を決めない (端末のパスキーから選ぶ) 問題を 5 分置く", async () => {
    const r = await loginOptions(store, ORIGIN, NOW);
    expect(sw.generateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: "closet.example.workers.dev",
      userVerification: "preferred",
    });
    expect(
      d1.rows("SELECT purpose, pending_user, expires_at FROM challenges WHERE id = ?", r.challengeId),
    ).toEqual([{ purpose: "login", pending_user: null, expires_at: NOW + CHALLENGE_TTL_MS }]);
  });

  test("verify: 確かめられたら回数を進め、利用者 ID を返す", async () => {
    await withUser();
    const { challengeId } = await loginOptions(store, ORIGIN, NOW);
    sw.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 3 },
    });
    expect(await loginVerify(store, ORIGIN, challengeId, reg, NOW)).toBe("u1");
    expect(sw.verifyAuthenticationResponse.mock.calls[0]?.[0]).toEqual({
      response: reg,
      expectedChallenge: "login-chal",
      expectedOrigin: ORIGIN,
      expectedRPID: "closet.example.workers.dev",
      credential: { id: "cred-1", publicKey: new Uint8Array([5]), counter: 2, transports: ["internal"] },
      requireUserVerification: false,
    });
    expect((await store.findPasskey("cred-1"))?.counter).toBe(3);
  });

  test("verify: 問題がない・知らないパスキー・確かめられない・例外なら null で、回数は変わらない", async () => {
    await withUser();
    expect(await loginVerify(store, ORIGIN, "none", reg, NOW)).toBeNull();
    const a = await loginOptions(store, ORIGIN, NOW);
    expect(await loginVerify(store, ORIGIN, a.challengeId, { id: "other" } as never, NOW)).toBeNull();
    const b = await loginOptions(store, ORIGIN, NOW);
    sw.verifyAuthenticationResponse.mockResolvedValue({
      verified: false,
      authenticationInfo: { newCounter: 9 },
    });
    expect(await loginVerify(store, ORIGIN, b.challengeId, reg, NOW)).toBeNull();
    const c = await loginOptions(store, ORIGIN, NOW);
    sw.verifyAuthenticationResponse.mockRejectedValue(new Error("bad"));
    expect(await loginVerify(store, ORIGIN, c.challengeId, reg, NOW)).toBeNull();
    const r = await registerOptions(store, ORIGIN, "x", NOW);
    expect(await loginVerify(store, ORIGIN, r.challengeId, reg, NOW)).toBeNull(); // 登録の問題は使えない
    expect((await store.findPasskey("cred-1"))?.counter).toBe(2);
  });
});
