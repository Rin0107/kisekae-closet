// 型紙合わせ (#81、docs/spec-v2-fitting.md §4・§5)。
// 撮った写真の切り抜きを見せて、なぞって直せる (消す・戻す)。種類ごとの印 (肩先・袖口など) を、推し量った位置に置いて出し、
// ドラッグで直せる。一度人が確かめた印は、着せるときに二度と推し量らない。
// mode "new": 送る写真を作る (服の箱に切り詰め、背景を白に。印はその写真に対する割合)。
// mode "refit": 保存してある写真の上で印だけを直す (写真は送らない)。
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from "react";
import { cutout, CUT_SIDE, decodeImage } from "./cutout";
import { ANCHORS, guessFit, PLACE_NAMES, type Fit, type Place, type Pt } from "./fit";
import { BRUSH, fitInBox, maskBox, moveTo, onWhite, OPTIONAL, paint, withOptional } from "./fitEditor";
import { encodeSmall, toBase64 } from "./shrink";

export interface FitResult {
  /** 送る写真 (base64)。refit では null */
  photo: string | null;
  fit: Fit;
}

export interface FitEditorHandle {
  /** 確かめた印 (と送る写真)。写真が読めていなければ null */
  result: () => Promise<FitResult | null>;
}

interface Loaded {
  w: number;
  h: number;
  px: Uint8ClampedArray;
  mask: Uint8Array;
  guess: Fit;
}

/** 印のつまみの色 (左右・上下で見分ける)。 */
const DOT = ["dot-a", "dot-b", "dot-c", "dot-d"];

export const FitEditor = forwardRef<
  FitEditorHandle,
  { src: string; kind: string; mode: "new" | "refit"; initial?: Fit | null }
>(function FitEditor({ src, kind, mode, initial = null }, ref) {
  const [img, setImg] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [fit, setFit] = useState<Fit | null>(null);
  const [tool, setTool] = useState<"marks" | "erase" | "restore">("marks");
  const [drag, setDrag] = useState<{ i: number; at: Pt } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const view = useRef<ImageData | null>(null);

  // 写真を読み、切り抜いて、印を推し量る
  useEffect(() => {
    let live = true;
    setImg(null);
    setFit(null);
    setFailed(false);
    void (async () => {
      const d = await decodeImage(src);
      if (d === null) throw new Error("読めない");
      const s = Math.min(1, CUT_SIDE / Math.max(d.w, d.h));
      const w = Math.max(1, Math.round(d.w * s));
      const h = Math.max(1, Math.round(d.h * s));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      if (g === null) throw new Error("canvas がない");
      g.drawImage(d.img, 0, 0, w, h);
      d.done();
      const px = g.getImageData(0, 0, w, h).data;
      const cut = new Uint8ClampedArray(px);
      const box = cutout(cut, w, h);
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) mask[i] = box === null || (cut[i * 4 + 3] as number) > 0 ? 1 : 0;
      const guess = guessFit(kind, (x, y) => mask[y * w + x] === 1, w, h);
      if (!live) return;
      setImg({ w, h, px, mask, guess });
      setFit(initial !== null && initial.p.length >= 2 ? initial : guess);
    })().catch(() => {
      if (live) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [src, kind, initial]);

  // 切り抜いた写真を描く (背景は透明。下の市松模様が見える)
  useEffect(() => {
    const c = canvas.current;
    if (img === null || c === null) return;
    c.width = img.w;
    c.height = img.h;
    const g = c.getContext("2d");
    if (g === null) return;
    const data = new ImageData(new Uint8ClampedArray(img.px), img.w, img.h);
    for (let i = 0; i < img.mask.length; i++) data.data[i * 4 + 3] = img.mask[i] === 1 ? 255 : 0;
    view.current = data;
    g.putImageData(data, 0, 0);
  }, [img]);

  useImperativeHandle(
    ref,
    () => ({
      result: async () => {
        if (img === null || fit === null) return null;
        if (mode === "refit") return { photo: null, fit };
        const box = maskBox(img.mask, img.w, img.h, Math.round(Math.max(img.w, img.h) * 0.01));
        if (box === null) return null;
        const full = document.createElement("canvas");
        full.width = img.w;
        full.height = img.h;
        full.getContext("2d")?.putImageData(new ImageData(onWhite(img.px, img.mask), img.w, img.h), 0, 0);
        const out = document.createElement("canvas");
        out.width = box.w;
        out.height = box.h;
        out.getContext("2d")?.drawImage(full, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        const blob = await encodeSmall((type, q) => new Promise((ok) => out.toBlob(ok, type, q)));
        if (blob === null) return null;
        return { photo: await toBase64(blob), fit: fitInBox(fit, img.w, img.h, box) };
      },
    }),
    [img, fit, mode],
  );

  /** 指の位置を、写真の上の割合に。 */
  const at = (e: PointerEvent<HTMLElement>): Pt => {
    const r = (canvas.current as HTMLCanvasElement).getBoundingClientRect();
    return moveTo([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height], 0, 0);
  };

  /** ルーペ: 指の下を 3 倍に。 */
  const magnify = (p: Pt) => {
    const l = loupe.current;
    const c = canvas.current;
    if (l === null || c === null || img === null) return;
    const g = l.getContext("2d");
    if (g === null) return;
    const side = Math.max(img.w, img.h) / 8;
    g.clearRect(0, 0, l.width, l.height);
    g.drawImage(c, p[0] * img.w - side / 2, p[1] * img.h - side / 2, side, side, 0, 0, l.width, l.height);
  };

  const brush = (e: PointerEvent<HTMLElement>) => {
    const c = canvas.current;
    if (img === null || c === null || view.current === null) return;
    const p = at(e);
    const r = paint(
      img.mask,
      img.w,
      img.h,
      p[0] * img.w,
      p[1] * img.h,
      Math.max(img.w, img.h) * BRUSH,
      tool === "erase" ? 0 : 1,
    );
    const v = view.current;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++)
        v.data[(y * img.w + x) * 4 + 3] = img.mask[y * img.w + x] === 1 ? 255 : 0;
    c.getContext("2d")?.putImageData(v, 0, 0, r.x, r.y, r.w, r.h);
  };

  const setPoint = (i: number, p: Pt) =>
    setFit((f) => (f === null ? f : { ...f, p: f.p.map((q, j) => (j === i ? p : q)) }));

  if (failed)
    return (
      <div className="fit-editor" data-testid="fit-editor" data-ready="false">
        <p role="status" className="muted fit-failed">
          この端末では切り抜きを見せられません。このまましまうと、着せるときに印を推し量ります。
        </p>
      </div>
    );
  const names = ANCHORS[kind] ?? [];
  const optional = OPTIONAL[kind];
  return (
    <div className="fit-editor" data-testid="fit-editor" data-ready={img !== null && fit !== null}>
      <div className="fit-tools chips" role="group" aria-label="直し方">
        {(
          [
            ["marks", "印を合わせる"],
            ["erase", "背景を消す"],
            ["restore", "消えすぎを戻す"],
          ] as const
        ).map(([t, name]) => (
          <button key={t} type="button" aria-pressed={tool === t} onClick={() => setTool(t)}>
            {name}
          </button>
        ))}
      </div>
      <div
        className="fit-photo"
        data-tool={tool}
        style={img === null ? undefined : { aspectRatio: `${img.w} / ${img.h}` }}
        onPointerDown={(e) => {
          if (tool === "marks") return;
          e.currentTarget.setPointerCapture(e.pointerId);
          brush(e);
        }}
        onPointerMove={(e) => {
          if (tool !== "marks" && e.buttons !== 0) brush(e);
        }}
      >
        <canvas
          ref={canvas}
          className="fit-canvas"
          aria-label="切り抜いた写真"
          role="img"
          data-testid="fit-canvas"
        />
        {img === null && <p className="muted fit-loading">切り抜いています…</p>}
        {tool === "marks" &&
          fit?.p.map((p, i) => (
            <button
              key={i}
              type="button"
              className={`fit-dot ${DOT[i] ?? ""}`}
              data-testid={`dot-${i}`}
              aria-label={`${names[i] ?? "印"} (矢印のキーで動かす)`}
              style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                e.stopPropagation();
                setDrag({ i, at: p });
                magnify(p);
              }}
              onPointerMove={(e) => {
                if (drag?.i !== i) return;
                const q = at(e);
                setPoint(i, q);
                setDrag({ i, at: q });
                magnify(q);
              }}
              onPointerUp={() => setDrag(null)}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                const step = 0.01;
                const d: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                const m = d[e.key];
                if (m === undefined) return;
                e.preventDefault();
                setPoint(i, moveTo(p, m[0], m[1]));
              }}
            >
              <span className="fit-dot-name">{names[i]}</span>
            </button>
          ))}
        {drag !== null && (
          <canvas
            ref={loupe}
            className="fit-loupe"
            width={96}
            height={96}
            aria-hidden="true"
            style={{ left: `${drag.at[0] * 100}%`, top: `${drag.at[1] * 100}%` }}
          />
        )}
      </div>
      <p className="guide">
        {tool === "marks"
          ? "丸い印を、写真の服の同じところ (肩先・袖口など) に指で合わせてください。合っていればそのままで大丈夫です。"
          : "背景が残っているところ・消えすぎたところを、指でなぞってください。"}
      </p>
      {optional !== undefined && fit !== null && img !== null && (
        <label className="field check">
          <input
            type="checkbox"
            checked={fit.p.length >= 4}
            onChange={(e) => setFit(withOptional(fit, e.target.checked, img.guess))}
          />
          {optional}
        </label>
      )}
      {kind === "accessory" && fit !== null && (
        <div className="chips" role="group" aria-label="置き場所">
          {(Object.keys(PLACE_NAMES) as Place[]).map((pl) => (
            <button
              key={pl}
              type="button"
              aria-pressed={(fit.at ?? "head") === pl}
              onClick={() => setFit({ ...fit, at: pl })}
            >
              {PLACE_NAMES[pl]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
