import type { TickContext } from './context'
import type { ProvinceId, HouseId, PolityId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import { calcTreasurerTaxEfficiency } from '../selectors/personAbilityEffects'
import { getProvinceProduction } from '../selectors/popEconomySelectors'
import { getProvinceAveragePopWealth, getProvinceUnrest } from '../selectors/popSelectors'
import {
  adjustProvincePopWealth,
  adjustProvincePopUnrest,
  adjustProvincePopWealthByClass,
} from '../mutations/popMutations'

export function runEconomySystem(ctx: TickContext): TickContext {
  const wealthDeltas = new Map<HouseId, number>()
  const treasuryDeltas = new Map<PolityId, number>()

  let currentState = ctx.state

  for (const provinceId of Object.keys(ctx.state.provinces).sort()) {
    const province = ctx.state.provinces[provinceId as ProvinceId]
    if (!province) continue

    const production = getProvinceProduction(ctx.state, ctx.config, province.id)
    const cc = province.polityControl / 100
    const hc = province.houseControl / 100
    const totalControl = cc + hc

    let polityIncome: number
    let houseIncome: number

    if (totalControl > 0) {
      polityIncome = production * (cc / totalControl) * cc
      houseIncome = production * (hc / totalControl) * hc
    } else {
      polityIncome = 0
      houseIncome = 0
    }

    const extracted = polityIncome + houseIncome
    const retained = Math.max(0, production - extracted)

    // Apply taxEfficiency to polity treasury
    treasuryDeltas.set(
      province.polityId,
      (treasuryDeltas.get(province.polityId) ?? 0) + polityIncome,
    )

    // Apply house income
    wealthDeltas.set(
      province.ownerHouseId,
      (wealthDeltas.get(province.ownerHouseId) ?? 0) + houseIncome,
    )

    // Apply retained wealth to POPs
    const retainedRatio = production > 0 ? retained / production : 0
    const retainedWealthGainByClass = ctx.config.retainedWealthGainByClass
    const popClasses: PopClass[] = ['peasants', 'townsmen', 'nobles']

    for (const popClass of popClasses) {
      const delta = retainedRatio * retainedWealthGainByClass[popClass]
      currentState = adjustProvincePopWealthByClass(currentState, province.id, popClass, delta)
    }

    // Over-extraction penalty
    const extractionRatio = production > 0 ? extracted / production : 0
    const overExtractionThreshold = ctx.config.overExtractionThreshold
    const overExtractionWealthSafeThreshold = ctx.config.overExtractionWealthSafeThreshold
    const overExtractionUnrestSafeThreshold = ctx.config.overExtractionUnrestSafeThreshold
    const overExtractionWealthPenalty = ctx.config.overExtractionWealthPenalty
    const overExtractionUnrestGain = ctx.config.overExtractionUnrestGain

    if (extractionRatio > overExtractionThreshold) {
      const averageWealth = getProvinceAveragePopWealth(ctx.state, province.id)
      const provinceUnrest = getProvinceUnrest(ctx.state, province.id)

      if (
        averageWealth < overExtractionWealthSafeThreshold ||
        provinceUnrest > overExtractionUnrestSafeThreshold
      ) {
        const over = extractionRatio - overExtractionThreshold
        currentState = adjustProvincePopWealth(
          currentState,
          province.id,
          -over * overExtractionWealthPenalty,
        )
        currentState = adjustProvincePopUnrest(
          currentState,
          province.id,
          over * overExtractionUnrestGain,
        )
      }
    }
  }

  // v013-residual: simple-batch — delta map 集約後の単一バッチ書き込み。将来 adjustHouseWealth() で代替可
  const newHouses = { ...currentState.houses }
  for (const houseId of Object.keys(currentState.houses).sort()) {
    const house = newHouses[houseId as HouseId]
    if (!house) continue
    const delta = wealthDeltas.get(houseId as HouseId) ?? 0
    newHouses[houseId as HouseId] = {
      ...house,
      wealth: Math.max(0, house.wealth + delta),
    }
  }

  // v013-residual: simple-batch — taxEfficiency を乗じた treasury バッチ更新。上記と同様
  const newPolities = { ...currentState.polities }
  for (const polityId of Object.keys(currentState.polities).sort()) {
    const polity = newPolities[polityId as PolityId]
    if (!polity) continue
    if (!polity.active) continue
    const taxEfficiency = calcTreasurerTaxEfficiency(ctx.state, polity.id, ctx.config)
    const delta = treasuryDeltas.get(polityId as PolityId) ?? 0
    newPolities[polityId as PolityId] = {
      ...polity,
      treasury: polity.treasury + delta * taxEfficiency,
    }
  }

  return {
    ...ctx,
    state: {
      ...currentState,
      houses: newHouses,
      polities: newPolities,
    },
  }
}
