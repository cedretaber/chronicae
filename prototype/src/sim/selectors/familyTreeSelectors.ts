import type { PersonId, HouseId } from '../types/ids'
import type { Person } from '../types/person'
import type { WorldState } from '../types/world'

// 家系図 (Family Tree) 用の read-only グラフ構築。
// locale 中立・決定的・純粋関数。UI 層 (FamilyTreePanel) がこのグラフをレイアウトして描画する。
//
// 家門 H から見た各ノードの関係:
//   - blood       : H の血統 (H 内で生まれた / 起源シード)
//   - married_in  : 婚姻で H に加入した配偶者 (出生家は別)
//   - married_out : H の血統メンバーの子で、婚姻により別家へ移った者 (一段のみ)
//
// 「出生家」を保持する明示フィールドは無いため、出生家は親 (father/mother) の houseId から
// best-effort で導出する。

export type FamilyTreeRelation = 'blood' | 'married_in' | 'married_out'

export type FamilyTreeNode = {
  personId: PersonId
  relation: FamilyTreeRelation
  // married_in = 出生家 (natal) / married_out = 現在の家。導出不能・自家の場合は undefined。
  otherHouseId?: HouseId
  // 0 = 家系図上で最古の世代。下方向 (子) に向かって増加。
  generation: number
}

export type FamilyTreeEdge =
  | { kind: 'parent_child'; parentId: PersonId; childId: PersonId }
  // spouse は aId < bId で正規化し dedupe 済み。
  | { kind: 'spouse'; aId: PersonId; bId: PersonId }

export type FamilyTreeGraph = {
  nodes: FamilyTreeNode[]
  edges: FamilyTreeEdge[]
}

export function buildHouseFamilyTree(state: WorldState, houseId: HouseId): FamilyTreeGraph {
  const house = state.houses[houseId]
  if (!house) return { nodes: [], edges: [] }

  const getPerson = (pid: PersonId): Person | undefined => state.persons[pid]

  // 出生家を親から導出する (best-effort)。自家・導出不能なら undefined。
  const natalHouse = (p: Person): HouseId | undefined => {
    const father = p.fatherId !== undefined ? getPerson(p.fatherId) : undefined
    const candidate = father?.houseId ?? getPerson(p.motherId ?? ('' as PersonId))?.houseId
    return candidate !== undefined && candidate !== houseId ? candidate : undefined
  }

  // --- 1. メンバー集合 (生存 + 故人) ---
  const memberSet = new Set<PersonId>()
  for (const pid of house.memberIds) memberSet.add(pid)
  for (const pid of house.deceasedMemberIds) memberSet.add(pid)
  const sortedMembers = [...memberSet].sort()

  // --- 2. メンバーを blood / married_in に分類 (順序非依存・複数パス) ---
  const relation = new Map<PersonId, FamilyTreeRelation>()
  // パス A: founder / 親が家内にいる者 → blood (確定)
  for (const pid of sortedMembers) {
    const p = getPerson(pid)
    if (!p) continue
    const fatherInHouse = p.fatherId !== undefined && memberSet.has(p.fatherId)
    const motherInHouse = p.motherId !== undefined && memberSet.has(p.motherId)
    if (pid === house.founderId || fatherInHouse || motherInHouse) {
      relation.set(pid, 'blood')
    }
  }
  // パス B1: 未分類のうち blood の配偶者 (現・元いずれも) を持つ者 → married_in
  for (const pid of sortedMembers) {
    if (relation.has(pid)) continue
    const p = getPerson(pid)
    if (!p) continue
    const spouseCandidates: PersonId[] = [
      ...(p.spouseId !== undefined ? [p.spouseId] : []),
      ...(p.formerSpouseIds ?? []),
    ]
    if (spouseCandidates.some((s) => relation.get(s) === 'blood')) {
      relation.set(pid, 'married_in')
    }
  }
  // パス B2: 親が家内に居ないが出生家 (natal house) が別家と判明する者 → married_in。
  //   死別で spouseId が消える (markPersonDead→clearSpouse) と B1 で拾えないため、
  //   live spouse 以外の根拠 (親の houseId) も使う。natalHouse は自家・導出不能なら undefined。
  for (const pid of sortedMembers) {
    if (relation.has(pid)) continue
    const p = getPerson(pid)
    if (!p) continue
    if (natalHouse(p) !== undefined) relation.set(pid, 'married_in')
  }
  // パス B3: なお未分類の者 → blood (起源シード扱い)
  for (const pid of sortedMembers) {
    if (!relation.has(pid)) relation.set(pid, 'blood')
  }

  // --- 3. married_out (一段のみ): blood メンバーの子で家外にいる者 ---
  const marriedOut = new Map<PersonId, HouseId | undefined>()
  for (const pid of sortedMembers) {
    if (relation.get(pid) !== 'blood') continue
    const p = getPerson(pid)
    if (!p) continue
    for (const cid of [...p.childIds].sort()) {
      if (memberSet.has(cid) || marriedOut.has(cid)) continue
      const c = getPerson(cid)
      if (!c) continue
      const oh = c.houseId !== undefined && c.houseId !== houseId ? c.houseId : undefined
      marriedOut.set(cid, oh)
    }
  }

  // --- 4. ノード ID 集合 ---
  const nodeIds = new Set<PersonId>()
  for (const pid of sortedMembers) if (relation.has(pid)) nodeIds.add(pid)
  for (const cid of marriedOut.keys()) nodeIds.add(cid)
  const sortedNodeIds = [...nodeIds].sort()

  // --- 5. parent_child エッジ (ノード集合内) ---
  const parentChild: { parentId: PersonId; childId: PersonId }[] = []
  const childrenOf = new Map<PersonId, PersonId[]>()
  const incoming = new Map<PersonId, number>()
  for (const cid of sortedNodeIds) {
    const c = getPerson(cid)
    if (!c) continue
    for (const par of [c.fatherId, c.motherId]) {
      if (par !== undefined && nodeIds.has(par)) {
        parentChild.push({ parentId: par, childId: cid })
        const arr = childrenOf.get(par) ?? []
        arr.push(cid)
        childrenOf.set(par, arr)
        incoming.set(cid, (incoming.get(cid) ?? 0) + 1)
      }
    }
  }

  // --- 6. 世代付与 (BFS・親より深い世代へ) ---
  const generation = new Map<PersonId, number>()
  const queue: PersonId[] = []
  // 根 = 親エッジを持たない blood/married_out ノード (married_in は配偶者から後付け)
  for (const pid of sortedNodeIds) {
    if (relation.get(pid) === 'married_in') continue
    if ((incoming.get(pid) ?? 0) === 0) {
      generation.set(pid, 0)
      queue.push(pid)
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift() as PersonId
    const g = generation.get(cur) ?? 0
    for (const child of childrenOf.get(cur) ?? []) {
      const cand = g + 1
      if (!generation.has(child) || cand > (generation.get(child) ?? 0)) {
        generation.set(child, cand)
        queue.push(child)
      }
    }
  }
  // married_in は配偶者と同世代
  for (const pid of sortedNodeIds) {
    if (relation.get(pid) !== 'married_in') continue
    const p = getPerson(pid)
    const partners: PersonId[] = p
      ? [...(p.spouseId !== undefined ? [p.spouseId] : []), ...(p.formerSpouseIds ?? [])]
      : []
    let spouseGen: number | undefined
    for (const sp of partners) {
      const g = generation.get(sp)
      if (g !== undefined) {
        spouseGen = g
        break
      }
    }
    generation.set(pid, spouseGen ?? 0)
  }

  // --- 7. spouse エッジ (現・元配偶者・正規化 + dedupe) ---
  //   死別 (spouseId clear) しても formerSpouseIds から夫婦関係を引けるので、子の無い夫婦も結べる。
  const spouseSeen = new Set<string>()
  const spouseEdges: FamilyTreeEdge[] = []
  for (const pid of sortedNodeIds) {
    const p = getPerson(pid)
    if (!p) continue
    const partners: PersonId[] = [
      ...(p.spouseId !== undefined ? [p.spouseId] : []),
      ...(p.formerSpouseIds ?? []),
    ]
    for (const sp of partners) {
      if (!nodeIds.has(sp)) continue
      const aId = (pid as string) < (sp as string) ? pid : sp
      const bId = (pid as string) < (sp as string) ? sp : pid
      const key = `${aId}|${bId}`
      if (spouseSeen.has(key)) continue
      spouseSeen.add(key)
      spouseEdges.push({ kind: 'spouse', aId, bId })
    }
  }

  // --- 8. ノード組み立て (generation, personId 昇順で安定化) ---
  const nodes: FamilyTreeNode[] = sortedNodeIds.map((pid) => {
    const rel = relation.get(pid) ?? 'married_out'
    let otherHouseId: HouseId | undefined
    if (rel === 'married_in') {
      const p = getPerson(pid)
      otherHouseId = p ? natalHouse(p) : undefined
    } else if (rel === 'married_out') {
      otherHouseId = marriedOut.get(pid)
    }
    const node: FamilyTreeNode = {
      personId: pid,
      relation: rel,
      generation: generation.get(pid) ?? 0,
    }
    if (otherHouseId !== undefined) node.otherHouseId = otherHouseId
    return node
  })
  nodes.sort((a, b) =>
    a.generation !== b.generation
      ? a.generation - b.generation
      : (a.personId as string) < (b.personId as string)
        ? -1
        : 1,
  )

  const edges: FamilyTreeEdge[] = [
    ...parentChild.map(
      (e): FamilyTreeEdge => ({ kind: 'parent_child', parentId: e.parentId, childId: e.childId }),
    ),
    ...spouseEdges,
  ]

  return { nodes, edges }
}
