// 見本の服: クローゼットが空なら、6 種類を 1 枚ずつ入れておく (持ち主 2026-11-21「服を入れるのめんどくさい」、#79)。
// 空の棚からは、その種類の見本だけを入れ直せる。
// 写真は public/samples (Wikimedia Commons。出どころは public/samples/LICENSE.md)。
// 自分で撮った写真と同じ道 (端末で縮めて書き直す → POST /api/clothes) を通るので、サーバーの検査はそのまま。見本も自分の服と同じに消せる。
import { api } from "./client";
import { shrinkPhoto } from "./shrink";

export const SAMPLES: { kind: string; warmth: number; label: string; file: string }[] = [
  { kind: "top", warmth: 3, label: "見本 ニット", file: "top.jpg" },
  { kind: "dress", warmth: 2, label: "見本 ワンピース", file: "dress.jpg" },
  { kind: "bottom", warmth: 2, label: "見本 ジーンズ", file: "bottom.jpg" },
  { kind: "outer", warmth: 4, label: "見本 ジャケット", file: "outer.jpg" },
  { kind: "shoes", warmth: 2, label: "見本 革ぐつ", file: "shoes.jpg" },
  { kind: "accessory", warmth: 1, label: "見本 麦わら帽子", file: "accessory.jpg" },
];

/** 見本を入れる (kinds を渡せばその種類だけ)。1 枚入らなくても、ほかは入れる (見本がなくても使える)。入れた枚数を返す。 */
export async function addSamples(kinds?: readonly string[]): Promise<number> {
  let n = 0;
  for (const s of SAMPLES) {
    if (kinds !== undefined && !kinds.includes(s.kind)) continue;
    try {
      const r = await fetch(`/samples/${s.file}`);
      if (!r.ok) continue;
      const photo = await shrinkPhoto(new File([await r.blob()], s.file, { type: "image/jpeg" }));
      if (photo === null) continue;
      await api.addClothing({ kind: s.kind, warmth: s.warmth, label: s.label, photo });
      n++;
    } catch {
      // 次の見本へ
    }
  }
  return n;
}
