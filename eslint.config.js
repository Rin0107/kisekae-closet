import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "bundle", ".wrangler", "node_modules", "playwright-report", "test-results"] },
  js.configs.recommended,
  { files: ["scripts/**/*.mjs", "*.config.{js,ts}"], languageOptions: { globals: globals.node } },
  ...tseslint.configs.strict,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 守り: 生の HTML の差し込み・動的なコード実行・外への送信の書き方を禁止
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-properties": [
        "error",
        { object: "document", property: "write", message: "document.write は使わない" },
        { object: "navigator", property: "sendBeacon", message: "外に送らない" },
        { object: "navigator", property: "serviceWorker", message: "Service Worker は使わない (同じ origin のほかのアプリに効くため)" },
        { object: "document", property: "cookie", message: "Cookie は使わない" },
        { object: "window", property: "indexedDB", message: "保存は src/storage.ts (localStorage) だけ" },
      ],
      "no-restricted-globals": [
        "error",
        { name: "indexedDB", message: "保存は src/storage.ts (localStorage) だけ" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "生の HTML を差し込まない",
        },
        { selector: "MemberExpression[property.name='innerHTML']", message: "innerHTML を使わない" },
        { selector: "MemberExpression[property.name='outerHTML']", message: "outerHTML を使わない" },
      ],
    },
  },
);
