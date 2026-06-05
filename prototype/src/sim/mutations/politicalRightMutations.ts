// v0.42 PoliticalRight の mutation helper (spec v0.42 §6)。
//
// - index 3 系統 (byPolity / byHolder / byTarget) の同期は必ずこの層で閉じる
//   (shareMutations / officeMutations と同じ規約)。
// - hard-delete (§4.2.3)。
// - 失効の即時 cascade (person 死亡 / house 絶家 / polity inactive / regiment disband) は
//   removeRightsBy* を呼出側 mutation に組み込む。cascade は silent (イベントなし) —
//   markPersonDead の office revoke と同じ扱い。drift の安全網 + POLITICAL_RIGHT_REVOKED
//   発行は rightConsistencySystem 側 (§7)。

import type { WorldState } from '@sim/types/world'
import type { PoliticalRightId, PolityId } from '@sim/types/ids'
import type {
  PoliticalRight,
  PoliticalRightHolderRef,
  PoliticalRightTargetRef,
} from '@sim/types/politicalRight'
import { politicalRightTargetKey, politicalRightHolderKey } from '@sim/types/politicalRight'
import { getOfficeDefinition } from '@sim/config/officeDefinitions'
import { createPoliticalRightId } from '@sim/types/ids'
import { isLivingPerson } from '@sim/types/person'
import type { SimResult } from './result'
import { ok, err } from './result'

export type CreatePoliticalRightInput = {
  polityId: PolityId
  target: PoliticalRightTargetRef
  holder: PoliticalRightHolderRef
  grantedWeek: number
}

// 生成 (§6.1)。検査: polity active / holder 有効 / target 実在 + polityId 整合 /
// 1 target 1 active right (§4.2.2)。leader role は right の対象にしない (§9.1)。
export function createPoliticalRight(
  state: WorldState,
  input: CreatePoliticalRightInput,
): SimResult<{ state: WorldState; right: PoliticalRight }> {
  const polity = state.polities[input.polityId]
  if (!polity || !polity.active)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: 'createPoliticalRight: polity not found or inactive: ' + input.polityId,
    })

  if (input.holder.kind === 'person') {
    const person = state.persons[input.holder.id]
    if (!isLivingPerson(person))
      return err({
        code: 'PERSON_NOT_FOUND',
        message: 'createPoliticalRight: holder person not found or invalid: ' + input.holder.id,
      })
  } else {
    const house = state.houses[input.holder.id]
    if (!house || !house.active)
      return err({
        code: 'HOUSE_NOT_FOUND',
        message: 'createPoliticalRight: holder house not found or inactive: ' + input.holder.id,
      })
  }

  const targetError = validateTargetConsistency(state, input.polityId, input.target)
  if (targetError !== undefined)
    return err({ code: 'INVALID_RIGHT_TARGET', message: 'createPoliticalRight: ' + targetError })

  const targetKey = politicalRightTargetKey(input.target)
  const existing = state.politicalRightIndex.byTarget[targetKey] ?? []
  if (existing.length > 0)
    return err({
      code: 'RIGHT_ALREADY_EXISTS',
      message: 'createPoliticalRight: target already has an active right: ' + targetKey,
    })

  const id = createPoliticalRightId(state.nextPoliticalRightId)
  const right: PoliticalRight = {
    id,
    polityId: input.polityId,
    target: input.target,
    holder: input.holder,
    grantedWeek: input.grantedWeek,
  }

  const holderKey = politicalRightHolderKey(input.holder)
  const newState: WorldState = {
    ...state,
    nextPoliticalRightId: state.nextPoliticalRightId + 1,
    politicalRights: { ...state.politicalRights, [id]: right },
    politicalRightIndex: {
      byPolity: {
        ...state.politicalRightIndex.byPolity,
        [input.polityId]: [...(state.politicalRightIndex.byPolity[input.polityId] ?? []), id],
      },
      byHolder: {
        ...state.politicalRightIndex.byHolder,
        [holderKey]: [...(state.politicalRightIndex.byHolder[holderKey] ?? []), id],
      },
      byTarget: {
        ...state.politicalRightIndex.byTarget,
        [targetKey]: [...existing, id],
      },
    },
  }
  return ok({ state: newState, right })
}

// target の実在と polityId の整合 (§6.1 / R3 / R4)。不整合ならメッセージを返す。
function validateTargetConsistency(
  state: WorldState,
  polityId: PolityId,
  target: PoliticalRightTargetRef,
): string | undefined {
  switch (target.kind) {
    case 'polity_office_role': {
      if (target.polityId !== polityId)
        return `target polity mismatch: ${target.polityId} !== ${polityId}`
      // leader の地位は succession / polityOwnerConsistency が管理する (§9.1)
      if (target.role === 'leader') return 'leader role cannot be a right target'
      // slot 単位 (v0.42 slot 化): 静的 maxHolders を上限とする (動的 effectiveMax の縮小は
      // rightConsistencySystem が毎週回収する。生成時点では静的上限のみ課す)。
      const def = getOfficeDefinition('polity', target.role)
      const staticMax = def ? def.maxHolders : 1
      if (!Number.isInteger(target.slotIndex) || target.slotIndex < 0)
        return `invalid slotIndex: ${target.slotIndex}`
      if (target.slotIndex >= staticMax)
        return `slotIndex ${target.slotIndex} >= static maxHolders ${staticMax} for role ${target.role}`
      return undefined
    }
    case 'holding_office_role': {
      const holding = state.holdings[target.holdingId]
      if (!holding) return 'holding not found: ' + target.holdingId
      const terminal = state.holdingTerminalPolityCache[target.holdingId]
      if (terminal !== polityId)
        return `holding terminal polity mismatch: ${String(terminal)} !== ${polityId}`
      return undefined
    }
    case 'regiment': {
      const regiment = state.regiments[target.regimentId]
      if (!regiment) return 'regiment not found: ' + target.regimentId
      // destroyed は許容 (制度的単位として存続 — §11)。disbanded のみ拒否。
      if (regiment.status === 'disbanded') return 'regiment is disbanded: ' + target.regimentId
      if (regiment.owner.kind !== 'polity' || regiment.owner.id !== polityId)
        return `regiment owner mismatch: ${regiment.owner.kind}:${regiment.owner.id} !== polity:${polityId}`
      return undefined
    }
  }
}

// hard-delete + index 3 系統更新 (§6.2)。空になった index entry は purge する
// (taskIndex の空エントリ purge と同方針)。
export function removePoliticalRight(state: WorldState, rightId: PoliticalRightId): WorldState {
  const right = state.politicalRights[rightId]
  if (!right) return state

  const targetKey = politicalRightTargetKey(right.target)
  const holderKey = politicalRightHolderKey(right.holder)

  const newRights = { ...state.politicalRights }
  delete newRights[rightId]

  const byPolity = { ...state.politicalRightIndex.byPolity }
  const polEntry = (byPolity[right.polityId] ?? []).filter((id) => id !== rightId)
  if (polEntry.length > 0) byPolity[right.polityId] = polEntry
  else delete byPolity[right.polityId]

  const byHolder = { ...state.politicalRightIndex.byHolder }
  const holderEntry = (byHolder[holderKey] ?? []).filter((id) => id !== rightId)
  if (holderEntry.length > 0) byHolder[holderKey] = holderEntry
  else delete byHolder[holderKey]

  const byTarget = { ...state.politicalRightIndex.byTarget }
  const targetEntry = (byTarget[targetKey] ?? []).filter((id) => id !== rightId)
  if (targetEntry.length > 0) byTarget[targetKey] = targetEntry
  else delete byTarget[targetKey]

  return {
    ...state,
    politicalRights: newRights,
    politicalRightIndex: { byPolity, byHolder, byTarget },
  }
}

// person 死亡 / house 絶家の即時 cascade 用 (§6.4)。
export function removeRightsByHolder(
  state: WorldState,
  holder: PoliticalRightHolderRef,
): WorldState {
  const key = politicalRightHolderKey(holder)
  const ids = [...(state.politicalRightIndex.byHolder[key] ?? [])]
  let current = state
  for (const id of ids) {
    current = removePoliticalRight(current, id)
  }
  return current
}

// polity inactive の即時 cascade 用 (§6.4)。
export function removeRightsByPolity(state: WorldState, polityId: PolityId): WorldState {
  const ids = [...(state.politicalRightIndex.byPolity[polityId] ?? [])]
  let current = state
  for (const id of ids) {
    current = removePoliticalRight(current, id)
  }
  return current
}

// regiment disband 等の target 消滅 cascade 用 (§6.4)。
export function removeRightsByTarget(
  state: WorldState,
  target: PoliticalRightTargetRef,
): WorldState {
  const key = politicalRightTargetKey(target)
  const ids = [...(state.politicalRightIndex.byTarget[key] ?? [])]
  let current = state
  for (const id of ids) {
    current = removePoliticalRight(current, id)
  }
  return current
}

// removeRightsByTarget の mutable draft 版。disbandRegimentMut など mut 系 mutation から呼ぶ。
// immutable helper で新しい maps を作り draft に書き戻すため、元 state の maps は変異しない。
export function removeRightsByTargetMut(ws: WorldState, target: PoliticalRightTargetRef): void {
  const key = politicalRightTargetKey(target)
  const ids = ws.politicalRightIndex.byTarget[key] ?? []
  if (ids.length === 0) return
  let s: WorldState = ws
  for (const id of [...ids]) {
    s = removePoliticalRight(s, id)
  }
  ws.politicalRights = s.politicalRights
  ws.politicalRightIndex = s.politicalRightIndex
}

// holder の付替 (§6.3)。将来の PeaceSettlement / regime change 用。ID は維持する。
export function transferPoliticalRight(
  state: WorldState,
  rightId: PoliticalRightId,
  newHolder: PoliticalRightHolderRef,
): SimResult<{ state: WorldState; right: PoliticalRight }> {
  const right = state.politicalRights[rightId]
  if (!right)
    return err({
      code: 'RIGHT_NOT_FOUND',
      message: 'transferPoliticalRight: right not found: ' + rightId,
    })

  if (newHolder.kind === 'person') {
    const person = state.persons[newHolder.id]
    if (!isLivingPerson(person))
      return err({
        code: 'PERSON_NOT_FOUND',
        message: 'transferPoliticalRight: new holder person not found or invalid: ' + newHolder.id,
      })
  } else {
    const house = state.houses[newHolder.id]
    if (!house || !house.active)
      return err({
        code: 'HOUSE_NOT_FOUND',
        message: 'transferPoliticalRight: new holder house not found or inactive: ' + newHolder.id,
      })
  }

  const oldHolderKey = politicalRightHolderKey(right.holder)
  const newHolderKey = politicalRightHolderKey(newHolder)
  const updated: PoliticalRight = { ...right, holder: newHolder }

  if (oldHolderKey === newHolderKey) {
    return ok({
      state: { ...state, politicalRights: { ...state.politicalRights, [rightId]: updated } },
      right: updated,
    })
  }

  const byHolder = { ...state.politicalRightIndex.byHolder }
  const oldEntry = (byHolder[oldHolderKey] ?? []).filter((id) => id !== rightId)
  if (oldEntry.length > 0) byHolder[oldHolderKey] = oldEntry
  else delete byHolder[oldHolderKey]
  byHolder[newHolderKey] = [...(byHolder[newHolderKey] ?? []), rightId]

  return ok({
    state: {
      ...state,
      politicalRights: { ...state.politicalRights, [rightId]: updated },
      politicalRightIndex: { ...state.politicalRightIndex, byHolder },
    },
    right: updated,
  })
}
