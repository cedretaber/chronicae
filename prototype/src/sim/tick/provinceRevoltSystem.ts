import type { TickContext } from './context'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import { clamp } from '../utils/math'
import { randomFloat } from '../rng/rng'
import type {
  ProvinceId,
  PolityId,
  HoldingId,
  LandContractId,
  DiplomaticPlayId,
} from '../types/ids'
import { createDiplomaticPlayId } from '../types/ids'
import type { PopClass, PopGroup } from '../types/popGroup'
import type { WorldState } from '../types/world'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import { getProvincePopulationPressure, getPopWealthByClass } from '../selectors/popSelectors'
import { getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { getProvinceProduction } from '../selectors/popEconomySelectors'
import { adjustProvincePopUnrestByClass } from '../mutations/popMutations'
import { getAttitudeOrDefault, attitudeValueToScore } from '../helpers/attitudeHelpers'
import { getPolityLegitimacy, getPolityStability } from '../selectors/statusSelectors'
import { getHoldingTerminalPolityId } from '../selectors/landContractSelectors'
import { createNegotiatingCommonwealth } from '../mutations/worldStructureMutations'
import { defaultTaxRateByRank } from '../helpers/landContractHelpers'

type HoldingRevoltCandidate = {
  holdingId: HoldingId
  provinceId: ProvinceId
  terminalPolityId: PolityId
  terminalContractId: LandContractId
  rebelClass: PopClass
  revoltTendency: number
}

function findHoldingPop(
  state: WorldState,
  holdingId: HoldingId,
  cls: PopClass,
): PopGroup | undefined {
  const popIds = state.popIndex.byHolding[holdingId]
  if (!popIds) return undefined
  for (const popId of popIds) {
    const p = state.popGroups[popId]
    if (p && p.class === cls) return p
  }
  return undefined
}

function calcHoldingRevoltTendency(
  ctx: TickContext,
  holdingId: HoldingId,
  rebelClass: PopClass,
): number {
  const state = ctx.state
  const config = ctx.config

  const holding = state.holdings[holdingId]
  if (!holding) return 0

  const terminalPolityId = getHoldingTerminalPolityId(state, holdingId)
  if (!terminalPolityId) return 0
  const polity = state.polities[terminalPolityId]
  if (!polity || !polity.active) return 0

  const provinceId = holding.provinceId
  const ownerHouseId = polity.ownerHouseId
  if (ownerHouseId === undefined) return 0
  const ownerHouse = state.houses[ownerHouseId]
  if (!ownerHouse) return 0

  const pop = findHoldingPop(state, holdingId, rebelClass)
  if (!pop) return 0

  const polityControl = holding.polityControl ?? 50

  let tendency =
    pop.unrest * config.provinceRevoltUnrestFactor +
    (100 - polityControl) * config.provinceRevoltLowHouseControlFactor +
    (100 - polityControl) * config.provinceRevoltLowCountryControlFactor -
    getPolityStability(state, config, terminalPolityId) *
      config.provinceRevoltStabilitySuppressionFactor

  if (rebelClass === 'peasants') {
    if (pop.wealth < config.povertyWealthThreshold) {
      tendency += (config.povertyWealthThreshold - pop.wealth) * config.peasantRevoltPovertyFactor
    }
    tendency +=
      getProvincePopulationPressure(state, config, provinceId) * config.peasantRevoltPressureFactor
  } else if (rebelClass === 'townsmen') {
    const townsmenWealth = getPopWealthByClass(state, provinceId, 'townsmen')
    if (townsmenWealth < config.overExtractionWealthSafeThreshold) {
      tendency += config.townsmenRevoltExtractionFactor
      tendency +=
        Math.log1p(getProvinceProduction(state, config, provinceId)) *
        config.townsmenRevoltProductionFactor
    }
  } else if (rebelClass === 'nobles') {
    const a_house = getAttitudeOrDefault(state, pop, { kind: 'house', id: ownerHouseId })
    const a_polity = getAttitudeOrDefault(state, pop, { kind: 'polity', id: terminalPolityId })
    const houseScore =
      attitudeValueToScore(a_house.affection) * 0.6 + attitudeValueToScore(a_house.respect) * 0.4
    const polityScore =
      attitudeValueToScore(a_polity.affection) * 0.6 + attitudeValueToScore(a_polity.respect) * 0.4
    const nobleDisloyalty = 100 - (0.5 * houseScore + 0.5 * polityScore)
    tendency += nobleDisloyalty * config.nobleRevoltHouseDisloyaltyFactor
    tendency +=
      (100 - getPolityLegitimacy(state, terminalPolityId)) * config.nobleRevoltLowLegitimacyFactor
  }

  // v0.39: tax burden factor
  const holdingChain = state.landContractIndex.byHolding[holdingId] ?? []
  const terminalContractId = holdingChain[holdingChain.length - 1]
  if (terminalContractId) {
    const contract = state.landContracts[terminalContractId]
    if (contract) {
      const currentTaxRate = contract.terms.taxRateToGrantor
      const expectedTaxRate = defaultTaxRateByRank(polity.rank)
      const taxBurden = Math.max(0, currentTaxRate - expectedTaxRate)
      tendency += taxBurden * config.taxBurdenWeight

      // Recent tax increase bonus
      if (
        contract.lastTaxChangedWeek !== undefined &&
        contract.previousTaxRate !== undefined &&
        contract.previousTaxRate < currentTaxRate
      ) {
        const weeksSinceChange = state.absoluteWeek - contract.lastTaxChangedWeek
        if (weeksSinceChange < config.recentTaxIncreaseDecayWeeks) {
          const decay = 1 - weeksSinceChange / config.recentTaxIncreaseDecayWeeks
          tendency += config.recentTaxIncreaseWeight * decay
        }
      }
    }
  }

  // v0.39: recent suppression cooldown
  if (holding.lastRevoltSuppressedWeek !== undefined) {
    const weeksSince = state.absoluteWeek - holding.lastRevoltSuppressedWeek
    if (weeksSince < config.recentSuppressionCooldownWeeks) {
      const decay = 1 - weeksSince / config.recentSuppressionCooldownWeeks
      tendency -= config.recentSuppressionTendencyReduction * decay
    }
  }

  return tendency
}

function collectHoldingCandidates(ctx: TickContext): HoldingRevoltCandidate[] {
  const candidates: HoldingRevoltCandidate[] = []
  const config = ctx.config
  const state = ctx.state

  // Build set of holdings already targeted by active revolt_negotiation
  const activeRevoltTargetHoldings = new Set<HoldingId>()
  for (const playId of Object.keys(state.diplomaticPlays) as DiplomaticPlayId[]) {
    const play = state.diplomaticPlays[playId]
    if (!play || play.status !== 'active' || play.kind !== 'revolt_negotiation') continue
    if (play.primaryDemand?.kind === 'popular_tax_relief') {
      activeRevoltTargetHoldings.add(play.primaryDemand.holdingId)
    }
  }

  for (const holdingIdStr of Object.keys(state.holdings).sort()) {
    const holdingId = holdingIdStr as HoldingId
    const holding = state.holdings[holdingId]
    if (!holding) continue

    if (activeRevoltTargetHoldings.has(holdingId)) continue

    const terminalPolityId = getHoldingTerminalPolityId(state, holdingId)
    if (!terminalPolityId) continue
    const polity = state.polities[terminalPolityId]
    if (!polity || !polity.active) continue
    if (polity.kind === 'commonwealth') continue

    const holdingChain = state.landContractIndex.byHolding[holdingId] ?? []
    const terminalContractId = holdingChain[holdingChain.length - 1]
    if (!terminalContractId) continue

    const classes: PopClass[] = ['peasants', 'townsmen', 'nobles']
    let bestClass: PopClass | undefined
    let bestTendency = -Infinity

    for (const cls of classes) {
      const tendency = calcHoldingRevoltTendency(ctx, holdingId, cls)
      if (tendency > bestTendency) {
        bestTendency = tendency
        bestClass = cls
      }
    }

    if (bestClass === undefined || bestTendency < config.provinceRevoltThreshold) continue

    candidates.push({
      holdingId,
      provinceId: holding.provinceId,
      terminalPolityId,
      terminalContractId,
      rebelClass: bestClass,
      revoltTendency: bestTendency,
    })
  }

  return candidates
}

function resolveHoldingRevolt(ctx: TickContext, candidate: HoldingRevoltCandidate): TickContext {
  const {
    holdingId,
    provinceId,
    terminalPolityId,
    terminalContractId,
    rebelClass,
    revoltTendency,
  } = candidate
  const config = ctx.config

  const holding = ctx.state.holdings[holdingId]
  if (!holding) return ctx
  const province = ctx.state.provinces[provinceId]
  if (!province) return ctx
  const polity = ctx.state.polities[terminalPolityId]
  if (!polity || !polity.active) return ctx
  const contract = ctx.state.landContracts[terminalContractId]
  if (!contract) return ctx

  const REVOLT_CALLS_PER_YEAR = 4
  const revoltChance = clamp(
    revoltTendency / (config.provinceRevoltChanceDivisor * REVOLT_CALLS_PER_YEAR),
    0,
    config.provinceRevoltMaxChance / REVOLT_CALLS_PER_YEAR,
  )

  const { value: roll1, rng: rng1 } = randomFloat(ctx.rng)
  ctx = { ...ctx, rng: rng1 }
  if (roll1 >= revoltChance) return ctx

  const pop = findHoldingPop(ctx.state, holdingId, rebelClass)
  if (!pop) return ctx

  const createResult = createNegotiatingCommonwealth(ctx, {
    holdingId,
    provinceId,
    popClass: rebelClass,
    targetPolityId: terminalPolityId,
  })
  if (!createResult.ok) return ctx
  let nextCtx = createResult.value.ctx
  const { polityId: commonwealthId, personId: leaderPersonId } = createResult.value.value

  // Reduce rebel class unrest by -50 (temporary relief)
  const unrestReducedState = adjustProvincePopUnrestByClass(
    nextCtx.state,
    provinceId,
    rebelClass,
    -50,
  )
  nextCtx = { ...nextCtx, state: unrestReducedState }

  // Build popular_tax_relief demand
  const currentTaxRate = contract.terms.taxRateToGrantor
  const demandedTaxRate = Math.max(
    config.minPopularDemandTaxRate,
    currentTaxRate - config.popularTaxReliefDemandDelta,
  )

  // Create revolt_negotiation DiplomaticPlay
  const playId = createDiplomaticPlayId(nextCtx.state.nextDiplomaticPlayId)
  const deadlineWeek = nextCtx.state.absoluteWeek + config.revoltNegotiationDurationWeeks
  const targetDelegate = getDiplomaticPlayDelegate(nextCtx.state, {
    kind: 'polity',
    id: terminalPolityId,
  })
  const play: DiplomaticPlay = {
    id: playId,
    kind: 'revolt_negotiation',
    initiator: { kind: 'polity', id: commonwealthId },
    target: { kind: 'polity', id: terminalPolityId },
    primaryDemand: {
      kind: 'popular_tax_relief',
      holdingId,
      targetContractId: terminalContractId,
      currentTaxRate,
      demandedTaxRate,
      claimantPopClass: rebelClass,
    },
    status: 'active',
    startedWeek: nextCtx.state.absoluteWeek,
    deadlineWeek,
    progress: 0,
    tension: 0,
    initiatorDelegatePersonId: leaderPersonId,
    ...(targetDelegate ? { targetDelegatePersonId: targetDelegate } : {}),
    initiatorPreparation: 0,
    initiatorLeverage: 0,
    initiatorCommitment: 0,
    targetPreparation: 0,
    targetLeverage: 0,
    targetCommitment: 0,
    initiatorSupporters: [],
    targetSupporters: [],
    initiatorActiveTaskIds: [],
    targetActiveTaskIds: [],
    offerHistoryIds: [],
  }

  // Set revoltState on the commonwealth
  const commonwealth = nextCtx.state.polities[commonwealthId]
  if (!commonwealth) return nextCtx

  nextCtx = {
    ...nextCtx,
    state: {
      ...nextCtx.state,
      diplomaticPlays: {
        ...nextCtx.state.diplomaticPlays,
        [playId]: play,
      },
      nextDiplomaticPlayId: nextCtx.state.nextDiplomaticPlayId + 1,
      polities: {
        ...nextCtx.state.polities,
        [commonwealthId]: {
          ...commonwealth,
          revoltState: { kind: 'negotiating', diplomaticPlayId: playId },
        },
      },
    },
  }

  const { event, ctx: ctxStart } = createSimEvent(nextCtx, {
    type: 'REVOLT_NEGOTIATION_STARTED',
    importance: 'major',
    messageKey: 'revolt.negotiation_started',
    messageParams: {
      rebelClass: rebelClass,
      province: nameParam('province', province.nameKey),
    },
    entityRefs: [
      entityRef('person', leaderPersonId, 'leader'),
      entityRef('polity', commonwealthId, 'rebel'),
      entityRef('polity', terminalPolityId, 'target'),
      entityRef('province', provinceId, 'province'),
    ],
  })
  return { ...ctxStart, events: [...ctxStart.events, event] }
}

export function runProvinceRevoltSystem(ctx: TickContext): TickContext {
  const candidates = collectHoldingCandidates(ctx).sort(
    (a, b) => b.revoltTendency - a.revoltTendency,
  )
  const limit = Math.min(1, candidates.length)

  let currentCtx = ctx
  for (let i = 0; i < limit; i++) {
    const c = candidates[i]
    if (!c) break
    currentCtx = resolveHoldingRevolt(currentCtx, c)
  }
  return currentCtx
}
