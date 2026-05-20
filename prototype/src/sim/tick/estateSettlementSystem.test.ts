import { describe, expect, it } from 'vitest'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { findHeirs, runEstateSettlementSystem } from './estateSettlementSystem'
import { collectIntegrityErrors } from './integritySystem'
import { createOfficeAssignmentId } from '../types/ids'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPolity,
  withProvince,
} from '../testFixtures'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeBaseState(): {
  state: WorldState
  houseId: HouseId
  polityId: PolityId
  provinceId: ProvinceId
} {
  const houseId = 'dh-0' as HouseId
  const polityId = 'dp-0' as PolityId
  const provinceId = 'dp-pr-0' as ProvinceId
  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 75088 }
  state = withProvince(state, provinceId, { name: 'Province0' })
  state = withHouse(state, houseId, {
    name: 'House',
    legacyPrestige: 50,
    seatProvinceId: provinceId,
  })
  state = withPolity(state, polityId, {
    name: 'Kingdom',
    ownerHouseId: houseId,
    treasury: 500,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  return { state, houseId, polityId, provinceId }
}

function makeCtx(state: WorldState, deathsThisTick: PersonId[] = []): TickContext {
  return {
    state,
    rng: createRng('estate-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick,
    deathRolesThisTick: {},
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
  }
}

function makePerson(
  id: PersonId,
  houseId: HouseId,
  overrides: Partial<import('../types/person').Person> = {},
): import('../types/person').Person {
  return {
    id,
    name: 'Person',
    sex: 'male' as const,
    age: 40,
    alive: true,
    houseId,
    childIds: [],
    birthStatus: 'unknown' as const,
    abilities: { ...DEFAULT_ABILITIES },
    aptitudes: { ...DEFAULT_ABILITIES },
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
    ...overrides,
  }
}

describe('findHeirs', () => {
  it('returns legitimate children sorted by age descending', () => {
    const { state, houseId } = makeBaseState()
    const child1Id = 'pe-0' as PersonId
    const child2Id = 'pe-1' as PersonId
    const deceasedId = 'pe-2' as PersonId

    state.persons[child1Id] = makePerson(child1Id, houseId, {
      age: 20,
      alive: true,
      birthStatus: 'legitimate',
      childIds: [],
    })
    state.persons[child2Id] = makePerson(child2Id, houseId, {
      age: 15,
      alive: true,
      birthStatus: 'legitimate',
      childIds: [],
    })
    state.persons[deceasedId] = makePerson(deceasedId, houseId, {
      age: 45,
      alive: false,
      childIds: [child1Id, child2Id],
      birthStatus: 'legitimate',
    })
    state.houses[houseId]!.memberIds = [child1Id, child2Id, deceasedId]

    const heirs = findHeirs(state, deceasedId)
    expect(heirs).toEqual([child1Id, child2Id])
  })

  it('skips illegitimate child and returns spouse', () => {
    const { state, houseId } = makeBaseState()
    const childId = 'pe-0' as PersonId
    const spouseId = 'pe-1' as PersonId
    const deceasedId = 'pe-2' as PersonId

    state.persons[childId] = makePerson(childId, houseId, {
      age: 20,
      alive: true,
      birthStatus: 'illegitimate',
      childIds: [],
    })
    state.persons[spouseId] = makePerson(spouseId, houseId, {
      age: 40,
      alive: true,
      childIds: [],
    })
    state.persons[deceasedId] = makePerson(deceasedId, houseId, {
      age: 45,
      alive: false,
      spouseId,
      childIds: [childId],
      birthStatus: 'legitimate',
    })
    state.houses[houseId]!.memberIds = [childId, spouseId, deceasedId]

    const heirs = findHeirs(state, deceasedId)
    expect(heirs).toEqual([spouseId])
  })

  it('returns spouse when no children exist', () => {
    const { state, houseId } = makeBaseState()
    const spouseId = 'pe-0' as PersonId
    const deceasedId = 'pe-1' as PersonId

    state.persons[spouseId] = makePerson(spouseId, houseId, {
      age: 40,
      alive: true,
      childIds: [],
    })
    state.persons[deceasedId] = makePerson(deceasedId, houseId, {
      age: 45,
      alive: false,
      spouseId,
      childIds: [],
    })
    state.houses[houseId]!.memberIds = [spouseId, deceasedId]

    const heirs = findHeirs(state, deceasedId)
    expect(heirs).toEqual([spouseId])
  })

  it('returns sibling when no children or spouse', () => {
    const { state, houseId } = makeBaseState()
    const siblingId = 'pe-0' as PersonId
    const deceasedId = 'pe-1' as PersonId
    const fatherId = 'pe-99' as PersonId

    state.persons[siblingId] = makePerson(siblingId, houseId, {
      age: 35,
      alive: true,
      fatherId,
      childIds: [],
    })
    state.persons[deceasedId] = makePerson(deceasedId, houseId, {
      age: 30,
      alive: false,
      fatherId,
      childIds: [],
    })
    state.houses[houseId]!.memberIds = [siblingId, deceasedId]

    const heirs = findHeirs(state, deceasedId)
    expect(heirs).toEqual([siblingId])
  })

  it('returns house leader when no children, spouse, or siblings', () => {
    const { state, houseId } = makeBaseState()
    const leaderId = 'pe-0' as PersonId
    const deceasedId = 'pe-1' as PersonId

    state.persons[leaderId] = makePerson(leaderId, houseId, {
      age: 50,
      alive: true,
      childIds: [],
    })
    state.persons[deceasedId] = makePerson(deceasedId, houseId, {
      age: 30,
      alive: false,
      childIds: [],
    })
    state.houses[houseId]!.memberIds = [leaderId, deceasedId]

    const officeId = createOfficeAssignmentId(0)
    state.officeAssignments[officeId] = {
      id: officeId,
      organization: { kind: 'house', id: houseId },
      role: 'leader',
      holderPersonId: leaderId,
      active: true,
      startYear: 1440,
      unpaidCount: 0,
    }
    state.officeIndex.byOrganization['house:' + houseId] = [officeId]
    state.officeIndex.byHolderPerson[leaderId as string] = [officeId]

    const heirs = findHeirs(state, deceasedId)
    expect(heirs).toEqual([leaderId])
  })

  it('returns empty array when no heirs exist', () => {
    const { state, houseId } = makeBaseState()
    const deceasedId = 'pe-0' as PersonId

    state.persons[deceasedId] = makePerson(deceasedId, houseId, {
      age: 30,
      alive: false,
      childIds: [],
    })
    state.houses[houseId]!.memberIds = [deceasedId]

    const heirs = findHeirs(state, deceasedId)
    expect(heirs).toEqual([])
  })
})

describe('runEstateSettlementSystem', () => {
  it('ESTATE_SETTLED: distributes wealth with 1 heir', () => {
    const { state, houseId } = makeBaseState()
    const deceasedId = 'pe-0' as PersonId
    const heirId = 'pe-1' as PersonId

    state.persons[deceasedId] = makePerson(deceasedId, houseId, {
      age: 45,
      alive: false,
      wealth: 100,
      childIds: [heirId],
      birthStatus: 'legitimate',
    })
    state.persons[heirId] = makePerson(heirId, houseId, {
      age: 20,
      alive: true,
      wealth: 0,
      birthStatus: 'legitimate',
      childIds: [],
    })
    state.houses[houseId]!.memberIds = [deceasedId, heirId]

    const ctx = makeCtx(state, [deceasedId])
    const result = runEstateSettlementSystem(ctx)

    expect(result.state.persons[deceasedId]!.wealth).toBe(0)
    expect(result.state.persons[heirId]!.wealth).toBe(50)
    expect(result.state.houses[houseId]!.wealth).toBe(50)
    expect(result.events.length).toBe(1)
    expect(result.events[0]!.type).toBe('ESTATE_SETTLED')
    expect(collectIntegrityErrors(result.state)).toEqual([])
  })

  it('ESTATE_DISPUTED: distributes wealth with 2 heirs', () => {
    const { state, houseId } = makeBaseState()
    const deceasedId = 'pe-0' as PersonId
    const heir1Id = 'pe-1' as PersonId
    const heir2Id = 'pe-2' as PersonId

    state.persons[deceasedId] = makePerson(deceasedId, houseId, {
      age: 45,
      alive: false,
      wealth: 100,
      childIds: [heir1Id, heir2Id],
      birthStatus: 'legitimate',
    })
    state.persons[heir1Id] = makePerson(heir1Id, houseId, {
      age: 20,
      alive: true,
      wealth: 0,
      birthStatus: 'legitimate',
      childIds: [],
    })
    state.persons[heir2Id] = makePerson(heir2Id, houseId, {
      age: 15,
      alive: true,
      wealth: 0,
      birthStatus: 'legitimate',
      childIds: [],
    })
    state.houses[houseId]!.memberIds = [deceasedId, heir1Id, heir2Id]

    const ctx = makeCtx(state, [deceasedId])
    const result = runEstateSettlementSystem(ctx)

    expect(result.state.persons[deceasedId]!.wealth).toBe(0)
    expect(result.state.persons[heir1Id]!.wealth).toBe(25)
    expect(result.state.persons[heir2Id]!.wealth).toBe(25)
    expect(result.state.houses[houseId]!.wealth).toBe(50)
    // ESTATE_SETTLED + ESTATE_DISPUTED が並んで発火する (§5.7)
    expect(result.events.length).toBe(2)
    expect(result.events.map((e) => e.type)).toEqual(['ESTATE_SETTLED', 'ESTATE_DISPUTED'])
    expect(collectIntegrityErrors(result.state)).toEqual([])
  })

  it('all wealth to house when no heirs', () => {
    const { state, houseId } = makeBaseState()
    const deceasedId = 'pe-0' as PersonId

    state.persons[deceasedId] = makePerson(deceasedId, houseId, {
      age: 45,
      alive: false,
      wealth: 100,
      childIds: [],
      birthStatus: 'legitimate',
    })
    state.houses[houseId]!.memberIds = [deceasedId]

    const ctx = makeCtx(state, [deceasedId])
    const result = runEstateSettlementSystem(ctx)

    expect(result.state.persons[deceasedId]!.wealth).toBe(0)
    expect(result.state.houses[houseId]!.wealth).toBe(100)
    expect(result.events.length).toBe(1)
    expect(result.events[0]!.type).toBe('ESTATE_SETTLED')
    expect(collectIntegrityErrors(result.state)).toEqual([])
  })

  it('skips when deceased wealth is 0', () => {
    const { state, houseId } = makeBaseState()
    const deceasedId = 'pe-0' as PersonId

    state.persons[deceasedId] = makePerson(deceasedId, houseId, {
      age: 45,
      alive: false,
      wealth: 0,
      childIds: [],
      birthStatus: 'legitimate',
    })
    state.houses[houseId]!.memberIds = [deceasedId]

    const initialEventsLength = 0
    const ctx = makeCtx(state, [deceasedId])
    const result = runEstateSettlementSystem(ctx)

    expect(result).toBe(ctx)
    expect(result.events.length).toBe(initialEventsLength)
  })
})

// §10.2: estateSettlementSystem 経由で wealth が伝播することの統合テスト
// 家系を 2 世代追って合計 wealth (家 + 全人物) が保存されることを確認
describe('estateSettlementSystem 2-generation integration', () => {
  it('preserves total wealth across 2 successive deaths (grandfather -> father)', () => {
    const { state, houseId } = makeBaseState()
    const grandfatherId = 'pe-0' as PersonId
    const fatherId = 'pe-1' as PersonId
    const grandchildId = 'pe-2' as PersonId

    // 祖父 wealth=100, 父 wealth=50, 孫 wealth=0, 家 wealth=0
    // 祖父 → 父 (嫡出子), 父 → 孫 (嫡出子)
    state.persons[grandfatherId] = makePerson(grandfatherId, houseId, {
      age: 70,
      alive: true,
      wealth: 100,
      childIds: [fatherId],
      birthStatus: 'legitimate',
    })
    state.persons[fatherId] = makePerson(fatherId, houseId, {
      age: 40,
      alive: true,
      wealth: 50,
      fatherId: grandfatherId,
      childIds: [grandchildId],
      birthStatus: 'legitimate',
    })
    state.persons[grandchildId] = makePerson(grandchildId, houseId, {
      age: 15,
      alive: true,
      wealth: 0,
      fatherId,
      childIds: [],
      birthStatus: 'legitimate',
    })
    state.houses[houseId]!.memberIds = [grandfatherId, fatherId, grandchildId]

    const initialTotalWealth =
      state.persons[grandfatherId].wealth +
      state.persons[fatherId].wealth +
      state.persons[grandchildId].wealth +
      state.houses[houseId]!.wealth
    expect(initialTotalWealth).toBe(150)

    // tick 1: 祖父死亡。findHeirs(grandfather) = [father]
    // houseRecoveryRate = 0.5 (share=0), houseAmount = 50, father receives 50
    // 祖父 wealth=0, 父 wealth=100, 孫 wealth=0, 家 wealth=50
    state.persons[grandfatherId].alive = false
    const ctx1 = makeCtx(state, [grandfatherId])
    const result1 = runEstateSettlementSystem(ctx1)

    expect(result1.state.persons[grandfatherId]!.wealth).toBe(0)
    expect(result1.state.persons[fatherId]!.wealth).toBe(100)
    expect(result1.state.persons[grandchildId]!.wealth).toBe(0)
    expect(result1.state.houses[houseId]!.wealth).toBe(50)
    const totalAfterTick1 =
      result1.state.persons[grandfatherId]!.wealth +
      result1.state.persons[fatherId]!.wealth +
      result1.state.persons[grandchildId]!.wealth +
      result1.state.houses[houseId]!.wealth
    expect(totalAfterTick1).toBe(initialTotalWealth)
    expect(collectIntegrityErrors(result1.state)).toEqual([])

    // tick 2: 父死亡。findHeirs(father) = [grandchild]
    // houseRecoveryRate = 0.5, houseAmount = 50, grandchild receives 50
    // 祖父 wealth=0, 父 wealth=0, 孫 wealth=50, 家 wealth=100
    const intermediateState = { ...result1.state }
    intermediateState.persons = {
      ...result1.state.persons,
      [fatherId]: { ...result1.state.persons[fatherId]!, alive: false },
    }
    const ctx2: TickContext = {
      ...result1,
      state: intermediateState,
      deathsThisTick: [fatherId],
    }
    const result2 = runEstateSettlementSystem(ctx2)

    expect(result2.state.persons[grandfatherId]!.wealth).toBe(0)
    expect(result2.state.persons[fatherId]!.wealth).toBe(0)
    expect(result2.state.persons[grandchildId]!.wealth).toBe(50)
    expect(result2.state.houses[houseId]!.wealth).toBe(100)
    const totalAfterTick2 =
      result2.state.persons[grandfatherId]!.wealth +
      result2.state.persons[fatherId]!.wealth +
      result2.state.persons[grandchildId]!.wealth +
      result2.state.houses[houseId]!.wealth
    expect(totalAfterTick2).toBe(initialTotalWealth)
    expect(collectIntegrityErrors(result2.state)).toEqual([])

    // 2 世代分の ESTATE_SETTLED イベントが発火している
    const settledEvents = result2.events.filter((e) => e.type === 'ESTATE_SETTLED')
    expect(settledEvents.length).toBe(2)
  })
})
