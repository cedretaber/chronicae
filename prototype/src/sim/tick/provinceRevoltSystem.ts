import type { TickContext } from './context'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import { clamp } from '../utils/math'
import { randomFloat } from '../rng/rng'
import type { ProvinceId, PolityId, HoldingId, LandContractId, HouseId } from '../types/ids'
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
import {
  getHoldingBailiff,
  isHoldingOfficeVacantOrPlaceholder,
} from '../selectors/provinceOfficeSelectors'
import { governanceCompetence } from '../selectors/abilitySelectors'
import { createNegotiatingCommonwealth } from '../mutations/worldStructureMutations'
import { defaultTaxRateByRank } from '../helpers/landContractHelpers'
import type { Crisis, RevoltDemand } from '../types/crisis'
import { spawnUnrestCrisis } from './crisisSystem'
import { applyRevoltEscalation } from './diplomaticPlayRevolt'

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

// v0.49: 領地の実質統治者 (代官 > 領主家長) の統率/学識スコア (governanceCompetence, 0-120)。
//   反乱傾向の低減に使う。代官が非placeholder & active なら代官を、不在なら領主家長を見る。両者不在は undefined。
function getHoldingGovernorAbilityScore(
  state: WorldState,
  holdingId: HoldingId,
  ownerHouseId: HouseId,
): number | undefined {
  const assignment = getHoldingBailiff(state, holdingId)
  if (assignment && !isHoldingOfficeVacantOrPlaceholder(state, assignment)) {
    const bailiff = state.persons[assignment.holderPersonId]
    if (bailiff && bailiff.alive) {
      return governanceCompetence(bailiff.abilities)
    }
  }
  const headId = getHouseLeader(state, ownerHouseId)
  const head = headId ? state.persons[headId] : undefined
  if (head && head.alive) {
    return governanceCompetence(head.abilities)
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

  // §5.3 C2: 二重トリガー抑制。旧実装は active revolt_negotiation play に key していたが、Crisis 化で
  //   交渉窓が消えたため crisisIndex を引く。同 holding に active な unrest Crisis があれば skip
  //   (必ず kind 別。famine 等が unrest 検知を抑制しないように)。蜂起後の commonwealth play は
  //   下の polity.kind === 'commonwealth' guard が引き続き弾く。
  const activeUnrestHoldings = new Set<HoldingId>()
  for (const [holdingKey, cids] of Object.entries(state.crisisIndex.byHolding)) {
    for (const cid of cids ?? []) {
      const c = state.crises[cid]
      if (c && c.kind === 'unrest' && c.status === 'active') {
        activeUnrestHoldings.add(holdingKey as HoldingId)
        break
      }
    }
  }

  for (const holdingIdStr of Object.keys(state.holdings).sort()) {
    const holdingId = holdingIdStr as HoldingId
    const holding = state.holdings[holdingId]
    if (!holding) continue

    if (activeUnrestHoldings.has(holdingId)) continue

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
function decideRevoltDemand(
  ctx: TickContext,
  candidate: HoldingRevoltCandidate,
  pop: PopGroup,
  ownerHouseId: HouseId | undefined,
): RevoltDemand {
  const { state, config } = ctx
  const claimantPopClass = candidate.rebelClass

  // branch 1 (独立): POP→ownerHouse affection ≤ threshold。
  if (ownerHouseId !== undefined) {
    const houseAtt = getAttitudeOrDefault(state, pop, { kind: 'house', id: ownerHouseId })
    if (houseAtt.affection <= config.revoltIndependenceHouseAffectionThreshold) {
      return { kind: 'secession', claimantPopClass }
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
        return {
          kind: 'bailiff_dismissal',
          claimantPopClass,
          bailiffPersonId: assignment.holderPersonId,
        }
      }
    }
  }

  // branch 3 (税率改定): フォールバック
  return { kind: 'tax_relief', claimantPopClass }
}

function resolveHoldingRevolt(ctx: TickContext, candidate: HoldingRevoltCandidate): TickContext {
  const { holdingId, provinceId, terminalPolityId, rebelClass, revoltTendency } = candidate
  const config = ctx.config

  const holding = ctx.state.holdings[holdingId]
  if (!holding) return ctx
  const polity = ctx.state.polities[terminalPolityId]
  if (!polity || !polity.active) return ctx

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

  // §5.3 案 A: commonwealth/play は生成せず unrest Crisis を spawn する。対処 (鎮静/譲歩) は代官の
  //   handle_crisis Project。期限内に解決できなければ unrestCrisisSystem が武装蜂起させる。
  const demand = decideRevoltDemand(ctx, candidate, pop, polity.ownerHouseId)

  let nextCtx = spawnUnrestCrisis(ctx, holdingId, terminalPolityId, demand)

  // 一時的な沈静化 (-50 unrest)。grievance 自体は Crisis が抱え、対処されなければ期限切れで蜂起する。
  nextCtx = {
    ...nextCtx,
    state: adjustProvincePopUnrestByClass(nextCtx.state, provinceId, rebelClass, -50),
  }

  // S2-2 site①: 代官排除反乱の発生時、領主家への悪感情が芽生える (代理人の悪政＝領主不信)。
  if (demand.kind === 'bailiff_dismissal') {
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
  }

  return nextCtx
}

// v0.48 Phase C (§5.3 案 A): unrest Crisis 失効時の武装蜂起。commonwealth + vestigial
//   revolt_negotiation play を生成し、即 applyRevoltEscalation で既存の war 配管を駆動する
//   (Crisis 期間が交渉窓を兼ねたため negotiation 進行は省略)。unrestCrisisSystem から呼ぶ。
export function escalateUnrestCrisis(ctx: TickContext, crisis: Crisis): TickContext {
  const config = ctx.config
  const demand = crisis.demand
  if (!demand) return ctx
  const holdingId = crisis.holdingId
  const holding = ctx.state.holdings[holdingId]
  if (!holding) return ctx
  const provinceId = holding.provinceId
  const province = ctx.state.provinces[provinceId]
  if (!province) return ctx
  const terminalPolityId = getHoldingTerminalPolityId(ctx.state, holdingId)
  if (!terminalPolityId) return ctx
  const polity = ctx.state.polities[terminalPolityId]
  if (!polity || !polity.active) return ctx
  const chain = ctx.state.landContractIndex.byHolding[holdingId] ?? []
  const terminalContractId = chain[chain.length - 1]
  if (!terminalContractId) return ctx
  const contract = ctx.state.landContracts[terminalContractId]
  if (!contract) return ctx
  const rebelClass = demand.claimantPopClass

  const createResult = createNegotiatingCommonwealth(ctx, {
    holdingId,
    provinceId,
    popClass: rebelClass,
    targetPolityId: terminalPolityId,
  })
  if (!createResult.ok) return ctx
  let nextCtx = createResult.value.ctx
  const { polityId: commonwealthId, personId: leaderPersonId } = createResult.value.value

  let primaryDemand: DiplomaticDemand
  if (demand.kind === 'secession') {
    primaryDemand = {
      kind: 'secession',
      holdingId,
      targetContractId: terminalContractId,
      claimantPopClass: rebelClass,
    }
  } else if (demand.kind === 'bailiff_dismissal') {
    primaryDemand = {
      kind: 'bailiff_dismissal',
      holdingId,
      targetContractId: terminalContractId,
      claimantPopClass: rebelClass,
      bailiffPersonId: demand.bailiffPersonId,
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

  const commonwealth = nextCtx.state.polities[commonwealthId]
  if (!commonwealth) return nextCtx
  nextCtx = {
    ...nextCtx,
    state: {
      ...nextCtx.state,
      diplomaticPlays: { ...nextCtx.state.diplomaticPlays, [playId]: play },
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
  nextCtx = { ...ctxStart, events: [...ctxStart.events, event] }

  return applyRevoltEscalation(
    nextCtx,
    play,
    primaryDemand,
    commonwealthId,
    terminalPolityId,
    provinceId,
  )
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
