// 計画 v0.11 の受け入れテスト (wk が sha256 で固定する。変えない)
// 評価10: 「トップスの襟ぐりがあご・口元まで覆う (白T・セーター・ロンT すべて)」。
// 体の絵 (public/avatar/body.webp) を 2026-11-20 に測った: あごの下の端は台の上から 13.5% (そこから下は首で幅 9% ほど)、首の付け根は 16.3%。
// トップス・ワンピース・アウターは、あごより下 (13.5% 以上) から始め、首元の下着は今のまま覆う (BODY.neck − 2 より上)。
import { expect, test } from "vitest";
import { BODY, place, SLOTS } from "../../../src/outfit";

const CHIN = 13.5;

test("AC-1: 体の目印に、測ったあごの下の端 BODY.chin (13.5%) がある", () => {
  expect((BODY as unknown as Record<string, number>).chin).toBe(CHIN);
});

test("AC-2: トップス・ワンピース・アウターの上の端は、あごより下で、首の付け根より 2% 以上上", () => {
  for (const k of ["top", "dress", "outer"]) {
    const s = SLOTS[k];
    if (s === undefined) throw new Error(k);
    expect(s.top, k).toBeGreaterThanOrEqual(CHIN);
    expect(s.top, k).toBeLessThan(BODY.neck - 2);
    const b = place(k, 1);
    expect(b?.top, k).toBe(s.top);
  }
});

test("AC-3: アウターはトップスより上から始まらない (中のトップスの襟元がのぞく、#33 を保つ)", () => {
  expect(SLOTS.outer?.top ?? 0).toBeGreaterThanOrEqual(SLOTS.top?.top ?? 99);
});
