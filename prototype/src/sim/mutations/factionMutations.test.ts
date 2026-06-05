import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createFactionId,
  createFactionMembershipId,
  createPolityId,
} from '../types/ids'
import type { PersonId, HouseId, OfficeAssignmentId, ProjectId, TaskId, AimId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Project } from '../types/project'
import type { Task } from '../types/task'
import type { Aim } from '../types/goal'
import type { TickContext } from '../tick/context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import {
  createFaction,
  addFactionMembership,
  deactivateFaction,
  transitionFactionLeader,
  removeFactionMembership,
} from './factionMutations'
import { addProjectToIndexMut } from './projectMutations'
import { addTaskToIndicesMut } from './taskMutations'
import { dissolveNegotiatingCommonwealth } from './worldStructureCommonwealth'
import { makeEmptyV016State, withPerson, withHouse, withPolity } from '../testFixtures'

function makeFixture(): {
  state: WorldState
  ctx: TickContext
  leaderId: PersonId
  member1Id: PersonId
  member2Id: PersonId
  houseId: HouseId
} {
  const leaderId = createPersonId('pe', 0)
  const member1Id = createPersonId('pe', 1)
  const member2Id = createPersonId('pe', 2)
  const houseId = createHouseId('h', 0)

  let state = makeEmptyV016State()
  state = withPolity(state, createPolityId('c', 0), {})
  state = withHouse(state, houseId, {
    nameKey: 'Test House',
    memberIds: [leaderId, member1Id, member2Id],
  })
  state = withPerson(state, leaderId, { nameKey: 'Leader', houseId, alive: true })
  state = withPerson(state, member1Id, { nameKey: 'Member1', houseId, alive: true })
  state = withPerson(state, member2Id, { nameKey: 'Member2', houseId, alive: true })

  const ctx: TickContext = {
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
  return { state, ctx, leaderId, member1Id, member2Id, houseId }
}

describe('createFaction', () => {
  it('creates faction + leader membership when leader is valid', () => {
    const { ctx, leaderId } = makeFixture()
    const result = createFaction(ctx, {
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      week: 1444 * 48 + 1 - 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { factionId, leaderMembershipId } = result.value.value
    const newState = result.value.ctx.state

    const faction = newState.factions[factionId]
    expect(faction).toBeDefined()
    expect(faction!.active).toBe(true)
    expect(faction!.leaderPersonId).toBe(leaderId)
    expect(faction!.foundingWeek).toBe(1444 * 48 + 1 - 1)

    const membership = newState.factionMemberships[leaderMembershipId]
    expect(membership).toBeDefined()
    expect(membership!.factionId).toBe(factionId)
    expect(membership!.personId).toBe(leaderId)
    expect(membership!.active).toBe(true)

    expect(newState.factionIndex.byLeader[leaderId]).toContain(factionId)
    expect(newState.factionIndex.byMember[leaderId]).toContain(leaderMembershipId)
    expect(newState.nextFactionId).toBe(1)
    expect(newState.nextFactionMembershipId).toBe(1)
  })

  it('returns err when leader is dead', () => {
    const { ctx, leaderId } = makeFixture()
    const deadState = {
      ...ctx.state,
      persons: {
        ...ctx.state.persons,
        [leaderId]: { ...ctx.state.persons[leaderId]!, alive: false },
      },
    }
    const deadCtx: TickContext = { ...ctx, state: deadState }
    const result = createFaction(deadCtx, {
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      week: 1444 * 48 + 1 - 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_DEAD')
  })

  it('returns err when leader is placeholder', () => {
    const { ctx, leaderId } = makeFixture()
    const placeholderState = {
      ...ctx.state,
      persons: {
        ...ctx.state.persons,
        [leaderId]: { ...ctx.state.persons[leaderId]!, kind: 'placeholder' },
      },
    }
    const placeholderCtx: TickContext = { ...ctx, state: placeholderState }
    const result = createFaction(placeholderCtx, {
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      week: 1444 * 48 + 1 - 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PLACEHOLDER_PERSON')
  })

  it('returns err when leader already has active membership', () => {
    const { ctx, leaderId } = makeFixture()
    // Create a faction first for the leader
    const first = createFaction(ctx, {
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      week: 1444 * 48 + 1 - 1,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // Try to create another faction with the same leader
    const second = createFaction(first.value.ctx, {
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      week: 1445 * 48 + 1 - 1,
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('FACTION_MEMBERSHIP_CONFLICT')
  })
})

describe('addFactionMembership', () => {
  it('creates active membership for valid person', () => {
    const { state, leaderId, member1Id } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, polityId: createPolityId('c', 0), week: 1444 * 48 + 1 - 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    const result = addFactionMembership(factionResult.value.ctx.state, {
      factionId,
      personId: member1Id,
      week: 1444 * 48 + 2 - 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const membership = result.value.state.factionMemberships[result.value.membershipId]
    expect(membership).toBeDefined()
    expect(membership!.active).toBe(true)
    expect(membership!.factionId).toBe(factionId)
    expect(membership!.personId).toBe(member1Id)
    expect(result.value.state.factionIndex.byMember[member1Id]).toContain(result.value.membershipId)
  })

  it('returns err when person already has active membership', () => {
    const { ctx, leaderId, member1Id } = makeFixture()
    // First faction with leader
    const first = createFaction(ctx, {
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      week: 1444 * 48 + 1 - 1,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const factionId = first.value.value.factionId

    // Add member1 as member
    const addResult = addFactionMembership(first.value.ctx.state, {
      factionId,
      personId: member1Id,
      week: 1444 * 48 + 2 - 1,
    })
    expect(addResult.ok).toBe(true)
    if (!addResult.ok) return

    // Try to add member1 to another faction
    const faction2Id = createFactionId(1)
    const stateWithFaction2 = {
      ...addResult.value.state,
      factions: {
        ...addResult.value.state.factions,
        [faction2Id]: {
          id: faction2Id,
          leaderPersonId: createPersonId('pe', 99),
          polityId: createPolityId('c', 0),
          active: true,
          foundingWeek: 1444 * 48 + 1 - 1,
        },
      },
    }
    const result = addFactionMembership(stateWithFaction2, {
      factionId: faction2Id,
      personId: member1Id,
      week: 1444 * 48 + 3 - 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_MEMBERSHIP_CONFLICT')
  })

  it('returns err when person is the faction leader', () => {
    const { state, leaderId } = makeFixture()
    const factionId = createFactionId(0)
    state.factions[factionId] = {
      id: factionId,
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: 1444 * 48 + 1 - 1,
    }
    const result = addFactionMembership(state, {
      factionId,
      personId: leaderId,
      week: 1444 * 48 + 1 - 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_LEADER_MEMBERSHIP_EXISTS')
  })
})

describe('deactivateFaction', () => {
  it('sets faction.active to false and all memberships inactive', () => {
    const { state, leaderId, member1Id } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, polityId: createPolityId('c', 0), week: 1444 * 48 + 1 - 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    // Add a member
    const addResult = addFactionMembership(factionResult.value.ctx.state, {
      factionId,
      personId: member1Id,
      week: 1444 * 48 + 2 - 1,
    })
    expect(addResult.ok).toBe(true)
    if (!addResult.ok) return

    const result = deactivateFaction(addResult.value.state, factionId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.factions[factionId]!.active).toBe(false)
    // v0.17.3 C: Leader and member memberships are now deleted (not just set inactive)
    const leaderMembershipId = createFactionMembershipId(0)
    expect(result.value.factionMemberships[leaderMembershipId]).toBeUndefined()
    const memberMembershipId = createFactionMembershipId(1)
    expect(result.value.factionMemberships[memberMembershipId]).toBeUndefined()
    // byMember index cleaned
    expect(result.value.factionIndex.byMember[leaderId] ?? []).not.toContain(leaderMembershipId)
    expect(result.value.factionIndex.byMember[member1Id] ?? []).not.toContain(memberMembershipId)
  })

  it('is a no-op when faction already inactive', () => {
    const { state, leaderId } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, polityId: createPolityId('c', 0), week: 1444 * 48 + 1 - 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    const first = deactivateFaction(factionResult.value.ctx.state, factionId)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = deactivateFaction(first.value, factionId)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value).toBe(first.value)
  })

  it('returns err when faction not found', () => {
    const { state } = makeFixture()
    const result = deactivateFaction(state, createFactionId(99))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_NOT_FOUND')
  })
})

describe('transitionFactionLeader', () => {
  it('updates faction.leaderPersonId and index', () => {
    const { state, leaderId, member1Id } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, polityId: createPolityId('c', 0), week: 1444 * 48 + 1 - 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    // Add member1 as member
    const addResult = addFactionMembership(factionResult.value.ctx.state, {
      factionId,
      personId: member1Id,
      week: 1444 * 48 + 2 - 1,
    })
    expect(addResult.ok).toBe(true)
    if (!addResult.ok) return

    const result = transitionFactionLeader(addResult.value.state, {
      factionId,
      newLeaderPersonId: member1Id,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const faction = result.value.factions[factionId]
    expect(faction!.leaderPersonId).toBe(member1Id)

    // v0.17.3 C: Old leader's membership is now deleted (not just set inactive)
    const oldLeaderMembershipId = createFactionMembershipId(0)
    expect(result.value.factionMemberships[oldLeaderMembershipId]).toBeUndefined()

    // byLeader index updated for both
    expect(result.value.factionIndex.byLeader[member1Id]).toContain(factionId)
    expect(result.value.factionIndex.byLeader[leaderId]).not.toContain(factionId)
    // byMember index cleaned for old leader
    expect(result.value.factionIndex.byMember[leaderId] ?? []).not.toContain(oldLeaderMembershipId)
  })

  it('is a no-op when new leader is same as old', () => {
    const { state, leaderId } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, polityId: createPolityId('c', 0), week: 1444 * 48 + 1 - 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    const result = transitionFactionLeader(factionResult.value.ctx.state, {
      factionId,
      newLeaderPersonId: leaderId,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(factionResult.value.ctx.state)
  })

  it('returns err when new leader not in faction', () => {
    const { state, leaderId, member1Id } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, polityId: createPolityId('c', 0), week: 1444 * 48 + 1 - 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    // member1 is NOT an active member of this faction (just in the same house)
    const result = transitionFactionLeader(factionResult.value.ctx.state, {
      factionId,
      newLeaderPersonId: member1Id,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_MEMBERSHIP_NOT_FOUND')
  })
})

describe('removeFactionMembership', () => {
  it('deactivates non-leader membership', () => {
    const { state, leaderId, member1Id } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, polityId: createPolityId('c', 0), week: 1444 * 48 + 1 - 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    // Add member1 as member
    const addResult = addFactionMembership(factionResult.value.ctx.state, {
      factionId,
      personId: member1Id,
      week: 1444 * 48 + 2 - 1,
    })
    expect(addResult.ok).toBe(true)
    if (!addResult.ok) return
    const membershipId = addResult.value.membershipId

    const result = removeFactionMembership(addResult.value.state, membershipId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // v0.17.3 C: membership is now deleted (not just set inactive)
    expect(result.value.factionMemberships[membershipId]).toBeUndefined()
    expect(result.value.factionIndex.byMember[member1Id] ?? []).not.toContain(membershipId)
  })

  it('is a no-op when membership already deleted (after deactivateFaction)', () => {
    const { state, leaderId } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, polityId: createPolityId('c', 0), week: 1444 * 48 + 1 - 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const leaderMembershipId = factionResult.value.value.leaderMembershipId

    // Deactivate first — this DELETES all memberships including the leader's
    const deactivated = deactivateFaction(
      factionResult.value.ctx.state,
      factionResult.value.value.factionId,
    )
    expect(deactivated.ok).toBe(true)
    if (!deactivated.ok) return

    // v0.17.3 C: deleted membership → FACTION_MEMBERSHIP_NOT_FOUND
    const result = removeFactionMembership(deactivated.value, leaderMembershipId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_MEMBERSHIP_NOT_FOUND')
  })

  it('returns err when trying to remove leader membership', () => {
    const { state, leaderId } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, polityId: createPolityId('c', 0), week: 1444 * 48 + 1 - 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const leaderMembershipId = factionResult.value.value.leaderMembershipId

    const result = removeFactionMembership(factionResult.value.ctx.state, leaderMembershipId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_LEADER_MEMBERSHIP_PROTECTED')
  })

  it('returns err when membership not found', () => {
    const { state } = makeFixture()
    const result = removeFactionMembership(state, createFactionMembershipId(99))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_MEMBERSHIP_NOT_FOUND')
  })
})

// v0.42 §12.3 F8 回帰テスト: commonwealth 解散 (dissolveNegotiatingCommonwealth) が
// anchor された active Faction を即時解散すること。
// この cascade の欠落で「active Faction f-65 anchor polity dp-10 is not active (v0.42 F8)」
// が CI (300年 ランダム seed) で実発生した。cascade は polityOwnerConsistencySystem の
// landless 経路と共有の dissolveFactionsAnchoredToPolity に集約されている。
describe('dissolveFactionsAnchoredToPolity (polity 解散 cascade)', () => {
  it('dissolveNegotiatingCommonwealth dissolves factions anchored to the commonwealth (F8)', () => {
    const { ctx, leaderId } = makeFixture()
    const polityId = createPolityId('c', 0)

    const factionResult = createFaction(ctx, {
      leaderPersonId: leaderId,
      polityId,
      week: 1444 * 48 + 1 - 1,
    })
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const { factionId } = factionResult.value.value

    const result = dissolveNegotiatingCommonwealth(factionResult.value.ctx, {
      commonwealthPolityId: polityId,
      leaderOutcome: 'alive',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const nextCtx = result.value.ctx

    // polity は inactive、anchor していた faction も inactive (F8 不変条件)
    expect(nextCtx.state.polities[polityId]!.active).toBe(false)
    expect(nextCtx.state.factions[factionId]!.active).toBe(false)

    // FACTION_DISSOLVED が anchor_polity_dissolved 理由で emit される
    const dissolvedEvents = nextCtx.events.filter((e) => e.type === 'FACTION_DISSOLVED')
    expect(dissolvedEvents).toHaveLength(1)
    expect(dissolvedEvents[0]!.messageParams['reason']).toBe('anchor_polity_dissolved')
  })

  it('leaves factions anchored to other polities untouched', () => {
    const { ctx, leaderId } = makeFixture()
    const anchorPolityId = createPolityId('c', 0)
    const otherPolityId = createPolityId('c', 1)
    const ctxWithOther: TickContext = {
      ...ctx,
      state: withPolity(ctx.state, otherPolityId, {}),
    }

    const factionResult = createFaction(ctxWithOther, {
      leaderPersonId: leaderId,
      polityId: anchorPolityId,
      week: 1444 * 48 + 1 - 1,
    })
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const { factionId } = factionResult.value.value

    const result = dissolveNegotiatingCommonwealth(factionResult.value.ctx, {
      commonwealthPolityId: otherPolityId,
      leaderOutcome: 'alive',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.ctx.state.factions[factionId]!.active).toBe(true)
  })
})

// supervisor 死亡 cascade 回帰テスト: revolt 鎮圧で処刑された leader が他組織の
// active Project の supervisor を務めていた場合、年末 integrity (supervisor is dead)
// より先に即時 cascade (再選定 → 不能なら failed) する。
// dissolveNegotiatingCommonwealth は war 系 system (tick 順で ProjectMaintenanceSystem
// より後) から呼ばれるため、4週ごとの maintenance では回収が間に合わないことがある。
describe('reassignProjectsOfDeadSupervisor (executed leader cascade)', () => {
  function setupExecutedLeaderWithProject(ownerHouseMemberIds: PersonId[]): {
    ctx: TickContext
    leaderId: PersonId
    projectId: ProjectId
  } {
    const { ctx, leaderId } = makeFixture()
    const polityId = createPolityId('c', 0)
    const ownerHouseId = createHouseId('h', 9)
    const creatorId = createPersonId('pe', 9)

    let state = withHouse(ctx.state, ownerHouseId, { nameKey: 'Owner House' })
    state = withPerson(state, creatorId, { nameKey: 'Creator', houseId: ownerHouseId })
    for (const [i, mid] of ownerHouseMemberIds.entries()) {
      state = withPerson(state, mid, { nameKey: `OwnerMember${i}`, houseId: ownerHouseId })
    }

    // leader を commonwealth (c-0) の polity:leader に据える (処刑対象の特定経路)
    const officeId = 'oa-exec-test' as OfficeAssignmentId
    state = {
      ...state,
      officeAssignments: {
        ...state.officeAssignments,
        [officeId]: {
          id: officeId,
          organization: { kind: 'polity', id: polityId },
          role: 'leader',
          holderPersonId: leaderId,
          active: true,
          startYear: 1,
          slotIndex: 0,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          ...state.officeIndex.byOrganization,
          [`polity:${polityId}`]: [officeId],
        },
        byHolderPerson: {
          ...state.officeIndex.byHolderPerson,
          [leaderId as string]: [officeId],
        },
      },
    }

    // leader が他家 (Owner House) の active Project の supervisor
    const projectId = 'proj-exec-1' as ProjectId
    const project = {
      id: projectId,
      owner: { kind: 'house' as const, id: ownerHouseId },
      origin: { kind: 'system' as const, reasonKey: 'test' },
      kind: 'patronize_artist' as const,
      creatorPersonId: creatorId,
      supervisorPersonId: leaderId,
      status: 'active' as const,
      currentStageKey: 'arrange_patronage' as const,
      budget: 0,
      spentBudget: 0,
      progress: 0,
      targetProgress: 100,
      createdWeek: 48000,
      reasonIds: [],
      houseId: ownerHouseId,
    } as Project
    state = { ...state, projects: { ...state.projects, [projectId]: project } }
    addProjectToIndexMut(state, project)

    return { ctx: { ...ctx, state }, leaderId, projectId }
  }

  it('再選定候補がいなければ project を failed にし PROJECT_FAILED を emit する', () => {
    // owner 家は creator のみ (supervisor 選定は creator を除外) → 再選定不能
    const { ctx, leaderId, projectId } = setupExecutedLeaderWithProject([])

    const result = dissolveNegotiatingCommonwealth(ctx, {
      commonwealthPolityId: createPolityId('c', 0),
      leaderOutcome: 'executed',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const nextCtx = result.value.ctx

    expect(nextCtx.state.persons[leaderId]!.alive).toBe(false)
    expect(nextCtx.state.projects[projectId]!.status).toBe('failed')
    const failed = nextCtx.events.filter((e) => e.type === 'PROJECT_FAILED')
    expect(failed).toHaveLength(1)
  })

  it('再選定候補がいれば supervisor を差し替えて project は active のまま', () => {
    const replacementId = createPersonId('pe', 8)
    const { ctx, leaderId, projectId } = setupExecutedLeaderWithProject([replacementId])

    const result = dissolveNegotiatingCommonwealth(ctx, {
      commonwealthPolityId: createPolityId('c', 0),
      leaderOutcome: 'executed',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const nextCtx = result.value.ctx

    expect(nextCtx.state.persons[leaderId]!.alive).toBe(false)
    const project = nextCtx.state.projects[projectId]!
    expect(project.status).toBe('active')
    expect(project.supervisorPersonId).toBe(replacementId)
    // index も追従している
    expect(nextCtx.state.projectIndex.bySupervisorPerson[replacementId as string] ?? []).toContain(
      projectId,
    )
    expect(nextCtx.state.projectIndex.bySupervisorPerson[leaderId as string] ?? []).not.toContain(
      projectId,
    )
  })
})

// 処刑 cascade の Task 側: 処刑された leader に assign された active Task は即時 cancel
// される (taskSystem は tick 順で war 系より前 → 年末 tick の処刑は同 tick の integrity
// 「Task assignee is dead」に捕まるため、taskSystem の週次回収では間に合わない)。
describe('cancelTasksOfDeadAssignee (executed leader cascade)', () => {
  it('処刑された leader の active Task が削除され owner Aim の activeTaskId も解除される', () => {
    const { ctx, leaderId } = makeFixture()
    const polityId = createPolityId('c', 0)

    // leader を polity:leader に据える
    const officeId = 'oa-exec-task-test' as OfficeAssignmentId
    let state: WorldState = {
      ...ctx.state,
      officeAssignments: {
        ...ctx.state.officeAssignments,
        [officeId]: {
          id: officeId,
          organization: { kind: 'polity', id: polityId },
          role: 'leader',
          holderPersonId: leaderId,
          active: true,
          startYear: 1,
          slotIndex: 0,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          ...ctx.state.officeIndex.byOrganization,
          [`polity:${polityId}`]: [officeId],
        },
        byHolderPerson: {
          ...ctx.state.officeIndex.byHolderPerson,
          [leaderId as string]: [officeId],
        },
      },
    }

    // leader に assign された active Task + それを activeTaskId で追跡する owner Aim
    const taskId = 'task-exec-1' as TaskId
    const aimId = 'aim-exec-1' as AimId
    const owner = { kind: 'house' as const, id: createHouseId('h', 0) }
    const task = {
      id: taskId,
      owner,
      assigneePersonId: leaderId,
      kind: 'advance_project' as const,
      targetRef: { kind: 'aim' as const, id: aimId },
      priority: 1,
      actionCost: 1,
      effortRequired: 10,
      effortDone: 0,
      createdWeek: 48000,
      status: 'active' as const,
      reasonIds: [],
      difficulty: 30,
      relevantAbility: 'numeracy' as const,
    } as Task
    state = { ...state, tasks: { ...state.tasks, [taskId]: task } }
    addTaskToIndicesMut(state, task)
    const aim = {
      id: aimId,
      owner,
      kind: 'develop_owned_holding',
      status: 'active',
      activeTaskId: taskId,
      reasonIds: [],
    } as unknown as Aim
    state = {
      ...state,
      aims: { ...state.aims, [aimId]: aim },
      aimIndex: {
        ...state.aimIndex,
        byOwner: {
          ...state.aimIndex.byOwner,
          [`house:${owner.id}`]: [aimId],
        },
      },
    }

    const result = dissolveNegotiatingCommonwealth(
      { ...ctx, state },
      {
        commonwealthPolityId: polityId,
        leaderOutcome: 'executed',
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const nextState = result.value.ctx.state

    expect(nextState.persons[leaderId]!.alive).toBe(false)
    // Task は削除され index からも消える
    expect(nextState.tasks[taskId]).toBeUndefined()
    expect(nextState.taskIndex.byAssignee[leaderId as string] ?? []).not.toContain(taskId)
    // Aim の activeTaskId は解除される (dangling 参照を残さない)
    expect(nextState.aims[aimId]!.activeTaskId).toBeUndefined()
  })
})
