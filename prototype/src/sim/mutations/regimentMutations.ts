// v0.36: Regiment entity の生成・index 管理・mutation helper。warMutations の add/remove + 空配列 delete purge に倣う。

import type { WorldState } from '../types/world'
import type { Regiment, RegimentSourceKind, RegimentTroopKind } from '../types/regiment'
import type { RegimentId, PolityId, HoldingId, ProvinceId, WarId } from '../types/ids'
import type { PoliticalActorRef } from '../types/actor'
import type { WarSideKey } from '../types/war'
import { createRegimentId } from '../types/ids'
import { politicalActorKey } from '../selectors/actorSelectors'

// --- index ---

export function addRegimentToIndexMut(ws: WorldState, regiment: Regiment): void {
  const ownerKey = politicalActorKey(regiment.owner)
  ws.regimentIndex.byOwner[ownerKey] = [...(ws.regimentIndex.byOwner[ownerKey] ?? []), regiment.id]

  if (regiment.homeProvinceId !== undefined) {
    ws.regimentIndex.byHomeProvince[regiment.homeProvinceId] = [
      ...(ws.regimentIndex.byHomeProvince[regiment.homeProvinceId] ?? []),
      regiment.id,
    ]
  }

  if (regiment.homeHoldingId !== undefined) {
    ws.regimentIndex.byHomeHolding[regiment.homeHoldingId] = [
      ...(ws.regimentIndex.byHomeHolding[regiment.homeHoldingId] ?? []),
      regiment.id,
    ]
  }
}

// --- creation ---

export type CreateRegimentInput = {
  owner: PoliticalActorRef
  sourceKind: RegimentSourceKind
  troopKind: RegimentTroopKind
  homeHoldingId?: HoldingId
  homeProvinceId?: ProvinceId
  strength: number
  organization: number
  morale: number
  maxStrength: number
  basePower: number
  createdWeek: number
}

export function createRegiment(ws: WorldState, input: CreateRegimentInput): Regiment {
  const id = createRegimentId(ws.nextRegimentId)
  const regiment: Regiment = {
    id,
    owner: input.owner,
    status: 'active',
    sourceKind: input.sourceKind,
    troopKind: input.troopKind,
    ...(input.homeHoldingId !== undefined ? { homeHoldingId: input.homeHoldingId } : {}),
    ...(input.homeProvinceId !== undefined ? { homeProvinceId: input.homeProvinceId } : {}),
    strength: input.strength,
    organization: input.organization,
    morale: input.morale,
    maxStrength: input.maxStrength,
    basePower: input.basePower,
    createdWeek: input.createdWeek,
  }
  ws.regiments[id] = regiment
  ws.nextRegimentId++
  addRegimentToIndexMut(ws, regiment)
  return regiment
}

// --- update ---

export function updateRegimentMut(
  ws: WorldState,
  regimentId: RegimentId,
  patch: Partial<Regiment>,
): void {
  const r = ws.regiments[regimentId]
  if (!r) return
  ws.regiments[regimentId] = { ...r, ...patch }
}

// --- mobilize / demobilize ---

export function mobilizeRegimentMut(
  ws: WorldState,
  regimentId: RegimentId,
  warId: WarId,
  side: WarSideKey,
  mobilizedByPolityId: PolityId,
  week: number,
): void {
  const r = ws.regiments[regimentId]
  if (!r) return
  ws.regiments[regimentId] = {
    ...r,
    currentWarId: warId,
    currentSide: side,
    mobilizedByPolityId,
    lastMobilizedWeek: week,
  }
  const arr = ws.regimentIndex.byWar[warId] ?? []
  if (!arr.some((x) => (x as string) === (regimentId as string))) {
    ws.regimentIndex.byWar[warId] = [...arr, regimentId]
  }
}

export function demobilizeRegimentMut(ws: WorldState, regimentId: RegimentId): void {
  const r = ws.regiments[regimentId]
  if (!r) return

  if (r.currentWarId !== undefined) {
    const ids = ws.regimentIndex.byWar[r.currentWarId]
    if (!ids) {
      /* nothing */
    } else {
      const filtered = ids.filter((id) => (id as string) !== (regimentId as string))
      if (filtered.length > 0) {
        ws.regimentIndex.byWar[r.currentWarId] = filtered
      } else {
        delete ws.regimentIndex.byWar[r.currentWarId]
      }
    }
  }

  const next: Regiment = { ...r }
  delete next.currentWarId
  delete next.currentSide
  delete next.mobilizedByPolityId
  ws.regiments[regimentId] = next
}

// --- owner reassign ---

export function reassignRegimentOwnerMut(
  ws: WorldState,
  regimentId: RegimentId,
  newOwner: PoliticalActorRef,
): void {
  const r = ws.regiments[regimentId]
  if (!r) return

  const oldOwnerKey = politicalActorKey(r.owner)
  const ids = ws.regimentIndex.byOwner[oldOwnerKey]
  if (!ids) {
    /* nothing */
  } else {
    const filtered = ids.filter((id) => (id as string) !== (regimentId as string))
    if (filtered.length > 0) {
      ws.regimentIndex.byOwner[oldOwnerKey] = filtered
    } else {
      delete ws.regimentIndex.byOwner[oldOwnerKey]
    }
  }

  ws.regiments[regimentId] = { ...r, owner: newOwner }

  const newOwnerKey = politicalActorKey(newOwner)
  ws.regimentIndex.byOwner[newOwnerKey] = [
    ...(ws.regimentIndex.byOwner[newOwnerKey] ?? []),
    regimentId,
  ]
}

// --- disband / destroy ---

export function disbandRegimentMut(ws: WorldState, regimentId: RegimentId): void {
  const r = ws.regiments[regimentId]
  if (!r) return

  if (r.currentWarId !== undefined) {
    const ids = ws.regimentIndex.byWar[r.currentWarId]
    if (!ids) {
      /* nothing */
    } else {
      const filtered = ids.filter((id) => (id as string) !== (regimentId as string))
      if (filtered.length > 0) {
        ws.regimentIndex.byWar[r.currentWarId] = filtered
      } else {
        delete ws.regimentIndex.byWar[r.currentWarId]
      }
    }
  }

  const next: Regiment = { ...r, status: 'disbanded' }
  delete next.currentWarId
  delete next.currentSide
  delete next.mobilizedByPolityId
  ws.regiments[regimentId] = next
}

export function destroyRegimentMut(ws: WorldState, regimentId: RegimentId): void {
  const r = ws.regiments[regimentId]
  if (!r) return

  if (r.currentWarId !== undefined) {
    const ids = ws.regimentIndex.byWar[r.currentWarId]
    if (!ids) {
      /* nothing */
    } else {
      const filtered = ids.filter((id) => (id as string) !== (regimentId as string))
      if (filtered.length > 0) {
        ws.regimentIndex.byWar[r.currentWarId] = filtered
      } else {
        delete ws.regimentIndex.byWar[r.currentWarId]
      }
    }
  }

  const next: Regiment = { ...r, status: 'destroyed' }
  delete next.currentWarId
  delete next.currentSide
  delete next.mobilizedByPolityId
  ws.regiments[regimentId] = next
}
