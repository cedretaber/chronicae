import type { WorldState } from '../types/world'
import type { ChronicleEntry } from '../types/chronicle'
import type {
  ChronicleEntryId,
  PersonId,
  HouseId,
  PolityId,
  ProvinceId,
  HoldingId,
  WarId,
} from '../types/ids'

// id 配列を ChronicleEntry に解決し、存在しない id を除外し、時系列降順 (新しい順) に並べる。
//   noUncheckedIndexedAccess 下なので ?? [] と undefined filter を必ず通す。
function resolveChronicleEntries(
  state: WorldState,
  ids: ChronicleEntryId[] | undefined,
): ChronicleEntry[] {
  return (ids ?? [])
    .map((id) => state.chronicleEntries[id])
    .filter((entry): entry is ChronicleEntry => entry !== undefined)
    .sort((a, b) => b.year - a.year || b.weekOfYear - a.weekOfYear)
}

export function getChronicleEntriesForPerson(
  state: WorldState,
  personId: PersonId,
): ChronicleEntry[] {
  return resolveChronicleEntries(state, state.chronicleIndex.byPerson[personId])
}

export function getChronicleEntriesForHouse(state: WorldState, houseId: HouseId): ChronicleEntry[] {
  return resolveChronicleEntries(state, state.chronicleIndex.byHouse[houseId])
}

export function getChronicleEntriesForPolity(
  state: WorldState,
  polityId: PolityId,
): ChronicleEntry[] {
  return resolveChronicleEntries(state, state.chronicleIndex.byPolity[polityId])
}

export function getChronicleEntriesForProvince(
  state: WorldState,
  provinceId: ProvinceId,
): ChronicleEntry[] {
  return resolveChronicleEntries(state, state.chronicleIndex.byProvince[provinceId])
}

export function getChronicleEntriesForHolding(
  state: WorldState,
  holdingId: HoldingId,
): ChronicleEntry[] {
  return resolveChronicleEntries(state, state.chronicleIndex.byHolding[holdingId])
}

// War は EventEntityKind に 'war' が無く byWar index も持たない (v0.38 スコープ外) ため、
//   WarDetail.recentWarEvents と同じく params.warId 一致で chronicleEntries を全走査する。
//   表示専用 selector であり tick には配線しない。append-only でも detail panel render
//   1 回の走査コストは許容範囲。
export function getChronicleEntriesForWar(state: WorldState, warId: WarId): ChronicleEntry[] {
  const target = warId as string
  return Object.values(state.chronicleEntries)
    .filter((entry) => {
      const wid = entry.params.warId
      return typeof wid === 'string' && wid === target
    })
    .sort((a, b) => b.year - a.year || b.weekOfYear - a.weekOfYear)
}
