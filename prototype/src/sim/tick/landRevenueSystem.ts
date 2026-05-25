import type { TickContext } from './context'
import type { ProvinceId, PolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { PopClass } from '../types/popGroup'
import { calcTreasurerTaxEfficiency } from '../selectors/personAbilityEffects'
import { getHoldingProduction, getProvinceProduction } from '../selectors/popEconomySelectors'
import {
  getHoldingLandContractChain,
  isPlaceholderPerson,
} from '../selectors/landContractSelectors'
import { adjustProvincePopWealthByClass } from '../mutations/popMutations'
import { addPersonWealth } from '../mutations/personMutations'
import { adjustPopAttitude } from '../mutations/attitudeMutations'
import { defaultLandContractConfig } from '../config/landContractConfig'
import {
  getBailiffLocalExtractionRate,
  getBailiffCollectionEfficiency,
  getBailiffFeeRate,
  computeBailiffBurdenComponents,
  getRecentBailiffRevenueTaskStatus,
  getBailiffPolicy,
} from '../selectors/bailiffSelectors'
import { clamp } from '../utils/math'
import { createLogger } from '../debug/logger'

export function runLandRevenueSystem(ctx: TickContext): TickContext {
  const log = createLogger(ctx.config.debug)
  const treasuryDeltas = new Map<PolityId, number>()
  let currentState = ctx.state

  for (const provinceId of Object.keys(ctx.state.provinces).sort() as ProvinceId[]) {
    const province = ctx.state.provinces[provinceId]
    if (!province) continue

    let provinceCollected = 0

    for (const holdingId of province.holdingIds) {
      const holding = currentState.holdings[holdingId]
      if (!holding) continue

      const grossHoldingRevenue = getHoldingProduction(currentState, ctx.config, holdingId)
      if (grossHoldingRevenue <= 0) continue

      const assignmentId = currentState.holdingOfficeIndex.byHolding[holdingId]
      let remittanceToTerminal: number

      if (!assignmentId) {
        remittanceToTerminal = grossHoldingRevenue
        provinceCollected += grossHoldingRevenue
      } else {
        const assignment = currentState.holdingOfficeAssignments[assignmentId]
        if (!assignment || !assignment.active) {
          remittanceToTerminal = grossHoldingRevenue
          provinceCollected += grossHoldingRevenue
        } else {
          const recentTaskStatus = getRecentBailiffRevenueTaskStatus(currentState, assignmentId)
          const localExtractionRate = getBailiffLocalExtractionRate(
            currentState,
            ctx.config,
            assignmentId,
          )
          const collectionEfficiency = getBailiffCollectionEfficiency(
            currentState,
            ctx.config,
            assignmentId,
            recentTaskStatus,
          )
          const collected = grossHoldingRevenue * localExtractionRate * collectionEfficiency
          const bailiffFeeRate = getBailiffFeeRate(currentState, ctx.config, assignmentId)
          const bailiffFee = collected * bailiffFeeRate
          remittanceToTerminal = collected - bailiffFee
          provinceCollected += collected

          if (!isPlaceholderPerson(currentState, assignment.holderPersonId) && bailiffFee > 0) {
            const holder = currentState.persons[assignment.holderPersonId]
            if (holder && holder.alive) {
              const result = addPersonWealth(currentState, assignment.holderPersonId, bailiffFee)
              if (result.ok) currentState = result.value
            }
          }

          const burdenComponents = computeBailiffBurdenComponents(
            localExtractionRate,
            collectionEfficiency,
            ctx.config.collectionFrictionFactor,
          )

          const popIds = currentState.popIndex.byHolding[holdingId]
          if (popIds) {
            if (burdenComponents.collectionFrictionBurdenRate > 0) {
              const newPopGroups = { ...currentState.popGroups }
              for (const popId of popIds) {
                const pop = newPopGroups[popId]
                if (!pop) continue
                const newWealth = clamp(
                  pop.wealth -
                    burdenComponents.collectionFrictionBurdenRate *
                      ctx.config.localExtractionWealthPenalty *
                      (pop.wealth / 100),
                  0,
                  100,
                )
                if (newWealth !== pop.wealth) {
                  newPopGroups[popId] = { ...pop, wealth: newWealth }
                }
              }
              currentState = { ...currentState, popGroups: newPopGroups }
            }

            const burdenOverComfort = Math.max(
              0,
              burdenComponents.totalBurdenRate - ctx.config.comfortableLocalExtractionRate,
            )
            if (burdenOverComfort > 0) {
              const newPopGroups = { ...currentState.popGroups }
              for (const popId of popIds) {
                const pop = newPopGroups[popId]
                if (!pop) continue
                const newUnrest = clamp(
                  pop.unrest + burdenOverComfort * ctx.config.localExtractionUnrestGain,
                  0,
                  100,
                )
                if (newUnrest !== pop.unrest) {
                  newPopGroups[popId] = { ...pop, unrest: newUnrest }
                }
              }
              currentState = { ...currentState, popGroups: newPopGroups }
            }

            if (!isPlaceholderPerson(currentState, assignment.holderPersonId)) {
              const policy = getBailiffPolicy(currentState, ctx.config, assignmentId)

              const affectionDelta = clamp(
                -burdenOverComfort * ctx.config.bailiffBurdenAffectionPenaltyFactor +
                  (policy === 'protect_residents'
                    ? ctx.config.bailiffProtectResidentsAffectionBonus
                    : 0),
                -1.0,
                0.5,
              )
              const respectDelta = clamp(
                recentTaskStatus === 'completed' ? ctx.config.bailiffTaskCompletedRespectGain : 0,
                -0.5,
                0.5,
              )

              if (affectionDelta !== 0 || respectDelta !== 0) {
                for (const popId of popIds) {
                  const pop = currentState.popGroups[popId]
                  if (!pop) continue
                  const attResult = adjustPopAttitude(
                    currentState,
                    popId,
                    { kind: 'person', id: assignment.holderPersonId },
                    { affection: affectionDelta, respect: respectDelta },
                  )
                  if (attResult.ok) currentState = attResult.value
                }
              }
            }
          }

          if (ctx.config.debug) {
            log.log('BAILIFF', {
              holdingId,
              collected: collected.toFixed(2),
              bailiffFee: bailiffFee.toFixed(2),
              remittance: remittanceToTerminal.toFixed(2),
              localExtractionRate: localExtractionRate.toFixed(3),
              collectionEfficiency: collectionEfficiency.toFixed(3),
              totalBurdenRate: burdenComponents.totalBurdenRate.toFixed(3),
            })
          }
        }
      }

      const chain = getHoldingLandContractChain(currentState, holdingId)
      if (chain.length === 0) continue

      let remaining = remittanceToTerminal
      for (let i = chain.length - 1; i >= 0; i--) {
        const contract = chain[i]!
        const taxRate = contract.terms.taxRateToGrantor
        const retained = remaining * (1 - taxRate)
        treasuryDeltas.set(
          contract.granteePolityId,
          (treasuryDeltas.get(contract.granteePolityId) ?? 0) + retained,
        )
        remaining = remaining * taxRate
      }
    }

    const provinceProduction = getProvinceProduction(currentState, ctx.config, provinceId)
    const retainedToPop = Math.max(0, provinceProduction - provinceCollected)
    const retainedRatio = provinceProduction > 0 ? retainedToPop / provinceProduction : 0
    const retainedWealthGainByClass = ctx.config.retainedWealthGainByClass
    const popClasses: PopClass[] = ['peasants', 'townsmen', 'nobles']

    for (const popClass of popClasses) {
      const delta = retainedRatio * retainedWealthGainByClass[popClass]
      currentState = adjustProvincePopWealthByClass(currentState, provinceId, popClass, delta)
    }
  }

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
