// v0.30 Phase A: Demand application functions for diplomatic offers.
// Not wired into the main loop yet — will be connected in Phase B.

import type { TickContext } from '../tick/context'
import type { DiplomaticPlay, DiplomaticOffer, DiplomaticDemand } from '../types/diplomaticPlay'
import type { PolityId } from '../types/ids'
import { applyLandContractTransferGoal, adjustLandContractTaxRate } from './landContractMutations'

// ─── Demand application ───

export function applyDemand(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: DiplomaticDemand,
): TickContext {
  switch (demand.kind) {
    case 'pay_wealth':
      return applyPayWealth(ctx, demand)

    case 'transfer_land_contract':
      return applyTransferLandContract(ctx, play, demand)

    case 'change_contract_tax_rate':
      return applyChangeContractTaxRate(ctx, demand)

    case 'status_quo':
      return ctx

    case 'revolt_concession':
      return ctx
  }
}

function applyPayWealth(
  ctx: TickContext,
  demand: Extract<DiplomaticDemand, { kind: 'pay_wealth' }>,
): TickContext {
  const state = ctx.state
  const amount = demand.amount
  if (amount <= 0) return ctx

  // Deduct from source
  let nextState = state
  if (demand.from.kind === 'polity') {
    const polity = nextState.polities[demand.from.id]
    if (!polity?.active) return ctx
    nextState = {
      ...nextState,
      polities: {
        ...nextState.polities,
        [demand.from.id]: {
          ...polity,
          treasury: Math.max(0, polity.treasury - amount),
        },
      },
    }
  } else {
    const house = nextState.houses[demand.from.id]
    if (!house) return ctx
    nextState = {
      ...nextState,
      houses: {
        ...nextState.houses,
        [demand.from.id]: {
          ...house,
          wealth: Math.max(0, house.wealth - amount),
        },
      },
    }
  }

  // Add to recipient
  if (demand.to.kind === 'polity') {
    const polity = nextState.polities[demand.to.id]
    if (!polity?.active) return { ...ctx, state: nextState }
    nextState = {
      ...nextState,
      polities: {
        ...nextState.polities,
        [demand.to.id]: {
          ...polity,
          treasury: polity.treasury + amount,
        },
      },
    }
  } else {
    const house = nextState.houses[demand.to.id]
    if (!house) return { ...ctx, state: nextState }
    nextState = {
      ...nextState,
      houses: {
        ...nextState.houses,
        [demand.to.id]: {
          ...house,
          wealth: house.wealth + amount,
        },
      },
    }
  }

  return { ...ctx, state: nextState }
}

function applyTransferLandContract(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'transfer_land_contract' }>,
): TickContext {
  // Derive fromPolityId: the target (defender) of the play is the current holder
  const fromPolityId = play.target.id as PolityId

  const result = applyLandContractTransferGoal(ctx, {
    holdingId: demand.holdingId,
    fromPolityId,
    toPolityId: demand.toPolityId,
    reason: 'cession',
  })

  if (!result.ok) return ctx
  return result.value.ctx
}

function applyChangeContractTaxRate(
  ctx: TickContext,
  demand: Extract<DiplomaticDemand, { kind: 'change_contract_tax_rate' }>,
): TickContext {
  const newState = adjustLandContractTaxRate(
    ctx.state,
    demand.landContractId,
    demand.newTaxRateToGrantor,
  )
  return { ...ctx, state: newState }
}

// ─── Settled offer application ───

export function applySettledOffer(
  ctx: TickContext,
  play: DiplomaticPlay,
  offer: DiplomaticOffer,
): TickContext {
  let currentCtx = ctx
  for (const demand of offer.demands) {
    currentCtx = applyDemand(currentCtx, play, demand)
  }
  return currentCtx
}
