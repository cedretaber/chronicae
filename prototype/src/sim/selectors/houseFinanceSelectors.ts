import type { WorldState } from '@sim/types/world'
import type { HouseId } from '@sim/types/ids'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import { defaultConfig } from '@sim/config/defaultConfig'
import { getOfficeDefinition } from '@sim/config/officeDefinitions'
import { getHousePolitySharePercent } from './shareSelectors'
import { getPolityDistributablePerCycle } from './landContractSelectors'

// politySurplusDistributionSystem は 4 週ごと (= 年 12 回) に分配する。
// COMPENSATION_CALLS_PER_YEAR (officeCompensationSystem) と同値で、給与年額と直接比較できる。
const SURPLUS_DISTRIBUTIONS_PER_YEAR = 12

// v0.37: 家の「定常的な年間収入」の投影。
// 家が定期的に得る収入は PolitySurplusDistribution (share 比例) のみ
// (estate settlement や外交移転は不定期なので投影に含めない)。
// politySurplusDistributionSystem と同じ式を辿り、1 サイクル分の分配額を年額に換算する:
//   annual = Σ_polity (house の share% × distributablePerCycle) × 12
export function getHouseProjectedAnnualIncome(
  state: WorldState,
  houseId: HouseId,
  config: SimulationConfig = defaultConfig,
): number {
  const shareIds = state.shareIndex.byHolder[`house:${houseId}`] ?? []
  const seenPolities = new Set<string>()
  let annual = 0
  for (const shareId of shareIds) {
    const share = state.organizationShares[shareId]
    if (!share || share.organization.kind !== 'polity') continue
    const polityId = share.organization.id
    if (seenPolities.has(polityId)) continue
    seenPolities.add(polityId)

    const distributable = getPolityDistributablePerCycle(state, polityId, config)
    if (distributable <= 0) continue
    // getHousePolitySharePercent は polity 内の全 house share を合算した割合を返すため
    // (politySurplusDistributionSystem の per-share 合計と一致する)、polity ごとに 1 回処理する。
    const sharePct = getHousePolitySharePercent(state, polityId, houseId) / 100
    if (sharePct <= 0) continue
    annual += sharePct * distributable * SURPLUS_DISTRIBUTIONS_PER_YEAR
  }
  return annual
}

// v0.37: 家が抱える全 active な有給役職の年間給与合計 (baseSalary は年額)。
export function getHouseAnnualOfficeSalary(state: WorldState, houseId: HouseId): number {
  const ids = state.officeIndex.byOrganization[`house:${houseId}`] ?? []
  let total = 0
  for (const id of ids) {
    const office = state.officeAssignments[id]
    if (!office || !office.active) continue
    const def = getOfficeDefinition('house', office.role)
    if (def && def.baseSalary > 0) total += def.baseSalary
  }
  return total
}

// v0.37: 投影年間収支 (収入 − 役職給与)。UI 表示・任命可否判定の基礎。
export function getHouseProjectedAnnualBalance(
  state: WorldState,
  houseId: HouseId,
  config: SimulationConfig = defaultConfig,
): number {
  return (
    getHouseProjectedAnnualIncome(state, houseId, config) -
    getHouseAnnualOfficeSalary(state, houseId)
  )
}
