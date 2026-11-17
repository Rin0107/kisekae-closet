// サイト全体のテーマ (色のトークンの組)。選んだものは端末の localStorage にだけ置く (DATA.md)。
// 既定のいちごミルクは src/style.css の :root と同じ値。ほかのテーマは :root の変数を上書きする。
// 見た目の決まりは docs/design-system.md の「テーマ」。
import { z } from "zod";

/** テーマで変える色のトークン。 */
export const THEME_TOKENS = [
  "--c-bg",
  "--c-surface",
  "--c-surface-2",
  "--c-text",
  "--c-muted",
  "--c-primary",
  "--c-primary-strong",
  "--c-on-primary",
  "--c-primary-soft",
  "--c-line",
  "--c-same",
  "--c-near",
] as const;
export type Token = (typeof THEME_TOKENS)[number];

export interface Theme {
  id: string;
  name: string;
  colors: Record<Token, string>;
}

export const THEMES: readonly Theme[] = [
  {
    id: "strawberry",
    name: "いちごミルク",
    colors: {
      "--c-bg": "#fff7f9",
      "--c-surface": "#ffffff",
      "--c-surface-2": "#fdeef2",
      "--c-text": "#3d2a30",
      "--c-muted": "#7a5f67",
      "--c-primary": "#e86a8a",
      "--c-primary-strong": "#b53b5e",
      "--c-on-primary": "#ffffff",
      "--c-primary-soft": "#fbd3dd",
      "--c-line": "#f1d5dc",
      "--c-same": "#f9b9c9",
      "--c-near": "#fde3ea",
    },
  },
  {
    id: "mint",
    name: "ミントソーダ",
    colors: {
      "--c-bg": "#f3fbf8",
      "--c-surface": "#ffffff",
      "--c-surface-2": "#e3f5ee",
      "--c-text": "#1f3a33",
      "--c-muted": "#4f6d65",
      "--c-primary": "#5cbfa0",
      "--c-primary-strong": "#2b7a62",
      "--c-on-primary": "#ffffff",
      "--c-primary-soft": "#c8ecdf",
      "--c-line": "#cfe8de",
      "--c-same": "#9edcc6",
      "--c-near": "#dcf3ea",
    },
  },
  {
    id: "lavender",
    name: "ラベンダー",
    colors: {
      "--c-bg": "#f8f6fd",
      "--c-surface": "#ffffff",
      "--c-surface-2": "#eeeaf9",
      "--c-text": "#33294a",
      "--c-muted": "#665c7d",
      "--c-primary": "#9b86d6",
      "--c-primary-strong": "#6a52b3",
      "--c-on-primary": "#ffffff",
      "--c-primary-soft": "#dcd3f3",
      "--c-line": "#e2dbf3",
      "--c-same": "#c9bbee",
      "--c-near": "#ebe5f8",
    },
  },
  {
    id: "milktea",
    name: "ミルクティー",
    colors: {
      "--c-bg": "#fbf7f2",
      "--c-surface": "#ffffff",
      "--c-surface-2": "#f3ebe0",
      "--c-text": "#3b2e24",
      "--c-muted": "#6e5d4f",
      "--c-primary": "#c49a74",
      "--c-primary-strong": "#8a5f3c",
      "--c-on-primary": "#ffffff",
      "--c-primary-soft": "#ecdcc9",
      "--c-line": "#eadfd1",
      "--c-same": "#e2c8a8",
      "--c-near": "#f3e8da",
    },
  },
];

export const DEFAULT_THEME = "strawberry";
export const ThemeId = z.enum(["strawberry", "mint", "lavender", "milktea"]);

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? (THEMES[0] as Theme);
}

/** テーマの色を :root の変数に置く (CSSOM で。style の属性を HTML に書かないので CSP のまま)。 */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  for (const k of THEME_TOKENS) root.style.setProperty(k, t.colors[k]);
  root.dataset.theme = t.id;
}

/** WCAG の相対輝度。#rrggbb だけ。 */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error(`色の形が違う: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => {
    const c = parseInt(x as string, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 二つの色のコントラスト比 (1〜21)。 */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** 字と地の組 (本文として読むもの)。どれも 4.5:1 以上にする。 */
export const TEXT_PAIRS: readonly [Token, Token][] = [
  ["--c-text", "--c-bg"],
  ["--c-text", "--c-surface"],
  ["--c-text", "--c-surface-2"],
  ["--c-text", "--c-primary-soft"],
  ["--c-text", "--c-same"],
  ["--c-text", "--c-near"],
  ["--c-muted", "--c-bg"],
  ["--c-muted", "--c-surface"],
  ["--c-muted", "--c-surface-2"],
  ["--c-primary-strong", "--c-bg"],
  ["--c-primary-strong", "--c-surface"],
  ["--c-on-primary", "--c-primary-strong"],
];
