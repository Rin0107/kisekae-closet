// 見本の服 (持ち主 2026-11-21「最初に 1 セット、全部の服の種類の例を、本当の写真で入れておいて」)
import { existsSync, readFileSync, statSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";

const sh = vi.hoisted(() => ({ shrinkPhoto: vi.fn() }));
vi.mock("../../src/shrink", () => sh);
const cl = vi.hoisted(() => ({ api: { addClothing: vi.fn() } }));
vi.mock("../../src/client", () => cl);

import { KIND_NAMES } from "../../src/App";
import { addSamples, SAMPLES } from "../../src/samples";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

test("見本は服の種類ごとに 1 枚ずつ、全部の種類がそろっている", () => {
  expect(SAMPLES.map((s) => s.kind).sort()).toEqual(Object.keys(KIND_NAMES).sort());
  for (const s of SAMPLES) {
    expect(s.label.startsWith("見本")).toBe(true);
    expect(s.warmth).toBeGreaterThanOrEqual(1);
    expect(s.warmth).toBeLessThanOrEqual(5);
  }
});

test("見本の写真は public/samples にあり、出どころ (作者とライセンス) が書いてある", () => {
  const credits = readFileSync("public/samples/LICENSE.md", "utf8");
  for (const s of SAMPLES) {
    const f = `public/samples/${s.file}`;
    expect(existsSync(f), f).toBe(true);
    expect(statSync(f).size).toBeLessThan(300_000);
    expect(credits).toContain(`\`${s.file}\``);
  }
});

test("見本を端末で縮めてから、自分の服と同じ道で入れる", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }))),
  );
  sh.shrinkPhoto.mockResolvedValue("AAAA");
  cl.api.addClothing.mockResolvedValue({ id: "x" });
  expect(await addSamples()).toBe(SAMPLES.length);
  expect(cl.api.addClothing).toHaveBeenCalledTimes(SAMPLES.length);
  expect(cl.api.addClothing.mock.calls[0]?.[0]).toEqual({
    kind: SAMPLES[0]?.kind,
    warmth: SAMPLES[0]?.warmth,
    label: SAMPLES[0]?.label,
    photo: "AAAA",
  });
});

test("1 枚入らなくても、ほかの見本は入れる (読めない・縮められない・送れない)", async () => {
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      n++ === 0 ? new Response("", { status: 404 }) : new Response(new Blob([new Uint8Array(1)])),
    ),
  );
  sh.shrinkPhoto.mockResolvedValueOnce(null).mockResolvedValue("AAAA");
  cl.api.addClothing.mockRejectedValueOnce(new Error("送れない")).mockResolvedValue({ id: "x" });
  expect(await addSamples()).toBe(SAMPLES.length - 3);
});

test("AC-79-2: 種類を渡せば、その種類の見本だけを入れる", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob([new Uint8Array(1)]))),
  );
  sh.shrinkPhoto.mockResolvedValue("AAAA");
  cl.api.addClothing.mockResolvedValue({ id: "x" });
  expect(await addSamples(["shoes"])).toBe(1);
  expect(cl.api.addClothing).toHaveBeenCalledTimes(1);
  expect(cl.api.addClothing.mock.calls[0]?.[0]).toMatchObject({ kind: "shoes", label: "見本 革ぐつ" });
  expect(await addSamples([])).toBe(0);
});

/** JPEG の大きさ (SOF の高さと幅) を読む。 */
function jpegSize(b: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1] ?? 0;
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3)
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("SOF がない");
}

test("AC-79-4: 見本のジーンズの写真は、撮影者の帯 (下の 36px ほど) を切り落としてある", () => {
  // 元の写真は 652×1024 で、y=991 から下が灰色の帯。帯の上の白い余白 (y=988) で切った
  expect(jpegSize(readFileSync("public/samples/bottom.jpg"))).toEqual({ width: 652, height: 988 });
  expect(readFileSync("public/samples/LICENSE.md", "utf8")).toContain("`bottom.jpg` は、下の撮影者の帯");
});
