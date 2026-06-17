import { describe, it, expect } from 'vitest'
import { computeFitTransform } from './panZoomFit'

describe('computeFitTransform', () => {
  it('小さいコンテンツは maxScale=1 を超えて拡大しない (中央寄せ)', () => {
    // content 100x100, viewport 1000x800, pad 0 → raw=8 だが maxScale=1 にクランプ
    const t = computeFitTransform(100, 100, 1000, 800, { pad: 0 })
    expect(t.scale).toBe(1)
    expect(t.x).toBe((1000 - 100) / 2)
    expect(t.y).toBe((800 - 100) / 2)
  })

  it('大きいコンテンツは縮小して内接し minScale でクランプされる', () => {
    // content 10000x10000, viewport 1000x800, pad 0 → raw=0.08 → minScale=0.2 にクランプ
    const t = computeFitTransform(10000, 10000, 1000, 800, { pad: 0, minScale: 0.2 })
    expect(t.scale).toBe(0.2)
    // 中央寄せ: x = (1000 - 10000*0.2)/2 = (1000-2000)/2 = -500
    expect(t.x).toBe(-500)
  })

  it('中間サイズは縮小比でフィットする (制約辺で決まる)', () => {
    // content 800x400, viewport 1000x800, pad 0 → min(1000/800, 800/400)=min(1.25,2)=1.25
    //   → maxScale=1 にクランプされない? 1.25>1 なのでクランプされ 1。pad で調整して < 1 を作る
    const t = computeFitTransform(800, 400, 600, 800, { pad: 0 })
    // min(600/800, 800/400) = min(0.75, 2) = 0.75
    expect(t.scale).toBeCloseTo(0.75, 5)
    expect(t.x).toBeCloseTo((600 - 800 * 0.75) / 2, 5)
    expect(t.y).toBeCloseTo((800 - 400 * 0.75) / 2, 5)
  })

  it('pad を考慮して利用可能領域を縮める', () => {
    // content 500x500, viewport 600x600, pad 50 → avail 500x500 → raw=1 → scale=1
    const t = computeFitTransform(500, 500, 600, 600, { pad: 50 })
    expect(t.scale).toBe(1)
  })

  it('不正な寸法 (0 以下) は恒等変換を返す', () => {
    expect(computeFitTransform(0, 100, 1000, 800)).toEqual({ x: 0, y: 0, scale: 1 })
    expect(computeFitTransform(100, 100, 0, 800)).toEqual({ x: 0, y: 0, scale: 1 })
  })
})
