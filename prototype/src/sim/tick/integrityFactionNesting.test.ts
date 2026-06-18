import { describe, it, expect } from 'vitest'
import { collectIntegrityErrors } from './integritySystem'
import { defaultConfig } from '../config/defaultConfig'
import {
  makeEmptyV016State,
  withProvince,
  withHouse,
  withPolity,
  withPerson,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import {
  createFactionId,
  createFactionMembershipId,
  createHouseId,
  createPersonId,
  createPolityId,
  createProvinceId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { Faction, FactionMembership, FactionIndex } from '../types/faction'

// 入れ子 F9 invariant の liveness 検証: 壊した状態で F9 が実際に error を出すことを確認する。
// (これが無いと「150×4 clean」は F9 が常時 vacuous に通っている可能性と区別できない。)
function buildTwoFactionState(opts: {
  childParent: ReturnType<typeof createFactionId> | undefined
  byParentChildren: ReturnType<typeof createFactionId>[]
  parentActive: boolean
}): WorldState {
  const provinceId = createProvinceId('p', 0)
  const polityId = createPolityId('dp', 0)
  const houseId = createHouseId('dh', 0)
  const pLeader = createPersonId('pe', 0)
  const cLeader = createPersonId('pe', 1)
  const parentId = createFactionId(0)
  const childId = createFactionId(1)
  const pMembership = createFactionMembershipId(0)
  const cMembership = createFactionMembershipId(1)

  let state = makeEmptyV016State()
  state = { ...state, absoluteWeek: 1000 }
  state = withProvince(state, provinceId, { nameKey: 'Province0' })
  state = withHouse(state, houseId, {
    nameKey: 'House0',
    memberIds: [pLeader, cLeader],
    seatProvinceId: provinceId,
  })
  state = withPolity(state, polityId, { ownerHouseId: houseId, capitalProvinceId: provinceId })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  state = withPerson(state, pLeader, { nameKey: 'P', houseId, alive: true })
  state = withPerson(state, cLeader, { nameKey: 'C', houseId, alive: true })

  const parent: Faction = {
    id: parentId,
    leaderPersonId: pLeader,
    polityId,
    active: opts.parentActive,
    foundingWeek: 0,
  }
  const child: Faction = {
    id: childId,
    leaderPersonId: cLeader,
    polityId,
    active: true,
    foundingWeek: 0,
    ...(opts.childParent !== undefined ? { parentFactionId: opts.childParent } : {}),
  }
  const pM: FactionMembership = {
    id: pMembership,
    factionId: parentId,
    personId: pLeader,
    active: true,
    joinedWeek: 0,
    lastActiveWeek: 0,
  }
  const cM: FactionMembership = {
    id: cMembership,
    factionId: childId,
    personId: cLeader,
    active: true,
    joinedWeek: 0,
    lastActiveWeek: 0,
  }
  const factionIndex: FactionIndex = {
    byLeader: { [pLeader]: [parentId], [cLeader]: [childId] },
    byMember: { [pLeader]: [pMembership], [cLeader]: [cMembership] },
    byPolity: { [polityId]: [parentId, childId] },
    byParent: opts.byParentChildren.length > 0 ? { [parentId]: opts.byParentChildren } : {},
  }
  return {
    ...state,
    factions: { [parentId]: parent, [childId]: child },
    factionMemberships: { [pMembership]: pM, [cMembership]: cM },
    factionIndex,
  }
}

const PARENT = createFactionId(0)

function hasF9(state: WorldState): boolean {
  const errors = collectIntegrityErrors(state, { debug: false, config: defaultConfig })
  return errors.some((e) => e.message.includes('F9'))
}

describe('入れ子 F9 invariant liveness', () => {
  it('正常な親子関係 (child→active parent + byParent 同期) では F9 が出ない', () => {
    const state = buildTwoFactionState({
      childParent: PARENT,
      byParentChildren: [createFactionId(1)],
      parentActive: true,
    })
    expect(hasF9(state)).toBe(false)
  })

  it('child の parentFactionId が inactive な親を指すと F9 が出る', () => {
    const state = buildTwoFactionState({
      childParent: PARENT,
      byParentChildren: [createFactionId(1)],
      parentActive: false,
    })
    expect(hasF9(state)).toBe(true)
  })

  it('byParent[P] に child があるのに child.parentFactionId が一致しないと F9 (index 同期) が出る', () => {
    // child は root (parentFactionId undefined) なのに byParent[P]=[child] で desync。
    const state = buildTwoFactionState({
      childParent: undefined,
      byParentChildren: [createFactionId(1)],
      parentActive: true,
    })
    expect(hasF9(state)).toBe(true)
  })

  it('child→parent だが byParent index に載っていないと F9 (index 欠落) が出る', () => {
    const state = buildTwoFactionState({
      childParent: PARENT,
      byParentChildren: [],
      parentActive: true,
    })
    expect(hasF9(state)).toBe(true)
  })
})
