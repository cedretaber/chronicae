import { describe, it, expect } from 'vitest'
import { UnionFind } from './unionFind'

describe('UnionFind', () => {
  it('starts with each element in its own component', () => {
    const uf = new UnionFind(5)
    expect(uf.componentCount()).toBe(5)
    expect(uf.connected(0, 1)).toBe(false)
  })

  it('union merges components', () => {
    const uf = new UnionFind(4)
    expect(uf.union(0, 1)).toBe(true)
    expect(uf.connected(0, 1)).toBe(true)
    expect(uf.componentCount()).toBe(3)
  })

  it('union of already-connected returns false', () => {
    const uf = new UnionFind(3)
    uf.union(0, 1)
    expect(uf.union(0, 1)).toBe(false)
    expect(uf.componentCount()).toBe(2)
  })

  it('transitive connectivity', () => {
    const uf = new UnionFind(4)
    uf.union(0, 1)
    uf.union(1, 2)
    expect(uf.connected(0, 2)).toBe(true)
    expect(uf.connected(0, 3)).toBe(false)
    expect(uf.componentCount()).toBe(2)
  })

  it('merges all into one component', () => {
    const uf = new UnionFind(5)
    uf.union(0, 1)
    uf.union(2, 3)
    uf.union(1, 3)
    uf.union(3, 4)
    expect(uf.componentCount()).toBe(1)
    for (let i = 0; i < 5; i++) {
      expect(uf.connected(0, i)).toBe(true)
    }
  })
})
