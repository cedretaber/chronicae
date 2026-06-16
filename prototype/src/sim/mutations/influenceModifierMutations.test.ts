// v0.51 InfluenceModifier mutation のユニットテスト (陰謀リファイン §2.2)。
// - add / remove / removeMut
// - index 2 系統 (byPolity / byTarget) の整合と空エントリ purge
// - polity inactive / target 不在の拒否

import { describe, expect, it } from 'vitest'
import { createPersonId, createHouseId, createPolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import { influenceModifierTargetKey } from '../types/influenceModifier'
import {
  addInfluenceModifier,
  removeInfluenceModifier,
  removeInfluenceModifierMut,
} from './influenceModifierMutations'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
} from '../testFixtures'
import { createProvinceId } from '../types/ids'

const polityId = createPolityId('c', 0)
const houseId = createHouseId('h', 0)
const personId = createPersonId('pe', 0)
const provinceId = createProvinceId('p', 0)

function makeFixture(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, provinceId)
  s = withHouse(s, houseId)
  s = withPerson(s, personId, { houseId })
  s = withPolity(s, polityId, { ownerHouseId: houseId })
  return s
}

describe('addInfluenceModifier', () => {
  it('registers a modifier and updates both indexes', () => {
    const s = makeFixture()
    const res = addInfluenceModifier(s, {
      polityId,
      target: { kind: 'house', id: houseId },
      delta: -30,
      causeKind: 'conspiracy_undermine',
      sourcePersonId: personId,
      grantedWeek: 10,
      expiryWeek: 166,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const { state, modifier } = res.value
    expect(modifier.delta).toBe(-30)
    expect(modifier.causeKind).toBe('conspiracy_undermine')
    expect(state.nextInfluenceModifierId).toBe(1)
    expect(state.influenceModifiers[modifier.id]).toBeDefined()
    expect(state.influenceModifierIndex.byPolity[polityId]).toContain(modifier.id)
    const tKey = influenceModifierTargetKey({ kind: 'house', id: houseId })
    expect(state.influenceModifierIndex.byTarget[tKey]).toContain(modifier.id)
  })

  it('omits optional fields when not provided', () => {
    const s = makeFixture()
    const res = addInfluenceModifier(s, {
      polityId,
      target: { kind: 'person', id: personId },
      delta: 20,
      causeKind: 'favor',
      grantedWeek: 5,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.modifier.sourcePersonId).toBeUndefined()
    expect(res.value.modifier.expiryWeek).toBeUndefined()
  })

  it('rejects inactive polity', () => {
    const s = makeFixture()
    const dead = {
      ...s,
      polities: { ...s.polities, [polityId]: { ...s.polities[polityId]!, active: false } },
    }
    const res = addInfluenceModifier(dead, {
      polityId,
      target: { kind: 'house', id: houseId },
      delta: -10,
      causeKind: 'conspiracy_undermine',
      grantedWeek: 1,
    })
    expect(res.ok).toBe(false)
  })

  it('rejects missing target house', () => {
    const s = makeFixture()
    const res = addInfluenceModifier(s, {
      polityId,
      target: { kind: 'house', id: createHouseId('h', 99) },
      delta: -10,
      causeKind: 'conspiracy_undermine',
      grantedWeek: 1,
    })
    expect(res.ok).toBe(false)
  })
})

describe('removeInfluenceModifier', () => {
  it('hard-deletes and purges empty index entries', () => {
    const s = makeFixture()
    const res = addInfluenceModifier(s, {
      polityId,
      target: { kind: 'house', id: houseId },
      delta: -30,
      causeKind: 'conspiracy_undermine',
      grantedWeek: 10,
    })
    if (!res.ok) return
    const id = res.value.modifier.id
    const after = removeInfluenceModifier(res.value.state, id)
    expect(after.influenceModifiers[id]).toBeUndefined()
    expect(after.influenceModifierIndex.byPolity[polityId]).toBeUndefined()
    const tKey = influenceModifierTargetKey({ kind: 'house', id: houseId })
    expect(after.influenceModifierIndex.byTarget[tKey]).toBeUndefined()
  })

  it('removeInfluenceModifierMut mutates draft in place', () => {
    const s = makeFixture()
    const res = addInfluenceModifier(s, {
      polityId,
      target: { kind: 'house', id: houseId },
      delta: -30,
      causeKind: 'conspiracy_undermine',
      grantedWeek: 10,
    })
    if (!res.ok) return
    const draft = { ...res.value.state }
    removeInfluenceModifierMut(draft, res.value.modifier.id)
    expect(draft.influenceModifiers[res.value.modifier.id]).toBeUndefined()
    expect(draft.influenceModifierIndex.byPolity[polityId]).toBeUndefined()
  })
})
