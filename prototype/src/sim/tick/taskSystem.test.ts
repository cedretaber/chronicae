import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { buildAndCreateCompromiseOffer } from './taskCompromise'
import { computeLandClaimCompensation } from './diplomaticOfferEvaluation'
import type { DiplomaticPlay, DiplomaticOffer, DiplomaticDemand } from '../types/diplomaticPlay'
import type {
  DiplomaticPlayId,
  DiplomaticOfferId,
  PolityId,
  ProvinceId,
  HoldingId,
  LandContractId,
  HouseId,
} from '../types/ids'

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function makePlay(
  kind: DiplomaticPlay['kind'],
  overrides?: Partial<DiplomaticPlay>,
): DiplomaticPlay {
  return {
    id: 'dp-1' as DiplomaticPlayId,
    kind,
    initiator: { kind: 'polity', id: 'c-init' as PolityId },
    target: { kind: 'polity', id: 'c-target' as PolityId },
    status: 'active',
    startedWeek: 48000,
    deadlineWeek: 48048,
    progress: 0,
    tension: 0,
    initiatorPreparation: 0,
    initiatorLeverage: 0,
    initiatorCommitment: 0,
    targetPreparation: 0,
    targetLeverage: 0,
    targetCommitment: 0,
    initiatorSupporters: [],
    targetSupporters: [],
    initiatorActiveTaskIds: [],
    targetActiveTaskIds: [],
    offerHistoryIds: [],
    ...overrides,
  }
}

function makeOffer(
  demands: DiplomaticDemand[],
  overrides?: Partial<DiplomaticOffer>,
): DiplomaticOffer {
  return {
    id: 'do-1' as DiplomaticOfferId,
    playId: 'dp-1' as DiplomaticPlayId,
    proposedBy: { kind: 'polity', id: 'c-init' as PolityId },
    demands,
    status: 'pending',
    createdWeek: 48000,
    reasonIds: [],
    ...overrides,
  }
}

// Standard IDs used across tests
const INIT = 'c-init' as PolityId
const TARGET = 'c-target' as PolityId
const PLAY_ID = 'dp-1' as DiplomaticPlayId
const HOLDING_ID = 'hl-0' as HoldingId
const PROVINCE_ID = 'pr-1' as ProvinceId
const LC_ID = 'lc-1' as LandContractId

// Shared demands for tests that need a base offer
const transferDemand: DiplomaticDemand = {
  kind: 'transfer_land_contract',
  holdingId: HOLDING_ID,
  toPolityId: INIT,
}
const payDemand: DiplomaticDemand = {
  kind: 'pay_wealth',
  from: { kind: 'polity', id: INIT },
  to: { kind: 'polity', id: TARGET },
  amount: 100,
}

// ---------------------------------------------------------------------------
// Guard clauses
// ---------------------------------------------------------------------------

describe('buildAndCreateCompromiseOffer', () => {
  describe('guard clauses', () => {
    it('returns early for revolt_negotiation plays', () => {
      const ws = makeEmptyV016State()
      const play = makePlay('revolt_negotiation')
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      expect(ws.nextDiplomaticOfferId).toBe(0)
    })

    it('returns early when initiator is not a polity', () => {
      const ws = makeEmptyV016State()
      const play = makePlay('land_claim', {
        initiator: { kind: 'house', id: 'h-1' as HouseId },
      })
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      expect(ws.nextDiplomaticOfferId).toBe(0)
    })

    it('returns early when target is not a polity', () => {
      const ws = makeEmptyV016State()
      const play = makePlay('land_claim', {
        target: { kind: 'house', id: 'h-1' as HouseId },
      })
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      expect(ws.nextDiplomaticOfferId).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Land claim — no base offer
  // -----------------------------------------------------------------------

  describe('land_claim no base offer', () => {
    it('creates transfer + pay_wealth', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const holdingId = Object.keys(ws.holdings)[0] as HoldingId

      const play = makePlay('land_claim', {
        issue: { kind: 'land_claim', holdingId, provinceId: PROVINCE_ID },
      })
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      expect(ws.nextDiplomaticOfferId).toBe(1)
      const offer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      const dem0 = offer.demands[0]!
      expect(dem0.kind).toBe('transfer_land_contract')
      if (dem0.kind === 'transfer_land_contract') {
        expect(dem0.holdingId).toBe(holdingId)
        expect(dem0.toPolityId).toBe(INIT)
      }
      const dem1 = offer.demands[1]!
      expect(dem1.kind).toBe('pay_wealth')
      if (dem1.kind === 'pay_wealth') {
        expect(dem1.amount).toBe(
          Math.round(computeLandClaimCompensation(ws, defaultConfig, holdingId)),
        )
      }
    })
  })

  // -----------------------------------------------------------------------
  // Land claim — with base offer
  // -----------------------------------------------------------------------

  describe('land_claim with base offer', () => {
    it('initiator side increases pay_wealth by 30%', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const firstHoldingId = Object.keys(ws.holdings)[0] as HoldingId
      ws.holdings[HOLDING_ID] = ws.holdings[firstHoldingId]!

      const offer = makeOffer([transferDemand, payDemand])
      const play = makePlay('land_claim', {
        issue: { kind: 'land_claim', holdingId: HOLDING_ID, provinceId: PROVINCE_ID },
        currentOfferId: 'do-1' as DiplomaticOfferId,
      })
      ws.diplomaticOffers['do-1' as DiplomaticOfferId] = offer
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      const payDemandOut = newOffer.demands.find((d) => d.kind === 'pay_wealth') as Extract<
        DiplomaticDemand,
        { kind: 'pay_wealth' }
      >
      expect(payDemandOut.amount).toBe(130)
    })

    it('target side on transfer offer decreases pay_wealth by 30%', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const firstHoldingId = Object.keys(ws.holdings)[0] as HoldingId
      ws.holdings[HOLDING_ID] = ws.holdings[firstHoldingId]!

      const offer = makeOffer([transferDemand, payDemand])
      const play = makePlay('land_claim', {
        issue: { kind: 'land_claim', holdingId: HOLDING_ID, provinceId: PROVINCE_ID },
        currentOfferId: 'do-1' as DiplomaticOfferId,
      })
      ws.diplomaticOffers['do-1' as DiplomaticOfferId] = offer
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'target')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      const payDemandOut = newOffer.demands.find((d) => d.kind === 'pay_wealth') as Extract<
        DiplomaticDemand,
        { kind: 'pay_wealth' }
      >
      expect(payDemandOut.amount).toBe(70)
    })

    it('target side on status_quo offer increases pay_wealth by 30%', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const firstHoldingId = Object.keys(ws.holdings)[0] as HoldingId
      ws.holdings[HOLDING_ID] = ws.holdings[firstHoldingId]!

      const offer = makeOffer([{ kind: 'status_quo' }, payDemand])
      const play = makePlay('land_claim', {
        issue: { kind: 'land_claim', holdingId: HOLDING_ID, provinceId: PROVINCE_ID },
        currentOfferId: 'do-1' as DiplomaticOfferId,
      })
      ws.diplomaticOffers['do-1' as DiplomaticOfferId] = offer
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'target')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      const payDemandOut = newOffer.demands.find((d) => d.kind === 'pay_wealth') as Extract<
        DiplomaticDemand,
        { kind: 'pay_wealth' }
      >
      expect(payDemandOut.amount).toBe(130)
    })

    it('initiator side adds pay_wealth when base has none', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const holdingId = Object.keys(ws.holdings)[0] as HoldingId

      const offer = makeOffer([
        {
          kind: 'transfer_land_contract',
          holdingId,
          toPolityId: INIT,
        },
      ])
      const play = makePlay('land_claim', {
        issue: { kind: 'land_claim', holdingId, provinceId: PROVINCE_ID },
        currentOfferId: 'do-1' as DiplomaticOfferId,
      })
      ws.diplomaticOffers['do-1' as DiplomaticOfferId] = offer
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      expect(newOffer.demands.some((d) => d.kind === 'transfer_land_contract')).toBe(true)
      expect(newOffer.demands.some((d) => d.kind === 'pay_wealth')).toBe(true)
      const payDemandOut = newOffer.demands.find((d) => d.kind === 'pay_wealth') as Extract<
        DiplomaticDemand,
        { kind: 'pay_wealth' }
      >
      expect(payDemandOut.amount).toBe(
        Math.round(computeLandClaimCompensation(ws, defaultConfig, holdingId) * 1.3),
      )
    })

    it('prefers lastRejectedOfferId over currentOfferId', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const firstHoldingId = Object.keys(ws.holdings)[0] as HoldingId
      ws.holdings[HOLDING_ID] = ws.holdings[firstHoldingId]!

      const rejectedOffer = makeOffer([
        {
          kind: 'pay_wealth',
          from: { kind: 'polity', id: INIT },
          to: { kind: 'polity', id: TARGET },
          amount: 200,
        },
      ])
      const currentOffer = makeOffer([
        {
          kind: 'pay_wealth',
          from: { kind: 'polity', id: INIT },
          to: { kind: 'polity', id: TARGET },
          amount: 100,
        },
      ])
      const play = makePlay('land_claim', {
        issue: { kind: 'land_claim', holdingId: HOLDING_ID, provinceId: PROVINCE_ID },
        lastRejectedOfferId: 'do-rejected' as DiplomaticOfferId,
        currentOfferId: 'do-current' as DiplomaticOfferId,
      })
      ws.diplomaticOffers['do-rejected' as DiplomaticOfferId] = rejectedOffer
      ws.diplomaticOffers['do-current' as DiplomaticOfferId] = currentOffer
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      const payDemandOut = newOffer.demands.find((d) => d.kind === 'pay_wealth') as Extract<
        DiplomaticDemand,
        { kind: 'pay_wealth' }
      >
      expect(payDemandOut.amount).toBe(260)
    })
  })

  // -----------------------------------------------------------------------
  // Contract tax revision — no base offer
  // -----------------------------------------------------------------------

  describe('contract_tax_revision no base offer', () => {
    it('creates halfway rate', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const holdingId = Object.keys(ws.holdings)[0] as HoldingId

      const play = makePlay('contract_tax_revision', {
        issue: {
          kind: 'contract_tax_revision',
          holdingId,
          landContractId: LC_ID,
          baseTaxRateToGrantor: 0.2,
          desiredTaxRateToGrantor: 0.6,
          direction: 'increase',
        },
      })
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      const taxDemand = newOffer.demands.find(
        (d) => d.kind === 'change_contract_tax_rate',
      ) as Extract<DiplomaticDemand, { kind: 'change_contract_tax_rate' }>
      expect(taxDemand.newTaxRateToGrantor).toBeCloseTo(0.4, 10)
    })

    it('clamps to taxRevisionMinRate', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const holdingId = Object.keys(ws.holdings)[0] as HoldingId

      const play = makePlay('contract_tax_revision', {
        issue: {
          kind: 'contract_tax_revision',
          holdingId,
          landContractId: LC_ID,
          baseTaxRateToGrantor: 0.02,
          desiredTaxRateToGrantor: 0.04,
          direction: 'increase',
        },
      })
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      const taxDemand = newOffer.demands.find(
        (d) => d.kind === 'change_contract_tax_rate',
      ) as Extract<DiplomaticDemand, { kind: 'change_contract_tax_rate' }>
      expect(taxDemand.newTaxRateToGrantor).toBe(0.05)
    })
  })

  // -----------------------------------------------------------------------
  // Contract tax revision — with base offer
  // -----------------------------------------------------------------------

  describe('contract_tax_revision with base offer', () => {
    it('moves rate 30% toward baseTaxRate', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const firstHoldingId = Object.keys(ws.holdings)[0] as HoldingId
      ws.holdings[HOLDING_ID] = ws.holdings[firstHoldingId]!

      const offer = makeOffer([
        {
          kind: 'change_contract_tax_rate',
          holdingId: HOLDING_ID,
          landContractId: LC_ID,
          newTaxRateToGrantor: 0.5,
        },
      ])
      const play = makePlay('contract_tax_revision', {
        issue: {
          kind: 'contract_tax_revision',
          holdingId: HOLDING_ID,
          landContractId: LC_ID,
          baseTaxRateToGrantor: 0.3,
          desiredTaxRateToGrantor: 0.5,
          direction: 'increase',
        },
        currentOfferId: 'do-1' as DiplomaticOfferId,
      })
      ws.diplomaticOffers['do-1' as DiplomaticOfferId] = offer
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      const taxDemand = newOffer.demands.find(
        (d) => d.kind === 'change_contract_tax_rate',
      ) as Extract<DiplomaticDemand, { kind: 'change_contract_tax_rate' }>
      expect(taxDemand.newTaxRateToGrantor).toBeCloseTo(0.44, 10)
    })

    it('status_quo base replaces with halfway rate', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const holdingId = Object.keys(ws.holdings)[0] as HoldingId

      const offer = makeOffer([{ kind: 'status_quo' }])
      const play = makePlay('contract_tax_revision', {
        issue: {
          kind: 'contract_tax_revision',
          holdingId,
          landContractId: LC_ID,
          baseTaxRateToGrantor: 0.3,
          desiredTaxRateToGrantor: 0.5,
          direction: 'increase',
        },
        currentOfferId: 'do-1' as DiplomaticOfferId,
      })
      ws.diplomaticOffers['do-1' as DiplomaticOfferId] = offer
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      expect(newOffer.demands.some((d) => d.kind === 'status_quo')).toBe(false)
      expect(newOffer.demands.some((d) => d.kind === 'change_contract_tax_rate')).toBe(true)
      const taxDemand = newOffer.demands.find(
        (d) => d.kind === 'change_contract_tax_rate',
      ) as Extract<DiplomaticDemand, { kind: 'change_contract_tax_rate' }>
      expect(taxDemand.newTaxRateToGrantor).toBeCloseTo(0.4, 10)
    })

    it('does not create offer when issue is missing', () => {
      const ws = makeEmptyV016State()

      const offer = makeOffer([{ kind: 'status_quo' }])
      const play = makePlay('contract_tax_revision', {
        currentOfferId: 'do-1' as DiplomaticOfferId,
      })
      ws.diplomaticOffers['do-1' as DiplomaticOfferId] = offer
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      expect(ws.nextDiplomaticOfferId).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // proposedBy
  // -----------------------------------------------------------------------

  describe('proposedBy', () => {
    it('is initiator when side is initiator', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const firstHoldingId = Object.keys(ws.holdings)[0] as HoldingId
      ws.holdings[HOLDING_ID] = ws.holdings[firstHoldingId]!

      const offer = makeOffer([transferDemand, payDemand])
      const play = makePlay('land_claim', {
        issue: { kind: 'land_claim', holdingId: HOLDING_ID, provinceId: PROVINCE_ID },
        currentOfferId: 'do-1' as DiplomaticOfferId,
      })
      ws.diplomaticOffers['do-1' as DiplomaticOfferId] = offer
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      expect(newOffer.proposedBy).toBe(play.initiator)
    })

    it('is target when side is target', () => {
      let ws = makeEmptyV016State()
      ws = withProvince(ws, PROVINCE_ID, {})
      const firstHoldingId = Object.keys(ws.holdings)[0] as HoldingId
      ws.holdings[HOLDING_ID] = ws.holdings[firstHoldingId]!

      const offer = makeOffer([transferDemand, payDemand])
      const play = makePlay('land_claim', {
        issue: { kind: 'land_claim', holdingId: HOLDING_ID, provinceId: PROVINCE_ID },
        currentOfferId: 'do-1' as DiplomaticOfferId,
      })
      ws.diplomaticOffers['do-1' as DiplomaticOfferId] = offer
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'target')

      const newOffer = ws.diplomaticOffers['do-0' as DiplomaticOfferId]!
      expect(newOffer.proposedBy).toBe(play.target)
    })
  })

  // -----------------------------------------------------------------------
  // Missing issue
  // -----------------------------------------------------------------------

  describe('missing issue', () => {
    it('returns without creating offer when issue is missing', () => {
      const ws = makeEmptyV016State()
      const play = makePlay('land_claim')
      ws.diplomaticPlays[PLAY_ID] = play

      buildAndCreateCompromiseOffer(ws, defaultConfig, play, 'initiator')

      expect(ws.nextDiplomaticOfferId).toBe(0)
    })
  })
})
