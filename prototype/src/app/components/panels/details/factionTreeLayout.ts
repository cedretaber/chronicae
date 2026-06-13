import type { PersonId } from '@/sim/types/ids'
import type { FactionTreeGraph } from '@sim/selectors/factionTreeSelectors'

// 派閥図レイアウトの純関数とその寸法定数。FactionTreePanel(描画)から分離して
// fast-refresh 制約(component ファイルは component のみ export)を満たし、単体検証も可能にする。
//
// 入れ子は単一親の厳密な木 (各人物は一意・親は 1 人) なので、家系図のような
// couple/placeholder/generation 機構は不要。シンプルな tidy-tree (葉を順に詰めて
// 親を子の中央へ) で配置する。

// ノード寸法とレイアウト間隔 (px)。leader ノードは faction link 行が付くため少し高め。
export const NODE_W = 210
export const NODE_H = 96
export const COL_W = NODE_W + 26
export const ROW_H = NODE_H + 56
export const PAD = 60

export type NodePos = { x: number; y: number }

export type FactionLayout = {
  pos: Map<PersonId, NodePos>
  edges: { parentId: PersonId; childId: PersonId }[]
  width: number
  height: number
}

// 人物ノード木を上から下へ配置する純関数。
export function layoutFactionTree(graph: FactionTreeGraph): FactionLayout {
  // DFS 順を保ったまま親→子の隣接リストを構築する。
  const childrenOf = new Map<PersonId, PersonId[]>()
  const depthOf = new Map<PersonId, number>()
  for (const n of graph.nodes) {
    depthOf.set(n.personId, n.depth)
    if (n.parentPersonId !== null) {
      const arr = childrenOf.get(n.parentPersonId)
      if (arr) arr.push(n.personId)
      else childrenOf.set(n.parentPersonId, [n.personId])
    }
  }

  // 葉を左から順に詰め、内部ノードは子の中央へ寄せる (post-order で列 index を決定)。
  const colIndex = new Map<PersonId, number>()
  let cursor = 0
  const assign = (personId: PersonId): number => {
    const children = childrenOf.get(personId) ?? []
    let col: number
    if (children.length === 0) {
      col = cursor
      cursor += 1
    } else {
      const childCols = children.map((c) => assign(c))
      col = (childCols[0]! + childCols[childCols.length - 1]!) / 2
    }
    colIndex.set(personId, col)
    return col
  }
  assign(graph.rootPersonId)

  const pos = new Map<PersonId, NodePos>()
  let maxCol = 0
  let maxDepth = 0
  for (const [id, col] of colIndex) {
    const depth = depthOf.get(id) ?? 0
    pos.set(id, { x: PAD + col * COL_W, y: PAD + depth * ROW_H })
    if (col > maxCol) maxCol = col
    if (depth > maxDepth) maxDepth = depth
  }

  const edges: { parentId: PersonId; childId: PersonId }[] = []
  for (const [parentId, children] of childrenOf) {
    for (const childId of children) edges.push({ parentId, childId })
  }

  return {
    pos,
    edges,
    width: PAD * 2 + maxCol * COL_W + NODE_W,
    height: PAD * 2 + maxDepth * ROW_H + NODE_H,
  }
}
