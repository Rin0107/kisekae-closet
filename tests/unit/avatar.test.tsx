// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { Stage } from "../../src/Avatar";
import { SLOTS } from "../../src/outfit";

afterEach(() => document.body.replaceChildren());

async function stage(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () =>
    createRoot(el).render(
      <Stage worn={[{ id: "t1", kind: "top", warmth: 2, label: "白T", createdAt: 1 }]} />,
    ),
  );
  return el;
}

describe("リアルなアバター (#22)", () => {
  test("AC-22-1: 体は手描きの図形ではなく repo の中の絵。出どころとライセンス (CC0) が LICENSE.md にある", async () => {
    const el = await stage();
    const body = el.querySelector("img.body");
    expect(body?.getAttribute("src")).toBe("/avatar/body.webp");
    expect(el.querySelector("svg.body")).toBeNull();
    const license = readFileSync("public/avatar/LICENSE.md", "utf8");
    expect(license).toContain("CC0 1.0 Universal");
    expect(license).toContain("https://github.com/makehumancommunity/makehuman");
    expect(license).toContain("body.webp");
  });

  test("AC-22-2: 絵は自分の origin から読み (CSP のまま)、WebP で 400KB 以下。台の大きさは変わらない", async () => {
    const el = await stage();
    expect(el.querySelector("img.body")?.getAttribute("src")).toMatch(/^\/[^/]/);
    const file = "public/avatar/body.webp";
    expect(statSync(file).size).toBeLessThanOrEqual(400 * 1024);
    const head = readFileSync(file).subarray(0, 12);
    expect(head.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(head.subarray(8, 12).toString("latin1")).toBe("WEBP");
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toContain("--stage-w: 200px;");
    expect(css).toContain("--stage-h: 400px;");
  });

  test("AC-22-3: 服を重ねる枠は、絵の肩 (約 20%)・腰 (約 44%)・足首 (約 89%) に合う", () => {
    const { top, bottom, shoes } = SLOTS as Record<
      "top" | "bottom" | "shoes",
      { top: number; height: number }
    >;
    // トップスは肩の少し上から腰の下まで
    expect(top.top).toBeLessThanOrEqual(19.8);
    expect(top.top + top.height).toBeGreaterThanOrEqual(43.5);
    // ボトムスは腰から足首まで
    expect(bottom.top).toBeLessThanOrEqual(44.6);
    expect(bottom.top + bottom.height).toBeGreaterThanOrEqual(86);
    // くつは足首から足の裏 (93%) まで
    expect(shoes.top).toBeLessThanOrEqual(89.2);
    expect(shoes.top + shoes.height).toBeGreaterThanOrEqual(93);
  });

  test("AC-22-4: 実在の人の写真・顔写真を使っていない (置いてあるのは描いた絵とライセンスだけ)", () => {
    expect(readdirSync("public/avatar").sort()).toEqual(["LICENSE.md", "body.webp"]);
    expect(readFileSync("public/avatar/LICENSE.md", "utf8")).toContain(
      "実在の人の写真・顔写真は使っていない",
    );
  });
});
