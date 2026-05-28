// v0.16 LandContract chain ベース。Province の polity/owner は chain の terminal から取得する。
// House の所属 Polity は polityIndex.byOwnerHouse (Polity.ownerHouseId 経由) で決まる。
// 仕様: docs/drafts/spec-v016-update.md §8, §9, §10
import type { WorldState } from '@sim/types/world'
import type { Polity } from '@sim/types/polity'
import type { House } from '@sim/types/house'
import type { PolityId, HouseId, PersonId, ProvinceId } from '@sim/types/ids'
import {
  getProvinceTerminalPolityId,
  getProvinceEffectiveOwnerHouseId,
  getPolityGrantedProvinceIds,
  getPolityTerminalProvinceIds,
  getHouseOwnedPolityIds,
  getHouseControlledProvinceIds,
  getProvinceDevelopmentFromHoldings,
} from './landContractSelectors'
import { getProvincePopulation } from './popSelectors'

// §8.1 — Province の terminal Polity
export function getProvincePolity(state: WorldState, provinceId: ProvinceId): Polity | undefined {
  const polityId = getProvinceTerminalPolityId(state, provinceId)
  if (!polityId) return undefined
  return state.polities[polityId]
}

// §8.1 — Province の実効 owner House (= terminal Polity の ownerHouseId)
export function getProvinceOwnerHouse(
  state: WorldState,
  provinceId: ProvinceId,
): House | undefined {
  const houseId = getProvinceEffectiveOwnerHouseId(state, provinceId)
  if (!houseId) return undefined
  return state.houses[houseId]
}

// §10 — Polity が grantee である Province の一覧。terminal だけでなく上位 chain 上のものも含む
export function getPolityProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[] {
  const result = [...getPolityGrantedProvinceIds(state, polityId)]
  result.sort((a, b) => a.localeCompare(b))
  return result
}

// Polity の terminal Province (chain の最下位 grantee)
export function getPolityTerminalProvinceIdsSorted(
  state: WorldState,
  polityId: PolityId,
): ProvinceId[] {
  const result = [...getPolityTerminalProvinceIds(state, polityId)]
  result.sort((a, b) => a.localeCompare(b))
  return result
}

// §8.2 — Polity に関係する active House の一覧。
// 定義: その Polity が grantee である Province の effective owner House (= terminal Polity の ownerHouseId)
// に加え、Polity 自身の ownerHouseId も含める。AnonymousHouse / system house は除外。
export function getPolityHouseIds(state: WorldState, polityId: PolityId): HouseId[] {
  const seen = new Set<string>()
  const polity = state.polities[polityId]
  if (polity?.ownerHouseId !== undefined) {
    const ownerHouse = state.houses[polity.ownerHouseId]
    if (ownerHouse && ownerHouse.active && ownerHouse.kind !== 'system') {
      seen.add(polity.ownerHouseId)
    }
  }
  for (const provinceId of getPolityGrantedProvinceIds(state, polityId)) {
    const houseId = getProvinceEffectiveOwnerHouseId(state, provinceId)
    if (!houseId) continue
    const house = state.houses[houseId]
    if (!house || !house.active || house.kind === 'system') continue
    seen.add(houseId)
  }
  return [...seen].sort((a, b) => a.localeCompare(b)).map((id) => id as HouseId)
}

// §8.2 — Polity に関係する alive Person 一覧。所属 House の memberIds を集約
export function getPolityPersonIds(state: WorldState, polityId: PolityId): PersonId[] {
  const houseIds = getPolityHouseIds(state, polityId)
  const result: PersonId[] = []
  for (const houseId of houseIds) {
    const house = state.houses[houseId]
    if (!house) continue
    for (const memberId of house.memberIds) {
      const person = state.persons[memberId]
      if (!person || !person.alive) continue
      result.push(memberId)
    }
  }
  result.sort((a, b) => a.localeCompare(b))
  return result
}

// §8.3 — House が対象 Polity 内に「所有」する Province。
// 定義: その Province の effective owner House が houseId かつ、polityId が chain 上に出現する。
export function getHouseProvinceIdsByPolity(
  state: WorldState,
  houseId: HouseId,
  polityId: PolityId,
): ProvinceId[] {
  const polityProvinceIds = new Set<string>(
    getPolityGrantedProvinceIds(state, polityId).map((id) => id as string),
  )
  const result: ProvinceId[] = []
  for (const provinceId of getHouseControlledProvinceIds(state, houseId)) {
    if (!polityProvinceIds.has(provinceId)) continue
    result.push(provinceId)
  }
  result.sort((a, b) => a.localeCompare(b))
  return result
}

// §8.3 — House が ownerHouseId である Polity の一覧
export function getHousePolityIds(state: WorldState, houseId: HouseId): PolityId[] {
  const house = state.houses[houseId]
  if (!house || !house.active) return []
  const result: PolityId[] = []
  for (const polityId of getHouseOwnedPolityIds(state, houseId)) {
    const polity = state.polities[polityId]
    if (!polity || !polity.active) continue
    result.push(polityId)
  }
  result.sort((a, b) => a.localeCompare(b))
  return result
}

// §8.3 — House の primary Polity。最も価値が大きい所有 Polity を選ぶ
export function getHousePrimaryPolityId(state: WorldState, houseId: HouseId): PolityId | undefined {
  const house = state.houses[houseId]
  if (!house || !house.active) return undefined
  const owned = getHousePolityIds(state, houseId)
  if (owned.length === 0) return undefined

  // 1) seatProvinceId の Polity を最優先
  const seat = state.provinces[house.seatProvinceId]
  if (seat) {
    const seatPolityId = getProvinceTerminalPolityId(state, seat.id)
    if (seatPolityId && owned.some((id) => (id as string) === (seatPolityId as string))) {
      return seatPolityId
    }
  }

  // 2) terminal Province 数の合計が最大の Polity
  // 3) 同数なら development 合計が最大
  // 4) それも同じなら PolityId 昇順
  const stats = new Map<
    string,
    { polityId: PolityId; provinceCount: number; development: number }
  >()
  for (const polityId of owned) {
    let count = 0
    let dev = 0
    for (const provinceId of getPolityTerminalProvinceIds(state, polityId)) {
      const province = state.provinces[provinceId]
      if (!province) continue
      count += 1
      dev += getProvinceDevelopmentFromHoldings(state, provinceId)
    }
    stats.set(polityId, { polityId, provinceCount: count, development: dev })
  }
  const entries = [...stats.values()]
  if (entries.length === 0) return owned[0]
  entries.sort((a, b) => {
    if (b.provinceCount !== a.provinceCount) return b.provinceCount - a.provinceCount
    if (b.development !== a.development) return b.development - a.development
    return a.polityId.localeCompare(b.polityId)
  })
  return entries[0]?.polityId
}

// §8.4 — Person が関係する Polity 一覧 (所属 House の getHousePolityIds に委譲)
export function getPersonRelevantPolityIds(state: WorldState, personId: PersonId): PolityId[] {
  const person = state.persons[personId]
  if (!person) return []
  if (!person.houseId) return []
  return getHousePolityIds(state, person.houseId)
}

// §8.4 — Person primary Polity (所属 House の getHousePrimaryPolityId に委譲)
export function getPersonPrimaryPolityId(
  state: WorldState,
  personId: PersonId,
): PolityId | undefined {
  const person = state.persons[personId]
  if (!person) return undefined
  if (!person.houseId) return undefined
  return getHousePrimaryPolityId(state, person.houseId)
}

// §9 — House の Polity 内拠点。対象 Polity 内に持つ Province から動的に選ぶ
export function getHouseSeatProvinceInPolity(
  state: WorldState,
  houseId: HouseId,
  polityId: PolityId,
): ProvinceId | undefined {
  const house = state.houses[houseId]
  if (!house) return undefined

  const candidates = getHouseProvinceIdsByPolity(state, houseId, polityId)
  if (candidates.length === 0) return undefined

  // 1) seatProvinceId が candidates に含まれるならそれを返す
  if (candidates.some((id) => (id as string) === (house.seatProvinceId as string))) {
    return house.seatProvinceId
  }

  // 2) development が最大の Province
  // 3) 同値なら人口が最大
  // 4) 同値なら ProvinceId 昇順
  const sorted = [...candidates].sort((a, b) => {
    const pa = state.provinces[a]
    const pb = state.provinces[b]
    if (!pa || !pb) return 0
    const devA = getProvinceDevelopmentFromHoldings(state, a)
    const devB = getProvinceDevelopmentFromHoldings(state, b)
    if (devB !== devA) return devB - devA
    const popA = getProvincePopulation(state, a)
    const popB = getProvincePopulation(state, b)
    if (popB !== popA) return popB - popA
    return a.localeCompare(b)
  })
  return sorted[0]
}
