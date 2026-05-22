import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { ActorIntent } from '../types/actorIntent'
import type { DecisionSubjectRef } from '../types/goal'
import { nameParam, entityRef } from '../types/event'
import { clamp } from '../utils/math'
import type { OrganizationShareId } from '../types/ids'
import { createOrganizationShareId } from '../types/ids'
import {
  isActionIntentKind,
  getIntentTargetProgress,
  getInitialIntentTaskKind,
  getNextIntentTaskKind,
  createTaskForIntent,
} from '../selectors/taskSelectors'
import type { TaskKind } from '../types/task'

export function runIntentActionSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const absoluteWeek = currentCtx.state.absoluteWeek

  for (const [, intent] of Object.entries(currentCtx.state.actorIntents)) {
    if (!intent || intent.status !== 'active') continue
    if (!isActionIntentKind(intent.kind)) continue

    // Task in progress — skip
    if (intent.activeTaskId) {
      const task = currentCtx.state.tasks[intent.activeTaskId]
      if (task && task.status === 'active') continue
    }

    // Initialize progress tracking for newly created intents
    if (intent.progress === undefined) {
      const updatedIntent: ActorIntent = {
        ...intent,
        progress: 0,
        targetProgress: getIntentTargetProgress(intent.kind),
      }
      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          actorIntents: {
            ...currentCtx.state.actorIntents,
            [intent.id]: updatedIntent,
          },
        },
      }
      currentCtx = createIntentTask(currentCtx, updatedIntent, undefined, absoluteWeek)
      continue
    }

    // All tasks completed — apply effect
    if (intent.progress >= (intent.targetProgress ?? 1)) {
      currentCtx = applyIntentEffect(currentCtx, intent)
      continue
    }

    // Previous task completed, create next task
    const prevTaskKind = findPreviousIntentTaskKind(currentCtx, intent)
    currentCtx = createIntentTask(currentCtx, intent, prevTaskKind, absoluteWeek)
  }

  return currentCtx
}

function findPreviousIntentTaskKind(_ctx: TickContext, intent: ActorIntent): TaskKind | undefined {
  // Look up the most recent completed task for this intent from activity logs
  // Simple approach: derive from progress count and intent kind
  if (intent.kind === 'develop_holding' && intent.progress === 1) {
    return 'secure_development_budget'
  }
  return getInitialIntentTaskKind(intent.kind)
}

function createIntentTask(
  ctx: TickContext,
  intent: ActorIntent,
  previousTaskKind: TaskKind | undefined,
  absoluteWeek: number,
): TickContext {
  // Re-read intent from state (may have been updated)
  const currentIntent = ctx.state.actorIntents[intent.id]
  if (!currentIntent || currentIntent.status !== 'active') return ctx

  let taskKind: TaskKind | undefined
  if (previousTaskKind) {
    taskKind = getNextIntentTaskKind(currentIntent.kind, previousTaskKind)
  }
  if (!taskKind) {
    taskKind = getInitialIntentTaskKind(currentIntent.kind)
  }
  if (!taskKind) return markFailed(ctx, currentIntent)

  const result = createTaskForIntent(ctx.state, ctx.config, currentIntent, taskKind, absoluteWeek)
  if (!result) return markFailed(ctx, currentIntent)

  const updatedIntent: ActorIntent = {
    ...currentIntent,
    activeTaskId: result.task.id,
  }

  return {
    ...ctx,
    state: {
      ...result.state,
      actorIntents: {
        ...result.state.actorIntents,
        [currentIntent.id]: updatedIntent,
      },
    },
  }
}

function applyIntentEffect(ctx: TickContext, intent: ActorIntent): TickContext {
  switch (intent.kind) {
    case 'develop_holding':
      return applyDevelopHolding(ctx, intent)
    case 'expand_polity_share':
      return applyExpandPolityShare(ctx, intent)
    case 'promote_policy_shift':
      return applyPromotePolicyShift(ctx, intent)
    case 'patronize_artist':
      return applyPatronizeArtist(ctx, intent)
    case 'commission_chronicle':
      return applyCommissionChronicle(ctx, intent)
    default:
      return markFailed(ctx, intent)
  }
}

function applyDevelopHolding(ctx: TickContext, intent: ActorIntent): TickContext {
  if (intent.actor.kind !== 'polity') return markFailed(ctx, intent)
  const polityId = intent.actor.id
  const polity = ctx.state.polities[polityId]
  if (!polity || !polity.active) return markFailed(ctx, intent)
  if (polity.treasury < ctx.config.developHoldingCost) return markFailed(ctx, intent)

  const holdingId = intent.targetHoldingId
  if (!holdingId) return markFailed(ctx, intent)
  const holding = ctx.state.holdings[holdingId]
  if (!holding) return markFailed(ctx, intent)

  const tp = ctx.state.holdingTerminalPolityCache[holdingId]
  if (!tp || (tp as string) !== (polityId as string)) return markFailed(ctx, intent)

  const newDev = clamp(holding.development + ctx.config.developHoldingGain, -100, 100)
  let currentCtx: TickContext = {
    ...ctx,
    state: {
      ...ctx.state,
      polities: {
        ...ctx.state.polities,
        [polityId]: { ...polity, treasury: polity.treasury - ctx.config.developHoldingCost },
      },
      holdings: {
        ...ctx.state.holdings,
        [holdingId]: { ...holding, development: newDev },
      },
    },
  }

  const provinceId = holding.provinceId
  const polityNameKey = polity.nameKey
  const provinceNameKey = currentCtx.state.provinces[provinceId]?.nameKey ?? provinceId
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'COUNTRY_LAND_DEVELOPED',
    importance: 'minor',
    messageKey: 'polity.land_developed',
    messageParams: {
      polity: nameParam('polity', polityNameKey),
      province: nameParam('province', provinceNameKey),
    },
    entityRefs: [
      entityRef('polity', polityId, 'polity', polityNameKey),
      entityRef('province', provinceId, 'province', provinceNameKey),
    ],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return markSucceeded(currentCtx, intent)
}

function applyExpandPolityShare(ctx: TickContext, intent: ActorIntent): TickContext {
  if (intent.actor.kind !== 'house') return markFailed(ctx, intent)
  const houseId = intent.actor.id
  const house = ctx.state.houses[houseId]
  if (!house || !house.active) return markFailed(ctx, intent)
  if (house.wealth < ctx.config.expandPolityShareCost) return markFailed(ctx, intent)

  if (!intent.targetActor || intent.targetActor.kind !== 'polity') return markFailed(ctx, intent)
  const polityId = intent.targetActor.id
  const polity = ctx.state.polities[polityId]
  if (!polity || !polity.active) return markFailed(ctx, intent)

  const shareIds = ctx.state.shareIndex.byOrganization[polityId] ?? []
  let existingShareId: OrganizationShareId | undefined
  for (const sid of shareIds) {
    const share = ctx.state.organizationShares[sid]
    if (
      share &&
      share.holder.kind === 'house' &&
      (share.holder.id as string) === (houseId as string)
    ) {
      existingShareId = sid
      break
    }
  }

  let currentCtx = ctx

  if (existingShareId) {
    const existingShare = currentCtx.state.organizationShares[existingShareId]
    if (existingShare) {
      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          organizationShares: {
            ...currentCtx.state.organizationShares,
            [existingShareId]: {
              ...existingShare,
              rawPower: existingShare.rawPower + ctx.config.expandPolityShareRawPowerGain,
            },
          },
          houses: {
            ...currentCtx.state.houses,
            [houseId]: { ...house, wealth: house.wealth - ctx.config.expandPolityShareCost },
          },
        },
      }
    }
  } else {
    const newShareId = createOrganizationShareId(currentCtx.state.nextOrganizationShareId)
    const newShare = {
      id: newShareId,
      organization: { kind: 'polity' as const, id: polityId },
      holder: { kind: 'house' as const, id: houseId },
      rawPower: ctx.config.expandPolityShareRawPowerGain,
    }
    const orgShares = [...(currentCtx.state.shareIndex.byOrganization[polityId] ?? []), newShareId]
    const holderShares = [...(currentCtx.state.shareIndex.byHolder[houseId] ?? []), newShareId]
    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        organizationShares: {
          ...currentCtx.state.organizationShares,
          [newShareId]: newShare,
        },
        shareIndex: {
          byOrganization: { ...currentCtx.state.shareIndex.byOrganization, [polityId]: orgShares },
          byHolder: { ...currentCtx.state.shareIndex.byHolder, [houseId]: holderShares },
        },
        houses: {
          ...currentCtx.state.houses,
          [houseId]: { ...house, wealth: house.wealth - ctx.config.expandPolityShareCost },
        },
        nextOrganizationShareId: currentCtx.state.nextOrganizationShareId + 1,
      },
    }
  }

  const houseNameKey = house.nameKey
  const polityNameKey = polity.nameKey
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'HOUSE_POLITY_SHARE_EXPANDED',
    importance: 'minor',
    messageKey: 'house.polity_share_expanded',
    messageParams: {
      house: nameParam('house', houseNameKey),
      polity: nameParam('polity', polityNameKey),
    },
    entityRefs: [
      entityRef('house', houseId, 'house', houseNameKey),
      entityRef('polity', polityId, 'polity', polityNameKey),
    ],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return markSucceeded(currentCtx, intent)
}

function applyPromotePolicyShift(ctx: TickContext, intent: ActorIntent): TickContext {
  if (intent.actor.kind !== 'house') return markFailed(ctx, intent)
  const houseId = intent.actor.id
  const house = ctx.state.houses[houseId]
  if (!house || !house.active) return markFailed(ctx, intent)

  if (!intent.targetActor || intent.targetActor.kind !== 'polity') return markFailed(ctx, intent)
  const polityId = intent.targetActor.id
  const polity = ctx.state.polities[polityId]
  if (!polity || !polity.active) return markFailed(ctx, intent)

  let currentCtx = ctx

  const houseNameKey = house.nameKey
  const polityNameKey = polity.nameKey
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'HOUSE_POLICY_INFLUENCE',
    importance: 'minor',
    messageKey: 'house.policy_influence',
    messageParams: {
      house: nameParam('house', houseNameKey),
      polity: nameParam('polity', polityNameKey),
    },
    entityRefs: [
      entityRef('house', houseId, 'house', houseNameKey),
      entityRef('polity', polityId, 'polity', polityNameKey),
    ],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return markSucceeded(currentCtx, intent)
}

function applyPatronizeArtist(ctx: TickContext, intent: ActorIntent): TickContext {
  if (intent.actor.kind !== 'house') return markFailed(ctx, intent)
  const houseId = intent.actor.id
  const house = ctx.state.houses[houseId]
  if (!house || !house.active) return markFailed(ctx, intent)
  if (house.wealth < ctx.config.patronizeArtistCost) return markFailed(ctx, intent)

  let currentCtx: TickContext = {
    ...ctx,
    state: {
      ...ctx.state,
      houses: {
        ...ctx.state.houses,
        [houseId]: {
          ...house,
          wealth: house.wealth - ctx.config.patronizeArtistCost,
          legacyPrestige: house.legacyPrestige + ctx.config.patronizeArtistPrestigeGain,
        },
      },
    },
  }

  const houseNameKey = house.nameKey
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'HOUSE_PATRONIZED_ARTIST',
    importance: 'minor',
    messageKey: 'house.patronized_artist',
    messageParams: { house: nameParam('house', houseNameKey) },
    entityRefs: [entityRef('house', houseId, 'house', houseNameKey)],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return markSucceeded(currentCtx, intent)
}

function applyCommissionChronicle(ctx: TickContext, intent: ActorIntent): TickContext {
  if (intent.actor.kind !== 'house') return markFailed(ctx, intent)
  const houseId = intent.actor.id
  const house = ctx.state.houses[houseId]
  if (!house || !house.active) return markFailed(ctx, intent)
  if (house.wealth < ctx.config.commissionChronicleCost) return markFailed(ctx, intent)

  let currentCtx: TickContext = {
    ...ctx,
    state: {
      ...ctx.state,
      houses: {
        ...ctx.state.houses,
        [houseId]: {
          ...house,
          wealth: house.wealth - ctx.config.commissionChronicleCost,
          legacyPrestige: house.legacyPrestige + ctx.config.commissionChroniclePrestigeGain,
        },
      },
    },
  }

  const houseNameKey = house.nameKey
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'HOUSE_COMMISSIONED_CHRONICLE',
    importance: 'minor',
    messageKey: 'house.commissioned_chronicle',
    messageParams: { house: nameParam('house', houseNameKey) },
    entityRefs: [entityRef('house', houseId, 'house', houseNameKey)],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return markSucceeded(currentCtx, intent)
}

function markSucceeded(ctx: TickContext, intent: ActorIntent): TickContext {
  let currentCtx: TickContext = {
    ...ctx,
    state: {
      ...ctx.state,
      actorIntents: {
        ...ctx.state.actorIntents,
        [intent.id]: { ...intent, status: 'converted' },
      },
    },
  }

  if (intent.aimId) {
    const aim = currentCtx.state.aims[intent.aimId]
    if (aim) {
      const entries = Object.entries(aim).filter(([k]) => k !== 'activeIntentId')
      const cleaned = Object.fromEntries(entries) as typeof aim
      const newProgress = clamp(aim.progress + 1, 0, aim.targetProgress)
      const aimSucceeded = newProgress >= aim.targetProgress
      const updated = {
        ...cleaned,
        progress: newProgress,
        successfulIntentCount: aim.successfulIntentCount + 1,
        ...(aimSucceeded ? { status: 'succeeded' as const } : {}),
      }

      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          aims: { ...currentCtx.state.aims, [aim.id]: updated },
        },
      }

      if (aimSucceeded) {
        const ownerNameKey = getOwnerNameKey(currentCtx, aim.owner)
        const { event, ctx: evCtx } = createSimEvent(currentCtx, {
          type: 'AIM_SUCCEEDED',
          importance: 'minor',
          messageKey: 'aim.succeeded',
          messageParams: {
            owner: nameParam(aim.owner.kind, ownerNameKey),
            kind: aim.kind,
          },
          entityRefs: [entityRef(aim.owner.kind, aim.owner.id, 'owner', ownerNameKey)],
        })
        currentCtx = { ...evCtx, events: [...evCtx.events, event] }
      }
    }
  }

  return currentCtx
}

function markFailed(ctx: TickContext, intent: ActorIntent): TickContext {
  let currentCtx: TickContext = {
    ...ctx,
    state: {
      ...ctx.state,
      actorIntents: {
        ...ctx.state.actorIntents,
        [intent.id]: { ...intent, status: 'cancelled' },
      },
    },
  }

  if (intent.aimId) {
    const aim = currentCtx.state.aims[intent.aimId]
    if (aim) {
      const entries = Object.entries(aim).filter(([k]) => k !== 'activeIntentId')
      const cleaned = Object.fromEntries(entries) as typeof aim
      const updated = {
        ...cleaned,
        failedIntentCount: aim.failedIntentCount + 1,
      }

      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          aims: { ...currentCtx.state.aims, [aim.id]: updated },
        },
      }
    }
  }

  return currentCtx
}

function getOwnerNameKey(ctx: TickContext, owner: DecisionSubjectRef): string {
  if (owner.kind === 'polity') {
    return ctx.state.polities[owner.id]?.nameKey ?? owner.id
  }
  if (owner.kind === 'house') {
    return ctx.state.houses[owner.id]?.nameKey ?? owner.id
  }
  return owner.id
}
