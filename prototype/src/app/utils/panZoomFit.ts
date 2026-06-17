// pan/zoom の「全体フィット」変換を計算する純関数。usePanZoom.fitTo から使い、単体テスト可能に
//   切り出す (hook を読み込まずに検証できるよう独立モジュール)。
//   コンテンツ (contentW×contentH) を viewport (viewportW×viewportH) に pad 付きで内接させ、
//   中央寄せする。scale は [minScale, maxScale] にクランプする (既定 maxScale=1: 開いた瞬間に
//   自然サイズ以上へ拡大しない — 小さなツリーが巨大化するのを防ぐ)。
export type FitTransform = { x: number; y: number; scale: number }

export function computeFitTransform(
  contentW: number,
  contentH: number,
  viewportW: number,
  viewportH: number,
  opts: { pad?: number; minScale?: number; maxScale?: number } = {},
): FitTransform {
  const pad = opts.pad ?? 40
  const minScale = opts.minScale ?? 0.2
  const maxScale = opts.maxScale ?? 1
  if (!(contentW > 0) || !(contentH > 0) || !(viewportW > 0) || !(viewportH > 0)) {
    return { x: 0, y: 0, scale: 1 }
  }
  const availW = Math.max(1, viewportW - pad * 2)
  const availH = Math.max(1, viewportH - pad * 2)
  const raw = Math.min(availW / contentW, availH / contentH)
  const scale = Math.min(maxScale, Math.max(minScale, raw))
  return {
    x: (viewportW - contentW * scale) / 2,
    y: (viewportH - contentH * scale) / 2,
    scale,
  }
}
