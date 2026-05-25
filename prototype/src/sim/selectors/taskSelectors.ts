import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { Task, TaskKind, TaskOutcomeKind } from '../types/task'
import type { Aim, PersonAimKind } from '../types/goal'
import type { DecisionSubjectRef, EntityRef } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import { targetRefKey } from '../types/task'
import type { TaskTargetRef } from '../types/task'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type { PoliticalActorRef } from '../types/actor'
import type { PersonId } from '../types/ids'
import type { AbilityKey } from '../types/person'
import type { ProjectKind } from '../types/project'
import { createTaskId } from '../types/ids'
import { getPrimaryOfficeHolder, getPolityLeader, getHouseLeader } from './officeSelectors'
import type { RngState } from '../rng/rng'
import { randomFloat } from '../rng/rng'

// --- Task cost/effort classification ---

const LIGHT_TASKS: ReadonlySet<TaskKind> = new Set([
  'study_law',
  'study_accounts',
  'practice_arms',
  'courtly_training',
  'manage_accounts',
  'collect_holding_revenue',
])

const HEAVY_TASKS: ReadonlySet<TaskKind> = new Set([
  'prepare_argument',
  'gather_claim_evidence',
  'negotiate_terms',
  'pressure_counterparty',
  'offer_compromise',
  'undermine_counterparty_position',
  'secure_internal_support',
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
    case 'arrange_patronage':
      return 'charisma'
    case 'commission_chronicle_work':
      return 'learning'
    case 'gather_claim_evidence':
      return 'learning'
    case 'offer_compromise':
      return 'charisma'
    case 'secure_internal_support':
      return 'charisma'
    case 'undermine_counterparty_position':
      return 'insight'
    case 'collect_holding_revenue':
      return 'numeracy'
    case 'prepare_project':
      return 'insight'
    case 'advance_project':
      return 'insight'
    default:
      return 'insight'
  }
}

// --- Task outcome defaults (v0.26.1) ---

const TASK_KIND_OUTCOME_DEFAULTS: Record<
  TaskKind,
  { difficulty: number; relevantAbility: AbilityKey }
> = {
  support_organization_plan: { difficulty: 25, relevantAbility: 'insight' },
  promote_house_influence: { difficulty: 30, relevantAbility: 'charisma' },
  perform_office_duties: { difficulty: 20, relevantAbility: 'numeracy' },
  seek_office_support: { difficulty: 40, relevantAbility: 'charisma' },
  display_competence: { difficulty: 30, relevantAbility: 'insight' },
  defend_office_position: { difficulty: 35, relevantAbility: 'charisma' },
  manage_accounts: { difficulty: 20, relevantAbility: 'numeracy' },
  seek_profitable_assignment: { difficulty: 30, relevantAbility: 'insight' },
  study_law: { difficulty: 35, relevantAbility: 'learning' },
  study_accounts: { difficulty: 35, relevantAbility: 'learning' },
  practice_arms: { difficulty: 35, relevantAbility: 'command' },
  courtly_training: { difficulty: 35, relevantAbility: 'learning' },
  secure_internal_support: { difficulty: 30, relevantAbility: 'charisma' },
  arrange_patronage: { difficulty: 25, relevantAbility: 'charisma' },
  commission_chronicle_work: { difficulty: 25, relevantAbility: 'learning' },
  prepare_argument: { difficulty: 40, relevantAbility: 'learning' },
  gather_claim_evidence: { difficulty: 40, relevantAbility: 'insight' },
  negotiate_terms: { difficulty: 45, relevantAbility: 'charisma' },
  pressure_counterparty: { difficulty: 45, relevantAbility: 'command' },
  offer_compromise: { difficulty: 35, relevantAbility: 'charisma' },
  undermine_counterparty_position: { difficulty: 50, relevantAbility: 'insight' },
  collect_holding_revenue: { difficulty: 20, relevantAbility: 'numeracy' },
  prepare_project: { difficulty: 30, relevantAbility: 'insight' },
  advance_project: { difficulty: 35, relevantAbility: 'insight' },
}

export function getTaskDefaultDifficulty(kind: TaskKind): number {
  return TASK_KIND_OUTCOME_DEFAULTS[kind].difficulty
}

export function getTaskDefaultRelevantAbility(kind: TaskKind): AbilityKey {
  return TASK_KIND_OUTCOME_DEFAULTS[kind].relevantAbility
}

export const PROJECT_KIND_ABILITY_MAP: Record<ProjectKind, AbilityKey> = {
  develop_holding: 'numeracy',
  expand_polity_share: 'charisma',
  promote_policy_shift: 'charisma',
  patronize_artist: 'charisma',
  commission_chronicle: 'learning',
  acquire_land: 'command',
  sell_land: 'numeracy',
  improve_contract_terms: 'numeracy',
  demand_tax_increase: 'numeracy',
  respond_to_pressure: 'insight',
}

export function determineTaskOutcome(
  state: WorldState,
  config: SimulationConfig,
  task: Task,
  rng: RngState,
): { outcome: TaskOutcomeKind; rng: RngState } {
  const person = state.persons[task.assigneePersonId]
  const abilityScore = person ? person.abilities[task.relevantAbility] : 0
  const { value: roll, rng: nextRng } = randomFloat(rng)
  const randomValue = roll * 100
  const effectiveScore = abilityScore + randomValue
  const threshold = task.difficulty * 2
  const successMargin = config.taskOutcomeSuccessMargin

  if (effectiveScore >= threshold + successMargin) return { outcome: 'success', rng: nextRng }
  if (effectiveScore >= threshold) return { outcome: 'partial', rng: nextRng }
  return { outcome: 'failure', rng: nextRng }
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
    deadlineWeek?: number
    difficulty?: number
    relevantAbility?: AbilityKey
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
    ...(input.deadlineWeek !== undefined ? { deadlineWeek: input.deadlineWeek } : {}),
    status: 'active',
    reasonIds: [],
    difficulty: input.difficulty ?? getTaskDefaultDifficulty(input.kind),
    relevantAbility: input.relevantAbility ?? getTaskDefaultRelevantAbility(input.kind),
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

// --- DiplomaticPlay Task helpers (v0.23 Phase D) ---

function isValidDelegate(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  return person !== undefined && person.alive && person.kind !== 'placeholder'
}

export function getDiplomaticPlayDelegate(
  state: WorldState,
  actor: PoliticalActorRef,
): PersonId | undefined {
  if (actor.kind === 'polity') {
    const polityId = actor.id
    const advisor = getPrimaryOfficeHolder(state, { kind: 'polity', id: polityId }, 'advisor')
    if (advisor && isValidDelegate(state, advisor)) return advisor
    const admin = getPrimaryOfficeHolder(state, { kind: 'polity', id: polityId }, 'administrator')
    if (admin && isValidDelegate(state, admin)) return admin
    const leader = getPolityLeader(state, polityId)
    if (leader && isValidDelegate(state, leader)) return leader
    return undefined
  }
  if (actor.kind === 'house') {
    const leader = getHouseLeader(state, actor.id)
    if (leader && isValidDelegate(state, leader)) return leader
    return undefined
  }
  return undefined
}

export function selectDiplomaticTaskKind(
  state: WorldState,
  play: DiplomaticPlay,
  side: 'initiator' | 'target',
): TaskKind {
  const prep = side === 'initiator' ? play.initiatorPreparation : play.targetPreparation
  const lev = side === 'initiator' ? play.initiatorLeverage : play.targetLeverage
  const commit = side === 'initiator' ? play.initiatorCommitment : play.targetCommitment

  // Critical deficits always take priority
  if (prep < 30) return 'prepare_argument'
  if (lev < 30) return 'gather_claim_evidence'
  if (commit < 30) return 'secure_internal_support'

  // After basics covered: score candidates by delegate ability + side role
  const delegateId =
    side === 'initiator' ? play.initiatorDelegatePersonId : play.targetDelegatePersonId
  const person = delegateId ? state.persons[delegateId] : undefined
  const abilities = person?.abilities

  type Candidate = { kind: TaskKind; score: number }
  const candidates: Candidate[] = []

  // negotiate_terms (insight) — both sides benefit, slight target preference
  if (play.progress < 80) {
    const base = side === 'target' ? 12 : 8
    const abilityBonus = abilities ? abilities.insight * 0.15 : 0
    candidates.push({ kind: 'negotiate_terms', score: base + abilityBonus })
  }

  // offer_compromise (charisma) — tension relief, target prefers
  if (play.tension > 30) {
    const urgency = Math.min(20, (play.tension - 30) * 0.3)
    const base = side === 'target' ? 10 + urgency : 5 + urgency
    const abilityBonus = abilities ? abilities.charisma * 0.15 : 0
    candidates.push({ kind: 'offer_compromise', score: base + abilityBonus })
  }

  // pressure_counterparty (command) — initiator prefers
  {
    const base = side === 'initiator' ? 12 : 6
    const abilityBonus = abilities ? abilities.command * 0.15 : 0
    candidates.push({ kind: 'pressure_counterparty', score: base + abilityBonus })
  }

  // undermine_counterparty_position (insight) — initiator prefers
  {
    const opponentLev = side === 'initiator' ? play.targetLeverage : play.initiatorLeverage
    if (opponentLev > 30) {
      const base = side === 'initiator' ? 10 : 7
      const abilityBonus = abilities ? abilities.insight * 0.1 : 0
      candidates.push({ kind: 'undermine_counterparty_position', score: base + abilityBonus })
    }
  }

  // gather more leverage/preparation if still below strong thresholds
  if (lev < 60) {
    const base = side === 'initiator' ? 8 : 5
    const abilityBonus = abilities ? abilities.learning * 0.1 : 0
    candidates.push({ kind: 'gather_claim_evidence', score: base + abilityBonus })
  }
  if (prep < 60) {
    const base = 6
    const abilityBonus = abilities ? abilities.learning * 0.1 : 0
    candidates.push({ kind: 'prepare_argument', score: base + abilityBonus })
  }

  // Pick highest-scoring candidate
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score)
    return candidates[0]!.kind
  }

  return 'negotiate_terms'
}

export function createTaskForDiplomaticPlay(
  state: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: 'initiator' | 'target',
  taskKind: TaskKind,
  absoluteWeek: number,
): { task: Task; state: WorldState } | undefined {
  const delegateId =
    side === 'initiator' ? play.initiatorDelegatePersonId : play.targetDelegatePersonId
  if (!delegateId) return undefined

  const actor = side === 'initiator' ? play.initiator : play.target
  const owner: DecisionSubjectRef =
    actor.kind === 'polity' ? { kind: 'polity', id: actor.id } : { kind: 'house', id: actor.id }

  return createTask(state, config, {
    owner,
    assigneePersonId: delegateId,
    kind: taskKind,
    targetRef: { kind: 'diplomatic_play', id: play.id },
    absoluteWeek,
    deadlineWeek: play.deadlineWeek,
  })
}

// --- computeEffectivePriority ---

const DIPLOMATIC_TASK_KINDS: ReadonlySet<TaskKind> = new Set([
  'prepare_argument',
  'gather_claim_evidence',
  'negotiate_terms',
  'pressure_counterparty',
  'offer_compromise',
  'undermine_counterparty_position',
  'secure_internal_support',
])

const GOAL_ALIGNMENT_MAP: Record<string, (task: Task) => boolean> = {
  house_loyalty: (task) => task.owner.kind === 'house',
  public_service: (task) => task.owner.kind === 'polity',
  personal_advancement: (task) =>
    task.kind === 'seek_office_support' ||
    task.kind === 'display_competence' ||
    task.kind === 'defend_office_position',
  wealth_building: (task) =>
    task.kind === 'manage_accounts' ||
    task.kind === 'seek_profitable_assignment' ||
    task.kind === 'arrange_patronage',
  self_cultivation: (task) =>
    task.kind === 'study_law' ||
    task.kind === 'study_accounts' ||
    task.kind === 'practice_arms' ||
    task.kind === 'courtly_training',
}

export function computeEffectivePriority(
  state: WorldState,
  config: SimulationConfig,
  task: Task,
): number {
  let priority = task.priority

  // ownerDutyBonus: assignee holds office in the task's owner organization
  const assigneeKey = task.assigneePersonId as string
  const holderOfficeIds = state.officeIndex.byHolderPerson[assigneeKey] ?? []
  for (const oaId of holderOfficeIds) {
    const oa = state.officeAssignments[oaId]
    if (!oa || !oa.active) continue
    if (
      oa.organization.kind === task.owner.kind &&
      (oa.organization.id as string) === (task.owner.id as string)
    ) {
      priority += config.effectivePriorityOwnerDutyBonus
      break
    }
  }

  // goalAlignmentBonus: assignee's active goal kind matches task nature
  const personGoalIds = state.goalIndex.byOwner[`person:${task.assigneePersonId}`] ?? []
  for (const gid of personGoalIds) {
    const goal = state.goals[gid]
    if (!goal || goal.status !== 'active') continue
    const matcher = GOAL_ALIGNMENT_MAP[goal.kind]
    if (matcher && matcher(task)) {
      priority += config.effectivePriorityGoalAlignmentBonus
    }
    break // only check the first active goal
  }

  // urgencyBonus: based on deadlineWeek proximity
  if (task.deadlineWeek !== undefined) {
    const weeksLeft = task.deadlineWeek - state.absoluteWeek
    if (weeksLeft <= 0) {
      priority += config.effectivePriorityUrgencyMaxBonus
    } else if (weeksLeft <= 4) {
      priority += config.effectivePriorityUrgencyMediumBonus
    } else if (weeksLeft <= 12) {
      priority += config.effectivePriorityUrgencySmallBonus
    }
  }

  // taskKindPriorityBonus
  if (DIPLOMATIC_TASK_KINDS.has(task.kind) && task.targetRef.kind === 'diplomatic_play') {
    priority += config.effectivePriorityDiplomaticTaskBonus
  } else if (task.kind === 'perform_office_duties') {
    priority += config.effectivePriorityOfficeDutyBonus
  }

  // overloadPenalty
  const assigneeTaskIds = state.taskIndex.byAssignee[assigneeKey] ?? []
  let activeCount = 0
  for (const tid of assigneeTaskIds) {
    const t = state.tasks[tid]
    if (t && t.status === 'active') activeCount++
  }
  const overload = Math.max(0, activeCount - config.effectivePriorityOverloadThreshold)
  priority -= overload * config.effectivePriorityOverloadPenaltyPerTask

  return priority
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
