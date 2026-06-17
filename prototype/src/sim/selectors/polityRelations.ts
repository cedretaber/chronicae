// v0.16 LandContract chain ベース。Province の polity/owner は chain の terminal から取得する。
// House の所属 Polity は polityIndex.byOwnerHouse (Polity.ownerHouseId 経由) で決まる。
// 仕様: docs/drafts/spec-v016-update.md §8, §9, §10
import type { WorldState } from '@sim/types/world'
import type { Polity } from '@sim/types/polity'
import { getPolityTerritorialStatus } from '@sim/types/polity'
import type { House } from '@sim/types/house'
import type { PolityId, HouseId, PersonId, ProvinceId } from '@sim/types/ids'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import {
  getProvinceTerminalPolityId,
  getProvinceEffectiveOwnerHouseId,
  getPolityGrantedProvinceIds,
  getPolityTerminalProvinceIds,
  getHouseOwnedPolityIds,
  getHouseControlledProvinceIds,
  getProvinceDevelopmentFromHoldings,
  getPolityHoldingCount,
} from './landContractSelectors'
import { getProvincePopulation } from './popSelectors'

// v0.45.2 — 2 つの polity の支配家 (ownerHouseId) が同一か。
// 同じ家が支配する polity 同士は hostile な play / war を起こさない (家が自分自身と争う
// 不自然の防止) ためのゲート共有 predicate。aim 選定 (goalSelectors)・project target 解決
// (taskProjectCompletion)・play 生成 (diplomaticPlayCreation)・war 化 (warCreationSystem)・
// mid-war 収束 (peaceSettlementSystem)・supporter 追加で同一式を共有する。
// commonwealth 等 ownerHouseId undefined の側があれば false (別家とみなす)。
export function politiesShareOwnerHouse(state: WorldState, a: PolityId, b: PolityId): boolean {
  const houseA = state.polities[a]?.ownerHouseId
  if (houseA === undefined) return false
  return houseA === state.polities[b]?.ownerHouseId
}

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

// §8.2 — Polity に関係する active House の一覧。
// 定義: Polity 自身の ownerHouseId に加え、その Polity が chain 上に出現する各 Holding の
// terminal owner House (= その Holding を terminal 支配する Polity の ownerHouseId) を含める。
// AnonymousHouse / system house は除外。
//
// Holding 粒度で判定する理由: 1 つの Province を複数 Polity が holding 単位で分有する場合
// (例: 反乱 commonwealth が Province 内の 1 holding だけを seizure した場合)、Province 全体の
// dominant owner House を採ると、その holding を支配しない Polity に他家が混入する。
// 旧実装 (getProvinceEffectiveOwnerHouseId を Province 単位で適用) は反乱国家の share holder に
// 独立元の国の支配家が現れるバグの原因だった。
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
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const holdingId of province.holdingIds) {
      // この Polity が当該 Holding の権利者 chain に出現するか
      const chainIds = state.landContractIndex.byHolding[holdingId] ?? []
      const polityInChain = chainIds.some(
        (cid) => state.landContracts[cid]?.granteePolityId === polityId,
      )
      if (!polityInChain) continue
      // 当該 Holding を terminal 支配する Polity の ownerHouse のみを加える
      const terminalPolityId = state.holdingTerminalPolityCache[holdingId]
      if (!terminalPolityId) continue
      const houseId = state.polities[terminalPolityId]?.ownerHouseId
      if (!houseId) continue
      const house = state.houses[houseId]
      if (!house || !house.active || house.kind === 'system') continue
      seen.add(houseId)
    }
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

// v0.47 §12.5 — House 一円支配集約の sink (集約先) Polity。
// getHousePrimaryPolityId とは別概念 (primary は seat 優先 / sink は最上位 rank 優先)。
// 判定: House owner Polity のうち active & territorial & non-commonwealth を、
//   rank 最上位 (数値最小) → terminal holding 数最大 → development 合計最大 → PolityId 昇順 で選ぶ。
export function getHouseDomainConsolidationSinkPolityId(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): PolityId | undefined {
  const owned = getHouseOwnedPolityIds(state, houseId)
  const cands: {
    polityId: PolityId
    rank: number
    holdingCount: number
    development: number
  }[] = []
  for (const polityId of owned) {
    const polity = state.polities[polityId]
    if (!polity || !polity.active) continue
    if (polity.kind === 'commonwealth') continue
    if (getPolityTerritorialStatus(polity) !== 'territorial') continue
    let dev = 0
    for (const provinceId of getPolityTerminalProvinceIds(state, polityId)) {
      dev += getProvinceDevelopmentFromHoldings(state, provinceId, config)
    }
    cands.push({
      polityId,
      rank: polity.rank,
      holdingCount: getPolityHoldingCount(state, polityId),
      development: dev,
    })
  }
  if (cands.length === 0) return undefined
  cands.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    if (b.holdingCount !== a.holdingCount) return b.holdingCount - a.holdingCount
    if (b.development !== a.development) return b.development - a.development
    return a.polityId.localeCompare(b.polityId)
  })
  return cands[0]?.polityId
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
