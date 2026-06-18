// v0.37 §6-12 BattleSimulation pure helper.
//   WorldState 非依存。frontline/reserve deployment → 指揮官割当 (§13.4) → internal tick loop (双方向
//   organization damage, morale damage, morale 感応 rout, reserve 補充) → 終了後 strength damage を 1 回算出。
//   commander (§13.5) / captainGeneral (§14) の battle 内効果は C1 で実値化済 (commander 空・CG 未供給なら 1.0)。
//   RNG は input→output で thread。draw は damage 方向ごとの randomFactor のみ (§20 決定順:
//   tick→side(atk→def)→frontline index→matchup atk damage→def damage, tie regimentId asc)。
//   指揮官割当・効果は draw を消費しない (modifier は draw 後に乗算) ので RNG 順序は不変。
//   effectivePower は frozen (戦闘前 1 回計算、org 削れても再計算しない。pairPowerFactor 暴走回避)。

import type { RegimentId, BattleId, WarId, PersonId } from '../types/ids'
import type { BattleResult, BattlefieldKind, WarSideKey } from '../types/war'
import type {
  BattleOutcomeQuality,
  BattleCommanderAssignment,
  BattleTickUnit,
} from '../types/battle'
import type { RegimentTroopKind } from '../types/regiment'
import type {
  BattleEngagementArc,
  BattleTickLog,
  BattleLogEntry,
  BattleDestroyedCause,
} from '../types/battleLog'
import type { SimulationConfig } from '../config/defaultConfig'
import type { RngState } from '../rng/rng'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'
import { selectTactics } from './battleTactics'

// --- 入出力型 (§7.2 / §7.3) ---

export type BattleSimRegimentInput = {
  regimentId: RegimentId
  side: WarSideKey
  troopKind: RegimentTroopKind
  strength: number
  organization: number
  morale: number
  baselineOrganization: number
  maxOrganization: number
  baselineMorale: number
  maxMorale: number
  basePower: number
  effectivePower: number // frozen pre-battle effective power (side 集計とは別、単体)
}

// side ごと commander 候補プール (WarManeuver が getRoleScore 等で数値化して渡す)。
export type BattleSimCommanderInput = {
  personId: PersonId
  fieldCommandScore: number // 既存。infantry 割当・正面戦闘
  breakthroughScore: number // 既存 (command*0.5 + valor*0.4 + insight*0.1)。cavalry 割当・突破
  pursuitScore: number // v0.49 §10.3: 追撃適性 (command + insight 主)
  command: number // v0.49: 追撃/突破の生能力
  insight: number
  valor: number
}

// v0.49 §10.3: 総大将入力。tactic 選択 (insight) と battle 内 org/rout 補正 (warCommand) に使う。
export type BattleSimCaptainGeneralInput = {
  personId?: PersonId
  warCommand: number
  command: number
  insight: number
  valor: number
  ambition: number
  caution: number
}

// helper が読む config 一式 (§21)。SimulationConfig の Pick で同期を保つ。
type BattleSimConfigSlice = Pick<
  SimulationConfig,
  | 'minFightingStrengthThreshold'
  | 'retreatOrganizationThreshold'
  | 'routeOrganizationThreshold'
  | 'moraleRouteThresholdFactor'
  | 'battleBaseOrganizationDamage'
  | 'battleMoraleDamageRatio'
  | 'battleStrengthDamageRatio'
  | 'winnerStrengthDamageMultiplier'
  | 'loserStrengthDamageMultiplier'
  | 'routedStrengthDamageMultiplier'
  | 'routAdditionalMoraleDamage'
  | 'battleStrengthOutcomeQualityMultiplierOrderly'
  | 'battleStrengthOutcomeQualityMultiplierRout'
  | 'battleStrengthPowerDisadvantageModifierMin'
  | 'battleStrengthPowerDisadvantageModifierMax'
  | 'battleSimOrganizationTiebreakEpsilon'
  | 'battleMaxTicksDecisiveMarginRatio'
  | 'battleTerrainOrganizationDamageMultiplierByKind'
  | 'battleFlankTerrainMultiplierByKind'
  | 'battleRandomFactorMin'
  | 'battleRandomFactorMax'
  | 'battleFlankingDamageMultiplier'
  | 'battleFlankingRoutPenalty'
  | 'battleUncommandedDamagePenalty'
  | 'battleUncommandedRoutPenalty'
  | 'battleUncommandedAdjacentSupportRatio'
  | 'battleTacticAdvantageDamageMultiplier'
  | 'battleTacticInsightReadEffect'
  | 'battleBreakthroughBaseChance'
  | 'battleBreakthroughAbilityGapThreshold'
  | 'battleBreakthroughOrgDamageMultiplier'
  | 'battlePursuitBaseChance'
  | 'battlePursuitDestroyedChance'
  | 'battlePursuitOrgDamageMultiplier'
  | 'commanderAssignedRegimentEffectMax'
  | 'commanderAdjacentRegimentEffectRatio'
  | 'captainGeneralBattleOrganizationDamageEffectMax'
  | 'captainGeneralRoutResistanceEffectMax'
  | 'routSideRoutedShareThreshold'
  | 'battleCavalryChargeBaseChance'
  | 'battleCavalryChargeCommanderThreshold'
  | 'battleCavalryChargeMaxPerBattlePerSide'
  | 'battleCavalryChargeFailureOrgDamage'
  | 'battleCavalryChargeFailureMoraleDamage'
  | 'battleCavalryChargeTargetOrgThreshold'
  | 'battleCavalryChargeTargetMoraleThreshold'
  | 'battleCavalryChargeTerrainMultiplierByKind'
  | 'battleCavalryScreenBaseChance'
  | 'battleCavalryScreenPursuitReduction'
  | 'battleCavalryScreenDestroyedReduction'
  | 'battleCavalryScreenMoraleShockReduction'
  | 'battleCavalryScreenTerrainMultiplierByKind'
  | 'battleCavalryReservePursuitBaseChance'
  | 'battleCavalryReservePursuitDestroyedChance'
  | 'battleMoraleRallyPerRetreat'
  | 'battleMoraleRallyPerRout'
  | 'battleMoraleRallyPerDestroyed'
  | 'battleMoraleShockPerRetreat'
  | 'battleMoraleShockPerRout'
  | 'battleMoraleShockPerDestroyed'
  | 'battleMoraleRallyCapPerTick'
  | 'battleMoraleShockCapPerTick'
  | 'battleMoraleRallyFrontlineRatio'
  | 'battleMoraleRallySideRatio'
  | 'battleMoraleShiftLogThreshold'
>

export type BattleSimInput = {
  battleId: BattleId
  warId: WarId
  battlefieldKind: BattlefieldKind
  frontage: number
  tickUnit: BattleTickUnit
  maxTicks: number
  attacker: BattleSimRegimentInput[]
  defender: BattleSimRegimentInput[]
  attackerCommanders: BattleSimCommanderInput[]
  defenderCommanders: BattleSimCommanderInput[]
  attackerCaptainGeneral?: BattleSimCaptainGeneralInput
  defenderCaptainGeneral?: BattleSimCaptainGeneralInput
  config: BattleSimConfigSlice
  rng: RngState
}

type BattleSimRegimentOutput = {
  regimentId: RegimentId
  side: WarSideKey
  strengthBefore: number
  strengthAfter: number
  strengthDamage: number
  organizationBefore: number
  organizationAfter: number
  organizationDamage: number
  moraleBefore: number
  moraleAfter: number
  moraleDamage: number
  wasInitialFrontline: boolean
  routed: boolean
  destroyedCause?: BattleDestroyedCause // v0.49 §14.2: strengthAfter===0 の連隊の原因タグ
}

export type BattleSimResult = {
  result: BattleResult
  outcomeQuality: BattleOutcomeQuality
  ticksElapsed: number
  attackerInitialFrontlineIds: RegimentId[]
  defenderInitialFrontlineIds: RegimentId[]
  attackerRoutedRegimentIds: RegimentId[]
  defenderRoutedRegimentIds: RegimentId[]
  breakthroughSide?: WarSideKey
  pursuitOccurred: boolean
  attackerCommanderAssignments: BattleCommanderAssignment[]
  defenderCommanderAssignments: BattleCommanderAssignment[]
  regimentResults: BattleSimRegimentOutput[]
  tickLogs: BattleTickLog[] // v0.49 §15.3: 各 tick の戦術・slot 変化・主要イベント (warManeuverSystem が BattleLog 化)
  rng: RngState
}

// --- 内部 work 構造 ---

// v0.49 §6.1: 戦闘内部の連隊状態 (spec の BattleRegimentState の実体)。strength は input snapshot で
//   tick 中は mutate しない (§14.1)。master 配列と slot は同一インスタンスを共有する (§6.2)。
type WorkRegiment = {
  readonly input: BattleSimRegimentInput
  organization: number // mutable (tick 中に削れる)
  morale: number // mutable
  accumulatedOrgDamage: number // この battle で受けた org damage の累積 (§9.4 strength 用)
  wasInitialFrontline: boolean
  routed: boolean
  retreated: boolean // v0.49 §6.1: org <= retreatThreshold で離脱 (rout ではない)。記録用フラグ。
  commanderQ: number // §13.5 指揮官 quality bonus。v0.49 §9.2: 割当連隊は max(0,raw)、隣接は ratio 倍。default 0
  commanderPersonId?: PersonId // v0.49 §9: 直接指揮官あり (= uncommanded penalty なし)
  adjacentCommanderQ?: number // v0.49 §9: 隣接支援あり (= uncommanded penalty 軽減)。direct 不在時のみ set
  commanderBreakthroughScore?: number // v0.49 §11: 割当指揮官の突破適性 (cmd.breakthroughScore)
  commanderPursuitScore?: number // v0.49 §12: 割当指揮官の追撃適性 (cmd.pursuitScore)
}

// v0.49 §11/§12: 無指揮官連隊の breakthrough/pursuit 適性の中立基準 (平均的兵士)。
const NEUTRAL_COMMANDER_SCORE = 50

// v0.49 §6.1: frontline を fixed-length slot array として表現する。undefined は空き slot。
//   slot は master 配列内の WorkRegiment への参照 (ID 参照ではない)。
type BattleSlot = WorkRegiment | undefined
type BattleLine = { slots: BattleSlot[] } // slots.length === effectiveFrontage

// v0.49 §11/§12: 1 tick の attack engagement (src が tgt を攻撃)。breakthrough/pursuit が参照する。
type Engagement = {
  src: WorkRegiment
  tgt: WorkRegiment
  srcSlot: number
  arc: BattleEngagementArc
}

const BREAKTHROUGH_KINDS: ReadonlySet<BattlefieldKind> = new Set<BattlefieldKind>([
  'open_field',
  'hill_battle',
  'coastal_battle',
])

function toWork(input: BattleSimRegimentInput): WorkRegiment {
  return {
    input,
    organization: input.organization,
    morale: input.morale,
    accumulatedOrgDamage: 0,
    wasInitialFrontline: false,
    routed: false,
    retreated: false,
    commanderQ: 0,
  }
}

// §13.5 指揮官 quality bonus。fieldCommandScore 50 を基準に ±。assigned regiment は full、隣接は ratio 倍。
//   範囲 [-commanderAssignedRegimentEffectMax, +commanderAssignedRegimentEffectMax]。
function commanderQualityBonus(fieldCommandScore: number, cfg: BattleSimConfigSlice): number {
  return clamp((fieldCommandScore - 50) / 50, -1, 1) * cfg.commanderAssignedRegimentEffectMax
}

// §14 captainGeneral の被 org damage 軽減 (side-level, [0, captainGeneralBattleOrganizationDamageEffectMax])。
//   CG は benefit 方向のみ (warCommand<50 でも penalty にはしない。warScore efficiency と二重 penalty を避ける)。
function cgDamageReduction(
  cg: BattleSimCaptainGeneralInput | undefined,
  cfg: BattleSimConfigSlice,
): number {
  if (cg === undefined) return 0
  return (
    clamp((cg.warCommand - 50) / 50, 0, 1) * cfg.captainGeneralBattleOrganizationDamageEffectMax
  )
}

// §14 captainGeneral の rout 耐性 (side-level, [0, captainGeneralRoutResistanceEffectMax])。benefit 方向のみ。
function cgRoutResistance(
  cg: BattleSimCaptainGeneralInput | undefined,
  cfg: BattleSimConfigSlice,
): number {
  if (cg === undefined) return 0
  return clamp((cg.warCommand - 50) / 50, 0, 1) * cfg.captainGeneralRoutResistanceEffectMax
}

// v0.49 §6.3: frontline slot を中央寄り優先順に並べる (center-out、中線対称)。
//   center = (n-1)/2 (floor しない)。例 n=5 → [2,1,3,0,4]、n=4 → [1,2,0,3]、n=6 → [2,3,1,4,0,5]。
//   tie は低 index 優先 (deterministic)。deploy / fill / commander assignment で一元的に使う (§21.A)。
function centerOutSlotOrder(n: number): number[] {
  const center = (n - 1) / 2
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const da = Math.abs(a - center)
    const db = Math.abs(b - center)
    if (da !== db) return da - db
    return a - b
  })
}

// slot 操作ヘルパー (v0.49 §6)。
function occupiedSlots(line: BattleLine): WorkRegiment[] {
  return line.slots.filter((s): s is WorkRegiment => s !== undefined)
}

function occupiedCount(line: BattleLine): number {
  let c = 0
  for (const s of line.slots) if (s !== undefined) c++
  return c
}

// occupied slot を slot index 昇順で regimentId 化 (initialFrontlineIds 用)。
function lineRegimentIdsInSlotOrder(line: BattleLine): RegimentId[] {
  const ids: RegimentId[] = []
  for (const s of line.slots) if (s !== undefined) ids.push(s.input.regimentId)
  return ids
}

// §13.4 指揮官割当 (deploy 後・draw 無し)。pool から target regiment に greedy 割当し、
//   各 WorkRegiment.commanderQ を設定して BattleCommanderAssignment[] を返す。
//   target 優先順: frontline infantry(center-out) → frontline cavalry(center-out) → reserve cavalry → reserve infantry。
//   infantry target は fieldCommandScore 最大、cavalry target は breakthroughScore 最大を選ぶ (§13.4 step4)。tie personId asc。
//   隣接 frontline 連隊 (自身に割当が無いもの) は、隣の assigned 正 q × ratio を最大で受ける。
function assignCommanders(
  line: BattleLine,
  reserve: WorkRegiment[],
  pool: BattleSimCommanderInput[],
  cfg: BattleSimConfigSlice,
): BattleCommanderAssignment[] {
  if (pool.length === 0) return []
  const remaining = [...pool]

  // v0.49 §9.1: frontline target は centerOutSlotOrder の occupied slot を中央優先で並べる。
  const order = centerOutSlotOrder(line.slots.length)
  const flOrdered = order
    .map((i) => line.slots[i])
    .filter((w): w is WorkRegiment => w !== undefined)
  const flInfantry = flOrdered.filter((w) => w.input.troopKind === 'infantry')
  const flCavalry = flOrdered.filter((w) => w.input.troopKind !== 'infantry')
  const resCavalry = reserve.filter((w) => w.input.troopKind !== 'infantry')
  const resInfantry = reserve.filter((w) => w.input.troopKind === 'infantry')
  const targets = [...flInfantry, ...flCavalry, ...resCavalry, ...resInfantry]

  const assignments: BattleCommanderAssignment[] = []
  const assignedQ = new Map<RegimentId, number>()
  for (const tgt of targets) {
    if (remaining.length === 0) break
    const isCav = tgt.input.troopKind !== 'infantry'
    const metric = (c: BattleSimCommanderInput) =>
      isCav ? c.breakthroughScore : c.fieldCommandScore
    let bestIdx = 0
    for (let i = 1; i < remaining.length; i++) {
      const mi = metric(remaining[i]!)
      const mb = metric(remaining[bestIdx]!)
      if (
        mi > mb ||
        (mi === mb && (remaining[i]!.personId as string) < (remaining[bestIdx]!.personId as string))
      ) {
        bestIdx = i
      }
    }
    const cmd = remaining.splice(bestIdx, 1)[0]!
    // v0.49 §9.2: 割当連隊の commanderQ は負値を取らせない (低能力でも無指揮官より悪くしない)。
    const q = Math.max(0, commanderQualityBonus(cmd.fieldCommandScore, cfg))
    tgt.commanderQ = q
    tgt.commanderPersonId = cmd.personId
    tgt.commanderBreakthroughScore = cmd.breakthroughScore
    tgt.commanderPursuitScore = cmd.pursuitScore
    assignedQ.set(tgt.input.regimentId, q)
    assignments.push({ commanderPersonId: cmd.personId, regimentId: tgt.input.regimentId })
  }

  // v0.49 §9.4: 隣接支援は slot index ±1 で判定。直接指揮官を持たない連隊が、隣接 assigned 連隊の
  //   正 q × ratio を受ける (最大採用)。隣に直接指揮官がいれば adjacentCommanderQ を set し (q=0 でも
  //   「支援あり」として uncommanded penalty を軽減)、empty slot は支援なし。
  for (let i = 0; i < line.slots.length; i++) {
    const w = line.slots[i]
    if (w === undefined || w.commanderPersonId !== undefined) continue
    let best = 0
    let hasAdjacentCommander = false
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= line.slots.length) continue
      const nb = line.slots[j]
      if (nb === undefined || nb.commanderPersonId === undefined) continue
      hasAdjacentCommander = true
      if (nb.commanderQ > 0)
        best = Math.max(best, nb.commanderQ * cfg.commanderAdjacentRegimentEffectRatio)
    }
    if (hasAdjacentCommander) {
      w.commanderQ = best
      w.adjacentCommanderQ = best
    }
  }
  return assignments
}

// v0.49 §9.3: 無指揮官ペナルティ。直接指揮官あり=0、隣接支援あり=軽減、どちらも無し=全適用。
function uncommandedDamagePenalty(w: WorkRegiment, cfg: BattleSimConfigSlice): number {
  if (w.commanderPersonId !== undefined) return 0
  if (w.adjacentCommanderQ !== undefined)
    return cfg.battleUncommandedDamagePenalty * (1 - cfg.battleUncommandedAdjacentSupportRatio)
  return cfg.battleUncommandedDamagePenalty
}

function uncommandedRoutPenalty(w: WorkRegiment, cfg: BattleSimConfigSlice): number {
  if (w.commanderPersonId !== undefined) return 0
  if (w.adjacentCommanderQ !== undefined)
    return cfg.battleUncommandedRoutPenalty * (1 - cfg.battleUncommandedAdjacentSupportRatio)
  return cfg.battleUncommandedRoutPenalty
}

// effectivePower 降順, tie regimentId 昇順 (deterministic, draw 無し)。
function byPowerDescThenId(a: WorkRegiment, b: WorkRegiment): number {
  if (b.input.effectivePower !== a.input.effectivePower) {
    return b.input.effectivePower - a.input.effectivePower
  }
  return (a.input.regimentId as string) < (b.input.regimentId as string) ? -1 : 1
}

// §6.2-6.3 deployment。candidate = strength > minFighting && org > retreatThreshold。
//   infantry frontline 優先、cavalry reserve 優先、frontline に余れば cavalry も前に出る。
//   reserve は effectivePower 降順で保持 (補充は power 順)。非 candidate は front/reserve どちらにも入らない。
function deployToLine(
  side: WorkRegiment[],
  frontage: number,
  cfg: BattleSimConfigSlice,
): { line: BattleLine; reserve: WorkRegiment[] } {
  const candidates = side.filter(
    (w) =>
      w.input.strength > cfg.minFightingStrengthThreshold &&
      w.organization > cfg.retreatOrganizationThreshold,
  )
  const infantry = candidates
    .filter((w) => w.input.troopKind === 'infantry')
    .sort(byPowerDescThenId)
  const cavalry = candidates.filter((w) => w.input.troopKind !== 'infantry').sort(byPowerDescThenId)
  const ordered = [...infantry, ...cavalry] // infantry 優先
  // v0.49 §6.4: 強い順に centerOutSlotOrder で配置 (最強が中央)。余りは reserve、不足分は空き slot。
  const slots: BattleSlot[] = new Array<BattleSlot>(frontage).fill(undefined)
  const order = centerOutSlotOrder(frontage)
  const frontCount = Math.min(frontage, ordered.length)
  for (let k = 0; k < frontCount; k++) slots[order[k]!] = ordered[k]!
  const reserve = ordered.slice(frontCount).sort(byPowerDescThenId)
  return { line: { slots }, reserve }
}

// v0.49 §7.1: attacker slot i の攻撃対象を敵 slot から探す。候補順 [i, i-1, i+1] (正面優先、左隣接 → 右隣接)。
//   正面に敵がいれば frontal、空なら左右隣接の敵を flanking で攻撃。範囲外/全空きなら対象なし (攻撃しない)。
function findTargetSlot(
  enemy: BattleLine,
  i: number,
): { idx: number; arc: BattleEngagementArc } | undefined {
  if (enemy.slots[i] !== undefined) return { idx: i, arc: 'frontal' }
  if (i - 1 >= 0 && enemy.slots[i - 1] !== undefined) return { idx: i - 1, arc: 'flanking' }
  if (i + 1 < enemy.slots.length && enemy.slots[i + 1] !== undefined)
    return { idx: i + 1, arc: 'flanking' }
  return undefined
}

// 1 方向の organization damage (§9.2)。commander/cg modifier は draw 後に乗算 (draw 数・順序不変)。
//   §13.5: 攻撃側 src の commander quality で与 damage 増 (1+qSrc)、防御側 tgt の commander で被 damage 減 (1-qTgt)。
//   §14: tgt side の captainGeneral が被 org damage を軽減 (1 - cgDmgReductionBySide[tgt.side])。
function computeOrgDamage(
  src: WorkRegiment,
  tgt: WorkRegiment,
  flankMultiplier: number, // v0.49 §7.2: frontal=1、flanking>1 (per-pair で caller が決める)
  input: BattleSimInput,
  cfg: BattleSimConfigSlice,
  cgDmgReductionBySide: Record<WarSideKey, number>,
  rng: RngState,
): { dmg: number; rng: RngState } {
  const pairPower = clamp(src.input.effectivePower / (tgt.input.effectivePower + 1), 0.75, 1.35)
  const terrainMult =
    cfg.battleTerrainOrganizationDamageMultiplierByKind[input.battlefieldKind] ?? 1
  const flank = flankMultiplier
  const { value, rng: nextRng } = randomFloat(rng)
  const randomFactor =
    cfg.battleRandomFactorMin + value * (cfg.battleRandomFactorMax - cfg.battleRandomFactorMin)
  // v0.49 §9.3: src が無指揮官なら与 damage が減る (uncommanded penalty)。
  const commanderMult =
    (1 + src.commanderQ) * (1 - tgt.commanderQ) * (1 - uncommandedDamagePenalty(src, cfg))
  const cgMult = 1 - cgDmgReductionBySide[tgt.input.side]
  const dmg =
    cfg.battleBaseOrganizationDamage *
    pairPower *
    terrainMult *
    flank *
    randomFactor *
    commanderMult *
    cgMult
  return { dmg, rng: nextRng }
}

// org damage を適用し、比例した morale damage も与える (§9.3)。
function applyOrgAndMorale(tgt: WorkRegiment, orgDmg: number, cfg: BattleSimConfigSlice): void {
  tgt.accumulatedOrgDamage += orgDmg
  tgt.organization = clamp(tgt.organization - orgDmg, 0, tgt.input.maxOrganization)
  const moraleDmg = orgDmg * cfg.battleMoraleDamageRatio
  tgt.morale = clamp(tgt.morale - moraleDmg, 0, tgt.input.maxMorale)
}

// v0.49 §13.1: その連隊・その tick における実効 rout 閾値 (effectiveRouteThreshold)。
//   base routeThreshold に morale 補正・rout 耐性 (commander/CG)・flanking/uncommanded ペナルティを反映。
//   classify と breakthrough (org をこの閾値まで押し下げる) で共有する。
function effectiveRouteThreshold(
  w: WorkRegiment,
  cfg: BattleSimConfigSlice,
  cgRoutResist: number,
  flanked: ReadonlySet<WorkRegiment>,
): number {
  const routResist = clamp(Math.max(0, w.commanderQ) + cgRoutResist, 0, 0.9)
  // §7.2/§8: flanking を受けた連隊は rout しやすい。§9.3: 無指揮官連隊も rout しやすい。
  const flankRoutMult = flanked.has(w) ? 1 + cfg.battleFlankingRoutPenalty : 1
  const uncommandedRoutMult = 1 + uncommandedRoutPenalty(w, cfg)
  return (
    (cfg.routeOrganizationThreshold +
      Math.max(0, w.input.baselineMorale - w.morale) * cfg.moraleRouteThresholdFactor) *
    (1 - routResist) *
    flankRoutMult *
    uncommandedRoutMult
  )
}

// v0.49 §13.1: classify はマークのみ (即時除去しない)。routed フラグを尊重し survivor に戻さない (C2)。
function classifyLine(
  line: BattleLine,
  cfg: BattleSimConfigSlice,
  cgRoutResist: number,
  flanked: ReadonlySet<WorkRegiment>,
): void {
  for (const w of occupiedSlots(line)) {
    if (w.routed) continue // 既に routed (breakthrough/pursuit 由来) は維持
    const effRoute = effectiveRouteThreshold(w, cfg, cgRoutResist, flanked)
    if (w.organization <= effRoute) {
      w.routed = true
      w.morale = clamp(w.morale - cfg.routAdditionalMoraleDamage, 0, w.input.maxMorale)
    } else if (w.organization <= cfg.retreatOrganizationThreshold) {
      w.retreated = true // retreat: routed ではないが戦列から離脱する
    }
  }
}

// v0.49 §11: breakthrough 判定 helper。attacker が tgt を突破できるか + 成功時の効果。
//   eligible: 攻撃側 breakthroughScore - 防御側 breakthroughScore >= threshold かつ地形が突破可能。
//   成功: tgt を routed 化 (org を effRoute まで押し下げ) + accumulatedOrgDamage を控えめに増幅。
function breakthroughScoreOf(w: WorkRegiment): number {
  return w.commanderBreakthroughScore ?? NEUTRAL_COMMANDER_SCORE
}

// v0.50 §14.8: breakthrough effect を helper 化 (cavalry charge と既存 breakthrough で共有)。
function applyBreakthroughEffect(
  target: WorkRegiment,
  cfg: BattleSimConfigSlice,
  cgRoutResist: number,
  flanked: ReadonlySet<WorkRegiment>,
): void {
  target.routed = true
  const effRoute = effectiveRouteThreshold(target, cfg, cgRoutResist, flanked)
  target.organization = Math.min(target.organization, effRoute)
  target.accumulatedOrgDamage *= cfg.battleBreakthroughOrgDamageMultiplier
}

// v0.50 §14: reserve から action eligible な cavalry を決定的に選択。
//   org > retreatThreshold かつ usedCavalryThisTick に含まれない cavalry から effectivePower 降順。
function selectReserveCavalryForAction(
  reserve: WorkRegiment[],
  used: ReadonlySet<WorkRegiment>,
  cfg: BattleSimConfigSlice,
): WorkRegiment | undefined {
  let best: WorkRegiment | undefined
  for (const w of reserve) {
    if (w.input.troopKind !== 'cavalry') continue
    if (w.organization <= cfg.retreatOrganizationThreshold) continue
    if (used.has(w)) continue
    if (best === undefined || byPowerDescThenId(w, best) < 0) best = w
  }
  return best
}

// v0.49 §13.1: 除去述語。pursuit 判定後に slot から外す対象。
function shouldRemoveFromSlot(w: WorkRegiment, cfg: BattleSimConfigSlice): boolean {
  return w.routed || w.organization <= cfg.retreatOrganizationThreshold
}

// v0.49 §13.1: 除去対象連隊を slot から外す (master 配列には残る)。
function removeRoutedAndRetreatedFromSlots(line: BattleLine, cfg: BattleSimConfigSlice): void {
  for (let i = 0; i < line.slots.length; i++) {
    const w = line.slots[i]
    if (w !== undefined && shouldRemoveFromSlot(w, cfg)) line.slots[i] = undefined
  }
}

// v0.49 §13.2: 空き slot を centerOutSlotOrder 順に reserve (power 順) から補充。
//   補充された連隊はその tick では攻撃しない (combat の後に呼ぶため自然と次 tick から)。
function fillLine(line: BattleLine, reserve: WorkRegiment[]): void {
  if (reserve.length === 0) return
  const order = centerOutSlotOrder(line.slots.length)
  for (const i of order) {
    if (reserve.length === 0) break
    if (line.slots[i] === undefined) line.slots[i] = reserve.shift()!
  }
}

function sumOrg(side: WorkRegiment[]): number {
  return side.reduce((s, w) => s + w.organization, 0)
}

function sumEffectivePower(side: BattleSimRegimentInput[]): number {
  return side.reduce((s, r) => s + r.effectivePower, 0)
}

export function simulateBattle(input: BattleSimInput): BattleSimResult {
  const cfg = input.config
  let rng = input.rng

  const atkAll = input.attacker.map(toWork)
  const defAll = input.defender.map(toWork)

  // v0.49 §6.4: 初期 deployment (slot array)。frontage = effectiveFrontage。
  const atkDeploy = deployToLine(atkAll, input.frontage, cfg)
  const defDeploy = deployToLine(defAll, input.frontage, cfg)
  for (const w of occupiedSlots(atkDeploy.line)) w.wasInitialFrontline = true
  for (const w of occupiedSlots(defDeploy.line)) w.wasInitialFrontline = true
  const attackerInitialFrontlineIds = lineRegimentIdsInSlotOrder(atkDeploy.line)
  const defenderInitialFrontlineIds = lineRegimentIdsInSlotOrder(defDeploy.line)

  const atkLine = atkDeploy.line
  const atkRes = atkDeploy.reserve
  const defLine = defDeploy.line
  const defRes = defDeploy.reserve

  // §13.4: deployment 確定後に指揮官割当 (draw 無し)。WorkRegiment.commanderQ を設定し assignment snapshot を得る。
  const attackerCommanderAssignments = assignCommanders(
    atkLine,
    atkRes,
    input.attackerCommanders,
    cfg,
  )
  const defenderCommanderAssignments = assignCommanders(
    defLine,
    defRes,
    input.defenderCommanders,
    cfg,
  )

  // §14: captainGeneral side-level 補正 (CG 未供給 side は 0 = 無効)。
  const cgDmgReductionBySide: Record<WarSideKey, number> = {
    attacker: cgDamageReduction(input.attackerCaptainGeneral, cfg),
    defender: cgDamageReduction(input.defenderCaptainGeneral, cfg),
  }
  const cgRoutResistBySide: Record<WarSideKey, number> = {
    attacker: cgRoutResistance(input.attackerCaptainGeneral, cfg),
    defender: cgRoutResistance(input.defenderCaptainGeneral, cfg),
  }
  // v0.49 §10.3: tactic 選択に使う総大将の insight (CG 不在は中立 50)。
  const atkInsight = input.attackerCaptainGeneral?.insight ?? 50
  const defInsight = input.defenderCaptainGeneral?.insight ?? 50

  // v0.49 §15.3: slot を (RegimentId | null)[] で snapshot する (battle log 用)。
  const snapshotSlots = (line: BattleLine): (RegimentId | null)[] =>
    line.slots.map((s) => (s === undefined ? null : s.input.regimentId))

  let ticksElapsed = 0
  let result: BattleResult | null = null
  const tickLogs: BattleTickLog[] = []
  // v0.49 §11: 実 breakthrough が発生した side を記録 (Battle entity の breakthroughSide)。
  const breakthroughBySide: Record<WarSideKey, boolean> = { attacker: false, defender: false }
  // v0.49 §12: 追撃が発生したか + 追撃で致死量まで押し下げた連隊の原因タグ (destroyedCause 用)。
  let pursuitOccurred = false
  // 抽選で決まる「強制壊滅」の原因タグ (現状は追撃致死のみ。将来 encirclement 等も同じ Map に集約)。
  //   ここに入った連隊は終局で strengthAfter=0 を強制する。通常消耗 (emergent) の壊滅はここを通さない。
  const forcedDestroyedCause = new Map<WorkRegiment, BattleDestroyedCause>()
  // v0.50: cavalry charge count per side (battle-wide limit)
  const cavalryChargeCountBySide: Record<WarSideKey, number> = { attacker: 0, defender: 0 }

  // §8.2 両端ケース: 片側 (または双方) が fighting force 0 なら戦闘 tick を回さず即決着する。
  //   tactic 選択を含む draw を一切消費しない (auto-resolve は後続 battle の rng stream を乱さない)。
  const atkForce0 = occupiedCount(atkLine) + atkRes.length
  const defForce0 = occupiedCount(defLine) + defRes.length
  const degenerate = atkForce0 === 0 || defForce0 === 0
  if (degenerate) {
    ticksElapsed = 1
    if (atkForce0 === 0 && defForce0 === 0) {
      const atkOrg = sumOrg(atkAll)
      const defOrg = sumOrg(defAll)
      result =
        Math.abs(atkOrg - defOrg) <= cfg.battleSimOrganizationTiebreakEpsilon
          ? 'inconclusive'
          : atkOrg > defOrg
            ? 'attacker_victory'
            : 'defender_victory'
    } else {
      result = atkForce0 === 0 ? 'defender_victory' : 'attacker_victory'
    }
  }

  const frontage = input.frontage
  for (let tick = 1; tick <= input.maxTicks && !degenerate; tick++) {
    ticksElapsed = tick

    // 0. tactic 選択 (§18.2 step1。attacker → defender の draw 順)。
    const tactics = selectTactics(atkInsight, defInsight, cfg.battleTacticInsightReadEffect, rng)
    rng = tactics.rng
    const attackerSlotsBefore = snapshotSlots(atkLine)
    const defenderSlotsBefore = snapshotSlots(defLine)

    // 1. flanking multiplier (§7.2/§8)。slot-based flanking に統一 (wing-based flank pressure は退役)。
    //    地形が flanking の効きをスケールする (battleFlankTerrainMultiplierByKind を転用)。
    const terrainFlank = cfg.battleFlankTerrainMultiplierByKind[input.battlefieldKind] ?? 1
    const flankingMult = 1 + (cfg.battleFlankingDamageMultiplier - 1) * terrainFlank
    // §10.2: 戦術有利な side は org damage が増える。
    const tacticMultAtk =
      tactics.advantageSide === 'attacker' ? cfg.battleTacticAdvantageDamageMultiplier : 1
    const tacticMultDef =
      tactics.advantageSide === 'defender' ? cfg.battleTacticAdvantageDamageMultiplier : 1

    // 2. 双方向 organization damage (§7.1 attack pair / §7.3 同時適用)。tick 開始 snapshot から全 damage を
    //    計算・累積し同時適用。draw 順 = §18.2: attacker 側 slot 昇順 → defender 側 slot 昇順。
    //    対象は [i, i-1, i+1] (正面優先、空なら隣接 = flanking)。対象ありの slot だけ draw を消費する。
    const incoming = new Map<WorkRegiment, number>()
    const flankedAtk = new Set<WorkRegiment>()
    const flankedDef = new Set<WorkRegiment>()
    // §11/§12: この tick の engagement (src→tgt)。breakthrough/pursuit が slot 昇順で参照する。
    const atkEngagements: Engagement[] = []
    const defEngagements: Engagement[] = []
    const tickEvents: BattleLogEntry[] = []
    const brokenTargets = new Set<WorkRegiment>() // §12: この tick に突破された連隊 (pursuit bonus)
    const addDmg = (tgt: WorkRegiment, dmg: number): void => {
      incoming.set(tgt, (incoming.get(tgt) ?? 0) + dmg)
    }
    // attacker → defender
    for (let i = 0; i < frontage; i++) {
      const A = atkLine.slots[i]
      if (A === undefined) continue
      const t = findTargetSlot(defLine, i)
      if (t === undefined) continue
      const D = defLine.slots[t.idx]!
      const fm = t.arc === 'flanking' ? flankingMult : 1
      const toD = computeOrgDamage(A, D, fm, input, cfg, cgDmgReductionBySide, rng)
      rng = toD.rng
      addDmg(D, toD.dmg * tacticMultAtk)
      if (t.arc === 'flanking') flankedDef.add(D)
      atkEngagements.push({ src: A, tgt: D, srcSlot: i, arc: t.arc })
    }
    // defender → attacker
    for (let i = 0; i < frontage; i++) {
      const D = defLine.slots[i]
      if (D === undefined) continue
      const t = findTargetSlot(atkLine, i)
      if (t === undefined) continue
      const A = atkLine.slots[t.idx]!
      const fm = t.arc === 'flanking' ? flankingMult : 1
      const toA = computeOrgDamage(D, A, fm, input, cfg, cgDmgReductionBySide, rng)
      rng = toA.rng
      addDmg(A, toA.dmg * tacticMultDef)
      if (t.arc === 'flanking') flankedAtk.add(A)
      defEngagements.push({ src: D, tgt: A, srcSlot: i, arc: t.arc })
    }
    // 同時適用
    for (const [tgt, dmg] of incoming) applyOrgAndMorale(tgt, dmg, cfg)

    // 2.5 breakthrough (§11.2: combat 後・classify 前。§18.2 step3: atk slot 昇順 → def slot 昇順、eligible のみ draw)。
    const tryBreakthrough = (
      e: Engagement,
      srcSide: WarSideKey,
      tgtFlanked: ReadonlySet<WorkRegiment>,
      tgtCgRoutResist: number,
    ): void => {
      if (e.tgt.routed) return // 既に routed なら判定不要
      if (!BREAKTHROUGH_KINDS.has(input.battlefieldKind)) return
      const gap = breakthroughScoreOf(e.src) - breakthroughScoreOf(e.tgt)
      if (gap < cfg.battleBreakthroughAbilityGapThreshold) return
      const draw = randomFloat(rng)
      rng = draw.rng
      if (draw.value >= cfg.battleBreakthroughBaseChance) return
      // 成功: routed 化 + org を effRoute まで押し下げ + accumulatedOrgDamage 増幅 (§11.3)。
      applyBreakthroughEffect(e.tgt, cfg, tgtCgRoutResist, tgtFlanked)
      breakthroughBySide[srcSide] = true
      brokenTargets.add(e.tgt)
      tickEvents.push({
        kind: 'breakthrough',
        side: srcSide,
        regimentId: e.src.input.regimentId,
        targetRegimentId: e.tgt.input.regimentId,
        slotIndex: e.srcSlot,
      })
    }
    for (const e of atkEngagements)
      tryBreakthrough(e, 'attacker', flankedDef, cgRoutResistBySide.defender)
    for (const e of defEngagements)
      tryBreakthrough(e, 'defender', flankedAtk, cgRoutResistBySide.attacker)

    // 2.5 cavalry charge (§14: engagement damage / breakthrough 後、classify 前)。
    //   reserve cavalry が commander score threshold 以上の場合に、弱った敵 frontline を突撃。
    const usedCavalryThisTick = new Set<WorkRegiment>()
    type MoraleEvent = {
      side: WarSideKey
      slotIndex: number
      eventKind:
        | 'enemy_retreat'
        | 'enemy_rout'
        | 'enemy_destroyed'
        | 'friendly_retreat'
        | 'friendly_rout'
        | 'friendly_destroyed'
      screened?: boolean
    }
    const moraleEvents: MoraleEvent[] = []

    const tryCavalryCharge = (
      chargeSide: WarSideKey,
      enemyLine: BattleLine,
      friendlyReserve: WorkRegiment[],
      enemyCgRoutResist: number,
      enemyFlanked: ReadonlySet<WorkRegiment>,
    ): void => {
      const terrainMult = cfg.battleCavalryChargeTerrainMultiplierByKind[input.battlefieldKind] ?? 0
      if (terrainMult === 0) return
      if (cavalryChargeCountBySide[chargeSide] >= cfg.battleCavalryChargeMaxPerBattlePerSide) return
      const cav = selectReserveCavalryForAction(friendlyReserve, usedCavalryThisTick, cfg)
      if (cav === undefined) return
      const cmdScore = cav.commanderBreakthroughScore ?? NEUTRAL_COMMANDER_SCORE
      if (cmdScore < cfg.battleCavalryChargeCommanderThreshold) return
      // target selection: weakest non-routed/retreated enemy slot
      let bestSlot = -1
      let bestOrg = Infinity
      for (let i = 0; i < enemyLine.slots.length; i++) {
        const e = enemyLine.slots[i]
        if (e === undefined || e.routed || e.retreated) continue
        if (brokenTargets.has(e)) continue
        const hasWeakness =
          e.organization <= cfg.battleCavalryChargeTargetOrgThreshold ||
          e.morale <= cfg.battleCavalryChargeTargetMoraleThreshold ||
          (i > 0 && enemyLine.slots[i - 1] === undefined) ||
          (i < enemyLine.slots.length - 1 && enemyLine.slots[i + 1] === undefined)
        if (!hasWeakness) continue
        if (e.organization < bestOrg || (e.organization === bestOrg && i < bestSlot)) {
          bestOrg = e.organization
          bestSlot = i
        }
      }
      if (bestSlot < 0) return
      const target = enemyLine.slots[bestSlot]!
      const chance = clamp(cfg.battleCavalryChargeBaseChance * terrainMult, 0, 0.95)
      const draw = randomFloat(rng)
      rng = draw.rng
      usedCavalryThisTick.add(cav)
      if (draw.value < chance) {
        // success
        applyBreakthroughEffect(target, cfg, enemyCgRoutResist, enemyFlanked)
        brokenTargets.add(target)
        breakthroughBySide[chargeSide] = true
        cavalryChargeCountBySide[chargeSide]++
        moraleEvents.push({
          side: chargeSide === 'attacker' ? 'defender' : 'attacker',
          slotIndex: bestSlot,
          eventKind: 'friendly_rout',
        })
        moraleEvents.push({
          side: chargeSide,
          slotIndex: bestSlot,
          eventKind: 'enemy_rout',
        })
        tickEvents.push({
          kind: 'cavalry_charge',
          side: chargeSide,
          cavalryRegimentId: cav.input.regimentId,
          ...(cav.commanderPersonId !== undefined
            ? { commanderPersonId: cav.commanderPersonId }
            : {}),
          targetRegimentId: target.input.regimentId,
          targetSlotIndex: bestSlot,
          result: 'success',
        })
      } else {
        // failure: cavalry takes org/morale damage
        cav.organization = Math.max(0, cav.organization - cfg.battleCavalryChargeFailureOrgDamage)
        cav.morale = clamp(
          cav.morale - cfg.battleCavalryChargeFailureMoraleDamage,
          0,
          cav.input.maxMorale,
        )
        tickEvents.push({
          kind: 'cavalry_charge',
          side: chargeSide,
          cavalryRegimentId: cav.input.regimentId,
          ...(cav.commanderPersonId !== undefined
            ? { commanderPersonId: cav.commanderPersonId }
            : {}),
          targetRegimentId: target.input.regimentId,
          targetSlotIndex: bestSlot,
          result: 'failure',
        })
      }
    }
    tryCavalryCharge('attacker', defLine, atkRes, cgRoutResistBySide.defender, flankedDef)
    tryCavalryCharge('defender', atkLine, defRes, cgRoutResistBySide.attacker, flankedAtk)

    // 3. retreat / rout 判定 (マーク only。§13.1)。flanking を受けた連隊は rout しやすい。
    classifyLine(atkLine, cfg, cgRoutResistBySide.attacker, flankedAtk)
    classifyLine(defLine, cfg, cgRoutResistBySide.defender, flankedDef)
    // collect classify morale events
    for (let i = 0; i < frontage; i++) {
      const aw = atkLine.slots[i]
      if (aw !== undefined && aw.routed && !brokenTargets.has(aw)) {
        moraleEvents.push({ side: 'attacker', slotIndex: i, eventKind: 'friendly_rout' })
        moraleEvents.push({ side: 'defender', slotIndex: i, eventKind: 'enemy_rout' })
      } else if (aw !== undefined && aw.retreated) {
        moraleEvents.push({ side: 'attacker', slotIndex: i, eventKind: 'friendly_retreat' })
        moraleEvents.push({ side: 'defender', slotIndex: i, eventKind: 'enemy_retreat' })
      }
    }
    for (let i = 0; i < frontage; i++) {
      const dw = defLine.slots[i]
      if (dw !== undefined && dw.routed && !brokenTargets.has(dw)) {
        moraleEvents.push({ side: 'defender', slotIndex: i, eventKind: 'friendly_rout' })
        moraleEvents.push({ side: 'attacker', slotIndex: i, eventKind: 'enemy_rout' })
      } else if (dw !== undefined && dw.retreated) {
        moraleEvents.push({ side: 'defender', slotIndex: i, eventKind: 'friendly_retreat' })
        moraleEvents.push({ side: 'attacker', slotIndex: i, eventKind: 'enemy_retreat' })
      }
    }

    // 3.5 pursuit (§12 + v0.50 screen / reserve cavalry pursuit)。
    const screenTerrainMult =
      cfg.battleCavalryScreenTerrainMultiplierByKind[input.battlefieldKind] ?? 1
    const tryPursuit = (
      enemyLine: BattleLine,
      friendlyLine: BattleLine,
      engagements: Engagement[],
      pursuerSide: WarSideKey,
      enemyReserve: WorkRegiment[],
    ): void => {
      const enemySide: WarSideKey = pursuerSide === 'attacker' ? 'defender' : 'attacker'
      for (let i = 0; i < frontage; i++) {
        const enemy = enemyLine.slots[i]
        if (enemy === undefined || !(enemy.routed || enemy.retreated)) continue
        let pursuer: WorkRegiment | undefined
        const front = friendlyLine.slots[i]
        if (front !== undefined && !front.routed && !front.retreated) {
          pursuer = front
        } else {
          for (const e of engagements) {
            if (e.tgt === enemy && e.arc === 'flanking' && !e.src.routed && !e.src.retreated) {
              pursuer = e.src
              break
            }
          }
        }
        if (pursuer === undefined) continue

        // v0.50 cavalry screen: before pursuit chance draw
        let screenActive = false
        const screenCav = selectReserveCavalryForAction(enemyReserve, usedCavalryThisTick, cfg)
        if (screenCav !== undefined) {
          const screenChance = clamp(cfg.battleCavalryScreenBaseChance * screenTerrainMult, 0, 0.95)
          const screenDraw = randomFloat(rng)
          rng = screenDraw.rng
          if (screenDraw.value < screenChance) {
            screenActive = true
            usedCavalryThisTick.add(screenCav)
            tickEvents.push({
              kind: 'cavalry_screen',
              side: enemySide,
              cavalryRegimentId: screenCav.input.regimentId,
              screenedRegimentId: enemy.input.regimentId,
              screenedSlotIndex: i,
            })
          }
        }

        const pursuitScore = pursuer.commanderPursuitScore ?? NEUTRAL_COMMANDER_SCORE
        const abilityMult = 1 + clamp((pursuitScore - NEUTRAL_COMMANDER_SCORE) / 50, -0.5, 1)
        const cavalryMult = pursuer.input.troopKind === 'cavalry' ? 1.5 : 1
        const tacticMult = tactics.advantageSide === pursuerSide ? 1.3 : 1
        const breakthroughMult = brokenTargets.has(enemy) ? 1.3 : 1
        const terrainMult = BREAKTHROUGH_KINDS.has(input.battlefieldKind) ? 1.2 : 1
        let pursuitChance =
          cfg.battlePursuitBaseChance *
          abilityMult *
          cavalryMult *
          tacticMult *
          breakthroughMult *
          terrainMult
        let destroyedChance = cfg.battlePursuitDestroyedChance
        if (screenActive) {
          pursuitChance *= cfg.battleCavalryScreenPursuitReduction
          destroyedChance *= cfg.battleCavalryScreenDestroyedReduction
        }
        pursuitChance = clamp(pursuitChance, 0, 0.95)
        const draw = randomFloat(rng)
        rng = draw.rng
        if (draw.value >= pursuitChance) continue
        pursuitOccurred = true
        enemy.routed = true
        enemy.accumulatedOrgDamage *= cfg.battlePursuitOrgDamageMultiplier
        enemy.morale = clamp(
          enemy.morale - cfg.routAdditionalMoraleDamage,
          0,
          enemy.input.maxMorale,
        )
        const destroyDraw = randomFloat(rng)
        rng = destroyDraw.rng
        let destroyed = false
        if (destroyDraw.value < destroyedChance) {
          destroyed = true
          forcedDestroyedCause.set(
            enemy,
            brokenTargets.has(enemy) ? 'breakthrough_pursuit' : 'pursuit',
          )
          moraleEvents.push({
            side: enemySide,
            slotIndex: i,
            eventKind: 'friendly_destroyed',
            screened: screenActive,
          })
          moraleEvents.push({
            side: pursuerSide,
            slotIndex: i,
            eventKind: 'enemy_destroyed',
          })
        }
        tickEvents.push({
          kind: 'pursuit',
          side: pursuerSide,
          pursuerRegimentId: pursuer.input.regimentId,
          targetRegimentId: enemy.input.regimentId,
          targetSlotIndex: i,
          destroyed,
        })
        if (destroyed) {
          tickEvents.push({
            kind: 'regiment_destroyed',
            side: enemySide,
            regimentId: enemy.input.regimentId,
            slotIndex: i,
            cause: brokenTargets.has(enemy) ? 'breakthrough_pursuit' : 'pursuit',
          })
        }
      }
    }
    tryPursuit(defLine, atkLine, atkEngagements, 'attacker', defRes)
    tryPursuit(atkLine, defLine, defEngagements, 'defender', atkRes)

    // 3.5d reserve cavalry pursuit (§17.1: after existing pursuit)
    const tryReserveCavalryPursuit = (
      enemyLine: BattleLine,
      friendlyReserve: WorkRegiment[],
      pursuerSide: WarSideKey,
    ): void => {
      const enemySide: WarSideKey = pursuerSide === 'attacker' ? 'defender' : 'attacker'
      for (let i = 0; i < frontage; i++) {
        const enemy = enemyLine.slots[i]
        if (enemy === undefined || !(enemy.routed || enemy.retreated)) continue
        if (forcedDestroyedCause.has(enemy)) continue
        const cav = selectReserveCavalryForAction(friendlyReserve, usedCavalryThisTick, cfg)
        if (cav === undefined) return
        const draw = randomFloat(rng)
        rng = draw.rng
        if (draw.value >= cfg.battleCavalryReservePursuitBaseChance) continue
        usedCavalryThisTick.add(cav)
        pursuitOccurred = true
        enemy.routed = true
        enemy.accumulatedOrgDamage *= cfg.battlePursuitOrgDamageMultiplier
        enemy.morale = clamp(
          enemy.morale - cfg.routAdditionalMoraleDamage,
          0,
          enemy.input.maxMorale,
        )
        const destroyDraw = randomFloat(rng)
        rng = destroyDraw.rng
        let destroyed = false
        if (destroyDraw.value < cfg.battleCavalryReservePursuitDestroyedChance) {
          destroyed = true
          forcedDestroyedCause.set(enemy, 'cavalry_charge_pursuit')
          moraleEvents.push({
            side: enemySide,
            slotIndex: i,
            eventKind: 'friendly_destroyed',
          })
          moraleEvents.push({
            side: pursuerSide,
            slotIndex: i,
            eventKind: 'enemy_destroyed',
          })
        }
        tickEvents.push({
          kind: 'cavalry_pursuit',
          side: pursuerSide,
          cavalryRegimentId: cav.input.regimentId,
          targetRegimentId: enemy.input.regimentId,
          targetSlotIndex: i,
          destroyed,
        })
        if (destroyed) {
          tickEvents.push({
            kind: 'regiment_destroyed',
            side: enemySide,
            regimentId: enemy.input.regimentId,
            slotIndex: i,
            cause: 'cavalry_charge_pursuit',
          })
        }
      }
    }
    tryReserveCavalryPursuit(defLine, atkRes, 'attacker')
    tryReserveCavalryPursuit(atkLine, defRes, 'defender')

    // 4. morale rally / shock (§15: remove+fill の前。routed regiment がまだ slot にいるため隣接計算が可能)。
    {
      const rallyBySide: Record<WarSideKey, number> = { attacker: 0, defender: 0 }
      const shockBySide: Record<WarSideKey, number> = { attacker: 0, defender: 0 }
      for (const me of moraleEvents) {
        if (me.eventKind === 'enemy_retreat')
          rallyBySide[me.side] += cfg.battleMoraleRallyPerRetreat
        else if (me.eventKind === 'enemy_rout') rallyBySide[me.side] += cfg.battleMoraleRallyPerRout
        else if (me.eventKind === 'enemy_destroyed')
          rallyBySide[me.side] += cfg.battleMoraleRallyPerDestroyed
        else if (me.eventKind === 'friendly_retreat') {
          let v = cfg.battleMoraleShockPerRetreat
          if (me.screened) v *= cfg.battleCavalryScreenMoraleShockReduction
          shockBySide[me.side] += v
        } else if (me.eventKind === 'friendly_rout') {
          let v = cfg.battleMoraleShockPerRout
          if (me.screened) v *= cfg.battleCavalryScreenMoraleShockReduction
          shockBySide[me.side] += v
        } else if (me.eventKind === 'friendly_destroyed') {
          let v = cfg.battleMoraleShockPerDestroyed
          if (me.screened) v *= cfg.battleCavalryScreenMoraleShockReduction
          shockBySide[me.side] += v
        }
      }
      for (const side of ['attacker', 'defender'] as const) {
        const rally = Math.min(rallyBySide[side], cfg.battleMoraleRallyCapPerTick)
        const shock = Math.min(shockBySide[side], cfg.battleMoraleShockCapPerTick)
        if (rally === 0 && shock === 0) continue
        const line = side === 'attacker' ? atkLine : defLine
        const all = side === 'attacker' ? atkAll : defAll
        for (const w of all) {
          if (w.routed || w.retreated) continue
          const isOccupied = line.slots.includes(w)
          const ratio = isOccupied
            ? cfg.battleMoraleRallyFrontlineRatio
            : cfg.battleMoraleRallySideRatio
          const delta = rally * ratio - shock * ratio
          if (delta === 0) continue
          w.morale = clamp(w.morale + delta, 0, w.input.maxMorale)
        }
        if (Math.abs(rally - shock) >= cfg.battleMoraleShiftLogThreshold) {
          tickEvents.push({
            kind: 'morale_shift',
            side,
            rallyTotal: rally,
            shockTotal: shock,
          })
        }
      }
    }

    // 5. retreat / rout 連隊を slot から除去 (master には残る) → reserve から補充
    removeRoutedAndRetreatedFromSlots(atkLine, cfg)
    removeRoutedAndRetreatedFromSlots(defLine, cfg)
    fillLine(atkLine, atkRes)
    fillLine(defLine, defRes)

    // §15.3: この tick の BattleTickLog を記録 (events は Phase 6/7/9 で追加。Phase 5 は戦術 + slot 変化)。
    tickLogs.push({
      tick,
      attackerTactic: tactics.attackerTactic,
      defenderTactic: tactics.defenderTactic,
      ...(tactics.advantageSide !== undefined
        ? { tacticAdvantageSide: tactics.advantageSide }
        : {}),
      attackerSlotsBefore,
      defenderSlotsBefore,
      attackerSlotsAfter: snapshotSlots(atkLine),
      defenderSlotsAfter: snapshotSlots(defLine),
      events: tickEvents,
    })

    // 5. 終了判定 (§8.2)。fighting = 占有 slot 数 + reserve (どちらも org > retreat の健全連隊)。
    const atkFighting = occupiedCount(atkLine) + atkRes.length
    const defFighting = occupiedCount(defLine) + defRes.length
    if (atkFighting === 0 && defFighting === 0) {
      // 相討ち: 残存 org 合計 tiebreak (§8.2)
      const atkOrg = sumOrg(atkAll)
      const defOrg = sumOrg(defAll)
      if (Math.abs(atkOrg - defOrg) <= cfg.battleSimOrganizationTiebreakEpsilon) {
        result = 'inconclusive'
      } else {
        result = atkOrg > defOrg ? 'attacker_victory' : 'defender_victory'
      }
      break
    } else if (atkFighting === 0) {
      result = 'defender_victory'
      break
    } else if (defFighting === 0) {
      result = 'attacker_victory'
      break
    }
    // 双方 fighting あり → 続行 (maxTicks 到達なら §8.2 補足の org 合計マージン決着)
  }

  // §8.2 補足: maxTicks 到達 (双方 fighting 残存) の決着。残存 org 合計の相対差で優勢側を勝者にし、
  //   inconclusive 過多を避ける (規模の大きい/健全な側が勝つ)。差が margin 以下なら inconclusive。
  if (result === null) {
    const atkOrg = sumOrg(atkAll)
    const defOrg = sumOrg(defAll)
    const total = atkOrg + defOrg
    if (total <= 0) {
      result = 'inconclusive'
    } else {
      const margin = (atkOrg - defOrg) / total
      if (Math.abs(margin) <= cfg.battleMaxTicksDecisiveMarginRatio) {
        result = 'inconclusive'
      } else {
        result = margin > 0 ? 'attacker_victory' : 'defender_victory'
      }
    }
  }

  const finalResult: BattleResult = result
  const winnerSide: WarSideKey | null =
    finalResult === 'attacker_victory'
      ? 'attacker'
      : finalResult === 'defender_victory'
        ? 'defender'
        : null
  const loserSide: WarSideKey | null =
    winnerSide === 'attacker' ? 'defender' : winnerSide === 'defender' ? 'attacker' : null

  // routed IDs
  const attackerRoutedRegimentIds = atkAll.filter((w) => w.routed).map((w) => w.input.regimentId)
  const defenderRoutedRegimentIds = defAll.filter((w) => w.routed).map((w) => w.input.regimentId)

  // outcomeQuality (§11.2): 敗者側 routed share が閾値以上で rout
  let outcomeQuality: BattleOutcomeQuality = 'orderly_withdrawal'
  if (winnerSide && loserSide) {
    const loserRoutedCount = (
      loserSide === 'attacker' ? attackerRoutedRegimentIds : defenderRoutedRegimentIds
    ).length
    const loserInitialFrontlineCount =
      loserSide === 'attacker'
        ? attackerInitialFrontlineIds.length
        : defenderInitialFrontlineIds.length
    const loserRoutedShare = loserRoutedCount / Math.max(1, loserInitialFrontlineCount)
    if (loserRoutedShare >= cfg.routSideRoutedShareThreshold) {
      outcomeQuality = 'rout'
    }
  }

  // v0.49 §11: breakthroughSide は実 breakthrough が発生した side。両側発生時は attacker 優先 (Battle entity 表示用)。
  const breakthroughSide: WarSideKey | undefined = breakthroughBySide.attacker
    ? 'attacker'
    : breakthroughBySide.defender
      ? 'defender'
      : undefined

  // 終了後 strength damage (§9.4): 累積 org damage × role × outcomeQuality × powerDisadvantage。
  const outcomeStrMult =
    outcomeQuality === 'rout'
      ? cfg.battleStrengthOutcomeQualityMultiplierRout
      : cfg.battleStrengthOutcomeQualityMultiplierOrderly
  const atkSidePower = sumEffectivePower(input.attacker)
  const defSidePower = sumEffectivePower(input.defender)

  const regimentResults: BattleSimRegimentOutput[] = []
  for (const side of [atkAll, defAll]) {
    for (const w of side) {
      const isLoserSide = loserSide !== null && w.input.side === loserSide
      const isWinnerSide = winnerSide !== null && w.input.side === winnerSide
      const roleMult = w.routed
        ? cfg.routedStrengthDamageMultiplier
        : isLoserSide
          ? cfg.loserStrengthDamageMultiplier
          : isWinnerSide
            ? cfg.winnerStrengthDamageMultiplier
            : // inconclusive (draw): winner/loser いずれでもない → 中庸
              (cfg.winnerStrengthDamageMultiplier + cfg.loserStrengthDamageMultiplier) / 2
      // powerDisadvantage は敗者 side のみ (§9.4)。winner / draw は 1.0。
      let powerDisMult = cfg.battleStrengthPowerDisadvantageModifierMin
      if (isLoserSide) {
        const loserPower = w.input.side === 'attacker' ? atkSidePower : defSidePower
        const winnerPower = w.input.side === 'attacker' ? defSidePower : atkSidePower
        const ratio = loserPower / (winnerPower + 1)
        powerDisMult = clamp(
          cfg.battleStrengthPowerDisadvantageModifierMin +
            (cfg.battleStrengthPowerDisadvantageModifierMax -
              cfg.battleStrengthPowerDisadvantageModifierMin) *
              clamp(1 - ratio, 0, 1),
          cfg.battleStrengthPowerDisadvantageModifierMin,
          cfg.battleStrengthPowerDisadvantageModifierMax,
        )
      }
      const strDamage =
        w.accumulatedOrgDamage *
        cfg.battleStrengthDamageRatio *
        roleMult *
        outcomeStrMult *
        powerDisMult
      // v0.49 §14.2: 強制壊滅 (現状は追撃致死) と判定された連隊は終局式の outcome/powerDis 係数に依らず
      //   strengthAfter=0 を強制し、tick ログの destroyed と regimentResults を必ず一致させる。
      //   旧実装は accumulatedOrgDamage を「致死量」へ押し上げる間接式で、終局式が strength×product を
      //   引いた結果が浮動小数点誤差でわずかに正に残ると destroyedCause=undefined となり「tick ログは
      //   壊滅だが連隊は生存」する不整合があった (default config でも発火)。原因タグを単一の真実源にして解消。
      const strengthAfter = forcedDestroyedCause.has(w)
        ? 0
        : Math.max(0, w.input.strength - strDamage)
      // destroyed (strengthAfter===0) のみ原因タグを付す。強制壊滅は pursuit/breakthrough_pursuit、
      //   それ以外 (通常消耗 emergent) の壊滅は ordinary_attrition。
      const destroyedCause: BattleDestroyedCause | undefined =
        strengthAfter <= 0 ? (forcedDestroyedCause.get(w) ?? 'ordinary_attrition') : undefined
      regimentResults.push({
        regimentId: w.input.regimentId,
        side: w.input.side,
        strengthBefore: w.input.strength,
        strengthAfter,
        strengthDamage: w.input.strength - strengthAfter,
        organizationBefore: w.input.organization,
        organizationAfter: w.organization,
        organizationDamage: w.input.organization - w.organization,
        moraleBefore: w.input.morale,
        moraleAfter: w.morale,
        moraleDamage: w.input.morale - w.morale,
        wasInitialFrontline: w.wasInitialFrontline,
        routed: w.routed,
        ...(destroyedCause !== undefined ? { destroyedCause } : {}),
      })
    }
  }

  return {
    result: finalResult,
    outcomeQuality,
    ticksElapsed,
    attackerInitialFrontlineIds,
    defenderInitialFrontlineIds,
    attackerRoutedRegimentIds,
    defenderRoutedRegimentIds,
    ...(breakthroughSide !== undefined ? { breakthroughSide } : {}),
    pursuitOccurred,
    attackerCommanderAssignments,
    defenderCommanderAssignments,
    regimentResults,
    tickLogs,
    rng,
  }
}
