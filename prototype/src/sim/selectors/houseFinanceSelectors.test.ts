import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import {
  makeEmptyV016State,
  withHouse,
  withPolity,
  withPerson,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createOfficeAssignment } from '../mutations/officeMutations'
import {
  getHouseProjectedAnnualIncome,
  getHouseAnnualOfficeSalary,
  getHouseProjectedAnnualBalance,
} from './houseFinanceSelectors'

// PolitySurplus 定数 (landContractConfig): reserveBase=50, perHolding=50, rate=0.15
// holdingCount=0 (province 未束縛) なので reserveTarget=50。
// 分配は年 12 回 → annual = sharePct × max(0, treasury-50)×0.15 × 12

describe('getHouseAnnualOfficeSalary', () => {
  it('役職を持たない家は 0', () => {
    const houseId = createHouseId('h', 0)
    let state = makeEmptyV016State()
    state = withHouse(state, houseId)
    expect(getHouseAnnualOfficeSalary(state, houseId)).toBe(0)
  })

  it('有給役職フルセットは 10+10+10+5=35', () => {
    const houseId = createHouseId('h', 0)
    const p1 = createPersonId('pe', 1)
    const p2 = createPersonId('pe', 2)
    const p3 = createPersonId('pe', 3)
    const p4 = createPersonId('pe', 4)
    let state = makeEmptyV016State()
    state = withHouse(state, houseId)
    state = withPerson(state, p1, { houseId })
    state = withPerson(state, p2, { houseId })
    state = withPerson(state, p3, { houseId })
    state = withPerson(state, p4, { houseId })
    const ref = { kind: 'house', id: houseId } as const
    state = createOfficeAssignment(state, ref, 'administrator', p1)
    state = createOfficeAssignment(state, ref, 'treasurer', p2)
    state = createOfficeAssignment(state, ref, 'military', p3)
    state = createOfficeAssignment(state, ref, 'advisor', p4)
    expect(getHouseAnnualOfficeSalary(state, houseId)).toBe(35)
  })
})

// v0.42 §19.2: share 比例 → influence 比例の投影。
// 土地で polity に関与する家だけが収入投影を持つ (getHousePolityIds 走査)。
describe('getHouseProjectedAnnualIncome', () => {
  it('polity に関与しない家は 0', () => {
    const houseId = createHouseId('h', 0)
    let state = makeEmptyV016State()
    state = withHouse(state, houseId)
    expect(getHouseProjectedAnnualIncome(state, houseId)).toBe(0)
  })

  it('単独 influence holder: annual = (treasury - reserve)×0.15×12 の全額', () => {
    const houseId = createHouseId('h', 0)
    const polityId = createPolityId('c', 0)
    const provinceId = createProvinceId('p', 0)
    let state = makeEmptyV016State()
    state = withProvince(state, provinceId)
    state = withHouse(state, houseId, { seatProvinceId: provinceId })
    state = withPolity(state, polityId, { treasury: 300, ownerHouseId: houseId })
    state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
    // 唯一の House entry → influence 100%。
    // holdingCount=1 → reserveTarget = 50 + 50 = 100; distributable = (300-100)*0.15 = 30
    // annual = 30 × 12 = 360
    expect(getHouseProjectedAnnualIncome(state, houseId)).toBeCloseTo(360, 6)
  })

  it('treasury が reserveTarget 以下なら収入 0', () => {
    const houseId = createHouseId('h', 0)
    const polityId = createPolityId('c', 0)
    const provinceId = createProvinceId('p', 0)
    let state = makeEmptyV016State()
    state = withProvince(state, provinceId)
    state = withHouse(state, houseId, { seatProvinceId: provinceId })
    state = withPolity(state, polityId, { treasury: 40, ownerHouseId: houseId })
    state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
    expect(getHouseProjectedAnnualIncome(state, houseId)).toBe(0)
  })

  it('influence 比例: 他の influence holder がいると割合で按分される', () => {
    // 注: 投影の走査対象は土地で関与する polity (getHousePolityIds)。office のみの家 (B) の
    // 取り分は投影に乗らない (過小評価側に倒す設計) が、A の取り分は B の influence 分だけ
    // 100% から目減りする — その按分を検証する。
    const houseAId = createHouseId('h', 0)
    const houseBId = createHouseId('h', 1)
    const officerBId = createPersonId('pe', 8)
    const polityId = createPolityId('c', 0)
    const provinceAId = createProvinceId('p', 0)
    let state = makeEmptyV016State()
    state = withProvince(state, provinceAId)
    state = withHouse(state, houseAId, { seatProvinceId: provinceAId })
    state = withHouse(state, houseBId, { seatProvinceId: provinceAId })
    state = withPerson(state, officerBId, { houseId: houseBId })
    state = withPolity(state, polityId, { treasury: 300, ownerHouseId: houseAId })
    state = bindProvinceToHouseViaPolity(state, provinceAId, polityId, houseAId)
    const soleIncome = getHouseProjectedAnnualIncome(state, houseAId)
    // B の member を polity office に就けると B の influence entry が立ち、A の percent が下がる
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      officerBId,
    )
    const sharedIncomeA = getHouseProjectedAnnualIncome(state, houseAId)
    expect(soleIncome).toBeCloseTo(360, 6)
    expect(sharedIncomeA).toBeLessThan(soleIncome)
    expect(sharedIncomeA).toBeGreaterThan(0)
  })
})

describe('getHouseProjectedAnnualBalance', () => {
  it('収入 − 役職給与', () => {
    const houseId = createHouseId('h', 0)
    const polityId = createPolityId('c', 0)
    const provinceId = createProvinceId('p', 0)
    const p1 = createPersonId('pe', 1)
    let state = makeEmptyV016State()
    state = withProvince(state, provinceId)
    state = withHouse(state, houseId, { seatProvinceId: provinceId })
    state = withPerson(state, p1, { houseId })
    state = withPolity(state, polityId, { treasury: 300, ownerHouseId: houseId })
    state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
    state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'administrator', p1)
    // income 360 - salary 10 = 350
    expect(getHouseProjectedAnnualBalance(state, houseId)).toBeCloseTo(350, 6)
  })
})
