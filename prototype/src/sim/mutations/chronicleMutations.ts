import type { WorldState } from '../types/world'
import type { ChronicleEntry, CreateChronicleEntryInput, ChronicleIndex } from '../types/chronicle'
import type { EventEntityRef } from '../types/event'
import { createChronicleEntryId } from '../types/ids'

// 同一 entry に同じ (kind,id) が複数回現れても index に重複登録しないため、(kind,id) で一意化する。
function dedupeByKindAndId(refs: EventEntityRef[]): EventEntityRef[] {
  const seen = new Set<string>()
  const result: EventEntityRef[] = []
  for (const ref of refs) {
    const key = ref.kind + ':' + ref.id
    if (seen.has(key)) continue
    seen.add(key)
    result.push(ref)
  }
  return result
}

// index 対象は person/house/polity/province/holding の 5 kind のみ (§5.2)。他 kind は entry に保持されるが index には振らない。
function indexBucketForKind(
  index: ChronicleIndex,
  kind: EventEntityRef['kind'],
): Record<string, import('../types/ids').ChronicleEntryId[]> | undefined {
  switch (kind) {
    case 'person':
      return index.byPerson
    case 'house':
      return index.byHouse
    case 'polity':
      return index.byPolity
    case 'province':
      return index.byProvince
    case 'holding':
      return index.byHolding
    default:
      return undefined
  }
}

// append-only。remove 系は実装しない (v0.38 方針)。
// perf (v0.47): in-place push。chronicle index の id 配列は append-only かつ書き込み点が
//   ここ 1 箇所のため、配列再生成 ([...arr, id]) は不要 (entry 蓄積で O(配列長) に劣化する)。
function addChronicleToIndexMut(ws: WorldState, entry: ChronicleEntry): void {
  const uniqueRefs = dedupeByKindAndId(entry.entityRefs)
  for (const ref of uniqueRefs) {
    const bucket = indexBucketForKind(ws.chronicleIndex, ref.kind)
    if (!bucket) continue
    const arr = bucket[ref.id]
    if (arr) arr.push(entry.id)
    else bucket[ref.id] = [entry.id]
  }
}

// 【chronicle アーカイブ carve-out 契約 (v0.47 perf)】
// chronicleEntries / chronicleIndex は copy-on-write の対象外で、tick 中に in-place append される
// (chronicleProjectionSystem が ws として ctx.state を直接渡す)。これが成立する条件:
//   1. 書き込み点はこの関数 1 箇所のみ (呼び出し元は chronicleProjectionSystem のみ)
//   2. entry は作成後に変更・削除しない (append-only)。削除/改変 system を将来追加する場合は
//      この carve-out を廃止して copy-on-write に戻すこと
//   3. simulation logic は chronicle を読まない (§1.1)
// UI の chronicle 再描画は toResult (tick/context.ts) の top-level state spread に依存している。
export function createChronicleEntryMut(
  ws: WorldState,
  input: CreateChronicleEntryInput,
): ChronicleEntry {
  const id = createChronicleEntryId(ws.nextChronicleEntryId)
  ws.nextChronicleEntryId++

  const entry: ChronicleEntry = {
    id,
    year: input.year,
    weekOfYear: input.weekOfYear,
    category: input.category,
    importance: input.importance,
    sourceEventId: input.sourceEventId,
    sourceEventType: input.sourceEventType,
    templateKey: input.templateKey,
    params: input.params,
    entityRefs: input.entityRefs,
    ...(input.context !== undefined && { context: input.context }),
  }

  ws.chronicleEntries[id] = entry
  addChronicleToIndexMut(ws, entry)
  return entry
}
