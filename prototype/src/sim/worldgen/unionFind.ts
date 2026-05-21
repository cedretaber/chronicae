export class UnionFind {
  private parent: number[]
  private rank: number[]
  private components: number

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.rank = new Array<number>(n).fill(0)
    this.components = n
  }

  find(x: number): number {
    let root = x
    while (this.parent[root] !== root) {
      root = this.parent[root]!
    }
    // Path compression
    let current = x
    while (current !== root) {
      const next = this.parent[current]!
      this.parent[current] = root
      current = next
    }
    return root
  }

  union(x: number, y: number): boolean {
    const rx = this.find(x)
    const ry = this.find(y)
    if (rx === ry) return false

    const rankX = this.rank[rx]!
    const rankY = this.rank[ry]!
    if (rankX < rankY) {
      this.parent[rx] = ry
    } else if (rankX > rankY) {
      this.parent[ry] = rx
    } else {
      this.parent[ry] = rx
      this.rank[rx] = rankX + 1
    }
    this.components--
    return true
  }

  connected(x: number, y: number): boolean {
    return this.find(x) === this.find(y)
  }

  componentCount(): number {
    return this.components
  }
}
