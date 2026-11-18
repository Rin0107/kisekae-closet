// アバターの台。正面に固定したすらっとした等身の姿 (写真に近い 3D の絵、#22) に、服の写真をそのまま (曲げずに) 重ねる。
// 台の大きさは CSS で固定 (--stage-w・--stage-h)。中身の数で変わらない。
// 顔写真は使わない。回さない (idea.md の「デザイン」)。
import { forwardRef, useState, type SyntheticEvent } from "react";
import { api, type Clothing } from "./client";
import { place, shoeFeet, SLOTS, type Box } from "./outfit";
import { Photo } from "./Photo";

/**
 * 体の絵。CC0 の 3D の人体 (MakeHuman) を Blender で正面から描いたもの (public/avatar/LICENSE.md)。
 * repo の中に置き、外部から読まない。服を置く場所は絵を測った目印に合わせる (outfit.ts の BODY・SLOTS)。
 */
function Body() {
  return <img className="body" src="/avatar/body.webp" alt="" width={200} height={400} draggable={false} />;
}

/** 箱の位置と大きさ (台に対する %)。height が null なら写真の縦横比のまま。 */
function boxStyle(b: Box) {
  return {
    top: `${b.top}%`,
    left: `${b.left}%`,
    width: `${b.width}%`,
    height: b.height === null ? "auto" : `${b.height}%`,
  };
}

/** 読めた写真の 縦 ÷ 横 (読めるまで null)。切り抜きに替わると読み直す。 */
function useRatio(): [number | null, (e: SyntheticEvent<HTMLImageElement>) => void] {
  const [ratio, setRatio] = useState<number | null>(null);
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (w > 0 && h > 0) setRatio(h / w);
  };
  return [ratio, onLoad];
}

/** 服 1 枚。幅で合わせ、縦は写真のまま (曲げない)。ボトムスは丈から幅を決める (#33)。 */
function Worn({ item: c }: { item: Clothing }) {
  const [ratio, onLoad] = useRatio();
  const b = place(c.kind, ratio);
  if (b === null) return null;
  return (
    <Photo
      className={`wear wear-${c.kind}`}
      data-testid="worn"
      data-kind={c.kind}
      src={api.photoUrl(c.id)}
      alt={c.label || "服"}
      draggable={false}
      onLoad={onLoad}
      style={{ ...boxStyle(b), zIndex: SLOTS[c.kind]?.z }}
    />
  );
}

/**
 * くつ (#32)。2 足を並べた写真を左右の半分に切り分け、それぞれの足に履かせる。
 * 写真は曲げない: 片足の箱は半分の写真と同じ縦横比で、中の写真は箱の 2 倍の幅 (左の足は左半分、右の足は右半分が見える)。
 */
function Shoes({ item: c }: { item: Clothing }) {
  const [ratio, onLoad] = useRatio();
  const z = SLOTS.shoes?.z;
  return (
    <>
      {shoeFeet(ratio).map((b, i) => (
        <span
          key={i}
          className="wear-foot"
          data-testid="foot"
          data-foot={i === 0 ? "left" : "right"}
          style={{ ...boxStyle(b), zIndex: z }}
        >
          <Photo
            className="wear wear-shoes"
            data-testid={i === 0 ? "worn" : undefined}
            data-kind={i === 0 ? c.kind : undefined}
            src={api.photoUrl(c.id)}
            // 同じ写真の右半分は読み上げない (1 足として 1 回だけ)
            alt={i === 0 ? c.label || "服" : ""}
            aria-hidden={i === 0 ? undefined : true}
            draggable={false}
            onLoad={i === 0 ? onLoad : undefined}
            style={{ top: 0, left: i === 0 ? 0 : "-100%", width: "200%", height: "100%" }}
          />
        </span>
      ))}
    </>
  );
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
      {worn.map((c) => (c.kind === "shoes" ? <Shoes key={c.id} item={c} /> : <Worn key={c.id} item={c} />))}
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
