import { describe, it, expect } from 'vitest'
import { collectLineage } from './treeLineage'

// 家系図風グラフ: A,B → C ; A,B → E (C と E は兄弟) ; C → D
const parents: Record<string, string[]> = {
  A: [],
  B: [],
  C: ['A', 'B'],
  E: ['A', 'B'],
  D: ['C'],
}
const children: Record<string, string[]> = {
  A: ['C', 'E'],
  B: ['C', 'E'],
  C: ['D'],
  D: [],
  E: [],
}
const pOf = (id: string) => parents[id] ?? []
const cOf = (id: string) => children[id] ?? []

describe('collectLineage', () => {
  it('祖先と子孫を両方向に集める (両親 2 系統を含む)', () => {
    const s = collectLineage('C', pOf, cOf)
    expect([...s].sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('兄弟は含めない (祖先の別の子に広げない)', () => {
    const s = collectLineage('C', pOf, cOf)
    expect(s.has('E')).toBe(false)
  })

  it('根から見ると子孫のみ (祖先なし)', () => {
    const s = collectLineage('A', pOf, cOf)
    expect([...s].sort()).toEqual(['A', 'C', 'D', 'E'])
  })

  it('葉から見ると祖先のみ (子孫なし)', () => {
    const s = collectLineage('D', pOf, cOf)
    expect([...s].sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('単一親の木 (派閥図風) でも動く', () => {
    // root → x → y ; root → z
    const fp: Record<string, string[]> = { root: [], x: ['root'], y: ['x'], z: ['root'] }
    const fc: Record<string, string[]> = { root: ['x', 'z'], x: ['y'], y: [], z: [] }
    const s = collectLineage(
      'x',
      (id) => fp[id] ?? [],
      (id) => fc[id] ?? [],
    )
    // x の祖先=root, 子孫=y。z (兄弟) は含めない
    expect([...s].sort()).toEqual(['root', 'x', 'y'])
  })
})
