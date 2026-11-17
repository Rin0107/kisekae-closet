/// <reference types="node" />
// 出す前の形の確かめ: DATA.md と migrations が食い違わない・migrations が空の D1 に頭から当たる・wk deploy の材料がそろう。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";

const MIGRATIONS = readdirSync("migrations").filter((f) => f.endsWith(".sql"));
const tablesIn = (sql: string) => [...sql.matchAll(/CREATE TABLE\s+(\w+)/gi)].map((m) => m[1]);
const serverTablesInDataMd = () => {
  const data = readFileSync("DATA.md", "utf8");
  const section = data.split("## サーバー")[1]?.split("\n## ")[0] ?? "";
  return [...section.matchAll(/^\| `(\w+)`/gm)].map((m) => m[1]);
};

describe("DATA.md と migrations", () => {
  test("AC-5-3: サーバーに置くテーブルは DATA.md の表と同じで、表にないテーブルはない", () => {
    const fromSql = MIGRATIONS.flatMap((f) => tablesIn(readFileSync(`migrations/${f}`, "utf8")));
    const fromDoc = serverTablesInDataMd();
    expect(fromDoc.length).toBeGreaterThan(0);
    expect([...fromSql].sort()).toEqual([...fromDoc].sort());
  });

  test("AC-5-3: 服は写真・種類・暖かさ・ラベル、コーデは日付と天気の数字だけ (場所の欄がない)", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of [...MIGRATIONS].sort()) db.exec(readFileSync(`migrations/${f}`, "utf8"));
    const cols = (t: string) =>
      (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    for (const t of ["clothes", "outfits", "outfit_items"])
      for (const c of cols(t)) expect(c).not.toMatch(/lat|lng|lon|city|place|location|address|name|email/i);
  });
});

describe("migrations", () => {
  test("AC-6-2: ファイルは 0001_ からの続き番号で、番号順に並ぶ", () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    const sorted = [...MIGRATIONS].sort();
    sorted.forEach((f, i) =>
      expect(f).toMatch(new RegExp(`^${String(i + 1).padStart(4, "0")}_[a-z0-9_]+\\.sql$`)),
    );
  });

  test("AC-6-2: 空の D1 (SQLite) に番号順に当てて通り、外部キーも壊れていない", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const f of [...MIGRATIONS].sort())
      expect(() => db.exec(readFileSync(`migrations/${f}`, "utf8"))).not.toThrow();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    )
      .map((r) => r.name)
      .filter((n) => !n.startsWith("sqlite_"));
    expect(tables.sort()).toEqual([...serverTablesInDataMd()].sort());
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("wk deploy の材料", () => {
  test("AC-6-1: Worker の入口・静的ファイルの置き場・migrations の置き場が設定と合い、bundle が worker.js を作る", () => {
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    const main = /"main":\s*"([^"]+)"/.exec(wrangler)?.[1] ?? "";
    expect(existsSync(main)).toBe(true);
    expect(wrangler).toMatch(/"directory":\s*"\.\/dist"/);
    expect(wrangler).toMatch(/"migrations_dir":\s*"migrations"/);
    expect(wrangler).toMatch(/"binding":\s*"DB"/);
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.verify).toContain("npm run build");
    expect(pkg.scripts.bundle).toContain("--outdir bundle");
    expect(pkg.scripts.bundle).toContain("bundle/worker.js");
  });
});
