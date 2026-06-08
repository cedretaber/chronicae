// 影響力個人中心化 Phase 4: 死亡時継承 (国回収 vs 家産化) のテスト。

import { describe, expect, it } from 'vitest'
import { createHouseId, createPolityId, createPersonId, createProvinceId } from '../types/ids'
import type { HouseId, PoliticalRightId } from '../types/ids'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createPoliticalRight } from './politicalRightMutations'
import { markPersonDeadWithInheritance } from './politicalRightInheritance'
import { getRightsByHolder } from '../selectors/politicalRightSelectors'

const polityId = createPolityId('c', 0)
const ownerHouseId = createHouseId('h', 0)
const otherHouseId = createHouseId('h', 1)
const provinceId = createProvinceId('p', 0)
const deadPerson = createPersonId('pe', 5)

const noFlip = { ...defaultConfig, rightInheritanceFlipChance: 0 }
const alwaysFlip = { ...defaultConfig, rightInheritanceFlipChance: 1 }

// 死亡者が polity_office_role right を person 保有している状態を作る。
function makeRightState(opts: { hasOwner: boolean; deadHouseId: HouseId | undefined }): {
  state: WorldState
  rightId: PoliticalRightId
} {
  let s = makeEmptyV016State()
  s = withProvince(s, provinceId, { nameKey: 'P0' })
  s = withHouse(s, ownerHouseId, { nameKey: 'Owner', seatProvinceId: provinceId })
  s = withHouse(s, otherHouseId, { nameKey: 'Other', seatProvinceId: provinceId })
  s = withPolity(
    s,
    polityId,
    opts.hasOwner
      ? { ownerHouseId, capitalProvinceId: provinceId }
      : { capitalProvinceId: provinceId },
  )
  if (opts.hasOwner) s = bindProvinceToHouseViaPolity(s, provinceId, polityId, ownerHouseId)
  // まず家つきで生成し、houseless ケースでは houseId を外す (withPerson は houseId 必須のため)
  s = withPerson(s, deadPerson, {
    nameKey: 'Dead',
    houseId: opts.deadHouseId ?? otherHouseId,
    age: 50,
  })
  if (opts.deadHouseId === undefined) {
    s = {
      ...s,
      persons: { ...s.persons, [deadPerson]: { ...s.persons[deadPerson]!, houseId: undefined } },
    }
  }
  const created = createPoliticalRight(s, {
    polityId,
    target: { kind: 'polity_office_role', polityId, role: 'administrator', slotIndex: 0 },
    holder: { kind: 'person', id: deadPerson },
    grantedWeek: s.absoluteWeek,
  })
  if (!created.ok) throw new Error('setup failed: ' + created.error.message)
  return { state: created.value.state, rightId: created.value.right.id }
}

describe('resolveRightInheritanceOnDeath (Phase 4)', () => {
  it('houseless 死亡 → 国回収 (right 削除)', () => {
    const { state, rightId } = makeRightState({ hasOwner: true, deadHouseId: undefined })
    const result = markPersonDeadWithInheritance(state, noFlip, deadPerson)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.politicalRights[rightId]).toBeUndefined()
  })

  it('死亡者家 == owner 家 → 家産化 (holder=house)', () => {
    const { state, rightId } = makeRightState({ hasOwner: true, deadHouseId: ownerHouseId })
    const result = markPersonDeadWithInheritance(state, noFlip, deadPerson)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const right = result.value.politicalRights[rightId]
    expect(right).toBeDefined()
    expect(right!.holder).toEqual({ kind: 'house', id: ownerHouseId })
  })

  it('commonwealth + 死亡者家が右保有で influence 100% → 家産化', () => {
    // commonwealth (owner なし)。死亡者家 = otherHouse が right 保有 (唯一の entry → 100% >= 20)
    const { state, rightId } = makeRightState({ hasOwner: false, deadHouseId: otherHouseId })
    const result = markPersonDeadWithInheritance(state, noFlip, deadPerson)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const right = result.value.politicalRights[rightId]
    expect(right).toBeDefined()
    expect(right!.holder).toEqual({ kind: 'house', id: otherHouseId })
  })

  it('強い owner (owner家% >= 70) → 国回収', () => {
    // ownerHouse は owner bonus 30 + land、死亡者家 = otherHouse は right(office 2) のみ
    // → ownerHouse% >> 70 → 国回収
    const { state, rightId } = makeRightState({ hasOwner: true, deadHouseId: otherHouseId })
    const result = markPersonDeadWithInheritance(state, noFlip, deadPerson)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.politicalRights[rightId]).toBeUndefined()
  })

  it('flip (alwaysFlip) は家産化を国回収に反転する', () => {
    // owner家同一は flip skip なので、commonwealth 家産化ケースで flip を効かせる
    const { state, rightId } = makeRightState({ hasOwner: false, deadHouseId: otherHouseId })
    const result = markPersonDeadWithInheritance(state, alwaysFlip, deadPerson)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // alwaysFlip で inherit→seize 反転 → right 削除
    expect(result.value.politicalRights[rightId]).toBeUndefined()
  })

  it('flip は決定論的 (同 config で再実行すると同結果)', () => {
    const a = makeRightState({ hasOwner: false, deadHouseId: otherHouseId })
    const b = makeRightState({ hasOwner: false, deadHouseId: otherHouseId })
    const ra = markPersonDeadWithInheritance(a.state, defaultConfig, deadPerson)
    const rb = markPersonDeadWithInheritance(b.state, defaultConfig, deadPerson)
    expect(ra.ok && rb.ok).toBe(true)
    if (!ra.ok || !rb.ok) return
    const presentA = ra.value.politicalRights[a.rightId] !== undefined
    const presentB = rb.value.politicalRights[b.rightId] !== undefined
    expect(presentA).toBe(presentB)
  })

  it('person 保有 right を持たない死亡は通常死 (継承処理 no-op)', () => {
    let s = makeEmptyV016State()
    s = withHouse(s, ownerHouseId, { nameKey: 'H', memberIds: [deadPerson] })
    s = withPerson(s, deadPerson, { nameKey: 'D', houseId: ownerHouseId, age: 50 })
    const result = markPersonDeadWithInheritance(s, noFlip, deadPerson)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.persons[deadPerson]!.alive).toBe(false)
    expect(getRightsByHolder(result.value, { kind: 'person', id: deadPerson })).toHaveLength(0)
  })
})
