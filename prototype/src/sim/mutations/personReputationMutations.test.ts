// 影響力個人中心化 Phase 1a: byOrganization index の add/remove 同期テスト。

import { describe, expect, it } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import { createPersonId, createPolityId, createHouseId } from '../types/ids'
import { personReputationOrganizationKey } from '../types/personReputation'
import type { CreatePersonReputationInput } from './personReputationMutations'
import { addPersonReputationMut, removePersonReputationMut } from './personReputationMutations'

function baseInput(): CreatePersonReputationInput {
  return {
    personId: createPersonId('pe', 0),
    source: { kind: 'war' },
    outcome: 'success',
    category: 'military',
    baseScore: 10,
    createdWeek: 0,
    expiryWeek: 1000,
    relatedRefs: [],
  }
}

describe('addPersonReputationMut: byOrganization 同期 (Phase 1a)', () => {
  it('polity-tag 評判は byOrganization[polity:id] に入る', () => {
    const ws = makeEmptyV016State()
    const pid = createPersonId('pe', 1)
    const polityId = createPolityId('c', 1)
    const rep = addPersonReputationMut(ws, {
      ...baseInput(),
      personId: pid,
      relatedOrganization: { kind: 'polity', id: polityId },
    })
    const key = personReputationOrganizationKey({ kind: 'polity', id: polityId })
    expect(ws.personReputationIndex.byOrganization[key]).toEqual([rep.id])
    expect(ws.personReputationIndex.byPerson[pid]).toEqual([rep.id])
  })

  it('house-tag 評判は byOrganization[house:id] に入る', () => {
    const ws = makeEmptyV016State()
    const pid = createPersonId('pe', 2)
    const houseId = createHouseId('h', 2)
    const rep = addPersonReputationMut(ws, {
      ...baseInput(),
      personId: pid,
      relatedOrganization: { kind: 'house', id: houseId },
    })
    const key = personReputationOrganizationKey({ kind: 'house', id: houseId })
    expect(ws.personReputationIndex.byOrganization[key]).toEqual([rep.id])
  })

  it('tag 無し評判は byOrganization に入らない (byPerson のみ)', () => {
    const ws = makeEmptyV016State()
    const pid = createPersonId('pe', 3)
    const rep = addPersonReputationMut(ws, { ...baseInput(), personId: pid })
    expect(ws.personReputationIndex.byPerson[pid]).toEqual([rep.id])
    expect(Object.keys(ws.personReputationIndex.byOrganization)).toHaveLength(0)
  })

  it('同一 organization の複数評判は配列に蓄積する', () => {
    const ws = makeEmptyV016State()
    const pid = createPersonId('pe', 4)
    const polityId = createPolityId('c', 4)
    const org = { kind: 'polity', id: polityId } as const
    const r1 = addPersonReputationMut(ws, {
      ...baseInput(),
      personId: pid,
      relatedOrganization: org,
    })
    const r2 = addPersonReputationMut(ws, {
      ...baseInput(),
      personId: pid,
      relatedOrganization: org,
    })
    const key = personReputationOrganizationKey(org)
    expect(ws.personReputationIndex.byOrganization[key]).toEqual([r1.id, r2.id])
  })
})

describe('removePersonReputationMut: byOrganization purge (Phase 1a)', () => {
  it('削除で byOrganization から除去・空エントリは purge', () => {
    const ws = makeEmptyV016State()
    const pid = createPersonId('pe', 5)
    const polityId = createPolityId('c', 5)
    const org = { kind: 'polity', id: polityId } as const
    const rep = addPersonReputationMut(ws, {
      ...baseInput(),
      personId: pid,
      relatedOrganization: org,
    })
    const key = personReputationOrganizationKey(org)
    expect(ws.personReputationIndex.byOrganization[key]).toBeDefined()

    removePersonReputationMut(ws, rep.id)
    expect(ws.personReputationIndex.byOrganization[key]).toBeUndefined()
    expect(ws.personReputationIndex.byPerson[pid]).toBeUndefined()
  })

  it('複数評判のうち 1 件削除で残りは保持', () => {
    const ws = makeEmptyV016State()
    const pid = createPersonId('pe', 6)
    const polityId = createPolityId('c', 6)
    const org = { kind: 'polity', id: polityId } as const
    const r1 = addPersonReputationMut(ws, {
      ...baseInput(),
      personId: pid,
      relatedOrganization: org,
    })
    const r2 = addPersonReputationMut(ws, {
      ...baseInput(),
      personId: pid,
      relatedOrganization: org,
    })
    const key = personReputationOrganizationKey(org)

    removePersonReputationMut(ws, r1.id)
    expect(ws.personReputationIndex.byOrganization[key]).toEqual([r2.id])
  })

  it('tag 無し評判の削除は byOrganization に触れない', () => {
    const ws = makeEmptyV016State()
    const pid = createPersonId('pe', 7)
    const rep = addPersonReputationMut(ws, { ...baseInput(), personId: pid })
    removePersonReputationMut(ws, rep.id)
    expect(Object.keys(ws.personReputationIndex.byOrganization)).toHaveLength(0)
  })
})
