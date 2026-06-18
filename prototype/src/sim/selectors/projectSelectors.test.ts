import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withHouse, withPerson, withPolity, withAim } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { selectProjectSupervisor, selectProjectCreator } from './projectSelectors'
import type { WorldState } from '../types/world'
import type {
  AimId,
  FactionId,
  FactionMembershipId,
  HouseId,
  PersonId,
  PolityId,
} from '../types/ids'

// ─── 派閥 (客分・食客) の supervisor 候補参加 (§12.4: 介入は anchor Polity のみ) ──

const POLITY = 'c-p' as PolityId
const OWNER_HOUSE = 'hh-o' as HouseId
const CLIENT_HOUSE = 'hh-x' as HouseId
const CREATOR = 'pe-creator' as PersonId
const CLIENT = 'pe-client' as PersonId
const PATRON = 'pe-patron' as PersonId

function withFaction(
  ws: WorldState,
  factionId: FactionId,
  leaderPersonId: PersonId,
  anchorPolityId: PolityId,
  memberIds: PersonId[],
): WorldState {
  const next: WorldState = {
    ...ws,
    factions: {
      ...ws.factions,
      [factionId]: {
        id: factionId,
        leaderPersonId,
        polityId: anchorPolityId,
        active: true,
        foundingWeek: 0,
      },
    },
    factionMemberships: { ...ws.factionMemberships },
    factionIndex: {
      byParent: {},
      byLeader: {
        ...ws.factionIndex.byLeader,
        [leaderPersonId]: [...(ws.factionIndex.byLeader[leaderPersonId] ?? []), factionId],
      },
      byMember: { ...ws.factionIndex.byMember },
      byPolity: {
        ...ws.factionIndex.byPolity,
        [anchorPolityId]: [...(ws.factionIndex.byPolity[anchorPolityId] ?? []), factionId],
      },
    },
  }
  for (const [i, pid] of memberIds.entries()) {
    const fmId = `fm-${factionId}-${i}` as FactionMembershipId
    next.factionMemberships[fmId] = {
      id: fmId,
      factionId,
      personId: pid,
      active: true,
      joinedWeek: 0,
    }
    next.factionIndex.byMember[pid] = [...(next.factionIndex.byMember[pid] ?? []), fmId]
  }
  return next
}

// owner 家には creator しかいない (creator は supervisor 候補から除外される) 状態を作り、
// 派閥経由でしか候補が湧かないようにする
function makeBaseState(): WorldState {
  let ws = makeEmptyV016State()
  ws = withHouse(ws, OWNER_HOUSE)
  ws = withHouse(ws, CLIENT_HOUSE)
  ws = withPolity(ws, POLITY, { ownerHouseId: OWNER_HOUSE })
  ws = withPerson(ws, CREATOR, { houseId: OWNER_HOUSE })
  ws = withPerson(ws, PATRON, { houseId: CLIENT_HOUSE })
  ws = withPerson(ws, CLIENT, { houseId: CLIENT_HOUSE })
  return ws
}

describe('selectProjectSupervisor の派閥 (食客) 候補', () => {
  it('polity の Project: anchor された派閥のメンバーが候補に入る', () => {
    let ws = makeBaseState()
    ws = withFaction(ws, 'f-1' as FactionId, PATRON, POLITY, [CLIENT])

    const result = selectProjectSupervisor(
      ws,
      defaultConfig,
      { kind: 'polity', id: POLITY },
      'develop_holding',
      CREATOR,
    )

    expect(result).toBe(CLIENT)
  })

  it('polity の Project: anchor が別 polity の派閥メンバーは候補にならない', () => {
    let ws = makeBaseState()
    const otherPolity = 'c-q' as PolityId
    ws = withPolity(ws, otherPolity, {})
    ws = withFaction(ws, 'f-1' as FactionId, PATRON, otherPolity, [CLIENT])

    const result = selectProjectSupervisor(
      ws,
      defaultConfig,
      { kind: 'polity', id: POLITY },
      'develop_holding',
      CREATOR,
    )

    expect(result).toBeUndefined()
  })

  it('house の Project: 家のメンバーが率いる派閥のメンバー (家の食客) が候補に入る', () => {
    let ws = makeBaseState()
    // creator (owner 家唯一の生存メンバー) 自身が派閥を率いる → その食客が家の仕事の候補に
    ws = withFaction(ws, 'f-2' as FactionId, CREATOR, POLITY, [CLIENT])

    const result = selectProjectSupervisor(
      ws,
      defaultConfig,
      { kind: 'house', id: OWNER_HOUSE },
      'patronize_artist',
      CREATOR,
    )

    expect(result).toBe(CLIENT)
  })

  it('house の Project: 家と無関係な派閥のメンバーは候補にならない', () => {
    let ws = makeBaseState()
    // patron (他家) が率いる派閥 → owner 家の食客ではない
    ws = withFaction(ws, 'f-3' as FactionId, PATRON, POLITY, [CLIENT])

    const result = selectProjectSupervisor(
      ws,
      defaultConfig,
      { kind: 'house', id: OWNER_HOUSE },
      'patronize_artist',
      CREATOR,
    )

    expect(result).toBeUndefined()
  })
})

// ─── v0.45.3 性別役職適格ゲート ───

describe('selectProjectSupervisor の性別役職適格ゲート (v0.45.3)', () => {
  function makeFemaleClientState(): WorldState {
    let ws = makeEmptyV016State()
    ws = withHouse(ws, OWNER_HOUSE)
    ws = withHouse(ws, CLIENT_HOUSE)
    ws = withPolity(ws, POLITY, { ownerHouseId: OWNER_HOUSE })
    ws = withPerson(ws, CREATOR, { houseId: OWNER_HOUSE })
    ws = withPerson(ws, PATRON, { houseId: CLIENT_HOUSE })
    ws = withPerson(ws, CLIENT, { houseId: CLIENT_HOUSE, sex: 'female' })
    return withFaction(ws, 'f-1' as FactionId, PATRON, POLITY, [CLIENT])
  }

  it('不適格な female 候補のみ + fallback off → supervisor なし', () => {
    const config = {
      ...defaultConfig,
      femaleRoleEligibilityChance: 0,
      allowFemaleRolesWhenNoMaleCandidate: false,
    }
    const result = selectProjectSupervisor(
      makeFemaleClientState(),
      config,
      { kind: 'polity', id: POLITY },
      'develop_holding',
      CREATOR,
    )
    expect(result).toBeUndefined()
  })

  it('不適格な female 候補のみ + fallback on → ungated 再試行で選ばれる', () => {
    const config = {
      ...defaultConfig,
      femaleRoleEligibilityChance: 0,
      allowFemaleRolesWhenNoMaleCandidate: true,
    }
    const result = selectProjectSupervisor(
      makeFemaleClientState(),
      config,
      { kind: 'polity', id: POLITY },
      'develop_holding',
      CREATOR,
    )
    expect(result).toBe(CLIENT)
  })
})

// ─── established commonwealth (共和国) の Goal 駆動 Project creator 解決 ───
// 共和国は ownerHouse を持たないため getPolityHouseIds が空 → 旧実装では
// getCandidatePersonIds が空配列を返し selectProjectCreator が undefined になり、
// goalMaintenance → aim まで進んでも projectPreparation が creator 不在で永久に
// Project を生成できなかった。republic 候補プールを creator 母集合に union して解消する。

describe('selectProjectCreator: established commonwealth の Goal 駆動 Project', () => {
  function makeCommonwealthAimState(): { ws: WorldState; aimId: AimId } {
    let ws = makeEmptyV016State()
    ws = withHouse(ws, 'hh-cw' as HouseId)
    ws = withPolity(ws, 'dp-cw' as PolityId, {
      kind: 'commonwealth',
      revoltState: { kind: 'established' },
    })
    // 共和国市民: 家を持つが何も支配しない (= recruitable outsider として republic 候補プールに入る)
    ws = withPerson(ws, 'pe-citizen' as PersonId, { houseId: 'hh-cw' as HouseId })
    const aimId = 'am-cw' as AimId
    ws = withAim(ws, aimId, { kind: 'polity', id: 'dp-cw' as PolityId }, 'develop_owned_holding')
    return { ws, aimId }
  }

  it('共和国 polity の aim は republic 候補プールから creator を選べる', () => {
    const { ws, aimId } = makeCommonwealthAimState()
    const aim = ws.aims[aimId]
    expect(aim).toBeDefined()
    if (!aim) return

    const creator = selectProjectCreator(ws, defaultConfig, aim)

    expect(creator).toBe('pe-citizen' as PersonId)
  })
})
