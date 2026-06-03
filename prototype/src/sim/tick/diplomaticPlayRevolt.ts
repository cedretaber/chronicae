import type { TickContext } from './context'
import { createSimEvent } from './context'
import { clamp } from '../utils/math'
import type { PolityId, ProvinceId } from '../types/ids'
import type { DiplomaticPlay, DiplomaticDemand } from '../types/diplomaticPlay'
import { entityRef, nameParam } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { adjustProvincePopUnrestByClass } from '../mutations/popMutations'
import { adjustPopAttitude, adjustHouseMembersAttitude } from '../mutations/attitudeMutations'
import { dissolveNegotiatingCommonwealth } from '../mutations/worldStructureMutations'
import {
  adjustLandContractTaxRate,
  createChildLandContract,
} from '../mutations/landContractMutations'
import { createRegiment, syncRegimentOwnerToHomeTerminalMut } from '../mutations/regimentMutations'
import { createOfficeAssignment, revokeOfficesByOrganization } from '../mutations/officeMutations'
import { createOrganizationShare, removeSharesByOrganization } from '../mutations/shareMutations'
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
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // v0.39: popular_tax_relief demand path
  if (play.primaryDemand?.kind === 'popular_tax_relief') {
    return progressPopularTaxRelief(ctx, play, play.primaryDemand, commonwealthId, targetPolityId)
  }

  return ctx
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
  if (!holding) return setPlayStatus(ctx, play.id, 'cancelled')
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

  if (totalSize === 0) return setPlayStatus(ctx, play.id, 'cancelled')

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
    return applyRevoltEscalation(nextCtx, play, demand, commonwealthId, targetPolityId, provinceId)
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
    return applyRevoltEscalation(nextCtx, play, demand, commonwealthId, targetPolityId, provinceId)
  }
  return nextCtx
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
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

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

function applyRevoltEscalation(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'popular_tax_relief' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): TickContext {
  const config = ctx.config
  const targetPolity = ctx.state.polities[targetPolityId]

  // rank 5 → Phase D internal revolt (transitional: dissolve + fail)
  if (targetPolity && targetPolity.rank === 5) {
    return resolveInternalRevolt(ctx, play, demand, commonwealthId, targetPolityId, provinceId)
  }

  // rank 2-4: revolt_seizure contract + Local Levy + escalated
  let state = ctx.state

  // 1. Add revolt_seizure child contract
  const holdingChain = state.landContractIndex.byHolding[demand.holdingId] ?? []
  const terminalContractId = holdingChain[holdingChain.length - 1]
  if (!terminalContractId) return setPlayStatus(ctx, play.id, 'failed')

  const createResult = createChildLandContract(state, {
    provinceId,
    parentContractId: terminalContractId,
    granteePolityId: commonwealthId,
    taxRateToGrantor: 0,
    holdingId: demand.holdingId,
    specialStatus: {
      kind: 'revolt_seizure',
      revoltPolityId: commonwealthId,
      originalTerminalPolityId: targetPolityId,
      startedWeek: state.absoluteWeek,
    },
  })
  state = createResult.state
  const seizureContractId = createResult.contractId

  // 2. Create Local Levy
  const peasants = getHoldingPopSizeByClass(state, demand.holdingId, 'peasants')
  const townsmen = getHoldingPopSizeByClass(state, demand.holdingId, 'townsmen')
  const nobles = getHoldingPopSizeByClass(state, demand.holdingId, 'nobles')
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

    // 奪取 (revolt_seizure 子契約) で holding の terminal Polity が commonwealth に変わったため、
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
            revoltSeizureContractIds: [seizureContractId],
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
  demand: Extract<DiplomaticDemand, { kind: 'popular_tax_relief' }>,
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
    }

    // 2. Revoke old leader, appoint rebel leader
    state = revokeOfficesByOrganization(state, { kind: 'polity', id: targetPolityId }, 'leader')
    state = removeSharesByOrganization(state, { kind: 'polity', id: targetPolityId })
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: targetPolityId },
      'leader',
      leaderPersonId,
    )
    state = createOrganizationShare(
      state,
      { kind: 'polity', id: targetPolityId },
      { kind: 'person', id: leaderPersonId },
      100,
    )

    // 3. Tax reduction
    state = adjustLandContractTaxRate(state, demand.targetContractId, demand.demandedTaxRate)

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

    nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')

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

  nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')

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
