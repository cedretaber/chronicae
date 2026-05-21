import { describe, it, expect } from 'vitest'
import { kruskalMST, type Edge } from './mst'

describe('kruskalMST', () => {
  it('returns empty for single node', () => {
    expect(kruskalMST(1, [])).toEqual([])
  })

  it('returns the only edge for two nodes', () => {
    const edges: Edge[] = [{ a: 0, b: 1, weight: 5 }]
    const mst = kruskalMST(2, edges)
    expect(mst).toHaveLength(1)
    expect(mst[0]).toEqual({ a: 0, b: 1, weight: 5 })
  })

  it('selects minimum weight spanning tree', () => {
    // Triangle: 0-1 (1), 1-2 (2), 0-2 (3)
    const edges: Edge[] = [
      { a: 0, b: 1, weight: 1 },
      { a: 1, b: 2, weight: 2 },
      { a: 0, b: 2, weight: 3 },
    ]
    const mst = kruskalMST(3, edges)
    expect(mst).toHaveLength(2)
    const totalWeight = mst.reduce((s, e) => s + e.weight, 0)
    expect(totalWeight).toBe(3)
  })

  it('handles disconnected components gracefully', () => {
    const edges: Edge[] = [{ a: 0, b: 1, weight: 1 }]
    const mst = kruskalMST(3, edges)
    expect(mst).toHaveLength(1)
  })

  it('produces n-1 edges for connected graph', () => {
    // Square: 0-1-2-3 with diagonals
    const edges: Edge[] = [
      { a: 0, b: 1, weight: 1 },
      { a: 1, b: 2, weight: 2 },
      { a: 2, b: 3, weight: 3 },
      { a: 0, b: 3, weight: 4 },
      { a: 0, b: 2, weight: 5 },
      { a: 1, b: 3, weight: 6 },
    ]
    const mst = kruskalMST(4, edges)
    expect(mst).toHaveLength(3)
    const totalWeight = mst.reduce((s, e) => s + e.weight, 0)
    expect(totalWeight).toBe(6)
  })
})
