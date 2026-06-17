import type { FamilyTreeGraph } from '@sim/selectors/familyTreeSelectors'

// 家系図レイアウトの純関数とその寸法定数。FamilyTreePanel(描画)から分離して
// fast-refresh 制約(component ファイルは component のみ export)を満たし、単体でも検証可能にする。

// ノード寸法とレイアウト間隔 (px)。v1 は世代=行の単純レイアウト (tidy-tree は将来課題)。
export const NODE_W = 210
export const NODE_H = 86
export const COL_W = NODE_W + 30
const ROW_H = NODE_H + 74
const PAD = 60

type NodePos = { x: number; y: number }
// entity id = 実在人物の PersonId(文字列) または "不詳" placeholder の合成 id ("ph:...")。
export type EntityId = string

// 各 child の親 (father/mother) 生 id。未設定は undefined。displayed かどうかは別途判定。
export type ParentsLookup = Map<EntityId, { fatherId?: EntityId; motherId?: EntityId }>

type Couple = {
  key: string
  // 家系図上は father を左・mother を右に固定配置する。
  leftId: EntityId
  rightId: EntityId
  leftIsPlaceholder: boolean
  rightIsPlaceholder: boolean
  gen: number
  children: EntityId[]
}

export type FamilyLayout = {
  pos: Map<EntityId, NodePos>
  placeholderIds: EntityId[]
  // 夫婦線を引く対象。placeholder 含む。
  coupleLines: { aId: EntityId; bId: EntityId }[]
  // child → 親世代の連結元 (父母の中点)。これを起点に 1 本だけ線を引く。
  childSource: Map<EntityId, NodePos>
  width: number
  height: number
}

// グラフ + 親情報を世代行レイアウトに配置する純関数。
// 夫婦 (父母+不詳 placeholder) をユニットとして隣接配置し、子の連結線は父母の中点から 1 本引く。
export function layoutFamilyTree(graph: FamilyTreeGraph, parentsOf: ParentsLookup): FamilyLayout {
  const displayed = new Set<EntityId>(graph.nodes.map((n) => n.personId))
  const genOf = new Map<EntityId, number>(graph.nodes.map((n) => [n.personId, n.generation]))

  const displayedParents = (id: EntityId): EntityId[] => {
    const p = parentsOf.get(id)
    if (!p) return []
    const out: EntityId[] = []
    if (p.fatherId !== undefined && displayed.has(p.fatherId)) out.push(p.fatherId)
    if (p.motherId !== undefined && displayed.has(p.motherId)) out.push(p.motherId)
    return out
  }

  // --- 1. 夫婦 (子を持つ親ペア) を構築。片親が displayed でなければ placeholder で補う ---
  const couplesByKey = new Map<string, Couple>()
  const childToCoupleKey = new Map<EntityId, string>()
  // 決定的な順序で処理 (personId 昇順)
  const sortedNodes = [...graph.nodes].sort((a, b) =>
    (a.personId as string) < (b.personId as string) ? -1 : 1,
  )
  for (const n of sortedNodes) {
    const p = parentsOf.get(n.personId)
    const f = p?.fatherId
    const m = p?.motherId
    const fD = f !== undefined && displayed.has(f)
    const mD = m !== undefined && displayed.has(m)
    if (!fD && !mD) continue // 親がどちらも家系図上に居ない → 根 (連結線なし)
    const key = `c:${f ?? '?'}|${m ?? '?'}`
    let couple = couplesByKey.get(key)
    if (!couple) {
      const anchorId = fD ? f : m
      const anchorGen = anchorId !== undefined ? (genOf.get(anchorId) ?? 0) : 0
      couple = {
        key,
        leftId: fD && f !== undefined ? f : `ph:${key}:f`,
        rightId: mD && m !== undefined ? m : `ph:${key}:m`,
        leftIsPlaceholder: !fD,
        rightIsPlaceholder: !mD,
        gen: anchorGen,
        children: [],
      }
      couplesByKey.set(key, couple)
    }
    couple.children.push(n.personId)
    childToCoupleKey.set(n.personId, key)
  }

  // 子のいない夫婦 (現・元配偶者の spouse edge) もユニット化する。
  //   既に「共通の子を持つ親ペア」の couple がある対は重複させない (二重線回避)。
  //   親 (別の相手と子がいる) でも対象にする → 子の無い配偶者が孤立しないよう線を引ける。
  const realMembers = (c: Couple): EntityId[] => {
    const r: EntityId[] = []
    if (!c.leftIsPlaceholder) r.push(c.leftId)
    if (!c.rightIsPlaceholder) r.push(c.rightId)
    return r
  }
  const pairKey = (a: EntityId, b: EntityId): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const coveredPairs = new Set<string>()
  for (const c of couplesByKey.values()) {
    const rm = realMembers(c)
    if (rm.length === 2) coveredPairs.add(pairKey(rm[0]!, rm[1]!))
  }
  for (const e of graph.edges) {
    if (e.kind !== 'spouse') continue
    const pk = pairKey(e.aId, e.bId)
    if (coveredPairs.has(pk)) continue
    coveredPairs.add(pk)
    const key = `s:${pk}`
    if (couplesByKey.has(key)) continue
    couplesByKey.set(key, {
      key,
      leftId: e.aId,
      rightId: e.bId,
      leftIsPlaceholder: false,
      rightIsPlaceholder: false,
      gen: genOf.get(e.aId) ?? 0,
      children: [],
    })
  }

  // --- 2. 各人物の primary 夫婦 (再婚等で複数に属する場合は子の多い方を優先) ---
  const primaryCouple = new Map<EntityId, string>()
  const orderedCouples = [...couplesByKey.values()].sort(
    (a, b) => b.children.length - a.children.length || (a.key < b.key ? -1 : 1),
  )
  for (const c of orderedCouples) {
    for (const m of realMembers(c)) {
      if (!primaryCouple.has(m)) primaryCouple.set(m, c.key)
    }
  }
  const isUnitCouple = (c: Couple): boolean =>
    realMembers(c).every((m) => primaryCouple.get(m) === c.key)

  // --- 3. 各 entity の実効世代 ---
  // 夫婦ユニットは couple.gen に揃える (家内婚等で2人の選択子世代がずれても同一行に置き、
  // 「couple 行」と「自世代の単身」の二重配置を防ぐ)。それ以外は selector 世代を使う。
  const placedCoupleKeys = new Set<string>()
  for (const c of couplesByKey.values()) if (isUnitCouple(c)) placedCoupleKeys.add(c.key)
  const effGen = new Map<EntityId, number>()
  for (const c of couplesByKey.values()) {
    if (!placedCoupleKeys.has(c.key)) continue
    effGen.set(c.leftId, c.gen)
    effGen.set(c.rightId, c.gen)
  }
  for (const n of graph.nodes) {
    if (!effGen.has(n.personId)) effGen.set(n.personId, n.generation)
  }
  const maxGenEff = [...effGen.values()].reduce((m, g) => Math.max(m, g), 0)
  const inUnitGlobal = new Set<EntityId>()
  for (const c of couplesByKey.values()) {
    if (placedCoupleKeys.has(c.key)) for (const m of realMembers(c)) inUnitGlobal.add(m)
  }

  // --- 4. 世代ごとにユニット (夫婦 or 単身) を並べて列を割り当てる ---
  const colIndex = new Map<EntityId, number>()
  const colsInGen: number[] = []
  for (let g = 0; g <= maxGenEff; g++) {
    const coupleUnits = [...couplesByKey.values()].filter(
      (c) => placedCoupleKeys.has(c.key) && c.gen === g,
    )
    const singles = graph.nodes
      .filter(
        (n) => (effGen.get(n.personId) ?? n.generation) === g && !inUnitGlobal.has(n.personId),
      )
      .map((n) => n.personId)

    type Unit = { kind: 'couple'; c: Couple } | { kind: 'single'; id: EntityId }
    const units: Unit[] = [
      ...coupleUnits.map((c): Unit => ({ kind: 'couple', c })),
      ...singles.map((id): Unit => ({ kind: 'single', id })),
    ]
    const unitMembers = (u: Unit): EntityId[] => (u.kind === 'couple' ? realMembers(u.c) : [u.id])
    const unitKey = (u: Unit): string => (u.kind === 'couple' ? u.c.key : u.id)
    const parentColOf = (u: Unit): number | undefined => {
      const xs: number[] = []
      for (const m of unitMembers(u)) {
        for (const par of displayedParents(m)) {
          const c = colIndex.get(par)
          if (c !== undefined) xs.push(c)
        }
      }
      return xs.length === 0 ? undefined : xs.reduce((a, b) => a + b, 0) / xs.length
    }
    units.sort((a, b) => {
      const pa = parentColOf(a)
      const pb = parentColOf(b)
      if (pa !== undefined && pb !== undefined && pa !== pb) return pa - pb
      if (pa !== undefined && pb === undefined) return -1
      if (pa === undefined && pb !== undefined) return 1
      return unitKey(a) < unitKey(b) ? -1 : 1
    })

    let col = 0
    for (const u of units) {
      if (u.kind === 'couple') {
        colIndex.set(u.c.leftId, col++)
        colIndex.set(u.c.rightId, col++)
      } else {
        colIndex.set(u.id, col++)
      }
    }
    colsInGen[g] = col
  }

  // --- 5. 行を中央寄せして実座標へ ---
  const maxLen = Math.max(1, ...colsInGen)
  const pos = new Map<EntityId, NodePos>()
  for (const [id, col] of colIndex) {
    const g = effGen.get(id) ?? 0
    const rowOffset = ((maxLen - (colsInGen[g] ?? 0)) * COL_W) / 2
    pos.set(id, { x: PAD + rowOffset + col * COL_W, y: PAD + g * ROW_H })
  }

  // --- 6. placeholder 一覧 / 夫婦線 / child 連結元 ---
  const placeholderIds: EntityId[] = []
  const coupleLines: { aId: EntityId; bId: EntityId }[] = []
  for (const c of couplesByKey.values()) {
    if (placedCoupleKeys.has(c.key)) {
      if (c.leftIsPlaceholder) placeholderIds.push(c.leftId)
      if (c.rightIsPlaceholder) placeholderIds.push(c.rightId)
    }
    // 死別/再婚で現在は夫婦でなくても、共通の子から「夫婦だった」関係を再構成して線を引く。
    // (非 primary 夫婦も含め両者が配置済みなら結ぶ → 配偶者が孤立して見える問題を解消)
    if (pos.has(c.leftId) && pos.has(c.rightId)) {
      coupleLines.push({ aId: c.leftId, bId: c.rightId })
    }
  }

  const childSource = new Map<EntityId, NodePos>()
  for (const n of graph.nodes) {
    const ck = childToCoupleKey.get(n.personId)
    let source: NodePos | undefined
    if (ck !== undefined && placedCoupleKeys.has(ck)) {
      const c = couplesByKey.get(ck)
      const lp = c ? pos.get(c.leftId) : undefined
      const rp = c ? pos.get(c.rightId) : undefined
      if (lp && rp) source = { x: (lp.x + rp.x) / 2 + NODE_W / 2, y: lp.y + NODE_H }
    }
    if (!source) {
      // fallback: displayed 親の中点 (placeholder 不在 or 非 primary 夫婦)
      const ps = displayedParents(n.personId)
        .map((p) => pos.get(p))
        .filter((v): v is NodePos => v !== undefined)
      if (ps.length > 0) {
        const sx = ps.reduce((a, b) => a + b.x, 0) / ps.length + NODE_W / 2
        const sy = Math.max(...ps.map((b) => b.y)) + NODE_H
        source = { x: sx, y: sy }
      }
    }
    if (source) childSource.set(n.personId, source)
  }

  return {
    pos,
    placeholderIds,
    coupleLines,
    childSource,
    width: PAD * 2 + maxLen * COL_W,
    height: PAD * 2 + (maxGenEff + 1) * ROW_H,
  }
}
