import type { TickContext } from './context'
import type { PersonActivityLog } from '../types/task'
import type { PersonId } from '../types/ids'

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

  const collected = collectDeadPersonLogs(ctx)
  if (collected.length === 0) return ctx

  const nextLogs = { ...ctx.state.personActivityLogs }
  const nextByPerson = { ...ctx.state.personActivityLogIndex.byPerson }

  for (const { personId, logs } of collected) {
    for (const log of logs) {
      delete nextLogs[log.id]
    }
    delete nextByPerson[personId as string]
  }

  return {
    ...ctx,
    state: {
      ...ctx.state,
      personActivityLogs: nextLogs,
      personActivityLogIndex: {
        ...ctx.state.personActivityLogIndex,
        byPerson: nextByPerson,
      },
    },
  }
}
