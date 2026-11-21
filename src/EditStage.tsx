// 指で直す (#83、docs/spec-v2-fitting.md §6.1)。台をタップすると全画面の「直す」モードになる。
// 服もマネキンも、1 本指でずらす・2 本指でつまんで大きさ・ひねって傾ける。マネキンを選ぶと手首・足首のつまみで腕・脚の角度。
// 直しはコーデごと (保存は「これに決めた」のとき、App.tsx)。
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Stage, useDressed } from "./Avatar";
import type { Clothing } from "./client";
import { apply, NO_POSE, type Adj, type Body, type Pose, type Pt } from "./fit";
import {
  below,
  clampPose,
  hit,
  limbAngle,
  limbTips,
  moveAdj,
  movePose,
  NO_ADJ,
  nudge,
  NUDGE_NAMES,
  toCm,
  twoFinger,
  type Nudge,
  type Shape,
} from "./gesture";

export const MANNEQUIN = "mannequin";
/** 手首・足首のつまみに届く距離 (cm)。 */
const TIP_REACH = 7;

type Grab =
  | { kind: "move"; target: string; adj: Adj; pose: Pose; at: Map<number, Pt>; moved: boolean }
  | { kind: "limb"; which: "arm" | "leg"; side: 0 | 1 };

export interface EditStageProps {
  worn: Clothing[];
  adj: Record<string, Adj>;
  pose: Pose;
  tuck: boolean;
  body: Body;
  onChange: (adj: Record<string, Adj>, pose: Pose) => void;
  onClose: () => void;
}

/** 画面に収まる大きな台 (縦横比 1:2)。 */
function bigSize(): { w: number; h: number } {
  const h = Math.max(400, Math.min(window.innerHeight - 260, 2 * (window.innerWidth - 32)));
  return { w: Math.round(h / 2), h: Math.round(h) };
}

export function EditStage({ worn, adj, pose, tuck, body, onChange, onClose }: EditStageProps) {
  const { d, cuts } = useDressed(worn, { adj, pose, tuck, body });
  const [sel, setSel] = useState<string | null>(null);
  const [size] = useState(bigSize);
  const grab = useRef<Grab | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const layer = useRef<HTMLDivElement>(null);

  // iPhone の Safari: 2 本指でページが拡大しないように
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
    };
  }, []);

  const shapes = new Map<string, Shape | null>(worn.map((c) => [c.id, cuts.get(c.id)?.mask ?? null]));
  const cm = (e: PointerEvent<HTMLElement>): Pt => {
    const r = (layer.current as HTMLDivElement).getBoundingClientRect();
    return toCm(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  };
  const adjOf = (id: string) => adj[id] ?? NO_ADJ;
  const apply2 = (target: string, start: { adj: Adj; pose: Pose }, g: Parameters<typeof moveAdj>[1]) => {
    if (target === MANNEQUIN) onChange(adj, movePose(start.pose, g));
    else onChange({ ...adj, [target]: moveAdj(start.adj, g) }, pose);
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = cm(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      // マネキンを選んでいれば、手首・足首のつまみを先に探す
      if (sel === MANNEQUIN) {
        const tips = limbTips(d);
        for (const which of ["arm", "leg"] as const)
          for (const side of [0, 1] as const) {
            const t = tips[which][side];
            if (Math.hypot(t[0] - p[0], t[1] - p[1]) <= TIP_REACH) {
              grab.current = { kind: "limb", which, side };
              return;
            }
          }
      }
      const target = sel ?? hit(d, shapes, p) ?? MANNEQUIN;
      grab.current = {
        kind: "move",
        target,
        adj: adjOf(target),
        pose,
        at: new Map(pointers.current),
        moved: false,
      };
    } else if (grab.current?.kind === "move") {
      // 2 本目の指: そこから倍率と角度を測る
      grab.current = {
        ...grab.current,
        adj: adjOf(grab.current.target),
        pose,
        at: new Map(pointers.current),
      };
    }
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = cm(e);
    pointers.current.set(e.pointerId, p);
    const g = grab.current;
    if (g === null) return;
    if (g.kind === "limb") {
      const a = limbAngle(d, g.which, g.side, p);
      const next = { ...pose, [g.which]: g.side === 0 ? [a, pose[g.which][1]] : [pose[g.which][0], a] };
      onChange(adj, clampPose(next as Pose));
      return;
    }
    const ids = [...g.at.keys()].filter((id) => pointers.current.has(id));
    if (ids.length >= 2) {
      const [i, j] = ids as [number, number];
      const t = twoFinger(
        g.at.get(i) as Pt,
        g.at.get(j) as Pt,
        pointers.current.get(i) as Pt,
        pointers.current.get(j) as Pt,
      );
      g.moved = true;
      apply2(g.target, g, t);
    } else if (ids.length === 1) {
      const id = ids[0] as number;
      const a = g.at.get(id) as Pt;
      const dx = p[0] - a[0];
      const dy = p[1] - a[1];
      if (!g.moved && Math.hypot(dx, dy) < 1) return;
      g.moved = true;
      if (sel === null) setSel(g.target);
      apply2(g.target, g, { scale: 1, rot: 0, dx, dy });
    }
  };

  const up = (e: PointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    const g = grab.current;
    if (pointers.current.size > 0) {
      // 残った指から、また 1 本指で続ける
      if (g?.kind === "move")
        grab.current = { ...g, adj: adjOf(g.target), pose, at: new Map(pointers.current) };
      return;
    }
    grab.current = null;
    // 動かさずに離した: タップで選ぶ (選んでいるものをもう一度タップで外す)
    if (g?.kind === "move" && !g.moved && p !== undefined) {
      const t = hit(d, shapes, p) ?? MANNEQUIN;
      setSel(sel === t ? null : t);
    }
  };

  const name =
    sel === MANNEQUIN ? "マネキン" : worn.find((c) => c.id === sel)?.label || (sel === null ? "" : "服");
  const selPlaced = d.placed.filter((p) => p.id === sel);
  const tips = limbTips(d);
  const reset = () => {
    if (sel === MANNEQUIN) onChange(adj, NO_POSE);
    else if (sel !== null) {
      onChange(Object.fromEntries(Object.entries(adj).filter(([id]) => id !== sel)), pose);
    }
  };

  return (
    <div
      className="edit-stage"
      role="dialog"
      aria-modal="true"
      aria-label="指で直す"
      data-testid="edit-stage"
    >
      <div className="edit-bar">
        <p className="muted">
          服やマネキンを指でずらす・2
          本指で大きさと傾き。マネキンを選ぶと、手首・足首の丸で腕と脚を動かせます。
        </p>
        <button type="button" className="primary" onClick={onClose}>
          できた
        </button>
      </div>
      <div className="edit-wrap">
        <Stage worn={worn} adj={adj} pose={pose} tuck={tuck} body={body} size={size} caption="直している服">
          {selPlaced.map((p, i) => {
            const x0 = p.half === "right" ? (p.split ?? 0) : 0;
            const x1 = p.half === "left" ? (p.split ?? p.w) : p.w;
            const corners: Pt[] = [
              [x0, 0],
              [x1, 0],
              [x1, p.h],
              [x0, p.h],
            ];
            const pts = corners.map((q) => apply(p.m, q));
            return (
              <polygon
                key={i}
                className="edit-sel"
                data-testid="edit-sel"
                points={pts.map((q) => q.join(",")).join(" ")}
              />
            );
          })}
          {sel === MANNEQUIN &&
            [...tips.arm, ...tips.leg].map((t, i) => (
              <circle key={i} className="edit-tip" data-testid="edit-tip" cx={t[0]} cy={t[1]} r={2.6} />
            ))}
        </Stage>
        <div
          ref={layer}
          className="edit-layer"
          data-testid="edit-layer"
          style={{ width: size.w, height: size.h }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      </div>
      <div className="edit-tools" role="group" aria-label={sel === null ? "選んだもの" : `${name}を直す`}>
        {sel === null ? (
          <p className="muted">直したい服かマネキンをタップしてください</p>
        ) : (
          <>
            <p data-testid="edit-name">
              <strong>{name}</strong>
            </p>
            <div className="chips">
              {(Object.keys(NUDGE_NAMES) as Nudge[]).map((n) => (
                <button
                  key={n}
                  type="button"
                  className="ghost small"
                  onClick={() => apply2(sel, { adj: adjOf(sel), pose }, nudge(n))}
                >
                  {NUDGE_NAMES[n]}
                </button>
              ))}
              {sel !== MANNEQUIN && d.placed.length > 1 && (
                <button type="button" className="ghost small" onClick={() => setSel(below(d, sel))}>
                  うしろの服
                </button>
              )}
              <button type="button" className="ghost small" onClick={reset}>
                もとに戻す
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
