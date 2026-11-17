// 本番ビルドの中に、許可していない外部の宛先がないかの検査 (外部スクリプト・トラッカー・送信先)。
// ブラウザでは CSP (connect-src 'self') でも止まるが、ビルドの時点でも見る。
import { readFileSync } from "node:fs";
import { fail, walk, wk } from "./lib.mjs";

// 文字列として入っているだけで通信しないもの (名前空間・エラーメッセージの URL)
// simplewebauthn.dev: @simplewebauthn/browser のエラーの文に入る説明の URL (web-db)
const builtin = ["www.w3.org", "react.dev", "reactjs.org", "fb.me", "json-schema.org", "simplewebauthn.dev"];
const allow = new Set([...builtin, ...wk.egress_allow]);
const problems = [];
const files = walk("dist", [".js", ".html", ".css", ".json", ".webmanifest"]);
if (files.length === 0) problems.push("dist/ が空 (先に build する)");
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/"'`:?)\s]|$)/gi)) {
    const host = m[1].toLowerCase();
    if (!allow.has(host))
      problems.push(
        `${f}: 外部の宛先 ${host} (必要なら理由を書いて wk.json の egress_allow に足すよう、ユーザーに頼む)`,
      );
  }
}
fail("外部への送信 (egress-guard)", [...new Set(problems)]);
