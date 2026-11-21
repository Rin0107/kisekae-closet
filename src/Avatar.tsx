// アバターの台 (着せ替え v2、docs/spec-v2-fitting.md)。顔も髪もない、のっぺりしたマネキンの平らな絵 (SVG) に、
// 切り抜いた服の写真を「印 2 点を体の 2 点に重ねる相似変換」だけで重ねる (曲げない・切らない)。
// マネキンのほうが服に合わせる: 腕は一番外の服の袖口へ、脚はボトムスの裾へ向く (src/fit.ts の dress)。
// 台の大きさは CSS で固定 (--stage-w・--stage-h)。中は cm の世界 (viewBox が STAGE)。
import { forwardRef, useEffect, useId, useMemo, useState } from "react";
import { api, type Clothing } from "./client";
import { cutoutInfo, type Cut } from "./cutout";
import {
  body as makeBody,
  cropFit,
  DEFAULT_FIT,
  dress,
  guessFit,
  OPEN_GAP,
  STAGE,
  type Adj,
  type Body,
  type Dressed,
  type Fit,
  type Limb,
  type Mat,
  type Piece,
  type Placed,
  type Pose,
  type Pt,
} from "./fit";

/** 写真の大きさが分からない (切り抜けない端末) ときの仮の大きさ。 */
const UNKNOWN_SIDE = 100;

/** 着た服の切り抜き (届いたものから)。 */
export function useCuts(worn: Clothing[]): ReadonlyMap<string, Cut> {
  const [cuts, setCuts] = useState<ReadonlyMap<string, Cut>>(new Map());
  const key = worn.map((c) => c.id).join(",");
  useEffect(() => {
    let live = true;
    for (const id of key.split(",").filter(Boolean)) {
      void cutoutInfo(api.photoUrl(id)).then((c) => {
        if (live) setCuts((m) => (m.get(id) === c ? m : new Map(m).set(id, c)));
      });
    }
    return () => {
      live = false;
    };
  }, [key]);
  return cuts;
}

/** 切り抜いた写真の上の印。保存した印があればそれを、なければ形から推し量る。 */
export function pieceOf(c: Clothing, cut: Cut): Piece {
  const w = cut.box?.w ?? cut.full?.w ?? UNKNOWN_SIDE;
  const h = cut.box?.h ?? cut.full?.h ?? UNKNOWN_SIDE;
  const saved = c.fit ?? null;
  let fit: Fit;
  if (saved !== null && cut.full !== null && cut.box !== null)
    fit = cropFit(saved, cut.full.w, cut.full.h, cut.box);
  else if (saved !== null) fit = saved;
  else if (cut.mask !== null) {
    const m = cut.mask;
    fit = guessFit(c.kind, (x, y) => m.data[y * m.w + x] === 1, m.w, m.h);
  } else fit = DEFAULT_FIT[c.kind] ?? (DEFAULT_FIT.top as Fit);
  return { id: c.id, kind: c.kind, w, h, fit };
}

const matrix = (m: Mat) => `matrix(${m.map((v) => Math.round(v * 1e5) / 1e5).join(" ")})`;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** なめらかな閉じた形 (点を通る曲線)。 */
function smooth(pts: Pt[]): string {
  const n = pts.length;
  const at = (i: number) => pts[(i + n) % n] as Pt;
  let d = `M${r2(at(0)[0])} ${r2(at(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${r2(p2[0])} ${r2(p2[1])}`;
  }
  return `${d} Z`;
}

/** 付け根の幅 w0 から先の幅 w1 へ細くなる、角の丸い棒。 */
function taper(l: Limb, w0: number, w1: number, extra = 0): string {
  const dx = l.to[0] - l.from[0];
  const dy = l.to[1] - l.from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const end: Pt = [l.to[0] + ux * extra, l.to[1] + uy * extra];
  const nx = -uy;
  const ny = ux;
  const pts: Pt[] = [
    [l.from[0] + (nx * w0) / 2, l.from[1] + (ny * w0) / 2],
    [end[0] + (nx * w1) / 2, end[1] + (ny * w1) / 2],
    [end[0] - (nx * w1) / 2, end[1] - (ny * w1) / 2],
    [l.from[0] - (nx * w0) / 2, l.from[1] - (ny * w0) / 2],
  ];
  return `M${pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join(" L")} Z`;
}

/** 棒の途中 (t: 0〜1) を横切る継ぎ目の細い線。 */
function seam(l: Limb, t: number, w: number): string {
  const dx = l.to[0] - l.from[0];
  const dy = l.to[1] - l.from[1];
  const len = Math.hypot(dx, dy) || 1;
  const c: Pt = [l.from[0] + dx * t, l.from[1] + dy * t];
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  return `M${r2(c[0] + nx)} ${r2(c[1] + ny)} L${r2(c[0] - nx)} ${r2(c[1] - ny)}`;
}

/** 手・足の先 (棒の先に付く、丸い形)。 */
function tip(
  l: Limb,
  len: number,
  w: number,
): { cx: number; cy: number; rx: number; ry: number; rot: number } {
  const dx = l.to[0] - l.from[0];
  const dy = l.to[1] - l.from[1];
  const n = Math.hypot(dx, dy) || 1;
  return {
    cx: r2(l.to[0] + (dx / n) * (len / 2)),
    cy: r2(l.to[1] + (dy / n) * (len / 2)),
    rx: r2(w / 2),
    ry: r2(len / 2),
    rot: r2((Math.atan2(-dx, dy) * 180) / Math.PI),
  };
}

/** マネキン。顔・髪・指・陰影は描かない (1 色の面と、継ぎ目の細い線だけ)。 */
export function Mannequin({ d }: { d: Dressed }) {
  const b: Body = d.body;
  const torso = smooth([
    [-b.neckW / 2, b.chin - 1],
    [-b.neckW / 2, b.shoulderY - 1.5],
    [-b.shoulder * 0.93, b.shoulderY + 0.5],
    [-b.chest[1], b.chest[0]],
    [-b.waist[1], b.waist[0]],
    [-b.hip[1], b.hip[0]],
    [-b.hip[1] * 0.75, b.crotch],
    [0, b.crotch + 1],
    [b.hip[1] * 0.75, b.crotch],
    [b.hip[1], b.hip[0]],
    [b.waist[1], b.waist[0]],
    [b.chest[1], b.chest[0]],
    [b.shoulder * 0.93, b.shoulderY + 0.5],
    [b.neckW / 2, b.shoulderY - 1.5],
    [b.neckW / 2, b.chin - 1],
  ]);
  const headH = b.chin - b.headTop;
  return (
    <g className="mannequin" data-testid="mannequin" transform={matrix(d.pose)}>
      {d.legs.map((l, i) => {
        const f = tip(l, b.footLen + 1.5, b.footW * 0.7);
        return (
          <g key={`leg${i}`} data-testid="leg" data-angle={r2(l.angle)}>
            <path className="m-fill" d={taper(l, b.hip[1] * 0.85, 5)} />
            <ellipse
              className="m-fill"
              cx={f.cx}
              cy={f.cy}
              rx={f.rx}
              ry={f.ry}
              transform={`rotate(${f.rot} ${f.cx} ${f.cy})`}
            />
            <path className="m-seam" d={seam(l, 0.52, 9)} />
            <path className="m-seam" d={seam(l, 1, 5)} />
          </g>
        );
      })}
      {d.arms.map((l, i) => {
        const h = tip(l, b.handLen * 0.9, 4.6);
        return (
          <g key={`arm${i}`} data-testid="arm" data-angle={r2(l.angle)}>
            <path className="m-fill" d={taper(l, 7.4, 4)} />
            <ellipse
              className="m-fill"
              cx={h.cx}
              cy={h.cy}
              rx={h.rx}
              ry={h.ry}
              transform={`rotate(${h.rot} ${h.cx} ${h.cy})`}
            />
            <path className="m-seam" d={seam(l, 0.54, 6)} />
            <path className="m-seam" d={seam(l, 1, 4)} />
          </g>
        );
      })}
      <path className="m-fill" d={torso} />
      <path
        className="m-seam"
        d={`M${r2(-b.neckW / 2)} ${r2(b.chin + 2)} Q0 ${r2(b.chin + 4)} ${r2(b.neckW / 2)} ${r2(b.chin + 2)}`}
      />
      <path
        className="m-seam"
        d={`M${r2(-b.waist[1])} ${r2(b.waist[0])} Q0 ${r2(b.waist[0] + 1.5)} ${r2(b.waist[1])} ${r2(b.waist[0])}`}
      />
      <ellipse
        className="m-fill"
        cx={0}
        cy={r2(b.headTop + headH / 2)}
        rx={r2(b.headW / 2)}
        ry={r2(headH / 2)}
      />
    </g>
  );
}

/** 服 1 枚 (くつは片足ぶん)。写真は曲げず、相似変換だけで置く。 */
function Garment({ p, c, url, first }: { p: Placed; c: Clothing; url: string; first: boolean }) {
  const id = useId().replace(/:/g, "");
  const img = (
    <image
      href={url}
      width={p.w}
      height={p.h}
      preserveAspectRatio="none"
      transform={matrix(p.m)}
      clipPath={p.half === undefined ? undefined : `url(#${id}h)`}
      className={`wear wear-${c.kind}`}
      data-testid={first ? "worn" : undefined}
      data-kind={first ? c.kind : undefined}
      data-label={first ? c.label || "服" : undefined}
      data-foot={p.half}
    />
  );
  const clip = p.clipBelow !== undefined || p.open !== undefined;
  return (
    <g className="wear-g" data-testid={p.half === undefined ? undefined : "foot"} data-foot={p.half}>
      <defs>
        {p.half !== undefined && p.split !== undefined && (
          <clipPath id={`${id}h`} clipPathUnits="userSpaceOnUse">
            {p.half === "left" ? (
              <rect x={0} y={0} width={p.split} height={p.h} />
            ) : (
              <rect x={p.split} y={0} width={p.w - p.split} height={p.h} />
            )}
          </clipPath>
        )}
        {clip && (
          <clipPath id={`${id}c`} clipPathUnits="userSpaceOnUse">
            {p.open === undefined ? (
              <rect x={-STAGE.w} y={0} width={STAGE.w * 2} height={p.clipBelow} />
            ) : (
              <>
                <rect x={-STAGE.w} y={0} width={STAGE.w * 2} height={p.open.below} />
                <rect x={-STAGE.w} y={0} width={STAGE.w + p.open.x - OPEN_GAP} height={STAGE.h} />
                <rect x={p.open.x + OPEN_GAP} y={0} width={STAGE.w} height={STAGE.h} />
              </>
            )}
          </clipPath>
        )}
      </defs>
      {clip ? (
        <g
          clipPath={`url(#${id}c)`}
          data-testid={p.open !== undefined ? "open" : p.kind === "top" ? "tucked" : "hemmed"}
        >
          {img}
        </g>
      ) : (
        img
      )}
    </g>
  );
}

export interface StageProps {
  worn: Clothing[];
  /** 増えるたびにキラッと光る (0 なら光らない)。 */
  sparkle?: number;
  caption?: string;
  /** 服の一覧が届くまで (#28): 服の場所に淡い形を出す。 */
  pending?: boolean;
  /** 服ごとの指の直し・マネキンの指の直し (#83) */
  adj?: Record<string, Adj>;
  pose?: Pose;
  tuck?: boolean;
  body?: Body;
}

/** アバターの台。ref は、ドラッグした服を落とす先の判定に使う。 */
export const Stage = forwardRef<HTMLElement, StageProps>(function Stage(
  { worn, sparkle = 0, caption = "着ている服", pending = false, adj, pose, tuck, body },
  ref,
) {
  const cuts = useCuts(worn);
  const b = useMemo(() => body ?? makeBody(), [body]);
  const pieces = worn.flatMap((c) => {
    const cut = cuts.get(c.id);
    return cut === undefined ? [] : [pieceOf(c, cut)];
  });
  const d = dress(pieces, { body: b, adj, pose, tuck });
  const byId = new Map(worn.map((c) => [c.id, c]));
  const names = worn.map((c) => c.label || "服").join("・");
  return (
    <figure
      className="stage"
      ref={ref}
      data-testid="stage"
      aria-label={pending ? `${caption}: 読み込み中` : `${caption}: ${names || "なし"}`}
      aria-busy={pending || undefined}
    >
      <svg viewBox={`${-STAGE.w / 2} 0 ${STAGE.w} ${STAGE.h}`} aria-hidden="true" className="stage-svg">
        <Mannequin d={d} />
        {d.placed.map((p, i) => {
          const c = byId.get(p.id) as Clothing;
          const first = d.placed.findIndex((q) => q.id === p.id) === i;
          return (
            <Garment
              key={`${p.id}${p.half ?? ""}`}
              p={p}
              c={c}
              url={(cuts.get(p.id) as Cut).url}
              first={first}
            />
          );
        })}
      </svg>
      {pending && <span className="wear-pending" data-testid="wear-pending" aria-hidden="true" />}
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
