// 服の種類の形の絵 (今日の画面の種類のレール)。名前は絵の横に読み上げ用の文字で置く (持ち主 2026-11-21: 案 B)。
const PATHS: Record<string, string> = {
  top: "M7.5 4.5 10 3.5h4l2.5 1 4 5-3 1.8-1.5-2.2V20h-8V9.1L6.5 11.3l-3-1.8z",
  dress: "M9.5 3h5l1 4-1.5 2.5L18.5 21h-13L10 9.5 8.5 7z",
  bottom: "M7 3h10l1.5 18h-5L12 9.5 10.5 21h-5z",
  outer: "M7 4.5 10.5 3h3L17 4.5l4 6.5-3 1.5-1.5-2V21h-3.5V8L12 10l-1-2v13H7.5V10.5l-1.5 2-3-1.5z",
  shoes: "M2.5 18.5c0-4 1.5-7 3-7 1.3 0 1.8 1.8 4.5 2.5 3 .8 6 1.5 9.5 2.5 1.5.4 2 1.3 2 2.5v.5h-19z",
  accessory: "M6 9h12l1.5 12h-15zM9 9c0-4 6-4 6 0",
};

export function KindIcon({ kind }: { kind: string }) {
  return (
    <svg className="kind-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[kind] ?? PATHS.top} />
    </svg>
  );
}
