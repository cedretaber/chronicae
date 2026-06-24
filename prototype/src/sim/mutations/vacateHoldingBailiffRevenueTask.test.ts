// 潜在バグ回帰 (§17.2): 代官 (HoldingOfficeAssignment) を vacate で削除する際、その assignment を
//   参照する collect_holding_revenue タスクを cleanup しないと dangling 化し整合性違反になる。
//   bailiffRevenueTaskSystem は「active な assignment」しか走査しないため、削除後は永久に残る。
import { describe, expect, it } from 'vitest'
import {
  makeEmptyV016State,
  withHouse,
  withPolity,
  withPerson,
  withProvince,
  withHolding,
} from '../testFixtures'
import { vacateHoldingBailiff } from './provinceOfficeMutations'
import { addTaskToIndicesMut } from './taskMutations'
import { collectIntegrityErrors } from '../tick/integritySystem'
import type { WorldState } from '../types/world'
import type { Task } from '../types/task'
import {
  createPolityId,
  createHouseId,
  createHoldingId,
  createProvinceId,
  createPersonId,
  createTaskId,
} from '../types/ids'
import type { HoldingOfficeAssignmentId } from '../types/ids'

const POLITY = createPolityId('c', 0)
const HOUSE = createHouseId('h', 0)
const PROV = createProvinceId('p', 0)
const HOLD = createHoldingId(0)
const BAILIFF = createPersonId('pe', 1)
const HOA = 'ho-bailiff' as HoldingOfficeAssignmentId

function makeStateWithBailiffAndRevenueTask(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, PROV)
  s = withHolding(s, HOLD, PROV)
  s = withHouse(s, HOUSE)
  s = withPolity(s, POLITY, { ownerHouseId: HOUSE })
  s = withPerson(s, BAILIFF, { houseId: HOUSE })
  // active・非 placeholder の代官を設置。
  s = {
    ...s,
    holdingOfficeAssignments: {
      ...s.holdingOfficeAssignments,
      [HOA]: {
        id: HOA,
        holdingId: HOLD,
        role: 'bailiff',
        holderPersonId: BAILIFF,
        appointingPolityId: POLITY,
        active: true,
        startWeek: 0,
        unpaidCount: 0,
        contractedRemittanceRate: 0.4,
        expectedFeeRate: 0.1,
      },
    },
    holdingOfficeIndex: {
      ...s.holdingOfficeIndex,
      byHolding: { ...s.holdingOfficeIndex.byHolding, [HOLD]: HOA },
    },
  }
  // 進行中の collect_holding_revenue タスク (この assignment を target にする)。
  const task: Task = {
    id: createTaskId(s.nextTaskId),
    owner: { kind: 'person', id: BAILIFF },
    assigneePersonId: BAILIFF,
    kind: 'collect_holding_revenue',
    targetRef: { kind: 'holding_office_assignment', id: HOA },
    priority: 1,
    actionCost: 1,
    effortRequired: 3,
    effortDone: 0,
    createdWeek: 0,
    deadlineWeek: 4,
    status: 'active',
    reasonIds: [],
    difficulty: 50,
    relevantAbility: 'numeracy',
  }
  s = { ...s, tasks: { ...s.tasks }, nextTaskId: s.nextTaskId + 1 }
  addTaskToIndicesMut(s, task)
  return s
}

describe('vacateHoldingBailiff の collect_holding_revenue タスク cleanup (§17.2 回帰)', () => {
  it('代官を vacate しても dangling な collect_holding_revenue タスクが残らない', () => {
    const s = makeStateWithBailiffAndRevenueTask()
    const after = vacateHoldingBailiff(s, HOLD)
    // assignment は削除される。
    expect(after.holdingOfficeAssignments[HOA]).toBeUndefined()
    // §17.2: missing HoldingOfficeAssignment を参照する collect_holding_revenue タスクが無いこと。
    const errors = collectIntegrityErrors(after)
    const danglers = errors.filter((e) => e.message.includes('collect_holding_revenue'))
    expect(danglers).toEqual([])
  })
})
