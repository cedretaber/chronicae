import type { WorldState } from '../types/world'
import type { Pressure, PressureKind, PressureStatus, ObligationRef } from '../types/pressure'
import type { DecisionSubjectRef } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { PressureId, DiplomaticPlayId, ProjectId, DecisionReasonId } from '../types/ids'
import { createPressureId } from '../types/ids'

export type CreatePressureInput = {
  kind: PressureKind
  source: DecisionSubjectRef
  target: DecisionSubjectRef
  relatedDiplomaticPlayId?: DiplomaticPlayId
  relatedProjectId?: ProjectId
  relatedObligation?: ObligationRef
  priority: number
  createdWeek: number
  deadlineWeek?: number
  status: PressureStatus
  reasonIds: DecisionReasonId[]
}

function addPressureToIndexMut(ws: WorldState, pressure: Pressure): void {
  const targetKey = decisionSubjectKey(pressure.target)
  ws.pressureIndex.byTarget[targetKey] = [
    ...(ws.pressureIndex.byTarget[targetKey] ?? []),
    pressure.id,
  ]

  const sourceKey = decisionSubjectKey(pressure.source)
  ws.pressureIndex.bySource[sourceKey] = [
    ...(ws.pressureIndex.bySource[sourceKey] ?? []),
    pressure.id,
  ]

  if (pressure.relatedDiplomaticPlayId) {
    const playKey = pressure.relatedDiplomaticPlayId
    ws.pressureIndex.byDiplomaticPlay[playKey] = [
      ...(ws.pressureIndex.byDiplomaticPlay[playKey] ?? []),
      pressure.id,
    ]
  }

  if (pressure.responseProjectId) {
    const projKey = pressure.responseProjectId
    ws.pressureIndex.byProject[projKey] = [
      ...(ws.pressureIndex.byProject[projKey] ?? []),
      pressure.id,
    ]
  }
}

export function removePressureFromIndexMut(ws: WorldState, pressure: Pressure): void {
  const targetKey = decisionSubjectKey(pressure.target)
  const targetArr = ws.pressureIndex.byTarget[targetKey]
  if (targetArr) {
    ws.pressureIndex.byTarget[targetKey] = targetArr.filter(
      (id) => (id as string) !== (pressure.id as string),
    )
    if (ws.pressureIndex.byTarget[targetKey]?.length === 0) {
      delete ws.pressureIndex.byTarget[targetKey]
    }
  }

  const sourceKey = decisionSubjectKey(pressure.source)
  const sourceArr = ws.pressureIndex.bySource[sourceKey]
  if (sourceArr) {
    ws.pressureIndex.bySource[sourceKey] = sourceArr.filter(
      (id) => (id as string) !== (pressure.id as string),
    )
    if (ws.pressureIndex.bySource[sourceKey]?.length === 0) {
      delete ws.pressureIndex.bySource[sourceKey]
    }
  }

  if (pressure.relatedDiplomaticPlayId) {
    const playKey = pressure.relatedDiplomaticPlayId
    const playArr = ws.pressureIndex.byDiplomaticPlay[playKey]
    if (playArr) {
      ws.pressureIndex.byDiplomaticPlay[playKey] = playArr.filter(
        (id) => (id as string) !== (pressure.id as string),
      )
      if (ws.pressureIndex.byDiplomaticPlay[playKey]?.length === 0) {
        delete ws.pressureIndex.byDiplomaticPlay[playKey]
      }
    }
  }

  if (pressure.responseProjectId) {
    const projKey = pressure.responseProjectId
    const projArr = ws.pressureIndex.byProject[projKey]
    if (projArr) {
      ws.pressureIndex.byProject[projKey] = projArr.filter(
        (id) => (id as string) !== (pressure.id as string),
      )
      if (ws.pressureIndex.byProject[projKey]?.length === 0) {
        delete ws.pressureIndex.byProject[projKey]
      }
    }
  }
}

export function createPressureMut(ws: WorldState, input: CreatePressureInput): Pressure {
  const id = createPressureId(ws.nextPressureId)
  ws.nextPressureId++

  const pressure: Pressure = {
    id,
    kind: input.kind,
    source: input.source,
    target: input.target,
    ...(input.relatedDiplomaticPlayId !== undefined && {
      relatedDiplomaticPlayId: input.relatedDiplomaticPlayId,
    }),
    ...(input.relatedProjectId !== undefined && { relatedProjectId: input.relatedProjectId }),
    ...(input.relatedObligation !== undefined && { relatedObligation: input.relatedObligation }),
    priority: input.priority,
    createdWeek: input.createdWeek,
    ...(input.deadlineWeek !== undefined && { deadlineWeek: input.deadlineWeek }),
    status: input.status,
    reasonIds: input.reasonIds,
  }

  ws.pressures[id] = pressure
  addPressureToIndexMut(ws, pressure)
  return pressure
}

export function setPressureResponseProjectMut(
  ws: WorldState,
  pressureId: PressureId,
  projectId: ProjectId,
): void {
  const pressure = ws.pressures[pressureId]
  if (!pressure) return

  const updated: Pressure = { ...pressure, responseProjectId: projectId }
  ws.pressures[pressureId] = updated

  const projKey = projectId
  ws.pressureIndex.byProject[projKey] = [...(ws.pressureIndex.byProject[projKey] ?? []), pressureId]
}

// v0.53: 義務 entity (seizure/default) に紐づく Pressure を Record + index から完全削除する。
//   obligation が resolved/legalized/cancelled になった時に呼ぶ。obligation Pressure は
//   DiplomaticPlay に紐づかず cleanupTerminalDiplomacy の purge 対象外なので、terminal status を
//   残すと integrity 違反 (P1) になる。よって status を残さず削除する。
//   caller の draft は pressures + pressureIndex を含めること。
export function removeObligationPressuresMut(ws: WorldState, obligation: ObligationRef): void {
  for (const [, pressure] of Object.entries(ws.pressures)) {
    if (!pressure) continue
    const ref = pressure.relatedObligation
    if (!ref) continue
    if (ref.kind === obligation.kind && (ref.id as string) === (obligation.id as string)) {
      removePressureFromIndexMut(ws, pressure)
      delete ws.pressures[pressure.id]
    }
  }
}
