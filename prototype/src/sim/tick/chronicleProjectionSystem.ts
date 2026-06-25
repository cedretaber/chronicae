import type { TickContext } from './context'
import { CHRONICLE_EVENT_TYPE_DEFINITIONS } from '../config/chronicleEventDefinitions'
import type { ChronicleEntry } from '../types/chronicle'
import { createChronicleEntryId } from '../types/ids'

// v0.62: chronicle は WorldState から外部ストレージへ移動。Writer が注入されていれば、
//   ctx.events のうち allowlist に載る EventType を ChronicleEntry に変換して Writer に渡す。
//   Writer が無い場合 (テスト等) は何もしない。RNG 非消費の純粋 projection。
let nextEntryIndex = 0

export function resetChronicleEntryIndex(): void {
  nextEntryIndex = 0
}

export function runChronicleProjectionSystem(ctx: TickContext): TickContext {
  const writer = ctx.chronicleWriter
  if (!writer) return ctx

  const entries: ChronicleEntry[] = []
  for (const e of ctx.events) {
    const def = CHRONICLE_EVENT_TYPE_DEFINITIONS[e.type]
    if (!def) continue
    const retain = def.retainRefKinds
    const entityRefs = retain ? e.entityRefs.filter((r) => retain.includes(r.kind)) : e.entityRefs
    const templateKey =
      typeof def.templateKey === 'function' ? def.templateKey(e) : (def.templateKey ?? e.messageKey)

    const id = createChronicleEntryId(nextEntryIndex++)
    const entry: ChronicleEntry = {
      id,
      year: e.year,
      weekOfYear: e.weekOfYear,
      category: def.category,
      importance: e.importance,
      sourceEventId: e.id,
      sourceEventType: e.type,
      templateKey,
      params: e.messageParams,
      entityRefs,
    }
    entries.push(entry)
  }

  if (entries.length > 0) {
    writer.append(entries)
  }

  return ctx
}
