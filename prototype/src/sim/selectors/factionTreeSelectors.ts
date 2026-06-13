import type { WorldState } from '@sim/types/world'
import type { PersonId, FactionId } from '@sim/types/ids'
import { getFactionActiveMemberIds } from '@sim/selectors/factionSelectors'

// 派閥図 (家系図の派閥版) 用の木構造を導出する read-only selector。
//
// 入れ子は parentFactionId / byParent のポインタで表現される (faction.ts 参照)。
// 子派閥の leader は親の member には「ならない」ため、本ツリーは membership 再帰では
// なく parentFactionId 木を辿る。各人物ノードの親は:
//   - メンバー   → 自派閥の leader
//   - 傘下 leader → 親派閥の leader (庇護者)
//   - root leader → null
// addFactionMembership が単一 active membership を強制するため、各人物は木内に一意に出現する。

export type FactionTreeNode = {
  personId: PersonId
  // メンバーは所属派閥、leader は率いる派閥の id。
  factionId: FactionId
  role: 'leader' | 'member'
  // 木の親 (上にぶら下がる人物)。root leader のみ null。
  parentPersonId: PersonId | null
  // root leader = 0。
  depth: number
}

export type FactionTreeGraph = {
  rootFactionId: FactionId
  rootPersonId: PersonId
  // DFS preorder。各 personId は一意。
  nodes: FactionTreeNode[]
}

// 与えられた派閥が属する木の root を求める (parentFactionId を上に辿る)。循環は guard で防ぐ。
function findRootFaction(state: WorldState, factionId: FactionId): FactionId {
  let current = state.factions[factionId]
  const guard = new Set<FactionId>()
  while (current?.parentFactionId !== undefined && !guard.has(current.id)) {
    guard.add(current.id)
    const parent = state.factions[current.parentFactionId]
    if (!parent || !parent.active) break
    current = parent
  }
  return current?.id ?? factionId
}

// factionId が属する木全体を root から DFS して人物ノード列を返す。
export function buildFactionTree(state: WorldState, factionId: FactionId): FactionTreeGraph | null {
  const rootFactionId = findRootFaction(state, factionId)
  const rootFaction = state.factions[rootFactionId]
  if (!rootFaction) return null

  const nodes: FactionTreeNode[] = []
  const visitedFactions = new Set<FactionId>()
  const seenPersons = new Set<PersonId>()

  const visit = (fid: FactionId, parentPersonId: PersonId | null, depth: number): void => {
    if (visitedFactions.has(fid)) return
    visitedFactions.add(fid)
    const faction = state.factions[fid]
    if (!faction || !faction.active) return

    const leaderId = faction.leaderPersonId
    // leader ノード。重複保護 (単一 membership 強制下では本来発生しないが安全側)。
    if (!seenPersons.has(leaderId)) {
      seenPersons.add(leaderId)
      nodes.push({ personId: leaderId, factionId: fid, role: 'leader', parentPersonId, depth })
    }

    // メンバー (leader 除く) は leader の下にぶら下がる。
    for (const memberId of getFactionActiveMemberIds(state, fid)) {
      if (memberId === leaderId) continue
      if (seenPersons.has(memberId)) continue
      seenPersons.add(memberId)
      nodes.push({
        personId: memberId,
        factionId: fid,
        role: 'member',
        parentPersonId: leaderId,
        depth: depth + 1,
      })
    }

    // 傘下派閥の leader も同じ leader の下にぶら下がる (庇護者→被庇護者)。
    const childFactionIds = (state.factionIndex.byParent[fid] ?? [])
      .filter((cid) => state.factions[cid]?.active === true)
      .sort()
    for (const childId of childFactionIds) {
      visit(childId, leaderId, depth + 1)
    }
  }

  visit(rootFactionId, null, 0)

  return { rootFactionId, rootPersonId: rootFaction.leaderPersonId, nodes }
}
