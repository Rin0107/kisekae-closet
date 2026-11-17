#!/bin/sh
# 重いコマンドを、メモリと CPU の上限つきで動かす。守りの部分 (wakuwaku guard で書き換え禁止)。
# 2026-11-10 にメモリが尽きて PC ごと落ちたことの再発防止 (docs/TESTING.md の「手元の機械を守る」)。
#
# 使い方: sh scripts/limit.sh <メモリの上限 (例 2G)> <CPU の数> <コマンド...>
#   - 手元 (systemd --user がある): そのコマンドだけの cgroup に入れる (テストなどの枠 heavy.slice の中。枠全体は 4G・4 コア、nix-config が決める)。メモリを超えたらそのコマンドだけが止まり (swap も使わない)、
#     CPU は指定の数までしか使えない。機械全体は巻き込まない
#   - CI (CI=true) や systemd のない所: 上限なしでそのまま動かす (CI の機械は使い捨てで、ジョブごとに 5 分の打ち切りがある)
# LIMIT_OFF=1 で上限を外せる (調べるとき用)
set -eu
mem="$1"; cpus="$2"; shift 2
if [ -z "${CI-}" ] && [ -z "${LIMIT_OFF-}" ] && command -v systemd-run >/dev/null 2>&1 \
  && systemd-run --user --scope --quiet true >/dev/null 2>&1; then
  exec systemd-run --user --scope --quiet --same-dir --slice=heavy.slice \
    -p MemoryMax="$mem" -p MemorySwapMax=0 -p CPUQuota="$((cpus * 100))%" -- "$@"
fi
exec "$@"
