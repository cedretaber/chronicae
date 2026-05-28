import type { WorldState } from '../types/world'
import type { PolityId, HoldingId } from '../types/ids'
import type { ActivitySnapshot, ActivitySnapshotFaction, ActivitySnapshotPolity } from './types'
import { getPolityTerminalProvinceIds } from '../selectors/landContractSelectors'

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
      name: polity.nameKey,
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

  return {
    year,
    polities,
    factions,
    bailiffs: { normal: bailiffNormal, placeholder: bailiffPlaceholder, vacant: bailiffVacant },
    populationLiving,
    populationLivingNormal,
  }
}
