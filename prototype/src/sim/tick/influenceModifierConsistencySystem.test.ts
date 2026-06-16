// v0.51 InfluenceModifierConsistencySystem のユニットテスト (陰謀リファイン §2.4)。
// - 期限切れ modifier が削除される
// - target (house 絶家 / person 死亡) 消滅 modifier が削除される
// - polity inactive modifier が削除される
// - 整合した modifier は残る
// - 回収後の state が年末 integrity を通る

import { describe, expect, it } from 'vitest'
import { createPersonId, createHouseId, createPolityId, createProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { addInfluenceModifier } from '../mutations/influenceModifierMutations'
import { runInfluenceModifierConsistencySystem } from './influenceModifierConsistencySystem'
import { checkInfluenceModifiers } from './integrityInfluenceModifierChecks'
import type { SimError } from '../mutations/errors'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
} from '../testFixtures'

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

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

function add(s: WorldState, opts: { target: 'house' | 'person'; expiryWeek?: number }): WorldState {
  const res = addInfluenceModifier(s, {
    polityId,
    target:
      opts.target === 'house' ? { kind: 'house', id: houseId } : { kind: 'person', id: personId },
    delta: -10,
    causeKind: 'conspiracy_undermine',
    grantedWeek: 0,
    ...(opts.expiryWeek !== undefined ? { expiryWeek: opts.expiryWeek } : {}),
  })
  if (!res.ok) throw new Error('add failed')
  return res.value.state
}

describe('runInfluenceModifierConsistencySystem', () => {
  it('removes an expired modifier', () => {
    let s = add(makeFixture(), { target: 'house', expiryWeek: 50 })
    s = { ...s, absoluteWeek: 60 }
    const after = runInfluenceModifierConsistencySystem(makeCtx(s)).state
    expect(Object.keys(after.influenceModifiers).length).toBe(0)
    expect(after.influenceModifierIndex.byPolity[polityId]).toBeUndefined()
  })

  it('keeps a still-active modifier', () => {
    let s = add(makeFixture(), { target: 'house', expiryWeek: 100 })
    s = { ...s, absoluteWeek: 60 }
    const after = runInfluenceModifierConsistencySystem(makeCtx(s)).state
    expect(Object.keys(after.influenceModifiers).length).toBe(1)
  })

  it('removes a modifier whose target house went inactive', () => {
    let s = add(makeFixture(), { target: 'house' })
    s = { ...s, houses: { ...s.houses, [houseId]: { ...s.houses[houseId]!, active: false } } }
    const after = runInfluenceModifierConsistencySystem(makeCtx(s)).state
    expect(Object.keys(after.influenceModifiers).length).toBe(0)
  })

  it('removes a modifier whose polity went inactive', () => {
    let s = add(makeFixture(), { target: 'person' })
    s = {
      ...s,
      polities: { ...s.polities, [polityId]: { ...s.polities[polityId]!, active: false } },
    }
    const after = runInfluenceModifierConsistencySystem(makeCtx(s)).state
    expect(Object.keys(after.influenceModifiers).length).toBe(0)
  })

  it('leaves a clean integrity after sweep', () => {
    let s = add(makeFixture(), { target: 'house', expiryWeek: 50 })
    s = { ...s, absoluteWeek: 60 }
    const after = runInfluenceModifierConsistencySystem(makeCtx(s)).state
    const errors: SimError[] = []
    checkInfluenceModifiers(after, errors)
    expect(errors).toEqual([])
  })
})
