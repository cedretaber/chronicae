import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { ActorIntent } from '../types/actorIntent'
import type { DecisionSubjectRef } from '../types/goal'
import { nameParam, entityRef } from '../types/event'
import { clamp } from '../utils/math'
import type { OrganizationShareId } from '../types/ids'
import { createOrganizationShareId } from '../types/ids'

export function runIntentActionSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const [, intent] of Object.entries(currentCtx.state.actorIntents)) {
    if (!intent || intent.status !== 'active') continue

    switch (intent.kind) {
      case 'develop_holding':
        currentCtx = processDevelopHolding(currentCtx, intent)
        break
      case 'expand_polity_share':
        currentCtx = processExpandPolityShare(currentCtx, intent)
        break
      case 'promote_policy_shift':
        currentCtx = processPromotePolicyShift(currentCtx, intent)
        break
      case 'patronize_artist':
        currentCtx = processPatronizeArtist(currentCtx, intent)
        break
      case 'commission_chronicle':
        currentCtx = processCommissionChronicle(currentCtx, intent)
        break
      default:
        continue
    }
  }

  return currentCtx
}

function processDevelopHolding(ctx: TickContext, intent: ActorIntent): TickContext {
  if (intent.actor.kind !== 'polity') return markFailed(ctx, intent)
  const polityId = intent.actor.id
  const polity = ctx.state.polities[polityId]
  if (!polity || !polity.active) return markFailed(ctx, intent)
  if (polity.treasury < ctx.config.developHoldingCost) return markFailed(ctx, intent)

  const holdingId = intent.targetHoldingId
  if (!holdingId) return markFailed(ctx, intent)
  const holding = ctx.state.holdings[holdingId]
  if (!holding) return markFailed(ctx, intent)

  // Check terminal polity matches
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

  // Emit event
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

function processExpandPolityShare(ctx: TickContext, intent: ActorIntent): TickContext {
  if (intent.actor.kind !== 'house') return markFailed(ctx, intent)
  const houseId = intent.actor.id
  const house = ctx.state.houses[houseId]
  if (!house || !house.active) return markFailed(ctx, intent)
  if (house.wealth < ctx.config.expandPolityShareCost) return markFailed(ctx, intent)

  if (!intent.targetActor || intent.targetActor.kind !== 'polity') return markFailed(ctx, intent)
  const polityId = intent.targetActor.id
  const polity = ctx.state.polities[polityId]
  if (!polity || !polity.active) return markFailed(ctx, intent)

  // Find existing share or create new one
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
    // Create new share
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

  // Emit event
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

function processPromotePolicyShift(ctx: TickContext, intent: ActorIntent): TickContext {
  if (intent.actor.kind !== 'house') return markFailed(ctx, intent)
  const houseId = intent.actor.id
  const house = ctx.state.houses[houseId]
  if (!house || !house.active) return markFailed(ctx, intent)

  if (!intent.targetActor || intent.targetActor.kind !== 'polity') return markFailed(ctx, intent)
  const polityId = intent.targetActor.id
  const polity = ctx.state.polities[polityId]
  if (!polity || !polity.active) return markFailed(ctx, intent)

  let currentCtx = ctx

  // No cost for promote_policy_shift

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

function processPatronizeArtist(ctx: TickContext, intent: ActorIntent): TickContext {
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

function processCommissionChronicle(ctx: TickContext, intent: ActorIntent): TickContext {
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

// Mark intent as converted and update Aim progress
function markSucceeded(ctx: TickContext, intent: ActorIntent): TickContext {
  // Set intent to converted
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

  // Update Aim progress
  if (intent.aimId) {
    const aim = currentCtx.state.aims[intent.aimId]
    if (aim) {
      // Build new aim without activeIntentId, with updated progress
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
      // Build new aim without activeIntentId, with updated failed count
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
