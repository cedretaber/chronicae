import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import type { SimulationConfig } from '../config/defaultConfig'
import type {
  SimEvent,
  EventType,
  EventImportance,
  EventMessageParams,
  EventEntityRef,
  EventReason,
  EventEffect,
} from '../types/event'
import type { EventId, PersonId, HouseId, PolityId } from '../types/ids'

export type TickInput = {
  state: WorldState
  rng: RngState
  config: SimulationConfig
  namePoolService?: import('../namegen/namePoolTypes').NamePoolService
}

export type TickResult = {
  state: WorldState
  rng: RngState
  events: SimEvent[]
  systemTimings?: Record<string, number>
}

export type DeathRoleInfo = {
  readonly wasHouseLeader: boolean
  readonly wasPolityLeader: boolean
}

export type TickContext = {
  readonly state: WorldState
  readonly rng: RngState
  readonly config: SimulationConfig
  readonly namePoolService?: import('../namegen/namePoolTypes').NamePoolService
  readonly events: readonly SimEvent[]
  readonly nextEventIndex: number
  readonly nextPersonIndex: number
  readonly nextHouseIndex: number
  readonly nextPolityIndex: number
  readonly deathsThisTick: readonly PersonId[]
  readonly deathRolesThisTick: Readonly<Record<string, DeathRoleInfo>>
}

// 調査 §4.5: person/house/polity の next index は WorldState に永続化する (毎 tick の O(n) スキャン
// 廃止)。worldgen 初期化専用にスキャン版を残す。person は runtime/worldgen とも `pe-` prefix を共有
// するため最大 index+1、house/polity は worldgen が `h-`/`c-` を使い runtime が `dh-`/`dp-` を生成する
// (別名前空間) ため、`dh-`/`dp-` のみを対象にすると worldgen 直後は -1+1=0 になる。
// .sort() は max 計算に不要なので省く (結果は同一)。
export function computeInitialIdIndices(state: {
  persons: WorldState['persons']
  houses: WorldState['houses']
  polities: WorldState['polities']
}): { nextPersonIndex: number; nextHouseIndex: number; nextPolityIndex: number } {
  let maxPersonIndex = -1
  for (const personId of Object.keys(state.persons)) {
    const n = parseInt(personId.slice(3), 10)
    if (!isNaN(n) && n > maxPersonIndex) maxPersonIndex = n
  }
  let maxHouseIndex = -1
  for (const houseId of Object.keys(state.houses)) {
    if (!houseId.startsWith('dh-')) continue
    const n = parseInt(houseId.slice(3), 10)
    if (!isNaN(n) && n > maxHouseIndex) maxHouseIndex = n
  }
  let maxPolityIndex = -1
  for (const polityId of Object.keys(state.polities)) {
    if (!polityId.startsWith('dp-')) continue
    const n = parseInt(polityId.slice(3), 10)
    if (!isNaN(n) && n > maxPolityIndex) maxPolityIndex = n
  }
  return {
    nextPersonIndex: maxPersonIndex + 1,
    nextHouseIndex: maxHouseIndex + 1,
    nextPolityIndex: maxPolityIndex + 1,
  }
}

export function createTickContext(input: TickInput): TickContext {
  // 永続値が無い WorldState (テスト fixture 等) は従来の scan に fallback (挙動保存)。
  // production (worldgen) は 3 値とも常にセットするため scan は走らない (perf)。
  const s = input.state
  const fallback =
    s.nextPersonIndex === undefined ||
    s.nextHouseIndex === undefined ||
    s.nextPolityIndex === undefined
      ? computeInitialIdIndices(s)
      : undefined
  return {
    state: input.state,
    rng: input.rng,
    config: input.config,
    namePoolService: input.namePoolService,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: s.nextPersonIndex ?? fallback!.nextPersonIndex,
    nextHouseIndex: s.nextHouseIndex ?? fallback!.nextHouseIndex,
    nextPolityIndex: s.nextPolityIndex ?? fallback!.nextPolityIndex,
    deathsThisTick: [],
    deathRolesThisTick: {},
  } as TickContext
}

export function toResult(ctx: TickContext): TickResult {
  // 調査 §4.5: tick 中に makePersonId/makeHouseId/makePolityId が進めた ctx 側カウンタを
  // WorldState へ書き戻す (次 tick の createTickContext が読む正本)。
  //
  // 【注意 (v0.47 perf)】この top-level spread は省略不可。chronicleEntries / chronicleIndex は
  // in-place append される (chronicleMutations.ts の carve-out 契約) ため identity が変わらず、
  // UI の chronicle 再描画はここで state 全体の identity が毎 tick 変わることに依存している。
  // ctx.state を直返しする最適化をしてはならない。
  return {
    state: {
      ...ctx.state,
      nextPersonIndex: ctx.nextPersonIndex,
      nextHouseIndex: ctx.nextHouseIndex,
      nextPolityIndex: ctx.nextPolityIndex,
    },
    rng: ctx.rng,
    events: [...ctx.events],
  }
}

export function makeEventId(ctx: TickContext): { id: EventId; ctx: TickContext } {
  const id = `e-${ctx.state.absoluteWeek}-${ctx.nextEventIndex}` as EventId
  return { id, ctx: { ...ctx, nextEventIndex: ctx.nextEventIndex + 1 } }
}

export function makePersonId(ctx: TickContext): { id: PersonId; ctx: TickContext } {
  const id = `pe-${ctx.nextPersonIndex}` as PersonId
  return { id, ctx: { ...ctx, nextPersonIndex: ctx.nextPersonIndex + 1 } }
}

export function makeHouseId(ctx: TickContext): { id: HouseId; ctx: TickContext } {
  const id = `dh-${ctx.nextHouseIndex}` as HouseId
  return { id, ctx: { ...ctx, nextHouseIndex: ctx.nextHouseIndex + 1 } }
}

export function makePolityId(ctx: TickContext): { id: PolityId; ctx: TickContext } {
  // prefix `dp-` は runtime polity 専用。diplomatic play は `dpl-` (createDiplomaticPlayId) に分離済。
  const id = `dp-${ctx.nextPolityIndex}` as PolityId
  return { id, ctx: { ...ctx, nextPolityIndex: ctx.nextPolityIndex + 1 } }
}

export type CreateSimEventInput = {
  type: EventType
  importance: EventImportance
  messageKey: string
  messageParams: EventMessageParams
  entityRefs?: EventEntityRef[]
  reasons?: EventReason[]
  effects?: EventEffect[]
}

export function createSimEvent(
  ctx: TickContext,
  input: CreateSimEventInput,
): { event: SimEvent; ctx: TickContext } {
  const { id, ctx: nextCtx } = makeEventId(ctx)
  const event: SimEvent = {
    id,
    year: nextCtx.state.currentYear,
    weekOfYear: nextCtx.state.currentWeekOfYear,
    type: input.type,
    importance: input.importance,
    messageKey: input.messageKey,
    messageParams: input.messageParams,
    entityRefs: input.entityRefs ?? [],
    reasons: input.reasons ?? [],
    effects: input.effects ?? [],
  }
  return { event, ctx: nextCtx }
}
