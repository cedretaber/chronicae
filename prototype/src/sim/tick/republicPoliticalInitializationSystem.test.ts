import { describe, expect, it } from 'vitest'
import { createRng } from '../rng/rng'
import { createPersonId, createHouseId, createPolityId, createProvinceId } from '../types/ids'
import type { PersonId, HouseId, PolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import {
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
  bindProvinceToPolity,
} from '../testFixtures'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { getActiveOfficeHolders, getOfficeAssignments } from '../selectors/officeSelectors'
import { getRightsByPolity } from '../selectors/politicalRightSelectors'
import { runRepublicPoliticalInitializationSystem } from './republicPoliticalInitializationSystem'

function makeCtx(state: WorldState, config: SimulationConfig = defaultConfig): TickContext {
  return {
    state,
    rng: createRng('test'),
    config,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 100,
    nextHouseIndex: 100,
    nextPolityIndex: 100,
  }
}

function makeHouseless(
  state: WorldState,
  id: PersonId,
  houseId: HouseId,
  sex: 'male' | 'female' = 'male',
): WorldState {
  let next = withPerson(state, id, { houseId, sex })
  const person = next.persons[id]
  if (person) {
    const copy: Record<string, unknown> = { ...person }
    delete copy['houseId']
    next = { ...next, persons: { ...next.persons, [id]: copy as typeof person } }
  }
  return next
}

// established commonwealth + leader office + 候補となる houseless 人物群を組む。
function makeRepublic(opts?: { candidates?: number }): {
  state: WorldState
  polityId: PolityId
  leaderId: PersonId
  candidateIds: PersonId[]
} {
  const polityId = createPolityId('c', 1)
  const provinceId = createProvinceId('p', 1)
  const houseId = createHouseId('h', 1)
  const leaderId = createPersonId('pe', 1)
  const candidateCount = opts?.candidates ?? 4

  let state = makeEmptyV016State()
  state = withProvince(state, provinceId, {})
  state = withPolity(state, polityId, {
    kind: 'commonwealth',
    capitalProvinceId: provinceId,
    revoltState: { kind: 'established' },
  })
  state = bindProvinceToPolity(state, provinceId, polityId)
  state = withHouse(state, houseId, {})

  state = makeHouseless(state, leaderId, houseId)
  state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', leaderId)

  const candidateIds: PersonId[] = []
  for (let i = 0; i < candidateCount; i++) {
    const id = createPersonId('pe', 10 + i)
    state = makeHouseless(state, id, houseId)
    // 役職適性に差をつける (numeracy 高めで treasurer/administrator に向く人物)。
    const p = state.persons[id]
    if (p) {
      state = {
        ...state,
        persons: {
          ...state.persons,
          [id]: {
            ...p,
            abilities: { ...p.abilities, numeracy: 60 + i * 5, command: 50 + i * 3, charisma: 55 },
          },
        },
      }
    }
    candidateIds.push(id)
  }

  return { state, polityId, leaderId, candidateIds }
}

describe('RepublicPoliticalInitializationSystem', () => {
  it('established commonwealth の非 leader office を seed し marker を立てる', () => {
    const { state, polityId } = makeRepublic()
    const ctx = runRepublicPoliticalInitializationSystem(makeCtx(state))
    const org = { kind: 'polity' as const, id: polityId }

    for (const role of ['administrator', 'treasurer', 'military', 'advisor'] as const) {
      expect(getActiveOfficeHolders(ctx.state, org, role).length).toBe(1)
    }
    const polity = ctx.state.polities[polityId]
    expect(polity?.republicInitializedWeek).toBeDefined()
  })

  it('REPUBLIC_FOUNDED を 1 度だけ emit する', () => {
    const { state } = makeRepublic()
    const ctx = runRepublicPoliticalInitializationSystem(makeCtx(state))
    const founded = ctx.events.filter((e) => e.type === 'REPUBLIC_FOUNDED')
    expect(founded.length).toBe(1)
  })

  it('seed した holder に personal right を grant する (1-target-1-right)', () => {
    const { state, polityId } = makeRepublic()
    const ctx = runRepublicPoliticalInitializationSystem(makeCtx(state))
    const rights = getRightsByPolity(ctx.state, polityId)
    // 4 役職それぞれに 1 つの personal right。
    expect(rights.length).toBe(4)
    // target 重複なし。
    const targetKeys = rights.map((r) =>
      r.target.kind === 'polity_office_role' ? `${r.target.role}:${r.target.slotIndex}` : 'other',
    )
    expect(new Set(targetKeys).size).toBe(targetKeys.length)
    // すべて person holder。
    expect(rights.every((r) => r.holder.kind === 'person')).toBe(true)
  })

  it('marker once-guard: 2 度実行しても再 seed しない', () => {
    const { state, polityId } = makeRepublic()
    const ctx1 = runRepublicPoliticalInitializationSystem(makeCtx(state))
    const ctx2 = runRepublicPoliticalInitializationSystem({ ...ctx1, events: [] })
    const org = { kind: 'polity' as const, id: polityId }
    // office 数は 4 役職 × 1 + leader = 5 のまま。
    const activeOffices = getOfficeAssignments(ctx2.state, org).filter((o) => o.active)
    expect(activeOffices.length).toBe(5)
    // 2 回目は FOUNDED を emit しない。
    expect(ctx2.events.filter((e) => e.type === 'REPUBLIC_FOUNDED').length).toBe(0)
  })

  it('候補が leader しか居ない場合は marker を立てず emit もしない (空振り retry)', () => {
    const { state, polityId } = makeRepublic({ candidates: 0 })
    const ctx = runRepublicPoliticalInitializationSystem(makeCtx(state))
    const polity = ctx.state.polities[polityId]
    expect(polity?.republicInitializedWeek).toBeUndefined()
    expect(ctx.events.filter((e) => e.type === 'REPUBLIC_FOUNDED').length).toBe(0)
    // 非 leader office は seed されない。
    const org = { kind: 'polity' as const, id: polityId }
    expect(getActiveOfficeHolders(ctx.state, org, 'administrator').length).toBe(0)
  })

  it('非共和国 (normal polity) は対象外', () => {
    let state = makeEmptyV016State()
    const cId = createPolityId('c', 1)
    const prId = createProvinceId('p', 1)
    state = withProvince(state, prId, {})
    state = withPolity(state, cId, { kind: 'normal', capitalProvinceId: prId })
    state = bindProvinceToPolity(state, prId, cId)
    const ctx = runRepublicPoliticalInitializationSystem(makeCtx(state))
    expect(ctx.state.polities[cId]?.republicInitializedWeek).toBeUndefined()
    expect(ctx.events.length).toBe(0)
  })

  it('leader 不在の established commonwealth は skip (marker 立てず retry)', () => {
    // leader office を作らない established commonwealth。
    const polityId = createPolityId('c', 1)
    const provinceId = createProvinceId('p', 1)
    const houseId = createHouseId('h', 1)
    let state = makeEmptyV016State()
    state = withProvince(state, provinceId, {})
    state = withPolity(state, polityId, {
      kind: 'commonwealth',
      capitalProvinceId: provinceId,
      revoltState: { kind: 'established' },
    })
    state = bindProvinceToPolity(state, provinceId, polityId)
    state = withHouse(state, houseId, {})
    state = makeHouseless(state, createPersonId('pe', 10), houseId)
    const ctx = runRepublicPoliticalInitializationSystem(makeCtx(state))
    expect(ctx.state.polities[polityId]?.republicInitializedWeek).toBeUndefined()
  })

  it('性別ゲート: 女性候補のみ + allowFemale=false + femaleChance=0 では seed しない', () => {
    const polityId = createPolityId('c', 1)
    const provinceId = createProvinceId('p', 1)
    const houseId = createHouseId('h', 1)
    const leaderId = createPersonId('pe', 1)
    let state = makeEmptyV016State()
    state = withProvince(state, provinceId, {})
    state = withPolity(state, polityId, {
      kind: 'commonwealth',
      capitalProvinceId: provinceId,
      revoltState: { kind: 'established' },
    })
    state = bindProvinceToPolity(state, provinceId, polityId)
    state = withHouse(state, houseId, {})
    state = makeHouseless(state, leaderId, houseId)
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', leaderId)
    // 女性候補のみ。
    state = makeHouseless(state, createPersonId('pe', 10), houseId, 'female')
    state = makeHouseless(state, createPersonId('pe', 11), houseId, 'female')

    const config: SimulationConfig = {
      ...defaultConfig,
      femaleRoleEligibilityChance: 0,
      allowFemaleRolesWhenNoMaleCandidate: false,
    }
    const ctx = runRepublicPoliticalInitializationSystem(makeCtx(state, config))
    const org = { kind: 'polity' as const, id: polityId }
    // 適格な男性が居ないので非 leader office は seed されない。
    expect(getActiveOfficeHolders(ctx.state, org, 'administrator').length).toBe(0)
    expect(ctx.state.polities[polityId]?.republicInitializedWeek).toBeUndefined()
  })

  it('性別ゲート: allowFemale=true なら女性候補でも seed する', () => {
    const polityId = createPolityId('c', 1)
    const provinceId = createProvinceId('p', 1)
    const houseId = createHouseId('h', 1)
    const leaderId = createPersonId('pe', 1)
    let state = makeEmptyV016State()
    state = withProvince(state, provinceId, {})
    state = withPolity(state, polityId, {
      kind: 'commonwealth',
      capitalProvinceId: provinceId,
      revoltState: { kind: 'established' },
    })
    state = bindProvinceToPolity(state, provinceId, polityId)
    state = withHouse(state, houseId, {})
    state = makeHouseless(state, leaderId, houseId)
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', leaderId)
    state = makeHouseless(state, createPersonId('pe', 10), houseId, 'female')

    const config: SimulationConfig = {
      ...defaultConfig,
      femaleRoleEligibilityChance: 0,
      allowFemaleRolesWhenNoMaleCandidate: true,
    }
    const ctx = runRepublicPoliticalInitializationSystem(makeCtx(state, config))
    const org = { kind: 'polity' as const, id: polityId }
    expect(getActiveOfficeHolders(ctx.state, org, 'administrator').length).toBe(1)
  })
})
