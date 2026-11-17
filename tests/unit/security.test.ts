import { describe, expect, it } from "vitest";
import { harden, SECURITY_HEADERS } from "../../src/worker/security";

// 守りのヘッダーは 1 文字ずつ固定する
const EXPECTED: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; " +
    "connect-src 'self' https://api.open-meteo.com; media-src 'self' blob:; worker-src 'none'; manifest-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; " +
    "base-uri 'none'; form-action 'self'; upgrade-insecure-requests",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};
const SESSION =
  "__Host-sid=" + "A".repeat(43) + "; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Strict";
const CLEAR = "__Host-sid=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict";

describe("守りのヘッダー", () => {
  it("値が決めたとおり", () => {
    expect(SECURITY_HEADERS).toEqual(EXPECTED);
  });

  it("静的ファイル: 全部のヘッダーが付き、Cookie と Server が消え、中身と状態はそのまま。キャッシュは決めない", async () => {
    const res = harden(new Response("x", { status: 201, headers: { "Set-Cookie": SESSION, Server: "x" } }));
    for (const [k, v] of Object.entries(EXPECTED)) expect(res.headers.get(k)).toBe(v);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(res.headers.get("Server")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("x");
  });

  it("api: セッションの形の Cookie だけ残し、キャッシュさせない", () => {
    for (const c of [SESSION, CLEAR]) {
      const res = harden(new Response("{}", { headers: { "Set-Cookie": c } }), true);
      expect(res.headers.get("Set-Cookie")).toBe(c);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(res.headers.get("Content-Security-Policy")).toBe(EXPECTED["Content-Security-Policy"]);
    }
    for (const c of ["a=b", SESSION.replace("HttpOnly; ", ""), SESSION + "; Domain=x", "x" + SESSION]) {
      expect(
        harden(new Response("{}", { headers: { "Set-Cookie": c } }), true).headers.get("Set-Cookie"),
      ).toBeNull();
    }
    expect(harden(new Response("{}"), true).headers.get("Set-Cookie")).toBeNull();
  });
});
