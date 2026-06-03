import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import type { ProvinceId, PolityId, PersonId } from '../types/ids'
import { createGoalId, createAimId, createDecisionReasonId } from '../types/ids'
import { defaultConfig } from '../config/defaultConfig'
import { generateInitialRegiments } from './generateInitialRegiments'
import type { Goal, Aim, DecisionReason } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { DecisionSubjectRef } from '../types/goal'
import type { SimulationConfig } from '../config/defaultConfig'
import { selectGoalKind, pickAimForGoal } from '../selectors/goalSelectors'
import { selectPersonGoalKind } from '../selectors/personGoalSelectors'
import { pickPersonAim } from '../selectors/personAimSelectors'
import { createInitialTaskForAim } from '../mutations/taskMutations'

function seedGoalAndAim(
  state: WorldState,
  config: SimulationConfig,
  owner: DecisionSubjectRef,
  rng: RngState,
): { state: WorldState; rng: RngState } | undefined {
  const goalSelection = selectGoalKind(state, config, owner, rng)
  if (!goalSelection) return undefined

  const { kind: goalKind, rng: rng1 } = goalSelection
  const absoluteWeek = state.absoluteWeek

  // Create DecisionReason for Goal
  const goalReasonId = createDecisionReasonId(state.nextDecisionReasonId)
  const goalReason: DecisionReason = {
    id: goalReasonId,
    owner,
    summaryKey: `decision.reason.goal.${goalKind}`,
    weight: 1,
    createdWeek: absoluteWeek,
  }

  // Create Goal
  const goalId = createGoalId(state.nextGoalId)
  const goal: Goal = {
    id: goalId,
    owner,
    kind: goalKind,
    priority: 1,
    progress: 0,
    targetProgress: 100,
    createdWeek: absoluteWeek,
    minimumUntilWeek: absoluteWeek + config.goalMinimumDurationWeeks,
    lastReviewWeek: absoluteWeek,
    nextReviewWeek: absoluteWeek + config.goalReviewIntervalWeeks,
    status: 'active',
    reasonIds: [goalReasonId],
  }

  const ownerKey = decisionSubjectKey(owner)
  const existingOwnerGoals = state.goalIndex.byOwner[ownerKey] ?? []

  let nextState: WorldState = {
    ...state,
    goals: { ...state.goals, [goalId]: goal },
    decisionReasons: { ...state.decisionReasons, [goalReasonId]: goalReason },
    goalIndex: {
      byOwner: {
        ...state.goalIndex.byOwner,
        [ownerKey]: [...existingOwnerGoals, goalId],
      },
    },
    nextGoalId: state.nextGoalId + 1,
    nextDecisionReasonId: state.nextDecisionReasonId + 1,
  }

  // Create Aim for the Goal
  const aimResult = pickAimForGoal(nextState, config, goal, rng1)
  if (!aimResult) return { state: nextState, rng: rng1 }

  const { kind: aimKind, target, rng: rng2 } = aimResult

  const aimReasonId = createDecisionReasonId(nextState.nextDecisionReasonId)
  const aimReason: DecisionReason = {
    id: aimReasonId,
    owner,
    summaryKey: `decision.reason.aim.${aimKind}`,
    weight: 1,
    createdWeek: absoluteWeek,
  }

  const aimId = createAimId(nextState.nextAimId)
  const aim: Aim = {
    id: aimId,
    owner,
    goalId,
    origin: 'goal_driven',
    kind: aimKind,
    priority: 1,
    progress: 0,
    targetProgress: 1,
    createdWeek: absoluteWeek,
    deadlineWeek: absoluteWeek + config.aimDefaultDeadlineWeeks,
    successfulProjectCount: 0,
    failedProjectCount: 0,
    status: 'active',
    reasonIds: [aimReasonId],
    ...(target ? { target } : {}),
  }

  const existingOwnerAims = nextState.aimIndex.byOwner[ownerKey] ?? []
  const existingGoalAims = nextState.aimIndex.byGoal[goalId as string] ?? []

  nextState = {
    ...nextState,
    aims: { ...nextState.aims, [aimId]: aim },
    decisionReasons: { ...nextState.decisionReasons, [aimReasonId]: aimReason },
    aimIndex: {
      byOwner: {
        ...nextState.aimIndex.byOwner,
        [ownerKey]: [...existingOwnerAims, aimId],
      },
      byGoal: {
        ...nextState.aimIndex.byGoal,
        [goalId as string]: [...existingGoalAims, aimId],
      },
    },
    nextAimId: nextState.nextAimId + 1,
    nextDecisionReasonId: nextState.nextDecisionReasonId + 1,
  }

  return { state: nextState, rng: rng2 }
}

// generateWorld の post-assembly フェーズ: 完成済み world に対し Polity/House/Person の
// 初期 Goal/Aim/Task を seed し、debug 設定があれば mixed holdings を適用、最後に
// generateInitialRegiments で連隊を生成して最終 WorldState を返す。
// rng 消費順は分割前と完全一致 (verbatim 抽出)。
export function seedInitialDecisions(
  world: WorldState,
  seedText: string,
  rng: RngState,
): { world: WorldState; rng: RngState } {
  // v0.22: Seed initial Goal + Aim for all active Polities and Houses
  let seededWorld = world
  let seedRng = rng

  // Seed Polity goals
  for (const [, polity] of Object.entries(seededWorld.polities)) {
    if (!polity || !polity.active) continue
    const owner: DecisionSubjectRef = { kind: 'polity', id: polity.id }
    const result = seedGoalAndAim(seededWorld, defaultConfig, owner, seedRng)
    if (result) {
      seededWorld = result.state
      seedRng = result.rng
    }
  }

  // Seed House goals
  for (const [, house] of Object.entries(seededWorld.houses)) {
    if (!house || !house.active) continue
    if (house.kind === 'system') continue
    const owner: DecisionSubjectRef = { kind: 'house', id: house.id }
    const result = seedGoalAndAim(seededWorld, defaultConfig, owner, seedRng)
    if (result) {
      seededWorld = result.state
      seedRng = result.rng
    }
  }

  // v0.23: Seed Person goals and aims
  for (const personId of seededWorld.livingPersonIds) {
    const person = seededWorld.persons[personId]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (person.age < defaultConfig.adultAge) continue
    if (!person.houseId) continue
    const house = seededWorld.houses[person.houseId]
    if (!house || !house.active) continue

    // Create Person Goal
    const goalSelection = selectPersonGoalKind(seededWorld, defaultConfig, personId, seedRng)
    if (!goalSelection) continue
    const { kind: goalKind, rng: rng1 } = goalSelection
    seedRng = rng1

    const owner: DecisionSubjectRef = { kind: 'person', id: personId }
    const goalReasonId = createDecisionReasonId(seededWorld.nextDecisionReasonId)
    const goalReason: DecisionReason = {
      id: goalReasonId,
      owner,
      summaryKey: `decision.reason.goal.${goalKind}`,
      weight: 1,
      createdWeek: seededWorld.absoluteWeek,
    }
    const goalId = createGoalId(seededWorld.nextGoalId)
    const goal: Goal = {
      id: goalId,
      owner,
      kind: goalKind,
      priority: 1,
      progress: 0,
      targetProgress: 100,
      createdWeek: seededWorld.absoluteWeek,
      minimumUntilWeek: seededWorld.absoluteWeek + defaultConfig.goalMinimumDurationWeeks,
      lastReviewWeek: seededWorld.absoluteWeek,
      nextReviewWeek: seededWorld.absoluteWeek + defaultConfig.personGoalReviewIntervalWeeks,
      status: 'active',
      reasonIds: [goalReasonId],
    }

    const ownerKey = decisionSubjectKey(owner)
    const existingGoalIds = seededWorld.goalIndex.byOwner[ownerKey] ?? []

    seededWorld = {
      ...seededWorld,
      goals: { ...seededWorld.goals, [goalId]: goal },
      decisionReasons: { ...seededWorld.decisionReasons, [goalReasonId]: goalReason },
      goalIndex: {
        byOwner: { ...seededWorld.goalIndex.byOwner, [ownerKey]: [...existingGoalIds, goalId] },
      },
      nextGoalId: seededWorld.nextGoalId + 1,
      nextDecisionReasonId: seededWorld.nextDecisionReasonId + 1,
    }

    // Create Person Aim
    const aimResult = pickPersonAim(seededWorld, defaultConfig, personId, goal, seedRng)
    if (!aimResult) continue
    const { kind: aimKind, target, rng: rng2 } = aimResult
    seedRng = rng2

    const aimReasonId = createDecisionReasonId(seededWorld.nextDecisionReasonId)
    const aimReason: DecisionReason = {
      id: aimReasonId,
      owner,
      summaryKey: `decision.reason.aim.${aimKind}`,
      weight: 1,
      createdWeek: seededWorld.absoluteWeek,
    }
    const aimId = createAimId(seededWorld.nextAimId)
    const deadlineWeeks =
      aimKind === 'obtain_office'
        ? defaultConfig.personAimDeadlineObtainOffice
        : aimKind === 'retain_office'
          ? defaultConfig.personAimDeadlineRetainOffice
          : defaultConfig.personAimDeadlineDefault
    const targetProgress = aimKind === 'obtain_office' ? 2 : 3
    const aim: Aim = {
      id: aimId,
      owner,
      goalId,
      origin: 'goal_driven',
      kind: aimKind,
      priority: 1,
      progress: 0,
      targetProgress,
      createdWeek: seededWorld.absoluteWeek,
      deadlineWeek: seededWorld.absoluteWeek + deadlineWeeks,
      successfulProjectCount: 0,
      failedProjectCount: 0,
      status: 'active',
      reasonIds: [aimReasonId],
      ...(target !== undefined ? { target } : {}),
    }

    const existingAimOwner = seededWorld.aimIndex.byOwner[ownerKey] ?? []
    const existingAimGoal = seededWorld.aimIndex.byGoal[goalId as string] ?? []

    seededWorld = {
      ...seededWorld,
      aims: { ...seededWorld.aims, [aimId]: aim },
      decisionReasons: { ...seededWorld.decisionReasons, [aimReasonId]: aimReason },
      aimIndex: {
        byOwner: { ...seededWorld.aimIndex.byOwner, [ownerKey]: [...existingAimOwner, aimId] },
        byGoal: { ...seededWorld.aimIndex.byGoal, [goalId as string]: [...existingAimGoal, aimId] },
      },
      nextAimId: seededWorld.nextAimId + 1,
      nextDecisionReasonId: seededWorld.nextDecisionReasonId + 1,
    }

    // Create initial Task for the Aim
    const taskResult = createInitialTaskForAim(
      seededWorld,
      defaultConfig,
      aim,
      seededWorld.absoluteWeek,
    )
    if (taskResult) {
      const aimWithTask: Aim = { ...aim, activeTaskId: taskResult.task.id }
      seededWorld = {
        ...taskResult.state,
        aims: { ...taskResult.state.aims, [aimId]: aimWithTask },
      }
    }
  }

  if (defaultConfig.debugMixedProvinceHoldingsRatio > 0) {
    applyMixedHoldingsDebug(seededWorld, defaultConfig)
  }

  seededWorld = {
    ...seededWorld,
    livingPersonIds: (Object.keys(seededWorld.persons) as PersonId[])
      .filter((id) => seededWorld.persons[id]?.alive)
      .sort(),
  }

  // v0.36: persistent Regiment を post-pass で生成する (§8.1)。完成 WorldState を要求する
  //   calcPolityMilitaryPower を使うため worldgen 本体の後に置く。sub-rng を内部で使い seedRng は消費しない
  //   (→ sim trajectory は v0.35 と bit 一致)。
  return { world: generateInitialRegiments(seededWorld, defaultConfig, seedText), rng: seedRng }
}

/**
 * Debug/scenario helper: transfer one holding per selected province to a
 * neighboring polity, creating mixed-ownership provinces that trigger
 * `consolidate_province_holdings` aims and `land_claim` diplomatic plays.
 *
 * Mutates `ws` in place.
 */
function applyMixedHoldingsDebug(ws: WorldState, config: SimulationConfig): void {
  const ratio = config.debugMixedProvinceHoldingsRatio

  // 1. Find eligible provinces (2+ holdings, not a capital)
  const candidates: ProvinceId[] = []
  for (const [provinceIdStr, province] of Object.entries(ws.provinces)) {
    if (!province) continue
    const provinceId = provinceIdStr as ProvinceId
    if (province.holdingIds.length < 2) continue

    // Determine the terminal polity for this province via first holding
    const firstHoldingId = province.holdingIds[0]
    if (!firstHoldingId) continue
    const terminalPolityId = ws.holdingTerminalPolityCache[firstHoldingId]
    if (!terminalPolityId) continue
    const terminalPolity = ws.polities[terminalPolityId]
    if (!terminalPolity?.active) continue

    // Skip capital provinces
    if (terminalPolity.capitalProvinceId === provinceId) continue

    candidates.push(provinceId)
  }

  if (candidates.length === 0) return

  // 2. Select a fraction deterministically (no RNG needed for debug)
  const count = Math.max(1, Math.round(candidates.length * ratio))
  const step = Math.max(1, Math.floor(1 / ratio))
  const selected: ProvinceId[] = []
  for (let i = 0; i < candidates.length && selected.length < count; i += step) {
    selected.push(candidates[i]!)
  }

  // 3. For each selected province, transfer the last holding to a neighbor
  for (const provinceId of selected) {
    const province = ws.provinces[provinceId]
    if (!province) continue
    if (province.holdingIds.length < 2) continue

    // Current terminal polity (via first holding)
    const firstHoldingId = province.holdingIds[0]
    if (!firstHoldingId) continue
    const currentPolityId = ws.holdingTerminalPolityCache[firstHoldingId]
    if (!currentPolityId) continue
    const currentPolity = ws.polities[currentPolityId]
    if (!currentPolity?.active) continue

    // Find a neighboring province owned by a different same-rank polity
    let targetPolityId: PolityId | undefined
    for (const neighborId of province.neighbors) {
      const neighborProv = ws.provinces[neighborId]
      if (!neighborProv) continue
      const neighborFirstHolding = neighborProv.holdingIds[0]
      if (!neighborFirstHolding) continue
      const neighborPolityId = ws.holdingTerminalPolityCache[neighborFirstHolding]
      if (!neighborPolityId || neighborPolityId === currentPolityId) continue
      const neighborPolity = ws.polities[neighborPolityId]
      if (!neighborPolity?.active) continue
      if (neighborPolity.rank === currentPolity.rank) {
        targetPolityId = neighborPolityId
        break
      }
    }
    if (!targetPolityId) continue

    // Pick the last holding to transfer (keep the first/heaviest for original owner)
    const holdingToTransfer = province.holdingIds[province.holdingIds.length - 1]
    if (!holdingToTransfer) continue

    // Find the terminal contract for this holding (last in chain = most grantee)
    const contractIds = ws.landContractIndex.byHolding[holdingToTransfer]
    if (!contractIds || contractIds.length === 0) continue

    const terminalContractId = contractIds[contractIds.length - 1]
    if (!terminalContractId) continue
    const terminalContract = ws.landContracts[terminalContractId]
    if (!terminalContract) continue

    // Only transfer if the terminal contract's grantee is the current polity
    if (terminalContract.granteePolityId !== currentPolityId) continue

    // Update the grantee polity on the terminal contract
    ws.landContracts[terminalContractId] = {
      ...terminalContract,
      granteePolityId: targetPolityId,
    }

    // Update byGranteePolity index: remove from old, add to new
    const oldGranteeContracts = ws.landContractIndex.byGranteePolity[currentPolityId]
    if (oldGranteeContracts) {
      ws.landContractIndex.byGranteePolity[currentPolityId] = oldGranteeContracts.filter(
        (id) => id !== terminalContractId,
      )
    }
    const newGranteeContracts = ws.landContractIndex.byGranteePolity[targetPolityId] ?? []
    ws.landContractIndex.byGranteePolity[targetPolityId] = [
      ...newGranteeContracts,
      terminalContractId,
    ]

    // Update holdingTerminalPolityCache
    ws.holdingTerminalPolityCache[holdingToTransfer] = targetPolityId
  }
}
