#!/bin/sh
# 仕様の検査。spec/*.cfg (TLA+ を TLC で) と spec/*.smt2 (Z3) を全部流す。
#   - TLC: INVARIANT が全状態で成り立ち、行き詰まりがないこと
#   - cfg の INVARIANT ごとに、実装を検査するテスト TestSpec_<名前> があること (仕様と実装をつなぐ)
#   - Z3: すべての (check-sat) が unsat (性質の否定が成り立たない = 性質が証明できた)
# 道具: TLA2TOOLS (tla2tools.jar のパス)、Z3 (z3 の実行ファイル)。CI が版と sha256 を固定して入れる。
# 守りの部分 (wakuwaku guard で書き換え禁止)。
# 手元の機械を守る: TLC は TLC_WORKERS 本 (既定 2)・Java のヒープ TLC_HEAP (既定 768m)、Z3 は Z3_MEM_MB (既定 1024MB) まで。
#   さらに scripts/limit.sh で、それぞれ 1536M・2 コアの cgroup に入れる (超えたらそのコマンドだけが止まる)
set -eu
workers="${TLC_WORKERS:-2}"
heap="${TLC_HEAP:-768m}"
z3mem="${Z3_MEM_MB:-1024}"
lim="sh $(dirname "$0")/limit.sh 1536M 2"
: "${TLA2TOOLS:?tla2tools.jar のパスを TLA2TOOLS に}"
Z3="${Z3:-z3}"
cfgs=$(ls spec/*.cfg 2>/dev/null || true)
if [ -z "$cfgs" ]; then
  echo "spec/*.cfg がない (仕様は必須。spec/README.md)" >&2
  exit 1
fi
fail=0
for cfg in $cfgs; do
  tla="${cfg%.cfg}.tla"
  echo "TLC: $tla"
  dir=$(mktemp -d)
  if ! $lim java -Xmx"$heap" -XX:ActiveProcessorCount="$workers" -XX:+UseParallelGC -cp "$TLA2TOOLS" tlc2.TLC -workers "$workers" -metadir "$dir" -config "$cfg" "$tla"; then
    echo "TLC が失敗: $tla" >&2
    fail=1
  fi
  rm -rf "$dir"
  for inv in $(awk '
    /^[A-Z_]+/ { kw = $1; sub(/S$/, "", kw); mode = (kw == "INVARIANT"); for (i = 2; i <= NF; i++) if (mode) print $i; next }
    mode && NF { for (i = 1; i <= NF; i++) print $i }' "$cfg"); do
    # Go: func TestSpec_<名前>(  /  TS: test("Spec_<名前>: …")
    if ! grep -rqE "func TestSpec_${inv}\(|[\"'\`]Spec_${inv}\b" \
      --include='*_test.go' --include='*.test.ts' --include='*.test.tsx' --exclude-dir=node_modules .; then
      echo "仕様の不変条件 ${inv} を実装に対して確かめるテスト (Go: TestSpec_${inv} / TS: \"Spec_${inv}: …\") がない" >&2
      fail=1
    fi
  done
done
for smt in $(ls spec/*.smt2 2>/dev/null || true); do
  echo "Z3: $smt"
  out=$($lim "$Z3" -T:60 -memory:"$z3mem" "$smt" 2>&1 || true)
  if [ -z "$out" ] || printf '%s\n' "$out" | grep -qv '^unsat$'; then
    echo "Z3: $smt が証明できない (unsat 以外):" >&2
    printf '%s\n' "$out" >&2
    fail=1
  fi
done
exit "$fail"
