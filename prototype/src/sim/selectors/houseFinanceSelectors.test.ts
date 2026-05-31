import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId } from '../types/ids'
import { makeEmptyV016State, withHouse, withPolity, withPerson } from '../testFixtures'
import { createOrganizationShare } from '../mutations/shareMutations'
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

describe('getHouseProjectedAnnualIncome', () => {
  it('share を持たない家は 0', () => {
    const houseId = createHouseId('h', 0)
    let state = makeEmptyV016State()
    state = withHouse(state, houseId)
    expect(getHouseProjectedAnnualIncome(state, houseId)).toBe(0)
  })

  it('単独 share holder: annual = (treasury-50)×0.15×12', () => {
    const houseId = createHouseId('h', 0)
    const polityId = createPolityId('c', 0)
    let state = makeEmptyV016State()
    state = withHouse(state, houseId)
    state = withPolity(state, polityId, { treasury: 200 })
    state = createOrganizationShare(
      state,
      { kind: 'polity', id: polityId },
      { kind: 'house', id: houseId },
      10,
    )
    // distributable = (200-50)*0.15 = 22.5 ; pct=1.0 ; annual = 22.5*12 = 270
    expect(getHouseProjectedAnnualIncome(state, houseId)).toBeCloseTo(270, 6)
  })

  it('treasury が reserveTarget 以下なら収入 0', () => {
    const houseId = createHouseId('h', 0)
    const polityId = createPolityId('c', 0)
    let state = makeEmptyV016State()
    state = withHouse(state, houseId)
    state = withPolity(state, polityId, { treasury: 40 })
    state = createOrganizationShare(
      state,
      { kind: 'polity', id: polityId },
      { kind: 'house', id: houseId },
      10,
    )
    expect(getHouseProjectedAnnualIncome(state, houseId)).toBe(0)
  })

  it('share 比例: 他 holder がいると割合で按分される', () => {
    const houseId = createHouseId('h', 0)
    const personId = createPersonId('pe', 9)
    const polityId = createPolityId('c', 0)
    let state = makeEmptyV016State()
    state = withHouse(state, houseId)
    state = withPolity(state, polityId, { treasury: 200 })
    const ref = { kind: 'polity', id: polityId } as const
    state = createOrganizationShare(state, ref, { kind: 'house', id: houseId }, 6)
    state = createOrganizationShare(state, ref, { kind: 'person', id: personId }, 4)
    // total rawPower=10, house pct=0.6 ; distributable=22.5 ; annual=0.6*22.5*12=162
    expect(getHouseProjectedAnnualIncome(state, houseId)).toBeCloseTo(162, 6)
  })
})

describe('getHouseProjectedAnnualBalance', () => {
  it('収入 − 役職給与', () => {
    const houseId = createHouseId('h', 0)
    const polityId = createPolityId('c', 0)
    const p1 = createPersonId('pe', 1)
    let state = makeEmptyV016State()
    state = withHouse(state, houseId)
    state = withPerson(state, p1, { houseId })
    state = withPolity(state, polityId, { treasury: 200 })
    state = createOrganizationShare(
      state,
      { kind: 'polity', id: polityId },
      { kind: 'house', id: houseId },
      10,
    )
    state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'administrator', p1)
    // income 270 - salary 10 = 260
    expect(getHouseProjectedAnnualBalance(state, houseId)).toBeCloseTo(260, 6)
  })
})
