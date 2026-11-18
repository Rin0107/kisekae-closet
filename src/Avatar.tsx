// アバターの台。正面に固定したすらっとした等身の姿 (写真に近い 3D の絵、#22) に、服の写真をそのまま (曲げずに) 重ねる。
// 台の大きさは CSS で固定 (--stage-w・--stage-h)。中身の数で変わらない。
// 顔写真は使わない。回さない (idea.md の「デザイン」)。
import { forwardRef } from "react";
import { api, type Clothing } from "./client";
import { SLOTS } from "./outfit";
import { Photo } from "./Photo";

/**
 * 体の絵。CC0 の 3D の人体 (MakeHuman) を Blender で正面から描いたもの (public/avatar/LICENSE.md)。
 * repo の中に置き、外部から読まない。服を置く場所は絵を測った目印に合わせる (outfit.ts の BODY・SLOTS)。
 */
function Body() {
  return <img className="body" src="/avatar/body.webp" alt="" width={200} height={400} draggable={false} />;
}

export interface StageProps {
  worn: Clothing[];
  /** 増えるたびにキラッと光る (0 なら光らない)。 */
  sparkle?: number;
  caption?: string;
  /** 服の一覧が届くまで (#28): 下着姿を見せず、服の場所に淡い形を出す。 */
  pending?: boolean;
}

/** アバターの台。ref は、ドラッグした服を落とす先の判定に使う。 */
export const Stage = forwardRef<HTMLElement, StageProps>(function Stage(
  { worn, sparkle = 0, caption = "着ている服", pending = false },
  ref,
) {
  const names = worn.map((c) => c.label || "服").join("・");
  return (
    <figure
      className="stage"
      ref={ref}
      data-testid="stage"
      aria-label={pending ? `${caption}: 読み込み中` : `${caption}: ${names || "なし"}`}
      aria-busy={pending || undefined}
    >
      <Body />
      {pending && <span className="wear-pending" data-testid="wear-pending" aria-hidden="true" />}
      {worn.map((c) => {
        const s = SLOTS[c.kind];
        if (s === undefined) return null;
        return (
          <Photo
            key={c.id}
            className={`wear wear-${c.kind}`}
            data-testid="worn"
            data-kind={c.kind}
            src={api.photoUrl(c.id)}
            alt={c.label || "服"}
            draggable={false}
            style={{
              top: `${s.top}%`,
              left: `${s.left}%`,
              width: `${s.width}%`,
              // 幅で合わせ、縦は写真のまま (曲げない)。箱に収めるのはくつ・こものだけ
              height: s.fit === "box" ? `${s.height}%` : "auto",
              zIndex: s.z,
            }}
          />
        );
      })}
      {sparkle > 0 && (
        <span key={sparkle} className="sparkle" data-testid="sparkle" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </figure>
  );
});
