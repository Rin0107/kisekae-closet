// zod の JIT を使わない: 使えるかを new Function で試すだけでも、CSP (unsafe-eval なし) が違反として報告する (#25)。
// ほかのモジュールより先に評価されるよう、main.tsx の最初に import する。
import { z } from "zod";

z.config({ jitless: true });
