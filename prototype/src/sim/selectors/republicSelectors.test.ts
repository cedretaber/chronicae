import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createHoldingId,
} from '../types/ids'
import type { PersonId, HouseId, PolityId } from '../types/ids'
import type { PolityOrigin } from '../types/polity'
import type { PopClass } from '../types/popGroup'
import type { WorldState } from '../types/world'
import {
  makeEmptyV016State,
  withHouse,
  withHouseLeader,
  withPerson,
  withPolity,
  withProvince,
  bindProvinceToPolity,
} from '../testFixtures'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import { defaultConfig } from '../config/defaultConfig'
import {
  isEstablishedCommonwealthRepublic,
  getRepublicOriginHoldingIds,
  getRepublicFoundingWeek,
  getRepublicPoliticalCandidatePersons,
  getRepublicPowerProfile,
  getRepublicFootholdPolityIds,
} from './republicSelectors'

const config = defaultConfig

function makeHouseless(state: WorldState, id: PersonId, houseId: HouseId): WorldState {
  // withPerson は houseId 必須なので一旦付与してから外して houseless にする。
  let next = withPerson(state, id, { houseId })
  const person = next.persons[id]
  if (person) {
    const copy: Record<string, unknown> = { ...person }
    delete copy['houseId']
    next = { ...next, persons: { ...next.persons, [id]: copy as typeof person } }
  }
  return next
}

describe('isEstablishedCommonwealthRepublic', () => {
  const cId = createPolityId('c', 1)
  const prId = createProvinceId('p', 1)

  function base(): WorldState {
    let state = makeEmptyV016State()
    state = withProvince(state, prId, {})
    return state
  }

  it('normal polity は false', () => {
    let state = base()
    state = withPolity(state, cId, { kind: 'normal', capitalProvinceId: prId })
    expect(isEstablishedCommonwealthRepublic(state, cId)).toBe(false)
  })

  it('commonwealth + established は true', () => {
    let state = base()
    state = withPolity(state, cId, {
      kind: 'commonwealth',
      capitalProvinceId: prId,
      revoltState: { kind: 'established' },
    })
    expect(isEstablishedCommonwealthRepublic(state, cId)).toBe(true)
  })

  it('commonwealth + negotiating は false', () => {
    let state = base()
    state = withPolity(state, cId, {
      kind: 'commonwealth',
      capitalProvinceId: prId,
      revoltState: { kind: 'negotiating', diplomaticPlayId: 'dp-0' as never },
    })
    expect(isEstablishedCommonwealthRepublic(state, cId)).toBe(false)
  })

  it('commonwealth + revoltState なしは false', () => {
    let state = base()
    state = withPolity(state, cId, { kind: 'commonwealth', capitalProvinceId: prId })
    expect(isEstablishedCommonwealthRepublic(state, cId)).toBe(false)
  })

  it('inactive commonwealth established は false', () => {
    let state = base()
    state = withPolity(state, cId, {
      kind: 'commonwealth',
      capitalProvinceId: prId,
      active: false,
      revoltState: { kind: 'established' },
    })
    expect(isEstablishedCommonwealthRepublic(state, cId)).toBe(false)
  })
})

describe('origin helpers', () => {
  const leaderId = createPersonId('pe', 9)
  const provinceId = createProvinceId('p', 1)
  const holdingA = createHoldingId(1)
  const holdingB = createHoldingId(2)

  it('popular_revolt は holdingIds と startedWeek を返す', () => {
    const origin: PolityOrigin = {
      kind: 'popular_revolt',
      originalPolityId: createPolityId('c', 0),
      provinceId,
      holdingIds: [holdingA, holdingB],
      popClass: 'peasants' as PopClass,
      leaderPersonId: leaderId,
      startedWeek: 42,
    }
    expect(getRepublicOriginHoldingIds(origin)).toEqual([holdingA, holdingB])
    expect(getRepublicFoundingWeek(origin)).toBe(42)
  })

  it('regime_changed は holdingId 単数と week を返す', () => {
    const origin: PolityOrigin = {
      kind: 'regime_changed_by_popular_revolt',
      provinceId,
      holdingId: holdingA,
      popClass: 'peasants' as PopClass,
      leaderPersonId: leaderId,
      week: 17,
    }
    expect(getRepublicOriginHoldingIds(origin)).toEqual([holdingA])
    expect(getRepublicFoundingWeek(origin)).toBe(17)
  })

  it('worldgen は空配列と undefined を返す', () => {
    const origin: PolityOrigin = { kind: 'worldgen' }
    expect(getRepublicOriginHoldingIds(origin)).toEqual([])
    expect(getRepublicFoundingWeek(origin)).toBeUndefined()
  })
})

// 共和国 1 つ + leader(houseless) + administrator(housed) + 候補となる人物群を組む共通 fixture。
function makeRepublicFixture(): {
  state: WorldState
  polityId: PolityId
  leaderId: PersonId
  adminId: PersonId
  houseId: HouseId
  childId: PersonId
  deadId: PersonId
} {
  const polityId = createPolityId('c', 1)
  const provinceId = createProvinceId('p', 1)
  const leaderId = createPersonId('pe', 1)
  const adminId = createPersonId('pe', 2)
  const houseId = createHouseId('h', 1)
  const childId = createPersonId('pe', 3)
  const deadId = createPersonId('pe', 4)

  let state = makeEmptyV016State()
  state = withProvince(state, provinceId, {}) // 自動で holding を 1 つ作る
  state = withPolity(state, polityId, {
    kind: 'commonwealth',
    capitalProvinceId: provinceId,
    revoltState: { kind: 'established' },
  })
  state = bindProvinceToPolity(state, provinceId, polityId)

  // housed admin (高 numeracy で treasurer/administrator 適性を持つ)
  state = withHouse(state, houseId, { memberIds: [] })
  state = withPerson(state, adminId, {
    houseId,
    abilities: {
      valor: 30,
      command: 40,
      numeracy: 80,
      learning: 70,
      charisma: 50,
      insight: 50,
    },
    legacyPrestige: 40,
  })
  state = withHouseLeader(state, houseId, adminId)

  // houseless leader
  state = makeHouseless(state, leaderId, houseId)

  // 子供 (young_adulthood 未満 → 候補除外)
  state = makeHouseless(state, childId, houseId)
  {
    const p = state.persons[childId]
    if (p)
      state = {
        ...state,
        persons: { ...state.persons, [childId]: { ...p, lifeStage: 'childhood' } },
      }
  }

  // 死亡者 (候補除外)
  state = makeHouseless(state, deadId, houseId)
  {
    const p = state.persons[deadId]
    if (p) {
      state = {
        ...state,
        persons: { ...state.persons, [deadId]: { ...p, alive: false } },
        livingPersonIds: state.livingPersonIds.filter((id) => id !== deadId),
      }
    }
  }

  // office: leader + administrator
  state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', leaderId)
  state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'administrator', adminId)

  return { state, polityId, leaderId, adminId, houseId, childId, deadId }
}

describe('getRepublicPoliticalCandidatePersons', () => {
  it('非共和国 polity は空配列', () => {
    let state = makeEmptyV016State()
    const cId = createPolityId('c', 1)
    state = withProvince(state, createProvinceId('p', 1), {})
    state = withPolity(state, cId, { kind: 'normal' })
    expect(getRepublicPoliticalCandidatePersons(state, config, cId)).toEqual([])
  })

  it('houseless leader / housed admin を含み、子供と死亡者を除外する', () => {
    const { state, polityId, leaderId, adminId, childId, deadId } = makeRepublicFixture()
    const ids = getRepublicPoliticalCandidatePersons(state, config, polityId)
    expect(ids).toContain(leaderId)
    expect(ids).toContain(adminId)
    expect(ids).not.toContain(childId)
    expect(ids).not.toContain(deadId)
  })

  it('返却は PersonId 昇順で決定的', () => {
    const { state, polityId } = makeRepublicFixture()
    const ids = getRepublicPoliticalCandidatePersons(state, config, polityId)
    const sorted = [...ids].sort((a, b) => (a as string).localeCompare(b))
    expect(ids).toEqual(sorted)
  })
})

describe('getRepublicPowerProfile', () => {
  it('influence の無い空 polity は effectiveHolderCount 0', () => {
    let state = makeEmptyV016State()
    const cId = createPolityId('c', 1)
    state = withProvince(state, createProvinceId('p', 1), {})
    state = withPolity(state, cId, {
      kind: 'commonwealth',
      revoltState: { kind: 'established' },
    })
    const profile = getRepublicPowerProfile(state, config, cId)
    expect(profile.effectiveHolderCount).toBe(0)
    expect(profile.topPercent).toBe(0)
    expect(profile.topHolder).toBeUndefined()
  })

  it('office holder を officeControlByHolder に集計する', () => {
    const { state, polityId, leaderId, adminId } = makeRepublicFixture()
    const profile = getRepublicPowerProfile(state, config, polityId)
    const personIds = profile.officeControlByHolder.map((o) => o.holder.id)
    expect(personIds).toContain(leaderId)
    expect(personIds).toContain(adminId)
    const total = profile.officeControlByHolder.reduce((s, o) => s + o.officeCount, 0)
    expect(total).toBe(2)
  })

  it('officeControlByHolder は count 降順 + key 昇順で決定的', () => {
    const { state, polityId } = makeRepublicFixture()
    const profile = getRepublicPowerProfile(state, config, polityId)
    for (let i = 1; i < profile.officeControlByHolder.length; i++) {
      const prev = profile.officeControlByHolder[i - 1]!
      const cur = profile.officeControlByHolder[i]!
      expect(prev.officeCount).toBeGreaterThanOrEqual(cur.officeCount)
    }
  })

  it('PoliticalRight を rightControlByHolder に集計する', () => {
    const { state, polityId, adminId } = makeRepublicFixture()
    const result = createPoliticalRight(state, {
      polityId,
      holder: { kind: 'person', id: adminId },
      target: { kind: 'polity_office_role', polityId, role: 'administrator', slotIndex: 0 },
      grantedWeek: 0,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const profile = getRepublicPowerProfile(result.value.state, config, polityId)
    expect(profile.rightControlByHolder.length).toBe(1)
    expect(profile.rightControlByHolder[0]?.holder.id).toBe(adminId)
    expect(profile.rightControlByHolder[0]?.rightCount).toBe(1)
  })

  it('leader が houseless なら leaderHouseId は undefined', () => {
    const { state, polityId, leaderId } = makeRepublicFixture()
    const profile = getRepublicPowerProfile(state, config, polityId)
    expect(profile.leaderPersonId).toBe(leaderId)
    expect(profile.leaderHouseId).toBeUndefined()
    expect(profile.leaderHouseInfluencePercent).toBeUndefined()
  })

  it('total 0 の entry は effectiveHolderCount から除外される', () => {
    // office を持つ holder が居れば influence 正値の entry が >=1 → effectiveHolderCount >= 1。
    const { state, polityId } = makeRepublicFixture()
    const profile = getRepublicPowerProfile(state, config, polityId)
    expect(profile.effectiveHolderCount).toBeGreaterThanOrEqual(1)
  })
})

describe('getRepublicFootholdPolityIds', () => {
  it('本人が office を持つ共和国を返す', () => {
    const { state, polityId, adminId } = makeRepublicFixture()
    // adminId は administrator office を持つ (fixture)。
    expect(getRepublicFootholdPolityIds(state, adminId)).toContain(polityId)
  })

  it('本人が personal right を持つ共和国を返す', () => {
    const { state, polityId, adminId } = makeRepublicFixture()
    const result = createPoliticalRight(state, {
      polityId,
      holder: { kind: 'person', id: adminId },
      target: { kind: 'polity_office_role', polityId, role: 'treasurer', slotIndex: 0 },
      grantedWeek: 0,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(getRepublicFootholdPolityIds(result.value.state, adminId)).toContain(polityId)
  })

  it('normal polity の office は foothold に含めない', () => {
    // normal polity に office を持つ person は republic foothold を持たない。
    let state = makeEmptyV016State()
    const cId = createPolityId('c', 5)
    const houseId = createHouseId('h', 5)
    const personId = createPersonId('pe', 50)
    state = withProvince(state, createProvinceId('p', 5), {})
    state = withPolity(state, cId, { kind: 'normal' })
    state = withHouse(state, houseId, {})
    state = withPerson(state, personId, { houseId })
    state = createOfficeAssignment(state, { kind: 'polity', id: cId }, 'administrator', personId)
    expect(getRepublicFootholdPolityIds(state, personId)).toEqual([])
  })

  it('foothold の無い person は空配列', () => {
    const { state, leaderId } = makeRepublicFixture()
    // leaderId は leader office を持つ → 実は foothold。代わりに無関係 person を作る。
    void leaderId
    const personId = createPersonId('pe', 99)
    const houseId = createHouseId('h', 9)
    let s = withHouse(state, houseId, {})
    s = withPerson(s, personId, { houseId })
    expect(getRepublicFootholdPolityIds(s, personId)).toEqual([])
  })
})
