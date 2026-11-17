import { afterEach, describe, expect, test, vi } from "vitest";

const browser = vi.hoisted(() => ({ startRegistration: vi.fn(), startAuthentication: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => browser);

import { z } from "zod";
import { api, ApiError, call } from "../../src/client";
import { login, register } from "../../src/passkey";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function stubFetch(...answers: [number, unknown][]) {
  const f = vi.fn(async () => {
    const [status, body] = answers.shift() ?? [500, null];
    return new Response(body === undefined ? "not json" : JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("call", () => {
  test("GET は本文なし、送るときは JSON。同じ origin の Cookie を付ける", async () => {
    const f = stubFetch([200, { ok: true }], [200, { ok: true }]);
    await call("me", z.object({ ok: z.boolean() }));
    expect(f).toHaveBeenLastCalledWith("/api/me", {
      method: "GET",
      credentials: "same-origin",
      headers: {},
      body: undefined,
    });
    await call("x", z.object({ ok: z.boolean() }), { method: "POST", body: { a: 1 } });
    expect(f).toHaveBeenLastCalledWith("/api/x", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });
  });
  test("失敗はサーバーの文言か、なければ状態の番号で ApiError", async () => {
    stubFetch([400, { error: "服の形が違う" }], [502, undefined]);
    await expect(call("a", z.unknown())).rejects.toEqual(new ApiError(400, "服の形が違う"));
    const e = await call("a", z.unknown()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(502);
    expect((e as ApiError).message).toBe("失敗した (502)");
  });
  test("失敗の答えが JSON でも形が違えば「答えの形が違う」", async () => {
    stubFetch([400, { nope: 1 }]);
    await expect(call("a", z.unknown())).rejects.toEqual(new ApiError(400, "答えの形が違う"));
  });
  test("答えの形が違えば止まる", async () => {
    stubFetch([200, { nope: 1 }]);
    await expect(call("a", z.object({ ok: z.boolean() }))).rejects.toThrow();
  });
});

describe("api", () => {
  test("それぞれの道と方法", async () => {
    const outfit = {
      id: "o",
      wornOn: "2026-11-15",
      tempMax: 1,
      tempMin: 0,
      humidity: 1,
      precip: 0,
      itemIds: ["a"],
    };
    const f = stubFetch(
      [200, { signedIn: true }],
      [200, { ok: true }],
      [200, { ok: true }],
      [200, { clothes: [{ id: "a", kind: "top", warmth: 1, label: "", createdAt: 1 }] }],
      [201, { id: "a" }],
      [200, { ok: true }],
      [200, { outfits: [outfit] }],
      [201, { id: "o" }],
    );
    expect(await api.me()).toEqual({ signedIn: true });
    await api.logout();
    await api.deleteAccount();
    expect((await api.clothes())[0]?.id).toBe("a");
    expect(await api.addClothing({ kind: "top", warmth: 1, label: "", photo: "AA==" })).toEqual({ id: "a" });
    await api.deleteClothing("a/b");
    expect(await api.outfits()).toEqual([outfit]);
    const rest = { wornOn: outfit.wornOn, tempMax: 1, tempMin: 0, humidity: 1, precip: 0, itemIds: ["a"] };
    await api.addOutfit(rest);
    expect(
      f.mock.calls.map(
        (c) => `${(c as unknown as [string, { method: string }])[1].method} ${(c as unknown[])[0]}`,
      ),
    ).toEqual([
      "GET /api/me",
      "POST /api/auth/logout",
      "DELETE /api/account",
      "GET /api/clothes",
      "POST /api/clothes",
      "DELETE /api/clothes/a%2Fb",
      "GET /api/outfits",
      "POST /api/outfits",
    ]);
    expect(api.photoUrl("a b")).toBe("/api/clothes/a%20b/photo");
  });
});

describe("passkey", () => {
  test("登録: options を受け取り、端末で作り、確かめに送る", async () => {
    const f = stubFetch([200, { challengeId: "c1", options: { challenge: "x" } }], [200, { ok: true }]);
    browser.startRegistration.mockResolvedValue({ id: "cred" });
    await register("わたし");
    expect(browser.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: "x" } });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({
      displayName: "わたし",
    });
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, { body: string }])[1].body)).toEqual({
      challengeId: "c1",
      response: { id: "cred" },
    });
  });
  test("ログイン: options を受け取り、端末で選び、確かめに送る", async () => {
    const f = stubFetch([200, { challengeId: "c2", options: { challenge: "y" } }], [200, { ok: true }]);
    browser.startAuthentication.mockResolvedValue({ id: "cred" });
    await login();
    expect(browser.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "y" } });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("/api/auth/login/options");
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe("/api/auth/login/verify");
  });
  test("送る道・方法・本文 (登録とログイン)", async () => {
    const f = stubFetch(
      [200, { challengeId: "c1", options: { challenge: "x" } }],
      [200, { ok: true }],
      [200, { challengeId: "c2", options: { challenge: "y" } }],
      [200, { ok: true }],
    );
    browser.startRegistration.mockResolvedValue({ id: "r" });
    browser.startAuthentication.mockResolvedValue({ id: "a" });
    await register("n");
    await login();
    const sent = f.mock.calls.map((c) => {
      const [url, init] = c as unknown as [string, { method: string; body?: string }];
      return [url, init.method, init.body === undefined ? undefined : JSON.parse(init.body)];
    });
    expect(sent).toEqual([
      ["/api/auth/register/options", "POST", { displayName: "n" }],
      ["/api/auth/register/verify", "POST", { challengeId: "c1", response: { id: "r" } }],
      ["/api/auth/login/options", "POST", undefined],
      ["/api/auth/login/verify", "POST", { challengeId: "c2", response: { id: "a" } }],
    ]);
  });
  test("options に問題がない・確かめの答えが ok でなければ止まる", async () => {
    stubFetch([200, { challengeId: "c", options: {} }]);
    await expect(login()).rejects.toThrow();
    expect(browser.startAuthentication).not.toHaveBeenCalled();
    stubFetch([200, { challengeId: "c", options: { challenge: "y" } }], [200, { ok: false }]);
    browser.startAuthentication.mockResolvedValue({ id: "a" });
    await expect(login()).rejects.toThrow();
    stubFetch([200, { challengeId: "c", options: { challenge: "y" } }], [200, { ok: false }]);
    browser.startRegistration.mockResolvedValue({ id: "r" });
    await expect(register("n")).rejects.toThrow();
    stubFetch([200, { ok: false }]);
    await expect(api.logout()).rejects.toThrow();
  });
  test("確かめられなければ ApiError", async () => {
    stubFetch(
      [200, { challengeId: "c2", options: { challenge: "y" } }],
      [401, { error: "パスキーを確かめられない" }],
    );
    browser.startAuthentication.mockResolvedValue({ id: "cred" });
    await expect(login()).rejects.toThrow("パスキーを確かめられない");
  });
});
