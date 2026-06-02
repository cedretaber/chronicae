import type { Transform } from '@/app/hooks/usePanZoom'

export type Bounds = { xMin: number; yMin: number; xMax: number; yMax: number }

/** 点群の軸平行バウンディングボックスを返す。点が空なら null。 */
export function computeBounds(points: Iterable<{ x: number; y: number }>): Bounds | null {
  let xMin = Infinity
  let yMin = Infinity
  let xMax = -Infinity
  let yMax = -Infinity
  let any = false
  for (const p of points) {
    any = true
    if (p.x < xMin) xMin = p.x
    if (p.y < yMin) yMin = p.y
    if (p.x > xMax) xMax = p.x
    if (p.y > yMax) yMax = p.y
  }
  return any ? { xMin, yMin, xMax, yMax } : null
}

/**
 * SVG viewBox 内の対象 bbox を、要素ローカル座標系で中央寄せ・85% 充填する
 * pan/zoom transform を計算する。preserveAspectRatio="xMidYMid meet"
 * (uniform scale + centering) を前提とする。
 */
export function computeFocusTransform(opts: {
  target: Bounds
  viewBounds: [number, number, number, number]
  rectWidth: number
  rectHeight: number
  pad: number
}): Transform {
  const { target, viewBounds, rectWidth, rectHeight, pad } = opts
  const [vx0, vy0, vx1, vy1] = viewBounds
  const vw = vx1 - vx0
  const vh = vy1 - vy0

  const svgScale = Math.min(rectWidth / vw, rectHeight / vh)
  const offsetX = (rectWidth - vw * svgScale) / 2
  const offsetY = (rectHeight - vh * svgScale) / 2

  const bboxW = target.xMax - target.xMin + pad * 2
  const bboxH = target.yMax - target.yMin + pad * 2
  const targetScale =
    Math.min(rectWidth / (bboxW * svgScale), rectHeight / (bboxH * svgScale)) * 0.85

  const elX = offsetX + ((target.xMin + target.xMax) / 2 - vx0) * svgScale
  const elY = offsetY + ((target.yMin + target.yMax) / 2 - vy0) * svgScale

  return {
    x: rectWidth / 2 - elX * targetScale,
    y: rectHeight / 2 - elY * targetScale,
    scale: targetScale,
  }
}
