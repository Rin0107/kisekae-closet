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
