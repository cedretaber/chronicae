import type { TickContext } from './context'
import type { PolityId, HoldingId, DiplomaticPlayId } from '../types/ids'
import { randomFloat } from '../rng/rng'
import { adjustLandContractTaxRate } from '../mutations/landContractMutations'
import { getHoldingTerminalPolityId } from '../selectors/landContractSelectors'
import { getPolityLeader } from '../selectors/officeSelectors'

export function runTaxRevisionSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  if (!config.taxRevisionSystemEnabled) return ctx

  const state = ctx.state
  let nextState = state

  const activeRevoltHoldings = new Set<HoldingId>()
  for (const playId of Object.keys(state.diplomaticPlays) as DiplomaticPlayId[]) {
    const play = state.diplomaticPlays[playId]
    if (!play || play.status !== 'active' || play.kind !== 'revolt_negotiation') continue
    if (
      play.primaryDemand?.kind === 'popular_tax_relief' ||
      play.primaryDemand?.kind === 'bailiff_dismissal' ||
      play.primaryDemand?.kind === 'secession'
    ) {
      activeRevoltHoldings.add(play.primaryDemand.holdingId)
    }
  }

  for (const polityIdStr of Object.keys(state.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = state.polities[polityId]
    if (!polity || !polity.active) continue
    if (polity.kind === 'commonwealth') continue

    const leaderId = getPolityLeader(nextState, polityId)
    const leader = leaderId ? nextState.persons[leaderId] : undefined

    const granteeContracts = nextState.landContractIndex.byGranteePolity[polityId] ?? []

    for (const contractId of granteeContracts) {
      const contract = nextState.landContracts[contractId]
      if (!contract) continue
      if (contract.specialStatus?.kind === 'revolt_seizure') continue

      const holdingId = contract.holdingId
      if (!holdingId) continue
      if (activeRevoltHoldings.has(holdingId)) continue

      const terminalPolityId = getHoldingTerminalPolityId(nextState, holdingId)
      if (terminalPolityId !== polityId) continue

      if (
        contract.taxIncreaseCooldownUntilWeek !== undefined &&
        contract.taxIncreaseCooldownUntilWeek > nextState.absoluteWeek
      ) {
        continue
      }

      const holding = nextState.holdings[holdingId]
      if (!holding) continue

      const currentTaxRate = contract.terms.taxRateToGrantor

      let increaseScore = 0
      let avoidScore = 0

      const treasuryNeed = Math.max(0, config.taxRevisionTreasuryThreshold - polity.treasury)
      increaseScore += treasuryNeed * config.taxRevisionTreasuryNeedFactor

      const holdingPopIds = nextState.popIndex.byHolding[holdingId] ?? []
      let holdingUnrest = 0
      let popCount = 0
      for (const popId of holdingPopIds) {
        const pop = nextState.popGroups[popId]
        if (!pop) continue
        holdingUnrest += pop.unrest
        popCount++
      }
      if (popCount > 0) holdingUnrest /= popCount

      if (holdingUnrest < config.taxRevisionUnrestSafeThreshold) {
        increaseScore +=
          (config.taxRevisionUnrestSafeThreshold - holdingUnrest) *
          config.taxRevisionLowUnrestFactor
      }

      if (leader) {
        increaseScore += leader.traits.ambition * config.taxRevisionAmbitionFactor
        avoidScore += leader.traits.caution * Math.abs(config.taxRevisionCautionPenalty)
        avoidScore += leader.abilities.insight * Math.abs(config.taxRevisionInsightPenalty) * 0.01
      }

      if (polity.lastWarWeek !== undefined) {
        const weeksSinceWar = nextState.absoluteWeek - polity.lastWarWeek
        if (weeksSinceWar < 96) {
          increaseScore += config.taxRevisionWarBonus
        }
      }

      if (holdingUnrest > config.taxRevisionUnrestDangerThreshold) {
        avoidScore +=
          (holdingUnrest - config.taxRevisionUnrestDangerThreshold) *
          config.taxRevisionHighUnrestPenalty
      }

      if (holding.lastRevoltSuppressedWeek !== undefined) {
        const weeksSince = nextState.absoluteWeek - holding.lastRevoltSuppressedWeek
        if (weeksSince < config.taxRevisionRecentRevoltDecayWeeks) {
          const decay = 1 - weeksSince / config.taxRevisionRecentRevoltDecayWeeks
          avoidScore += config.taxRevisionRecentRevoltPenalty * decay
        }
      }
      if (holding.lastRevoltSettledWeek !== undefined) {
        const weeksSince = nextState.absoluteWeek - holding.lastRevoltSettledWeek
        if (weeksSince < config.taxRevisionRecentRevoltDecayWeeks) {
          const decay = 1 - weeksSince / config.taxRevisionRecentRevoltDecayWeeks
          avoidScore += config.taxRevisionRecentRevoltPenalty * decay * 0.5
        }
      }

      if (currentTaxRate > config.taxRevisionHighTaxThreshold) {
        avoidScore +=
          (currentTaxRate - config.taxRevisionHighTaxThreshold) *
          config.taxRevisionHighTaxPenalty *
          100
      }

      const { value: noise, rng: rng1 } = randomFloat(ctx.rng)
      ctx = { ...ctx, rng: rng1 }
      const decision = increaseScore - avoidScore + (noise - 0.5) * 10

      if (decision <= config.taxRevisionDecisionThreshold) continue

      const { value: deltaRoll, rng: rng2 } = randomFloat(ctx.rng)
      ctx = { ...ctx, rng: rng2 }
      const delta =
        config.taxRevisionMinDelta +
        deltaRoll * (config.taxRevisionMaxDelta - config.taxRevisionMinDelta)
      const newRate = Math.min(config.taxRevisionSystemMaxRate, currentTaxRate + delta)

      if (newRate <= currentTaxRate) continue

      nextState = adjustLandContractTaxRate(nextState, contractId, newRate)

      const updatedContract = nextState.landContracts[contractId]
      if (updatedContract) {
        nextState = {
          ...nextState,
          landContracts: {
            ...nextState.landContracts,
            [contractId]: {
              ...updatedContract,
              lastTaxChangedWeek: nextState.absoluteWeek,
              previousTaxRate: currentTaxRate,
              taxIncreaseCooldownUntilWeek:
                nextState.absoluteWeek + config.taxRevisionCooldownWeeks,
            },
          },
        }
      }
    }
  }

  return { ...ctx, state: nextState }
}
