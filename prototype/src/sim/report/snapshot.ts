import type { WorldState } from '../types/world'
import type { PolityId, HoldingId, HouseId } from '../types/ids'
import type {
  ActivitySnapshot,
  ActivitySnapshotClans,
  ActivitySnapshotFaction,
  ActivitySnapshotHouses,
  ActivitySnapshotPolity,
} from './types'
import { getPolityTerminalProvinceIds } from '../selectors/landContractSelectors'
import { getPolityEmitNameKey } from '../selectors/nameRefSelectors'

// v0.17.1 §observation: 軽量スナップショット。
// state 全体ではなく、観察に必要な要素 (Polity ごとの Office 一覧、Faction ごとの member 分布、
// Bailiff の比率、人口) だけを抜く。N 年ごとに取得して時系列で並べる前提。
export function takeSnapshot(state: WorldState, year: number): ActivitySnapshot {
  const polities: ActivitySnapshotPolity[] = []
  for (const polityIdStr of Object.keys(state.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = state.polities[polityId]
    if (!polity) continue
    const officeIds = state.officeIndex.byOrganization[`polity:${polityId}`] ?? []
    const offices: ActivitySnapshotPolity['offices'] = []
    for (const oid of officeIds) {
      const o = state.officeAssignments[oid]
      if (!o || !o.active) continue
      if (o.role === 'leader') continue
      const holder = state.persons[o.holderPersonId]
      offices.push({
        role: o.role,
        holderPersonId: o.holderPersonId,
        holderHouseId: holder?.houseId ?? '',
      })
    }
    const provinceCount = getPolityTerminalProvinceIds(state, polityId).length
    polities.push({
      polityId: polityId,
      name: getPolityEmitNameKey(state, polityId),
      rank: polity.rank,
      active: polity.active,
      ownerHouseId: polity.ownerHouseId,
      treasury: Math.round(polity.treasury),
      provinceCount,
      offices,
    })
  }

  const factions: ActivitySnapshotFaction[] = []
  for (const fidStr of Object.keys(state.factions).sort()) {
    const f = state.factions[fidStr as keyof typeof state.factions]
    if (!f || !f.active) continue
    const memberHouseCounts: Record<string, number> = {}
    let memberCount = 0
    for (const m of Object.values(state.factionMemberships)) {
      if (!m || !m.active || m.factionId !== f.id) continue
      memberCount++
      const person = state.persons[m.personId]
      const houseId = person?.houseId ?? ''
      memberHouseCounts[houseId] = (memberHouseCounts[houseId] ?? 0) + 1
    }
    const leader = state.persons[f.leaderPersonId]
    const factionName = state.persons[f.leaderPersonId]?.nameKey ?? f.id
    factions.push({
      factionId: f.id,
      name: factionName,
      leaderPersonId: f.leaderPersonId,
      leaderHouseId: leader?.houseId,
      memberCount,
      memberHouseCounts,
    })
  }

  let bailiffNormal = 0
  let bailiffPlaceholder = 0
  let bailiffVacant = 0
  for (const holdingIdStr of Object.keys(state.holdings)) {
    const holdingId = holdingIdStr as HoldingId
    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]
    if (!assignmentId) {
      bailiffVacant++
      continue
    }
    const a = state.holdingOfficeAssignments[assignmentId]
    if (!a || !a.active) {
      bailiffVacant++
      continue
    }
    const holder = state.persons[a.holderPersonId]
    if (!holder) {
      bailiffVacant++
      continue
    }
    if (holder.kind === 'placeholder') bailiffPlaceholder++
    else bailiffNormal++
  }

  let populationLiving = 0
  let populationLivingNormal = 0
  for (const personId of state.livingPersonIds) {
    const p = state.persons[personId]
    if (!p) continue
    populationLiving++
    if (p.kind !== 'placeholder') populationLivingNormal++
  }

  const houses = aggregateHouses(state)
  const clans = aggregateClans(state)

  return {
    year,
    polities,
    factions,
    houses,
    clans,
    bailiffs: { normal: bailiffNormal, placeholder: bailiffPlaceholder, vacant: bailiffVacant },
    populationLiving,
    populationLivingNormal,
  }
}

// 非 leader Office を持つかどうか・その数を house 単位で数える。
function countNonLeaderOffices(state: WorldState, houseId: HouseId): number {
  const officeIds = state.officeIndex.byOrganization[`house:${houseId}`] ?? []
  let count = 0
  for (const oid of officeIds) {
    const o = state.officeAssignments[oid]
    if (o && o.active && o.role !== 'leader') count++
  }
  return count
}

function aggregateHouses(state: WorldState): ActivitySnapshotHouses {
  let activeTotal = 0
  let normal = 0
  let system = 0
  let cadetBranch = 0
  let selfMade = 0
  let creationKindUnknown = 0
  let livingMembersInNormalHouses = 0
  let maxLivingMembers = 0
  const sizeDistribution = { s1: 0, s2to3: 0, s4to6: 0, s7plus: 0 }
  let withNonLeaderOffices = 0
  let totalNonLeaderOffices = 0
  let smallWithOffices = 0

  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const house = state.houses[houseId]
    if (!house || !house.active) continue
    activeTotal++

    const nonLeaderOffices = countNonLeaderOffices(state, houseId)
    totalNonLeaderOffices += nonLeaderOffices
    if (nonLeaderOffices > 0) withNonLeaderOffices++

    if (house.kind === 'system') {
      system++
      continue
    }
    normal++

    if (house.creationKind === 'cadet_branch') cadetBranch++
    else if (house.creationKind === 'self_made_foundation') selfMade++
    else creationKindUnknown++

    let living = 0
    for (const pid of house.memberIds) {
      const p = state.persons[pid]
      if (p && p.alive) living++
    }
    livingMembersInNormalHouses += living
    if (living > maxLivingMembers) maxLivingMembers = living
    if (living <= 1) sizeDistribution.s1++
    else if (living <= 3) sizeDistribution.s2to3++
    else if (living <= 6) sizeDistribution.s4to6++
    else sizeDistribution.s7plus++

    if (living <= 2 && nonLeaderOffices > 0) smallWithOffices++
  }

  return {
    activeTotal,
    normal,
    system,
    cadetBranch,
    selfMade,
    creationKindUnknown,
    livingMembersInNormalHouses,
    maxLivingMembers,
    sizeDistribution,
    withNonLeaderOffices,
    totalNonLeaderOffices,
    smallWithOffices,
  }
}

function aggregateClans(state: WorldState): ActivitySnapshotClans {
  let activeTotal = 0
  let totalMemberHouses = 0
  for (const clan of Object.values(state.clans)) {
    if (!clan || !clan.active) continue
    activeTotal++
    totalMemberHouses += clan.memberHouseIds.length
  }
  return { activeTotal, totalMemberHouses }
}
