// 利用者のデータはブラウザの中にだけ置く。サーバーには送らない。
// 値は zod で検査してから使う (壊れた・書き換えられた値で動かないように)。
import type { z } from "zod";

const PREFIX = "kisekae-closet:";

export function load<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 容量オーバーやプライベートモード: 保存できなくても動き続ける
  }
}

/** 1 つだけ消す。 */
export function forget(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // 消せなくても動き続ける
  }
}

/** このアプリが保存したものを全部消す (「データを消す」ボタン用)。 */
export function clearAll(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // 読めない端末 (プライベートモードなど): もともと何も置けていない
  }
}
