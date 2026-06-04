import { describe, expect, it } from 'vitest'
import {
  createProvinceId,
  createHoldingId,
  createPolityId,
  createHouseId,
  createPersonId,
} from '../types/ids'
import type { PersonId } from '../types/ids'
import type { EntityRef, DecisionSubjectRef } from '../types/goal'
import { makeEmptyV016State, withPolity, withHouse } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { aimSlotKey, computeAimCapacityForGoal } from './goalSelectors'

// v0.43 Aim 並列化: aimSlotKey は「生成側の候補除外」と「integrity の重複検査」が共有する
// 唯一のキー。両者が同じ (kind, target) に対して同じ文字列を返すこと、および異なる対象が
// 衝突しないことが、並列 Aim の正しさ (同一対象の二重 Aim 禁止) を担保する。
describe('aimSlotKey', () => {
  it('target ありは kind と target の両方でキーが分かれる', () => {
    const provA: EntityRef = { kind: 'province', id: createProvinceId('p', 1) }
    const provB: EntityRef = { kind: 'province', id: createProvinceId('p', 2) }
    // 同 kind・別 target → 別スロット (別々の province を並列に対象にできる)
    expect(aimSlotKey('develop_owned_holding', provA)).not.toBe(
      aimSlotKey('develop_owned_holding', provB),
    )
  })

  it('同 kind・同 target は同一キー (= 二重 Aim を弾く根拠)', () => {
    const holding: EntityRef = { kind: 'holding', id: createHoldingId(7) }
    expect(aimSlotKey('develop_owned_holding', holding)).toBe(
      aimSlotKey('develop_owned_holding', holding),
    )
  })

  it('同 target でも kind が違えば別スロット', () => {
    const polity: EntityRef = { kind: 'polity', id: createPolityId('c', 3) }
    expect(aimSlotKey('increase_polity_share', polity)).not.toBe(
      aimSlotKey('steer_polity_external_expansion', polity),
    )
  })

  it('target なし (例: patronize_artist) は kind のみがキー', () => {
    expect(aimSlotKey('patronize_artist')).toBe('patronize_artist')
    // target なし同士は同 kind なら衝突 → house は同種 prestige Aim を 2 つ並列に持てない
    expect(aimSlotKey('patronize_artist')).toBe(aimSlotKey('patronize_artist'))
    expect(aimSlotKey('patronize_artist')).not.toBe(aimSlotKey('commission_chronicle'))
  })

  it('target あり vs なしは衝突しない', () => {
    const polity: EntityRef = { kind: 'polity', id: createPolityId('c', 5) }
    expect(aimSlotKey('increase_polity_share', polity)).not.toBe(
      aimSlotKey('increase_polity_share'),
    )
  })
})

// v0.43 Aim 並列化: 並列上限は owner の規模/予算に連動する (小国は base、大国ほど ceiling まで)。
// defaultConfig: base=1, ceiling=4, treasuryPerSlot=300, membersPerSlot=6, wealthPerSlot=150。
describe('computeAimCapacityForGoal', () => {
  function members(n: number): PersonId[] {
    return Array.from({ length: n }, (_, i) => createPersonId('p', i))
  }

  it('小国 (province 0・treasury 0) は base のみ = 1', () => {
    const id = createPolityId('c', 1)
    const state = withPolity(makeEmptyV016State(), id, { treasury: 0 })
    const owner: DecisionSubjectRef = { kind: 'polity', id }
    expect(computeAimCapacityForGoal(state, defaultConfig, owner)).toBe(1)
  })

  it('予算が増えるほど枠が増え ceiling でクランプ (treasury 600 → 3, 1500 → 4)', () => {
    const id = createPolityId('c', 2)
    const owner: DecisionSubjectRef = { kind: 'polity', id }
    const rich = withPolity(makeEmptyV016State(), id, { treasury: 600 })
    expect(computeAimCapacityForGoal(rich, defaultConfig, owner)).toBe(3) // 1 + floor(600/300)
    const richer = withPolity(makeEmptyV016State(), id, { treasury: 1500 })
    expect(computeAimCapacityForGoal(richer, defaultConfig, owner)).toBe(4) // clamp(1+5, 1, 4)
  })

  it('家は member 数と wealth で枠が増える', () => {
    const id = createHouseId('h', 1)
    const owner: DecisionSubjectRef = { kind: 'house', id }
    const small = withHouse(makeEmptyV016State(), id, { memberIds: members(3), wealth: 0 })
    expect(computeAimCapacityForGoal(small, defaultConfig, owner)).toBe(1)
    const big = withHouse(makeEmptyV016State(), id, { memberIds: members(12), wealth: 300 })
    // 1 + floor(12/6) + floor(300/150) = 1 + 2 + 2 = 5 → clamp 4
    expect(computeAimCapacityForGoal(big, defaultConfig, owner)).toBe(4)
  })

  it('ceiling=1 で並列無効化 (旧挙動: 常に 1)', () => {
    const id = createPolityId('c', 3)
    const owner: DecisionSubjectRef = { kind: 'polity', id }
    const state = withPolity(makeEmptyV016State(), id, { treasury: 9999 })
    const cfg = { ...defaultConfig, aimParallelismCeiling: 1 }
    expect(computeAimCapacityForGoal(state, cfg, owner)).toBe(1)
  })
})
