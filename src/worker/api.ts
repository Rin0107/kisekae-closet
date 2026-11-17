// ログインした利用者の API (/api/ の下、認証のあと)。工場が機能を足してよい側。
// 決まり: D1 には直接触れない (src/worker/db.ts の Store だけを使う。scripts/db-guard.mjs)。入力は全部 zod で検査し、大きさの上限をかける。
// 利用者 ID は index.ts がセッションから決めて渡す。クライアントから受け取らない。
import { z } from "zod";
import { LIMITS, type Store } from "./db";
import { checkPhoto } from "./photo";
import { randomId } from "./session";

export const MAX_BODY_BYTES = 524_288; // 512KB
/** 写真の base64 の長さの上限 (300KB を base64 にした長さ = ceil(307200 / 3) * 4) */
export const MAX_PHOTO_BASE64 = 409_600;

export const KINDS = ["top", "bottom", "outer", "dress", "shoes", "accessory"] as const;
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Label = z.string().trim().max(40);
const Warmth = z.number().int().min(1).max(5);

export const NewClothingInput = z.object({
  kind: z.enum(KINDS),
  warmth: Warmth,
  label: Label,
  photo: z
    .string()
    .max(MAX_PHOTO_BASE64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export const ClothingPatchInput = z
  .object({ kind: z.enum(KINDS).optional(), warmth: Warmth.optional(), label: Label.optional() })
  .refine((p) => p.kind !== undefined || p.warmth !== undefined || p.label !== undefined);

export const NewOutfitInput = z
  .object({
    wornOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    itemIds: z.array(Id).min(1).max(LIMITS.itemsPerOutfit),
    tempMax: z.number().min(-60).max(60),
    tempMin: z.number().min(-60).max(60),
    humidity: z.number().min(0).max(100),
    precip: z.number().min(0).max(2000),
  })
  .refine((o) => o.tempMin <= o.tempMax)
  .refine((o) => new Set(o.itemIds).size === o.itemIds.length);

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const notFound = () => json({ error: "見つからない" }, 404);
const bad = (error: string) => json({ error }, 400);

/** JSON の本文を、大きさの上限つきで読む。形が違えば null。 */
export async function readJson(req: Request): Promise<unknown> {
  const type = req.headers.get("Content-Type");
  if (type === null || !type.startsWith("application/json")) return null;
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function toBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/** 道の形 (例: "GET clothes/:id/photo")。ID は :id に置きかえる。形の違う ID は null。 */
export function routeKey(method: string, path: string): string | null {
  const [top, id, ...rest] = path.split("/");
  if (id === undefined) return `${method} ${top}`;
  if (!Id.safeParse(id).success) return null;
  return [`${method} ${top}`, ":id", ...rest].join("/");
}

type Ctx = { req: Request; id: string; store: Store; userId: string; now: number };
type Handler = (c: Ctx) => Promise<Response>;

export const DEFAULT_OUTFITS = 60;

/** 機能はここに足す。ハンドラーは Store の関数を呼ぶだけ (利用者 ID は c.userId)。 */
export const ROUTES = new Map<string, Handler>(
  Object.entries({
    "GET clothes": async (c) => json({ clothes: await c.store.listClothes(c.userId) }),
    "POST clothes": async (c) => {
      const p = NewClothingInput.safeParse(await readJson(c.req));
      if (!p.success) return bad("服の形が違う");
      const photo = fromBase64(p.data.photo);
      const check = checkPhoto(photo);
      if (!check.ok) return bad(check.reason);
      const id = randomId(16);
      const { kind, warmth, label } = p.data;
      const ok = await c.store.addClothing(
        c.userId,
        { id, kind, warmth, label, photo, photoType: check.type },
        c.now,
      );
      return ok ? json({ id }, 201) : bad(`服は ${LIMITS.clothes} 着まで`);
    },
    "GET clothes/:id/photo": async (c) => {
      const p = await c.store.getPhoto(c.userId, c.id);
      return p === null ? notFound() : new Response(p.photo, { headers: { "Content-Type": p.photoType } });
    },
    "PATCH clothes/:id": async (c) => {
      const p = ClothingPatchInput.safeParse(await readJson(c.req));
      if (!p.success) return bad("変える中身の形が違う");
      return (await c.store.updateClothing(c.userId, c.id, p.data)) ? json({ ok: true }) : notFound();
    },
    "DELETE clothes/:id": async (c) =>
      (await c.store.deleteClothing(c.userId, c.id)) ? json({ ok: true }) : notFound(),
    "GET outfits": async (c) => {
      // 数でない・範囲の外 (1〜1000) は既定の数
      const n = Number(new URL(c.req.url).searchParams.get("limit"));
      const limit = Number.isInteger(n) && n >= 1 && n <= 1000 ? n : DEFAULT_OUTFITS;
      return json({ outfits: await c.store.listOutfits(c.userId, limit) });
    },
    "POST outfits": async (c) => {
      const p = NewOutfitInput.safeParse(await readJson(c.req));
      if (!p.success) return bad("コーデの形が違う");
      const id = randomId(16);
      const r = await c.store.addOutfit(c.userId, { id, ...p.data }, c.now);
      if (r === "limit") return bad(`コーデは ${LIMITS.outfits} 件まで`);
      if (r === "unknown-item") return bad("知らない服がある");
      return json({ id }, 201);
    },
    "DELETE outfits/:id": async (c) =>
      (await c.store.deleteOutfit(c.userId, c.id)) ? json({ ok: true }) : notFound(),
    "GET export": async (c) => {
      const clothes = (await c.store.exportClothes(c.userId)).map(({ photo, ...rest }) => ({
        ...rest,
        photo: toBase64(photo),
      }));
      return json({ clothes, outfits: await c.store.listOutfits(c.userId, LIMITS.outfits) });
    },
  } satisfies Record<string, Handler>),
);

/** /api/ の下の、ログインが要る道。path は "/api/" を外したもの (例: "clothes/abc/photo")。 */
export async function handleApi(
  req: Request,
  path: string,
  store: Store,
  userId: string,
  now: number,
): Promise<Response> {
  const key = routeKey(req.method, path);
  if (key === null) return bad("ID の形が違う");
  const h = ROUTES.get(key);
  if (h === undefined) return notFound();
  return h({ req, id: path.split("/")[1] as string, store, userId, now });
}
