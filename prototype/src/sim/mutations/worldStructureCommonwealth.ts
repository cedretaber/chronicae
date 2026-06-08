import type { TickContext } from '../tick/context'
import { makePersonId, makePolityId, createSimEvent } from '../tick/context'
import { nameParam, entityRef } from '../types/event'
import { randomFloat, randomInt } from '../rng/rng'
import type { PersonId, ProvinceId, PolityId, HoldingId, LandContractId } from '../types/ids'
import type { Polity } from '../types/polity'
import type { WorldState } from '../types/world'
import type { PopClass } from '../types/popGroup'
import type { CtxResult } from './result'
import { ok, err } from './result'
import { createOfficeAssignment, revokeOfficesByOrganization } from './officeMutations'
import { markPersonDeadWithInheritance } from './politicalRightInheritance'
import { addHouselessPerson } from './houseMutations'
import { getPolityLeader } from '../selectors/officeSelectors'
import { pickNameBySex } from '../worldgen/nameGenerators'
import { getPolityNameRefForEmit, getPolityEmitNameKey } from '../selectors/nameRefSelectors'
import { samplePerson } from '../helpers/personFactory'
import { getHouselessPersons } from '../selectors/availabilitySelectors'
import { removeFactionMembership, dissolveFactionsAnchoredToPolity } from './factionMutations'
import { removeRightsByPolity } from './politicalRightMutations'
import { reassignProjectsOfDeadSupervisor } from './projectMutations'
import { cancelTasksOfDeadAssignee } from './taskMutations'
import { adjustPopAttitude, adjustHouseMembersAttitude } from './attitudeMutations'
import { eliminateContractFromChain as eliminateContract } from './landContractMutations'

// ============================================================================
// v0.39 B-2: selectOrCreateCommonwealthLeader
// 在野人物の優先選出 + 新規生成。spec §14.1-14.2。
// ============================================================================

export function selectOrCreateCommonwealthLeader(ctx: TickContext): {
  personId: PersonId
  ctx: TickContext
  created: boolean
} {
  const state = ctx.state
  const houselessIds = getHouselessPersons(state)

  let bestId: PersonId | undefined
  let bestScore = -Infinity

  for (const pid of houselessIds) {
    const p = state.persons[pid]
    if (!p || !p.alive) continue
    if (p.kind === 'placeholder') continue

    const activeOfficeIds = state.officeIndex.byHolderPerson[pid as string] ?? []
    const hasActiveOffice = activeOfficeIds.some((oid) => {
      const o = state.officeAssignments[oid]
      return o && o.active
    })
    if (hasActiveOffice) continue

    const activeHoldingOfficeIds = state.holdingOfficeIndex.byHolderPerson[pid] ?? []
    const hasActiveHoldingOffice = activeHoldingOfficeIds.some((hoid) => {
      const ho = state.holdingOfficeAssignments[hoid]
      return ho && ho.active
    })
    if (hasActiveHoldingOffice) continue

    const score =
      p.abilities.charisma + p.abilities.command + p.abilities.insight + p.traits.ambition * 100
    if (score > bestScore || (score === bestScore && (pid as string) < (bestId as string))) {
      bestScore = score
      bestId = pid
    }
  }

  if (bestId !== undefined) {
    return { personId: bestId, ctx, created: false }
  }

  const { id: newPersonId, ctx: ctx1 } = makePersonId(ctx)
  ctx = ctx1

  const { value: sexRoll, rng: rngSex } = randomInt(ctx.rng, 0, 1)
  ctx = { ...ctx, rng: rngSex }
  const leaderSex: 'male' | 'female' = sexRoll === 0 ? 'male' : 'female'

  let leaderNameKey: string
  if (ctx.namePoolService) {
    const { value: key, rng: rng1 } = ctx.namePoolService.pickNameKey(ctx.rng, {
      nameCultureId: ctx.config.nameCultureId,
      category: 'person',
      path: [leaderSex],
    })
    ctx = { ...ctx, rng: rng1 }
    leaderNameKey = key
  } else {
    const { name, rng: rng1 } = pickNameBySex(leaderSex, ctx.rng)
    ctx = { ...ctx, rng: rng1 }
    leaderNameKey = name
  }

  const { value: age, rng: rng2 } = randomInt(ctx.rng, 25, 55)
  ctx = { ...ctx, rng: rng2 }
  const { value: ambition, rng: rng3 } = randomInt(ctx.rng, 7, 10)
  ctx = { ...ctx, rng: rng3 }
  const { value: caution, rng: rng4 } = randomInt(ctx.rng, 2, 5)
  ctx = { ...ctx, rng: rng4 }
  const { value: legacyPrestige, rng: rng5 } = randomInt(ctx.rng, 5, 15)
  ctx = { ...ctx, rng: rng5 }

  const { value: newLeader, rng: rngAfterLeader } = samplePerson(ctx.rng, ctx.config, {
    id: newPersonId,
    nameKey: leaderNameKey,
    sex: leaderSex,
    age,
    birthStatus: 'unknown',
    traits: { ambition: ambition / 10, caution: caution / 10 },
    legacyPrestige,
  })
  ctx = { ...ctx, rng: rngAfterLeader }

  const addResult = addHouselessPerson(ctx.state, newLeader)
  if (addResult.ok) {
    ctx = { ...ctx, state: addResult.value }
  }

  return { personId: newPersonId, ctx, created: true }
}

// ============================================================================
// v0.39 B-1: createNegotiatingCommonwealth
// 交渉用 commonwealth を生成する。土地の LandContract 移転は行わない。
// revoltState は呼び出し側で DiplomaticPlay 生成後に設定する。
// ============================================================================

export type CreateNegotiatingCommonwealthInput = {
  holdingId: HoldingId
  provinceId: ProvinceId
  popClass: PopClass
  targetPolityId: PolityId
}

export function createNegotiatingCommonwealth(
  ctx: TickContext,
  input: CreateNegotiatingCommonwealthInput,
): CtxResult<{ polityId: PolityId; personId: PersonId }> {
  const { holdingId, provinceId, popClass, targetPolityId } = input
  const state = ctx.state

  const province = state.provinces[provinceId]
  if (!province)
    return err({
      code: 'PROVINCE_NOT_FOUND',
      message: `createNegotiatingCommonwealth: province not found: ${provinceId}`,
    })

  const targetPolity = state.polities[targetPolityId]
  if (!targetPolity)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `createNegotiatingCommonwealth: target polity not found: ${targetPolityId}`,
    })

  const { id: newPolityId, ctx: ctx1 } = makePolityId(ctx)
  ctx = ctx1

  const { personId: leaderPersonId, ctx: ctx2, created } = selectOrCreateCommonwealthLeader(ctx)
  ctx = ctx2

  if (!created) {
    let leaderState = ctx.state
    const membershipIds = leaderState.factionIndex.byMember[leaderPersonId] ?? []
    for (const msId of membershipIds) {
      const ms = leaderState.factionMemberships[msId]
      if (!ms || !ms.active) continue
      const result = removeFactionMembership(leaderState, msId)
      if (result.ok) leaderState = result.value
    }
    ctx = { ...ctx, state: leaderState }
  }

  const newPolityObj: Polity = {
    id: newPolityId,
    // §5.1: 民衆叛乱で新設される rank 5 Polity は対象 Holding 由来名にする。
    // holdingId は input の required field なので常に存在する。pool 名は引かない。
    nameSource: { kind: 'holding', holdingId },
    treasury: 0,
    legacyPrestige: 0,
    adminPower: 0,
    active: true,
    capitalProvinceId: provinceId,
    rank: 5,
    kind: 'commonwealth',
    origin: {
      kind: 'popular_revolt',
      originalPolityId: targetPolityId,
      provinceId,
      holdingIds: [holdingId],
      popClass,
      leaderPersonId,
      startedWeek: state.absoluteWeek,
    },
  }

  let newState: WorldState = {
    ...ctx.state,
    polities: {
      ...ctx.state.polities,
      [newPolityId]: newPolityObj,
    },
  }

  // v0.42c §15.1: person-holder polity share は廃止 (ruler domain で表現)

  newState = createOfficeAssignment(
    newState,
    { kind: 'polity' as const, id: newPolityId },
    'leader',
    leaderPersonId,
  )

  ctx = { ...ctx, state: newState }

  const leaderPerson = newState.persons[leaderPersonId]
  const newPolityRef = getPolityNameRefForEmit(newState, newPolityId)
  const { event: revoltEvent, ctx: ctx3 } = createSimEvent(ctx, {
    type: 'REVOLT_POLITY_FOUNDED',
    importance: 'critical',
    messageKey: 'revolt.polity_founded',
    messageParams: {
      polity: nameParam(newPolityRef.category, newPolityRef.nameKey),
      person: nameParam('person', leaderPerson?.nameKey ?? ''),
      province: nameParam('province', province.nameKey),
    },
    entityRefs: [
      entityRef('person', leaderPersonId, 'leader', leaderPerson?.nameKey),
      entityRef('polity', newPolityId, 'new_polity', newPolityRef.nameKey),
      entityRef(
        'polity',
        targetPolityId,
        'old_polity',
        getPolityEmitNameKey(newState, targetPolityId),
      ),
      entityRef('province', provinceId, 'province', province.nameKey),
    ],
  })
  ctx = { ...ctx3, events: [...ctx3.events, revoltEvent] }

  void created

  return ok({ ctx, value: { polityId: newPolityId, personId: leaderPersonId } })
}

// ============================================================================
// v0.39 B-6: dissolveNegotiatingCommonwealth
// negotiating / revolting commonwealth を解散する。
// disbandRebelPolity と異なり LandContract 移転なし・leader を無条件に殺さない。
// ============================================================================

export type DissolveCommonwealthInput = {
  commonwealthPolityId: PolityId
  leaderOutcome: 'alive' | 'executed' | 'pardoned'
}

export function dissolveNegotiatingCommonwealth(
  ctx: TickContext,
  input: DissolveCommonwealthInput,
): CtxResult<void> {
  const polity = ctx.state.polities[input.commonwealthPolityId]
  if (!polity)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `dissolveNegotiatingCommonwealth: polity ${input.commonwealthPolityId} not found`,
    })

  let state = ctx.state

  const leaderId = getPolityLeader(state, input.commonwealthPolityId)

  // polity 解散なので leader に限らず全 office を失効させる (deactivatePolityInline と同等の cascade)
  state = revokeOfficesByOrganization(state, { kind: 'polity', id: input.commonwealthPolityId })

  if (input.leaderOutcome === 'executed' && leaderId !== undefined) {
    const deadResult = markPersonDeadWithInheritance(state, ctx.config, leaderId, {
      deathCircumstance: 'natural',
    })
    if (deadResult.ok) {
      state = deadResult.value
      const deadPerson = state.persons[leaderId]
      if (deadPerson && deadPerson.wealth > 0) {
        state = {
          ...state,
          persons: {
            ...state.persons,
            [leaderId]: { ...deadPerson, wealth: 0 },
          },
        }
      }
    }
  }

  // §14.6: pardoned leader の prestige ペナルティ
  if (input.leaderOutcome === 'pardoned' && leaderId !== undefined) {
    const leader = state.persons[leaderId]
    if (leader) {
      state = {
        ...state,
        persons: {
          ...state.persons,
          [leaderId]: {
            ...leader,
            legacyPrestige: Math.max(0, leader.legacyPrestige - 10),
          },
        },
      }
    }
  }

  // v0.42 §6.4: polity inactive 化で当該 polity の right を全削除 (R2 を守る。
  //   v0.42 で acquire 対象が「influence を持ちうる polity」に開放されたため
  //   commonwealth を target とする right が成立しうる)
  state = removeRightsByPolity(state, input.commonwealthPolityId)

  const updatedPolity = state.polities[input.commonwealthPolityId]
  if (updatedPolity) {
    state = {
      ...state,
      polities: {
        ...state.polities,
        [input.commonwealthPolityId]: {
          ...updatedPolity,
          active: false,
          revoltState: undefined,
        },
      },
    }
  }

  // v0.42 §12.3: anchor された active Faction を即時解散する (F8 を年末 integrity 前に守る)。
  //   commonwealth は active polity なので Faction の anchor 先になりうる。
  //   この cascade 欠落で「active Faction の anchor polity が inactive」違反が CI で実発生した。
  let nextCtx = dissolveFactionsAnchoredToPolity({ ...ctx, state }, input.commonwealthPolityId)

  // 処刑された leader の assign 済み Task と supervised Project を即時 cascade。
  // 本関数は war 系 system (tick 順で taskSystem / ProjectMaintenanceSystem より後)
  // から呼ばれるため、毎週/4週ごとの通常回収では年末 integrity (「Task assignee is
  // dead」/「active project but supervisor is dead」) より先に回収できないことがある。
  if (input.leaderOutcome === 'executed' && leaderId !== undefined) {
    nextCtx = { ...nextCtx, state: cancelTasksOfDeadAssignee(nextCtx.state, leaderId) }
    nextCtx = reassignProjectsOfDeadSupervisor(nextCtx, leaderId)
  }

  return ok({ ctx: nextCtx, value: undefined })
}

// ============================================================================
// v0.39 C-5: establishCommonwealth — revolt War 勝利時
// ============================================================================

export function establishCommonwealth(
  ctx: TickContext,
  input: {
    commonwealthPolityId: PolityId
    revoltSeizureContractIds: LandContractId[]
    leaderPersonId: PersonId
  },
): CtxResult<void> {
  let state = ctx.state

  // 1. revoltState → established
  const cw = state.polities[input.commonwealthPolityId]
  if (!cw)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `establishCommonwealth: ${input.commonwealthPolityId}`,
    })
  state = {
    ...state,
    polities: {
      ...state.polities,
      [input.commonwealthPolityId]: { ...cw, revoltState: { kind: 'established' } },
    },
  }

  // 2. revolt_seizure 契約の specialStatus を除去（正式契約化）
  for (const contractId of input.revoltSeizureContractIds) {
    const c = state.landContracts[contractId]
    if (c?.specialStatus?.kind === 'revolt_seizure') {
      const updated = { ...c }
      delete updated.specialStatus
      state = { ...state, landContracts: { ...state.landContracts, [contractId]: updated } }
    }
  }

  // 3. Leader prestige boost
  const leader = state.persons[input.leaderPersonId]
  if (leader) {
    state = {
      ...state,
      persons: {
        ...state.persons,
        [input.leaderPersonId]: {
          ...leader,
          legacyPrestige: Math.min(100, leader.legacyPrestige + 15),
        },
      },
    }
  }

  // 4. POP attitude boost toward commonwealth (§14.5)
  if (cw.origin?.kind === 'popular_revolt') {
    for (const hid of cw.origin.holdingIds) {
      const popIds = state.popIndex.byHolding[hid]
      if (!popIds) continue
      for (const popId of popIds) {
        const r = adjustPopAttitude(
          state,
          popId,
          { kind: 'polity', id: input.commonwealthPolityId },
          { affection: 15, respect: 10 },
        )
        if (r.ok) state = r.value
      }
    }
    // 4b. Old owner house attitude penalty (§14.5)
    const origPolity = state.polities[cw.origin.originalPolityId]
    if (origPolity?.ownerHouseId !== undefined) {
      const r = adjustHouseMembersAttitude(
        state,
        origPolity.ownerHouseId,
        { kind: 'polity', id: input.commonwealthPolityId },
        { affection: -20, respect: -10 },
      )
      if (r.ok) state = r.value
    }
  }

  let nextCtx: TickContext = { ...ctx, state }
  const capitalProvince = state.provinces[cw.capitalProvinceId]
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_POLITY_ESTABLISHED',
    importance: 'critical',
    messageKey: 'revolt.triumphant',
    messageParams: {
      province: nameParam('province', capitalProvince?.nameKey ?? cw.capitalProvinceId),
    },
    entityRefs: [
      entityRef(
        'polity',
        input.commonwealthPolityId,
        'commonwealth',
        getPolityEmitNameKey(state, input.commonwealthPolityId),
      ),
      entityRef('person', input.leaderPersonId, 'leader'),
      entityRef('province', cw.capitalProvinceId, 'province', capitalProvince?.nameKey),
    ],
  })
  nextCtx = { ...ctxEv, events: [...ctxEv.events, event] }

  return ok({ ctx: nextCtx, value: undefined })
}

// ============================================================================
// v0.39 C-5: suppressRevolt — revolt War 鎮圧時
// ============================================================================

export function suppressRevolt(
  ctx: TickContext,
  input: {
    commonwealthPolityId: PolityId
    revoltSeizureContractIds: LandContractId[]
    holdingIds: HoldingId[]
  },
): CtxResult<void> {
  let state = ctx.state

  // 1. revolt_seizure 契約を削除
  for (const contractId of input.revoltSeizureContractIds) {
    const c = state.landContracts[contractId]
    if (c) {
      state = eliminateContract(state, contractId)
    }
  }

  // 2. commonwealth 解散（leader outcome: 50% executed / 50% pardoned）
  let nextCtx: TickContext = { ...ctx, state }
  const { value: roll, rng: nextRng } = randomFloat(nextCtx.rng)
  nextCtx = { ...nextCtx, rng: nextRng }
  const leaderOutcome: 'executed' | 'pardoned' = roll < 0.5 ? 'executed' : 'pardoned'
  const dissolveResult = dissolveNegotiatingCommonwealth(nextCtx, {
    commonwealthPolityId: input.commonwealthPolityId,
    leaderOutcome,
  })
  if (dissolveResult.ok) {
    nextCtx = dissolveResult.value.ctx
  }

  // 3. Holding に lastRevoltSuppressedWeek 記録
  let updatedState = nextCtx.state
  for (const holdingId of input.holdingIds) {
    const h = updatedState.holdings[holdingId]
    if (h) {
      updatedState = {
        ...updatedState,
        holdings: {
          ...updatedState.holdings,
          [holdingId]: { ...h, lastRevoltSuppressedWeek: updatedState.absoluteWeek },
        },
      }
    }
  }
  nextCtx = { ...nextCtx, state: updatedState }

  // 4. Event
  const cw = nextCtx.state.polities[input.commonwealthPolityId]
  const capitalProvinceId = cw?.capitalProvinceId
  const capitalProv = capitalProvinceId ? nextCtx.state.provinces[capitalProvinceId] : undefined
  const originalPolityId =
    cw?.origin?.kind === 'popular_revolt' ? cw.origin.originalPolityId : undefined
  const originalPolityRef = originalPolityId
    ? getPolityNameRefForEmit(nextCtx.state, originalPolityId)
    : undefined
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_SUPPRESSED',
    importance: 'major',
    messageKey:
      leaderOutcome === 'executed' ? 'revolt.suppressed_executed' : 'revolt.suppressed_pardoned',
    messageParams: {
      province: nameParam('province', capitalProv?.nameKey ?? capitalProvinceId ?? ''),
      restorePolity: originalPolityRef
        ? nameParam(originalPolityRef.category, originalPolityRef.nameKey)
        : nameParam('polity', ''),
    },
    entityRefs: [
      entityRef('polity', input.commonwealthPolityId, 'commonwealth'),
      ...(originalPolityId
        ? [entityRef('polity', originalPolityId, 'restore_polity', originalPolityRef?.nameKey)]
        : []),
      ...(capitalProvinceId
        ? [entityRef('province', capitalProvinceId, 'province', capitalProv?.nameKey)]
        : []),
    ],
  })
  nextCtx = { ...ctxEv, events: [...ctxEv.events, event] }

  return ok({ ctx: nextCtx, value: undefined })
}
