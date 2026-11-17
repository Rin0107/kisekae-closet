// 重要な情報を持たないことの検査。
// - D1 の migration に個人と結びつく欄がない
// - Worker が IP・User-Agent・Cookie を読まない、本文をログに出さない
// - DATA.md があり、migration のテーブルが全部書かれている
import { existsSync, readFileSync } from "node:fs";
import { fail, walk, wk } from "./lib.mjs";

const problems = [];
const forbidden = new RegExp(`(^|[^a-z])(${wk.forbidden_fields.join("|")})([^a-z]|$)`, "i");

const tables = [];
for (const f of walk("migrations", [".sql"])) {
  const sql = readFileSync(f, "utf8").replace(/--.*$/gm, "");
  for (const m of sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(\w+)["`]?\s*\(([\s\S]*?)\);/gi,
  )) {
    tables.push(m[1]);
    for (const col of m[2].split(",")) {
      const name = col.trim().split(/\s+/)[0]?.replace(/["`]/g, "") ?? "";
      if (forbidden.test(name)) problems.push(`${f}: テーブル ${m[1]} の欄 "${name}" は持ってはいけない情報`);
    }
  }
  for (const m of sql.matchAll(/alter\s+table\s+(\w+)\s+add\s+(?:column\s+)?["`]?(\w+)/gi)) {
    if (forbidden.test(m[2])) problems.push(`${f}: ${m[1]}.${m[2]} は持ってはいけない情報`);
  }
}

for (const f of walk("src/worker", [".ts"])) {
  const src = readFileSync(f, "utf8");
  // web-db: Cookie (セッション) を読んでよいのは src/worker/session.ts だけ
  const cookieOk = f.replace(/\\/g, "/") === "src/worker/session.ts";
  for (const [re, why] of [
    [/cf-connecting-ip|x-forwarded-for|x-real-ip|true-client-ip/i, "IP アドレスを読まない"],
    [/["']user-agent["']/i, "User-Agent を読まない"],
    [cookieOk ? /(?!)/ : /headers\.get\(\s*["']cookie["']/i, "Cookie を読むのは src/worker/session.ts だけ"],
    [/request\.cf\b|req\.cf\b/, "位置の情報 (request.cf) を読まない"],
    [
      /console\.(log|info|debug|warn)\s*\(/,
      "Worker でログを出さない (本文や利用者の情報が残るため。エラーは console.error に固定文だけ)",
    ],
  ]) {
    if (re.test(src)) problems.push(`${f}: ${why}`);
  }
}

if (!existsSync("DATA.md")) {
  problems.push("DATA.md がない");
} else {
  const data = readFileSync("DATA.md", "utf8");
  for (const t of tables) if (!data.includes(t)) problems.push(`DATA.md にテーブル ${t} の説明がない`);
}

fail("持たない情報 (data-guard)", problems);
