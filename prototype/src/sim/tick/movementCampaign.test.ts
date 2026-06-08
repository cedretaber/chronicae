// 影響力個人中心化 Phase 1b: 運動 Project の load-bearing テスト。
// - handlePrepareProjectCompletionMut が supervisor = sponsoredPersonId に固定する
//   (auto 選定を bypass。漏れると評判が別人に付き dual-tag が誤キャリアに流入する沈黙バグ)
// - 完遂で sponsoredPersonId に dual-tag 評判 2 件 (house-tag + polity-tag) が付く

import { describe, expect, it } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { TickContext } from './context'
import { toResult } from './context'
import type { WorldState } from '../types/world'
import type { Aim } from '../types/goal'
import type { MovementCampaignProject } from '../types/project'
import { createAimId, createHouseId, createPersonId, createPolityId } from '../types/ids'
import {
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { handlePrepareProjectCompletionMut } from './taskProjectCompletion'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
import { personReputationOrganizationKey } from '../types/personReputation'

const polityId = createPolityId('c', 0)
const houseId = createHouseId('h', 0)
const provinceId = createPolityId('p', 0) as never
const memberA = createPersonId('pe', 1)
const memberB = createPersonId('pe', 2)

function makeState(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, provinceId, { nameKey: 'P0' })
  s = withHouse(s, houseId, { nameKey: 'House0', wealth: 100, memberIds: [memberA, memberB] })
  s = withPerson(s, memberA, { nameKey: 'MemberA', houseId, age: 40 })
  s = withPerson(s, memberB, { nameKey: 'MemberB', houseId, age: 35 })
  s = withPolity(s, polityId, { ownerHouseId: houseId, capitalProvinceId: provinceId })
  s = bindProvinceToHouseViaPolity(s, provinceId, polityId, houseId)
  return s
}

function makeAim(): Aim {
  return {
    id: createAimId(0),
    owner: { kind: 'house', id: houseId },
    origin: { kind: 'goal', goalId: undefined } as never,
    kind: 'start_movement_campaign',
    target: { kind: 'polity', id: polityId },
    priority: 50,
    progress: 0,
    targetProgress: 100,
    createdWeek: 0,
    deadlineWeek: 10000,
    successfulProjectCount: 0,
    failedProjectCount: 0,
    reasonIds: [],
  } as unknown as Aim
}

describe('movement_campaign: supervisor 固定 (Phase 1b load-bearing)', () => {
  it('handlePrepareProjectCompletionMut が supervisor = sponsoredPersonId にする', () => {
    const ws = makeState()
    handlePrepareProjectCompletionMut(
      ws,
      defaultConfig,
      makeAim(),
      memberA,
      100,
      () => {},
      'success',
    )
    const project = Object.values(ws.projects).find(
      (p): p is MovementCampaignProject => p?.kind === 'movement_campaign',
    )
    expect(project).toBeDefined()
    expect(project!.supervisorPersonId).toBe(project!.sponsoredPersonId)
    expect(project!.owner).toEqual({ kind: 'house', id: houseId })
    expect(project!.targetPolityId).toBe(polityId)
  })

  it('完遂で sponsoredPersonId に dual-tag 評判 2 件 (house + polity) が付く', () => {
    const ws = makeState()
    handlePrepareProjectCompletionMut(
      ws,
      defaultConfig,
      makeAim(),
      memberA,
      100,
      () => {},
      'success',
    )
    const created = Object.values(ws.projects).find(
      (p): p is MovementCampaignProject => p?.kind === 'movement_campaign',
    )!
    const sponsored = created.sponsoredPersonId
    // 完遂状態にして outcome system を走らせる
    ws.projects[created.id] = { ...created, status: 'completed', terminalReason: 'completed' }

    const ctx: TickContext = {
      state: ws,
      rng: createRng('movement-test'),
      config: defaultConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 0,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }
    const result = toResult(runProjectOutcomeSystem(ctx))

    const repIds = result.state.personReputationIndex.byPerson[sponsored] ?? []
    expect(repIds).toHaveLength(2)
    const orgKeys = repIds
      .map((id) => result.state.personReputations[id]?.relatedOrganization)
      .filter((o): o is NonNullable<typeof o> => o !== undefined)
      .map((o) => personReputationOrganizationKey(o))
      .sort()
    expect(orgKeys).toEqual([`house:${houseId}`, `polity:${polityId}`].sort())
  })
})
