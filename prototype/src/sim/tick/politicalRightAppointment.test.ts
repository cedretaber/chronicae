// v0.42 §9 polity_office_appointment right と appointmentSystem の接続テスト (spec §20.1)。
// - right holder House の candidate が bonus を受けて任命される
// - primary / owner でない right holder House の member が候補 pool に入る
// - right がある role では unrelated factional path が使われない
// - right-backed faction bonus が反映される (5 段階選定)
// - right-based appointee が organizationConsistency で revoke されない (§9.4 — 最重要罠)

import { describe, expect, it } from 'vitest'
import {
  createPolityId,
  createHouseId,
  createPersonId,
  createProvinceId,
  createFactionId,
  createFactionMembershipId,
} from '../types/ids'
import type { PolityId, PersonId, FactionId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext, toResult } from './context'
import { runAppointmentSystem, selectRightBackedFaction } from './appointmentSystem'
import { runOrganizationConsistencySystem } from './organizationConsistencySystem'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import { createOfficeAssignment } from '../mutations/officeMutations'
import type { OfficeRole } from '../types/office'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
} from '../testFixtures'

const polityId = createPolityId('c', 0)
const ownerHouseId = createHouseId('h', 0)
const rightHouseId = createHouseId('h', 1) // 土地なし・primary でも owner でもない
const rulerId = createPersonId('pe', 0)
const ownerCandidateId = createPersonId('pe', 1)
const rightCandidateId = createPersonId('pe', 2)
const provinceId = createProvinceId('p', 0)

function makeState(): WorldState {
  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  state = withProvince(state, provinceId, { nameKey: 'Province0' })
  state = withHouse(state, ownerHouseId, {
    nameKey: 'OwnerHouse',
    memberIds: [rulerId, ownerCandidateId],
    legacyPrestige: 50,
    seatProvinceId: provinceId,
  })
  state = withHouse(state, rightHouseId, {
    nameKey: 'RightHouse',
    memberIds: [rightCandidateId],
    legacyPrestige: 50,
    seatProvinceId: provinceId,
  })
  state = withPolity(state, polityId, {
    ownerHouseId,
    treasury: 100,
    capitalProvinceId: provinceId,
    rank: 1,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, ownerHouseId)
  state = withPerson(state, rulerId, { nameKey: 'Ruler', houseId: ownerHouseId })
  // ownerCandidate は能力が高い (right がなければこちらが勝つ)
  state = withPerson(state, ownerCandidateId, {
    nameKey: 'OwnerCandidate',
    houseId: ownerHouseId,
    abilities: { valor: 50, command: 50, numeracy: 80, learning: 80, charisma: 60, insight: 60 },
    legacyPrestige: 40,
  })
  // rightCandidate は能力が並 (bonus がないと負ける)
  state = withPerson(state, rightCandidateId, {
    nameKey: 'RightCandidate',
    houseId: rightHouseId,
    legacyPrestige: 10,
  })
  state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', rulerId)
  return state
}

function grantOfficeRight(state: WorldState, role: OfficeRole = 'administrator'): WorldState {
  const result = createPoliticalRight(state, {
    polityId,
    target: { kind: 'polity_office_role', polityId, role, slotIndex: 0 },
    holder: { kind: 'house', id: rightHouseId },
    grantedWeek: state.absoluteWeek,
  })
  if (!result.ok) throw new Error('setup failed: ' + result.error.message)
  return result.value.state
}

function buildCtx(state: WorldState, config: SimulationConfig = defaultConfig) {
  return createTickContext({ state, rng: createRng('test'), config })
}

function officeHolder(state: WorldState, role: OfficeRole): PersonId | undefined {
  const ids = state.officeIndex.byOrganization[`polity:${polityId}`] ?? []
  for (const id of ids) {
    const o = state.officeAssignments[id]
    if (o && o.active && o.role === role) return o.holderPersonId
  }
  return undefined
}

describe('appointment right integration (§9)', () => {
  it('right holder house member enters the pool and wins with the bonus', () => {
    // right なし → 高能力の ownerCandidate が administrator になる
    const without = toResult(runAppointmentSystem(buildCtx(makeState())))
    expect(officeHolder(without.state, 'administrator')).toBe(ownerCandidateId)

    // right あり → 土地なし RightHouse の並能力 member が bonus で勝つ
    const withRight = toResult(runAppointmentSystem(buildCtx(grantOfficeRight(makeState()))))
    expect(officeHolder(withRight.state, 'administrator')).toBe(rightCandidateId)
  })

  it('skips the unrelated factional path when a right exists (§9.3)', () => {
    // 強い nomination power を持つ無関係 faction を立てる
    let state = grantOfficeRight(makeState())
    const factionId = createFactionId(0)
    const factionLeaderId = createPersonId('pe', 10)
    state = withPerson(state, factionLeaderId, {
      nameKey: 'FactionLeader',
      houseId: ownerHouseId,
      wealth: 1000,
      legacyPrestige: 80,
    })
    state = addFactionWithMembers(state, factionId, factionLeaderId, [])

    const config: SimulationConfig = { ...defaultConfig, factionNominationPowerThreshold: 0 }
    const result = toResult(runAppointmentSystem(buildCtx(state, config)))
    // factional path が動いていれば factionLeader が administrator になりうるが、
    // right があるため right holder house の候補が選ばれる
    expect(officeHolder(result.state, 'administrator')).toBe(rightCandidateId)
  })

  it('applies the right-backed faction bonus to members of the selected faction (§9.3)', () => {
    let state = grantOfficeRight(makeState())
    // rightHouse の leader (rightCandidate しかいないので leader = rightCandidate) が
    // 所属する anchor faction を作る
    const factionId = createFactionId(0)
    state = addFactionWithMembers(state, factionId, rightCandidateId, [])
    const right = Object.values(state.politicalRights)[0]!
    expect(selectRightBackedFaction(state, polityId, right)).toBe(factionId)

    // 別 polity に anchor された faction は選ばれない
    const otherPolityId = createPolityId('c', 9)
    let stateOther = withPolity(grantOfficeRight(makeState()), otherPolityId, {})
    const otherFactionId = createFactionId(1)
    stateOther = addFactionWithMembers(
      stateOther,
      otherFactionId,
      rightCandidateId,
      [],
      otherPolityId,
    )
    const right2 = Object.values(stateOther.politicalRights)[0]!
    expect(selectRightBackedFaction(stateOther, polityId, right2)).toBeUndefined()
  })

  it('right-based appointee is NOT revoked by organizationConsistency (§9.4)', () => {
    const appointed = toResult(runAppointmentSystem(buildCtx(grantOfficeRight(makeState()))))
    expect(officeHolder(appointed.state, 'administrator')).toBe(rightCandidateId)

    // RightHouse は土地なし = eligibleHouseIds 外。right が無ければ revoke される状況。
    const after = runOrganizationConsistencySystem(buildCtx(appointed.state))
    expect(officeHolder(after.state, 'administrator')).toBe(rightCandidateId)

    // 対照: right を取り除くと revoke される
    const stripped: WorldState = {
      ...appointed.state,
      politicalRights: {},
      politicalRightIndex: { byPolity: {}, byHolder: {}, byTarget: {} },
    }
    const revoked = runOrganizationConsistencySystem(buildCtx(stripped))
    expect(officeHolder(revoked.state, 'administrator')).toBeUndefined()
  })

  it('person-holder right protects only the person, not housemates (§9.4 狭い判定)', () => {
    // person holder right で本人を任命した状態を直接構築
    let state = makeState()
    const created = createPoliticalRight(state, {
      polityId,
      target: { kind: 'polity_office_role', polityId, role: 'administrator', slotIndex: 0 },
      holder: { kind: 'person', id: rightCandidateId },
      grantedWeek: state.absoluteWeek,
    })
    if (!created.ok) throw new Error('setup failed')
    state = created.value.state
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      rightCandidateId,
    )
    const kept = runOrganizationConsistencySystem(buildCtx(state))
    expect(officeHolder(kept.state, 'administrator')).toBe(rightCandidateId)

    // 同 House の別人 (holder 本人でない) は保護されない
    const housemateId = createPersonId('pe', 20)
    let state2 = makeState()
    state2 = withPerson(state2, housemateId, { nameKey: 'Housemate', houseId: rightHouseId })
    const created2 = createPoliticalRight(state2, {
      polityId,
      target: { kind: 'polity_office_role', polityId, role: 'administrator', slotIndex: 0 },
      holder: { kind: 'person', id: rightCandidateId },
      grantedWeek: state2.absoluteWeek,
    })
    if (!created2.ok) throw new Error('setup failed')
    state2 = createOfficeAssignment(
      created2.value.state,
      { kind: 'polity', id: polityId },
      'administrator',
      housemateId,
    )
    const revoked = runOrganizationConsistencySystem(buildCtx(state2))
    expect(officeHolder(revoked.state, 'administrator')).toBeUndefined()
  })
})

// faction + leader membership + members を直接構築する test helper
function addFactionWithMembers(
  state: WorldState,
  factionId: FactionId,
  leaderPersonId: PersonId,
  memberIds: PersonId[],
  anchorPolityId: PolityId = polityId,
): WorldState {
  const week = state.absoluteWeek
  const leaderMembershipId = createFactionMembershipId(state.nextFactionMembershipId)
  let next: WorldState = {
    ...state,
    factions: {
      ...state.factions,
      [factionId]: {
        id: factionId,
        leaderPersonId,
        polityId: anchorPolityId,
        active: true,
        foundingWeek: week,
      },
    },
    factionMemberships: {
      ...state.factionMemberships,
      [leaderMembershipId]: {
        id: leaderMembershipId,
        factionId,
        personId: leaderPersonId,
        active: true,
        joinedWeek: week,
      },
    },
    factionIndex: {
      byLeader: {
        ...state.factionIndex.byLeader,
        [leaderPersonId]: [...(state.factionIndex.byLeader[leaderPersonId] ?? []), factionId],
      },
      byMember: {
        ...state.factionIndex.byMember,
        [leaderPersonId]: [
          ...(state.factionIndex.byMember[leaderPersonId] ?? []),
          leaderMembershipId,
        ],
      },
      byPolity: {
        ...state.factionIndex.byPolity,
        [anchorPolityId]: [...(state.factionIndex.byPolity[anchorPolityId] ?? []), factionId],
      },
    },
    nextFactionMembershipId: state.nextFactionMembershipId + 1,
  }
  for (const mid of memberIds) {
    const membershipId = createFactionMembershipId(next.nextFactionMembershipId)
    next = {
      ...next,
      factionMemberships: {
        ...next.factionMemberships,
        [membershipId]: {
          id: membershipId,
          factionId,
          personId: mid,
          active: true,
          joinedWeek: week,
        },
      },
      factionIndex: {
        ...next.factionIndex,
        byMember: {
          ...next.factionIndex.byMember,
          [mid]: [...(next.factionIndex.byMember[mid] ?? []), membershipId],
        },
      },
      nextFactionMembershipId: next.nextFactionMembershipId + 1,
    }
  }
  return next
}
