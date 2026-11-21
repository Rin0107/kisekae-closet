// 見本の服: アカウントを作ったら、6 種類を 1 枚ずつクローゼットに入れておく (持ち主 2026-11-21「服を入れるのめんどくさい」)。
// 写真は public/samples (Wikimedia Commons。出どころは public/samples/LICENSE.md)。
// 自分で撮った写真と同じ道 (端末で縮めて書き直す → POST /api/clothes) を通るので、サーバーの検査はそのまま。見本も自分の服と同じに消せる。
import { api } from "./client";
import type { Fit } from "./fit";
import { shrinkPhoto } from "./shrink";

/** 見本の型紙の印 (写真に対する割合。src/fit.ts の ANCHORS の並び)。人が写真を見て決めた (#81) */
export const SAMPLES: { kind: string; warmth: number; label: string; file: string; fit: Fit }[] = [
  {
    kind: "top",
    warmth: 3,
    label: "見本 ニット",
    file: "top.jpg",
    fit: {
      v: 1,
      p: [
        [0.209, 0.213],
        [0.806, 0.189],
        [0.153, 0.959],
        [0.821, 0.899],
      ],
    },
  },
  {
    kind: "dress",
    warmth: 2,
    label: "見本 ワンピース",
    file: "dress.jpg",
    fit: {
      v: 1,
      p: [
        [0.27, 0.125],
        [0.75, 0.125],
      ],
    },
  },
  {
    kind: "bottom",
    warmth: 2,
    label: "見本 ジーンズ",
    file: "bottom.jpg",
    fit: {
      v: 1,
      p: [
        [0.289, 0.087],
        [0.653, 0.087],
        [0.272, 0.93],
        [0.662, 0.93],
      ],
    },
  },
  {
    kind: "outer",
    warmth: 4,
    label: "見本 ジャケット",
    file: "outer.jpg",
    fit: {
      v: 1,
      p: [
        [0.31, 0.165],
        [0.825, 0.24],
        [0.15, 0.82],
        [0.86, 0.82],
      ],
    },
  },
  {
    kind: "shoes",
    warmth: 2,
    label: "見本 革ぐつ",
    file: "shoes.jpg",
    fit: {
      v: 1,
      p: [
        [0.092, 0.85],
        [0.5, 0.85],
        [0.56, 0.856],
        [0.943, 0.856],
      ],
    },
  },
  {
    kind: "accessory",
    warmth: 1,
    label: "見本 麦わら帽子",
    file: "accessory.jpg",
    fit: {
      v: 1,
      p: [
        [0.041, 0.587],
        [0.967, 0.587],
      ],
      at: "head",
    },
  },
];

/** 見本を入れる。1 枚入らなくても、ほかは入れて始める (見本がなくても使える)。入れた枚数を返す。 */
export async function addSamples(): Promise<number> {
  let n = 0;
  for (const s of SAMPLES) {
    try {
      const r = await fetch(`/samples/${s.file}`);
      if (!r.ok) continue;
      const photo = await shrinkPhoto(new File([await r.blob()], s.file, { type: "image/jpeg" }));
      if (photo === null) continue;
      await api.addClothing({ kind: s.kind, warmth: s.warmth, label: s.label, photo, fit: s.fit });
      n++;
    } catch {
      // 次の見本へ
    }
  }
  return n;
}
