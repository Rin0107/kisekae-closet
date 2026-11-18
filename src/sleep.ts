// 待つだけの関数 (天気の読み直しの間、#31)。テストで差しかえられるように、別のモジュールに置く。
export function sleep(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms));
}
