// v0.36: Regiment entity の生成・index 管理・mutation helper。warMutations の add/remove + 空配列 delete purge に倣う。

import type { WorldState } from '../types/world'
import type { Regiment, RegimentSourceKind, RegimentTroopKind } from '../types/regiment'
import type { RegimentId, PolityId, HoldingId, ProvinceId, WarId } from '../types/ids'
import type { OrganizationRef } from '../types/office'
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
  owner: OrganizationRef
  sourceKind: RegimentSourceKind
  troopKind: RegimentTroopKind
  homeHoldingId?: HoldingId
  homeProvinceId?: ProvinceId
  strength: number
  organization: number
  morale: number
  maxStrength: number
  basePower: number
  // §3 (v0.37): baseline / max。createRegiment caller が必ず設定する (§20 Phase A)。
  baselineOrganization: number
  maxOrganization: number
  baselineMorale: number
  maxMorale: number
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
    baselineOrganization: input.baselineOrganization,
    maxOrganization: input.maxOrganization,
    baselineMorale: input.baselineMorale,
    maxMorale: input.maxMorale,
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

// v0.36 §9.1-9.3: 当該 War / side の各 polity participant が owner である active かつ未動員
//   (currentWarId === undefined) の Regiment を、この War / side に mobilize する composite helper。
//   WarManeuverSystem の per-war prologue から呼ぶ。idempotent (既動員はスキップ)。rng は消費しない。
//   house participant は worldgen で Regiment 非生成のため skip (power は §10.4(a) の旧 power fallback に委ねる)。
export function mobilizeRegimentsForWar(
  ws: WorldState,
  warId: WarId,
  side: WarSideKey,
  week: number,
): void {
  const war = ws.wars[warId]
  if (!war) return
  const sideObj = side === 'attacker' ? war.attacker : war.defender
  for (const p of sideObj.participants) {
    if (p.actor.kind !== 'polity') continue
    const polityId = p.actor.id
    const ids = ws.regimentIndex.byOwner[politicalActorKey(p.actor)] ?? []
    for (const rid of ids) {
      const r = ws.regiments[rid]
      if (!r || r.status !== 'active' || r.currentWarId !== undefined) continue
      mobilizeRegimentMut(ws, rid, warId, side, polityId, week)
    }
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
  newOwner: OrganizationRef,
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

export function destroyRegimentMut(ws: WorldState, regimentId: RegimentId, week: number): void {
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

  // v0.36 補充・再編成: destroyedWeek を記録し RegimentReinforcementSystem の reform 遅延判定に使う。
  const next: Regiment = { ...r, status: 'destroyed', destroyedWeek: week }
  delete next.currentWarId
  delete next.currentSide
  delete next.mobilizedByPolityId
  ws.regiments[regimentId] = next
}

// v0.36 補充・再編成: destroyed Regiment を active に戻す。本拠地・owner が健在で reform 遅延を
//   満たした場合に RegimentReinforcementSystem から呼ぶ。byOwner/byHomeHolding には destroy 後も
//   残っているため index 操作は不要 (byWar には居ない)。strength/organization/morale を初期値に
//   リセットし、destroyedWeek を消去して lastReinforcedWeek を更新する。
export function reformRegimentMut(
  ws: WorldState,
  regimentId: RegimentId,
  values: { strength: number; organization: number; morale: number },
  week: number,
): void {
  const r = ws.regiments[regimentId]
  if (!r) return
  if (r.status !== 'destroyed') return

  const next: Regiment = {
    ...r,
    status: 'active',
    strength: values.strength,
    organization: values.organization,
    morale: values.morale,
    lastReinforcedWeek: week,
  }
  delete next.destroyedWeek
  ws.regiments[regimentId] = next
}
