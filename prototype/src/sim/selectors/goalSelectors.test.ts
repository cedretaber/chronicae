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
import {
  makeEmptyV016State,
  withPolity,
  withHouse,
  withPerson,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import {
  aimSlotKey,
  computeAimCapacityForGoal,
  isPolityRoleEligibleCandidate,
  selectMovementBeneficiary,
  scoreHouseGoalKind,
} from './goalSelectors'
import { createHouseShare } from '../mutations/shareMutations'

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
    expect(aimSlotKey('steer_polity_internal_development', polity)).not.toBe(
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
    expect(aimSlotKey('steer_polity_external_expansion', polity)).not.toBe(
      aimSlotKey('steer_polity_external_expansion'),
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

// 影響力個人中心化 Phase 2: 役職適格ゲート + 運動 beneficiary 選定
describe('isPolityRoleEligibleCandidate + selectMovementBeneficiary (Phase 2)', () => {
  const polityId = createPolityId('c', 0)
  const houseId = createHouseId('h', 0)
  const provinceId = createProvinceId('p', 0)
  const adultM = createPersonId('pe', 1)
  const adultM2 = createPersonId('pe', 2)

  function base() {
    let s = makeEmptyV016State()
    s = withProvince(s, provinceId, { nameKey: 'P0' })
    s = withHouse(s, houseId, { nameKey: 'H0', wealth: 100, memberIds: [adultM, adultM2] })
    s = withPerson(s, adultM, { nameKey: 'A', houseId, age: 40 })
    s = withPerson(s, adultM2, { nameKey: 'B', houseId, age: 35 })
    s = withPolity(s, polityId, { ownerHouseId: houseId, capitalProvinceId: provinceId })
    s = bindProvinceToHouseViaPolity(s, provinceId, polityId, houseId)
    return s
  }

  it('owner house の生存成人男性は役職適格', () => {
    const s = base()
    expect(isPolityRoleEligibleCandidate(s, defaultConfig, adultM, polityId)).toBe(true)
  })

  it('foothold の無い polity では不適格', () => {
    const s = base()
    const other = createPolityId('c', 9)
    expect(isPolityRoleEligibleCandidate(s, defaultConfig, adultM, other)).toBe(false)
  })

  it('子供 (young_adulthood 未満) は不適格', () => {
    let s = base()
    s = withPerson(s, adultM, { nameKey: 'A', houseId, age: 8, lifeStage: 'childhood' })
    expect(isPolityRoleEligibleCandidate(s, defaultConfig, adultM, polityId)).toBe(false)
  })

  it('selectMovementBeneficiary は適格メンバーから決定的に 1 人選ぶ', () => {
    const s = base()
    const chosen = selectMovementBeneficiary(s, defaultConfig, houseId, polityId)
    expect(chosen).toBeDefined()
    expect([adultM, adultM2]).toContain(chosen)
  })

  it('適格メンバーが居なければ undefined', () => {
    let s = base()
    // 全員 childhood にする
    s = withPerson(s, adultM, { nameKey: 'A', houseId, age: 8, lifeStage: 'childhood' })
    s = withPerson(s, adultM2, { nameKey: 'B', houseId, age: 6, lifeStage: 'childhood' })
    expect(selectMovementBeneficiary(s, defaultConfig, houseId, polityId)).toBeUndefined()
  })
})

// 影響力個人中心化 Phase 3b: 家 goal scoring に意志決定者の性格を反映
describe('scoreHouseGoalKind: decisionMaker personality (Phase 3b)', () => {
  const houseId = createHouseId('h', 0)
  const dm = createPersonId('pe', 0)

  function withDecisionMaker(ambition: number, caution: number) {
    let s = makeEmptyV016State()
    s = withHouse(s, houseId, { nameKey: 'H', memberIds: [dm], wealth: 50 })
    s = withPerson(s, dm, { nameKey: 'DM', houseId, traits: { ambition, caution } })
    s = createHouseShare(s, houseId, dm, 50) // 支配 share holder = 意志決定者
    return s
  }

  function scoreOf(state: ReturnType<typeof withDecisionMaker>, kind: string): number {
    return scoreHouseGoalKind(state, defaultConfig, houseId).find((g) => g.kind === kind)!.score
  }

  it('高 ambition の意志決定者は expand_power_base を押し上げる', () => {
    const high = scoreOf(withDecisionMaker(1.0, 0.5), 'expand_power_base')
    const low = scoreOf(withDecisionMaker(0.0, 0.5), 'expand_power_base')
    expect(high).toBeGreaterThan(low)
  })

  it('高 caution の意志決定者は preserve_power_base を押し上げる', () => {
    const high = scoreOf(withDecisionMaker(0.5, 1.0), 'preserve_power_base')
    const low = scoreOf(withDecisionMaker(0.5, 0.0), 'preserve_power_base')
    expect(high).toBeGreaterThan(low)
  })

  it('personAbilityEffectsEnabled=false で性格効果は無効', () => {
    const state = withDecisionMaker(1.0, 0.0)
    const cfg = { ...defaultConfig, personAbilityEffectsEnabled: false }
    const enabled = scoreHouseGoalKind(state, defaultConfig, houseId).find(
      (g) => g.kind === 'expand_power_base',
    )!.score
    const disabled = scoreHouseGoalKind(state, cfg, houseId).find(
      (g) => g.kind === 'expand_power_base',
    )!.score
    expect(enabled).not.toBe(disabled)
  })
})
