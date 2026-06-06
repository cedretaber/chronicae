// v0.42 §5: Polity Influence read-model selector。
//
// 旧 shareUpdateSystem の polity 枝 (年次再計算 cache) を「随時計算の selector」に昇格し、
// domain 別 breakdown に分解したもの。係数は polityShare* 流用 (config は polityInfluence* — §18)。
// 旧実装の shareYearlyRetentionRate は捨てる (全 entry に同係数が掛かるため percent に無意味)。
//
// entry 母集合 (§5.3) = 以下の和集合:
//   - getPolityHouseIds (土地ベース) の active House
//   - 対象 Polity の active office holder の House (houseless なら Person entry)
//   - 対象 Polity の PoliticalRight holder (House / houseless Person)
//   - 対象 Polity に anchor された active Faction の leader の House
//   - ownerHouseId === undefined の polity の leader Person (commonwealth / 反乱政体)
//   - ownerHouse / 非 ownerHouse 出身 leader の House (ruler domain)
//
// perf (§21.2): province / office / right / faction を歩くため、候補者ループ内で
// 何度も呼ばない。呼出側は polity ごとに 1 回計算して cache を渡すこと。

import type { WorldState } from '../types/world'
import type { PolityId, PersonId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import type {
  PolityInfluenceBreakdown,
  PolityInfluenceDomain,
  PolityInfluenceEntry,
  PolityInfluenceHolderRef,
} from '../types/influence'
import { polityInfluenceHolderKey } from '../types/influence'
import { isLivingPerson } from '../types/person'
import {
  getOfficeAssignments,
  getPolityLeader,
  getHouseLeader,
  getHousePolityOfficeOverlapScore,
} from './officeSelectors'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'
import {
  getPolityHouseIds,
  getHouseProvinceIdsByPolity,
  getPolityProvinceIds,
} from './polityRelations'
import { getRightsByPolity } from './politicalRightSelectors'
import { PLACEHOLDER_PERSON_ID } from '../types/person'

type EntryAccumulator = {
  holder: PolityInfluenceHolderRef
  byDomain: Partial<Record<PolityInfluenceDomain, number>>
}

export function getPolityInfluenceBreakdown(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
): PolityInfluenceBreakdown {
  const polity = state.polities[polityId]
  if (!polity || !polity.active) {
    return { polityId, entries: [], totalScore: 0 }
  }

  const entries = new Map<string, EntryAccumulator>()

  function ensureEntry(holder: PolityInfluenceHolderRef): EntryAccumulator {
    const key = polityInfluenceHolderKey(holder)
    let entry = entries.get(key)
    if (!entry) {
      entry = { holder, byDomain: {} }
      entries.set(key, entry)
    }
    return entry
  }

  function add(holder: PolityInfluenceHolderRef, domain: PolityInfluenceDomain, value: number) {
    if (value === 0) return
    const entry = ensureEntry(holder)
    entry.byDomain[domain] = (entry.byDomain[domain] ?? 0) + value
  }

  // person → 寄与先 holder (House 所属なら House、houseless なら Person entry — §5.3)
  function holderForPerson(personId: PersonId): PolityInfluenceHolderRef | undefined {
    const person = state.persons[personId]
    if (!isLivingPerson(person)) return undefined
    if (person.houseId !== undefined) {
      const house = state.houses[person.houseId]
      if (house && house.active) return { kind: 'house', id: person.houseId }
      return undefined
    }
    return { kind: 'person', id: personId }
  }

  // --- 母集合: 土地ベースの House ---
  const landHouseIds = getPolityHouseIds(state, polityId)
  for (const houseId of landHouseIds) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue
    ensureEntry({ kind: 'house', id: houseId })
  }

  // --- ruler domain (§5.4) ---
  const leaderId = getPolityLeader(state, polityId)
  if (polity.ownerHouseId !== undefined) {
    const ownerHouse = state.houses[polity.ownerHouseId]
    if (ownerHouse && ownerHouse.active) {
      add(
        { kind: 'house', id: polity.ownerHouseId },
        'ruler',
        config.polityInfluenceOwnerHouseBonus,
      )
    }
    // 非 ownerHouse 出身 leader の家に補正 (leader ∈ ownerHouse なら二重計上しない)
    if (leaderId !== undefined) {
      const leader = state.persons[leaderId]
      if (
        isLivingPerson(leader) &&
        leader.houseId !== undefined &&
        leader.houseId !== polity.ownerHouseId
      ) {
        const leaderHouse = state.houses[leader.houseId]
        if (leaderHouse && leaderHouse.active) {
          add(
            { kind: 'house', id: leader.houseId },
            'ruler',
            config.polityInfluenceLeaderHouseBonus,
          )
        }
      }
    }
  } else if (leaderId !== undefined) {
    // commonwealth / 反乱政体: leader Person を直接 entry にする (§5.3)
    const leader = state.persons[leaderId]
    if (isLivingPerson(leader)) {
      add({ kind: 'person', id: leaderId }, 'ruler', config.polityInfluenceOwnerHouseBonus)
    }
  }

  // --- office domain (§5.4 — leader 除外、overlap は office domain への加算) ---
  const officeAssignments = getOfficeAssignments(state, { kind: 'polity', id: polityId }).filter(
    (o) => o.active && o.role !== 'leader',
  )
  for (const office of officeAssignments) {
    const holder = holderForPerson(office.holderPersonId)
    if (!holder) continue
    add(holder, 'office', config.polityInfluenceOfficeFactor)
    // military domain: polity:military office holder (office domain と重複計上 — §5.4 で許容)
    if (office.role === 'military') {
      add(holder, 'military', config.polityInfluenceMilitaryOfficeBonus)
    }
  }
  // overlap bonus: 旧実装は share 全体への乗算だったが、v0.42 では office 寄与への
  // 乗算相当を office domain に加算する (officeCount × factor × overlap × bonusMax)。
  for (const [key, entry] of entries) {
    if (entry.holder.kind !== 'house') continue
    const officeScore = entry.byDomain.office ?? 0
    if (officeScore === 0) continue
    const overlap = getHousePolityOfficeOverlapScore(state, entry.holder.id, polityId)
    if (overlap <= 0) continue
    const bonus = officeScore * overlap * config.polityInfluenceOfficeOverlapBonusMax
    entry.byDomain.office = officeScore + bonus
    entries.set(key, entry)
  }

  // --- PoliticalRight: military / land_administration domain (§5.4) ---
  for (const right of getRightsByPolity(state, polityId)) {
    const holder: PolityInfluenceHolderRef | undefined =
      right.holder.kind === 'house'
        ? state.houses[right.holder.id]?.active
          ? { kind: 'house', id: right.holder.id }
          : undefined
        : holderForPerson(right.holder.id)
    if (!holder) continue
    switch (right.target.kind) {
      case 'regiment': {
        // destroyed は寄与 0 (right は存続 — §11.3)
        const regiment = state.regiments[right.target.regimentId]
        if (regiment && regiment.status === 'active') {
          add(holder, 'military', config.polityInfluenceRegimentControlFactor)
        } else {
          ensureEntry(holder)
        }
        break
      }
      case 'holding_office_role':
        add(holder, 'land_administration', config.polityInfluenceHoldingOfficeAppointmentFactor)
        break
      case 'polity_office_role':
        // appointment right 自体の influence 寄与は office domain に含めない (任命権の
        // 行使結果 = office holder として現れる)。母集合への参加のみ。
        ensureEntry(holder)
        break
    }
  }

  // --- land_administration: 現職 bailiff の House (§5.4) ---
  for (const provinceId of getPolityProvinceIds(state, polityId)) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const holdingId of province.holdingIds) {
      if (state.holdingTerminalPolityCache[holdingId] !== polityId) continue
      const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]
      if (assignmentId === undefined) continue
      const assignment = state.holdingOfficeAssignments[assignmentId]
      if (!assignment || !assignment.active) continue
      if (assignment.holderPersonId === PLACEHOLDER_PERSON_ID) continue
      const holder = holderForPerson(assignment.holderPersonId)
      if (!holder) continue
      add(holder, 'land_administration', config.polityInfluenceHoldingOfficeAppointmentFactor)
    }
  }

  // --- faction domain: anchor faction leader の House のみ (§5.4 最小実装) ---
  for (const factionId of state.factionIndex.byPolity[polityId] ?? []) {
    const faction = state.factions[factionId]
    if (!faction || !faction.active) continue
    const holder = holderForPerson(faction.leaderPersonId)
    if (!holder || holder.kind !== 'house') continue
    add(holder, 'faction', config.polityInfluenceFactionFactor)
  }

  // --- base / landed_power / wealth / prestige: House entry に一律 (§5.4) ---
  for (const entry of entries.values()) {
    if (entry.holder.kind !== 'house') continue
    const house = state.houses[entry.holder.id]
    if (!house || !house.active) continue
    entry.byDomain.base = (entry.byDomain.base ?? 0) + config.polityInfluenceBase
    // landed_power: 対象 Polity 内限定 (§12.3 踏襲) + military proxy (province 数ベース)
    const provinceCount = getHouseProvinceIdsByPolity(state, entry.holder.id, polityId).length
    if (provinceCount > 0) {
      const landed =
        provinceCount * config.polityInfluenceProvinceFactor +
        provinceCount * 10 * config.polityInfluenceMilitaryFactor
      entry.byDomain.landed_power = (entry.byDomain.landed_power ?? 0) + landed
    }
    if (house.wealth > 0) {
      entry.byDomain.wealth =
        (entry.byDomain.wealth ?? 0) + house.wealth * config.polityInfluenceWealthFactor
    }
    if (house.legacyPrestige > 0) {
      entry.byDomain.prestige =
        (entry.byDomain.prestige ?? 0) + house.legacyPrestige * config.polityInfluencePrestigeFactor
    }
  }

  // --- 集計 ---
  const built: PolityInfluenceEntry[] = []
  let totalScore = 0
  for (const entry of entries.values()) {
    let total = 0
    for (const v of Object.values(entry.byDomain)) total += v ?? 0
    built.push({ holder: entry.holder, byDomain: entry.byDomain, total, percent: 0 })
    totalScore += total
  }
  for (const e of built) {
    e.percent = totalScore > 0 ? (e.total / totalScore) * 100 : 0
  }
  built.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return polityInfluenceHolderKey(a.holder).localeCompare(polityInfluenceHolderKey(b.holder))
  })

  return { polityId, entries: built, totalScore }
}

export function getActorInfluenceInPolity(
  state: WorldState,
  config: SimulationConfig,
  actor: PolityInfluenceHolderRef,
  polityId: PolityId,
): { score: number; percent: number } {
  const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
  return getActorInfluenceFromBreakdown(breakdown, actor)
}

// 前計算済み breakdown から actor の influence を引く (候補者ループでの再計算回避 — §21.2)。
export function getActorInfluenceFromBreakdown(
  breakdown: PolityInfluenceBreakdown,
  actor: PolityInfluenceHolderRef,
): { score: number; percent: number } {
  const key = polityInfluenceHolderKey(actor)
  const entry = breakdown.entries.find((e) => polityInfluenceHolderKey(e.holder) === key)
  if (!entry) return { score: 0, percent: 0 }
  return { score: entry.total, percent: entry.percent }
}

// v0.43 §9.3: Polity の「targetPolityId への influence 加重意見」(-100..100)。
//   breakdown の各 holder の attitude を influence percent で加重平均する。
//   - Person holder → 本人の attitude / House holder → house leader の attitude
//   - leader 不在の House entry は weight ごと除外 (中立 0 と混同しない)
//   - 有効 holder が 0 なら 0 (中立)
//   - breakdown.entries の組込ソート順 (total 降順 + holder key 昇順) のまま畳み込む (決定論)
//   v0.43 では joinScore の休眠項 (weight 0) として配線される。呼出側は polity ごとに
//   breakdown を 1 回計算して渡すこと (§21.2 と同じ規律)。
export function getWeightedOpinionFromInfluenceBreakdown(
  state: WorldState,
  breakdown: PolityInfluenceBreakdown,
  targetPolityId: PolityId,
): number {
  let weightedSum = 0
  let weightTotal = 0
  for (const entry of breakdown.entries) {
    const personId =
      entry.holder.kind === 'person' ? entry.holder.id : getHouseLeader(state, entry.holder.id)
    if (personId === undefined) continue
    const person = state.persons[personId]
    if (!isLivingPerson(person)) continue
    const attitude = getAttitudeOrDefault(state, person, {
      kind: 'polity',
      id: targetPolityId,
    })
    // opinion 数値化 (§9.3): 0.7*affection + 0.3*respect、clamp -100..100
    const opinion = Math.max(-100, Math.min(100, 0.7 * attitude.affection + 0.3 * attitude.respect))
    weightedSum += opinion * entry.percent
    weightTotal += entry.percent
  }
  if (weightTotal <= 0) return 0
  return weightedSum / weightTotal
}

export function getDominantInfluenceHolder(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  domain?: PolityInfluenceDomain,
): PolityInfluenceEntry | undefined {
  return getTopInfluenceHoldersInPolity(state, config, polityId, 1, domain)[0]
}

export function getTopInfluenceHoldersInPolity(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  limit?: number,
  domain?: PolityInfluenceDomain,
): PolityInfluenceEntry[] {
  const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
  let list = breakdown.entries
  if (domain !== undefined) {
    list = [...list]
      .filter((e) => (e.byDomain[domain] ?? 0) > 0)
      .sort((a, b) => {
        const diff = (b.byDomain[domain] ?? 0) - (a.byDomain[domain] ?? 0)
        if (diff !== 0) return diff
        return polityInfluenceHolderKey(a.holder).localeCompare(polityInfluenceHolderKey(b.holder))
      })
  }
  return limit !== undefined ? list.slice(0, limit) : list
}

// 母集合に House entry が 1 つでもあるか (§14.2 — commonwealth surplus 判定などに使う)。
export function hasHouseInfluenceEntry(breakdown: PolityInfluenceBreakdown): boolean {
  return breakdown.entries.some((e) => e.holder.kind === 'house')
}
