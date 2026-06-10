import { describe, expect, it } from 'vitest'
import { createRng } from '../rng/rng'
import { createPersonId, createHouseId, createPolityId, createProvinceId } from '../types/ids'
import type { PersonId, HouseId, PolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import type { SimulationConfig } from '../config/defaultConfig'
import type { AbilityScores } from '../types/person'
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
import { runRepublicLeadershipSystem } from './republicLeadershipSystem'

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
  abilities?: Partial<AbilityScores>,
): WorldState {
  let next = withPerson(state, id, { houseId })
  const person = next.persons[id]
  if (person) {
    const copy: Record<string, unknown> = {
      ...person,
      ...(abilities ? { abilities: { ...person.abilities, ...abilities } } : {}),
    }
    delete copy['houseId']
    next = { ...next, persons: { ...next.persons, [id]: copy as typeof person } }
  }
  return next
}

function setYear(state: WorldState, year: number): WorldState {
  return { ...state, currentYear: year }
}

// 共和国 + leader (startYear=0) を作る。challengers を追加できる。
function makeRepublic(opts: {
  leaderAbilities?: Partial<AbilityScores>
  challengers?: { id: PersonId; abilities?: Partial<AbilityScores> }[]
}): { state: WorldState; polityId: PolityId; leaderId: PersonId; houseId: HouseId } {
  const polityId = createPolityId('c', 1)
  const provinceId = createProvinceId('p', 1)
  const houseId = createHouseId('h', 1)
  const leaderId = createPersonId('pe', 1)

  let state = makeEmptyV016State()
  state = setYear(state, 0)
  state = withProvince(state, provinceId, {})
  state = withPolity(state, polityId, {
    kind: 'commonwealth',
    capitalProvinceId: provinceId,
    revoltState: { kind: 'established' },
  })
  state = bindProvinceToPolity(state, provinceId, polityId)
  state = withHouse(state, houseId, {})
  state = makeHouseless(state, leaderId, houseId, opts.leaderAbilities)
  // leader office を currentYear=0 で作る (startYear=0)。
  state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', leaderId)

  for (const c of opts.challengers ?? []) {
    state = makeHouseless(state, c.id, houseId, c.abilities)
  }

  return { state, polityId, leaderId, houseId }
}

const HIGH: Partial<AbilityScores> = {
  valor: 80,
  command: 80,
  charisma: 90,
  insight: 90,
  learning: 80,
  numeracy: 70,
}
const LOW: Partial<AbilityScores> = {
  valor: 10,
  command: 10,
  charisma: 10,
  insight: 10,
  learning: 10,
  numeracy: 10,
}

describe('RepublicLeadershipSystem', () => {
  it('任期満了 + 強い挑戦者で leader が交代する', () => {
    const challengerId = createPersonId('pe', 2)
    const {
      state: built,
      polityId,
      leaderId,
    } = makeRepublic({
      leaderAbilities: LOW,
      challengers: [{ id: challengerId, abilities: HIGH }],
    })
    const state = setYear(built, 10) // tenure=10 → fatigue が incumbency を上回る
    const ctx = runRepublicLeadershipSystem(makeCtx(state))
    const org = { kind: 'polity' as const, id: polityId }
    const leaders = getActiveOfficeHolders(ctx.state, org, 'leader')
    expect(leaders.length).toBe(1) // slot uniqueness
    expect(leaders[0]).toBe(challengerId)
    expect(leaders[0]).not.toBe(leaderId)
    expect(ctx.events.filter((e) => e.type === 'REPUBLIC_LEADER_ELECTED').length).toBe(1)
  })

  it('任期未満では何もしない', () => {
    const challengerId = createPersonId('pe', 2)
    const {
      state: built,
      polityId,
      leaderId,
    } = makeRepublic({
      leaderAbilities: LOW,
      challengers: [{ id: challengerId, abilities: HIGH }],
    })
    const state = setYear(built, 2) // term=4 未満
    const ctx = runRepublicLeadershipSystem(makeCtx(state))
    const org = { kind: 'polity' as const, id: polityId }
    expect(getActiveOfficeHolders(ctx.state, org, 'leader')[0]).toBe(leaderId)
    expect(ctx.events.length).toBe(0)
  })

  it('再任 (winner == 現 leader) は office 据え置き・startYear 保持・event 無し', () => {
    // 挑戦者を置かず leader だけ → winner = leader → no-op。
    const { state: built, polityId, leaderId } = makeRepublic({ leaderAbilities: HIGH })
    const state = setYear(built, 10)
    const orgKey = `polity:${polityId}`
    const beforeOfficeIds = [...(state.officeIndex.byOrganization[orgKey] ?? [])]
    const ctx = runRepublicLeadershipSystem(makeCtx(state))
    const org = { kind: 'polity' as const, id: polityId }
    expect(getActiveOfficeHolders(ctx.state, org, 'leader')[0]).toBe(leaderId)
    // startYear が 0 のまま (再作成されていない)。
    const leaderOffice = getOfficeAssignments(ctx.state, org).find(
      (o) => o.active && o.role === 'leader',
    )
    expect(leaderOffice?.startYear).toBe(0)
    // office id 集合が不変 (revoke/再作成が起きていない)。
    expect(ctx.state.officeIndex.byOrganization[orgKey]).toEqual(beforeOfficeIds)
    expect(ctx.events.length).toBe(0)
  })

  it('現職 non-leader office holder を leader に昇格すると旧 office が revoke され兼任しない', () => {
    // challenger が administrator office も持つ → leader 昇格時に administrator が revoke される。
    const challengerId = createPersonId('pe', 2)
    const {
      state: built,
      polityId,
      leaderId,
    } = makeRepublic({
      leaderAbilities: LOW,
      challengers: [{ id: challengerId, abilities: HIGH }],
    })
    void leaderId
    let state = createOfficeAssignment(
      built,
      { kind: 'polity', id: polityId },
      'administrator',
      challengerId,
    )
    state = setYear(state, 10)
    const ctx = runRepublicLeadershipSystem(makeCtx(state))
    const org = { kind: 'polity' as const, id: polityId }
    expect(getActiveOfficeHolders(ctx.state, org, 'leader')[0]).toBe(challengerId)
    // administrator office は revoke されている (兼任しない)。
    expect(getActiveOfficeHolders(ctx.state, org, 'administrator')).not.toContain(challengerId)
    expect(getActiveOfficeHolders(ctx.state, org, 'administrator').length).toBe(0)
  })

  it('leader 不在の established commonwealth は skip', () => {
    const polityId = createPolityId('c', 1)
    const provinceId = createProvinceId('p', 1)
    let state = makeEmptyV016State()
    state = setYear(state, 10)
    state = withProvince(state, provinceId, {})
    state = withPolity(state, polityId, {
      kind: 'commonwealth',
      capitalProvinceId: provinceId,
      revoltState: { kind: 'established' },
    })
    state = bindProvinceToPolity(state, provinceId, polityId)
    const ctx = runRepublicLeadershipSystem(makeCtx(state))
    const org = { kind: 'polity' as const, id: polityId }
    expect(getActiveOfficeHolders(ctx.state, org, 'leader').length).toBe(0)
    expect(ctx.events.length).toBe(0)
  })

  it('性別ゲート: 女性挑戦者は femaleChance=0 + allowFemale=false では当選しない', () => {
    const challengerId = createPersonId('pe', 2)
    const {
      state: built,
      polityId,
      leaderId,
    } = makeRepublic({
      leaderAbilities: LOW,
      challengers: [{ id: challengerId, abilities: HIGH }],
    })
    // challenger を女性にする。
    let state = built
    const c = state.persons[challengerId]
    if (c)
      state = { ...state, persons: { ...state.persons, [challengerId]: { ...c, sex: 'female' } } }
    state = setYear(state, 10)
    const config: SimulationConfig = {
      ...defaultConfig,
      femaleRoleEligibilityChance: 0,
      allowFemaleRolesWhenNoMaleCandidate: false,
    }
    const ctx = runRepublicLeadershipSystem(makeCtx(state, config))
    const org = { kind: 'polity' as const, id: polityId }
    // 男性候補は leader 本人のみ (適格) → winner=leader → 再任 no-op。女性挑戦者は当選しない。
    expect(getActiveOfficeHolders(ctx.state, org, 'leader')[0]).toBe(leaderId)
  })
})
