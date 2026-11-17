// ログインを続けるセッション。守りの部分 (wakuwaku guard で書き換え禁止)。
// - Cookie `__Host-sid` に 32 byte のランダムな値 (HttpOnly・Secure・SameSite=Strict・Path=/、30 日)
// - サーバー (D1) には SHA-256 の指紋だけを置く。D1 が漏れても、その値でログインはできない
// - Cookie を読むのはこのファイルだけ (scripts/data-guard.mjs)
import type { Store } from "./db";

export const COOKIE = "__Host-sid";
export const TTL_MS = 2_592_000_000; // 30 日
const ATTRS = "Path=/; HttpOnly; Secure; SameSite=Strict";

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** ランダムな値 (base64url)。 */
export function randomId(bytes: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** セッションの値の指紋 (SHA-256、16 進)。 */
export async function fingerprint(sid: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sid)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cookie の見出しから、このアプリのセッションの値を取り出す (形が違えば null)。 */
export function readSid(cookieHeader: string | null): string | null {
  if (cookieHeader === null) return null;
  for (const part of cookieHeader.split(";")) {
    const m = /^__Host-sid=([A-Za-z0-9_-]{43})$/.exec(part.trim());
    if (m !== null) return m[1] as string;
  }
  return null;
}

/** 新しいセッションを作り、付ける Set-Cookie を返す。 */
export async function startSession(store: Store, userId: string, now: number): Promise<string> {
  const sid = randomId(32);
  await store.putLogin(userId, await fingerprint(sid), now + TTL_MS, now);
  return `${COOKIE}=${sid}; Max-Age=${TTL_MS / 1000}; ${ATTRS}`;
}

/** 今のセッションの利用者 (なければ・期限切れなら null)。 */
export async function currentUser(req: Request, store: Store, now: number): Promise<string | null> {
  const sid = readSid(req.headers.get("cookie"));
  return sid === null ? null : store.findLogin(await fingerprint(sid), now);
}

/** 今のセッションを消し、Cookie を消す Set-Cookie を返す。 */
export async function endSession(req: Request, store: Store): Promise<string> {
  const sid = readSid(req.headers.get("cookie"));
  if (sid !== null) await store.deleteLogin(await fingerprint(sid));
  return clearCookie();
}

export function clearCookie(): string {
  return `${COOKIE}=; Max-Age=0; ${ATTRS}`;
}
