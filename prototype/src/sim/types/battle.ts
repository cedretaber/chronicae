import type { BattleId, RegimentId, WarId, ProvinceId, HoldingId, PersonId } from './ids'
import type { WarSideKey, BattlefieldKind, BattleResult, BattleInitiationKind } from './war'
import type { BattleDestroyedCause } from './battleLog'

// v0.36: Battle entity の最小導入。battle internal tick / frontline simulation はまだ行わない (v0.37 以降)。
//   War detail / recent history 用の短期 entity と位置づけ、cleanupWarSystem の terminal War 削除に
//   piggyback して cleanup する (§7.3)。historical permanent record ではない。
//   (spec docs/drafts/spec-v036-update.md §7)

// §7 BattleOutcomeQuality — v0.37 以降の器。v0.36 では設定しない。
export type BattleOutcomeQuality = 'orderly_withdrawal' | 'rout' | 'encirclement'

// §7 BattleTickUnit — v0.37 以降の器。
export type BattleTickUnit = 'day' | 'phase'

// §7 BattleCommanderAssignment — v0.37/v0.38 の現場指揮官配置用の器。
export type BattleCommanderAssignment = {
  commanderPersonId: PersonId
  regimentId: RegimentId
}

// §7 BattleRegimentResult — 1 Battle における 1 Regiment の損耗記録。
//   morale* は optional。v0.36 では設定しない (morale は §5.7 placeholder で battle damage を受けない)。
export type BattleRegimentResult = {
  regimentId: RegimentId
  side: WarSideKey

  strengthBefore: number
  strengthAfter: number
  strengthDamage: number

  organizationBefore: number
  organizationAfter: number
  organizationDamage: number

  moraleBefore?: number
  moraleAfter?: number
  moraleDamage?: number

  // v0.49 §14.2: destroyed の原因タグ (destroyed = strengthAfter <= threshold の連隊のみ set)。
  destroyedCause?: BattleDestroyedCause
}

// §7 Battle
export type Battle = {
  id: BattleId
  warId: WarId
  week: number

  provinceId: ProvinceId
  holdingId?: HoldingId

  battlefieldKind: BattlefieldKind

  // v0.37 以降用。v0.36 では optional または既定値のみ。
  frontage?: number
  tickUnit?: BattleTickUnit
  maxTicks?: number
  ticksElapsed?: number

  initiationKind: BattleInitiationKind
  result: BattleResult
  outcomeQuality?: BattleOutcomeQuality

  attackerRegimentIds: RegimentId[]
  defenderRegimentIds: RegimentId[]

  // v0.37 以降用の器。
  attackerInitialFrontlineIds?: RegimentId[]
  defenderInitialFrontlineIds?: RegimentId[]

  attackerRoutedRegimentIds?: RegimentId[]
  defenderRoutedRegimentIds?: RegimentId[]

  breakthroughSide?: WarSideKey
  pursuitOccurred?: boolean

  attackerCommanderAssignments?: BattleCommanderAssignment[]
  defenderCommanderAssignments?: BattleCommanderAssignment[]

  regimentResults: BattleRegimentResult[]

  attackerBasePower: number
  defenderBasePower: number
  attackerEffectivePower: number
  defenderEffectivePower: number

  warScoreDelta: number
  warScoreAfter: number
}

// §7.2 battleIndex (WorldState に保持)。
export type BattleIndex = {
  byWar: Record<WarId, BattleId[]>
}
