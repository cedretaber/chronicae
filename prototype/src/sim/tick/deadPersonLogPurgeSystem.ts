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
    const logs: PersonActivityLog[] = []
    for (const logId of logIds) {
      const log = ctx.state.personActivityLogs[logId]
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
    const nextLogs = { ...state.personActivityLogs }
    const nextByPerson = { ...state.personActivityLogIndex.byPerson }

    for (const { personId, logs } of collected) {
      for (const log of logs) {
        delete nextLogs[log.id]
      }
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
