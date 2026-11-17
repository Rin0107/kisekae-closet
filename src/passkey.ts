// パスキーでの登録とログイン (端末のパスキーを使う。パスワードもメールもない)。
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { z } from "zod";
import { call } from "./client";

const Begin = z.object({ challengeId: z.string(), options: z.looseObject({ challenge: z.string() }) });
const Ok = z.object({ ok: z.literal(true) });

/** 新しく始める。displayName は端末のパスキーの一覧に出る名前 (サーバーには残らない)。 */
export async function register(displayName: string): Promise<void> {
  const b = await call("auth/register/options", Begin, { method: "POST", body: { displayName } });
  const response = await startRegistration({ optionsJSON: b.options as never });
  await call("auth/register/verify", Ok, { method: "POST", body: { challengeId: b.challengeId, response } });
}

export async function login(): Promise<void> {
  const b = await call("auth/login/options", Begin, { method: "POST" });
  const response = await startAuthentication({ optionsJSON: b.options as never });
  await call("auth/login/verify", Ok, { method: "POST", body: { challengeId: b.challengeId, response } });
}
