import type { TickContext } from '../tick/context'
import type { WorldState } from '../types/world'
import type { DiplomaticPlay, DiplomaticOffer, DiplomaticDemand } from '../types/diplomaticPlay'
import type { DiplomaticOfferId, DiplomaticPlayId, PolityId } from '../types/ids'
import type { PoliticalActorRef } from '../types/actor'
import { createDiplomaticOfferId } from '../types/ids'
import { applyLandContractTransferGoal, adjustLandContractTaxRate } from './landContractMutations'

// ─── Offer lifecycle mutations (mutable — operate on WorldState directly) ───

export function createDiplomaticOfferMut(
  ws: WorldState,
  playId: DiplomaticPlayId,
  proposedBy: PoliticalActorRef,
  demands: DiplomaticDemand[],
  reasonIds: import('../types/ids').DecisionReasonId[],
): DiplomaticOfferId {
  const play = ws.diplomaticPlays[playId]
  if (play && play.currentOfferId) {
    withdrawCurrentOfferMut(ws, play)
  }

  const offerId = createDiplomaticOfferId(ws.nextDiplomaticOfferId)
  ws.nextDiplomaticOfferId++

  const offer: DiplomaticOffer = {
    id: offerId,
    playId,
    proposedBy,
    demands,
    status: 'pending',
    createdWeek: ws.absoluteWeek,
    reasonIds,
  }
  ws.diplomaticOffers[offerId] = offer

  if (play) {
    ws.diplomaticPlays[playId] = {
      ...play,
      currentOfferId: offerId,
      offerHistoryIds: [...play.offerHistoryIds, offerId],
    }
  }

  return offerId
}

export function withdrawCurrentOfferMut(ws: WorldState, play: DiplomaticPlay): void {
  if (!play.currentOfferId) return
  const offer = ws.diplomaticOffers[play.currentOfferId]
  if (offer && offer.status === 'pending') {
    ws.diplomaticOffers[play.currentOfferId] = { ...offer, status: 'withdrawn' }
  }
}

export function rejectOfferMut(ws: WorldState, offerId: DiplomaticOfferId): void {
  const offer = ws.diplomaticOffers[offerId]
  if (!offer) return
  ws.diplomaticOffers[offerId] = { ...offer, status: 'rejected' }
}

export function acceptOfferMut(ws: WorldState, offerId: DiplomaticOfferId): void {
  const offer = ws.diplomaticOffers[offerId]
  if (!offer) return
  ws.diplomaticOffers[offerId] = { ...offer, status: 'accepted' }
}

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
  let newState = adjustLandContractTaxRate(
    ctx.state,
    demand.landContractId,
    demand.newTaxRateToGrantor,
  )
  const updatedContract = newState.landContracts[demand.landContractId]
  if (updatedContract) {
    newState = {
      ...newState,
      landContracts: {
        ...newState.landContracts,
        [demand.landContractId]: {
          ...updatedContract,
          terms: {
            ...updatedContract.terms,
            termsProtectedUntilWeek:
              ctx.state.absoluteWeek + ctx.config.taxRevisionGracePeriodYears * 52,
          },
        },
      },
    }
  }
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
