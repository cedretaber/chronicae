import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import {
  createWar,
  addWarToIndexMut,
  removeWarFromIndexMut,
  removeWarParticipantMut,
  updateWar,
  updateWarSideMut,
  getWarPrimaryAttacker,
  getWarPrimaryDefender,
  createWarGoalFromDiplomaticPlay,
} from './warMutations'
import { createWarId } from '../types/ids'
import { politicalActorKey } from '../selectors/actorSelectors'
import type {
  PolityId,
  HouseId,
  HoldingId,
  LandContractId,
  ProvinceId,
  PersonId,
  WarId,
  DiplomaticPlayId,
} from '../types/ids'
import type { OrganizationRef } from '../types/office'
import type { DiplomaticPlay } from '../types/diplomaticPlay'

const pA: OrganizationRef = { kind: 'polity', id: 'po-1' as PolityId }
const pB: OrganizationRef = { kind: 'polity', id: 'po-2' as PolityId }

describe('createWarId', () => {
  it('formats as w-<n>', () => {
    expect(createWarId(0)).toBe('w-0')
    expect(createWarId(7)).toBe('w-7')
  })
})

describe('politicalActorKey', () => {
  it('builds kind:id key for polity and house', () => {
    expect(politicalActorKey({ kind: 'polity', id: 'po-1' as PolityId })).toBe('polity:po-1')
    expect(politicalActorKey({ kind: 'house', id: 'h-3' as HouseId })).toBe('house:h-3')
  })
})

describe('createWar', () => {
  it('creates an active war, increments counter, registers record + index', () => {
    const ws = makeEmptyV016State()
    const war = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
    })

    expect(war.id).toBe('w-0')
    expect(ws.nextWarId).toBe(1)
    expect(ws.wars[war.id]).toBe(war)
    expect(war.status).toBe('active')
    expect(war.warScore).toBe(0)
    expect(war.endedWeek).toBeUndefined()
    expect(war.attacker.key).toBe('attacker')
    expect(war.defender.key).toBe('defender')
    expect(war.attacker.participants).toHaveLength(1)
    expect(war.attacker.participants[0]?.actor).toEqual(pA)
    expect(war.attacker.participants[0]?.primary).toBe(true)
    expect(war.defender.participants[0]?.actor).toEqual(pB)

    expect(ws.warIndex.byParticipant['polity:po-1']).toContain(war.id)
    expect(ws.warIndex.byParticipant['polity:po-2']).toContain(war.id)
  })

  it('initializes v0.35 WarSide command fields on both sides (inert defaults)', () => {
    const ws = makeEmptyV016State()
    const war = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
    })
    for (const side of [war.attacker, war.defender]) {
      expect(side.commanderPersonIds).toEqual([])
      expect(side.avoidanceCount).toBe(0)
      expect(side.captainGeneralPersonId).toBeUndefined()
    }
  })

  it('records originDiplomaticPlayId in byOriginDiplomaticPlay only when provided', () => {
    const ws = makeEmptyV016State()
    const w1 = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 50,
      startedWeek: 10,
    })
    expect(w1.originDiplomaticPlayId).toBeUndefined()
    expect(Object.keys(ws.warIndex.byOriginDiplomaticPlay)).toHaveLength(0)

    const w2 = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 50,
      startedWeek: 10,
      originDiplomaticPlayId: 'dp-5' as DiplomaticPlayId,
    })
    expect(w2.originDiplomaticPlayId).toBe('dp-5')
    expect(ws.warIndex.byOriginDiplomaticPlay['dp-5' as DiplomaticPlayId]).toBe(w2.id)
  })
})

// v0.43: supporters 付き createWar (multi-participant)
describe('createWar with supporters (v0.43)', () => {
  const pC: OrganizationRef = { kind: 'polity', id: 'po-3' as PolityId }
  const pD: OrganizationRef = { kind: 'polity', id: 'po-4' as PolityId }

  it('appends supporters after primary with primary=false and joinedWeek=startedWeek', () => {
    const ws = makeEmptyV016State()
    const war = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
      attackerSupporters: [{ actor: pC }],
      defenderSupporters: [{ actor: pD }],
    })
    expect(war.attacker.participants).toHaveLength(2)
    expect(war.attacker.participants[0]?.primary).toBe(true)
    expect(war.attacker.participants[1]).toEqual({ actor: pC, joinedWeek: 48, primary: false })
    expect(war.defender.participants).toHaveLength(2)
    expect(war.defender.participants[1]).toEqual({ actor: pD, joinedWeek: 48, primary: false })
  })

  it('does not write contributionScore key when not provided (§5.1a forward declaration)', () => {
    const ws = makeEmptyV016State()
    const war = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
      attackerSupporters: [{ actor: pC }],
    })
    // dump 等価性のため、undefined キーは object に存在してはならない。
    expect('contributionScore' in war.attacker.participants[0]!).toBe(false)
    expect('contributionScore' in war.attacker.participants[1]!).toBe(false)
  })

  it('registers all participants (including supporters) in byParticipant', () => {
    const ws = makeEmptyV016State()
    const war = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
      attackerSupporters: [{ actor: pC }],
      defenderSupporters: [{ actor: pD }],
    })
    expect(ws.warIndex.byParticipant['polity:po-1']).toContain(war.id)
    expect(ws.warIndex.byParticipant['polity:po-2']).toContain(war.id)
    expect(ws.warIndex.byParticipant['polity:po-3']).toContain(war.id)
    expect(ws.warIndex.byParticipant['polity:po-4']).toContain(war.id)
  })

  it('removeWarFromIndexMut purges supporter entries too (round-trip)', () => {
    const ws = makeEmptyV016State()
    const war = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
      attackerSupporters: [{ actor: pC }],
      defenderSupporters: [{ actor: pD }],
    })
    removeWarFromIndexMut(ws, war)
    expect(ws.warIndex.byParticipant['polity:po-3']).toBeUndefined()
    expect(ws.warIndex.byParticipant['polity:po-4']).toBeUndefined()
    addWarToIndexMut(ws, war)
    expect(ws.warIndex.byParticipant['polity:po-3']).toContain(war.id)
    expect(ws.warIndex.byParticipant['polity:po-4']).toContain(war.id)
  })
})

describe('add/removeWarFromIndexMut', () => {
  it('round-trips and purges empty byParticipant entries on removal', () => {
    const ws = makeEmptyV016State()
    const war = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
      originDiplomaticPlayId: 'dp-9' as DiplomaticPlayId,
    })

    removeWarFromIndexMut(ws, war)
    // 空配列になったエントリは delete で purge される
    expect(ws.warIndex.byParticipant['polity:po-1']).toBeUndefined()
    expect(ws.warIndex.byParticipant['polity:po-2']).toBeUndefined()
    expect(ws.warIndex.byOriginDiplomaticPlay['dp-9' as DiplomaticPlayId]).toBeUndefined()

    // re-add restores the index
    addWarToIndexMut(ws, war)
    expect(ws.warIndex.byParticipant['polity:po-1']).toContain(war.id)
    expect(ws.warIndex.byOriginDiplomaticPlay['dp-9' as DiplomaticPlayId]).toBe(war.id)
  })

  it('keeps other war ids under a shared participant key when one is removed', () => {
    const ws = makeEmptyV016State()
    const w1 = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
    })
    const w2 = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
    })
    expect(ws.warIndex.byParticipant['polity:po-1']).toEqual([w1.id, w2.id])
    removeWarFromIndexMut(ws, w1)
    expect(ws.warIndex.byParticipant['polity:po-1']).toEqual([w2.id])
  })
})

// v0.43 §11.2: removeWarParticipantMut
describe('removeWarParticipantMut', () => {
  const pC: OrganizationRef = { kind: 'polity', id: 'po-3' as PolityId }

  function makeWarWithSupporter(ws: ReturnType<typeof makeEmptyV016State>) {
    return createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
      attackerSupporters: [{ actor: pC }],
    })
  }

  it('removes a supporter and purges its byParticipant entry; war stays', () => {
    const ws = makeEmptyV016State()
    const war = makeWarWithSupporter(ws)
    expect(removeWarParticipantMut(ws, war.id, pC)).toBe(true)
    const updated = ws.wars[war.id]!
    expect(updated.attacker.participants).toHaveLength(1)
    expect(updated.attacker.participants[0]?.primary).toBe(true)
    expect(ws.warIndex.byParticipant['polity:po-3']).toBeUndefined()
    expect(ws.warIndex.byParticipant['polity:po-1']).toContain(war.id)
    expect(updated.status).toBe('active')
  })

  it('rejects removing a primary participant (§11.2)', () => {
    const ws = makeEmptyV016State()
    const war = makeWarWithSupporter(ws)
    expect(removeWarParticipantMut(ws, war.id, pA)).toBe(false)
    expect(ws.wars[war.id]!.attacker.participants).toHaveLength(2)
    expect(ws.warIndex.byParticipant['polity:po-1']).toContain(war.id)
  })

  it('returns false for unknown war or non-participant actor', () => {
    const ws = makeEmptyV016State()
    const war = makeWarWithSupporter(ws)
    expect(removeWarParticipantMut(ws, 'w-999' as WarId, pC)).toBe(false)
    expect(
      removeWarParticipantMut(ws, war.id, { kind: 'polity', id: 'po-ghost' as PolityId }),
    ).toBe(false)
  })

  it('keeps other war ids under the supporter key when removed from one war', () => {
    const ws = makeEmptyV016State()
    const w1 = makeWarWithSupporter(ws)
    const w2 = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
      defenderSupporters: [{ actor: pC }],
    })
    expect(ws.warIndex.byParticipant['polity:po-3']).toEqual([w1.id, w2.id])
    expect(removeWarParticipantMut(ws, w1.id, pC)).toBe(true)
    expect(ws.warIndex.byParticipant['polity:po-3']).toEqual([w2.id])
  })
})

describe('updateWar / accessors', () => {
  it('patches status and endedWeek', () => {
    const ws = makeEmptyV016State()
    const war = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
    })
    updateWar(ws, war.id, { status: 'attacker_won', endedWeek: 100, warScore: 60 })
    expect(ws.wars[war.id]?.status).toBe('attacker_won')
    expect(ws.wars[war.id]?.endedWeek).toBe(100)
  })

  it('is a no-op for unknown war id', () => {
    const ws = makeEmptyV016State()
    expect(() => updateWar(ws, 'w-404' as WarId, { warScore: 10 })).not.toThrow()
  })

  it('getWarPrimaryAttacker / getWarPrimaryDefender return the primary participant', () => {
    const ws = makeEmptyV016State()
    const war = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
    })
    expect(getWarPrimaryAttacker(war)?.actor).toEqual(pA)
    expect(getWarPrimaryDefender(war)?.actor).toEqual(pB)
  })
})

describe('updateWarSideMut', () => {
  it('mutates only the targeted side and leaves the index intact', () => {
    const ws = makeEmptyV016State()
    const war = createWar(ws, {
      attacker: pA,
      defender: pB,
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
    })
    updateWarSideMut(ws, war.id, 'attacker', {
      avoidanceCount: 3,
      captainGeneralPersonId: 'pe-1' as PersonId,
      commanderPersonIds: ['pe-2' as PersonId],
    })
    const updated = ws.wars[war.id]
    expect(updated?.attacker.avoidanceCount).toBe(3)
    expect(updated?.attacker.captainGeneralPersonId).toBe('pe-1')
    expect(updated?.attacker.commanderPersonIds).toEqual(['pe-2'])
    // defender 側は不変
    expect(updated?.defender.avoidanceCount).toBe(0)
    expect(updated?.defender.captainGeneralPersonId).toBeUndefined()
    // participant index は再構築不要 (side 更新は index に影響しない)
    expect(ws.warIndex.byParticipant['polity:po-1']).toContain(war.id)
    expect(ws.warIndex.byParticipant['polity:po-2']).toContain(war.id)
  })

  it('is a no-op for unknown war id', () => {
    const ws = makeEmptyV016State()
    expect(() =>
      updateWarSideMut(ws, 'w-404' as WarId, 'attacker', { avoidanceCount: 1 }),
    ).not.toThrow()
  })
})

describe('createWarGoalFromDiplomaticPlay', () => {
  const landClaimPlay = (initiator: OrganizationRef, target: OrganizationRef): DiplomaticPlay =>
    ({
      issue: {
        kind: 'land_claim',
        holdingId: 'hl-1' as HoldingId,
        provinceId: 'pr-1' as ProvinceId,
      },
      initiator,
      target,
    }) as unknown as DiplomaticPlay

  it('land_claim: to=initiator, from=target when terminal cache empty (fallback)', () => {
    const ws = makeEmptyV016State()
    const goal = createWarGoalFromDiplomaticPlay(ws, landClaimPlay(pA, pB), 60)
    expect(goal).toEqual({
      kind: 'transfer_land_contract',
      holdingId: 'hl-1',
      fromPolityId: 'po-2',
      toPolityId: 'po-1',
      requiredWarScore: 60,
    })
  })

  it('land_claim: from = current terminal grantee from cache when present', () => {
    const ws = makeEmptyV016State()
    ws.holdingTerminalPolityCache['hl-1' as HoldingId] = 'po-9' as PolityId
    const goal = createWarGoalFromDiplomaticPlay(ws, landClaimPlay(pA, pB), 60)
    expect(goal?.kind).toBe('transfer_land_contract')
    if (goal?.kind === 'transfer_land_contract') {
      expect(goal.fromPolityId).toBe('po-9')
      expect(goal.toPolityId).toBe('po-1')
    }
  })

  it('contract_tax_revision: newTaxRateToGrantor <- issue.desiredTaxRateToGrantor', () => {
    const ws = makeEmptyV016State()
    const play = {
      issue: {
        kind: 'contract_tax_revision',
        holdingId: 'hl-1' as HoldingId,
        landContractId: 'lc-1' as LandContractId,
        baseTaxRateToGrantor: 0.2,
        desiredTaxRateToGrantor: 0.5,
        direction: 'increase',
      },
      initiator: pA,
      target: pB,
    } as unknown as DiplomaticPlay
    const goal = createWarGoalFromDiplomaticPlay(ws, play, 50)
    expect(goal).toEqual({
      kind: 'change_contract_tax_rate',
      holdingId: 'hl-1',
      landContractId: 'lc-1',
      // lc-1 は empty state に無いため liveRate=undefined → fallback で issue.baseTaxRateToGrantor。
      baseTaxRateToGrantor: 0.2,
      newTaxRateToGrantor: 0.5,
      requiredWarScore: 50,
    })
  })

  it('contract_tax_revision: baseTaxRateToGrantor <- 開戦時の live 契約税率 (issue 値より優先)', () => {
    const ws = makeEmptyV016State()
    // 契約が存在する場合は live rate を凍結 baseline にする (issue.baseTaxRateToGrantor=0.2 ではなく 0.35)。
    ws.landContracts['lc-1' as LandContractId] = {
      terms: { taxRateToGrantor: 0.35 },
    } as unknown as (typeof ws.landContracts)[LandContractId]
    const play = {
      issue: {
        kind: 'contract_tax_revision',
        holdingId: 'hl-1' as HoldingId,
        landContractId: 'lc-1' as LandContractId,
        baseTaxRateToGrantor: 0.2,
        desiredTaxRateToGrantor: 0.5,
        direction: 'increase',
      },
      initiator: pA,
      target: pB,
    } as unknown as DiplomaticPlay
    const goal = createWarGoalFromDiplomaticPlay(ws, play, 50)
    expect(goal?.kind).toBe('change_contract_tax_rate')
    if (goal?.kind === 'change_contract_tax_rate') {
      expect(goal.baseTaxRateToGrantor).toBe(0.35)
      expect(goal.newTaxRateToGrantor).toBe(0.5)
    }
  })

  it('returns undefined when issue is missing', () => {
    const ws = makeEmptyV016State()
    const play = { initiator: pA, target: pB } as unknown as DiplomaticPlay
    expect(createWarGoalFromDiplomaticPlay(ws, play, 60)).toBeUndefined()
  })

  it('returns undefined for land_claim when initiator is not a polity', () => {
    const ws = makeEmptyV016State()
    const houseInit: OrganizationRef = { kind: 'house', id: 'h-1' as HouseId }
    expect(createWarGoalFromDiplomaticPlay(ws, landClaimPlay(houseInit, pB), 60)).toBeUndefined()
  })
})
