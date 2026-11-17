import type { Parameters } from "fast-check";

/**
 * PBT の回数。ふつう (S のテスト) は 300 回。
 * fuzz のジョブ (FUZZ_MS を渡す) では、名前に "fuzz" を含むテストが時間いっぱい新しい入力を探す。
 */
export function runs<T>(): Parameters<T> {
  const ms = Number(process.env.FUZZ_MS ?? "0");
  return ms > 0
    ? { numRuns: Number.MAX_SAFE_INTEGER, interruptAfterTimeLimit: ms, markInterruptAsFailure: false }
    : { numRuns: 300 };
}
