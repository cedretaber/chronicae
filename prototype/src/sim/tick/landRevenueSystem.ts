import type { TickContext } from './context'
import type { ProvinceId, PolityId, HoldingId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { PopClass } from '../types/popGroup'
import { calcTreasurerTaxEfficiency } from '../selectors/personAbilityEffects'
import { getProvinceProduction } from '../selectors/popEconomySelectors'
import { getProvinceAveragePopWealth, getProvinceUnrest } from '../selectors/popSelectors'
import {
  getHoldingLandContractChain,
  isPlaceholderPerson,
} from '../selectors/landContractSelectors'
import {
  adjustProvincePopWealth,
  adjustProvincePopUnrest,
  adjustProvincePopWealthByClass,
} from '../mutations/popMutations'
import { addPersonWealth } from '../mutations/personMutations'
import { defaultLandContractConfig } from '../config/landContractConfig'
import { getProvincePolityControlFromHoldings } from '../selectors/landContractSelectors'

// v0.16 §18: LandRevenueSystem
// 各 Province の生産物を per-Holding chain 上の Polity に配る。
// 1) 各 Holding について production weight-share * polityControl を一次徴収
// 2) 各 Holding の chain を terminal → root と逆順に走査し、taxRateToGrantor の比率で grantor に上納
// 3) root contract の taxRateToGrantor は 0 のため、最終的に world (実体なし) に流れる分は捨てる
// 4) 残りは Province の POP に再分配 (旧 retainedWealthGainByClass を流用)
// 5) 過徴税ペナルティは polityControl 単独判定で継続 (Province 単位)
export function runLandRevenueSystem(ctx: TickContext): TickContext {
  const treasuryDeltas = new Map<PolityId, number>()
  let currentState = ctx.state

  for (const provinceId of Object.keys(ctx.state.provinces).sort() as ProvinceId[]) {
    const province = ctx.state.provinces[provinceId]
    if (!province) continue

    const production = getProvinceProduction(ctx.state, ctx.config, province.id)
    const cc = getProvincePolityControlFromHoldings(ctx.state, province.id) / 100
    const grossTax = production * cc

    if (grossTax <= 0) {
      continue
    }

    // Compute total weight for the province
    let totalWeight = 0
    for (const hid of province.holdingIds) {
      const h = currentState.holdings[hid]
      if (h) totalWeight += h.weight
    }
    if (totalWeight <= 0) continue

    // Per-Holding revenue distribution
    for (const holdingId of province.holdingIds) {
      const holding = currentState.holdings[holdingId]
      if (!holding) continue

      const holdingShare = production * (holding.weight / totalWeight)
      const holdingRevenue = holdingShare * (holding.polityControl / 100)
      if (holdingRevenue <= 0) continue

      const chain = getHoldingLandContractChain(currentState, holdingId)
      if (chain.length === 0) continue

      let remaining = holdingRevenue
      for (let i = chain.length - 1; i >= 0; i--) {
        const contract = chain[i]!
        const taxRate = contract.terms.taxRateToGrantor
        let retained = remaining * (1 - taxRate)

        // bailiff salary for terminal holding
        if (i === chain.length - 1) {
          const bailiffSalary = giveSingleHoldingBailiffSalary(
            currentState,
            holdingId,
            retained,
            ctx.config.bailiffRevenueShare,
          )
          currentState = bailiffSalary.state
          retained -= bailiffSalary.paid
        }
        treasuryDeltas.set(
          contract.granteePolityId,
          (treasuryDeltas.get(contract.granteePolityId) ?? 0) + retained,
        )
        remaining = remaining * taxRate
      }
    }

    // 過徴税ペナルティ (Province 単位)
    const extracted = grossTax
    const retainedToPop = Math.max(0, production - extracted)
    const retainedRatio = production > 0 ? retainedToPop / production : 0
    const retainedWealthGainByClass = ctx.config.retainedWealthGainByClass
    const popClasses: PopClass[] = ['peasants', 'townsmen', 'nobles']

    for (const popClass of popClasses) {
      const delta = retainedRatio * retainedWealthGainByClass[popClass]
      currentState = adjustProvincePopWealthByClass(currentState, province.id, popClass, delta)
    }

    const extractionRatio = production > 0 ? extracted / production : 0
    if (extractionRatio > ctx.config.overExtractionThreshold) {
      const averageWealth = getProvinceAveragePopWealth(ctx.state, province.id)
      const provinceUnrest = getProvinceUnrest(ctx.state, province.id)
      if (
        averageWealth < ctx.config.overExtractionWealthSafeThreshold ||
        provinceUnrest > ctx.config.overExtractionUnrestSafeThreshold
      ) {
        const over = extractionRatio - ctx.config.overExtractionThreshold
        currentState = adjustProvincePopWealth(
          currentState,
          province.id,
          -over * ctx.config.overExtractionWealthPenalty,
        )
        currentState = adjustProvincePopUnrest(
          currentState,
          province.id,
          over * ctx.config.overExtractionUnrestGain,
        )
      }
    }
  }

  // treasurer の taxEfficiency を適用して polity.treasury に書き込み
  const newPolities = { ...currentState.polities }
  for (const polityIdStr of Object.keys(currentState.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = newPolities[polityId]
    if (!polity || !polity.active) continue
    const taxEfficiency = calcTreasurerTaxEfficiency(ctx.state, polityId, ctx.config)
    const delta = treasuryDeltas.get(polityId) ?? 0
    const flowEfficiency = defaultLandContractConfig.taxFlowEfficiency
    newPolities[polityId] = {
      ...polity,
      treasury: polity.treasury + delta * taxEfficiency * flowEfficiency,
    }
  }

  return {
    ...ctx,
    state: {
      ...currentState,
      polities: newPolities,
    } satisfies WorldState,
  }
}

// v0.17.1 §15.4: single holding の bailiff に salary を支払う。
function giveSingleHoldingBailiffSalary(
  state: WorldState,
  holdingId: HoldingId,
  retained: number,
  bailiffRevenueShare: number,
): { state: WorldState; paid: number } {
  if (retained <= 0 || bailiffRevenueShare <= 0) return { state, paid: 0 }
  const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]
  if (!assignmentId) return { state, paid: 0 }
  const assignment = state.holdingOfficeAssignments[assignmentId]
  if (!assignment || !assignment.active) return { state, paid: 0 }
  if (isPlaceholderPerson(state, assignment.holderPersonId)) return { state, paid: 0 }
  const holder = state.persons[assignment.holderPersonId]
  if (!holder || !holder.alive) return { state, paid: 0 }
  const salary = retained * bailiffRevenueShare
  if (salary <= 0) return { state, paid: 0 }
  const result = addPersonWealth(state, assignment.holderPersonId, salary)
  if (!result.ok) return { state, paid: 0 }
  return { state: result.value, paid: salary }
}
