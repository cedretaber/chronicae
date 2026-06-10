import type { TickContext } from './context'
import { CHRONICLE_EVENT_TYPE_DEFINITIONS } from '../config/chronicleEventDefinitions'
import { createChronicleEntryMut } from '../mutations/chronicleMutations'

// v0.38 §4: end-of-tick projection。ctx.events のうち allowlist に載る EventType だけを
//   ChronicleEntry として materialize する。新たな SimEvent は emit しない (§4.3)。
//   ChronicleEntry は read-only な歴史記録であり simulation logic では使わない (§1.1)。
//
// perf (v0.47): chronicle は in-place append する (state を clone しない)。
//   かつては chronicleEntries 全体 + index 5 軸を spread コピーしていたが、append-only で
//   無限成長するアーカイブ (年100で ~89k entries / state の 87%) の全コピーが毎週走り、
//   歴史総量×時間の二次コストとして全体の ~20% を占めていた。
//   in-place が安全な根拠 (アーカイブ carve-out 契約):
//   - 書き込み点は createChronicleEntryMut 1 箇所、呼び出し元はこの system のみ
//   - entry は作成後不変・削除なし (chronicleMutations.ts の契約コメント参照)
//   - simulation logic は chronicle を一切読まない (§1.1)。読者は integrity 検査と UI のみ
//   - 過去 WorldState への参照保持箇所はなし (UI は最新 state のみ、CLI は逐次破棄)
//   UI の再描画は toResult (context.ts) が毎 tick top-level state を spread することに依存する。
export function runChronicleProjectionSystem(ctx: TickContext): TickContext {
  // 対象イベントが 1 件も無ければ完全 no-op。
  let hasTarget = false
  for (const e of ctx.events) {
    if (CHRONICLE_EVENT_TYPE_DEFINITIONS[e.type]) {
      hasTarget = true
      break
    }
  }
  if (!hasTarget) return ctx

  for (const e of ctx.events) {
    const def = CHRONICLE_EVENT_TYPE_DEFINITIONS[e.type]
    if (!def) continue
    // retainRefKinds 指定時は entityRefs をその kind だけに絞る (office を byPerson 限定にするため)。
    //   絞った結果が空でも entry は作る (どの index にも載らないが integrity 上は無害)。
    //   entry.entityRefs が絞り込み後と一致するので index↔entry の整合は保たれる。
    const retain = def.retainRefKinds
    const entityRefs = retain ? e.entityRefs.filter((r) => retain.includes(r.kind)) : e.entityRefs
    // templateKey: 関数なら params から narrative key を選び、string なら固定、未指定なら messageKey。
    const templateKey =
      typeof def.templateKey === 'function' ? def.templateKey(e) : (def.templateKey ?? e.messageKey)
    createChronicleEntryMut(ctx.state, {
      year: e.year,
      weekOfYear: e.weekOfYear,
      category: def.category,
      importance: e.importance,
      sourceEventId: e.id,
      sourceEventType: e.type,
      templateKey,
      params: e.messageParams,
      entityRefs,
    })
  }

  // in-place append のため state 差し替えなし。
  return ctx
}
