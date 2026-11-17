// テストの設定と基準。守りの部分 (wakuwaku guard で書き換え禁止)。
// カバレッジは src/ の全部で 100% (行・分岐・関数・文)。下回れば npm test が落ちる。
// v3: 100% は公開の前 (npm run verify-ship、WK_SHIP=1) にだけかける。試作のあいだはカバレッジを出すだけ (docs/DESIGN-v3.md §5)
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 60_000,
    // 手元の機械を守る: 同時に動かすテストのプロセスは 2 つまで (npm test は 2G・2 コアの cgroup の中で動く)
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text", "json-summary"],
      thresholds:
        process.env.WK_SHIP === "1" ? { lines: 100, branches: 100, functions: 100, statements: 100 } : {},
    },
  },
});
