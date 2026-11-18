// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { Stage } from "../../src/Avatar";
import { BODICE_SHARE, BODY, SLOTS } from "../../src/outfit";

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

/** 台の縦横比 (幅 ÷ 高さ)。width の % を、高さの % に直すのに使う。 */
const STAGE_RATIO = 200 / 400;
/** 幅で合わせた服の、台の高さに対する丈 (%)。ratio は写真の 縦 ÷ 横。 */
const length = (width: number, ratio: number) => width * STAGE_RATIO * ratio;

describe("服が体を覆う (#26)", () => {
  test("AC-26-1: トップス・ワンピース・アウターの身ごろは、胴の下着の幅と首元を覆う。ボトムスは腰を覆う", () => {
    for (const k of ["top", "dress", "outer"]) {
      const s = SLOTS[k];
      if (s === undefined) throw new Error(k);
      // 袖を除いた身ごろ (写真の幅の BODICE_SHARE) が、下着の左右の端より外まである
      const side = (s.width * (1 - BODICE_SHARE)) / 2;
      expect(s.left + side, k).toBeLessThanOrEqual(BODY.torsoLeft);
      expect(s.left + s.width - side, k).toBeGreaterThanOrEqual(BODY.torsoRight);
      // 首元: 下着の上の端より上から始まる
      expect(s.top, k).toBeLessThan(BODY.neck - 2);
      expect(s.left + s.width / 2, k).toBe(50); // 真ん中にそろえる
    }
    // ふつうの丈のトップス (縦 ÷ 横 0.9 以上) は、ボトムスの上の端まで届く (腰で下着がのぞかない)
    const { top, bottom } = SLOTS as Record<"top" | "bottom", { top: number; left: number; width: number }>;
    expect(top.top + length(top.width, 0.9)).toBeGreaterThanOrEqual(bottom.top);
    // ボトムスの腰 (写真の幅の 3/4 ほど) が、下着の腰の幅を覆い、下着の下の端より上から始まる
    const waist = (bottom.width * (1 - 0.75)) / 2;
    expect(bottom.left + waist).toBeLessThanOrEqual(BODY.torsoLeft);
    expect(bottom.left + bottom.width - waist).toBeGreaterThanOrEqual(BODY.torsoRight);
    expect(bottom.top).toBeLessThan(BODY.hip - 6);
  });

  test("AC-26-2: トップスの袖の先は、腕の外の線の近くにあり、腕だけが袖の外に大きく出ない", () => {
    const top = SLOTS.top as { top: number; left: number; width: number };
    // ハンガーにかけた半袖の袖の先: 写真の左の端、上から 4 割 (e2e の見本の服と同じ形)
    for (const ratio of [0.9, 1.04, 1.2]) {
      const y = top.top + 0.4 * length(top.width, ratio);
      const arm = BODY.torsoLeft - (y - BODY.shoulder) * BODY.armSlope;
      // 袖が腕の外の線まで覆う (はみ出す腕は台の幅の 3% = 6px まで)
      expect(top.left, `縦横比 ${ratio}`).toBeLessThanOrEqual(arm + 3);
      expect(arm - top.left, `縦横比 ${ratio}`).toBeLessThanOrEqual(8); // 袖だけが大きく張り出さない
    }
  });

  test("AC-26-3: 服の写真は曲げず、大きさと位置だけを変える (幅で合わせ、縦は写真のまま)", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const worn = ["top", "bottom", "outer", "shoes"].map((kind, i) => ({
      id: `c${i}`,
      kind,
      warmth: 2,
      label: kind,
      createdAt: i,
    }));
    await act(async () => createRoot(el).render(<Stage worn={worn} />));
    const imgs = [...el.querySelectorAll<HTMLImageElement>('[data-testid="worn"]')];
    const byKind = Object.fromEntries(imgs.map((i) => [i.dataset.kind, i.style]));
    expect(byKind.top?.width).toBe("68%");
    expect(byKind.top?.height).toBe("auto");
    expect(byKind.outer?.height).toBe("auto");
    expect(byKind.bottom?.height).toBe("auto");
    expect(byKind.shoes?.height).toBe("12%"); // くつは箱に収める
    for (const s of imgs.map((i) => i.style)) expect(s.transform).toBe("");
    const css = readFileSync("src/style.css", "utf8");
    for (const m of css.matchAll(/\.wear[^{]*\{([^}]*)\}/g))
      expect(m[1]).not.toMatch(/transform|skew|perspective/);
  });

  test("AC-26-4: 服を重ねても、アバターの台の大きさは変わらない (CSS の変数で固定)", () => {
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toContain("--stage-w: 200px;");
    expect(css).toContain("--stage-h: 400px;");
    expect(/\.stage \{([^}]*)\}/.exec(css)?.[1]).toContain("flex: none");
  });
});
