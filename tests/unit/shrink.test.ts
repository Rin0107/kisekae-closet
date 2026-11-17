// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { encodeSmall, fitSize, MAX_BYTES, MAX_SIDE, QUALITIES, shrinkPhoto } from "../../src/shrink";

afterEach(() => vi.unstubAllGlobals());

const blob = (type: string, size: number) => new Blob([new Uint8Array(size)], { type });

test("fitSize: 長辺を 1024 まで。小さいものは大きくしない。0 にはしない", () => {
  expect(fitSize(4000, 3000)).toEqual({ w: MAX_SIDE, h: 768 });
  expect(fitSize(3000, 4000)).toEqual({ w: 768, h: MAX_SIDE });
  expect(fitSize(1024, 10)).toEqual({ w: 1024, h: 10 });
  expect(fitSize(1025, 1)).toEqual({ w: 1024, h: 1 });
  expect(fitSize(500, 400)).toEqual({ w: 500, h: 400 });
  expect(fitSize(100_000, 1)).toEqual({ w: 1024, h: 1 });
});

describe("encodeSmall", () => {
  test("WebP で収まれば WebP", async () => {
    const enc = vi.fn(async (type: string) => blob(type, 10));
    expect((await encodeSmall(enc))?.type).toBe("image/webp");
    expect(enc).toHaveBeenCalledTimes(1);
    expect(enc).toHaveBeenCalledWith("image/webp", QUALITIES[0]);
  });
  test("WebP を書けない端末 (PNG が返る・null) は JPEG", async () => {
    for (const r of [blob("image/png", 10), null]) {
      const enc = vi.fn(async (type: string) => (type === "image/webp" ? r : blob(type, 10)));
      expect((await encodeSmall(enc))?.type).toBe("image/jpeg");
    }
  });
  test("大きければ画質を下げる。300KB ちょうどは通り、1 byte 超えは次へ", async () => {
    const sizes = [MAX_BYTES + 1, MAX_BYTES];
    const enc = vi.fn(async (type: string) => blob(type, sizes.shift() ?? 0));
    const got = await encodeSmall(enc);
    expect(got?.size).toBe(MAX_BYTES);
    expect(enc.mock.calls.map((c) => (c as unknown[])[1])).toEqual([QUALITIES[0], QUALITIES[1]]);
  });
  test("どの画質でも収まらない・書けなければ null", async () => {
    expect(await encodeSmall(async (type) => blob(type, MAX_BYTES + 1))).toBeNull();
    expect(await encodeSmall(async () => null)).toBeNull();
  });
});

test("shrinkPhoto: 縮めて描き直し、base64 にする (描けなければ null)", async () => {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", async () => ({ width: 2048, height: 1024, close }));
  const draw = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === "2d" ? { drawImage: draw } : null),
    toBlob: (cb: (b: Blob | null) => void, type: string) =>
      cb(new Blob([new Uint8Array([1, 2, 3])], { type })),
  };
  const create = vi.spyOn(document, "createElement").mockReturnValue(canvas as never);
  expect(await shrinkPhoto(new Blob(["x"]))).toBe(btoa("\x01\x02\x03"));
  expect([canvas.width, canvas.height]).toEqual([1024, 512]);
  expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512);
  expect(close).toHaveBeenCalled();
  canvas.toBlob = (cb) => cb(null);
  canvas.getContext = () => null as never;
  expect(await shrinkPhoto(new Blob(["x"]))).toBeNull();
  expect(create).toHaveBeenCalledWith("canvas");
  create.mockRestore();
});
