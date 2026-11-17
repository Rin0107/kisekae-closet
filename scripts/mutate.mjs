// ミューテーションテスト: BASE からの変更 (src/ の .ts/.tsx) にだけ、壊したコードを作ってテストが気づくかを見る。
// 変更がなければ何もしない。初めての push (BASE が 0000…) は空の木と比べる (全部が対象)。
// 守りの部分 (wakuwaku guard で書き換え禁止)。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

let base = process.argv[2] ?? "";
if (!base || /^0+$/.test(base)) {
  base = execFileSync("git", ["hash-object", "-t", "tree", "/dev/null"]).toString().trim();
}
// 2 つ目からは見る場所 (既定は src。工場の CI は守りの部分と決まりの関数だけを見る)
const paths = process.argv.length > 3 ? process.argv.slice(3) : ["src"];
const files = execFileSync("git", ["diff", "--name-only", base, "--", ...paths])
  .toString()
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts") && existsSync(f));
if (files.length === 0) {
  console.log("ok: 変わったコードがない (ミューテーションは不要)");
  process.exit(0);
}
console.log("対象:\n  " + files.join("\n  "));
const r = spawnSync("npx", ["stryker", "run", "--mutate", files.join(",")], { stdio: "inherit" });
process.exit(r.status ?? 1);
