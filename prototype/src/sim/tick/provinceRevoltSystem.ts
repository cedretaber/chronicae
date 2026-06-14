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
  PersonId,
  HouseId,
} from '../types/ids'
import { createDiplomaticPlayId } from '../types/ids'
import type { PopClass, PopGroup } from '../types/popGroup'
import type { WorldState } from '../types/world'
import type { DiplomaticPlay, DiplomaticDemand } from '../types/diplomaticPlay'
import { getProvincePopulationPressure, getPopWealthByClass } from '../selectors/popSelectors'
import { getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { getProvinceProduction } from '../selectors/popEconomySelectors'
import { adjustProvincePopUnrestByClass } from '../mutations/popMutations'
import { worsenPopAttitudeTowardOwnerHouse } from '../mutations/attitudeMutations'
import { getAttitudeOrDefault, attitudeValueToScore } from '../helpers/attitudeHelpers'
import { getPolityLegitimacy, getPolityStability } from '../selectors/statusSelectors'
import { getHoldingTerminalPolityId, isPlaceholderPerson } from '../selectors/landContractSelectors'
import { getHouseLeader } from '../selectors/officeSelectors'
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

// v0.49: 領地の実質統治者 (代官 > 領主家長) の統率/学識スコア。
//   反乱傾向の低減に使う。command*0.5 + learning*0.5 (0-120)。不在なら undefined。
function getHoldingGovernorAbilityScore(
  state: WorldState,
  holdingId: HoldingId,
  ownerHouseId: HouseId,
): number | undefined {
  const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]
  if (assignmentId) {
    const assignment = state.holdingOfficeAssignments[assignmentId]
    if (assignment && assignment.active && !isPlaceholderPerson(state, assignment.holderPersonId)) {
      const bailiff = state.persons[assignment.holderPersonId]
      if (bailiff && bailiff.alive) {
        return bailiff.abilities.command * 0.5 + bailiff.abilities.learning * 0.5
      }
    }
  }
  const headId = getHouseLeader(state, ownerHouseId)
  const head = headId ? state.persons[headId] : undefined
  if (head && head.alive) {
    return head.abilities.command * 0.5 + head.abilities.learning * 0.5
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

  // v0.49: 領主・代官の統率/学識による反感低減 (対称項: 有能ほど鎮静、無能ほど煽る)。
  const governorScore = getHoldingGovernorAbilityScore(state, holdingId, ownerHouseId)
  if (governorScore !== undefined) {
    tendency -=
      (governorScore - config.revoltAbilityNeutralScore) * config.revoltAbilitySuppressionFactor
  }

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
    if (
      play.primaryDemand?.kind === 'popular_tax_relief' ||
      play.primaryDemand?.kind === 'bailiff_dismissal' ||
      play.primaryDemand?.kind === 'secession'
    ) {
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

// v0.48: 民衆反乱の目的分岐。閾値超過後、反乱 class pop の生の attitude (affection) を
//   上から順に判定する (§ 民衆反乱の目的分岐):
//     1. 領主家への悪感情が十分強い → 独立 (secession)
//     2. 現代官への悪感情が十分強い かつ 代官が非placeholder → 代官罷免 (bailiff_dismissal)
//     3. それ以外 → 税率改定 (popular_tax_relief)
//   POP→house を負に書く配線は applyBailiffDismissalFailure / applyTaxReliefFizzle / 代官排除反乱
//   の発生時の3箇所 (S2-2)。これが蓄積すると branch 1 (独立) に到達する。
type RevoltDemandDecision =
  | { kind: 'secession' }
  | { kind: 'bailiff_dismissal'; bailiffPersonId: PersonId }
  | { kind: 'tax_relief' }

function decideRevoltDemand(
  ctx: TickContext,
  candidate: HoldingRevoltCandidate,
  pop: PopGroup,
  ownerHouseId: HouseId | undefined,
): RevoltDemandDecision {
  const { state, config } = ctx

  // branch 1 (独立): POP→ownerHouse affection ≤ threshold。
  if (ownerHouseId !== undefined) {
    const houseAtt = getAttitudeOrDefault(state, pop, { kind: 'house', id: ownerHouseId })
    if (houseAtt.affection <= config.revoltIndependenceHouseAffectionThreshold) {
      return { kind: 'secession' }
    }
  }

  // branch 2 (代官罷免): POP→現 bailiff person affection ≤ threshold かつ非placeholder。
  const assignmentId = state.holdingOfficeIndex.byHolding[candidate.holdingId]
  if (assignmentId) {
    const assignment = state.holdingOfficeAssignments[assignmentId]
    if (assignment && assignment.active && !isPlaceholderPerson(state, assignment.holderPersonId)) {
      const bailiffAtt = getAttitudeOrDefault(state, pop, {
        kind: 'person',
        id: assignment.holderPersonId,
      })
      if (bailiffAtt.affection <= config.revoltBailiffDismissalAffectionThreshold) {
        return { kind: 'bailiff_dismissal', bailiffPersonId: assignment.holderPersonId }
      }
    }
  }

  // branch 3 (税率改定): フォールバック
  return { kind: 'tax_relief' }
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

  // v0.48: demand 分岐を commonwealth 生成前 (= 元の state) で決定する。
  const decision = decideRevoltDemand(ctx, candidate, pop, polity.ownerHouseId)

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

  // v0.48: 決定済み分岐に応じて primaryDemand を構築する。
  let primaryDemand: DiplomaticDemand
  if (decision.kind === 'secession') {
    primaryDemand = {
      kind: 'secession',
      holdingId,
      targetContractId: terminalContractId,
      claimantPopClass: rebelClass,
    }
  } else if (decision.kind === 'bailiff_dismissal') {
    primaryDemand = {
      kind: 'bailiff_dismissal',
      holdingId,
      targetContractId: terminalContractId,
      claimantPopClass: rebelClass,
      bailiffPersonId: decision.bailiffPersonId,
    }
    // S2-2 site①: 代官排除反乱の発生時、領主家への悪感情が芽生える (代理人の悪政＝領主不信)。
    nextCtx = {
      ...nextCtx,
      state: worsenPopAttitudeTowardOwnerHouse(
        nextCtx.state,
        holdingId,
        rebelClass,
        polity.ownerHouseId,
        config.revoltBailiffRevoltHouseAffectionPenalty,
      ),
    }
  } else {
    const currentTaxRate = contract.terms.taxRateToGrantor
    const demandedTaxRate = Math.max(
      config.minPopularDemandTaxRate,
      currentTaxRate - config.popularTaxReliefDemandDelta,
    )
    primaryDemand = {
      kind: 'popular_tax_relief',
      holdingId,
      targetContractId: terminalContractId,
      currentTaxRate,
      demandedTaxRate,
      claimantPopClass: rebelClass,
    }
  }

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
    primaryDemand,
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
