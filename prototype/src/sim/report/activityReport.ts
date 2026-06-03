import type { WorldState } from '../types/world'
import type { SimEvent } from '../types/event'
import { getFirstEntityId, getEntityIdsByKind } from '../types/event'
import type { SimulationConfig } from '../config/defaultConfig'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import type { PersonId, PolityId, HouseId } from '../types/ids'
import type {
  ActivityReport,
  ActivitySnapshot,
  BailiffActivityReport,
  FactionAggregate,
  FactionLifecycleReport,
  HouseActivityReport,
  OfficeChurnAggregate,
  PolityActivityReport,
  PopulationReport,
} from './types'

// v0.17.1 §observation: イベントログと final state から Activity Report を組み立てる。
// 入力:
//   finalState: 最終 tick 後の WorldState
//   events:      シミュレーション全期間の SimEvent[]
//   config:      シミュレーション設定 (主要パラメータを meta に焼き付ける)
//   snapshots:   任意の中間スナップショット (--report-snapshot 指定時のみ)
// 出力:
//   ActivityReport (JSON serializable)
export function buildActivityReport(
  finalState: WorldState,
  events: readonly SimEvent[],
  config: SimulationConfig,
  snapshots: readonly ActivitySnapshot[],
  meta: { seed: string; years: number },
): ActivityReport {
  const eventCounts: Record<string, number> = {}
  for (const e of events) {
    eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1
  }

  const officeAggregate: Record<string, OfficeChurnAggregate> = {}
  const polityAssignments = new Map<string, SimEvent[]>()
  const houseAssignments = new Map<string, SimEvent[]>()

  for (const e of events) {
    const polityId = getFirstEntityId(e, 'polity')
    const houseIdAtAssignment = getFirstEntityId(e, 'house')
    if (e.type === 'OFFICE_ASSIGNED') {
      const role = inferRoleFromEvent(e)
      bumpChurn(officeAggregate, role, 'assignments')
      if (polityId) {
        push(polityAssignments, polityId, e)
      } else if (houseIdAtAssignment) {
        push(houseAssignments, houseIdAtAssignment, e)
      }
    } else if (e.type === 'OFFICE_REVOKED') {
      const role = inferRoleFromEvent(e)
      bumpChurn(officeAggregate, role, 'revokes')
    } else if (e.type === 'OFFICE_TERM_ENDED') {
      bumpChurn(officeAggregate, 'unknown', 'termEnds')
    }
  }

  const polity = buildPolityReports(finalState, polityAssignments)
  const house = buildHouseReports(finalState, houseAssignments)
  const faction = buildFactionReport(finalState, events, meta.years)
  const bailiff = buildBailiffReport(finalState, events)
  const population = buildPopulationReport(finalState, events)

  const report: ActivityReport = {
    meta: {
      seed: meta.seed,
      years: meta.years,
      finalYear: finalState.currentYear,
      finalWeekOfYear: finalState.currentWeekOfYear,
      keyConfig: {
        factionBailiffNominationWeight: config.factionBailiffNominationWeight,
        factionNominationPowerThreshold: config.factionNominationPowerThreshold,
        polityOfficeMaxByRank: config.polityOfficeMaxByRank,
        targetLivingPersons: config.targetLivingPersons,
        targetHouselessPersons: config.targetHouselessPersons,
        adultAge: config.adultAge,
      },
    },
    eventCounts,
    office: {
      aggregateByRole: officeAggregate,
      polity,
      house,
    },
    faction,
    bailiff,
    population,
  }
  if (snapshots.length > 0) {
    report.snapshots = [...snapshots]
  }
  return report
}

function inferRoleFromEvent(e: SimEvent): string {
  // emit 側 (appointmentSystem / officeTermSystem / organizationConsistencySystem) は
  // role を nameParam('role', `${orgKind}_${officeRole}`) で渡す (例 'polity_administrator')。
  // prefix を剥がした残りが OfficeRole = カテゴリ ('administrator' | 'treasurer' | ...) に一致する。
  const role = e.messageParams?.role
  if (role && typeof role === 'object' && 'kind' in role && role.kind === 'name') {
    const underscore = role.key.indexOf('_')
    return underscore >= 0 ? role.key.slice(underscore + 1) : role.key
  }
  return 'unknown'
}

function bumpChurn(
  agg: Record<string, OfficeChurnAggregate>,
  role: string,
  field: keyof OfficeChurnAggregate,
): void {
  if (!agg[role]) agg[role] = { assignments: 0, revokes: 0, termEnds: 0 }
  agg[role][field]++
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const slot = map.get(key)
  if (slot) slot.push(value)
  else map.set(key, [value])
}

function buildPolityReports(
  finalState: WorldState,
  assignmentsByPolity: Map<string, SimEvent[]>,
): PolityActivityReport[] {
  const result: PolityActivityReport[] = []
  for (const polityIdStr of Object.keys(finalState.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = finalState.polities[polityId]
    if (!polity) continue
    const events = assignmentsByPolity.get(polityIdStr) ?? []
    const byRole: Record<string, { assignments: number; uniqueHolders: Set<string> }> = {}
    const houseDist: Record<string, number> = {}
    for (const e of events) {
      const role = inferRoleFromEvent(e)
      if (!byRole[role]) byRole[role] = { assignments: 0, uniqueHolders: new Set<string>() }
      byRole[role].assignments++
      const holder = getFirstEntityId(e, 'person')
      if (holder) byRole[role].uniqueHolders.add(holder)
      const houseId = getFirstEntityId(e, 'house')
      if (houseId) houseDist[houseId] = (houseDist[houseId] ?? 0) + 1
    }
    const officesByRole: Record<string, { assignments: number; uniqueHolders: number }> = {}
    for (const [role, agg] of Object.entries(byRole)) {
      officesByRole[role] = { assignments: agg.assignments, uniqueHolders: agg.uniqueHolders.size }
    }
    let ownerCount = 0
    let total = 0
    for (const [hid, count] of Object.entries(houseDist)) {
      total += count
      if (polity.ownerHouseId !== undefined && hid === polity.ownerHouseId) {
        ownerCount += count
      }
    }
    result.push({
      polityId: polityIdStr,
      name: polity.nameKey,
      rank: polity.rank,
      active: polity.active,
      ownerHouseId: polity.ownerHouseId,
      officesByRole,
      holderHouseDistribution: houseDist,
      ownerHouseHoldRatio: total > 0 ? ownerCount / total : 0,
    })
  }
  return result
}

function buildHouseReports(
  finalState: WorldState,
  assignmentsByHouse: Map<string, SimEvent[]>,
): HouseActivityReport[] {
  const result: HouseActivityReport[] = []
  for (const houseIdStr of Object.keys(finalState.houses).sort()) {
    const houseId = houseIdStr as HouseId
    const house = finalState.houses[houseId]
    if (!house) continue
    const events = assignmentsByHouse.get(houseIdStr) ?? []
    // House Office: polityIds[0] が無いものだけが House Office なので、既に
    // assignmentsByHouse 側に振り分け済み (buildActivityReport で polityIds[0] あり = Polity)
    const byRole: Record<string, { assignments: number; uniqueHolders: Set<string> }> = {}
    for (const e of events) {
      const role = inferRoleFromEvent(e)
      if (!byRole[role]) byRole[role] = { assignments: 0, uniqueHolders: new Set<string>() }
      byRole[role].assignments++
      const holder = getFirstEntityId(e, 'person')
      if (holder) byRole[role].uniqueHolders.add(holder)
    }
    const officesByRole: Record<string, { assignments: number; uniqueHolders: number }> = {}
    for (const [role, agg] of Object.entries(byRole)) {
      officesByRole[role] = { assignments: agg.assignments, uniqueHolders: agg.uniqueHolders.size }
    }
    const kind: 'normal' | 'system' = house.kind === 'system' ? 'system' : 'normal'
    result.push({
      houseId: houseIdStr,
      name: house.nameKey,
      active: house.active,
      kind,
      officesByRole,
    })
  }
  return result
}

function buildFactionReport(
  finalState: WorldState,
  events: readonly SimEvent[],
  totalYears: number,
): ActivityReport['faction'] {
  const aggregate: FactionAggregate = {
    totalFormed: 0,
    totalDissolved: 0,
    totalLeaderChanges: 0,
    totalRecruitments: 0,
    totalAbandonments: 0,
    totalFundsShortages: 0,
    totalBankruptcies: 0,
    avgLifespanYears: 0,
  }
  // faction-level イベント集計
  type FactionStats = {
    leaderChanges: number
    recruitments: number
    abandonments: number
    fundsShortages: number
    bankruptcies: number
    foundedYear: number
    dissolvedYear: number | undefined
    recruitHouses: Set<string>
  }
  const byFaction = new Map<string, FactionStats>()

  // FACTION_FOUNDED は faction.id を辿るのが難しい (event は actor/house のみ) ので
  // factions テーブルから直接探す。foundedYear は foundingWeek から逆算。
  for (const fidStr of Object.keys(finalState.factions).sort()) {
    const f = finalState.factions[fidStr as keyof typeof finalState.factions]
    if (!f) continue
    byFaction.set(fidStr, {
      leaderChanges: 0,
      recruitments: 0,
      abandonments: 0,
      fundsShortages: 0,
      bankruptcies: 0,
      foundedYear: Math.floor(f.foundingWeek / WEEKS_PER_YEAR),
      dissolvedYear: undefined,
      recruitHouses: new Set<string>(),
    })
  }

  // event → faction の対応付け: actorIds に含まれる Person から
  // factionIndex を辿って判定する (final state ベースの近似)
  const findFactionFromActors = (e: SimEvent): string | undefined => {
    const personIds = getEntityIdsByKind(e, 'person')
    for (const actorId of personIds) {
      const factionIds = finalState.factionIndex.byLeader[actorId as PersonId]
      if (factionIds && factionIds.length > 0) {
        const first = factionIds[0]
        if (first) return first
      }
      const membershipIds = finalState.factionIndex.byMember[actorId as PersonId]
      if (membershipIds && membershipIds.length > 0) {
        for (const mid of membershipIds) {
          const m = finalState.factionMemberships[mid]
          if (m) return m.factionId
        }
      }
    }
    return undefined
  }

  for (const e of events) {
    switch (e.type) {
      case 'FACTION_FOUNDED':
        aggregate.totalFormed++
        break
      case 'FACTION_DISSOLVED': {
        aggregate.totalDissolved++
        const fid = findFactionFromActors(e)
        if (fid) {
          const s = byFaction.get(fid)
          if (s) s.dissolvedYear = e.year
        }
        break
      }
      case 'FACTION_LEADER_CHANGED': {
        aggregate.totalLeaderChanges++
        const fid = findFactionFromActors(e)
        if (fid) {
          const s = byFaction.get(fid)
          if (s) s.leaderChanges++
        }
        break
      }
      case 'PERSON_RECRUITED_TO_FACTION': {
        aggregate.totalRecruitments++
        const fid = findFactionFromActors(e)
        if (fid) {
          const s = byFaction.get(fid)
          if (s) {
            s.recruitments++
            const houseId = getFirstEntityId(e, 'house')
            if (houseId) s.recruitHouses.add(houseId)
          }
        }
        break
      }
      case 'FACTION_MEMBER_ABANDONED': {
        aggregate.totalAbandonments++
        const fid = findFactionFromActors(e)
        if (fid) {
          const s = byFaction.get(fid)
          if (s) s.abandonments++
        }
        break
      }
      case 'FACTION_FUNDS_SHORTAGE': {
        aggregate.totalFundsShortages++
        const fid = findFactionFromActors(e)
        if (fid) {
          const s = byFaction.get(fid)
          if (s) s.fundsShortages++
        }
        break
      }
      case 'FACTION_LEADER_BANKRUPT': {
        aggregate.totalBankruptcies++
        const fid = findFactionFromActors(e)
        if (fid) {
          const s = byFaction.get(fid)
          if (s) s.bankruptcies++
        }
        break
      }
      default:
        break
    }
  }

  const factions: FactionLifecycleReport[] = []
  let lifespanSum = 0
  let lifespanCount = 0
  for (const [fidStr, s] of byFaction) {
    const f = finalState.factions[fidStr as keyof typeof finalState.factions]
    if (!f) continue
    const leader = finalState.persons[f.leaderPersonId]
    const factionName = finalState.persons[f.leaderPersonId]?.nameKey ?? f.id
    let memberCount = 0
    for (const m of Object.values(finalState.factionMemberships)) {
      if (m && m.active && m.factionId === f.id) memberCount++
    }
    const lifespan = f.active
      ? finalState.currentYear - s.foundedYear
      : (s.dissolvedYear ?? finalState.currentYear) - s.foundedYear
    if (s.foundedYear >= finalState.currentYear - totalYears) {
      lifespanSum += Math.max(0, lifespan)
      lifespanCount++
    }
    factions.push({
      factionId: fidStr,
      name: factionName,
      active: f.active,
      leaderPersonId: f.leaderPersonId,
      leaderHouseId: leader?.houseId,
      foundedYear: s.foundedYear,
      dissolvedYear: s.dissolvedYear,
      lifespanYears: Math.max(0, lifespan),
      leaderChanges: s.leaderChanges,
      recruitments: s.recruitments,
      abandonments: s.abandonments,
      fundsShortages: s.fundsShortages,
      bankruptcies: s.bankruptcies,
      uniqueRecruitHouses: s.recruitHouses.size,
      finalMemberCount: memberCount,
    })
  }
  aggregate.avgLifespanYears = lifespanCount > 0 ? lifespanSum / lifespanCount : 0
  return { aggregate, factions }
}

function buildBailiffReport(
  finalState: WorldState,
  events: readonly SimEvent[],
): BailiffActivityReport {
  let finalNormalCount = 0
  let finalPlaceholderCount = 0
  let finalVacantCount = 0
  for (const holdingId of Object.keys(finalState.holdings)) {
    const assignmentId =
      finalState.holdingOfficeIndex.byHolding[
        holdingId as keyof typeof finalState.holdingOfficeIndex.byHolding
      ]
    if (!assignmentId) {
      finalVacantCount++
      continue
    }
    const a = finalState.holdingOfficeAssignments[assignmentId]
    if (!a || !a.active) {
      finalVacantCount++
      continue
    }
    const holder = finalState.persons[a.holderPersonId]
    if (!holder) {
      finalVacantCount++
      continue
    }
    if (holder.kind === 'placeholder') finalPlaceholderCount++
    else finalNormalCount++
  }

  let totalAppointments = 0
  let totalVacated = 0
  let totalPlaceholderInstalled = 0
  let ownerHouseSource = 0
  let otherHouseSource = 0
  let unknownSource = 0
  for (const e of events) {
    if (e.type === 'BAILIFF_APPOINTED') {
      totalAppointments++
      const polityId = getFirstEntityId(e, 'polity')
      const houseAtAssignment = getFirstEntityId(e, 'house')
      if (polityId && houseAtAssignment) {
        const polity = finalState.polities[polityId as PolityId]
        if (polity && polity.ownerHouseId === houseAtAssignment) ownerHouseSource++
        else otherHouseSource++
      } else {
        unknownSource++
      }
    } else if (e.type === 'BAILIFF_VACATED') {
      totalVacated++
    } else if (e.type === 'BAILIFF_PLACEHOLDER_INSTALLED') {
      totalPlaceholderInstalled++
    }
  }

  return {
    finalNormalCount,
    finalPlaceholderCount,
    finalVacantCount,
    totalAppointments,
    totalVacated,
    totalPlaceholderInstalled,
    appointmentBySource: {
      ownerHouse: ownerHouseSource,
      otherHouse: otherHouseSource,
      unknown: unknownSource,
    },
  }
}

function buildPopulationReport(
  finalState: WorldState,
  events: readonly SimEvent[],
): PopulationReport {
  let finalLivingNormal = 0
  let finalLivingPlaceholder = 0
  for (const personId of finalState.livingPersonIds) {
    const p = finalState.persons[personId]
    if (!p) continue
    if (p.kind === 'placeholder') finalLivingPlaceholder++
    else finalLivingNormal++
  }
  const finalDeadCount =
    Object.keys(finalState.persons).length - finalLivingNormal - finalLivingPlaceholder

  let totalBirths = 0
  let totalDeaths = 0
  let totalMarriages = 0
  let totalFadedFromHistory = 0
  let totalBornInObscurity = 0
  let totalHouseExtinct = 0
  let totalHouseSplit = 0
  let totalHouseMembersDispersed = 0
  for (const e of events) {
    switch (e.type) {
      case 'CHILD_BORN':
        totalBirths++
        break
      case 'PERSON_DIED':
      case 'IMPORTANT_PERSON_DIED':
        totalDeaths++
        break
      case 'MARRIAGE_FORMED':
        totalMarriages++
        break
      case 'PERSON_FADED_FROM_HISTORY':
        totalFadedFromHistory++
        break
      case 'PERSON_BORN_IN_OBSCURITY':
        totalBornInObscurity++
        break
      case 'HOUSE_EXTINCT':
        totalHouseExtinct++
        break
      case 'HOUSE_SPLIT':
        totalHouseSplit++
        break
      case 'HOUSE_MEMBERS_DISPERSED':
        totalHouseMembersDispersed++
        break
      default:
        break
    }
  }

  return {
    finalLivingNormal,
    finalLivingPlaceholder,
    finalDeadCount,
    totalBirths,
    totalDeaths,
    totalMarriages,
    totalFadedFromHistory,
    totalBornInObscurity,
    totalHouseExtinct,
    totalHouseSplit,
    totalHouseMembersDispersed,
  }
}
