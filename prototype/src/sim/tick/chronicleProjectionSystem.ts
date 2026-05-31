import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import { CHRONICLE_EVENT_CATEGORIES } from '../config/chronicleEventDefinitions'
import { createChronicleEntryMut } from '../mutations/chronicleMutations'

// v0.38 §4: end-of-tick projection。ctx.events のうち allowlist に載る EventType だけを
//   ChronicleEntry として materialize する。新たな SimEvent は emit しない (§4.3)。
//   ChronicleEntry は read-only な歴史記録であり simulation logic では使わない (§1.1)。
export function runChronicleProjectionSystem(ctx: TickContext): TickContext {
  // 対象イベントが 1 件も無ければ state を clone せず no-op で返す。
  let hasTarget = false
  for (const e of ctx.events) {
    if (CHRONICLE_EVENT_CATEGORIES[e.type]) {
      hasTarget = true
      break
    }
  }
  if (!hasTarget) return ctx

  // mutable-draft: chronicleEntries と chronicleIndex の各 sub-record を spread で浅くコピーする。
  //   chronicleIndex は 5 つの byX を個別に spread しないと、createChronicleEntryMut が
  //   入力 state の index object を破壊してしまう (flushTerminalEntities の projectIndex copy と同型)。
  const draft: WorldState = {
    ...ctx.state,
    chronicleEntries: { ...ctx.state.chronicleEntries },
    chronicleIndex: {
      byPerson: { ...ctx.state.chronicleIndex.byPerson },
      byHouse: { ...ctx.state.chronicleIndex.byHouse },
      byPolity: { ...ctx.state.chronicleIndex.byPolity },
      byProvince: { ...ctx.state.chronicleIndex.byProvince },
      byHolding: { ...ctx.state.chronicleIndex.byHolding },
    },
  }

  for (const e of ctx.events) {
    const category = CHRONICLE_EVENT_CATEGORIES[e.type]
    if (!category) continue
    createChronicleEntryMut(draft, {
      year: e.year,
      weekOfYear: e.weekOfYear,
      category,
      importance: e.importance,
      sourceEventId: e.id,
      sourceEventType: e.type,
      templateKey: e.messageKey,
      params: e.messageParams,
      entityRefs: e.entityRefs,
    })
  }

  return { ...ctx, state: draft }
}
