import type { WorldState } from '../types/world'
import type { Crisis, CrisisKind, CrisisStatus, RevoltDemand } from '../types/crisis'
import type {
  CrisisId,
  HoldingId,
  HoldingImprovementId,
  ProjectId,
  WarId,
  DecisionReasonId,
} from '../types/ids'
import { createCrisisId } from '../types/ids'

export type CreateCrisisInput = {
  kind: CrisisKind
  holdingId: HoldingId
  severity: number
  createdWeek: number
  deadlineWeek: number
  status: CrisisStatus
  reasonIds: DecisionReasonId[]
  sourceWarId?: WarId
  demand?: RevoltDemand
  targetImprovementId?: HoldingImprovementId // kind === 'disrepair' (v0.48.1)
}

function addCrisisToIndexMut(ws: WorldState, crisis: Crisis): void {
  const holdingKey = crisis.holdingId as string
  ws.crisisIndex.byHolding[holdingKey] = [
    ...(ws.crisisIndex.byHolding[holdingKey] ?? []),
    crisis.id,
  ]

  if (crisis.responseProjectId) {
    const projKey = crisis.responseProjectId
    ws.crisisIndex.byProject[projKey] = [...(ws.crisisIndex.byProject[projKey] ?? []), crisis.id]
  }
}

function removeCrisisFromIndexMut(ws: WorldState, crisis: Crisis): void {
  const holdingKey = crisis.holdingId as string
  const holdingArr = ws.crisisIndex.byHolding[holdingKey]
  if (holdingArr) {
    ws.crisisIndex.byHolding[holdingKey] = holdingArr.filter(
      (id) => (id as string) !== (crisis.id as string),
    )
    if (ws.crisisIndex.byHolding[holdingKey]?.length === 0) {
      delete ws.crisisIndex.byHolding[holdingKey]
    }
  }

  if (crisis.responseProjectId) {
    const projKey = crisis.responseProjectId
    const projArr = ws.crisisIndex.byProject[projKey]
    if (projArr) {
      ws.crisisIndex.byProject[projKey] = projArr.filter(
        (id) => (id as string) !== (crisis.id as string),
      )
      if (ws.crisisIndex.byProject[projKey]?.length === 0) {
        delete ws.crisisIndex.byProject[projKey]
      }
    }
  }
}

export function createCrisisMut(ws: WorldState, input: CreateCrisisInput): Crisis {
  const id = createCrisisId(ws.nextCrisisId)
  ws.nextCrisisId++

  const crisis: Crisis = {
    id,
    kind: input.kind,
    holdingId: input.holdingId,
    severity: input.severity,
    createdWeek: input.createdWeek,
    deadlineWeek: input.deadlineWeek,
    status: input.status,
    ...(input.sourceWarId !== undefined && { sourceWarId: input.sourceWarId }),
    ...(input.demand !== undefined && { demand: input.demand }),
    ...(input.targetImprovementId !== undefined && {
      targetImprovementId: input.targetImprovementId,
    }),
    reasonIds: input.reasonIds,
  }

  ws.crises[id] = crisis
  addCrisisToIndexMut(ws, crisis)
  return crisis
}

export function setCrisisResponseProjectMut(
  ws: WorldState,
  crisisId: CrisisId,
  projectId: ProjectId | undefined,
): void {
  const crisis = ws.crises[crisisId]
  if (!crisis) return

  // 旧 responseProject の byProject エントリを外す (再 spawn で付け替えるため)
  if (crisis.responseProjectId && crisis.responseProjectId !== projectId) {
    const oldKey = crisis.responseProjectId
    const oldArr = ws.crisisIndex.byProject[oldKey]
    if (oldArr) {
      ws.crisisIndex.byProject[oldKey] = oldArr.filter(
        (id) => (id as string) !== (crisisId as string),
      )
      if (ws.crisisIndex.byProject[oldKey]?.length === 0) {
        delete ws.crisisIndex.byProject[oldKey]
      }
    }
  }

  const updated: Crisis = { ...crisis }
  if (projectId === undefined) {
    delete updated.responseProjectId
  } else {
    updated.responseProjectId = projectId
  }
  ws.crises[crisisId] = updated

  if (projectId !== undefined) {
    ws.crisisIndex.byProject[projectId] = [...(ws.crisisIndex.byProject[projectId] ?? []), crisisId]
  }
}

export function setCrisisStatusMut(ws: WorldState, crisisId: CrisisId, status: CrisisStatus): void {
  const crisis = ws.crises[crisisId]
  if (!crisis) return
  ws.crises[crisisId] = { ...crisis, status }
}

export function setCrisisSeverityMut(ws: WorldState, crisisId: CrisisId, severity: number): void {
  const crisis = ws.crises[crisisId]
  if (!crisis) return
  ws.crises[crisisId] = { ...crisis, severity: Math.max(0, Math.min(100, severity)) }
}

export function removeCrisisMut(ws: WorldState, crisisId: CrisisId): void {
  const crisis = ws.crises[crisisId]
  if (!crisis) return
  removeCrisisFromIndexMut(ws, crisis)
  delete ws.crises[crisisId]
}
