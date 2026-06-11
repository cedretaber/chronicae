// §6.32 OrganizationConsistencySystem の Polity Office 保持資格監査 (Step 2) の回帰テスト。
// 主眼は「無家だが active 派閥に所属する役職者は revoke されない」(v0.47.x 修正)。
// 旧実装は houseless 分岐で派閥を見ずに無条件 revoke しており、§6.32 の不変条件
// (1158 行「active な派閥に所属する人物は eligible」) を houseless だけ取りこぼしていた。
// factional 任命経路 (getFactionalCandidateScore は house ゲートなし) で着座した無家派閥員が
// 誤って解任されるバグの再発防止。

import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PersonId, HouseId } from '../types/ids'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext } from './context'
import { runOrganizationConsistencySystem } from './organizationConsistencySystem'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { createFaction } from '../mutations/factionMutations'
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
const otherHouseId = createHouseId('h', 1) // 当該 polity に領地を持たない (eligible でない)
const rulerId = createPersonId('pe', 0)
const houselessId = createPersonId('pe', 1)
const otherMemberId = createPersonId('pe', 2)
const provinceId = createProvinceId('p', 0)

// withPerson は houseId 必須なので一旦付与してから外して houseless にする (republicSelectors.test と同手法)。
function makeHouseless(state: WorldState, id: PersonId, tempHouseId: HouseId): WorldState {
  let next = withPerson(state, id, { nameKey: 'Houseless', houseId: tempHouseId })
  const person = next.persons[id]
  if (person) {
    const copy: Record<string, unknown> = { ...person }
    delete copy['houseId']
    next = { ...next, persons: { ...next.persons, [id]: copy as typeof person } }
  }
  return next
}

// owner house が領地を持つ通常 polity を作り、administrator 席に無家人物を着座させる。
function makeBaseState(): WorldState {
  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  state = withProvince(state, provinceId, { nameKey: 'Province0' })
  state = withHouse(state, ownerHouseId, {
    nameKey: 'OwnerHouse',
    memberIds: [rulerId],
    seatProvinceId: provinceId,
  })
  state = withHouse(state, otherHouseId, {
    nameKey: 'OtherHouse',
    memberIds: [otherMemberId],
  })
  state = withPolity(state, polityId, {
    ownerHouseId,
    treasury: 100,
    capitalProvinceId: provinceId,
    rank: 1,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, ownerHouseId)
  state = withPerson(state, rulerId, { nameKey: 'Ruler', houseId: ownerHouseId })
  // 無家人物 (houseId なし) を administrator に着座 (factional 任命を再現)
  state = makeHouseless(state, houselessId, otherHouseId)
  state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', rulerId)
  state = createOfficeAssignment(
    state,
    { kind: 'polity', id: polityId },
    'administrator',
    houselessId,
  )
  return state
}

function buildCtx(state: WorldState) {
  return createTickContext({ state, rng: createRng('test'), config: defaultConfig })
}

function activeHolder(state: WorldState, role: string): PersonId | undefined {
  const ids = state.officeIndex.byOrganization[`polity:${polityId}`] ?? []
  for (const id of ids) {
    const o = state.officeAssignments[id]
    if (o && o.active && o.role === role) return o.holderPersonId
  }
  return undefined
}

// 当該人物が active 派閥のリーダー = active membership を持つ状態にする。
function seatInFaction(state: WorldState, personId: PersonId): WorldState {
  const ctx = buildCtx(state)
  const res = createFaction(ctx, { leaderPersonId: personId, polityId, week: state.absoluteWeek })
  if (!res.ok) throw new Error('setup: ' + res.error.message)
  return res.value.ctx.state
}

describe('OrganizationConsistencySystem Step 2 (§6.32)', () => {
  it('retains a houseless office holder who is an active faction member', () => {
    const state = seatInFaction(makeBaseState(), houselessId)
    const after = runOrganizationConsistencySystem(buildCtx(state))
    expect(activeHolder(after.state, 'administrator')).toBe(houselessId)
    expect(after.events.filter((e) => e.type === 'OFFICE_REVOKED')).toHaveLength(0)
  })

  it('revokes a houseless office holder with no faction, using the houseless message', () => {
    const after = runOrganizationConsistencySystem(buildCtx(makeBaseState()))
    expect(activeHolder(after.state, 'administrator')).toBeUndefined()
    const revoked = after.events.filter((e) => e.type === 'OFFICE_REVOKED')
    expect(revoked).toHaveLength(1)
    expect(revoked[0]!.messageKey).toBe('office.revoked_houseless')
  })

  it('revokes a housed holder whose house holds no land here, using the house message', () => {
    let state = makeBaseState()
    // otherHouse (領地なし) の member を treasurer に着座させる。派閥にも属さない。
    state = withPerson(state, otherMemberId, { nameKey: 'OtherMember', houseId: otherHouseId })
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'treasurer',
      otherMemberId,
    )
    // houseless の administrator は派閥に入れて保持させ、treasurer revoke だけを観測する。
    state = seatInFaction(state, houselessId)
    const after = runOrganizationConsistencySystem(buildCtx(state))
    expect(activeHolder(after.state, 'treasurer')).toBeUndefined()
    const revoked = after.events.filter((e) => e.type === 'OFFICE_REVOKED')
    expect(revoked).toHaveLength(1)
    expect(revoked[0]!.messageKey).toBe('office.revoked')
  })
})
