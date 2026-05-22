import type { TickContext } from './context'
import { createSimEvent } from './context'
import { clamp } from '../utils/math'
import type { DiplomaticPlayId, PolityId, ProvinceId, PopGroupId, HoldingId } from '../types/ids'
import type {
  DiplomaticPlay,
  DiplomaticPlayStatus,
  TerminalDiplomaticPlayStatus,
} from '../types/diplomaticPlay'
import type { EventType, EventMessageParams, EventEntityRef } from '../types/event'
import type { SimEvent } from '../types/event'
import { entityRef, nameParam } from '../types/event'
import { adjustProvincePopUnrestByClass, adjustProvincePopUnrest } from '../mutations/popMutations'
import { adjustProvinceDevelopment } from '../mutations/provinceMutations'
import { disbandRebelPolity, type RebelLeaderAftermath } from '../mutations/worldStructureMutations'
import {
  applyLandContractTransferGoal,
  adjustLandContractTaxRate,
  eliminateContractFromChain,
} from '../mutations/landContractMutations'
import { resolveRevoltConflict } from './provinceRevoltSystem'
import { getHoldingLandContractChain } from '../selectors/landContractSelectors'
import { getActorMilitaryPower } from '../selectors/actorSelectors'
import { calcGeneralWarPowerModifier } from '../selectors/personAbilityEffects'
import { randomFloat } from '../rng/rng'

// v0.18 Stage D §13: ConflictResolutionSystem
//
// status === 'escalated' な DiplomaticPlay を拾い上げ、武力衝突として解決する。
// 結果に応じて勝者側 demand を適用し、play.status を 'resolved_by_conflict' に置換、
// DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT (+ kind 別の WAR_WON / WAR_LOST 等) event を発火する。
//
// kind 別の resolver:
//   - revolt_negotiation → resolveRevoltEscalation (Stage B の resolveRevoltConflict 流用)
//   - land_claim → resolveLandClaimEscalation (§13.2 actor military 比較)
//   - その他 kind の escalation は対象外 (cancelled に倒す)
//
// 配置: diplomaticPlaySystem の直後、cleanupTerminalDiplomacy / integrityCheck の前。

export function runConflictResolutionSystem(ctx: TickContext): TickContext {
  if (!ctx.config.conflictResolutionEnabled) return ctx

  let currentCtx = ctx
  let resolved = 0
  for (const playIdStr of Object.keys(currentCtx.state.diplomaticPlays).sort()) {
    if (resolved >= currentCtx.config.maxConflictsResolvedPerTick) break
    const play = currentCtx.state.diplomaticPlays[playIdStr as DiplomaticPlayId]
    if (!play) continue
    if (play.status !== 'escalated') continue

    if (play.kind === 'revolt_negotiation') {
      currentCtx = resolveRevoltEscalation(currentCtx, play)
    } else if (play.kind === 'land_claim') {
      currentCtx = resolveLandClaimEscalation(currentCtx, play)
    } else if (play.kind === 'contract_tax_revision') {
      currentCtx = resolveContractTaxRevisionEscalation(currentCtx, play)
    } else {
      currentCtx = setPlayStatus(currentCtx, play.id, 'cancelled')
    }
    resolved++
  }
  return currentCtx
}

// ─── revolt_negotiation の escalation (旧 applyRevoltEscalation を移植) ───

function resolveRevoltEscalation(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  if (play.primaryDemand.kind !== 'revolt_concession') {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  const demand = play.primaryDemand
  const rebelPolityId = play.initiator.id
  const targetPolityId = play.target.id
  const provinceId = demand.provinceId
  const popGroupId = demand.popGroupId

  const { result, rng: nextRng } = resolveRevoltConflict(ctx.state, config, ctx.rng, {
    provinceId,
    popGroupId,
    targetPolityId,
  })
  let nextCtx: TickContext = { ...ctx, rng: nextRng }

  if (result.rebelWins) {
    nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')
    const pop = nextCtx.state.popGroups[popGroupId]
    if (pop) {
      const reducedState = adjustProvincePopUnrestByClass(
        nextCtx.state,
        provinceId,
        pop.class,
        -config.revoltSettlementMainUnrestReduction,
      )
      nextCtx = { ...nextCtx, state: reducedState }
    }
    // 既存 conflictResolutionSystem.ts は spec §18 互換のため REVOLT_POLITY_ESTABLISHED 発火
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    const provinceParam = nameParam('province', provinceNameKey)
    nextCtx = emitEvent(nextCtx, {
      type: 'REVOLT_POLITY_ESTABLISHED',
      importance: 'critical',
      polityIds: [rebelPolityId, targetPolityId],
      provinceIds: [provinceId],
      holdingIds: [],
      summary: `The revolt in ${provinceNameKey} has triumphed — independence is achieved.`,
      messageKey: 'revolt.triumphant',
      messageParams: { province: provinceParam },
      eventEntityRefs: [
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef(
          'polity',
          rebelPolityId,
          'rebel_polity',
          nextCtx.state.polities[rebelPolityId]?.nameKey,
        ),
        entityRef(
          'polity',
          targetPolityId,
          'target_polity',
          nextCtx.state.polities[targetPolityId]?.nameKey,
        ),
      ],
    })
    const provNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    return emitResolvedByConflictEvent(nextCtx, play, {
      polityIds: [rebelPolityId, targetPolityId],
      provinceIds: [provinceId],
      holdingIds: [],
      summary: `Conflict over ${provNameKey} ended with rebel victory.`,
      messageKey: 'diplomatic_play.resolved_by_conflict',
      messageParams: {
        summary: `Conflict over ${provNameKey} ended with rebel victory.`,
        province: nameParam('province', provNameKey),
      },
    })
  }

  // Target 勝利 → 鎮圧成功
  const disbandResult = disbandRebelPolity(nextCtx, {
    rebelPolityId,
    restoreToPolityId: targetPolityId,
    provinceId,
    leaderAftermath: pickSuppressionAftermath(nextCtx),
    reason: 'suppression',
  })
  if (!disbandResult.ok) {
    return setPlayStatus(nextCtx, play.id, 'cancelled')
  }
  nextCtx = disbandResult.value.ctx

  let state = nextCtx.state
  const pop = state.popGroups[popGroupId]
  if (pop) {
    state = adjustProvincePopUnrestByClass(
      state,
      provinceId,
      pop.class,
      -config.revoltSuppressedMainUnrestReduction,
    )
    state = adjustProvincePopUnrest(state, provinceId, -config.revoltSuppressedOtherUnrestReduction)
  }
  const province = state.provinces[provinceId]
  if (province) {
    const devResult = adjustProvinceDevelopment(
      state,
      provinceId,
      -config.revoltSuppressedDevelopmentDamage,
    )
    if (devResult.ok) {
      state = devResult.value
    }
  }
  const targetPolityNow = state.polities[targetPolityId]
  if (targetPolityNow) {
    state = {
      ...state,
      polities: {
        ...state.polities,
        [targetPolityId]: {
          ...targetPolityNow,
          legacyPrestige: clamp(targetPolityNow.legacyPrestige + 1, 0, 100),
        },
      },
    }
  }
  nextCtx = { ...nextCtx, state }
  nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')
  const provNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
  return emitResolvedByConflictEvent(nextCtx, play, {
    polityIds: [rebelPolityId, targetPolityId],
    provinceIds: [provinceId],
    holdingIds: [],
    summary: `Revolt in ${provNameKey} was put down by force.`,
    messageKey: 'diplomatic_play.resolved_by_conflict',
    messageParams: {
      summary: `Revolt in ${provNameKey} was put down by force.`,
    },
  })
}

function pickSuppressionAftermath(ctx: TickContext): RebelLeaderAftermath {
  const { value, rng } = randomFloat(ctx.rng)
  void rng
  return value < 0.5 ? 'executed' : 'vanished'
}

// ─── land_claim の escalation (§13.2、Stage F で land_transfer_demand から rename) ───

function resolveLandClaimEscalation(ctx: TickContext, play: DiplomaticPlay): TickContext {
  if (play.primaryDemand.kind !== 'transfer_land_contract') {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  const config = ctx.config
  const demand = play.primaryDemand
  const holdingId = demand.holdingId
  const provinceId = ctx.state.holdings[holdingId]?.provinceId
  if (!provinceId) return setPlayStatus(ctx, play.id, 'cancelled')
  const attackerPolityId = play.initiator.id
  const defenderPolityId = play.target.id

  const state = ctx.state
  const attacker = state.polities[attackerPolityId]
  const defender = state.polities[defenderPolityId]
  if (!attacker || !attacker.active || !defender || !defender.active) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  const claimChain = getHoldingLandContractChain(state, holdingId)
  if (!claimChain.some((c) => c.granteePolityId === defenderPolityId)) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  const attackerPower =
    getActorMilitaryPower(state, config, play.initiator) *
    calcGeneralWarPowerModifier(state, attackerPolityId, config)
  const defenderPower =
    getActorMilitaryPower(state, config, play.target) *
    calcGeneralWarPowerModifier(state, defenderPolityId, config)

  const winChance = attackerPower / (attackerPower + defenderPower + 1)
  const { value: roll, rng: nextRng } = randomFloat(ctx.rng)
  const attackerWins = roll < winChance

  // v0.18 Stage E §21: CLI debug 出力 (--debug 時のみ)
  if (ctx.config.debug) {
    console.error(
      `[DEBUG:CONFLICT] play=${play.id} kind=${play.kind} attackerPower=${attackerPower.toFixed(1)} defenderPower=${defenderPower.toFixed(1)} winChance=${winChance.toFixed(3)} attackerWins=${attackerWins}`,
    )
  }

  let nextCtx: TickContext = { ...ctx, rng: nextRng }
  const currentAbsoluteWeek = nextCtx.state.absoluteWeek

  if (attackerWins) {
    const transferResult = applyLandContractTransferGoal(nextCtx, {
      holdingId,
      fromPolityId: defenderPolityId,
      toPolityId: attackerPolityId,
      reason: 'war',
    })
    if (!transferResult.ok) {
      return setPlayStatus(nextCtx, play.id, 'cancelled')
    }
    nextCtx = transferResult.value.ctx

    // 被害適用 (defender 側)
    nextCtx = applyConflictDamage(nextCtx, {
      loserPolityId: defenderPolityId,
      provinceId,
      mainPopId: getMainPopOfProvince(nextCtx.state, provinceId),
      lastWarWeekAttacker: attackerPolityId,
      lastWarWeekDefender: defenderPolityId,
      currentAbsoluteWeek,
      winnerPolityId: attackerPolityId,
    })

    nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')
    const attackerName = nextCtx.state.polities[attackerPolityId]?.nameKey
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    const provinceParam = nameParam('province', provinceNameKey)
    nextCtx = emitWarOutcomeEvents(nextCtx, {
      winner: attackerPolityId,
      loser: defenderPolityId,
      provinceId,
      holdingIds: [holdingId],
      winnerName: attackerName,
      loserName: defenderName,
    })
    return emitResolvedByConflictEvent(nextCtx, play, {
      polityIds: [attackerPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `${attackerName ?? attackerPolityId} seized ${provinceNameKey} from ${defenderName ?? defenderPolityId}.`,
      messageKey: 'diplomatic_play.resolved_by_conflict',
      messageParams: {
        summary: `${attackerName ?? attackerPolityId} seized ${provinceNameKey} from ${defenderName ?? defenderPolityId}.`,
        province: provinceParam,
      },
    })
  }

  // attacker 敗北 → demand 不適用、attacker に戦費損害
  nextCtx = applyConflictDamage(nextCtx, {
    loserPolityId: attackerPolityId,
    provinceId,
    mainPopId: undefined, // border province の荒廃のみ
    lastWarWeekAttacker: attackerPolityId,
    lastWarWeekDefender: defenderPolityId,
    currentAbsoluteWeek,
    winnerPolityId: defenderPolityId,
  })

  nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')
  const attackerName = nextCtx.state.polities[attackerPolityId]?.nameKey
  const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
  const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
  const provinceParam = nameParam('province', provinceNameKey)
  nextCtx = emitWarOutcomeEvents(nextCtx, {
    winner: defenderPolityId,
    loser: attackerPolityId,
    provinceId,
    holdingIds: [holdingId],
    winnerName: defenderName,
    loserName: attackerName,
  })
  return emitResolvedByConflictEvent(nextCtx, play, {
    polityIds: [attackerPolityId, defenderPolityId],
    provinceIds: [provinceId],
    holdingIds: [holdingId],
    summary: `${defenderName ?? defenderPolityId} repelled ${attackerName ?? attackerPolityId}'s claim on ${provinceNameKey}.`,
    messageKey: 'diplomatic_play.resolved_by_conflict',
    messageParams: {
      summary: `${defenderName ?? defenderPolityId} repelled ${attackerName ?? attackerPolityId}'s claim on ${provinceNameKey}.`,
      province: provinceParam,
    },
  })
}

function resolveContractTaxRevisionEscalation(ctx: TickContext, play: DiplomaticPlay): TickContext {
  if (play.primaryDemand.kind !== 'change_contract_tax_rate') {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  const config = ctx.config
  const demand = play.primaryDemand
  const holdingId = demand.holdingId
  const provinceId = ctx.state.holdings[holdingId]?.provinceId
  if (!provinceId) return setPlayStatus(ctx, play.id, 'cancelled')
  const attackerPolityId = play.initiator.id
  const defenderPolityId = play.target.id

  const state = ctx.state
  const attacker = state.polities[attackerPolityId]
  const defender = state.polities[defenderPolityId]
  if (!attacker || !attacker.active || !defender || !defender.active) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // Verify contract still in chain
  const chain = getHoldingLandContractChain(state, holdingId)
  if (!chain.some((c) => c.id === demand.landContractId)) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  const attackerPower =
    getActorMilitaryPower(state, config, play.initiator) *
    calcGeneralWarPowerModifier(state, attackerPolityId, config)
  const defenderPower =
    getActorMilitaryPower(state, config, play.target) *
    calcGeneralWarPowerModifier(state, defenderPolityId, config)

  const winChance = attackerPower / (attackerPower + defenderPower + 1)
  const { value: roll, rng: nextRng } = randomFloat(ctx.rng)
  const attackerWins = roll < winChance

  if (ctx.config.debug) {
    console.error(
      `[DEBUG:CONFLICT] play=${play.id} kind=${play.kind} attackerPower=${attackerPower.toFixed(1)} defenderPower=${defenderPower.toFixed(1)} winChance=${winChance.toFixed(3)} attackerWins=${attackerWins}`,
    )
  }

  let nextCtx: TickContext = { ...ctx, rng: nextRng }
  const currentAbsoluteWeek = nextCtx.state.absoluteWeek

  if (attackerWins) {
    // Attacker wins: apply the demand (tax change or elimination)
    const newRate = demand.newTaxRateToGrantor
    const contract = state.landContracts[demand.landContractId]

    if (contract && newRate >= config.taxRevisionMinRate && newRate <= config.taxRevisionMaxRate) {
      // Normal: adjust tax rate
      const newState = adjustLandContractTaxRate(nextCtx.state, demand.landContractId, newRate)
      nextCtx = { ...nextCtx, state: newState }
    } else if (contract) {
      // Elimination
      const isReduction = newRate < config.taxRevisionMinRate
      if (isReduction) {
        // Upper elimination: remove defender's contract
        const defenderContract = chain.find((c) => c.granteePolityId === defenderPolityId)
        if (defenderContract) {
          const oldRateToParent = defenderContract.terms.taxRateToGrantor
          const newState = eliminateContractFromChain(
            nextCtx.state,
            defenderContract.id,
            oldRateToParent,
          )
          nextCtx = { ...nextCtx, state: newState }
        }
      } else {
        // Lower elimination: remove target's contract
        const newState = eliminateContractFromChain(nextCtx.state, demand.landContractId)
        nextCtx = { ...nextCtx, state: newState }
      }
    }

    // Apply conflict damage to defender
    nextCtx = applyConflictDamage(nextCtx, {
      loserPolityId: defenderPolityId,
      provinceId,
      mainPopId: getMainPopOfProvince(nextCtx.state, provinceId),
      lastWarWeekAttacker: attackerPolityId,
      lastWarWeekDefender: defenderPolityId,
      currentAbsoluteWeek,
      winnerPolityId: attackerPolityId,
    })

    nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')
    const attackerName = nextCtx.state.polities[attackerPolityId]?.nameKey
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    const provinceParam = nameParam('province', provinceNameKey)
    nextCtx = emitWarOutcomeEvents(nextCtx, {
      winner: attackerPolityId,
      loser: defenderPolityId,
      provinceId,
      holdingIds: [holdingId],
      winnerName: attackerName,
      loserName: defenderName,
    })
    return emitResolvedByConflictEvent(nextCtx, play, {
      polityIds: [attackerPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `${attackerName ?? attackerPolityId} prevails in the tax dispute over ${provinceNameKey}.`,
      messageKey: 'diplomatic_play.resolved_by_conflict',
      messageParams: {
        summary: `${attackerName ?? attackerPolityId} prevails in the tax dispute over ${provinceNameKey}.`,
        province: provinceParam,
      },
    })
  }

  // Defender wins: no demand applied, attacker takes damage
  nextCtx = applyConflictDamage(nextCtx, {
    loserPolityId: attackerPolityId,
    provinceId,
    mainPopId: undefined,
    lastWarWeekAttacker: attackerPolityId,
    lastWarWeekDefender: defenderPolityId,
    currentAbsoluteWeek,
    winnerPolityId: defenderPolityId,
  })

  nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')
  const attackerName = nextCtx.state.polities[attackerPolityId]?.nameKey
  const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
  const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
  const provinceParam = nameParam('province', provinceNameKey)
  nextCtx = emitWarOutcomeEvents(nextCtx, {
    winner: defenderPolityId,
    loser: attackerPolityId,
    provinceId,
    holdingIds: [holdingId],
    winnerName: defenderName,
    loserName: attackerName,
  })
  return emitResolvedByConflictEvent(nextCtx, play, {
    polityIds: [attackerPolityId, defenderPolityId],
    provinceIds: [provinceId],
    holdingIds: [holdingId],
    summary: `${defenderName ?? defenderPolityId} repels the tax revision demand for ${provinceNameKey}.`,
    messageKey: 'diplomatic_play.resolved_by_conflict',
    messageParams: {
      summary: `${defenderName ?? defenderPolityId} repels the tax revision demand for ${provinceNameKey}.`,
      province: provinceParam,
    },
  })
}

function getMainPopOfProvince(
  state: TickContext['state'],
  provinceId: ProvinceId,
): PopGroupId | undefined {
  const province = state.provinces[provinceId]
  if (!province) return undefined
  let maxSize = 0
  let result: PopGroupId | undefined
  for (const popId of province.popGroupIds) {
    const pop = state.popGroups[popId]
    if (!pop) continue
    if (pop.size > maxSize) {
      maxSize = pop.size
      result = popId
    }
  }
  return result
}

function applyConflictDamage(
  ctx: TickContext,
  input: {
    loserPolityId: PolityId
    provinceId: ProvinceId
    mainPopId: PopGroupId | undefined
    lastWarWeekAttacker: PolityId
    lastWarWeekDefender: PolityId
    currentAbsoluteWeek: number
    winnerPolityId: PolityId
  },
): TickContext {
  const config = ctx.config
  let state = ctx.state

  // loser treasury damage
  const loser = state.polities[input.loserPolityId]
  if (loser) {
    const damage = Math.floor(loser.treasury * config.conflictLoserTreasuryDamageFactor)
    state = {
      ...state,
      polities: {
        ...state.polities,
        [input.loserPolityId]: {
          ...loser,
          treasury: Math.max(0, loser.treasury - damage),
          legacyPrestige: clamp(loser.legacyPrestige - 1, 0, 100),
        },
      },
    }
  }
  // winner prestige +1
  const winner = state.polities[input.winnerPolityId]
  if (winner) {
    state = {
      ...state,
      polities: {
        ...state.polities,
        [input.winnerPolityId]: {
          ...winner,
          legacyPrestige: clamp(winner.legacyPrestige + 1, 0, 100),
        },
      },
    }
  }
  // 対象 Province の development 低下
  const province = state.provinces[input.provinceId]
  if (province) {
    const devResult = adjustProvinceDevelopment(
      state,
      input.provinceId,
      -config.conflictProvinceDevastation,
    )
    if (devResult.ok) {
      state = devResult.value
    }
  }
  // 主 PopGroup damage
  if (input.mainPopId) {
    const pop = state.popGroups[input.mainPopId]
    if (pop) {
      state = adjustProvincePopUnrestByClass(
        state,
        input.provinceId,
        pop.class,
        config.conflictPopUnrestGain,
      )
      const popNow = state.popGroups[input.mainPopId]
      if (popNow) {
        state = {
          ...state,
          popGroups: {
            ...state.popGroups,
            [input.mainPopId]: {
              ...popNow,
              wealth: Math.max(0, popNow.wealth - config.conflictPopWealthDamage),
            },
          },
        }
      }
    }
  }
  // lastWarWeek 更新 (両 Polity)
  for (const pid of [input.lastWarWeekAttacker, input.lastWarWeekDefender]) {
    const p = state.polities[pid]
    if (p) {
      state = {
        ...state,
        polities: {
          ...state.polities,
          [pid]: { ...p, lastWarWeek: input.currentAbsoluteWeek },
        },
      }
    }
  }
  return { ...ctx, state }
}

function emitWarOutcomeEvents(
  ctx: TickContext,
  input: {
    winner: PolityId
    loser: PolityId
    provinceId: ProvinceId
    holdingIds: HoldingId[]
    winnerName: string | undefined
    loserName: string | undefined
  },
): TickContext {
  let nextCtx = emitEvent(ctx, {
    type: 'WAR_WON',
    importance: 'major',
    polityIds: [input.winner, input.loser],
    provinceIds: [input.provinceId],
    holdingIds: input.holdingIds,
    summary: `${input.winnerName ?? input.winner} prevailed in war against ${input.loserName ?? input.loser}.`,
    messageKey: 'war.won',
    messageParams: {
      winner: input.winnerName ?? input.winner,
      loser: input.loserName ?? input.loser,
    },
    eventEntityRefs: [
      entityRef('polity', input.winner, 'winner', input.winnerName),
      entityRef('polity', input.loser, 'loser', input.loserName),
      entityRef(
        'province',
        input.provinceId,
        'province',
        ctx.state.provinces[input.provinceId]?.nameKey,
      ),
    ],
  })
  nextCtx = emitEvent(nextCtx, {
    type: 'WAR_LOST',
    importance: 'major',
    polityIds: [input.loser, input.winner],
    provinceIds: [input.provinceId],
    holdingIds: input.holdingIds,
    summary: `${input.loserName ?? input.loser} was defeated by ${input.winnerName ?? input.winner}.`,
    messageKey: 'war.lost',
    messageParams: {
      loser: input.loserName ?? input.loser,
      winner: input.winnerName ?? input.winner,
    },
    eventEntityRefs: [
      entityRef('polity', input.loser, 'loser', input.loserName),
      entityRef('polity', input.winner, 'winner', input.winnerName),
      entityRef(
        'province',
        input.provinceId,
        'province',
        ctx.state.provinces[input.provinceId]?.nameKey,
      ),
    ],
  })
  return nextCtx
}

// ─── 共通 helpers ───

function emitResolvedByConflictEvent(
  ctx: TickContext,
  _play: DiplomaticPlay,
  meta: {
    polityIds: PolityId[]
    provinceIds: ProvinceId[]
    holdingIds: HoldingId[]
    summary: string
    messageKey: string
    messageParams: EventMessageParams
  },
): TickContext {
  return emitEvent(ctx, {
    type: 'DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT',
    importance: 'major',
    polityIds: meta.polityIds,
    provinceIds: meta.provinceIds,
    holdingIds: meta.holdingIds,
    summary: meta.summary,
    messageKey: meta.messageKey,
    messageParams: meta.messageParams,
    eventEntityRefs: [],
  })
}

function emitEvent(
  ctx: TickContext,
  input: {
    type: EventType
    importance: SimEvent['importance']
    polityIds: PolityId[]
    provinceIds: ProvinceId[]
    holdingIds: import('../types/ids').HoldingId[]
    summary: string
    messageKey: string
    messageParams: EventMessageParams
    eventEntityRefs: EventEntityRef[]
  },
): TickContext {
  const { event, ctx: ctxEv } = createSimEvent(ctx, {
    type: input.type,
    importance: input.importance,
    messageKey: input.messageKey,
    messageParams: input.messageParams,
    entityRefs: input.eventEntityRefs,
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
}

function setPlayStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: TerminalDiplomaticPlayStatus,
): TickContext {
  const play = ctx.state.diplomaticPlays[playId]
  if (!play) return ctx
  const nextStatus: DiplomaticPlayStatus = status
  return {
    ...ctx,
    state: {
      ...ctx.state,
      diplomaticPlays: {
        ...ctx.state.diplomaticPlays,
        [playId]: { ...play, status: nextStatus },
      },
    },
  }
}
