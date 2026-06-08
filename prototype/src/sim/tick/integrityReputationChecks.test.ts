// 影響力個人中心化 Phase 1a: byOrganization index の整合性チェックテスト。

import { describe, expect, it } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import { createPersonId, createPolityId, createPersonReputationId } from '../types/ids'
import type { PersonReputation } from '../types/personReputation'
import { personReputationOrganizationKey } from '../types/personReputation'
import type { SimError } from '../mutations/errors'
import { checkPersonReputations } from './integrityReputationChecks'

function makeTaggedRep(
  idNum: number,
  personId: ReturnType<typeof createPersonId>,
): PersonReputation {
  const polityId = createPolityId('c', 1)
  return {
    id: createPersonReputationId(idNum),
    personId,
    source: { kind: 'war' },
    outcome: 'success',
    category: 'military',
    baseScore: 10,
    createdWeek: 0,
    expiryWeek: 1000,
    relatedOrganization: { kind: 'polity', id: polityId },
    relatedRefs: [],
  }
}

describe('checkPersonReputations: byOrganization 整合 (Phase 1a)', () => {
  it('tag された評判が byOrganization に無いと違反', () => {
    const state = makeEmptyV016State()
    const pid = createPersonId('pe', 1)
    state.persons[pid] = { id: pid } as never // personId 存在チェックだけ満たす
    const rep = makeTaggedRep(0, pid)
    state.personReputations[rep.id] = rep
    // byPerson は正しく入れるが byOrganization は欠落させる
    state.personReputationIndex = {
      byPerson: { [pid]: [rep.id] },
      byOrganization: {},
    }
    const errors: SimError[] = []
    checkPersonReputations(state, errors)
    expect(errors.some((e) => e.message.includes('byOrganization'))).toBe(true)
  })

  it('byOrganization が missing 評判を参照すると違反', () => {
    const state = makeEmptyV016State()
    const key = personReputationOrganizationKey({ kind: 'polity', id: createPolityId('c', 1) })
    state.personReputationIndex = {
      byPerson: {},
      byOrganization: { [key]: [createPersonReputationId(99)] },
    }
    const errors: SimError[] = []
    checkPersonReputations(state, errors)
    expect(errors.some((e) => e.message.includes('references missing'))).toBe(true)
  })

  it('byOrganization の空エントリは違反', () => {
    const state = makeEmptyV016State()
    const key = personReputationOrganizationKey({ kind: 'polity', id: createPolityId('c', 1) })
    state.personReputationIndex = {
      byPerson: {},
      byOrganization: { [key]: [] },
    }
    const errors: SimError[] = []
    checkPersonReputations(state, errors)
    expect(errors.some((e) => e.message.includes('empty entry not purged'))).toBe(true)
  })

  it('整合した byOrganization は違反なし', () => {
    const state = makeEmptyV016State()
    const pid = createPersonId('pe', 1)
    state.persons[pid] = { id: pid } as never
    const rep = makeTaggedRep(0, pid)
    state.personReputations[rep.id] = rep
    const key = personReputationOrganizationKey(rep.relatedOrganization!)
    state.personReputationIndex = {
      byPerson: { [pid]: [rep.id] },
      byOrganization: { [key]: [rep.id] },
    }
    const errors: SimError[] = []
    checkPersonReputations(state, errors)
    expect(errors).toHaveLength(0)
  })
})
