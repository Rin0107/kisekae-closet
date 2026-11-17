// @vitest-environment happy-dom
import fc from "fast-check";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { clearAll, load, save } from "../../src/storage";
import { runs } from "./fc";

const N = z.number().int();

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("storage", () => {
  test("なければ既定値", () => expect(load("k", N, 7)).toBe(7));

  test("なければ既定値 (null を受け付ける型でも、保存がないことと null を取り違えない)", () => {
    expect(load("k", N.nullable(), 5)).toBe(5);
    save("k", null);
    expect(load("k", N.nullable(), 5)).toBeNull();
  });

  test("保存したものが読める (PBT: どんな整数でも往復する)", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        save("k", n);
        expect(load("k", N, 0)).toBe(n);
      }),
      runs(),
    );
  });

  test("壊れた値・型の違う値なら既定値", () => {
    localStorage.setItem("kisekae-closet:k", "{not json");
    expect(load("k", N, 1)).toBe(1);
    localStorage.setItem("kisekae-closet:k", JSON.stringify("文字"));
    expect(load("k", N, 2)).toBe(2);
  });

  test("保存できなくても落ちない (容量オーバー・プライベートモード)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => save("k", 1)).not.toThrow();
  });

  test("clearAll はこのアプリのキーだけを消す", () => {
    save("a", 1);
    localStorage.setItem("other-app:a", "1");
    clearAll();
    expect(localStorage.getItem("kisekae-closet:a")).toBeNull();
    expect(localStorage.getItem("other-app:a")).toBe("1");
  });
});
