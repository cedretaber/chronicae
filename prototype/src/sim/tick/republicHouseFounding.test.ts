// v0.47 §13 共和国 House 創設 (republic_house_foundation) のユニットテスト。
// established commonwealth の houseless 役職者が register_house で landless House を得る過程を検証。

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createPolityId,
  createProvinceId,
  createProjectId,
  createAimId,
  createGoalId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runProjectStageSystem } from './projectStageSystem'
import { collectIntegrityErrors } from './integritySystem'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { getHouseLeader, getOfficeAssignments } from '../selectors/officeSelectors'
import {
  makeEmptyV016State,
  withPolity,
  withProvince,
  withGoal,
  DEFAULT_ABILITIES,
} from '../testFixtures'
import type { RepublicHouseFoundationProject } from '../types/project'
import type { Aim } from '../types/goal'
import type { Person } from '../types/person'

const officerId = createPersonId('pe', 0)
const commonwealthId = createPolityId('dp', 0)
const provinceId = createProvinceId('p', 0)

function makeRepublicState(): WorldState {
  let s = makeEmptyV016State()
  s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  s = withProvince(s, provinceId, { nameKey: 'Province0' })
  // established commonwealth (共和国)。
  s = withPolity(s, commonwealthId, {
    rank: 5,
    kind: 'commonwealth',
    capitalProvinceId: provinceId,
    revoltState: { kind: 'established' },
  })
  // houseless 役職者 (administrator)・wealth 十分。
  const officer: Person = {
    id: officerId,
    nameKey: 'Officer',
    sex: 'male',
    age: 40,
    lifeStage: 'mature_adulthood',
    alive: true,
    childIds: [],
    birthStatus: 'legitimate',
    abilities: { ...DEFAULT_ABILITIES },
    aptitudes: { ...DEFAULT_ABILITIES },
    traits: { ambition: 0.8, caution: 0.4 },
    legacyPrestige: 0,
    wealth: 500,
    attitudes: {},
  }
  s = {
    ...s,
    persons: { ...s.persons, [officerId]: officer },
    livingPersonIds: [...s.livingPersonIds, officerId].sort(),
  }
  s = createOfficeAssignment(s, { kind: 'polity', id: commonwealthId }, 'administrator', officerId)
  return s
}

function withRegisterHouseProject(s0: WorldState): WorldState {
  const projectId = createProjectId(0)
  const aimId = createAimId(0)
  const goalId = createGoalId(0)
  const s = withGoal(s0, goalId, { kind: 'person', id: officerId }, 'personal_advancement')
  const aim: Aim = {
    id: aimId,
    owner: { kind: 'person', id: officerId },
    goalId,
    origin: 'goal_driven',
    kind: 'found_republic_house',
    priority: 50,
    progress: 0,
    targetProgress: 3,
    createdWeek: s.absoluteWeek,
    deadlineWeek: s.absoluteWeek + 520,
    successfulProjectCount: 0,
    failedProjectCount: 0,
    status: 'active',
    reasonIds: [],
  }
  const project: RepublicHouseFoundationProject = {
    id: projectId,
    owner: { kind: 'person', id: officerId },
    origin: { kind: 'aim', aimId },
    kind: 'republic_house_foundation',
    creatorPersonId: officerId,
    supervisorPersonId: officerId,
    status: 'active',
    progress: 3,
    targetProgress: 3,
    currentStageKey: 'register_house',
    createdWeek: s.absoluteWeek,
    reasonIds: [],
    petitionerPersonId: officerId,
    commonwealthPolityId: commonwealthId,
  }
  return {
    ...s,
    aims: { ...s.aims, [aimId]: aim },
    aimIndex: {
      ...s.aimIndex,
      byOwner: { ...s.aimIndex.byOwner, [`person:${officerId}`]: [aimId] },
    },
    projects: { ...s.projects, [projectId]: project },
    projectIndex: {
      ...s.projectIndex,
      byOwner: { ...s.projectIndex.byOwner, [`person:${officerId}`]: [projectId] },
      byAim: { ...s.projectIndex.byAim, [aimId as string]: [projectId] },
    },
  }
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

describe('v0.47 共和国 House 創設 finalize', () => {
  it('houseless 共和国役職者が landless House を創設し office を維持する', () => {
    const s = withRegisterHouseProject(makeRepublicState())
    const baselineErrors = new Set(
      collectIntegrityErrors(s, { debug: false, config: defaultConfig }).map((e) => e.message),
    )
    const result = runProjectStageSystem(makeCtx(s))
    const st = result.state

    const project = st.projects[createProjectId(0)]
    expect(project?.status).toBe('completed')

    // landless House (self_made_foundation / office) が生成され officer が founder + leader。
    const newHouse = Object.values(st.houses).find(
      (h) => h.creationReason === 'office' && h.founderId === officerId,
    )
    expect(newHouse).toBeDefined()
    expect(newHouse!.creationKind).toBe('self_made_foundation')
    expect(st.persons[officerId]!.houseId).toBe(newHouse!.id)
    expect(getHouseLeader(st, newHouse!.id)).toBe(officerId)

    // commonwealth の administrator office は維持される。
    const polityOffices = getOfficeAssignments(st, { kind: 'polity', id: commonwealthId })
      .filter((o) => o.active && o.holderPersonId === officerId)
      .map((o) => o.role)
    expect(polityOffices).toContain('administrator')

    expect(result.events.some((e) => e.type === 'HOUSE_FOUNDED_IN_REPUBLIC')).toBe(true)

    const newErrors = collectIntegrityErrors(st, { debug: false, config: defaultConfig })
      .map((e) => e.message)
      .filter((m) => !baselineErrors.has(m) && !m.includes('terminal project in state'))
    expect(newErrors).toEqual([])
  })
})
