// サーバー (/api/) との通信。答えは zod で検査してから使う。
// ログイン (src/passkey.ts) のあとは Cookie (HttpOnly) が自動で付くので、ここでは何も持たない。
import { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ErrorBody = z.object({ error: z.string() });

export async function call<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: init?.method ?? "GET",
    credentials: "same-origin",
    headers: init?.body === undefined ? {} : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  // 答えが JSON でなければ (Worker の外の失敗など)、状態の番号だけを伝える
  const body: unknown = await res.json().catch(() => ({ error: `失敗した (${res.status})` }));
  if (!res.ok) {
    const e = ErrorBody.safeParse(body);
    throw new ApiError(res.status, e.success ? e.data.error : "答えの形が違う");
  }
  return schema.parse(body);
}

export const ClothingSchema = z.object({
  id: z.string(),
  kind: z.string(),
  warmth: z.number(),
  label: z.string(),
  createdAt: z.number(),
});
export type Clothing = z.infer<typeof ClothingSchema>;

export const OutfitSchema = z.object({
  id: z.string(),
  wornOn: z.string(),
  tempMax: z.number(),
  tempMin: z.number(),
  humidity: z.number(),
  precip: z.number(),
  itemIds: z.array(z.string()),
});
export type Outfit = z.infer<typeof OutfitSchema>;

const Ok = z.object({ ok: z.literal(true) });
const Created = z.object({ id: z.string() });

export const api = {
  me: () => call("me", z.object({ signedIn: z.literal(true) })),
  logout: () => call("auth/logout", Ok, { method: "POST" }),
  deleteAccount: () => call("account", Ok, { method: "DELETE" }),
  clothes: async () => (await call("clothes", z.object({ clothes: z.array(ClothingSchema) }))).clothes,
  addClothing: (c: { kind: string; warmth: number; label: string; photo: string }) =>
    call("clothes", Created, { method: "POST", body: c }),
  deleteClothing: (id: string) => call(`clothes/${encodeURIComponent(id)}`, Ok, { method: "DELETE" }),
  outfits: async () => (await call("outfits", z.object({ outfits: z.array(OutfitSchema) }))).outfits,
  addOutfit: (o: Omit<Outfit, "id">) => call("outfits", Created, { method: "POST", body: o }),
  photoUrl: (id: string) => `/api/clothes/${encodeURIComponent(id)}/photo`,
};
