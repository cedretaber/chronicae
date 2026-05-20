import type { TickContext } from './context'
import type { ProvinceId, PolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { PopClass } from '../types/popGroup'
import { calcTreasurerTaxEfficiency } from '../selectors/personAbilityEffects'
import { getProvinceProduction } from '../selectors/popEconomySelectors'
import { getProvinceAveragePopWealth, getProvinceUnrest } from '../selectors/popSelectors'
import {
  getProvinceLandContractChain,
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
// 各 Province の生産物を chain 上の Polity に配る。
// 1) terminal Polity が production * polityControl を一次徴収
// 2) chain を terminal → root と逆順に走査し、taxRateToGrantor の比率で grantor に上納
// 3) root contract の taxRateToGrantor は 0 のため、最終的に world (実体なし) に流れる分は捨てる
// 4) 残りは Province の POP に再分配 (旧 retainedWealthGainByClass を流用)
// 5) 過徴税ペナルティは polityControl 単独判定で継続
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
      // POP 還元はゼロでも適用しない (extracted=0 → retainedRatio=1 だが追加効果は限定的)
      continue
    }

    // chain 走査: terminal → root の逆順で上納。
    const chain = getProvinceLandContractChain(ctx.state, province.id)
    if (chain.length === 0) continue

    // remaining = 各段で granter に渡されない (= 自分のものとして留まる) 分
    let remaining = grossTax
    // chain[chain.length - 1] が terminal (Province を直接握る), chain[0] が root
    for (let i = chain.length - 1; i >= 0; i--) {
      const contract = chain[i]!
      const taxRate = contract.terms.taxRateToGrantor
      // この段の Polity に残る分 = remaining * (1 - taxRate)
      let retained = remaining * (1 - taxRate)
      // v0.17.1: terminal 段で normal bailiff に salary を分配する。
      // - placeholder bailiff は対象外 (100% 国庫)
      // - bailiff が存在しない (= unowned 等) Province も 100% 国庫
      // - normal bailiff のみ retained * bailiffRevenueShare を wealth に直接加算
      if (i === chain.length - 1) {
        const bailiffShare = giveBailiffSalary(
          currentState,
          province.id,
          retained,
          ctx.config.bailiffRevenueShare,
        )
        currentState = bailiffShare.state
        retained -= bailiffShare.paid
      }
      treasuryDeltas.set(
        contract.granteePolityId,
        (treasuryDeltas.get(contract.granteePolityId) ?? 0) + retained,
      )
      // 上に渡す分
      remaining = remaining * taxRate
    }
    // root contract の taxRateToGrantor は 0 のため remaining はこの時点で 0 になる想定。
    // 非 0 (root が非標準で taxRate>0) の場合は捨てる (world authority に実体がないため)。

    // 過徴税ペナルティ (旧 economySystem から踏襲)
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

// v0.17.1 §15.4: terminal Polity の retained 分から normal bailiff に salary を渡す。
// 返り値: 更新後 state と、実際に bailiff に支払った額 (treasury から差し引く分)。
function giveBailiffSalary(
  state: WorldState,
  provinceId: ProvinceId,
  retained: number,
  bailiffRevenueShare: number,
): { state: WorldState; paid: number } {
  if (retained <= 0 || bailiffRevenueShare <= 0) return { state, paid: 0 }
  const province = state.provinces[provinceId]
  if (!province) return { state, paid: 0 }
  const holdingId = province.holdingIds[0]
  if (!holdingId) return { state, paid: 0 }
  const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]
  if (!assignmentId) return { state, paid: 0 }
  const assignment = state.holdingOfficeAssignments[assignmentId]
  if (!assignment || !assignment.active) return { state, paid: 0 }
  const holderId = assignment.holderPersonId
  if (isPlaceholderPerson(state, holderId)) return { state, paid: 0 }
  const holder = state.persons[holderId]
  if (!holder || !holder.alive) return { state, paid: 0 }

  const salary = retained * bailiffRevenueShare
  if (salary <= 0) return { state, paid: 0 }
  const result = addPersonWealth(state, holderId, salary)
  if (!result.ok) return { state, paid: 0 }
  return { state: result.value, paid: salary }
}
