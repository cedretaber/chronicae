import type { WorldState } from '../types/world'
import type { ChronicleEntry, CreateChronicleEntryInput, ChronicleIndex } from '../types/chronicle'
import type { EventEntityRef } from '../types/event'
import { createChronicleEntryId } from '../types/ids'

// 同一 entry に同じ (kind,id) が複数回現れても index に重複登録しないため、(kind,id) で一意化する。
export function dedupeByKindAndId(refs: EventEntityRef[]): EventEntityRef[] {
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
export function addChronicleToIndexMut(ws: WorldState, entry: ChronicleEntry): void {
  const uniqueRefs = dedupeByKindAndId(entry.entityRefs)
  for (const ref of uniqueRefs) {
    const bucket = indexBucketForKind(ws.chronicleIndex, ref.kind)
    if (!bucket) continue
    bucket[ref.id] = [...(bucket[ref.id] ?? []), entry.id]
  }
}

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
