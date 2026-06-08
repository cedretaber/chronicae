// 影響力個人中心化 Phase 1a: dual-tag (owner + target polity) の導出ロジックテスト。
// collectProjectReputationOrganizations が project kind / owner に応じて正しい
// organization 集合 (dedupe 済み) を返すことを確認する。

import { describe, expect, it } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import {
  createHoldingId,
  createHouseId,
  createPolityId,
  createProjectId,
  createPersonId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { Project } from '../types/project'
import { personReputationOrganizationKey } from '../types/personReputation'
import { collectProjectReputationOrganizations } from './projectOutcomeSystem'

const houseId = createHouseId('h', 0)
const polityId = createPolityId('c', 0)
const holdingId = createHoldingId(0)

function baseProject(overrides: Partial<Project> & Pick<Project, 'kind' | 'owner'>): Project {
  return {
    id: createProjectId(0),
    origin: { kind: 'system', reasonKey: 'test' },
    creatorPersonId: createPersonId('pe', 0),
    supervisorPersonId: createPersonId('pe', 0),
    status: 'completed',
    terminalReason: 'completed',
    progress: 1,
    targetProgress: 1,
    currentStageKey: 'execute_project',
    createdWeek: 0,
    reasonIds: [],
    ...overrides,
  } as Project
}

function keys(orgs: ReturnType<typeof collectProjectReputationOrganizations>): string[] {
  return orgs.map((o) => personReputationOrganizationKey(o)).sort()
}

describe('collectProjectReputationOrganizations (dual-tag Phase 1a)', () => {
  it('house-owned acquire_political_right → owner(house) + target(polity) の 2 個', () => {
    const ws = makeEmptyV016State()
    const project = baseProject({
      kind: 'acquire_political_right',
      owner: { kind: 'house', id: houseId },
      polityId,
      target: { kind: 'polity_office_role', polityId, role: 'administrator' },
      budget: 40,
      spentBudget: 40,
    } as never)
    expect(keys(collectProjectReputationOrganizations(ws, project))).toEqual(
      [`house:${houseId}`, `polity:${polityId}`].sort(),
    )
  })

  it('house-owned promote_policy_shift → owner(house) + target(polity)', () => {
    const ws = makeEmptyV016State()
    const project = baseProject({
      kind: 'promote_policy_shift',
      owner: { kind: 'house', id: houseId },
      polityId,
      houseId,
    } as never)
    expect(keys(collectProjectReputationOrganizations(ws, project))).toEqual(
      [`house:${houseId}`, `polity:${polityId}`].sort(),
    )
  })

  it('polity-owned acquire_political_right → owner==target で dedupe して 1 個', () => {
    const ws = makeEmptyV016State()
    const project = baseProject({
      kind: 'acquire_political_right',
      owner: { kind: 'polity', id: polityId },
      polityId,
      target: { kind: 'polity_office_role', polityId, role: 'administrator' },
      budget: 40,
      spentBudget: 40,
    } as never)
    expect(keys(collectProjectReputationOrganizations(ws, project))).toEqual([`polity:${polityId}`])
  })

  it('develop_holding は holdingTerminalPolityCache から target polity を解決', () => {
    const ws: WorldState = {
      ...makeEmptyV016State(),
      holdingTerminalPolityCache: { [holdingId]: polityId },
    }
    const project = baseProject({
      kind: 'develop_holding',
      owner: { kind: 'house', id: houseId },
      holdingId,
      improvementKind: 'irrigation',
      targetImprovementLevel: 1,
      budget: { required: 0, allocated: 0, remaining: 0, spent: 0, source: { kind: 'owner' } },
    } as never)
    expect(keys(collectProjectReputationOrganizations(ws, project))).toEqual(
      [`house:${houseId}`, `polity:${polityId}`].sort(),
    )
  })

  it('patronize_artist は target 無し → owner(house) のみ 1 個', () => {
    const ws = makeEmptyV016State()
    const project = baseProject({
      kind: 'patronize_artist',
      owner: { kind: 'house', id: houseId },
      houseId,
      budget: 10,
      spentBudget: 10,
    } as never)
    expect(keys(collectProjectReputationOrganizations(ws, project))).toEqual([`house:${houseId}`])
  })

  it('movement_campaign は owner(house) + target(targetPolityId) の 2 個', () => {
    const ws = makeEmptyV016State()
    const project = baseProject({
      kind: 'movement_campaign',
      owner: { kind: 'house', id: houseId },
      targetPolityId: polityId,
      sponsoredPersonId: createPersonId('pe', 5),
      budget: 40,
      spentBudget: 0,
    } as never)
    expect(keys(collectProjectReputationOrganizations(ws, project))).toEqual(
      [`house:${houseId}`, `polity:${polityId}`].sort(),
    )
  })

  it('person-owned personal_training は owner も target も無し → 空', () => {
    const ws = makeEmptyV016State()
    const project = baseProject({
      kind: 'personal_training',
      owner: { kind: 'person', id: createPersonId('pe', 0) },
      traineePersonId: createPersonId('pe', 0),
      trainingAbilityKey: 'governance',
    } as never)
    expect(collectProjectReputationOrganizations(ws, project)).toEqual([])
  })
})
