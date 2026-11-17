#!/usr/bin/env node
// privacy-scan: 公開してはいけない個人情報 (メールアドレス・家のパス・名前) が git に入っていないかを見る。
// 鍵やトークンは gitleaks が見る。これは守りの部分 (書き換えは人だけ)。正本は工場の scripts/、雛形の scripts/ は写し。
//
//   node privacy-scan.mjs tree              今のファイル全部 (git ls-files)
//   node privacy-scan.mjs range <rev>...    コミットの作者・メッセージ・足した行 (例: base..head、sha --not --remotes)
//   node privacy-scan.mjs all               全履歴の全ファイルと全コミット (public にする前に)
//
// 見つけたら場所と種類だけを出して 1 で終わる。値そのものは出さない (public の CI のログに残るため)。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// 名前など。値を書くと、それ自体がここから漏れる。sha256 の先頭 16 桁だけを置く (英数字の語を小文字にして比べる)
const DENY = new Set(["562d3f70a6733b1a", "6b2c0cdb26cb0323", "17cf6b5627e9ea1f", "e62f309da4bb2a5f"]);

// 公開してよいメールアドレス (完全一致) とドメイン (末尾一致)。noreply@github.com は GitHub が squash merge したコミットのコミッター
const MAIL_OK = new Set(["noreply@anthropic.com", "git@github.com", "noreply@github.com"]);
const MAIL_OK_DOMAIN =
  /(^|\.)(users\.noreply\.github\.com|example\.(com|org|net)|example|test|invalid|localhost)$/i;
const MAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;
// 家のパス。例に使う名前 (runner・user など) はよい
const HOME_OK = /^(runner|user|username|you|me|node|ubuntu|vscode|name|USER|<[^>]*>)$/;
const HOME = [
  /\/home\/([^/\s"'`:)]+)/g,
  /\/Users\/([^/\s"'`:)]+)/g,
  /[A-Za-z]:\\+Users\\+([^\\\s"'`:)]+)/gi,
  /\/mnt\/[a-z]\/Users\/([^/\s"'`:)]+)/gi,
];

export function hash(word) {
  return createHash("sha256").update(word).digest("hex").slice(0, 16);
}

// 1 行を見て、見つけたものの種類を返す
export function check(line, deny = DENY) {
  const found = [];
  for (const m of line.matchAll(MAIL)) {
    if (!MAIL_OK.has(m[0].toLowerCase()) && !MAIL_OK_DOMAIN.test(m[1])) found.push("メールアドレス");
  }
  for (const re of HOME) {
    for (const m of line.matchAll(re)) {
      if (!HOME_OK.test(m[1]) && !m[1].startsWith("$")) found.push("家のパス");
    }
  }
  for (const m of line.matchAll(/[A-Za-z0-9]+/g)) {
    if (deny.has(hash(m[0].toLowerCase()))) found.push("名前");
  }
  return [...new Set(found)];
}

export function scanText(where, text, out) {
  if (text.includes("\0")) return; // バイナリ
  text.split("\n").forEach((line, i) => {
    for (const kind of check(line)) out.push(`${where}:${i + 1}: ${kind}`);
  });
}

function git(args, input) {
  const r = spawnSync("git", args, { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout;
}

// コミットの作者・コミッター・メッセージ
function scanCommits(revs, out) {
  const log = git(["log", "--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x1e", ...revs]).toString();
  for (const rec of log.split("\x1e")) {
    const [sha, author, committer, body] = rec.replace(/^\n/, "").split("\0");
    if (!sha) continue;
    scanText(`${sha.slice(0, 8)} 作者`, author, out);
    scanText(`${sha.slice(0, 8)} コミッター`, committer, out);
    scanText(`${sha.slice(0, 8)} メッセージ`, body, out);
  }
}

// 足した行とファイル名
function scanPatches(revs, out) {
  const log = git(["log", "-p", "--no-color", "--unified=0", "--format=commit %H", ...revs]).toString();
  let sha = "",
    file = "",
    n = 0;
  for (const line of log.split("\n")) {
    if (line.startsWith("commit ")) sha = line.slice(7, 15);
    else if (line.startsWith("+++ ")) {
      file = line.slice(6);
      scanText(`${sha} ${file} (ファイル名)`, file, out);
    } else if (line.startsWith("@@")) n = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
    else if (line.startsWith("+")) {
      for (const kind of check(line.slice(1))) out.push(`${sha} ${file}:${n}: ${kind}`);
      n++;
    }
  }
}

function tree(out) {
  for (const f of git(["ls-files", "-z"]).toString().split("\0").filter(Boolean)) {
    scanText(`${f} (ファイル名)`, f, out);
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue; // 消したばかりのファイル・submodule
    }
    scanText(f, text, out);
  }
}

// 全履歴の全 blob (どのコミットのどのファイルかは出さず、パスで示す)
function all(out) {
  scanCommits(["--all"], out);
  const objs = git(["rev-list", "--objects", "--all"]).toString().split("\n").filter(Boolean);
  const paths = new Map();
  for (const l of objs) {
    const i = l.indexOf(" ");
    if (i > 0) {
      paths.set(l.slice(0, i), l.slice(i + 1));
      scanText(`${l.slice(i + 1)} (ファイル名)`, l.slice(i + 1), out);
    }
  }
  const shas = [...paths.keys()];
  const kinds = git(["cat-file", "--batch-check=%(objectname) %(objecttype)"], shas.join("\n") + "\n")
    .toString()
    .split("\n");
  const blobs = kinds.filter((l) => l.endsWith(" blob")).map((l) => l.split(" ")[0]);
  for (const sha of blobs) {
    scanText(`${paths.get(sha)} (履歴 ${sha.slice(0, 8)})`, git(["cat-file", "blob", sha]).toString(), out);
  }
}

export function main(argv) {
  const [mode, ...rest] = argv;
  const out = [];
  if (mode === "tree") tree(out);
  else if (mode === "range" && rest.length > 0) {
    // base が 0000… (新しい branch) なら head までの全部を見る
    const revs = rest.map((r) => r.replace(/^0{40}\.\./, ""));
    scanCommits(revs, out);
    scanPatches(revs, out);
  } else if (mode === "all") all(out);
  else {
    console.error("使い方: privacy-scan.mjs tree | range <rev>... | all");
    return 2;
  }
  if (out.length === 0) {
    console.log(`ok: 個人情報なし (${mode})`);
    return 0;
  }
  console.error(
    `NG: 公開してはいけない個人情報がある (${out.length} か所)。値は出さない。直すまで push・merge・公開はできない`,
  );
  for (const o of out.slice(0, 200)) console.error(`  - ${o}`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
