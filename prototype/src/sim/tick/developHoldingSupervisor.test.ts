// v0.42 §10 のテスト (spec §20.1)。
// - develop_holding find_supervisor が bailiff slot を変更しないこと (§10.3 — 直接任命の廃止)
// - supervisor が bailiff でなくても stage が進むこと
// - bailiffAppointmentSystem の Tier 0 (holding_office_appointment right holder) が機能すること
// - Tier 0 が候補を出せない場合に ownerHouse へ fall-through すること (§10.2)

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createProjectId,
} from '../types/ids'
import type { HoldingId, PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { DevelopHoldingProject } from '../types/project'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runProjectStageSystem } from './projectStageSystem'
import { runBailiffAppointmentSystem } from './bailiffAppointmentSystem'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import { installHoldingPlaceholderBailiff } from '../mutations/provinceOfficeMutations'
import { PLACEHOLDER_PERSON_ID } from '../types/person'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'

const polityId = createPolityId('dp', 0)
const ownerHouseId = createHouseId('dh', 0)
const rightHouseId = createHouseId('dh', 1)
const ownerAdultId = createPersonId('pe', 0)
const rightAdultId = createPersonId('pe', 1)
const provinceId = createProvinceId('p', 0)

function makeState(): { state: WorldState; holdingId: HoldingId } {
  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  state = withProvince(state, provinceId, { nameKey: 'Province0' })
  state = withHouse(state, ownerHouseId, { nameKey: 'OwnerHouse', seatProvinceId: provinceId })
  state = withHouse(state, rightHouseId, { nameKey: 'RightHouse', seatProvinceId: provinceId })
  state = withPerson(state, ownerAdultId, { houseId: ownerHouseId, age: 30 })
  state = withPerson(state, rightAdultId, { houseId: rightHouseId, age: 30 })
  state = withPolity(state, polityId, { ownerHouseId, capitalProvinceId: provinceId })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, ownerHouseId)
  const holdingId = state.provinces[provinceId]!.holdingIds[0]!
  // placeholder bailiff を据える (worldgen 相当)
  state = installHoldingPlaceholderBailiff(state, {
    holdingId,
    appointingPolityId: polityId,
    week: state.absoluteWeek,
  })
  return { state, holdingId }
}

function makeCtx(state: WorldState): TickContext {
  return {
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
}

function bailiffHolder(state: WorldState, holdingId: HoldingId): PersonId | undefined {
  const officeId = state.holdingOfficeIndex.byHolding[holdingId]
  if (!officeId) return undefined
  return state.holdingOfficeAssignments[officeId]?.holderPersonId
}

describe('develop_holding find_supervisor (§10.3)', () => {
  it('does not mutate the bailiff slot and still advances with a non-bailiff supervisor', () => {
    const { state: base, holdingId } = makeState()
    const projectId = createProjectId(0)
    const project: DevelopHoldingProject = {
      id: projectId,
      owner: { kind: 'polity', id: polityId },
      origin: { kind: 'system', reasonKey: 'test' },
      kind: 'develop_holding',
      creatorPersonId: ownerAdultId,
      supervisorPersonId: ownerAdultId,
      status: 'active',
      progress: 0,
      targetProgress: 100,
      currentStageKey: 'find_supervisor',
      createdWeek: base.absoluteWeek,
      deadlineWeek: base.absoluteWeek + 48,
      reasonIds: [],
      holdingId,
      improvementKind: 'irrigation_infrastructure',
      targetImprovementLevel: 1,
      budget: { required: 10, allocated: 10, remaining: 10, spent: 0, source: { kind: 'owner' } },
    }
    const state: WorldState = {
      ...base,
      projects: { [projectId]: project },
      projectIndex: {
        ...base.projectIndex,
        byOwner: { [`polity:${polityId}`]: [projectId] },
      },
    }

    const before = bailiffHolder(state, holdingId)
    expect(before).toBe(PLACEHOLDER_PERSON_ID)

    const result = runProjectStageSystem(makeCtx(state))

    // bailiff slot は placeholder のまま (project 経由で変化しない)
    expect(bailiffHolder(result.state, holdingId)).toBe(PLACEHOLDER_PERSON_ID)
    // supervisor は候補から選ばれ、stage が進む
    const after = result.state.projects[projectId]!
    expect(after.currentStageKey).not.toBe('find_supervisor')
    expect(after.supervisorPersonId).toBe(ownerAdultId)
  })
})

describe('bailiffAppointmentSystem Tier 0 (§10.2)', () => {
  it('appoints the right holder house member over the owner house fallback', () => {
    const { state: base, holdingId } = makeState()
    const created = createPoliticalRight(base, {
      polityId,
      target: { kind: 'holding_office_role', holdingId, role: 'bailiff' },
      holder: { kind: 'house', id: rightHouseId },
      grantedWeek: base.absoluteWeek,
    })
    if (!created.ok) throw new Error('setup failed: ' + created.error.message)

    const result = runBailiffAppointmentSystem(makeCtx(created.value.state))
    expect(bailiffHolder(result.state, holdingId)).toBe(rightAdultId)
  })

  it('falls through to the owner house when the right holder has no eligible candidate', () => {
    const { state: base, holdingId } = makeState()
    // rightHouse の唯一の adult を死亡させる
    let state = {
      ...base,
      persons: {
        ...base.persons,
        [rightAdultId]: { ...base.persons[rightAdultId]!, alive: false },
      },
      livingPersonIds: base.livingPersonIds.filter((id) => id !== rightAdultId),
    }
    const created = createPoliticalRight(state, {
      polityId,
      target: { kind: 'holding_office_role', holdingId, role: 'bailiff' },
      holder: { kind: 'house', id: rightHouseId },
      grantedWeek: state.absoluteWeek,
    })
    if (!created.ok) throw new Error('setup failed: ' + created.error.message)
    state = created.value.state

    const result = runBailiffAppointmentSystem(makeCtx(state))
    // fall-through で ownerHouse の free adult が任命される (§10.2 — 行政実務を止めない)
    expect(bailiffHolder(result.state, holdingId)).toBe(ownerAdultId)
  })
})
