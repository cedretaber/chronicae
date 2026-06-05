// v0.42 PoliticalRight mutation のユニットテスト (spec v0.42 §20.1)。
// - create / remove / transfer
// - index 3 系統 (byPolity / byHolder / byTarget) の整合
// - 1 target 1 active right
// - personal right (holder.kind === 'person') は通常生成経路が無いため、ここが唯一の検証 (§4.2.4)

import { describe, expect, it } from 'vitest'
import { createPersonId, createHouseId, createPolityId, createRegimentId } from '../types/ids'
import type { HoldingId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Regiment } from '../types/regiment'
import type { PoliticalRightTargetRef } from '../types/politicalRight'
import { politicalRightTargetKey, getPoliticalRightKindFromTarget } from '../types/politicalRight'
import {
  createPoliticalRight,
  removePoliticalRight,
  removeRightsByHolder,
  removeRightsByPolity,
  removeRightsByTarget,
  transferPoliticalRight,
} from './politicalRightMutations'
import { makeEmptyV016State, withPerson, withHouse, withPolity, withHolding } from '../testFixtures'
import { withProvince } from '../testFixtures'

const polityId = createPolityId('c', 0)
const houseId = createHouseId('h', 0)
const house2Id = createHouseId('h', 1)
const personId = createPersonId('pe', 0)
const person2Id = createPersonId('pe', 1)
const holdingId = 'hl-0' as HoldingId
const regimentId = createRegimentId(0)
const provinceId = 'pr-0' as Parameters<typeof withProvince>[1]

function makeRegiment(overrides: Partial<Regiment> = {}): Regiment {
  return {
    id: regimentId,
    owner: { kind: 'polity', id: polityId },
    status: 'active',
    sourceKind: 'levy',
    troopKind: 'infantry',
    strength: 100,
    organization: 50,
    morale: 30,
    maxStrength: 100,
    basePower: 10,
    baselineOrganization: 50,
    maxOrganization: 100,
    baselineMorale: 30,
    maxMorale: 100,
    createdWeek: 0,
    ...overrides,
  }
}

function makeFixture(): WorldState {
  let state = makeEmptyV016State()
  state = withProvince(state, provinceId)
  state = withHouse(state, houseId)
  state = withHouse(state, house2Id)
  state = withPerson(state, personId, { houseId })
  state = withPerson(state, person2Id, { houseId: house2Id })
  state = withPolity(state, polityId, { ownerHouseId: houseId })
  state = withHolding(state, holdingId, provinceId)
  state = {
    ...state,
    holdingTerminalPolityCache: { ...state.holdingTerminalPolityCache, [holdingId]: polityId },
    regiments: { [regimentId]: makeRegiment() },
    regimentIndex: {
      ...state.regimentIndex,
      byOwner: { [`polity:${polityId}`]: [regimentId] },
    },
  }
  return state
}

const officeTarget: PoliticalRightTargetRef = {
  kind: 'polity_office_role',
  polityId,
  role: 'administrator',
  slotIndex: 0,
}
const holdingTarget: PoliticalRightTargetRef = {
  kind: 'holding_office_role',
  holdingId,
  role: 'bailiff',
}
const regimentTarget: PoliticalRightTargetRef = { kind: 'regiment', regimentId }

describe('createPoliticalRight', () => {
  it('creates a household right and syncs all three indexes', () => {
    const state = makeFixture()
    const result = createPoliticalRight(state, {
      polityId,
      target: officeTarget,
      holder: { kind: 'house', id: houseId },
      grantedWeek: 100,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { state: s, right } = result.value
    expect(s.politicalRights[right.id]).toEqual(right)
    expect(s.nextPoliticalRightId).toBe(1)
    expect(s.politicalRightIndex.byPolity[polityId]).toEqual([right.id])
    expect(s.politicalRightIndex.byHolder[`house:${houseId}`]).toEqual([right.id])
    expect(s.politicalRightIndex.byTarget[politicalRightTargetKey(officeTarget)]).toEqual([
      right.id,
    ])
  })

  it('creates a personal right (holder.kind === person)', () => {
    const state = makeFixture()
    const result = createPoliticalRight(state, {
      polityId,
      target: regimentTarget,
      holder: { kind: 'person', id: personId },
      grantedWeek: 100,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.state.politicalRightIndex.byHolder[`person:${personId}`]).toEqual([
      result.value.right.id,
    ])
  })

  it('rejects a second right on the same target (1 target 1 active right)', () => {
    const state = makeFixture()
    const r1 = createPoliticalRight(state, {
      polityId,
      target: officeTarget,
      holder: { kind: 'house', id: houseId },
      grantedWeek: 100,
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = createPoliticalRight(r1.value.state, {
      polityId,
      target: officeTarget,
      holder: { kind: 'house', id: house2Id },
      grantedWeek: 101,
    })
    expect(r2.ok).toBe(false)
    if (r2.ok) return
    expect(r2.error.code).toBe('RIGHT_ALREADY_EXISTS')
  })

  it('rejects leader role as a target (§9.1)', () => {
    const state = makeFixture()
    const result = createPoliticalRight(state, {
      polityId,
      target: { kind: 'polity_office_role', polityId, role: 'leader', slotIndex: 0 },
      holder: { kind: 'house', id: houseId },
      grantedWeek: 100,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INVALID_RIGHT_TARGET')
  })

  it('rejects inactive polity / dead holder / mismatched target', () => {
    const base = makeFixture()

    const inactivePolity = {
      ...base,
      polities: {
        ...base.polities,
        [polityId]: { ...base.polities[polityId]!, active: false },
      },
    }
    expect(
      createPoliticalRight(inactivePolity, {
        polityId,
        target: officeTarget,
        holder: { kind: 'house', id: houseId },
        grantedWeek: 100,
      }).ok,
    ).toBe(false)

    const deadHolder = {
      ...base,
      persons: {
        ...base.persons,
        [personId]: { ...base.persons[personId]!, alive: false },
      },
    }
    expect(
      createPoliticalRight(deadHolder, {
        polityId,
        target: regimentTarget,
        holder: { kind: 'person', id: personId },
        grantedWeek: 100,
      }).ok,
    ).toBe(false)

    // 別 polity を polityId に指定した office target は不整合
    const otherPolityId = createPolityId('c', 9)
    const withOther = withPolity(base, otherPolityId, {})
    const mismatch = createPoliticalRight(withOther, {
      polityId: otherPolityId,
      target: officeTarget, // officeTarget.polityId === c-0
      holder: { kind: 'house', id: houseId },
      grantedWeek: 100,
    })
    expect(mismatch.ok).toBe(false)
  })

  it('rejects disbanded regiment target but accepts destroyed (§11)', () => {
    const base = makeFixture()
    const disbanded = {
      ...base,
      regiments: { [regimentId]: makeRegiment({ status: 'disbanded' as const }) },
    }
    expect(
      createPoliticalRight(disbanded, {
        polityId,
        target: regimentTarget,
        holder: { kind: 'house', id: houseId },
        grantedWeek: 100,
      }).ok,
    ).toBe(false)

    const destroyed = {
      ...base,
      regiments: { [regimentId]: makeRegiment({ status: 'destroyed' as const }) },
    }
    expect(
      createPoliticalRight(destroyed, {
        polityId,
        target: regimentTarget,
        holder: { kind: 'house', id: houseId },
        grantedWeek: 100,
      }).ok,
    ).toBe(true)
  })

  it('accepts a holding target whose terminal polity matches', () => {
    const state = makeFixture()
    const result = createPoliticalRight(state, {
      polityId,
      target: holdingTarget,
      holder: { kind: 'house', id: houseId },
      grantedWeek: 100,
    })
    expect(result.ok).toBe(true)
  })
})

describe('removePoliticalRight', () => {
  it('hard-deletes and purges empty index entries', () => {
    const state = makeFixture()
    const r = createPoliticalRight(state, {
      polityId,
      target: officeTarget,
      holder: { kind: 'house', id: houseId },
      grantedWeek: 100,
    })
    if (!r.ok) throw new Error('setup failed')
    const removed = removePoliticalRight(r.value.state, r.value.right.id)
    expect(removed.politicalRights[r.value.right.id]).toBeUndefined()
    expect(removed.politicalRightIndex.byPolity[polityId]).toBeUndefined()
    expect(removed.politicalRightIndex.byHolder[`house:${houseId}`]).toBeUndefined()
    expect(
      removed.politicalRightIndex.byTarget[politicalRightTargetKey(officeTarget)],
    ).toBeUndefined()
  })
})

describe('cascade helpers', () => {
  function makeStateWithThreeRights(): WorldState {
    const state = makeFixture()
    let current = state
    for (const [target, holder] of [
      [officeTarget, { kind: 'house', id: houseId }],
      [holdingTarget, { kind: 'house', id: houseId }],
      [regimentTarget, { kind: 'person', id: personId }],
    ] as const) {
      const r = createPoliticalRight(current, {
        polityId,
        target,
        holder,
        grantedWeek: 100,
      })
      if (!r.ok) throw new Error('setup failed: ' + r.error.message)
      current = r.value.state
    }
    return current
  }

  it('removeRightsByHolder removes only that holder rights', () => {
    const state = makeStateWithThreeRights()
    const afterHouse = removeRightsByHolder(state, { kind: 'house', id: houseId })
    expect(Object.keys(afterHouse.politicalRights)).toHaveLength(1)
    const afterPerson = removeRightsByHolder(afterHouse, { kind: 'person', id: personId })
    expect(Object.keys(afterPerson.politicalRights)).toHaveLength(0)
  })

  it('removeRightsByPolity removes all rights of the polity', () => {
    const state = makeStateWithThreeRights()
    const after = removeRightsByPolity(state, polityId)
    expect(Object.keys(after.politicalRights)).toHaveLength(0)
    expect(after.politicalRightIndex.byPolity[polityId]).toBeUndefined()
  })

  it('removeRightsByTarget removes only the targeted right', () => {
    const state = makeStateWithThreeRights()
    const after = removeRightsByTarget(state, regimentTarget)
    expect(Object.keys(after.politicalRights)).toHaveLength(2)
    expect(
      after.politicalRightIndex.byTarget[politicalRightTargetKey(regimentTarget)],
    ).toBeUndefined()
  })
})

describe('transferPoliticalRight', () => {
  it('moves holder and re-syncs byHolder index, keeping the same id', () => {
    const state = makeFixture()
    const r = createPoliticalRight(state, {
      polityId,
      target: officeTarget,
      holder: { kind: 'house', id: houseId },
      grantedWeek: 100,
    })
    if (!r.ok) throw new Error('setup failed')
    const t = transferPoliticalRight(r.value.state, r.value.right.id, {
      kind: 'house',
      id: house2Id,
    })
    expect(t.ok).toBe(true)
    if (!t.ok) return
    expect(t.value.right.id).toBe(r.value.right.id)
    expect(t.value.right.holder).toEqual({ kind: 'house', id: house2Id })
    expect(t.value.state.politicalRightIndex.byHolder[`house:${houseId}`]).toBeUndefined()
    expect(t.value.state.politicalRightIndex.byHolder[`house:${house2Id}`]).toEqual([
      r.value.right.id,
    ])
  })

  it('rejects transfer to a dead person', () => {
    const state = makeFixture()
    const r = createPoliticalRight(state, {
      polityId,
      target: officeTarget,
      holder: { kind: 'house', id: houseId },
      grantedWeek: 100,
    })
    if (!r.ok) throw new Error('setup failed')
    const withDead = {
      ...r.value.state,
      persons: {
        ...r.value.state.persons,
        [person2Id]: { ...r.value.state.persons[person2Id]!, alive: false },
      },
    }
    const t = transferPoliticalRight(withDead, r.value.right.id, {
      kind: 'person',
      id: person2Id,
    })
    expect(t.ok).toBe(false)
  })
})

describe('getPoliticalRightKindFromTarget', () => {
  it('derives kind from target kind', () => {
    expect(getPoliticalRightKindFromTarget(officeTarget)).toBe('polity_office_appointment')
    expect(getPoliticalRightKindFromTarget(holdingTarget)).toBe('holding_office_appointment')
    expect(getPoliticalRightKindFromTarget(regimentTarget)).toBe('regiment_control')
  })
})
