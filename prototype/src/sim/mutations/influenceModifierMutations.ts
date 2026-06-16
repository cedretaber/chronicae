// v0.51 InfluenceModifier の mutation helper (陰謀リファイン §2.2)。
//
// - index 2 系統 (byPolity / byTarget) の同期は必ずこの層で閉じる
//   (politicalRightMutations と同じ規約)。
// - hard-delete。active=false 残置はしない。
// - 期限切れ・target 消滅・polity inactive の回収は influenceModifierConsistencySystem 側。
// - Result 版 (add) と mutable draft 版 (...Mut) の二系統を用意する。

import type { WorldState } from '@sim/types/world'
import type { InfluenceModifierId } from '@sim/types/ids'
import type {
  InfluenceModifier,
  InfluenceModifierCauseKind,
  InfluenceModifierTargetRef,
} from '@sim/types/influenceModifier'
import { influenceModifierTargetKey } from '@sim/types/influenceModifier'
import { createInfluenceModifierId } from '@sim/types/ids'
import type { PolityId, PersonId } from '@sim/types/ids'
import type { SimResult } from './result'
import { ok, err } from './result'

export type AddInfluenceModifierInput = {
  polityId: PolityId
  target: InfluenceModifierTargetRef
  delta: number
  causeKind: InfluenceModifierCauseKind
  sourcePersonId?: PersonId
  grantedWeek: number
  expiryWeek?: number
}

// 生成。検査: polity active / target 実在。
export function addInfluenceModifier(
  state: WorldState,
  input: AddInfluenceModifierInput,
): SimResult<{ state: WorldState; modifier: InfluenceModifier }> {
  const polity = state.polities[input.polityId]
  if (!polity || !polity.active)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: 'addInfluenceModifier: polity not found or inactive: ' + input.polityId,
    })

  if (input.target.kind === 'person') {
    const person = state.persons[input.target.id]
    if (!person || !person.alive || person.kind === 'placeholder')
      return err({
        code: 'PERSON_NOT_FOUND',
        message: 'addInfluenceModifier: target person not found or invalid: ' + input.target.id,
      })
  } else {
    const house = state.houses[input.target.id]
    if (!house || !house.active)
      return err({
        code: 'HOUSE_NOT_FOUND',
        message: 'addInfluenceModifier: target house not found or inactive: ' + input.target.id,
      })
  }

  const id = createInfluenceModifierId(state.nextInfluenceModifierId)
  const modifier: InfluenceModifier = {
    id,
    polityId: input.polityId,
    target: input.target,
    delta: input.delta,
    causeKind: input.causeKind,
    ...(input.sourcePersonId !== undefined ? { sourcePersonId: input.sourcePersonId } : {}),
    grantedWeek: input.grantedWeek,
    ...(input.expiryWeek !== undefined ? { expiryWeek: input.expiryWeek } : {}),
  }

  const targetKey = influenceModifierTargetKey(input.target)
  const newState: WorldState = {
    ...state,
    nextInfluenceModifierId: state.nextInfluenceModifierId + 1,
    influenceModifiers: { ...state.influenceModifiers, [id]: modifier },
    influenceModifierIndex: {
      byPolity: {
        ...state.influenceModifierIndex.byPolity,
        [input.polityId]: [...(state.influenceModifierIndex.byPolity[input.polityId] ?? []), id],
      },
      byTarget: {
        ...state.influenceModifierIndex.byTarget,
        [targetKey]: [...(state.influenceModifierIndex.byTarget[targetKey] ?? []), id],
      },
    },
  }
  return ok({ state: newState, modifier })
}

// hard-delete + index 2 系統更新。空になった index entry は purge する。
export function removeInfluenceModifier(state: WorldState, id: InfluenceModifierId): WorldState {
  const modifier = state.influenceModifiers[id]
  if (!modifier) return state

  const targetKey = influenceModifierTargetKey(modifier.target)

  const newModifiers = { ...state.influenceModifiers }
  delete newModifiers[id]

  const byPolity = { ...state.influenceModifierIndex.byPolity }
  const polEntry = (byPolity[modifier.polityId] ?? []).filter((x) => x !== id)
  if (polEntry.length > 0) byPolity[modifier.polityId] = polEntry
  else delete byPolity[modifier.polityId]

  const byTarget = { ...state.influenceModifierIndex.byTarget }
  const targetEntry = (byTarget[targetKey] ?? []).filter((x) => x !== id)
  if (targetEntry.length > 0) byTarget[targetKey] = targetEntry
  else delete byTarget[targetKey]

  return {
    ...state,
    influenceModifiers: newModifiers,
    influenceModifierIndex: { byPolity, byTarget },
  }
}

// removeInfluenceModifier の mutable draft 版。consistency system の一括 sweep 用。
// immutable helper で新しい maps を作り draft に書き戻すため、元 state の maps は変異しない。
export function removeInfluenceModifierMut(ws: WorldState, id: InfluenceModifierId): void {
  if (!ws.influenceModifiers[id]) return
  const next = removeInfluenceModifier(ws, id)
  ws.influenceModifiers = next.influenceModifiers
  ws.influenceModifierIndex = next.influenceModifierIndex
}
