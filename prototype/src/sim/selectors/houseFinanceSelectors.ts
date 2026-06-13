import type { WorldState } from '@sim/types/world'
import type { HouseId, PersonId } from '@sim/types/ids'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import { defaultConfig } from '@sim/config/defaultConfig'
import { getOfficeDefinition } from '@sim/config/officeDefinitions'
import { getActorInfluenceInPolity } from './influenceSelectors'
import { getHousePolityIds } from './polityRelations'
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
  // v0.42 §19.2: share 比例 → influence 比例の投影 (politySurplusDistribution の新分配と整合)。
  // 走査対象は家が土地で関与する polity (getHousePolityIds)。office / right のみで influence
  // entry を持つ polity の取り分は小さく、投影としては無視する (過小評価側に倒す)。
  let annual = 0
  for (const polityId of getHousePolityIds(state, houseId)) {
    const polity = state.polities[polityId]
    if (!polity || !polity.active) continue
    const distributable = getPolityDistributablePerCycle(state, polityId, config)
    if (distributable <= 0) continue
    const influenceRatio =
      getActorInfluenceInPolity(state, config, { kind: 'house', id: houseId }, polityId).percent /
      100
    if (influenceRatio <= 0) continue
    annual += influenceRatio * distributable * SURPLUS_DISTRIBUTIONS_PER_YEAR
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

// v0.48: job-seeking (代官候補 / obtain_office aim) 用の「実職」判定。
// leader 系役職 (house:leader / polity:leader) は地位であって給与 0 (officeDefinitions)。
// 収入を生む Polity を持つ家の家長は必ずその polity:leader を兼任し、家の年間収入 > 0 になる。
// よって leader 役職は「家の定常年間収入 > 0」のときだけ実職とみなす:
//   - 無領地の家の家長 / 名目 Polity (土地契約なし) の家長 → income 0 → 無役扱い
//     (給与 0 の肩書きが代官候補・obtain_office aim を塞ぐのを防ぐ)
//   - 実 Polity を持つ家の家長 → income > 0 → 実職 (代官等を兼ねない)
// 非 leader 役職 (administrator/treasurer/military/advisor) は有給の実職なので即 true。
// HoldingOffice (代官) は本判定の対象外 (呼び出し側が hasActiveHoldingOffice で別途確認)。
export function hasGainfulOffice(
  state: WorldState,
  personId: PersonId,
  config: SimulationConfig = defaultConfig,
): boolean {
  const ids = state.officeIndex.byHolderPerson[personId as string] ?? []
  let hasLeaderOffice = false
  for (const id of ids) {
    const o = state.officeAssignments[id]
    if (!o || !o.active) continue
    if (o.role !== 'leader') return true // 有給の実職を保持
    hasLeaderOffice = true
  }
  if (!hasLeaderOffice) return false // active office なし = 無役
  // leader 役職のみ: 家の定常収入があれば実職、なければ無役扱い
  const person = state.persons[personId]
  if (!person?.houseId) return false
  return getHouseProjectedAnnualIncome(state, person.houseId, config) > 0
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
