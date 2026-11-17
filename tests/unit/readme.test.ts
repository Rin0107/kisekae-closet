import { existsSync, readFileSync, statSync } from "node:fs";
import { expect, test } from "vitest";

const readme = readFileSync("README.md", "utf8");
const usage = /## 使い方\n([\s\S]*?)\n## /.exec(readme)?.[1] ?? "";
const images = [...usage.matchAll(/!\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1] as string);

test("AC-9-1: README の使い方に 3〜5 行の説明と 3 枚の画像がある", () => {
  const steps = usage.split("\n").filter((l) => /^\d+\. /.test(l));
  expect(steps.length).toBeGreaterThanOrEqual(3);
  expect(steps.length).toBeLessThanOrEqual(5);
  expect(images).toEqual(["docs/shots/today.png", "docs/shots/closet.png", "docs/shots/calendar.png"]);
  for (const f of images) {
    expect(existsSync(f), f).toBe(true);
    // PNG で、大きすぎない (repo を重くしない)
    expect(readFileSync(f).subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(statSync(f).size).toBeLessThan(300_000);
  }
});

test("AC-9-2: 画像は e2e で撮り直せる (npm run shots が closet の e2e を SHOTS=1 で流し、docs/shots/ に書く)", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  expect(pkg.scripts.shots).toBe("SHOTS=1 npm run e2e -- closet");
  const e2e = readFileSync("tests/e2e/closet.spec.ts", "utf8");
  expect(e2e).toContain("docs/shots/${name}.png");
  for (const n of ["today", "closet", "calendar"]) expect(e2e).toContain(`shot("${n}")`);
});

test("AC-9-3: 画像に個人の情報が写らない (服は canvas で描いた絵、天気は手元の見本、市は既定のまま)", () => {
  const e2e = readFileSync("tests/e2e/closet.spec.ts", "utf8");
  // 服の写真は e2e の中で canvas に描いたもの。外のファイル (人の写真) を読まない
  expect(e2e).toContain('document.createElement("canvas")');
  expect(e2e).not.toMatch(/readFile|\.jpe?g"|fixtures\//);
  // 天気は Open-Meteo に出さず、手元の見本で返す (場所を外に送らない)
  expect(e2e).toContain('page.route("https://api.open-meteo.com/**"');
  // 市は既定 (東京) のまま。選び直さない
  expect(e2e).not.toMatch(/selectOption/);
});
