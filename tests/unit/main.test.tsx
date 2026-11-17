// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  document.body.replaceChildren();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "ログインしていない" }), { status: 401 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

test("#root に描く (ログインの前の画面)", async () => {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  await act(async () => {
    await import("../../src/main");
  });
  await act(async () => {});
  expect(document.querySelector('[data-testid="goal"]')).not.toBeNull();
});

test("#root がなければ止まる", async () => {
  await expect(import("../../src/main")).rejects.toThrow("#root がない");
});
