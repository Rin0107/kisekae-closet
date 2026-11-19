// アバターの台。正面に固定したすらっとした等身の姿 (写真に近い 3D の絵、#22) に、服の写真をそのまま (曲げずに) 重ねる。
// 台の大きさは CSS で固定 (--stage-w・--stage-h)。中身の数で変わらない。
// 顔写真は使わない。体は回さない (idea.md の「デザイン」)。服の袖は切り分けて腕の向きに置く (#37)。
import { forwardRef, useState, type SyntheticEvent } from "react";
import { api, type Clothing } from "./client";
import { measureSleeve, pieceTransform, pieces, place, shoeFeet, SLOTS, STAGE_RATIO, type Box, type Sleeve } from "./outfit";
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

/** 袖を切り分けて腕に沿わせる種類 (#37)。ワンピースは袖なしが多く、裾まで袖の帯に入るので、そのまま。 */
const SLEEVED = new Set(["top", "outer"]);

/** 測る絵の大きさの上限 (px)。小さく描いて画素を読む。 */
const MEASURE_SIDE = 96;

/** 読めた写真の、左右の袖の形 (#37)。読めない (canvas がない・読めない) なら null。 */
function sleevesOf(img: HTMLImageElement): [Sleeve | null, Sleeve | null] | null {
  const { naturalWidth: nw, naturalHeight: nh } = img;
  if (nw <= 0 || nh <= 0) return null;
  const k = Math.min(1, MEASURE_SIDE / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * k));
  const h = Math.max(1, Math.round(nh * k));
  try {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d");
    if (g === null) return null;
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const a = (x: number, y: number) => (px[(y * w + x) * 4 + 3] ?? 0) > 128;
    return [measureSleeve(a, w, h), measureSleeve((x, y) => a(w - 1 - x, y), w, h)];
  } catch {
    return null;
  }
}

/** 服 1 枚。幅で合わせ、縦は写真のまま (曲げない)。ボトムスは丈から幅を決める (#33)。 */
function Worn({ item: c, open = false }: { item: Clothing; open?: boolean }) {
  const [ratio, onRatio] = useRatio();
  const [sleeves, setSleeves] = useState<[Sleeve | null, Sleeve | null] | null>(null);
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    onRatio(e);
    if (SLEEVED.has(c.kind)) setSleeves(sleevesOf(e.currentTarget));
  };
  const b = place(c.kind, ratio);
  if (b === null) return null;
  if (SLEEVED.has(c.kind) && ratio !== null) {
    // 左の袖・身ごろ (アウターで前を開けるなら左右 2 つ)・右の袖に切り分ける。写真は曲げない (#37 #38)
    const box = { top: b.top, left: b.left, width: b.width, height: b.width * STAGE_RATIO * ratio };
    const ps = pieces(box, sleeves?.[0] ?? null, sleeves?.[1] ?? null, open && c.kind === "outer");
    const main = 1; // 身ごろ (左) の片に名前と testid を付ける (読み上げは 1 回だけ)
    // 袖を先に (下に) 描く: 身ごろの縁と袖の付け根が重なっても、身ごろが上に見える (#44)
    const order = ps
      .map((p, i) => ({ p, i }))
      .sort((a, b) => Number(a.p.turn === 0) - Number(b.p.turn === 0));
    // 影は服 1 枚分の入れ物に付ける (片ごとに付けると、継ぎ目に縦の線が出る、#47)
    return (
      <span className="wear-cut" data-testid="wear-cut" style={{ zIndex: SLOTS[c.kind]?.z }}>
        {order.map(({ p, i }) => (
          <span
            key={i}
            className="wear-piece"
            data-testid="piece"
            data-kind={c.kind}
            data-turn={p.turn}
            style={{
              ...boxStyle(p.box),
              zIndex: SLOTS[c.kind]?.z,
              transform: pieceTransform(p),
              transformOrigin: `${p.origin.x}% ${p.origin.y}%`,
            }}
          >
            <Photo
              className={`wear wear-${c.kind}`}
              data-testid={i === main ? "worn" : undefined}
              data-kind={i === main ? c.kind : undefined}
              src={api.photoUrl(c.id)}
              alt={i === main ? c.label || "服" : ""}
              aria-hidden={i === main ? undefined : true}
              draggable={false}
              onLoad={i === main ? onLoad : undefined}
              style={{
                top: 0,
                left: `${(-p.from / (p.to - p.from)) * 100}%`,
                width: `${100 / (p.to - p.from)}%`,
                height: "100%",
              }}
            />
          </span>
        ))}
      </span>
    );
  }
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
  // 中にトップスかワンピースを着ていれば、アウターの前を開ける (#38)。何もなければ閉じて下着を見せない
  const inner = worn.some((c) => c.kind === "top" || c.kind === "dress");
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
      {worn.map((c) =>
        c.kind === "shoes" ? <Shoes key={c.id} item={c} /> : <Worn key={c.id} item={c} open={inner} />,
      )}
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
