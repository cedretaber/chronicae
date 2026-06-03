import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import { getHoldingDevelopment } from './holdingImprovementSelectors'
import type {
  ProvinceId,
  PolityId,
  HouseId,
  PersonId,
  LandContractId,
  HoldingId,
} from '../types/ids'
import type { LandContract, LandContractGrantor, Holding } from '../types/landContract'
import { ROOT_WORLD } from '../types/landContract'

// 調査 §4.1: byProvince (worldgen 凍結の province 単位 1 チェーン) を撤去。province 粒度の
// 表現が必要な箇所 (UI 表示・隣接推論) は dominant holding を province 代表とする。
// canonical な getProvinceDominantTerminalPolityId と同じ「weight 最大の terminal polity」を
// 支配者とし、その polity が terminal を握る holding のうち weight 最大 (tiebreak holdingId 昇順)
// を dominant holding とする。
export function getProvinceDominantHoldingId(
  state: WorldState,
  provinceId: ProvinceId,
): HoldingId | undefined {
  const province = state.provinces[provinceId]
  if (!province) return undefined
  const dominantPolityId = getProvinceDominantTerminalPolityId(state, provinceId)
  if (!dominantPolityId) return undefined
  let bestHoldingId: HoldingId | undefined
  let bestWeight = -Infinity
  for (const hid of province.holdingIds) {
    if (state.holdingTerminalPolityCache[hid] !== dominantPolityId) continue
    const w = state.holdings[hid]?.weight ?? 1
    if (
      bestHoldingId === undefined ||
      w > bestWeight ||
      (w === bestWeight && (hid as string) < (bestHoldingId as string))
    ) {
      bestWeight = w
      bestHoldingId = hid
    }
  }
  return bestHoldingId
}

// dominant holding の chain を province 代表チェーンとして返す (旧 byProvince 相当, 主に UI 表示)。
export function getProvinceLandContractChain(
  state: WorldState,
  provinceId: ProvinceId,
): LandContract[] {
  const holdingId = getProvinceDominantHoldingId(state, provinceId)
  if (!holdingId) return []
  return getHoldingLandContractChain(state, holdingId)
}

export function getProvinceRootContract(
  state: WorldState,
  provinceId: ProvinceId,
): LandContract | undefined {
  return getProvinceLandContractChain(state, provinceId)[0]
}

export function getProvinceTerminalPolityId(
  state: WorldState,
  provinceId: ProvinceId,
): PolityId | undefined {
  return getProvinceDominantTerminalPolityId(state, provinceId)
}

// land purchase 等の province 隣接推論で「province の代表 terminal contract」を返す。
// dominant holding の terminal contract。返却契約の granteePolityId は dominant polity と一致する。
export function getProvinceDominantTerminalContract(
  state: WorldState,
  provinceId: ProvinceId,
): LandContract | undefined {
  const holdingId = getProvinceDominantHoldingId(state, provinceId)
  if (!holdingId) return undefined
  const chain = getHoldingLandContractChain(state, holdingId)
  return chain[chain.length - 1]
}

export function getProvinceDominantTerminalPolityId(
  state: WorldState,
  provinceId: ProvinceId,
): PolityId | undefined {
  const province = state.provinces[provinceId]
  if (!province) return undefined
  if (province.holdingIds.length === 0) return undefined
  if (province.holdingIds.length === 1) {
    return state.holdingTerminalPolityCache[province.holdingIds[0]!]
  }
  const breakdown = getProvinceTerminalPolityBreakdown(state, provinceId)
  if (breakdown.length === 0) return undefined
  return breakdown[0]!.polityId
}

export function getProvinceTerminalPolityBreakdown(
  state: WorldState,
  provinceId: ProvinceId,
): Array<{ polityId: PolityId; holdingCount: number; weight: number }> {
  const province = state.provinces[provinceId]
  if (!province) return []
  const map = new Map<PolityId, { holdingCount: number; weight: number }>()
  for (const hid of province.holdingIds) {
    const polityId = state.holdingTerminalPolityCache[hid]
    if (!polityId) continue
    const holding = state.holdings[hid]
    const w = holding?.weight ?? 1
    const entry = map.get(polityId)
    if (entry) {
      entry.holdingCount++
      entry.weight += w
    } else {
      map.set(polityId, { holdingCount: 1, weight: w })
    }
  }
  return [...map.entries()]
    .map(([polityId, data]) => ({ polityId, ...data }))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight
      if (b.holdingCount !== a.holdingCount) return b.holdingCount - a.holdingCount
      return a.polityId.localeCompare(b.polityId)
    })
}

export function getProvinceRootPolityId(
  state: WorldState,
  provinceId: ProvinceId,
): PolityId | undefined {
  const root = getProvinceRootContract(state, provinceId)
  return root?.granteePolityId
}

export function getProvinceEffectiveOwnerHouseId(
  state: WorldState,
  provinceId: ProvinceId,
): HouseId | undefined {
  const terminalPolityId = getProvinceTerminalPolityId(state, provinceId)
  if (!terminalPolityId) return undefined
  const polity = state.polities[terminalPolityId]
  if (!polity) return undefined
  return polity.ownerHouseId
}

export function getPolityGrantedProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[] {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  const result: ProvinceId[] = []
  for (const id of contractIds) {
    const c = state.landContracts[id]
    if (!c) continue
    result.push(c.provinceId)
  }
  return result
}

export function getPolityTerminalProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[] {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  const result: ProvinceId[] = []
  for (const id of contractIds) {
    const c = state.landContracts[id]
    if (!c) continue
    if (state.landContractIndex.byParent[id] !== undefined) continue
    result.push(c.provinceId)
  }
  return result
}

// v0.37: terminal Holding 総数 (polity 直轄領の規模)。PolitySurplus の reserveTarget や
// 収入投影で共用する。
export function getPolityHoldingCount(state: WorldState, polityId: PolityId): number {
  let holdingCount = 0
  for (const pid of getPolityTerminalProvinceIds(state, polityId)) {
    const province = state.provinces[pid]
    if (province) holdingCount += province.holdingIds.length
  }
  return holdingCount
}

// v0.37: 1 回の余剰分配サイクルで Share holder に分配可能な額。
// politySurplusDistributionSystem と getHouseProjectedAnnualIncome の双方から呼ぶ
// 単一の正本 (式が二重定義で drift するのを防ぐ)。
// distributable = max(0, treasury - reserveTarget) * distributionRate
// reserveTarget = base + perHolding × holdingCount
export function getPolityDistributablePerCycle(
  state: WorldState,
  polityId: PolityId,
  config: SimulationConfig = defaultConfig,
): number {
  const polity = state.polities[polityId]
  if (!polity || !polity.active) return 0
  const {
    polityTreasuryReserveBase,
    polityTreasuryReservePerHolding,
    politySurplusDistributionRate,
  } = config
  const reserveTarget =
    polityTreasuryReserveBase +
    polityTreasuryReservePerHolding * getPolityHoldingCount(state, polityId)
  return Math.max(0, polity.treasury - reserveTarget) * politySurplusDistributionRate
}

export function getPolityOverlordProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[] {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  const result: ProvinceId[] = []
  for (const id of contractIds) {
    const c = state.landContracts[id]
    if (!c) continue
    if (state.landContractIndex.byParent[id] === undefined) continue
    result.push(c.provinceId)
  }
  return result
}

export function getHouseOwnedPolityIds(state: WorldState, houseId: HouseId): PolityId[] {
  return state.polityIndex.byOwnerHouse[houseId] ?? []
}

export function getHouseControlledProvinceIds(state: WorldState, houseId: HouseId): ProvinceId[] {
  const polityIds = getHouseOwnedPolityIds(state, houseId)
  const seen = new Set<string>()
  const result: ProvinceId[] = []
  for (const polityId of polityIds) {
    for (const provinceId of getPolityTerminalProvinceIds(state, polityId)) {
      const key = provinceId as string
      if (seen.has(key)) continue
      seen.add(key)
      result.push(provinceId)
    }
  }
  return result
}

export function getHouseRelevantProvinceIds(state: WorldState, houseId: HouseId): ProvinceId[] {
  const polityIds = getHouseOwnedPolityIds(state, houseId)
  const seen = new Set<string>()
  const result: ProvinceId[] = []
  for (const polityId of polityIds) {
    for (const provinceId of getPolityGrantedProvinceIds(state, polityId)) {
      const key = provinceId as string
      if (seen.has(key)) continue
      seen.add(key)
      result.push(provinceId)
    }
  }
  return result
}

export function getLandContractGrantor(
  state: WorldState,
  contractId: LandContractId,
): LandContractGrantor | undefined {
  const contract = state.landContracts[contractId]
  if (!contract) return undefined
  if (contract.parentContractId !== undefined) {
    const parent = state.landContracts[contract.parentContractId]
    if (!parent) return undefined
    return { kind: 'polity', id: parent.granteePolityId }
  }
  return { kind: 'root', id: contract.rootAuthorityId ?? ROOT_WORLD }
}

export function getGrantorRank(state: WorldState, grantor: LandContractGrantor): number {
  if (grantor.kind === 'root') return 0
  const polity = state.polities[grantor.id]
  if (!polity) return 0
  return polity.rank
}

export function isPlaceholderPerson(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  return person.kind === 'placeholder'
}

export function getHoldingTerminalPolityId(
  state: WorldState,
  holdingId: HoldingId,
): PolityId | undefined {
  return state.holdingTerminalPolityCache[holdingId]
}

export function getHoldingLandContractChain(
  state: WorldState,
  holdingId: HoldingId,
): LandContract[] {
  const ids = state.landContractIndex.byHolding[holdingId] ?? []
  const chain: LandContract[] = []
  for (const id of ids) {
    const contract = state.landContracts[id]
    if (!contract) continue
    chain.push(contract)
  }
  return chain
}

export function getProvincePrimaryHolding(
  state: WorldState,
  provinceId: ProvinceId,
): Holding | undefined {
  const province = state.provinces[provinceId]
  if (!province) return undefined
  const holdingId = province.holdingIds[0]
  if (!holdingId) return undefined
  return state.holdings[holdingId]
}

export function getProvinceHoldingsByKind(
  state: WorldState,
  provinceId: ProvinceId,
  kind: 'manor' | 'city',
): Holding[] {
  return getProvinceHoldings(state, provinceId).filter((h) => h.kind === kind)
}

export function getProvinceHoldings(state: WorldState, provinceId: ProvinceId): Holding[] {
  const province = state.provinces[provinceId]
  if (!province) return []
  const result: Holding[] = []
  for (const hid of province.holdingIds) {
    const h = state.holdings[hid]
    if (h) result.push(h)
  }
  return result
}

export function getProvincePolityControlFromHoldings(
  state: WorldState,
  provinceId: ProvinceId,
): number {
  const holdings = getProvinceHoldings(state, provinceId)
  if (holdings.length === 0) return 0
  let totalWeight = 0
  let weightedControl = 0
  for (const h of holdings) {
    totalWeight += h.weight
    weightedControl += h.polityControl * h.weight
  }
  return totalWeight > 0 ? weightedControl / totalWeight : 0
}

export function getProvinceDevelopmentFromHoldings(
  state: WorldState,
  provinceId: ProvinceId,
  config?: SimulationConfig,
): number {
  if (!config) return 0
  const holdings = getProvinceHoldings(state, provinceId)
  if (holdings.length === 0) return 0
  let totalWeight = 0
  let weightedDev = 0
  for (const h of holdings) {
    totalWeight += h.weight
    weightedDev += getHoldingDevelopment(state, config, h.id) * h.weight
  }
  return totalWeight > 0 ? weightedDev / totalWeight : 0
}

export function selectTargetHoldingInProvince(
  state: WorldState,
  provinceId: ProvinceId,
): HoldingId | undefined {
  const holdings = getProvinceHoldings(state, provinceId)
  if (holdings.length === 0) return undefined
  if (holdings.length === 1) return holdings[0]!.id
  let best = holdings[0]!
  for (let i = 1; i < holdings.length; i++) {
    const h = holdings[i]!
    if (h.weight > best.weight) best = h
  }
  return best.id
}
