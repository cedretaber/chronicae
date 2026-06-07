// v0.44 §4.5: PersonReputation の定期 cleanup (48 週ごと)。
//
// 削除条件は以下のみ:
//   1. absoluteWeek >= expiryWeek (作成時に事前計算済み)
//   2. 本人が死亡済み (死亡 tick の purge は deadPersonLogPurgeSystem に piggyback 済みだが、
//      purge system より後の tick 順で死亡した人物 — 処刑 cascade 等 — の取りこぼしを回収する)
//
// index 不整合はここで黙って修復しない (IntegrityCheck §12.1 の検出対象)。

import type { TickContext } from './context'
import type { PersonReputationId } from '../types/ids'
import { removePersonReputationMut } from '../mutations/personReputationMutations'
import { isLivingPerson } from '../types/person'

export function runPersonReputationCleanupSystem(ctx: TickContext): TickContext {
  const state = ctx.state
  const absoluteWeek = state.absoluteWeek

  const expiredIds: PersonReputationId[] = []
  for (const idStr of Object.keys(state.personReputations).sort()) {
    const reputation = state.personReputations[idStr as PersonReputationId]
    if (!reputation) continue
    if (
      absoluteWeek >= reputation.expiryWeek ||
      !isLivingPerson(state.persons[reputation.personId])
    ) {
      expiredIds.push(idStr as PersonReputationId)
    }
  }
  if (expiredIds.length === 0) return ctx

  const ws = { ...state }
  for (const id of expiredIds) {
    removePersonReputationMut(ws, id)
  }
  return { ...ctx, state: ws }
}
