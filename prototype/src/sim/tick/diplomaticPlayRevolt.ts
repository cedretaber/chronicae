import type { TickContext, CreateSimEventInput } from './context'
import { createSimEvent } from './context'
import { clamp } from '../utils/math'
import type { PolityId, ProvinceId, EventId } from '../types/ids'
import type { DiplomaticPlay, DiplomaticDemand } from '../types/diplomaticPlay'
import type { Crisis } from '../types/crisis'
import { getHoldingTerminalPolityId } from '../selectors/landContractSelectors'
import { entityRef, nameParam } from '../types/event'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { awardPersonReputationMut, type AwardReputationInput } from '../helpers/awardHelpers'
import { vacateHoldingBailiff } from '../mutations/provinceOfficeMutations'
import { adjustProvincePopUnrestByClass } from '../mutations/popMutations'
import {
  adjustPopAttitude,
  adjustHouseMembersAttitude,
  worsenPopAttitudeTowardOwnerHouse,
} from '../mutations/attitudeMutations'
import { dissolveNegotiatingCommonwealth } from '../mutations/worldStructureMutations'
import {
  adjustLandContractTaxRate,
  createChildLandContract,
} from '../mutations/landContractMutations'
import { createLandContractDefaultMut } from '../mutations/landContractDefaultMutations'
import { createRegiment, syncRegimentOwnerToHomeTerminalMut } from '../mutations/regimentMutations'
import { createOfficeAssignment, revokeOfficesByOrganization } from '../mutations/officeMutations'
import { getPolityLeader } from '../selectors/officeSelectors'
import { getPolityNameRefForEmit, getPolityEmitNameKey } from '../selectors/nameRefSelectors'
import { getHoldingPopSizeByClass } from '../selectors/popSelectors'
import {
  getProvinceManpowerBase,
  getProvinceHouseManpowerBase,
} from '../selectors/popEconomySelectors'
import { randomFloat } from '../rng/rng'
import { isDeadlineReached, markPlayEscalated, setPlayStatus } from './diplomaticPlayHelpers'

// ─── revolt_negotiation 進行 (Stage B、escalation 経路は Stage D で ConflictResolution に移譲) ───

export function progressRevoltNegotiation(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const state = ctx.state

  if (play.target.kind !== 'polity') return ctx
  const targetPolityId = play.target.id
  if (play.initiator.kind !== 'polity') return ctx
  const commonwealthId = play.initiator.id

  const targetPolity = state.polities[targetPolityId]
  const commonwealth = state.polities[commonwealthId]
  if (!targetPolity || !targetPolity.active || !commonwealth || !commonwealth.active) {
    return setPlayStatus(ctx, play.id, 'cancelled', 'voided')
  }

  // v0.39: popular_tax_relief demand path
  if (play.primaryDemand?.kind === 'popular_tax_relief') {
    return progressPopularTaxRelief(ctx, play, play.primaryDemand, commonwealthId, targetPolityId)
  }

  // v0.48: bailiff_dismissal demand path (代官罷免)
  if (play.primaryDemand?.kind === 'bailiff_dismissal') {
    return progressBailiffDismissal(ctx, play, play.primaryDemand, commonwealthId, targetPolityId)
  }

  // v0.48: secession demand path (独立)。交渉妥結経路を持たず即座に武装蜂起する。
  if (play.primaryDemand?.kind === 'secession') {
    const holding = state.holdings[play.primaryDemand.holdingId]
    if (!holding) return setPlayStatus(ctx, play.id, 'cancelled', 'voided')
    return applyRevoltEscalation(
      ctx,
      play,
      play.primaryDemand,
      commonwealthId,
      targetPolityId,
      holding.provinceId,
    )
  }

  return ctx
}

// v0.48: 代官罷免交渉の進行。進行式は progressPopularTaxRelief を流用するが、
//   税率改定の severity 項を持たない (不人気な代理人を切るだけの軽い譲歩 → 沈静化しやすい)。
function progressBailiffDismissal(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'bailiff_dismissal' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
): TickContext {
  const config = ctx.config
  const state = ctx.state
  const holdingId = demand.holdingId
  const popClass = demand.claimantPopClass

  const holding = state.holdings[holdingId]
  if (!holding) return setPlayStatus(ctx, play.id, 'cancelled', 'voided')
  const provinceId = holding.provinceId

  const popIds = state.popIndex.byHolding[holdingId]
  let totalSize = 0
  let weightedUnrest = 0
  if (popIds) {
    for (const popId of popIds) {
      const p = state.popGroups[popId]
      if (!p || p.class !== popClass) continue
      totalSize += p.size
      weightedUnrest += p.unrest * p.size
    }
  }
  const averageUnrest = totalSize > 0 ? weightedUnrest / totalSize : 0
  if (totalSize === 0) return setPlayStatus(ctx, play.id, 'cancelled', 'voided')

  const rebelPower =
    totalSize * config.popRevoltPowerFactorByClass[popClass] * (0.5 + averageUnrest / 100)
  const suppressionPower = estimateSuppressionPower(state, config, provinceId, targetPolityId)

  const acceptanceScore =
    averageUnrest +
    rebelPower * config.revoltAcceptRebelPowerFactor -
    suppressionPower * config.revoltAcceptSuppressionFactor

  const envFactor = config.revoltNegotiationEnvFactor
  const envProgressDelta = acceptanceScore > 0 ? clamp(acceptanceScore * envFactor, 0.1, 1.5) : 0
  let envTensionDelta = acceptanceScore < 0 ? clamp(-acceptanceScore * envFactor, 0.1, 1.5) : 0
  envTensionDelta += config.diplomaticPlayBaseTensionGain * envFactor

  const nextProgress = clamp(play.progress + envProgressDelta, 0, 100)
  const nextTension = clamp(play.tension + envTensionDelta, 0, 100)

  const adjustedSettlementThreshold =
    config.diplomaticPlaySettlementThreshold -
    play.initiatorPreparation * config.revoltNegotiationSettlementPrepWeight -
    play.initiatorLeverage * config.revoltNegotiationSettlementLeverageWeight +
    play.targetLeverage * config.revoltNegotiationSettlementLeverageWeight

  const adjustedEscalationThreshold =
    config.diplomaticPlayEscalationThreshold -
    play.targetCommitment * config.revoltNegotiationEscalationCommitmentWeight +
    play.initiatorCommitment * config.revoltNegotiationEscalationCommitmentWeight

  const nextCtx: TickContext = {
    ...ctx,
    state: {
      ...state,
      diplomaticPlays: {
        ...state.diplomaticPlays,
        [play.id]: { ...play, progress: nextProgress, tension: nextTension },
      },
    },
  }

  if (nextProgress >= adjustedSettlementThreshold) {
    return applyBailiffDismissalSettlement(
      nextCtx,
      play,
      demand,
      commonwealthId,
      targetPolityId,
      provinceId,
    )
  }

  if (
    nextTension >= adjustedEscalationThreshold ||
    (isDeadlineReached(nextCtx.state, play) && nextTension >= nextProgress)
  ) {
    return applyBailiffDismissalFailure(
      nextCtx,
      play,
      demand,
      commonwealthId,
      targetPolityId,
      provinceId,
    )
  }

  if (isDeadlineReached(nextCtx.state, play)) {
    if (nextProgress > nextTension) {
      return applyBailiffDismissalSettlement(
        nextCtx,
        play,
        demand,
        commonwealthId,
        targetPolityId,
        provinceId,
      )
    }
    return applyBailiffDismissalFailure(
      nextCtx,
      play,
      demand,
      commonwealthId,
      targetPolityId,
      provinceId,
    )
  }
  return nextCtx
}

// v0.48: reputation award の ctx 橋渡し (cleanupTerminalDiplomacy.ts:404-433 と同パターン)。
//   awardPersonReputationMut は mutable ws + emitEvent を要求するため、immutable TickContext から
//   呼ぶには ws を浅コピーし emitEvent closure を張る。event id 採番は createSimEvent と同形式。
function awardReputationViaContext(ctx: TickContext, input: AwardReputationInput): TickContext {
  const ws: WorldState = { ...ctx.state }
  let eventIndex = ctx.nextEventIndex
  const newEvents: SimEvent[] = []
  const emitEvent = (e: CreateSimEventInput): void => {
    const id = `e-${ws.absoluteWeek}-${eventIndex}` as EventId
    eventIndex++
    newEvents.push({
      id,
      year: ws.currentYear,
      weekOfYear: ws.currentWeekOfYear,
      type: e.type,
      importance: e.importance,
      messageKey: e.messageKey,
      messageParams: e.messageParams,
      entityRefs: e.entityRefs ?? [],
      reasons: e.reasons ?? [],
      effects: e.effects ?? [],
    })
  }
  awardPersonReputationMut(ws, ctx.config, input, emitEvent)
  return {
    ...ctx,
    state: ws,
    events: newEvents.length > 0 ? [...ctx.events, ...newEvents] : ctx.events,
    nextEventIndex: eventIndex,
  }
}

function applyBailiffDismissalSettlement(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'bailiff_dismissal' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): TickContext {
  const config = ctx.config
  let state = ctx.state
  const holdingId = demand.holdingId

  // 1. 現 bailiff を再読して staleness ガード。交渉中に代官が交代している場合、住民が恨んだ
  //    代官 (demand.bailiffPersonId) は既に去っており要求は実質達成済み。後任は恨みを買って
  //    いないので罷免・減点しない (= 平和裏に終結)。現 bailiff が要求対象と一致するときのみ処理する。
  const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]
  const assignment = assignmentId ? state.holdingOfficeAssignments[assignmentId] : undefined
  const currentBailiffId = assignment && assignment.active ? assignment.holderPersonId : undefined
  const dismissTargetId =
    currentBailiffId === demand.bailiffPersonId ? demand.bailiffPersonId : undefined

  // 2. 代官を罷免 (vacate のみ。後任/placeholder は次 tick の bailiffAppointmentSystem が入れる)。
  if (dismissTargetId) {
    state = vacateHoldingBailiff(state, holdingId)
  }

  // 3. unrest 削減
  state = adjustProvincePopUnrestByClass(
    state,
    provinceId,
    demand.claimantPopClass,
    -config.revoltSettlementMainUnrestReduction,
  )

  // 4. holding に settlement 記録
  const holding = state.holdings[holdingId]
  if (holding) {
    state = {
      ...state,
      holdings: {
        ...state.holdings,
        [holdingId]: { ...holding, lastRevoltSettledWeek: state.absoluteWeek },
      },
    }
  }

  // 5. commonwealth 解散 (leader 生存)
  let nextCtx: TickContext = { ...ctx, state }
  const dissolveResult = dissolveNegotiatingCommonwealth(nextCtx, {
    commonwealthPolityId: commonwealthId,
    leaderOutcome: 'alive',
  })
  if (dissolveResult.ok) nextCtx = dissolveResult.value.ctx

  // 6. 罷免イベント + 罷免代官への負 stewardship 評判 (統治失敗の悪評)。
  if (dismissTargetId) {
    const bailiff = nextCtx.state.persons[dismissTargetId]
    const provinceName = nameParam(
      'province',
      nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
    )
    const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
      type: 'BAILIFF_DISMISSED_BY_REVOLT',
      importance: 'major',
      messageKey: 'bailiff.dismissed_by_revolt',
      messageParams: {
        person: nameParam('person', bailiff?.nameKey ?? dismissTargetId),
        province: provinceName,
      },
      entityRefs: [
        entityRef('person', dismissTargetId, 'subject', bailiff?.nameKey),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef('polity', targetPolityId, 'target_polity'),
      ],
    })
    nextCtx = { ...ctxEv, events: [...ctxEv.events, event] }

    nextCtx = awardReputationViaContext(nextCtx, {
      personId: dismissTargetId,
      source: { kind: 'revolt', playId: play.id },
      category: 'stewardship',
      baseScore: config.revoltBailiffReputationPenalty,
    })
  }

  // 7. play 終結
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled', 'demands_met')
  return nextCtx
}

// v0.48 S2-2 site②: 代官罷免要求が拒否され武力化した。領主が悪い代官を守った/応じなかった
//   ことで住民の領主家への悪感情が強まる (-8)。その後は通常の escalation (seizure→war)。
function applyBailiffDismissalFailure(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'bailiff_dismissal' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): TickContext {
  const ownerHouseId = ctx.state.polities[targetPolityId]?.ownerHouseId
  const state = worsenPopAttitudeTowardOwnerHouse(
    ctx.state,
    demand.holdingId,
    demand.claimantPopClass,
    ownerHouseId,
    ctx.config.revoltBailiffDismissalFailHouseAffectionPenalty,
  )
  const nextCtx: TickContext = { ...ctx, state }
  return applyRevoltEscalation(nextCtx, play, demand, commonwealthId, targetPolityId, provinceId)
}

function progressPopularTaxRelief(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'popular_tax_relief' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
): TickContext {
  const config = ctx.config
  const state = ctx.state
  const holdingId = demand.holdingId
  const popClass = demand.claimantPopClass

  const holding = state.holdings[holdingId]
  if (!holding) return setPlayStatus(ctx, play.id, 'cancelled', 'voided')
  const provinceId = holding.provinceId

  const popIds = state.popIndex.byHolding[holdingId]
  let totalSize = 0
  let weightedUnrest = 0
  if (popIds) {
    for (const popId of popIds) {
      const p = state.popGroups[popId]
      if (!p || p.class !== popClass) continue
      totalSize += p.size
      weightedUnrest += p.unrest * p.size
    }
  }
  const averageUnrest = totalSize > 0 ? weightedUnrest / totalSize : 0

  if (totalSize === 0) return setPlayStatus(ctx, play.id, 'cancelled', 'voided')

  const rebelPower =
    totalSize * config.popRevoltPowerFactorByClass[popClass] * (0.5 + averageUnrest / 100)
  const suppressionPower = estimateSuppressionPower(state, config, provinceId, targetPolityId)
  const taxReliefSeverity =
    (demand.currentTaxRate - demand.demandedTaxRate) * config.taxReliefSeverityFactor

  const acceptanceScore =
    averageUnrest +
    rebelPower * config.revoltAcceptRebelPowerFactor -
    suppressionPower * config.revoltAcceptSuppressionFactor -
    taxReliefSeverity

  // v0.39.1: hybrid model — environmental factors provide small structural increment,
  // task effects (via applyDiplomaticTaskEffectMut) are the main driver
  const envFactor = config.revoltNegotiationEnvFactor
  const envProgressDelta = acceptanceScore > 0 ? clamp(acceptanceScore * envFactor, 0.1, 1.5) : 0
  let envTensionDelta = acceptanceScore < 0 ? clamp(-acceptanceScore * envFactor, 0.1, 1.5) : 0
  envTensionDelta += config.diplomaticPlayBaseTensionGain * envFactor

  const nextProgress = clamp(play.progress + envProgressDelta, 0, 100)
  const nextTension = clamp(play.tension + envTensionDelta, 0, 100)

  // Adjusted thresholds based on preparation/leverage/commitment
  const adjustedSettlementThreshold =
    config.diplomaticPlaySettlementThreshold -
    play.initiatorPreparation * config.revoltNegotiationSettlementPrepWeight -
    play.initiatorLeverage * config.revoltNegotiationSettlementLeverageWeight +
    play.targetLeverage * config.revoltNegotiationSettlementLeverageWeight

  const adjustedEscalationThreshold =
    config.diplomaticPlayEscalationThreshold -
    play.targetCommitment * config.revoltNegotiationEscalationCommitmentWeight +
    play.initiatorCommitment * config.revoltNegotiationEscalationCommitmentWeight

  const nextCtx: TickContext = {
    ...ctx,
    state: {
      ...state,
      diplomaticPlays: {
        ...state.diplomaticPlays,
        [play.id]: { ...play, progress: nextProgress, tension: nextTension },
      },
    },
  }

  if (nextProgress >= adjustedSettlementThreshold) {
    return applyPopularTaxReliefSettlement(
      nextCtx,
      play,
      demand,
      commonwealthId,
      targetPolityId,
      provinceId,
    )
  }

  if (
    nextTension >= adjustedEscalationThreshold ||
    (isDeadlineReached(nextCtx.state, play) && nextTension >= nextProgress)
  ) {
    return applyTaxReliefFizzle(nextCtx, play, demand, commonwealthId, targetPolityId, provinceId)
  }

  if (isDeadlineReached(nextCtx.state, play)) {
    if (nextProgress > nextTension) {
      return applyPopularTaxReliefSettlement(
        nextCtx,
        play,
        demand,
        commonwealthId,
        targetPolityId,
        provinceId,
      )
    }
    return applyTaxReliefFizzle(nextCtx, play, demand, commonwealthId, targetPolityId, provinceId)
  }
  return nextCtx
}

// v0.48 S2-3: 税率改定交渉の不調 (旧: 即 escalation→独立)。即独立を求めず、commonwealth を
//   解散して矛を収める。ただし領主が譲歩しなかったことで POP→house 悪感情が蓄積し (-5)、
//   繰り返されると次回反乱が独立 (secession) 分岐に進む創発フローを成立させる。
function applyTaxReliefFizzle(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'popular_tax_relief' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): TickContext {
  const config = ctx.config
  let state = ctx.state

  // 1. POP→house 悪感情 (-5)
  const ownerHouseId = state.polities[targetPolityId]?.ownerHouseId
  state = worsenPopAttitudeTowardOwnerHouse(
    state,
    demand.holdingId,
    demand.claimantPopClass,
    ownerHouseId,
    config.revoltTaxReliefFizzleHouseAffectionPenalty,
  )

  // 2. holding に settlement 記録 (cooldown)
  const holding = state.holdings[demand.holdingId]
  if (holding) {
    state = {
      ...state,
      holdings: {
        ...state.holdings,
        [demand.holdingId]: { ...holding, lastRevoltSettledWeek: state.absoluteWeek },
      },
    }
  }

  // 3. commonwealth 解散 (leader 生存)
  let nextCtx: TickContext = { ...ctx, state }
  const dissolveResult = dissolveNegotiatingCommonwealth(nextCtx, {
    commonwealthPolityId: commonwealthId,
    leaderOutcome: 'alive',
  })
  if (dissolveResult.ok) nextCtx = dissolveResult.value.ctx

  // 4. play 終結 (status_quo — 要求は通らなかった)
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled', 'status_quo')

  // 5. event (REVOLT_SETTLED 型 + 専用 messageKey)
  const provinceName = nameParam(
    'province',
    nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
  )
  const targetPolityRef = getPolityNameRefForEmit(nextCtx.state, targetPolityId)
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_SETTLED',
    importance: 'major',
    messageKey: 'revolt.tax_relief_fizzled',
    messageParams: {
      province: provinceName,
      restorePolity: nameParam(targetPolityRef.category, targetPolityRef.nameKey),
    },
    entityRefs: [
      entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      entityRef('polity', commonwealthId, 'rebel_polity'),
      entityRef('polity', targetPolityId, 'target_polity', targetPolityRef.nameKey),
    ],
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
}

function applyPopularTaxReliefSettlement(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'popular_tax_relief' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): TickContext {
  const config = ctx.config
  let state = ctx.state

  // 1. Tax rate reduction
  state = adjustLandContractTaxRate(state, demand.targetContractId, demand.demandedTaxRate)

  // 2. Terms protection + history tracking
  const contract = state.landContracts[demand.targetContractId]
  if (contract) {
    state = {
      ...state,
      landContracts: {
        ...state.landContracts,
        [demand.targetContractId]: {
          ...contract,
          termsProtectedUntilWeek: state.absoluteWeek + config.popularTaxReliefTermsProtectionWeeks,
          lastTaxChangedWeek: state.absoluteWeek,
          previousTaxRate: demand.currentTaxRate,
        },
      },
    }
  }

  // 3. Reduce unrest
  state = adjustProvincePopUnrestByClass(
    state,
    provinceId,
    demand.claimantPopClass,
    -config.revoltSettlementMainUnrestReduction,
  )

  // 4. Record settlement on Holding
  const holding = state.holdings[demand.holdingId]
  if (holding) {
    state = {
      ...state,
      holdings: {
        ...state.holdings,
        [demand.holdingId]: { ...holding, lastRevoltSettledWeek: state.absoluteWeek },
      },
    }
  }

  // 5. Dissolve commonwealth (leader survives)
  let nextCtx: TickContext = { ...ctx, state }
  const dissolveResult = dissolveNegotiatingCommonwealth(nextCtx, {
    commonwealthPolityId: commonwealthId,
    leaderOutcome: 'alive',
  })
  if (dissolveResult.ok) {
    nextCtx = dissolveResult.value.ctx
  }

  // 6. Set play status
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled', 'demands_met')

  // 7. Event
  const provinceName = nameParam(
    'province',
    nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
  )
  const targetPolityRef = getPolityNameRefForEmit(nextCtx.state, targetPolityId)
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_SETTLED',
    importance: 'major',
    messageKey: 'revolt.settled_pardoned',
    messageParams: {
      province: provinceName,
      restorePolity: nameParam(targetPolityRef.category, targetPolityRef.nameKey),
    },
    entityRefs: [
      entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      entityRef('polity', commonwealthId, 'rebel_polity'),
      entityRef('polity', targetPolityId, 'target_polity', targetPolityRef.nameKey),
    ],
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
}

// v0.48 Phase C: unrest Crisis 解決時の譲歩適用 (commonwealth/play なし版, §5.3 / Decision 1)。
//   tax_relief → 減税 + terms 保護、bailiff_dismissal → 代官罷免 (staleness ガード付き) + 悪評。
//   いずれも反乱 class の unrest を下げて grievance を実際に解消する (放置すると無限再発するため)。
//   secession は譲歩で解消できないため呼び出し側 (unrestCrisisSystem) が鎮静扱いにする (ここには来ない)。
export function applyUnrestConcession(ctx: TickContext, crisis: Crisis): TickContext {
  const config = ctx.config
  let state = ctx.state
  const demand = crisis.demand
  if (!demand) return ctx
  const holdingId = crisis.holdingId
  const holding = state.holdings[holdingId]
  if (!holding) return ctx
  const provinceId = holding.provinceId
  const targetPolityId = getHoldingTerminalPolityId(state, holdingId)
  const chain = state.landContractIndex.byHolding[holdingId] ?? []
  const terminalContractId = chain[chain.length - 1]

  if (demand.kind === 'tax_relief') {
    if (terminalContractId) {
      const contract = state.landContracts[terminalContractId]
      if (contract) {
        const currentTaxRate = contract.terms.taxRateToGrantor
        const demandedTaxRate = Math.max(
          config.minPopularDemandTaxRate,
          currentTaxRate - config.popularTaxReliefDemandDelta,
        )
        state = adjustLandContractTaxRate(state, terminalContractId, demandedTaxRate)
        const c2 = state.landContracts[terminalContractId]
        if (c2) {
          state = {
            ...state,
            landContracts: {
              ...state.landContracts,
              [terminalContractId]: {
                ...c2,
                termsProtectedUntilWeek:
                  state.absoluteWeek + config.popularTaxReliefTermsProtectionWeeks,
                lastTaxChangedWeek: state.absoluteWeek,
                previousTaxRate: currentTaxRate,
              },
            },
          }
        }
      }
    }
    state = adjustProvincePopUnrestByClass(
      state,
      provinceId,
      demand.claimantPopClass,
      -config.revoltSettlementMainUnrestReduction,
    )
    const h = state.holdings[holdingId]
    if (h) {
      state = {
        ...state,
        holdings: {
          ...state.holdings,
          [holdingId]: { ...h, lastRevoltSettledWeek: state.absoluteWeek },
        },
      }
    }
    const nextCtx: TickContext = { ...ctx, state }
    const provinceName = nameParam('province', state.provinces[provinceId]?.nameKey ?? provinceId)
    const restoreRef = targetPolityId
      ? getPolityNameRefForEmit(state, targetPolityId)
      : { category: 'polity', nameKey: '' }
    const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
      type: 'REVOLT_SETTLED',
      importance: 'major',
      messageKey: 'revolt.settled_pardoned',
      messageParams: {
        province: provinceName,
        restorePolity: nameParam(restoreRef.category, restoreRef.nameKey),
      },
      entityRefs: [
        entityRef('province', provinceId, 'province', state.provinces[provinceId]?.nameKey),
        ...(targetPolityId
          ? [entityRef('polity', targetPolityId, 'target_polity', restoreRef.nameKey)]
          : []),
      ],
    })
    return { ...ctxEv, events: [...ctxEv.events, event] }
  }

  if (demand.kind === 'bailiff_dismissal') {
    // staleness ガード: 交渉中に代官が交代していたら罷免不要 (恨まれた代官は既に去った)。
    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]
    const assignment = assignmentId ? state.holdingOfficeAssignments[assignmentId] : undefined
    const currentBailiffId = assignment && assignment.active ? assignment.holderPersonId : undefined
    const dismissTargetId =
      currentBailiffId === demand.bailiffPersonId ? demand.bailiffPersonId : undefined
    if (dismissTargetId) state = vacateHoldingBailiff(state, holdingId)
    state = adjustProvincePopUnrestByClass(
      state,
      provinceId,
      demand.claimantPopClass,
      -config.revoltSettlementMainUnrestReduction,
    )
    const h = state.holdings[holdingId]
    if (h) {
      state = {
        ...state,
        holdings: {
          ...state.holdings,
          [holdingId]: { ...h, lastRevoltSettledWeek: state.absoluteWeek },
        },
      }
    }
    let nextCtx: TickContext = { ...ctx, state }
    if (dismissTargetId) {
      const bailiff = nextCtx.state.persons[dismissTargetId]
      const provinceName = nameParam(
        'province',
        nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
      )
      const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
        type: 'BAILIFF_DISMISSED_BY_REVOLT',
        importance: 'major',
        messageKey: 'bailiff.dismissed_by_revolt',
        messageParams: {
          person: nameParam('person', bailiff?.nameKey ?? dismissTargetId),
          province: provinceName,
        },
        entityRefs: [
          entityRef('person', dismissTargetId, 'subject', bailiff?.nameKey),
          entityRef(
            'province',
            provinceId,
            'province',
            nextCtx.state.provinces[provinceId]?.nameKey,
          ),
        ],
      })
      nextCtx = { ...ctxEv, events: [...ctxEv.events, event] }
      nextCtx = awardReputationViaContext(nextCtx, {
        personId: dismissTargetId,
        source: { kind: 'revolt' },
        category: 'stewardship',
        baseScore: config.revoltBailiffReputationPenalty,
      })
    }
    return nextCtx
  }

  return ctx
}

// v0.48: escalation 経路は popular_tax_relief と bailiff_dismissal の両方から到達する。
//   両者の共通部分 (holdingId / targetContractId / claimantPopClass) のみ使い、
//   demandedTaxRate に依存する箇所は kind で guard する。
type RevoltEscalationDemand = Extract<
  DiplomaticDemand,
  { kind: 'popular_tax_relief' | 'bailiff_dismissal' | 'secession' }
>

export function applyRevoltEscalation(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: RevoltEscalationDemand,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): TickContext {
  const config = ctx.config

  // 叛乱対象は holding の「現」terminal holder。play.target は play 作成時の terminal holder で
  // 固定されるため、交渉中に land_grant / 契約移管で当該 holding が再分封されると stale になる。
  // rank 判定・internal revolt 対象は常に現 terminal holder を基準にする (§13.6 / §25 #7)。
  const holdingChain = ctx.state.landContractIndex.byHolding[demand.holdingId] ?? []
  const terminalContractId = holdingChain[holdingChain.length - 1]
  if (!terminalContractId) return setPlayStatus(ctx, play.id, 'failed', 'failed')
  const terminalContract = ctx.state.landContracts[terminalContractId]
  const terminalHolderId = terminalContract?.granteePolityId
  const terminalHolder = terminalHolderId ? ctx.state.polities[terminalHolderId] : undefined
  if (!terminalContract || !terminalHolderId || !terminalHolder) {
    // terminal holder が消失 (stale) → 叛乱前提が崩れたので play を fail。
    return setPlayStatus(ctx, play.id, 'failed', 'failed')
  }

  // 現 terminal holder の rank が commonwealth (rank 5) 以上だと、revolt_seizure 子契約は
  // grantor rank >= grantee rank (§25 #7) を破る (子契約の grantor = terminal holder)。
  // この場合は子契約を作らず Phase D internal revolt (現 terminal holder の regime change) へ。
  // 通常は play.target == terminal holder なので挙動不変。再分封で terminal holder が rank5 に
  // 変わった stale ケースのみここで分岐する。
  const commonwealthPolity = ctx.state.polities[commonwealthId]
  if (commonwealthPolity && terminalHolder.rank >= commonwealthPolity.rank) {
    return resolveInternalRevolt(ctx, play, demand, commonwealthId, terminalHolderId, provinceId)
  }

  // rank 2-4: nominal occupation contract + revolt_independence default + Local Levy + escalated
  let state = ctx.state

  // 1. v0.53 (§14.3): nominal occupation contract (正税率, specialStatus なし) を現 terminalContractId 上に作る。
  //   commonwealth を terminal holder にする占拠契約。tax-0 / revolt_seizure specialStatus は使わない。
  const createResult = createChildLandContract(state, {
    provinceId,
    parentContractId: terminalContractId,
    granteePolityId: commonwealthId,
    taxRateToGrantor: config.revoltOccupationNominalTaxRate,
    holdingId: demand.holdingId,
  })
  state = createResult.state
  const nominalContractId = createResult.contractId

  // 1b. v0.53 (§14.4): revolt_independence default を作成。occupiedBy=commonwealth、claimant=旧 terminal holder。
  //   LandRevenue 上は nominal tax が実効 0 に上書きされる (commonwealth は旧 overlord に払わない, §11.2)。
  state = {
    ...state,
    landContractDefaults: { ...state.landContractDefaults },
    landContractDefaultIndex: {
      byHolding: { ...state.landContractDefaultIndex.byHolding },
      byContract: { ...state.landContractDefaultIndex.byContract },
      byClaimantPolity: { ...state.landContractDefaultIndex.byClaimantPolity },
      byOccupierPolity: { ...state.landContractDefaultIndex.byOccupierPolity },
    },
  }
  const revoltDefault = createLandContractDefaultMut(state, {
    origin: 'revolt_independence',
    holdingId: demand.holdingId,
    occupiedByPolityId: commonwealthId,
    claimantPolityId: terminalHolderId,
    targetLandContractId: nominalContractId,
    originalGrantorPolityId: terminalHolderId,
    originalGranteePolityId: commonwealthId,
    originalTaxRateToGrantor: terminalContract.terms.taxRateToGrantor,
    startedWeek: state.absoluteWeek,
  })

  // 2. Create Local Levy
  const peasants = getHoldingPopSizeByClass(state, demand.holdingId, 'lower')
  const townsmen = getHoldingPopSizeByClass(state, demand.holdingId, 'middle')
  const nobles = getHoldingPopSizeByClass(state, demand.holdingId, 'upper')
  const levyStrength = Math.max(
    config.localLevyMinStrength,
    Math.min(
      config.localLevyMaxStrength,
      peasants * config.localLevyPeasantFactor +
        townsmen * config.localLevyTownsmenFactor +
        nobles * config.localLevyNobleFactor,
    ),
  )
  const holding = state.holdings[demand.holdingId]
  if (holding) {
    const levy = createRegiment(state, {
      owner: { kind: 'polity', id: commonwealthId },
      sourceKind: 'local_levy',
      troopKind: 'infantry',
      homeHoldingId: demand.holdingId,
      homeProvinceId: provinceId,
      strength: levyStrength,
      organization: config.localLevyOrganization,
      morale: config.localLevyMorale,
      maxStrength: levyStrength,
      basePower: levyStrength * config.localLevyBasePowerFactor,
      baselineOrganization: config.localLevyOrganization,
      maxOrganization: 50,
      baselineMorale: config.localLevyMorale,
      maxMorale: 50,
      createdWeek: state.absoluteWeek,
    })
    levy.disbandAfterWar = true

    // 占拠 (nominal occupation contract) で holding の terminal Polity が commonwealth に変わったため、
    // 当該 holding の既存常設連隊 (worldgen 由来 levy/noble_retinue 等) の owner を開戦前に即同期する。
    // regimentMaintenanceSystem の lazy 付け替え (§14.6) は warManeuver の後に走り、奪取→即開戦の
    // 叛乱には間に合わない (放置すると当該連隊が領主=defender 側として動員され叛乱側に来ない)。
    // 付け替えルールは syncRegimentOwnerToHomeTerminalMut に集約済 (maintenance と同一の真実)。
    // 直前に作った levy (owner=commonwealth=terminal) は no-op。動員済の連隊は owner だけ移り
    // 当該戦争は次 tick 以降の動員判定 (currentWarId) でスキップされる。
    for (const rid of [...(state.regimentIndex.byHomeHolding[demand.holdingId] ?? [])]) {
      syncRegimentOwnerToHomeTerminalMut(state, rid)
    }
  }

  // 3. Update revoltState to revolting
  const commonwealth = state.polities[commonwealthId]
  if (commonwealth) {
    state = {
      ...state,
      polities: {
        ...state.polities,
        [commonwealthId]: {
          ...commonwealth,
          revoltState: {
            kind: 'revolting',
            revoltDefaultIds: [revoltDefault.id],
          },
        },
      },
    }
  }

  // 4. Mark play escalated (warCreationSystem will consume)
  let nextCtx: TickContext = { ...ctx, state }
  const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
  nextCtx = markPlayEscalated(nextCtx, play.id, {
    polityIds: [commonwealthId, targetPolityId],
    provinceIds: [provinceId],
    holdingIds: [demand.holdingId],
    summary: `Revolt in ${provinceNameKey} has escalated to armed conflict.`,
    messageKey: 'diplomatic_play.escalated_revolt',
    messageParams: { province: nameParam('province', provinceNameKey) },
    eventEntityRefs: [
      entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      entityRef('polity', commonwealthId, 'rebel_polity'),
      entityRef(
        'polity',
        targetPolityId,
        'target_polity',
        getPolityEmitNameKey(nextCtx.state, targetPolityId),
      ),
    ],
  })

  // Emit REVOLT_ESCALATED
  const provinceName = nameParam('province', provinceNameKey)
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_ESCALATED',
    importance: 'major',
    messageKey: 'revolt.escalated',
    messageParams: { province: provinceName },
    entityRefs: [
      entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      entityRef('polity', commonwealthId, 'rebel_polity'),
      entityRef(
        'polity',
        targetPolityId,
        'target_polity',
        getPolityEmitNameKey(nextCtx.state, targetPolityId),
      ),
    ],
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
}

function resolveInternalRevolt(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: RevoltEscalationDemand,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): TickContext {
  let state = ctx.state
  const holdingId = demand.holdingId

  // Simple force comparison (spec §13.6)
  const popIds = state.popIndex.byHolding[holdingId]
  let totalSize = 0
  let weightedUnrest = 0
  if (popIds) {
    for (const popId of popIds) {
      const p = state.popGroups[popId]
      if (!p || p.class !== demand.claimantPopClass) continue
      totalSize += p.size
      weightedUnrest += p.unrest * p.size
    }
  }
  const avgUnrest = totalSize > 0 ? weightedUnrest / totalSize : 0

  const cwOrigin = state.polities[commonwealthId]?.origin
  const leaderPersonId = cwOrigin?.kind === 'popular_revolt' ? cwOrigin.leaderPersonId : undefined
  const leader = leaderPersonId ? state.persons[leaderPersonId] : undefined
  const leaderBonus = leader
    ? leader.abilities.charisma * 0.5 + leader.abilities.command * 0.5 + leader.traits.ambition * 30
    : 0

  const rebelPower = totalSize * 0.5 * (0.5 + avgUnrest / 100) + leaderBonus

  const targetPolity = state.polities[targetPolityId]
  const targetLeaderId = targetPolity ? getPolityLeader(state, targetPolityId) : undefined
  const targetLeader = targetLeaderId ? state.persons[targetLeaderId] : undefined
  const defenderBonus = targetLeader
    ? targetLeader.abilities.command * 0.5 + targetLeader.traits.caution * 20
    : 0
  const holding = state.holdings[holdingId]
  const polityControl = holding?.polityControl ?? 50
  const defenderPower = polityControl * 0.5 + defenderBonus

  const successChance = rebelPower / (rebelPower + defenderPower + 1)
  const { value: roll, rng: nextRng } = randomFloat(ctx.rng)
  ctx = { ...ctx, rng: nextRng }
  const success = roll < successChance

  if (success && targetPolity && leaderPersonId && leader) {
    // Internal revolt success: regime change
    // 1. Transform target polity
    // commonwealth 化で ownerHouseId を undefined にするため、旧 owner の
    // polityIndex.byOwnerHouse スロットから targetPolityId を除去する (§25 #16 同期維持)。
    const previousOwnerHouseId = targetPolity.ownerHouseId
    const byOwnerHouse =
      previousOwnerHouseId !== undefined
        ? {
            ...state.polityIndex.byOwnerHouse,
            [previousOwnerHouseId]: (
              state.polityIndex.byOwnerHouse[previousOwnerHouseId] ?? []
            ).filter((p) => p !== targetPolityId),
          }
        : state.polityIndex.byOwnerHouse
    state = {
      ...state,
      polities: {
        ...state.polities,
        [targetPolityId]: {
          ...targetPolity,
          kind: 'commonwealth',
          ownerHouseId: undefined,
          origin: {
            kind: 'regime_changed_by_popular_revolt',
            previousOwnerHouseId: targetPolity.ownerHouseId,
            provinceId,
            holdingId,
            popClass: demand.claimantPopClass,
            leaderPersonId,
            week: state.absoluteWeek,
          },
          revoltState: { kind: 'established' },
        },
      },
      polityIndex: { byOwnerHouse },
    }

    // 2. Revoke old leader, appoint rebel leader
    state = revokeOfficesByOrganization(state, { kind: 'polity', id: targetPolityId }, 'leader')
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: targetPolityId },
      'leader',
      leaderPersonId,
    )
    // v0.42c §15.1: person-holder polity share は廃止 (ruler domain で表現)

    // 3. Tax reduction (税率改定要求のみ。代官罷免要求が武力化した場合は税率は据え置く)
    if (demand.kind === 'popular_tax_relief') {
      state = adjustLandContractTaxRate(state, demand.targetContractId, demand.demandedTaxRate)
    }

    // 4. Unrest reduction
    state = adjustProvincePopUnrestByClass(state, provinceId, demand.claimantPopClass, -30)

    // 4b. POP attitude boost toward new commonwealth (§14.5)
    const popIds = state.popIndex.byHolding[holdingId]
    if (popIds) {
      for (const popId of popIds) {
        const r = adjustPopAttitude(
          state,
          popId,
          { kind: 'polity', id: targetPolityId },
          { affection: 15, respect: 10 },
        )
        if (r.ok) state = r.value
      }
    }
    // 4c. Old owner house members attitude penalty toward new regime (§14.5)
    if (targetPolity.ownerHouseId !== undefined) {
      const r = adjustHouseMembersAttitude(
        state,
        targetPolity.ownerHouseId,
        { kind: 'polity', id: targetPolityId },
        { affection: -20, respect: -10 },
      )
      if (r.ok) state = r.value
    }

    // 5. Dissolve negotiating commonwealth
    let nextCtx: TickContext = { ...ctx, state }
    const dissolveResult = dissolveNegotiatingCommonwealth(nextCtx, {
      commonwealthPolityId: commonwealthId,
      leaderOutcome: 'alive',
    })
    if (dissolveResult.ok) nextCtx = dissolveResult.value.ctx

    nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict', 'revolt_succeeded')

    const provinceName = nameParam(
      'province',
      nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
    )
    const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
      type: 'REVOLT_REGIME_CHANGED',
      importance: 'critical',
      messageKey: 'revolt.regime_changed',
      messageParams: { province: provinceName },
      entityRefs: [
        entityRef('province', provinceId, 'province'),
        entityRef('polity', targetPolityId, 'polity'),
        entityRef('person', leaderPersonId, 'leader'),
      ],
    })
    return { ...ctxEv, events: [...ctxEv.events, event] }
  }

  // Internal revolt failure: suppression
  state = adjustProvincePopUnrestByClass(state, provinceId, demand.claimantPopClass, -20)

  if (holding) {
    state = {
      ...state,
      holdings: {
        ...state.holdings,
        [holdingId]: {
          ...state.holdings[holdingId]!,
          lastRevoltSuppressedWeek: state.absoluteWeek,
        },
      },
    }
  }

  let nextCtx: TickContext = { ...ctx, state }
  const leaderOutcome: 'executed' | 'pardoned' =
    roll < successChance * 0.5 ? 'pardoned' : 'executed'
  const dissolveResult = dissolveNegotiatingCommonwealth(nextCtx, {
    commonwealthPolityId: commonwealthId,
    leaderOutcome,
  })
  if (dissolveResult.ok) nextCtx = dissolveResult.value.ctx

  nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict', 'revolt_suppressed')

  const provinceName = nameParam(
    'province',
    nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
  )
  const targetPolityRef = getPolityNameRefForEmit(nextCtx.state, targetPolityId)
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_SUPPRESSED',
    importance: 'major',
    messageKey:
      leaderOutcome === 'executed' ? 'revolt.suppressed_executed' : 'revolt.suppressed_pardoned',
    messageParams: {
      province: provinceName,
      restorePolity: nameParam(targetPolityRef.category, targetPolityRef.nameKey),
    },
    entityRefs: [
      entityRef('province', provinceId, 'province'),
      entityRef('polity', targetPolityId, 'polity'),
    ],
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
}

function estimateSuppressionPower(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
  targetPolityId: PolityId,
): number {
  const targetPolity = state.polities[targetPolityId]
  if (!targetPolity) return 1

  const polityManpower = getProvinceManpowerBase(state, config, provinceId)
  let suppressionPower =
    polityManpower * config.provinceRevoltCountrySuppressionFactor +
    Math.log1p(targetPolity.treasury) * config.provinceRevoltTreasurySuppressionFactor
  const targetOwnerHouseId = targetPolity.ownerHouseId
  if (targetOwnerHouseId !== undefined) {
    const ownerHouse = state.houses[targetOwnerHouseId]
    if (ownerHouse) {
      suppressionPower +=
        getProvinceHouseManpowerBase(state, config, provinceId) *
        config.provinceRevoltHouseSuppressionFactor
      suppressionPower +=
        Math.log1p(ownerHouse.wealth) * config.provinceRevoltHouseWealthSuppressionFactor
    }
  }
  return suppressionPower
}
