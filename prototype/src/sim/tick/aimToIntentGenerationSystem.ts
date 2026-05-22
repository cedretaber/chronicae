import type { TickContext } from './context'
import type { ActorIntentId } from '../types/ids'
import { createActorIntentId } from '../types/ids'
import type { ActorIntent } from '../types/actorIntent'
import type { Aim } from '../types/goal'
import type { PolityId, HoldingId, ProvinceId } from '../types/ids'
import { getProvinceHoldings } from '../selectors/landContractSelectors'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'

export function runAimToIntentGenerationSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const absoluteWeek = currentCtx.state.absoluteWeek

  for (const [, aim] of Object.entries(currentCtx.state.aims)) {
    if (!aim || aim.status !== 'active') continue
    if (aim.origin !== 'goal_driven') continue

    // Skip if there's already an active intent or play
    if (aim.activeIntentId) continue
    if (aim.activeDiplomaticPlayId) continue

    // Cooldown check
    if (aim.nextIntentAllowedWeek && absoluteWeek < aim.nextIntentAllowedWeek) continue

    currentCtx = generateIntentForAim(currentCtx, aim, absoluteWeek)
  }

  return currentCtx
}

function generateIntentForAim(ctx: TickContext, aim: Aim, absoluteWeek: number): TickContext {
  const result = buildIntentForAim(ctx, aim, absoluteWeek)
  if (!result) return ctx

  const { intent, intentId } = result
  let currentCtx = ctx

  // Add intent to state
  currentCtx = {
    ...currentCtx,
    state: {
      ...currentCtx.state,
      actorIntents: {
        ...currentCtx.state.actorIntents,
        [intentId]: intent,
      },
      nextActorIntentId: currentCtx.state.nextActorIntentId + 1,
    },
  }

  // Update aim: set activeIntentId and cooldown
  const updatedAim: Aim = {
    ...aim,
    activeIntentId: intentId,
    lastIntentGeneratedWeek: absoluteWeek,
    nextIntentAllowedWeek: absoluteWeek + currentCtx.config.aimIntentCooldownWeeks,
  }
  currentCtx = {
    ...currentCtx,
    state: {
      ...currentCtx.state,
      aims: { ...currentCtx.state.aims, [aim.id]: updatedAim },
    },
  }

  return currentCtx
}

function buildIntentForAim(
  ctx: TickContext,
  aim: Aim,
  absoluteWeek: number,
): { intent: ActorIntent; intentId: ActorIntentId } | undefined {
  const intentId: ActorIntentId = createActorIntentId(ctx.state.nextActorIntentId)

  const base = {
    id: intentId,
    priority: aim.priority,
    rationale: 'goal_driven' as const,
    status: 'active' as const,
    createdWeek: absoluteWeek,
    expiresWeek: absoluteWeek + WEEKS_PER_YEAR,
    ...(aim.goalId ? { goalId: aim.goalId } : {}),
    aimId: aim.id,
  }

  switch (aim.kind) {
    case 'consolidate_province_holdings':
    case 'seize_weak_remote_holdings': {
      if (aim.owner.kind !== 'polity') return undefined
      const target = findAcquireTarget(ctx, aim)
      if (!target) return undefined
      const intent: ActorIntent = {
        ...base,
        actor: { kind: 'polity', id: aim.owner.id },
        kind: 'acquire_land',
        targetActor: { kind: 'polity', id: target.targetPolityId },
        targetProvinceId: target.provinceId,
        targetHoldingId: target.holdingId,
      }
      return { intent, intentId }
    }

    case 'improve_owned_contract_terms': {
      if (aim.owner.kind !== 'polity') return undefined
      const target = findImproveTarget(ctx, aim)
      if (!target) return undefined
      const intent: ActorIntent = {
        ...base,
        actor: { kind: 'polity', id: aim.owner.id },
        kind: 'improve_contract_terms',
        targetActor: { kind: 'polity', id: target.targetPolityId },
        targetProvinceId: target.provinceId,
      }
      return { intent, intentId }
    }

    case 'develop_owned_holding': {
      if (aim.owner.kind !== 'polity') return undefined
      if (!aim.target || aim.target.kind !== 'holding') return undefined
      const holding = ctx.state.holdings[aim.target.id]
      if (!holding) return undefined
      const intent: ActorIntent = {
        ...base,
        actor: { kind: 'polity', id: aim.owner.id },
        kind: 'develop_holding',
        targetHoldingId: aim.target.id,
        targetProvinceId: holding.provinceId,
      }
      return { intent, intentId }
    }

    case 'increase_polity_share': {
      if (aim.owner.kind !== 'house') return undefined
      if (!aim.target || aim.target.kind !== 'polity') return undefined
      const intent: ActorIntent = {
        ...base,
        actor: { kind: 'house', id: aim.owner.id },
        kind: 'expand_polity_share',
        targetActor: { kind: 'polity', id: aim.target.id },
      }
      return { intent, intentId }
    }

    case 'steer_polity_external_expansion':
    case 'steer_polity_internal_development': {
      if (aim.owner.kind !== 'house') return undefined
      if (!aim.target || aim.target.kind !== 'polity') return undefined
      const intent: ActorIntent = {
        ...base,
        actor: { kind: 'house', id: aim.owner.id },
        kind: 'promote_policy_shift',
        targetActor: { kind: 'polity', id: aim.target.id },
      }
      return { intent, intentId }
    }

    case 'patronize_artist': {
      if (aim.owner.kind !== 'house') return undefined
      const intent: ActorIntent = {
        ...base,
        actor: { kind: 'house', id: aim.owner.id },
        kind: 'patronize_artist',
      }
      return { intent, intentId }
    }

    case 'commission_chronicle': {
      if (aim.owner.kind !== 'house') return undefined
      const intent: ActorIntent = {
        ...base,
        actor: { kind: 'house', id: aim.owner.id },
        kind: 'commission_chronicle',
      }
      return { intent, intentId }
    }

    default:
      return undefined
  }
}

function findAcquireTarget(
  ctx: TickContext,
  aim: Aim,
): { targetPolityId: PolityId; provinceId: ProvinceId; holdingId: HoldingId } | undefined {
  if (aim.owner.kind !== 'polity') return undefined
  const polityId = aim.owner.id

  // If aim has a target province, look there first
  if (aim.target && aim.target.kind === 'province') {
    const holdings = getProvinceHoldings(ctx.state, aim.target.id)
    for (const h of holdings) {
      const tp = ctx.state.holdingTerminalPolityCache[h.id]
      if (tp && (tp as string) !== (polityId as string)) {
        const targetPolity = ctx.state.polities[tp]
        if (targetPolity && targetPolity.active) {
          return { targetPolityId: tp, provinceId: aim.target.id, holdingId: h.id }
        }
      }
    }
  }

  return undefined
}

function findImproveTarget(
  ctx: TickContext,
  aim: Aim,
): { targetPolityId: PolityId; provinceId: ProvinceId } | undefined {
  if (aim.owner.kind !== 'polity') return undefined
  const polityId = aim.owner.id

  // Find contracts where this polity is grantee with high tax rate
  const contractIds = ctx.state.landContractIndex.byGranteePolity[polityId] ?? []
  for (const cid of contractIds) {
    const contract = ctx.state.landContracts[cid]
    if (!contract) continue
    if (contract.terms.taxRateToGrantor <= 0.15) continue
    // Find the grantor (parent contract's grantee or ROOT_WORLD)
    if (contract.rootAuthorityId && (contract.rootAuthorityId as string) !== 'ROOT_WORLD') {
      const grantorPolity = ctx.state.polities[contract.rootAuthorityId as unknown as PolityId]
      if (grantorPolity && grantorPolity.active) {
        return {
          targetPolityId: contract.rootAuthorityId as unknown as PolityId,
          provinceId: contract.provinceId,
        }
      }
    }
  }

  return undefined
}
