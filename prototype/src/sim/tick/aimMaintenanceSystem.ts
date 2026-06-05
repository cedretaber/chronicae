import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { AimId, DecisionReasonId } from '../types/ids'
import { createAimId, createDecisionReasonId } from '../types/ids'
import type { Aim, DecisionReason, Goal, EntityRef } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { PoliticalRightTargetRef } from '../types/politicalRight'
import { politicalRightTargetKey } from '../types/politicalRight'
import { getRightForTarget } from '../selectors/politicalRightSelectors'
import { getEffectiveOfficeMaxHolders } from '../selectors/officeSelectors'
import {
  getActiveAimsForGoal,
  pickAimForGoal,
  aimSlotKey,
  computeAimCapacityForGoal,
} from '../selectors/goalSelectors'
import { nameParam, entityRef } from '../types/event'
import { getOwnerNameKey, getOwnerNameRefForEmit } from '../utils/ownerNames'
import { getPolityEmitNameKey } from '../selectors/nameRefSelectors'

export function runAimMaintenanceSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const absoluteWeek = currentCtx.state.absoluteWeek

  // Deadline, target validity, and parent-goal checks run every 4w
  for (const [, aim] of Object.entries(currentCtx.state.aims)) {
    if (!aim || aim.status !== 'active') continue

    // Deadline check
    if (absoluteWeek >= aim.deadlineWeek) {
      currentCtx = failAim(currentCtx, aim, 'deadline_reached')
      continue
    }

    // Target validity check
    if (aim.target && !isTargetValid(currentCtx, aim)) {
      currentCtx = failAim(currentCtx, aim, 'target_invalid')
      continue
    }

    // Parent goal terminal check
    if (aim.goalId) {
      const parentGoal = currentCtx.state.goals[aim.goalId]
      if (parentGoal && parentGoal.status !== 'active') {
        const updatedAim: Aim = { ...aim, status: 'abandoned' }
        currentCtx = {
          ...currentCtx,
          state: {
            ...currentCtx.state,
            aims: { ...currentCtx.state.aims, [aim.id]: updatedAim },
          },
        }
        const ownerNameKey = getOwnerNameKey(currentCtx.state, aim.owner)
        const { event, ctx: evCtx } = createSimEvent(currentCtx, {
          type: 'AIM_ABANDONED',
          importance: 'minor',
          messageKey: 'aim.abandoned',
          messageParams: {
            owner: nameParam(
              getOwnerNameRefForEmit(currentCtx.state, aim.owner).category,
              ownerNameKey,
            ),
            kind: aim.kind,
          },
          entityRefs: [entityRef(aim.owner.kind, aim.owner.id, 'owner', ownerNameKey)],
        })
        currentCtx = { ...evCtx, events: [...evCtx.events, event] }
      }
    }
  }

  // Aim creation runs only at annual boundaries.
  // v0.43: 1 Goal の下に複数 active Aim を許す。cap (= maxActiveAimsPerGoal, Stage2 で規模連動)
  // に達するまで、既存スロットと重複しない Aim を繰り返し生成する。候補が枯渇したら打ち切る。
  if (absoluteWeek % ctx.config.goalReviewIntervalWeeks === 0) {
    for (const [, goal] of Object.entries(currentCtx.state.goals)) {
      if (!goal || goal.status !== 'active') continue
      // 並列上限は owner の規模/予算に連動 (v0.43 Stage2)
      const cap = computeAimCapacityForGoal(currentCtx.state, currentCtx.config, goal.owner)
      const activeAims = getActiveAimsForGoal(currentCtx.state, goal.id)
      const excluded = new Set(activeAims.map((a) => aimSlotKey(a.kind, a.target)))
      let count = activeAims.length
      while (count < cap) {
        const { ctx: nextCtx, slotKey } = createAimForGoal(currentCtx, goal, absoluteWeek, excluded)
        currentCtx = nextCtx
        if (slotKey === undefined) break // 候補枯渇
        excluded.add(slotKey)
        count++
      }
    }
  }

  return currentCtx
}

function createAimForGoal(
  ctx: TickContext,
  goal: Goal,
  absoluteWeek: number,
  excludedSlots: Set<string>,
): { ctx: TickContext; slotKey?: string } {
  const result = pickAimForGoal(ctx.state, ctx.config, goal, ctx.rng, excludedSlots)
  if (!result) return { ctx }

  const { kind, target, rng: nextRng } = result
  let currentCtx = { ...ctx, rng: nextRng }

  const reasonId: DecisionReasonId = createDecisionReasonId(currentCtx.state.nextDecisionReasonId)
  const reason: DecisionReason = {
    id: reasonId,
    owner: goal.owner,
    summaryKey: `decision.reason.aim.${kind}`,
    weight: 1,
    createdWeek: absoluteWeek,
  }

  const aimId: AimId = createAimId(currentCtx.state.nextAimId)

  // Build aim object, conditionally including target only if present
  const aimBase: Omit<Aim, 'id' | 'target'> = {
    owner: goal.owner,
    goalId: goal.id,
    origin: 'goal_driven',
    kind,
    priority: 1,
    progress: 0,
    targetProgress: currentCtx.config.projectDefaultTargetProgress,
    createdWeek: absoluteWeek,
    deadlineWeek: absoluteWeek + currentCtx.config.aimDefaultDeadlineWeeks,
    successfulProjectCount: 0,
    failedProjectCount: 0,
    status: 'active',
    reasonIds: [reasonId],
  }

  const aim: Aim = {
    ...aimBase,
    id: aimId,
    ...(target !== undefined ? { target } : {}),
  }

  const ownerKey = decisionSubjectKey(goal.owner)
  const existingOwnerAims = currentCtx.state.aimIndex.byOwner[ownerKey] ?? []
  const existingGoalAims = currentCtx.state.aimIndex.byGoal[goal.id as string] ?? []

  currentCtx = {
    ...currentCtx,
    state: {
      ...currentCtx.state,
      aims: { ...currentCtx.state.aims, [aimId]: aim },
      decisionReasons: { ...currentCtx.state.decisionReasons, [reasonId]: reason },
      aimIndex: {
        byOwner: {
          ...currentCtx.state.aimIndex.byOwner,
          [ownerKey]: [...existingOwnerAims, aimId],
        },
        byGoal: {
          ...currentCtx.state.aimIndex.byGoal,
          [goal.id as string]: [...existingGoalAims, aimId],
        },
      },
      nextAimId: currentCtx.state.nextAimId + 1,
      nextDecisionReasonId: currentCtx.state.nextDecisionReasonId + 1,
    },
  }

  const ownerNameKey = getOwnerNameKey(currentCtx.state, goal.owner)
  const targetName = target ? getTargetName(currentCtx, target) : 'none'
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'AIM_CREATED',
    importance: 'minor',
    messageKey: 'aim.created',
    messageParams: {
      owner: nameParam(getOwnerNameRefForEmit(currentCtx.state, goal.owner).category, ownerNameKey),
      kind,
      target: targetName,
    },
    entityRefs: [entityRef(goal.owner.kind, goal.owner.id, 'owner', ownerNameKey)],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return { ctx: currentCtx, slotKey: aimSlotKey(kind, target) }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function failAim(ctx: TickContext, aim: Aim, _reason: string): TickContext {
  const updatedAim: Aim = { ...aim, status: 'failed' }
  let currentCtx = {
    ...ctx,
    state: {
      ...ctx.state,
      aims: { ...ctx.state.aims, [aim.id]: updatedAim },
    },
  }

  const ownerNameKey = getOwnerNameKey(currentCtx.state, aim.owner)
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'AIM_FAILED',
    importance: 'minor',
    messageKey: 'aim.failed',
    messageParams: {
      owner: nameParam(getOwnerNameRefForEmit(currentCtx.state, aim.owner).category, ownerNameKey),
      kind: aim.kind,
    },
    entityRefs: [entityRef(aim.owner.kind, aim.owner.id, 'owner', ownerNameKey)],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return currentCtx
}

function isTargetValid(ctx: TickContext, aim: Aim): boolean {
  const t = aim.target
  if (!t) return true
  switch (t.kind) {
    case 'polity': {
      const polity = ctx.state.polities[t.id]
      return polity !== undefined && polity.active
    }
    case 'house': {
      const house = ctx.state.houses[t.id]
      return house !== undefined && house.active
    }
    case 'province':
      return ctx.state.provinces[t.id] !== undefined
    case 'holding':
      return ctx.state.holdings[t.id] !== undefined
    case 'land_contract':
      return ctx.state.landContracts[t.id] !== undefined
    case 'political_right_target':
      return isPoliticalRightTargetValid(ctx, aim, t.target)
    default:
      return true
  }
}

// v0.42 acquire 開放: political_right_target aim の枝刈り (RightConsistencySystem §6.65 の
// 失効条件と平行)。非 owner 開放で複数家が同一 target を狙うレースが起きるため、
// レース負け (他家が先に right を取得) と target の取得不能化を 4 週 boundary で検出して
// aim を fail させる。自家保有 right の target は valid のまま (project 成功後も progress 100
// まで aim を回す既存 lifecycle に触れない)。
function isPoliticalRightTargetValid(
  ctx: TickContext,
  aim: Aim,
  target: PoliticalRightTargetRef,
): boolean {
  const state = ctx.state
  // レース負け: 既に right が存在し、holder が aim owner 自身でない (1 target 1 right — R6)
  const existing = getRightForTarget(state, target)
  if (existing) {
    const ownedBySelf =
      existing.holder.kind === aim.owner.kind &&
      (existing.holder.id as string) === (aim.owner.id as string)
    if (!ownedBySelf) return false
  }
  switch (target.kind) {
    case 'polity_office_role': {
      const polity = state.polities[target.polityId]
      if (!polity || !polity.active) return false
      // effectiveMax 縮小で取得不能になった slot の aim は枝刈りする
      // (取得しても §6.65 が同週に target_lost で失効させるだけ)
      return (
        target.slotIndex <
        getEffectiveOfficeMaxHolders(
          state,
          ctx.config,
          { kind: 'polity', id: target.polityId },
          target.role,
        )
      )
    }
    case 'holding_office_role': {
      if (!state.holdings[target.holdingId]) return false
      const terminalPolityId = state.holdingTerminalPolityCache[target.holdingId]
      if (terminalPolityId === undefined) return false
      const polity = state.polities[terminalPolityId]
      return polity !== undefined && polity.active
    }
    case 'regiment': {
      // destroyed は valid (right は制度的単位として destroyed を生き残る — §6.64)。
      // disbanded / 消滅のみ invalid
      const regiment = state.regiments[target.regimentId]
      if (!regiment || regiment.status === 'disbanded') return false
      if (regiment.owner.kind !== 'polity') return false
      const ownerPolity = state.polities[regiment.owner.id]
      return ownerPolity !== undefined && ownerPolity.active
    }
  }
}

function getTargetName(ctx: TickContext, target: EntityRef): string {
  if (target.kind === 'polity') {
    return getPolityEmitNameKey(ctx.state, target.id)
  }
  if (target.kind === 'house') {
    return ctx.state.houses[target.id]?.nameKey ?? target.id
  }
  if (target.kind === 'province') {
    return ctx.state.provinces[target.id]?.nameKey ?? target.id
  }
  if (target.kind === 'state') {
    return ctx.state.states[target.id]?.nameKey ?? target.id
  }
  if (target.kind === 'holding') {
    return target.id
  }
  if (target.kind === 'land_contract') {
    return target.id
  }
  if (target.kind === 'aim') {
    return target.id
  }
  if (target.kind === 'office') {
    const org =
      target.organization.kind === 'polity'
        ? getPolityEmitNameKey(ctx.state, target.organization.id)
        : ctx.state.houses[target.organization.id]?.nameKey
    return org ? `${org}:${target.role}` : target.role
  }
  if (target.kind === 'ability') {
    return target.ability
  }
  if (target.kind === 'political_right_target') {
    return politicalRightTargetKey(target.target)
  }
  return target.id
}
