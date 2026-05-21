import { UnionFind } from './unionFind'

export type Edge = { a: number; b: number; weight: number }

export function kruskalMST(nodeCount: number, edges: Edge[]): Edge[] {
  const sorted = [...edges].sort((x, y) => x.weight - y.weight)
  const uf = new UnionFind(nodeCount)
  const mst: Edge[] = []

  for (const edge of sorted) {
    if (uf.union(edge.a, edge.b)) {
      mst.push(edge)
      if (mst.length === nodeCount - 1) break
    }
  }

  return mst
}
