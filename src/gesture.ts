// 指で直す (#83、docs/spec-v2-fitting.md §6.1) の決まり (純粋な関数)。画面は EditStage.tsx。
// 1 本指でずらす・2 本指でつまんで大きさ・ひねって傾ける。服の直し (Adj) はコーデの中の服ごと、
// マネキンの直し (Pose) はコーデごとに覚える。
import { apply, invert, NO_POSE, STAGE, type Adj, type Dressed, type Mat, type Pose, type Pt } from "./fit";

/** 範囲 (服: 倍率 0.7〜1.4・角度 ±30°、マネキン: 倍率 0.85〜1.15・角度 ±10°、ずらすのは ±50cm)。サーバーの検査と同じ */
export const ADJ_LIMITS = { scale: [0.7, 1.4], rot: 30, move: 50 } as const;
export const POSE_LIMITS = { scale: [0.85, 1.15], rot: 10, move: 50, limb: 90 } as const;
export const NO_ADJ: Adj = [0, 0, 1, 0];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function clampAdj(a: Adj): Adj {
  return [
    round(clamp(a[0], -ADJ_LIMITS.move, ADJ_LIMITS.move), 2),
    round(clamp(a[1], -ADJ_LIMITS.move, ADJ_LIMITS.move), 2),
    round(clamp(a[2], ADJ_LIMITS.scale[0], ADJ_LIMITS.scale[1]), 3),
    round(clamp(a[3], -ADJ_LIMITS.rot, ADJ_LIMITS.rot), 2),
  ];
}

export function clampPose(p: Pose): Pose {
  const limb = (v: number | null) =>
    v === null ? null : round(clamp(v, -POSE_LIMITS.limb, POSE_LIMITS.limb), 2);
  return {
    s: round(clamp(p.s, POSE_LIMITS.scale[0], POSE_LIMITS.scale[1]), 3),
    r: round(clamp(p.r, -POSE_LIMITS.rot, POSE_LIMITS.rot), 2),
    dx: round(clamp(p.dx, -POSE_LIMITS.move, POSE_LIMITS.move), 2),
    dy: round(clamp(p.dy, -POSE_LIMITS.move, POSE_LIMITS.move), 2),
    arm: [limb(p.arm[0]), limb(p.arm[1])],
    leg: [limb(p.leg[0]), limb(p.leg[1])],
  };
}

/** 2 本の指が a0・b0 から a1・b1 へ動いたときの、倍率・角度 (度、時計回り)・真ん中のずれ。指を入れかえても同じ */
export function twoFinger(
  a0: Pt,
  b0: Pt,
  a1: Pt,
  b1: Pt,
): { scale: number; rot: number; dx: number; dy: number } {
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
  const t0 = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
  const t1 = Math.atan2(b1[1] - a1[1], b1[0] - a1[0]);
  let rot = ((t1 - t0) * 180) / Math.PI;
  rot = ((((rot + 180) % 360) + 360) % 360) - 180;
  return {
    scale: d0 < 1e-6 ? 1 : d1 / d0,
    rot,
    dx: (a1[0] + b1[0] - a0[0] - b0[0]) / 2,
    dy: (a1[1] + b1[1] - a0[1] - b0[1]) / 2,
  };
}

/** 動き (cm) を、始めの直しに足す。 */
export function moveAdj(start: Adj, g: { scale: number; rot: number; dx: number; dy: number }): Adj {
  return clampAdj([start[0] + g.dx, start[1] + g.dy, start[2] * g.scale, start[3] + g.rot]);
}

export function movePose(start: Pose, g: { scale: number; rot: number; dx: number; dy: number }): Pose {
  return clampPose({
    ...start,
    s: start.s * g.scale,
    r: start.r + g.rot,
    dx: start.dx + g.dx,
    dy: start.dy + g.dy,
  });
}

/** ボタンで少しずつ (読み上げ・キーボード用)。 */
export type Nudge = "left" | "right" | "up" | "down" | "bigger" | "smaller" | "tiltLeft" | "tiltRight";
export const NUDGE_NAMES: Record<Nudge, string> = {
  left: "左へ",
  right: "右へ",
  up: "上へ",
  down: "下へ",
  bigger: "大きく",
  smaller: "小さく",
  tiltLeft: "左に傾ける",
  tiltRight: "右に傾ける",
};
export function nudge(n: Nudge): { scale: number; rot: number; dx: number; dy: number } {
  const g = { scale: 1, rot: 0, dx: 0, dy: 0 };
  if (n === "left") g.dx = -1;
  if (n === "right") g.dx = 1;
  if (n === "up") g.dy = -1;
  if (n === "down") g.dy = 1;
  if (n === "bigger") g.scale = 1.03;
  if (n === "smaller") g.scale = 1 / 1.03;
  if (n === "tiltLeft") g.rot = -2;
  if (n === "tiltRight") g.rot = 2;
  return g;
}

/** 台の画素 (左上が 0、幅 w・高さ h) を台の cm に。 */
export function toCm(x: number, y: number, w: number, h: number): Pt {
  return [(x / w) * STAGE.w - STAGE.w / 2, (y / h) * STAGE.h];
}

/** 写真の形 (縮めたもの)。服の画素が 1 */
export interface Shape {
  w: number;
  h: number;
  data: Uint8Array;
}

/**
 * 指の点 p (cm) の下にある服を、上に重なっているものから探す。透明なところ (服の外) は通して下を探す。
 * 形の分からない服は、写真の四角で当てる。何もなければ null。
 */
export function hit(d: Dressed, shapes: ReadonlyMap<string, Shape | null>, p: Pt): string | null {
  for (let i = d.placed.length - 1; i >= 0; i--) {
    const pl = d.placed[i] as Dressed["placed"][number];
    const q = apply(invert(pl.m as Mat), p);
    if (q[0] < 0 || q[1] < 0 || q[0] >= pl.w || q[1] >= pl.h) continue;
    if (pl.split !== undefined && (pl.half === "left" ? q[0] >= pl.split : q[0] < pl.split)) continue;
    const s = shapes.get(pl.id) ?? null;
    if (s === null) return pl.id;
    const x = Math.min(s.w - 1, Math.floor((q[0] / pl.w) * s.w));
    const y = Math.min(s.h - 1, Math.floor((q[1] / pl.h) * s.h));
    if (s.data[y * s.w + x] === 1) return pl.id;
  }
  return null;
}

/** 重なった服のうち、id の 1 つ下 (一番下なら一番上に戻る)。 */
export function below(d: Dressed, id: string): string | null {
  const ids = [...new Set(d.placed.map((p) => p.id))].reverse();
  if (ids.length === 0) return null;
  const i = ids.indexOf(id);
  return ids[(i + 1) % ids.length] as string;
}

/** 手首・足首のつまみの位置 (台の cm)。腕・脚は [左, 右]。 */
export function limbTips(d: Dressed): { arm: [Pt, Pt]; leg: [Pt, Pt] } {
  const at = (p: Pt) => apply(d.pose, p);
  return { arm: [at(d.arms[0].to), at(d.arms[1].to)], leg: [at(d.legs[0].to), at(d.legs[1].to)] };
}

/** つまみを点 p (台の cm) へ動かしたときの、腕・脚の角度 (真下が 0、外へ正)。 */
export function limbAngle(d: Dressed, which: "arm" | "leg", side: 0 | 1, p: Pt): number {
  const q = apply(invert(d.pose), p);
  const from = (which === "arm" ? d.arms : d.legs)[side].from;
  const sign = side === 0 ? -1 : 1;
  return round((Math.atan2(sign * (q[0] - from[0]), q[1] - from[1]) * 180) / Math.PI, 2);
}

export { NO_POSE };
