// アバターの台。正面に固定したすらっとした等身の姿に、服の写真をそのまま (曲げずに) 重ねる。
// 台の大きさは CSS で固定 (--stage-w・--stage-h)。中身の数で変わらない。
// 顔写真は使わない。回さない (idea.md の「デザイン」)。
import { forwardRef } from "react";
import { api, type Clothing } from "./client";
import { SLOTS } from "./outfit";
import { Photo } from "./Photo";

/** 体の絵 (repo の中の SVG。外部から読まない)。 */
function Body() {
  return (
    <svg className="body" viewBox="0 0 200 400" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="skin" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#e9b9a0" />
          <stop offset="0.45" stopColor="#f8d9c6" />
          <stop offset="1" stopColor="#e2ad93" />
        </linearGradient>
        <linearGradient id="base" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#e7e1e4" />
          <stop offset="0.5" stopColor="#fbf8f9" />
          <stop offset="1" stopColor="#ded6da" />
        </linearGradient>
        <radialGradient id="hair" cx="0.5" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#5b4038" />
          <stop offset="1" stopColor="#2f201c" />
        </radialGradient>
        <radialGradient id="floor" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.18" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="378" rx="46" ry="8" fill="url(#floor)" />
      {/* 腕 */}
      <path d="M72 82 Q60 86 58 112 L54 162 L52 200 Q55 212 61 205 L65 162 L71 118 Z" fill="url(#skin)" />
      <path
        d="M128 82 Q140 86 142 112 L146 162 L148 200 Q145 212 139 205 L135 162 L129 118 Z"
        fill="url(#skin)"
      />
      {/* 脚 */}
      <path d="M78 188 L99 188 L97 280 L95 362 L85 364 L83 280 Z" fill="url(#skin)" />
      <path d="M101 188 L122 188 L117 280 L115 364 L105 362 L103 280 Z" fill="url(#skin)" />
      <ellipse cx="89" cy="368" rx="9" ry="5" fill="#d9a58c" />
      <ellipse cx="111" cy="368" rx="9" ry="5" fill="#d9a58c" />
      {/* 首と胴 */}
      <rect x="93" y="58" width="14" height="18" rx="5" fill="url(#skin)" />
      <path
        d="M70 80 Q100 70 130 80 L127 120 Q120 148 118 160 L124 194 L76 194 L82 160 Q80 148 73 120 Z"
        fill="url(#skin)"
      />
      {/* 下着の層 (服がないときも落ち着いて見えるように) */}
      <path d="M80 92 Q100 86 120 92 L118 150 L82 150 Z" fill="url(#base)" />
      <path d="M78 168 L122 168 L124 200 L101 204 L99 204 L76 200 Z" fill="url(#base)" />
      {/* 頭 */}
      <ellipse cx="100" cy="40" rx="17" ry="21" fill="url(#skin)" />
      <path d="M82 40 Q80 14 100 14 Q121 14 118 40 Q116 26 100 24 Q86 26 82 40 Z" fill="url(#hair)" />
      <path d="M82 38 Q78 62 84 74 L88 52 Z" fill="url(#hair)" />
      <path d="M118 38 Q122 62 116 74 L112 52 Z" fill="url(#hair)" />
    </svg>
  );
}

export interface StageProps {
  worn: Clothing[];
  /** 増えるたびにキラッと光る (0 なら光らない)。 */
  sparkle?: number;
  caption?: string;
}

/** アバターの台。ref は、ドラッグした服を落とす先の判定に使う。 */
export const Stage = forwardRef<HTMLElement, StageProps>(function Stage(
  { worn, sparkle = 0, caption = "着ている服" },
  ref,
) {
  const names = worn.map((c) => c.label || "服").join("・");
  return (
    <figure className="stage" ref={ref} data-testid="stage" aria-label={`${caption}: ${names || "なし"}`}>
      <Body />
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
              height: `${s.height}%`,
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
