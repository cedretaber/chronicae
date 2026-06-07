import type { HoldingOfficeAssignmentId, ChronicleEntryId } from '../types/ids'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { isPlaceholderPerson } from '../selectors/landContractSelectors'
import { decisionSubjectKey } from '../types/goal'
import { aimSlotKey } from '../selectors/goalSelectors'
import {
  getBailiffLocalExtractionRate,
  getBailiffCollectionEfficiency,
  getBailiffFeeRate,
  computeBailiffBurdenComponents,
  getRecentBailiffRevenueTaskStatus,
} from '../selectors/bailiffSelectors'
import { targetRefKey } from '../types/task'
import { PROJECT_STAGE_SEQUENCES, getProjectStageType } from '../config/projectStageSequences'
import { isDiplomaticProjectKind } from '../mutations/projectMutations'
import type {
  LandClaimProject,
  ContractRevisionProject,
  RespondToPressureProject,
} from '../types/project'
import { VALID_ABILITY_KEYS, VALID_HOLDING_IMPROVEMENT_KINDS } from './integrityConstants'

export function checkGoalsAimsProjects(
  state: WorldState,
  errors: SimError[],
  debug: boolean,
  config: SimulationConfig | undefined,
): void {
  // --- v0.22 Goal integrity ---
  const activeGoalCountByOwner: Record<string, number> = {}

  for (const [goalIdStr, goal] of Object.entries(state.goals)) {
    if (!goal) continue

    // Owner must be active
    if (goal.owner.kind === 'polity') {
      const polity = state.polities[goal.owner.id]
      if (!polity) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Goal ${goalIdStr}: owner polity ${goal.owner.id as string} does not exist`,
        })
      } else if (!polity.active && goal.status === 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Goal ${goalIdStr}: owner polity ${goal.owner.id as string} is inactive but Goal is active`,
        })
      }
    } else if (goal.owner.kind === 'house') {
      const house = state.houses[goal.owner.id]
      if (!house) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Goal ${goalIdStr}: owner house ${goal.owner.id as string} does not exist`,
        })
      } else if (!house.active && goal.status === 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Goal ${goalIdStr}: owner house ${goal.owner.id as string} is inactive but Goal is active`,
        })
      }
    }

    // Progress in range
    if (goal.progress < 0 || goal.progress > goal.targetProgress) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Goal ${goalIdStr}: progress ${goal.progress} outside [0, ${goal.targetProgress}]`,
      })
    }

    // Active goal count per owner (max 1)
    if (goal.status === 'active') {
      const ownerKey = `${goal.owner.kind}:${goal.owner.id}`
      activeGoalCountByOwner[ownerKey] = (activeGoalCountByOwner[ownerKey] ?? 0) + 1
    }

    // ReasonIds reference existing DecisionReasons
    for (const rid of goal.reasonIds) {
      if (!state.decisionReasons[rid]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Goal ${goalIdStr}: reasonId ${rid as string} does not exist`,
        })
      }
    }
  }

  // Check active goal count per owner
  for (const [ownerKey, count] of Object.entries(activeGoalCountByOwner)) {
    if (count > 1) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Owner ${ownerKey} has ${count} active Goals (max 1)`,
      })
    }
  }

  // --- v0.22 Aim integrity ---
  // v0.43 Aim 並列化: 1 owner が複数 active goal_driven Aim を持てる。invariant は
  //   (1) 数が静的 ceiling 以下 (規模連動の動的 cap ではない。動的 cap で検査すると国の縮小で
  //       合法に作った Aim が偽違反になる) (2) 同一スロット (kind|target) の二重 Aim が無いこと。
  const activeAimCountByOwner: Record<string, number> = {}
  const activeAimSlotsByOwner: Record<string, Set<string>> = {}
  const aimCeiling = config?.aimParallelismCeiling ?? 4

  for (const [aimIdStr, aim] of Object.entries(state.aims)) {
    if (!aim) continue

    // Owner must be active (for active aims)
    if (aim.owner.kind === 'polity') {
      const polity = state.polities[aim.owner.id]
      if (!polity) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: owner polity ${aim.owner.id as string} does not exist`,
        })
      } else if (!polity.active && aim.status === 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: owner polity ${aim.owner.id as string} is inactive but Aim is active`,
        })
      }
    } else if (aim.owner.kind === 'house') {
      const house = state.houses[aim.owner.id]
      if (!house) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: owner house ${aim.owner.id as string} does not exist`,
        })
      } else if (!house.active && aim.status === 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: owner house ${aim.owner.id as string} is inactive but Aim is active`,
        })
      }
    }

    // goal_driven Aim must have goalId
    if (aim.origin === 'goal_driven' && !aim.goalId) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Aim ${aimIdStr}: origin is goal_driven but goalId is missing`,
      })
    }

    // goalId must point to existing Goal with same owner
    if (aim.goalId) {
      const parentGoal = state.goals[aim.goalId]
      if (!parentGoal) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: goalId ${aim.goalId as string} does not exist`,
        })
      } else {
        if (
          parentGoal.owner.kind !== aim.owner.kind ||
          (parentGoal.owner.id as string) !== (aim.owner.id as string)
        ) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Aim ${aimIdStr}: owner mismatch with Goal ${aim.goalId as string}`,
          })
        }
      }
    }

    // Progress in range
    if (aim.progress < 0 || aim.progress > aim.targetProgress) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Aim ${aimIdStr}: progress ${aim.progress} outside [0, ${aim.targetProgress}]`,
      })
    }

    // Deadline >= createdWeek
    if (aim.deadlineWeek < aim.createdWeek) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Aim ${aimIdStr}: deadlineWeek ${aim.deadlineWeek} < createdWeek ${aim.createdWeek}`,
      })
    }

    // activeDiplomaticPlayId must reference an existing active/escalated Play
    if (aim.activeDiplomaticPlayId) {
      const play = state.diplomaticPlays[aim.activeDiplomaticPlayId]
      if (!play) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: activeDiplomaticPlayId ${aim.activeDiplomaticPlayId as string} does not exist`,
        })
      } else if (play.status !== 'active' && play.status !== 'escalated') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: activeDiplomaticPlayId ${aim.activeDiplomaticPlayId as string} is not active/escalated (status: ${play.status})`,
        })
      }
    }

    // Active aim count + slot uniqueness per owner (v0.43)
    if (aim.status === 'active' && aim.origin === 'goal_driven') {
      const ownerKey = `${aim.owner.kind}:${aim.owner.id}`
      activeAimCountByOwner[ownerKey] = (activeAimCountByOwner[ownerKey] ?? 0) + 1
      const slots = activeAimSlotsByOwner[ownerKey] ?? new Set<string>()
      activeAimSlotsByOwner[ownerKey] = slots
      const slot = aimSlotKey(aim.kind, aim.target)
      if (slots.has(slot)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Owner ${ownerKey} has duplicate active goal_driven Aim slot "${slot}"`,
        })
      } else {
        slots.add(slot)
      }
    }

    // ReasonIds reference existing DecisionReasons
    for (const rid of aim.reasonIds) {
      if (!state.decisionReasons[rid]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: reasonId ${rid as string} does not exist`,
        })
      }
    }
  }

  // Check active aim count per owner against static ceiling (v0.43)
  for (const [ownerKey, count] of Object.entries(activeAimCountByOwner)) {
    if (count > aimCeiling) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Owner ${ownerKey} has ${count} active goal_driven Aims (ceiling ${aimCeiling})`,
      })
    }
  }

  // --- v0.22 DiplomaticPlay Goal/Aim cross-references ---
  for (const [playIdStr, play] of Object.entries(state.diplomaticPlays)) {
    if (!play) continue

    if (play.goalId) {
      if (!state.goals[play.goalId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${playIdStr}: goalId ${play.goalId as string} does not exist`,
        })
      }
    }

    if (play.aimId) {
      if (!state.aims[play.aimId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${playIdStr}: aimId ${play.aimId as string} does not exist`,
        })
      }
    }
  }

  // --- v0.23: Task integrity ---
  for (const [taskIdStr, task] of Object.entries(state.tasks)) {
    if (!task) continue
    // Assignee must exist, be alive, and not be placeholder
    const assignee = state.persons[task.assigneePersonId]
    if (!assignee) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: assignee ${task.assigneePersonId} does not exist`,
      })
    } else if (!assignee.alive) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: assignee ${task.assigneePersonId} is dead`,
      })
    } else if (assignee.kind === 'placeholder') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: assignee ${task.assigneePersonId} is placeholder`,
      })
    }
    if (task.difficulty < 0 || task.difficulty > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: difficulty ${task.difficulty} out of range [0,100]`,
      })
    }
    if (!VALID_ABILITY_KEYS.has(task.relevantAbility)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: relevantAbility '${task.relevantAbility}' is not a valid AbilityKey`,
      })
    }
    // Active task target should not be terminal
    if (task.status === 'active' && task.targetRef.kind === 'aim') {
      const targetAim = state.aims[task.targetRef.id]
      if (targetAim && targetAim.status !== 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Task ${taskIdStr}: active task targets terminal aim ${task.targetRef.id} (status=${targetAim.status})`,
        })
      }
    }
  }

  // --- v0.25 §17.2: collect_holding_revenue Task integrity ---
  {
    const activeRevenueTasksByTarget: Record<string, number> = {}

    for (const [taskIdStr, task] of Object.entries(state.tasks)) {
      if (!task) continue
      if (task.kind !== 'collect_holding_revenue') continue

      if (task.targetRef.kind !== 'holding_office_assignment') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Task ${taskIdStr}: collect_holding_revenue has targetRef.kind=${task.targetRef.kind}, expected holding_office_assignment (§17.2)`,
        })
        continue
      }

      const assignment = state.holdingOfficeAssignments[task.targetRef.id]
      if (!assignment) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Task ${taskIdStr}: collect_holding_revenue targets missing HoldingOfficeAssignment ${task.targetRef.id as string} (§17.2)`,
        })
      } else if (!assignment.active) {
        if (task.status === 'active') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Task ${taskIdStr}: active collect_holding_revenue targets inactive HoldingOfficeAssignment ${task.targetRef.id as string} (§17.2)`,
          })
        }
      } else {
        if (isPlaceholderPerson(state, assignment.holderPersonId)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Task ${taskIdStr}: collect_holding_revenue exists for placeholder holder ${assignment.holderPersonId as string} (§17.2)`,
          })
        }
      }

      if (task.status === 'active') {
        const tKey = targetRefKey(task.targetRef)
        activeRevenueTasksByTarget[tKey] = (activeRevenueTasksByTarget[tKey] ?? 0) + 1
      }
    }

    for (const [tKey, count] of Object.entries(activeRevenueTasksByTarget)) {
      if (count > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `${count} active collect_holding_revenue Tasks for target ${tKey} (§17.2 max 1)`,
        })
      }
    }
  }

  // --- v0.25 §17.3: Selector range checks (debug + config only) ---
  if (debug && config) {
    for (const hoaIdStr of Object.keys(state.holdingOfficeAssignments)) {
      const hoaId = hoaIdStr as HoldingOfficeAssignmentId
      const hoa = state.holdingOfficeAssignments[hoaId]
      if (!hoa || !hoa.active) continue

      const localExtractionRate = getBailiffLocalExtractionRate(state, config, hoaId)
      if (
        localExtractionRate < config.minLocalExtractionRate ||
        localExtractionRate > config.maxLocalExtractionRate
      ) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: localExtractionRate=${localExtractionRate.toFixed(3)} outside [${config.minLocalExtractionRate}, ${config.maxLocalExtractionRate}] (§17.3)`,
        })
      }

      const recentTaskStatus = getRecentBailiffRevenueTaskStatus(state, hoaId)
      const collectionEfficiency = getBailiffCollectionEfficiency(
        state,
        config,
        hoaId,
        recentTaskStatus,
      )
      if (
        collectionEfficiency < config.minBailiffCollectionEfficiency ||
        collectionEfficiency > 1.0
      ) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: collectionEfficiency=${collectionEfficiency.toFixed(3)} outside [${config.minBailiffCollectionEfficiency}, 1.0] (§17.3)`,
        })
      }

      const bailiffFeeRate = getBailiffFeeRate(state, config, hoaId)
      if (bailiffFeeRate < 0 || bailiffFeeRate > config.maxBailiffFeeRate) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: bailiffFeeRate=${bailiffFeeRate.toFixed(3)} outside [0, ${config.maxBailiffFeeRate}] (§17.3)`,
        })
      }

      const burden = computeBailiffBurdenComponents(
        localExtractionRate,
        collectionEfficiency,
        config.collectionFrictionFactor,
      )
      if (burden.totalBurdenRate < 0 || burden.totalBurdenRate > config.maxLocalExtractionRate) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: totalBurdenRate=${burden.totalBurdenRate.toFixed(3)} outside [0, ${config.maxLocalExtractionRate}] (§17.3)`,
        })
      }
    }
  }

  // --- v0.23: Person Goal integrity ---
  for (const [personIdStr, person] of Object.entries(state.persons)) {
    if (!person || !person.alive) continue
    if (person.kind === 'placeholder') continue
    if (person.age < 15) continue // adultAge
    if (!person.houseId) continue

    const house = state.houses[person.houseId]
    if (!house || !house.active) continue

    // Count active Person Goals (check for > 1, which is always invalid)
    const ownerKey = `person:${personIdStr}`
    const goalIds = state.goalIndex.byOwner[ownerKey]
    let activeGoalCount = 0
    if (goalIds) {
      for (const gid of goalIds) {
        const goal = state.goals[gid]
        if (goal && goal.status === 'active') activeGoalCount++
      }
    }
    if (activeGoalCount > 1) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Person ${personIdStr}: expected at most 1 active Person Goal, found ${activeGoalCount}`,
      })
    }
  }

  // --- v0.40 §13: Person.lifeStage 検査 ---
  // alive normal person は lifeStage を持ち、union 内であり、age と極端に矛盾しない（緩い envelope）。
  // placeholder は mature_adulthood 固定を別途検査し、age-lifeStage envelope からは除外する。
  // 逆行検査は行わない（writer 側で一方向遷移を保証する）。
  {
    const LIFE_STAGES: readonly string[] = [
      'childhood',
      'adolescence',
      'young_adulthood',
      'mature_adulthood',
      'old_age',
    ]
    // §13.4: 「明らかな破損のみ」を捕捉する意図的に緩い envelope（forced transition 上限より緩い）。
    const AGE_ENVELOPE: Record<string, { min: number; max: number }> = {
      childhood: { min: 0, max: 20 },
      adolescence: { min: 8, max: 25 },
      young_adulthood: { min: 16, max: 50 },
      mature_adulthood: { min: 30, max: 75 },
      old_age: { min: 55, max: Infinity },
    }
    for (const [personIdStr, person] of Object.entries(state.persons)) {
      if (!person || !person.alive) continue
      if (person.kind === 'placeholder') {
        // §13.3: placeholder は mature_adulthood 固定。
        if (person.lifeStage !== 'mature_adulthood') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Placeholder Person ${personIdStr}: lifeStage must be 'mature_adulthood', got '${person.lifeStage}'`,
          })
        }
        continue
      }
      if (!LIFE_STAGES.includes(person.lifeStage)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Person ${personIdStr}: lifeStage '${person.lifeStage}' is not a valid LifeStage`,
        })
        continue
      }
      const envelope = AGE_ENVELOPE[person.lifeStage]
      if (envelope && (person.age < envelope.min || person.age > envelope.max)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Person ${personIdStr}: age ${person.age} outside envelope [${envelope.min}, ${envelope.max}] for lifeStage '${person.lifeStage}'`,
        })
      }
    }
  }

  // --- Aim activeTaskId / activeDiplomaticPlayId mutual exclusion ---
  for (const [aimIdStr, aim] of Object.entries(state.aims)) {
    if (!aim || aim.status !== 'active') continue
    let count = 0
    if (aim.activeTaskId) count++
    if (aim.activeDiplomaticPlayId) count++
    if (count > 1) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Aim ${aimIdStr}: has ${count} active refs (activeTaskId/activeDiplomaticPlayId) but at most 1 is allowed`,
      })
    }
  }

  // --- v0.23: Person Goal progress range ---
  for (const [goalIdStr, goal] of Object.entries(state.goals)) {
    if (!goal) continue
    if (goal.owner.kind === 'person') {
      if (goal.progress < 0 || goal.progress > 100) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Person Goal ${goalIdStr}: progress ${goal.progress} outside range [0, 100]`,
        })
      }
    }
  }

  // --- v0.23: support_organization_aim target integrity ---
  for (const [aimIdStr, aim] of Object.entries(state.aims)) {
    if (!aim) continue
    if (aim.kind !== 'support_organization_aim') continue
    if (aim.status !== 'active') continue

    if (!aim.target || aim.target.kind !== 'aim') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `support_organization_aim ${aimIdStr}: missing or invalid target (expected kind='aim')`,
      })
      continue
    }

    const targetAim = state.aims[aim.target.id]
    if (!targetAim) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `support_organization_aim ${aimIdStr}: target aim ${aim.target.id as string} not found`,
      })
    } else if (targetAim.status !== 'active') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `support_organization_aim ${aimIdStr}: active but target aim ${aim.target.id as string} is ${targetAim.status}`,
      })
    }
  }

  // --- Project integrity ---
  for (const [idStr, project] of Object.entries(state.projects)) {
    if (!project) continue

    if ((project.id as string) !== idStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: id mismatch (${project.id})`,
      })
    }

    if (
      project.status === 'completed' ||
      project.status === 'failed' ||
      project.status === 'cancelled'
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: terminal project in state (status=${project.status})`,
      })
      // v0.44 §12.2: terminal status は terminalReason 必須。terminal project は
      // 同 tick 〜 4 週内に削除されるため年末 integrity では実質発火せず、
      // --integrity-per-system の mid-tick 検証で捕捉する。
      if (project.terminalReason === undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: terminal status=${project.status} without terminalReason (§12.2)`,
        })
      }
    } else if (project.terminalReason !== undefined) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: active project with terminalReason=${project.terminalReason} (§12.2)`,
      })
    }

    // v0.44 §12.2: personal_training invariants (owner/creator/supervisor/trainee 全一致 §6.4)
    if (project.kind === 'personal_training') {
      // owner.kind は型上 'person' 固定だが、project 構築は \`as Project\` を通るため runtime 検査する
      const ownerKind: string = project.owner.kind
      if (ownerKind !== 'person') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: personal_training owner is not a person (${ownerKind}) (§12.2)`,
        })
      } else if ((project.owner.id as string) !== (project.traineePersonId as string)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: personal_training owner ${project.owner.id as string} !== trainee ${project.traineePersonId as string} (§12.2)`,
        })
      }
      if (!state.persons[project.traineePersonId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: personal_training trainee ${project.traineePersonId as string} does not exist (§12.2)`,
        })
      }
      if ((project.creatorPersonId as string) !== (project.traineePersonId as string)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: personal_training creator ${project.creatorPersonId as string} !== trainee (§12.2)`,
        })
      }
      if ((project.supervisorPersonId as string) !== (project.traineePersonId as string)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: personal_training supervisor ${project.supervisorPersonId as string} !== trainee (§12.2)`,
        })
      }
      if (!VALID_ABILITY_KEYS.has(project.trainingAbilityKey)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: personal_training invalid trainingAbilityKey ${String(project.trainingAbilityKey)} (§12.2)`,
        })
      }
    }

    const creator = state.persons[project.creatorPersonId]
    if (!creator) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: creator ${project.creatorPersonId} does not exist`,
      })
    }

    const supervisor = state.persons[project.supervisorPersonId]
    if (!supervisor) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: supervisor ${project.supervisorPersonId} does not exist`,
      })
    } else if (project.status === 'active' && !supervisor.alive) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: active project but supervisor ${project.supervisorPersonId} is dead`,
      })
    }

    if (project.origin.kind === 'aim') {
      const aim = state.aims[project.origin.aimId]
      if (!aim) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: origin aim ${project.origin.aimId} does not exist`,
        })
      }
    }
  }

  // --- v0.29 §19.2: currentStageKey validation for all project kinds ---
  for (const [idStr, project] of Object.entries(state.projects)) {
    if (!project || project.status !== 'active') continue
    const validKeys = PROJECT_STAGE_SEQUENCES[project.kind]
    if (!validKeys.some((e) => e.key === project.currentStageKey)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: currentStageKey=${project.currentStageKey} is not valid for kind=${project.kind} (§19.2)`,
      })
    }
  }

  // --- v0.27 §19.3-§19.4: develop_holding project checks ---
  {
    const activeDevelopByHolding: Record<string, string[]> = {}

    for (const [idStr, project] of Object.entries(state.projects)) {
      if (!project || project.kind !== 'develop_holding') continue
      if (project.status !== 'active') continue

      // §19.3: ProjectBudget non-negative
      if (project.budget.required < 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: budget.required=${project.budget.required} must be >= 0 (§19.3)`,
        })
      }
      if (project.budget.allocated < 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: budget.allocated=${project.budget.allocated} must be >= 0 (§19.3)`,
        })
      }
      if (project.budget.remaining < 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: budget.remaining=${project.budget.remaining} must be >= 0 (§19.3)`,
        })
      }
      if (project.budget.spent < 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: budget.spent=${project.budget.spent} must be >= 0 (§19.3)`,
        })
      }

      // §19.3: allocated === remaining + spent
      const budgetSum = project.budget.remaining + project.budget.spent
      if (Math.abs(project.budget.allocated - budgetSum) > 0.01) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: budget.allocated (${project.budget.allocated}) !== remaining (${project.budget.remaining}) + spent (${project.budget.spent}) (§19.3)`,
        })
      }

      // §19.3: pre-budget stages should have zero budget allocation
      const stageType = getProjectStageType(project.kind, project.currentStageKey)
      if (stageType === 'immediate') {
        if (
          project.budget.allocated !== 0 ||
          project.budget.remaining !== 0 ||
          project.budget.spent !== 0
        ) {
          if (debug) {
            console.warn(
              `INTEGRITY (§19.3 warn): Project ${idStr}: stage=${project.currentStageKey} but budget allocated/remaining/spent not all zero`,
            )
          }
        }
      }

      // §19.4: holdingId exists
      if (!state.holdings[project.holdingId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: holdingId=${project.holdingId as string} does not exist (§19.4)`,
        })
      }

      // §19.4: improvementKind is valid
      if (!VALID_HOLDING_IMPROVEMENT_KINDS.has(project.improvementKind)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: improvementKind=${project.improvementKind} is not valid (§19.4)`,
        })
      }

      // §19.4: targetImprovementLevel <= max level
      const holding = state.holdings[project.holdingId]
      if (holding && config) {
        // v0.33 §13.2: access 反転。0（未定義含む）= 建設不可。
        const maxLevel =
          config.holdingImprovementMaxLevelByKind[project.improvementKind][holding.kind] ?? 0
        if (project.targetImprovementLevel > maxLevel) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Project ${idStr}: targetImprovementLevel=${project.targetImprovementLevel} exceeds max ${maxLevel} for ${holding.kind}/${project.improvementKind} (§19.4)`,
          })
        }
      }

      // §19.4: at most 1 active develop_holding per holdingId
      const holdingKey = project.holdingId as string
      const activeList = activeDevelopByHolding[holdingKey] ?? []
      activeList.push(idStr)
      activeDevelopByHolding[holdingKey] = activeList
    }

    for (const [holdingKey, projectIds] of Object.entries(activeDevelopByHolding)) {
      if (projectIds.length > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Holding ${holdingKey}: ${projectIds.length} active develop_holding projects (limit 1) (§19.4)`,
        })
      }
    }
  }

  // Project index forward consistency
  for (const [key, pids] of Object.entries(state.projectIndex.byOwner)) {
    for (const pid of pids ?? []) {
      const p = state.projects[pid]
      if (!p) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `projectIndex.byOwner[${key}]: project ${pid} does not exist`,
        })
      } else if (decisionSubjectKey(p.owner) !== key) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `projectIndex.byOwner[${key}]: project ${pid} has owner ${decisionSubjectKey(p.owner)}`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.projectIndex.byAim)) {
    for (const pid of pids ?? []) {
      const p = state.projects[pid]
      if (!p) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `projectIndex.byAim[${key}]: project ${pid} does not exist`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.projectIndex.byCreatorPerson)) {
    for (const pid of pids ?? []) {
      const p = state.projects[pid]
      if (!p) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `projectIndex.byCreatorPerson[${key}]: project ${pid} does not exist`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.projectIndex.bySupervisorPerson)) {
    for (const pid of pids ?? []) {
      const p = state.projects[pid]
      if (!p) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `projectIndex.bySupervisorPerson[${key}]: project ${pid} does not exist`,
        })
      }
    }
  }

  // Task targetRef project validation
  for (const [, task] of Object.entries(state.tasks)) {
    if (!task || task.status !== 'active') continue
    if (task.targetRef.kind === 'project') {
      const project = state.projects[task.targetRef.id]
      if (!project) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Task ${task.id}: targetRef project ${task.targetRef.id} does not exist`,
        })
      }
    }
  }

  // --- v0.29 §30: diplomatic Project diplomaticPlayId validation ---
  for (const [idStr, project] of Object.entries(state.projects)) {
    if (!project || project.status !== 'active') continue
    if (!isDiplomaticProjectKind(project.kind)) continue
    const dpProject = project as
      | LandClaimProject
      | ContractRevisionProject
      | RespondToPressureProject
    if (dpProject.diplomaticPlayId) {
      const play = state.diplomaticPlays[dpProject.diplomaticPlayId]
      if (!play) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: diplomaticPlayId ${dpProject.diplomaticPlayId as string} does not exist (§30)`,
        })
      }
    }
  }

  // --- Pressure integrity ---

  // P1: Each Pressure's references must be valid
  for (const [pidStr, pressure] of Object.entries(state.pressures)) {
    if (!pressure) continue

    // Terminal pressures should be purged by cleanupTerminalDiplomacy
    if (pressure.status === 'resolved' || pressure.status === 'cancelled') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Pressure ${pidStr}: terminal status '${pressure.status}' should have been cleaned up`,
      })
    }

    // relatedDiplomaticPlayId must reference existing DiplomaticPlay
    if (pressure.relatedDiplomaticPlayId) {
      const play = state.diplomaticPlays[pressure.relatedDiplomaticPlayId]
      if (!play) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Pressure ${pidStr}: relatedDiplomaticPlayId ${pressure.relatedDiplomaticPlayId as string} does not exist`,
        })
      }
    }

    // responseProjectId must reference a Project with kind === 'respond_to_pressure' if it still exists.
    // Projects are purged from state once terminal, so a missing project is acceptable (stale reference).
    if (pressure.responseProjectId) {
      const project = state.projects[pressure.responseProjectId]
      if (project && project.kind !== 'respond_to_pressure') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Pressure ${pidStr}: responseProjectId ${pressure.responseProjectId as string} has kind '${project.kind}', expected 'respond_to_pressure'`,
        })
      }
    }
  }

  // P2: Each active respond_to_pressure Project's pressureId must reference existing Pressure
  for (const [projIdStr, project] of Object.entries(state.projects)) {
    if (!project) continue
    if (project.kind !== 'respond_to_pressure') continue
    if (
      project.status === 'completed' ||
      project.status === 'failed' ||
      project.status === 'cancelled'
    )
      continue

    const pressure = state.pressures[project.pressureId]
    if (!pressure) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${projIdStr} (respond_to_pressure): pressureId ${project.pressureId as string} does not exist`,
      })
    }
  }

  // P3: pressureIndex consistency
  for (const [key, pids] of Object.entries(state.pressureIndex.byTarget)) {
    for (const pid of pids ?? []) {
      const pressure = state.pressures[pid]
      if (!pressure) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byTarget[${key}]: pressure ${pid as string} does not exist`,
        })
      } else if (decisionSubjectKey(pressure.target) !== key) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byTarget[${key}]: pressure ${pid as string} has target ${decisionSubjectKey(pressure.target)}`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.pressureIndex.bySource)) {
    for (const pid of pids ?? []) {
      const pressure = state.pressures[pid]
      if (!pressure) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.bySource[${key}]: pressure ${pid as string} does not exist`,
        })
      } else if (decisionSubjectKey(pressure.source) !== key) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.bySource[${key}]: pressure ${pid as string} has source ${decisionSubjectKey(pressure.source)}`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.pressureIndex.byDiplomaticPlay)) {
    for (const pid of pids ?? []) {
      const pressure = state.pressures[pid]
      if (!pressure) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byDiplomaticPlay[${key}]: pressure ${pid as string} does not exist`,
        })
      } else if ((pressure.relatedDiplomaticPlayId as string) !== key) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byDiplomaticPlay[${key}]: pressure ${pid as string} has relatedDiplomaticPlayId ${pressure.relatedDiplomaticPlayId as string}`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.pressureIndex.byProject)) {
    for (const pid of pids ?? []) {
      const pressure = state.pressures[pid]
      if (!pressure) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byProject[${key}]: pressure ${pid as string} does not exist`,
        })
      } else if ((pressure.responseProjectId as string) !== key) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byProject[${key}]: pressure ${pid as string} has responseProjectId ${pressure.responseProjectId as string}`,
        })
      }
    }
  }

  // ─── Chronicle index ↔ entry 内部整合 (v0.38 §7.1) ───
  //   index↔entry の構造整合のみ検査する。entityRefs の参照先が現在 state に存在するか
  //   (active か / 死亡人物か / 断絶家か / 終了 War か) は検査しない (soft-ref。§7.1)。
  //   index 対象は person/house/polity/province/holding の 5 kind のみ。
  const chronicleIndexAxes: ReadonlyArray<{
    kind: 'person' | 'house' | 'polity' | 'province' | 'holding'
    label: string
    index: Record<string, ChronicleEntryId[]>
  }> = [
    { kind: 'person', label: 'byPerson', index: state.chronicleIndex.byPerson },
    { kind: 'house', label: 'byHouse', index: state.chronicleIndex.byHouse },
    { kind: 'polity', label: 'byPolity', index: state.chronicleIndex.byPolity },
    { kind: 'province', label: 'byProvince', index: state.chronicleIndex.byProvince },
    { kind: 'holding', label: 'byHolding', index: state.chronicleIndex.byHolding },
  ]
  // forward: index に載る entry id が実在し、その entityRefs に (kind, key) を含む
  for (const axis of chronicleIndexAxes) {
    for (const [key, eids] of Object.entries(axis.index)) {
      for (const eid of eids ?? []) {
        const entry = state.chronicleEntries[eid]
        if (!entry) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `chronicleIndex.${axis.label}[${key}] references missing ChronicleEntry ${eid as string} (v0.38 §7.1)`,
          })
          continue
        }
        if (!entry.entityRefs.some((r) => r.kind === axis.kind && r.id === key)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `chronicleIndex.${axis.label}[${key}] entry ${eid as string} has no matching ${axis.kind} entityRef (v0.38 §7.1)`,
          })
        }
      }
    }
  }
  // reverse: 各 entry の 5 index 対象 kind の ref が、対応 index に entry id として登録済み
  {
    const bucketByKind: Partial<Record<string, Record<string, ChronicleEntryId[]>>> = {
      person: state.chronicleIndex.byPerson,
      house: state.chronicleIndex.byHouse,
      polity: state.chronicleIndex.byPolity,
      province: state.chronicleIndex.byProvince,
      holding: state.chronicleIndex.byHolding,
    }
    for (const [eidStr, entry] of Object.entries(state.chronicleEntries)) {
      for (const r of entry.entityRefs) {
        const bucket = bucketByKind[r.kind]
        if (!bucket) continue // faction/clan 等 index 非対象 kind は検査しない (§5.2)
        const indexed = bucket[r.id] ?? []
        if (!indexed.includes(entry.id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `ChronicleEntry ${eidStr} ${r.kind} ref ${r.id} is not registered in chronicleIndex (v0.38 §7.1)`,
          })
        }
      }
    }
  }
}
