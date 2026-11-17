// Worker の入口。静的ファイル (ASSETS) と /api/ を分ける。
// /api/ の決まり:
//   - GET 以外は Origin が env.ORIGIN と同じときだけ受ける (ほかのサイトからの書き込みを止める。Cookie は SameSite=Strict)
//   - ログインとログアウトとアカウントの削除はここで扱い、ほかは src/worker/api.ts に、セッションから決めた利用者 ID を渡す
//   - 失敗の中身は外に出さない。ログには固定の文だけ (本文や利用者の情報を残さない)
import { handleApi, json, readJson } from "./api";
import { loginOptions, loginVerify, registerOptions, registerVerify } from "./auth";
import { Store, type DbEnv } from "./db";
import { harden } from "./security";
import { clearCookie, currentUser, endSession, startSession } from "./session";
import { z } from "zod";

export interface Env extends DbEnv {
  ASSETS: Fetcher;
  /** 本番の origin (https://<名前>.<アカウント>.workers.dev)。パスキーの rp ID と、書き込みの Origin の検査に使う */
  ORIGIN: string;
}

const Begin = z.object({ displayName: z.string().trim().min(1).max(40).optional() });
const Finish = z.object({
  challengeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  response: z.looseObject({ id: z.string().min(1).max(1024) }),
});

function withCookie(res: Response, cookie: string): Response {
  res.headers.set("Set-Cookie", cookie);
  return res;
}

export async function route(req: Request, env: Env, now: number): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.slice("/api/".length);
  if (req.method !== "GET" && req.headers.get("Origin") !== env.ORIGIN)
    return json({ error: "origin が違う" }, 403);
  const store = new Store(env);

  if (req.method === "POST" && path === "auth/register/options") {
    const p = Begin.safeParse(await readJson(req));
    if (!p.success) return json({ error: "形が違う" }, 400);
    return json(await registerOptions(store, env.ORIGIN, p.data.displayName ?? "kisekae-closet", now));
  }
  if (req.method === "POST" && path === "auth/login/options")
    return json(await loginOptions(store, env.ORIGIN, now));
  if (req.method === "POST" && (path === "auth/register/verify" || path === "auth/login/verify")) {
    const p = Finish.safeParse(await readJson(req));
    if (!p.success) return json({ error: "形が違う" }, 400);
    const userId =
      path === "auth/register/verify"
        ? await registerVerify(store, env.ORIGIN, p.data.challengeId, p.data.response as never, now)
        : await loginVerify(store, env.ORIGIN, p.data.challengeId, p.data.response as never, now);
    if (userId === null) return json({ error: "パスキーを確かめられない" }, 401);
    return withCookie(json({ ok: true }), await startSession(store, userId, now));
  }
  if (req.method === "POST" && path === "auth/logout")
    return withCookie(json({ ok: true }), await endSession(req, store));

  const userId = await currentUser(req, store, now);
  if (userId === null) return withCookie(json({ error: "ログインしていない" }, 401), clearCookie());
  if (req.method === "GET" && path === "me") return json({ signedIn: true });
  if (req.method === "DELETE" && path === "account") {
    await store.deleteUser(userId);
    return withCookie(json({ ok: true }), clearCookie());
  }
  return handleApi(req, path, store, userId, now);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!new URL(req.url).pathname.startsWith("/api/")) return harden(await env.ASSETS.fetch(req));
    try {
      return harden(await route(req, env, Date.now()), true);
    } catch {
      console.error("api: 処理に失敗した");
      return harden(json({ error: "失敗した" }, 500), true);
    }
  },
} satisfies ExportedHandler<Env>;
