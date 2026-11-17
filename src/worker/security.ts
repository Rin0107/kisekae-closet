// 守りのヘッダー。すべてのレスポンスに付ける。
// このファイルは守りの部分 (wakuwaku guard で書き換え禁止)。緩めたいときはユーザーに頼む。
// web との違い: 天気 (api.open-meteo.com) へ通信してよい。Set-Cookie はセッション (src/worker/session.ts) が付けたものだけ残す。

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.open-meteo.com",
  "media-src 'self' blob:",
  "worker-src 'none'",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

/** セッションの Cookie の形 (session.ts が作るもの)。これ以外の Set-Cookie は消す。 */
const SESSION_COOKIE = /^__Host-sid=[A-Za-z0-9_-]*; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Strict$/;

/**
 * レスポンスに守りのヘッダーを付ける。Server を消す。
 * Set-Cookie は、api (自分の処理が作った応答) でセッションの形のものだけ残し、ほかは消す。
 * api の応答はキャッシュさせない。
 */
export function harden(res: Response, api = false): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  const cookie = out.headers.get("Set-Cookie");
  out.headers.delete("Set-Cookie");
  if (api && cookie !== null && SESSION_COOKIE.test(cookie)) out.headers.set("Set-Cookie", cookie);
  if (api) out.headers.set("Cache-Control", "private, no-store");
  out.headers.delete("Server");
  return out;
}
