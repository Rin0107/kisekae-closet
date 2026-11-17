// ログインはパスキーだけ。守りの部分 (wakuwaku guard で書き換え禁止)。
// - パスワード・メール・名前を受け取らない・持たない。サーバーに置くのはランダムな利用者 ID・パスキーの ID・公開鍵・回数・つなぎ方
// - 表示名 (端末のパスキーの一覧に出る名前) は options に入れるだけで、保存しない
// - 問題 (challenge) は D1 に 5 分だけ置き、1 回使ったら消す
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Store } from "./db";
import { randomId } from "./session";

export const CHALLENGE_TTL_MS = 300_000; // 5 分
export const RP_NAME = "kisekae-closet";

/** origin (https://example.workers.dev) から、パスキーの持ち主の名前 (rp ID = ホスト名) を決める。 */
export function rpId(origin: string): string {
  return new URL(origin).hostname;
}

export async function registerOptions(store: Store, origin: string, displayName: string, now: number) {
  const userId = randomId(16);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(origin),
    userName: displayName,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const challengeId = randomId(16);
  await store.putChallenge(challengeId, options.challenge, "register", userId, now + CHALLENGE_TTL_MS);
  return { challengeId, options };
}

/** 登録を確かめ、利用者とパスキーを作る。成り立たなければ null。 */
export async function registerVerify(
  store: Store,
  origin: string,
  challengeId: string,
  response: RegistrationResponseJSON,
  now: number,
): Promise<string | null> {
  const c = await store.takeChallenge(challengeId, "register", now);
  if (c === null || c.pendingUser === null) return null;
  const opts = {
    response,
    expectedChallenge: c.challenge,
    expectedOrigin: origin,
    expectedRPID: rpId(origin),
    requireUserVerification: false,
  };
  // 形の壊れた応答は例外になる。確かめられないのと同じに扱う
  const v = await verifyRegistrationResponse(opts).catch(() => null);
  if (v === null || !v.verified) return null;
  const cred = v.registrationInfo.credential;
  await store.createUserWithPasskey(
    c.pendingUser,
    cred.id,
    { publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports ?? [] },
    now,
  );
  return c.pendingUser;
}

export async function loginOptions(store: Store, origin: string, now: number) {
  const options = await generateAuthenticationOptions({ rpID: rpId(origin), userVerification: "preferred" });
  const challengeId = randomId(16);
  await store.putChallenge(challengeId, options.challenge, "login", null, now + CHALLENGE_TTL_MS);
  return { challengeId, options };
}

/** ログインを確かめる。成り立てば利用者 ID、だめなら null。 */
export async function loginVerify(
  store: Store,
  origin: string,
  challengeId: string,
  response: AuthenticationResponseJSON,
  now: number,
): Promise<string | null> {
  const c = await store.takeChallenge(challengeId, "login", now);
  if (c === null) return null;
  const key = await store.findPasskey(response.id);
  if (key === null) return null;
  const opts = {
    response,
    expectedChallenge: c.challenge,
    expectedOrigin: origin,
    expectedRPID: rpId(origin),
    credential: {
      id: response.id,
      publicKey: key.publicKey,
      counter: key.counter,
      transports: key.transports,
    },
    requireUserVerification: false,
  };
  const v = await verifyAuthenticationResponse(opts).catch(() => null);
  if (v === null || !v.verified) return null;
  await store.updateCounter(key.userId, response.id, v.authenticationInfo.newCounter);
  return key.userId;
}
