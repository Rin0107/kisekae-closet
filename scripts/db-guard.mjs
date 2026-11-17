// D1 に触れてよいのは src/worker/db.ts だけ、の検査 (web-db)。守りの部分。
// db.ts の関数は全部 user_id で絞るので、ほかのファイルが D1 を直接使うと「他人のデータを読めない」が崩れる。
// 見るもの: env.DB・.prepare(・.batch(・D1Database・SQL の文 (SELECT … FROM など) が db.ts の外にないこと。
import { readFileSync } from "node:fs";
import { fail, walk } from "./lib.mjs";

const OK = "src/worker/db.ts";
const problems = [];
for (const f of walk("src", [".ts", ".tsx"])) {
  const p = f.replace(/\\/g, "/");
  if (p === OK) continue;
  const src = readFileSync(f, "utf8");
  for (const [re, why] of [
    [/\.DB\b/, "env.DB を使う"],
    [/\.prepare\s*\(/, ".prepare( を使う"],
    [/\.batch\s*\(/, ".batch( を使う"],
    [/\bD1Database\b/, "D1Database を使う"],
    [
      /\b(SELECT\s+[\s\S]{0,200}?\s+FROM|INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\s+SET|DROP\s+TABLE)\b/,
      "SQL を書く",
    ],
  ]) {
    if (re.test(src))
      problems.push(
        `${p}: ${why} (D1 に触れてよいのは ${OK} だけ。そこに user_id で絞る関数を足すよう、人に頼む)`,
      );
  }
}
fail("D1 は db.ts だけ (db-guard)", problems);
