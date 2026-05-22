import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { Task, TaskKind } from '../types/task'
import type { Aim, PersonAimKind } from '../types/goal'
import type { DecisionSubjectRef, EntityRef } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import { targetRefKey } from '../types/task'
import type { TaskTargetRef } from '../types/task'
import type { PersonId } from '../types/ids'
import type { AbilityKey } from '../types/person'
import { createTaskId } from '../types/ids'

// --- Task cost/effort classification ---

const LIGHT_TASKS: ReadonlySet<TaskKind> = new Set([
  'study_law',
  'study_accounts',
  'practice_arms',
  'courtly_training',
  'manage_accounts',
])

const HEAVY_TASKS: ReadonlySet<TaskKind> = new Set([
  'prepare_argument',
  'gather_claim_evidence',
  'negotiate_terms',
  'pressure_counterparty',
  'offer_compromise',
  'undermine_counterparty_position',
])

// --- getPersonWeeklyActionCapacity ---

export function getPersonWeeklyActionCapacity(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): number {
  const person = state.persons[personId]
  if (!person || !person.alive) return 0
  if (person.kind === 'placeholder') return 0

  let capacity = config.weeklyActionCapacityBase // 2.0
  if (person.traits.ambition >= config.weeklyActionCapacityAmbitionThreshold) {
    capacity += config.weeklyActionCapacityAmbitionBonus // +0.5
  }
  if (person.age >= config.weeklyActionCapacityAgeThreshold) {
    capacity -= config.weeklyActionCapacityAgeReduction // -0.5
  }
  return Math.max(0, capacity)
}

// --- getTaskActionCost ---

export function getTaskActionCost(config: SimulationConfig, kind: TaskKind): number {
  if (LIGHT_TASKS.has(kind)) return config.taskActionCostLight
  if (HEAVY_TASKS.has(kind)) return config.taskActionCostHeavy
  return config.taskActionCostNormal
}

// --- getTaskEffortRequired ---

export function getTaskEffortRequired(config: SimulationConfig, kind: TaskKind): number {
  if (LIGHT_TASKS.has(kind)) return config.taskEffortRequiredLight
  if (HEAVY_TASKS.has(kind)) return config.taskEffortRequiredHeavy
  return config.taskEffortRequiredNormal
}

// --- getTaskRelevantAbility ---

export function getTaskRelevantAbility(kind: TaskKind): AbilityKey {
  switch (kind) {
    case 'study_law':
      return 'learning'
    case 'study_accounts':
      return 'numeracy'
    case 'practice_arms':
      return 'valor'
    case 'courtly_training':
      return 'charisma'
    case 'seek_office_support':
      return 'charisma'
    case 'display_competence':
      return 'insight'
    case 'defend_office_position':
      return 'insight'
    case 'promote_house_influence':
      return 'charisma'
    case 'manage_accounts':
      return 'numeracy'
    case 'prepare_argument':
      return 'learning'
    case 'pressure_counterparty':
      return 'command'
    case 'negotiate_terms':
      return 'insight'
    default:
      return 'insight'
  }
}

// --- computeWeeklyEffort ---

export function computeWeeklyEffort(
  state: WorldState,
  _config: SimulationConfig,
  task: Task,
): number {
  const person = state.persons[task.assigneePersonId]
  if (!person) return 0.5
  const ability = getTaskRelevantAbility(task.kind)
  const abilityValue = person.abilities[ability]
  // base 1.0, ability modifier up to +1.0 at ability 100
  return 1.0 + (abilityValue / 100) * 1.0
}

// --- createTask helper ---

export function createTask(
  state: WorldState,
  config: SimulationConfig,
  input: {
    owner: DecisionSubjectRef
    assigneePersonId: PersonId
    kind: TaskKind
    targetRef: TaskTargetRef
    absoluteWeek: number
  },
): { task: Task; state: WorldState } {
  const taskId = createTaskId(state.nextTaskId)
  const task: Task = {
    id: taskId,
    owner: input.owner,
    assigneePersonId: input.assigneePersonId,
    kind: input.kind,
    targetRef: input.targetRef,
    priority: 1,
    actionCost: getTaskActionCost(config, input.kind),
    effortRequired: getTaskEffortRequired(config, input.kind),
    effortDone: 0,
    createdWeek: input.absoluteWeek,
    status: 'active',
    reasonIds: [],
  }

  const ownerKey = decisionSubjectKey(input.owner)
  const targetKey = targetRefKey(input.targetRef)
  const assigneeKey = input.assigneePersonId as string

  const newState: WorldState = {
    ...state,
    tasks: { ...state.tasks, [taskId]: task },
    taskIndex: {
      byAssignee: {
        ...state.taskIndex.byAssignee,
        [assigneeKey]: [...(state.taskIndex.byAssignee[assigneeKey] ?? []), taskId],
      },
      byOwner: {
        ...state.taskIndex.byOwner,
        [ownerKey]: [...(state.taskIndex.byOwner[ownerKey] ?? []), taskId],
      },
      byTarget: {
        ...state.taskIndex.byTarget,
        [targetKey]: [...(state.taskIndex.byTarget[targetKey] ?? []), taskId],
      },
    },
    nextTaskId: state.nextTaskId + 1,
  }

  return { task, state: newState }
}

// --- removeTask ---

export function removeTask(state: WorldState, taskId: import('../types/ids').TaskId): WorldState {
  const task = state.tasks[taskId]
  if (!task) return state

  const ownerKey = decisionSubjectKey(task.owner)
  const targetKey = targetRefKey(task.targetRef)
  const assigneeKey = task.assigneePersonId as string

  const newTasks = { ...state.tasks }
  delete newTasks[taskId]

  return {
    ...state,
    tasks: newTasks,
    taskIndex: {
      byAssignee: {
        ...state.taskIndex.byAssignee,
        [assigneeKey]: (state.taskIndex.byAssignee[assigneeKey] ?? []).filter(
          (id) => (id as string) !== (taskId as string),
        ),
      },
      byOwner: {
        ...state.taskIndex.byOwner,
        [ownerKey]: (state.taskIndex.byOwner[ownerKey] ?? []).filter(
          (id) => (id as string) !== (taskId as string),
        ),
      },
      byTarget: {
        ...state.taskIndex.byTarget,
        [targetKey]: (state.taskIndex.byTarget[targetKey] ?? []).filter(
          (id) => (id as string) !== (taskId as string),
        ),
      },
    },
  }
}

// --- getInitialTaskKind ---

export function getInitialTaskKind(kind: PersonAimKind): TaskKind | undefined {
  switch (kind) {
    case 'increase_house_influence':
      return 'promote_house_influence'
    case 'obtain_office':
      return 'display_competence'
    case 'retain_office':
      return 'perform_office_duties'
    case 'accumulate_wealth':
      return 'seek_profitable_assignment'
    case 'improve_ability':
      return undefined // caller must resolve from aim.target
    case 'support_organization_aim':
      return 'support_organization_plan'
    default:
      return undefined
  }
}

// --- getInitialTaskKindForImproveAbility ---

export function getInitialTaskKindForImproveAbility(ability: AbilityKey): TaskKind | undefined {
  switch (ability) {
    case 'valor':
    case 'command':
      return 'practice_arms'
    case 'numeracy':
      return 'study_accounts'
    case 'learning':
      return 'study_law'
    case 'charisma':
    case 'insight':
      return 'courtly_training'
    default:
      return undefined
  }
}

// --- getInitialTaskKindForAbilityTarget ---

export function getInitialTaskKindForAbilityTarget(
  target: EntityRef | undefined,
): TaskKind | undefined {
  if (!target || target.kind !== 'ability') return undefined
  return getInitialTaskKindForImproveAbility(target.ability)
}

// --- createInitialTaskForAim ---

export function createInitialTaskForAim(
  state: WorldState,
  config: SimulationConfig,
  aim: Aim,
  absoluteWeek: number,
): { task: Task; state: WorldState } | undefined {
  const personId = aim.owner.kind === 'person' ? aim.owner.id : undefined
  if (!personId) return undefined

  let taskKind = getInitialTaskKind(aim.kind as PersonAimKind)

  // For improve_ability, resolve from aim.target
  if (aim.kind === 'improve_ability' && !taskKind) {
    taskKind = getInitialTaskKindForAbilityTarget(aim.target)
  }

  if (!taskKind) return undefined

  return createTask(state, config, {
    owner: aim.owner,
    assigneePersonId: personId,
    kind: taskKind,
    targetRef: { kind: 'aim', id: aim.id },
    absoluteWeek,
  })
}

// --- getNextTaskKind ---

export function getNextTaskKind(
  aimKind: PersonAimKind,
  previousTaskKind: TaskKind | undefined,
): TaskKind | undefined {
  switch (aimKind) {
    case 'increase_house_influence':
      return 'promote_house_influence' // repeat

    case 'obtain_office':
      if (previousTaskKind === 'display_competence') return 'seek_office_support'
      if (previousTaskKind === 'seek_office_support') return undefined // aim enters waiting state
      return 'display_competence' // fallback

    case 'retain_office':
      if (!previousTaskKind) return 'perform_office_duties'
      if (previousTaskKind === 'perform_office_duties') return 'defend_office_position'
      return 'perform_office_duties' // alternate

    case 'accumulate_wealth':
      if (!previousTaskKind) return 'seek_profitable_assignment'
      if (previousTaskKind === 'seek_profitable_assignment') return 'manage_accounts'
      return 'seek_profitable_assignment' // alternate

    case 'improve_ability':
      return previousTaskKind // repeat same task

    case 'support_organization_aim':
      return 'support_organization_plan'

    default:
      return undefined
  }
}

// --- createNextTaskForAim ---

export function createNextTaskForAim(
  state: WorldState,
  config: SimulationConfig,
  aim: Aim,
  previousTaskKind: TaskKind | undefined,
  absoluteWeek: number,
): { task: Task; state: WorldState } | undefined {
  const personId = aim.owner.kind === 'person' ? aim.owner.id : undefined
  if (!personId) return undefined

  const taskKind = getNextTaskKind(aim.kind as PersonAimKind, previousTaskKind)
  if (!taskKind) return undefined

  return createTask(state, config, {
    owner: aim.owner,
    assigneePersonId: personId,
    kind: taskKind,
    targetRef: { kind: 'aim', id: aim.id },
    absoluteWeek,
  })
}

// --- checkEntityExists for EntityRef ---

export function checkEntityExists(state: WorldState, ref: EntityRef): boolean {
  switch (ref.kind) {
    case 'polity':
      return !!state.polities[ref.id]
    case 'house':
      return !!state.houses[ref.id]
    case 'person':
      return !!state.persons[ref.id]
    case 'state':
      return !!state.states[ref.id]
    case 'province':
      return !!state.provinces[ref.id]
    case 'holding':
      return !!state.holdings[ref.id]
    case 'land_contract':
      return !!state.landContracts[ref.id]
    case 'aim':
      return !!state.aims[ref.id]
    case 'office':
      // Office references are not entities that get "removed"
      return true
    case 'ability':
      return true
    default:
      return false
  }
}

// --- isEntityTerminal for EntityRef ---

// Note: Some entity types may gain additional terminal properties in later phases.
// This function handles current types safely.
export function isEntityTerminal(state: WorldState, ref: EntityRef): boolean {
  switch (ref.kind) {
    case 'polity': {
      const p = state.polities[ref.id]
      return !p || !p.active
    }
    case 'house': {
      const h = state.houses[ref.id]
      return !h || !h.active
    }
    case 'person': {
      const p = state.persons[ref.id]
      return !p || !p.alive || p.kind === 'placeholder'
    }
    case 'state': {
      // StateRegion currently has no active/terminal property
      return false
    }
    case 'province': {
      // Province currently has no annexed/terminal property
      return false
    }
    case 'holding': {
      return !state.holdings[ref.id]
    }
    case 'land_contract': {
      // LandContract currently has no status/terminated property
      return false
    }
    case 'aim': {
      const a = state.aims[ref.id]
      return !a || a.status !== 'active'
    }
    case 'office':
    case 'ability':
      return false
    default:
      return false
  }
}
