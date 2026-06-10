import type { TickContext } from './context'
import type { PersonActivityLog } from '../types/task'
import type { PersonId } from '../types/ids'
import { removePersonReputationsByPersonMut } from '../mutations/personReputationMutations'

export type PurgedPersonLogs = {
  personId: PersonId
  logs: PersonActivityLog[]
}

export function collectDeadPersonLogs(ctx: TickContext): PurgedPersonLogs[] {
  const collected: PurgedPersonLogs[] = []
  for (const personId of ctx.deathsThisTick) {
    const logIds = ctx.state.personActivityLogIndex.byPerson[personId as string]
    if (!logIds || logIds.length === 0) continue
    const bucket = ctx.state.personActivityLogs[personId as string]
    const logs: PersonActivityLog[] = []
    for (const logId of logIds) {
      const log = bucket?.[logId]
      if (log) logs.push(log)
    }
    if (logs.length > 0) {
      collected.push({ personId, logs })
    }
  }
  return collected
}

export function runDeadPersonLogPurgeSystem(ctx: TickContext): TickContext {
  if (ctx.deathsThisTick.length === 0) return ctx

  let state = ctx.state

  const collected = collectDeadPersonLogs(ctx)
  if (collected.length > 0) {
    // perf (v0.47): PAL 2 層構造。死亡者の purge は当人キーの delete 1 発で済む
    //   (かつては flat map 全体 ~6,800 件を spread してから数件 delete していた)。
    const nextLogs = { ...state.personActivityLogs }
    const nextByPerson = { ...state.personActivityLogIndex.byPerson }

    for (const { personId } of collected) {
      delete nextLogs[personId as string]
      delete nextByPerson[personId as string]
    }

    state = {
      ...state,
      personActivityLogs: nextLogs,
      personActivityLogIndex: {
        ...state.personActivityLogIndex,
        byPerson: nextByPerson,
      },
    }
  }

  // v0.44 §4.5: 死亡者の PersonReputation を piggyback で purge する
  // (purge system より後に死亡した人物は personReputationCleanupSystem が回収する)。
  {
    const ws = { ...state }
    let removedAny = false
    for (const personId of ctx.deathsThisTick) {
      if ((ws.personReputationIndex.byPerson[personId] ?? []).length > 0) {
        removePersonReputationsByPersonMut(ws, personId)
        removedAny = true
      }
    }
    if (removedAny) state = ws
  }

  if (state === ctx.state) return ctx
  return { ...ctx, state }
}
