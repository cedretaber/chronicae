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
import type { SimulationConfig } from '../config/defaultConfig'
import type { RngState } from '../rng/rng'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'

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

// side ごと commander 候補プール (WarManeuver が getRoleScore 等で数値化して渡す)。B2a では未使用。
export type BattleSimCommanderInput = {
  personId: PersonId
  fieldCommandScore: number
  breakthroughScore: number
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
  | 'flankPressureBase'
  | 'maxFlankPressureMultiplier'
  | 'commanderAssignedRegimentEffectMax'
  | 'commanderAdjacentRegimentEffectRatio'
  | 'captainGeneralBattleOrganizationDamageEffectMax'
  | 'captainGeneralRoutResistanceEffectMax'
  | 'routSideRoutedShareThreshold'
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
  attackerCaptainGeneralWarCommand?: number
  defenderCaptainGeneralWarCommand?: number
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
  pursuitOccurred: false
  attackerCommanderAssignments: BattleCommanderAssignment[]
  defenderCommanderAssignments: BattleCommanderAssignment[]
  regimentResults: BattleSimRegimentOutput[]
  rng: RngState
}

// --- 内部 work 構造 ---

type WorkRegiment = {
  readonly input: BattleSimRegimentInput
  organization: number // mutable (tick 中に削れる)
  morale: number // mutable
  accumulatedOrgDamage: number // この battle で受けた org damage の累積 (§9.4 strength 用)
  wasInitialFrontline: boolean
  routed: boolean
  commanderQ: number // §13.5 指揮官 quality bonus (signed, ∈[-effectMax, effectMax]、隣接は ratio 倍。default 0)
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
function cgDamageReduction(warCommand: number | undefined, cfg: BattleSimConfigSlice): number {
  if (warCommand === undefined) return 0
  return clamp((warCommand - 50) / 50, 0, 1) * cfg.captainGeneralBattleOrganizationDamageEffectMax
}

// §14 captainGeneral の rout 耐性 (side-level, [0, captainGeneralRoutResistanceEffectMax])。benefit 方向のみ。
function cgRoutResistance(warCommand: number | undefined, cfg: BattleSimConfigSlice): number {
  if (warCommand === undefined) return 0
  return clamp((warCommand - 50) / 50, 0, 1) * cfg.captainGeneralRoutResistanceEffectMax
}

// frontline index を中央寄り優先順に並べる (center-out)。例 n=5 → [2,1,3,0,4]。tie は低 index 優先 (deterministic)。
function centerOutOrder(n: number): number[] {
  const center = Math.floor((n - 1) / 2)
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const da = Math.abs(a - center)
    const db = Math.abs(b - center)
    if (da !== db) return da - db
    return a - b
  })
}

// §13.4 指揮官割当 (deploy 後・draw 無し)。pool から target regiment に greedy 割当し、
//   各 WorkRegiment.commanderQ を設定して BattleCommanderAssignment[] を返す。
//   target 優先順: frontline infantry(center-out) → frontline cavalry(center-out) → reserve cavalry → reserve infantry。
//   infantry target は fieldCommandScore 最大、cavalry target は breakthroughScore 最大を選ぶ (§13.4 step4)。tie personId asc。
//   隣接 frontline 連隊 (自身に割当が無いもの) は、隣の assigned 正 q × ratio を最大で受ける。
function assignCommanders(
  frontline: WorkRegiment[],
  reserve: WorkRegiment[],
  pool: BattleSimCommanderInput[],
  cfg: BattleSimConfigSlice,
): BattleCommanderAssignment[] {
  if (pool.length === 0) return []
  const remaining = [...pool]

  const order = centerOutOrder(frontline.length)
  const flOrdered = order.map((i) => frontline[i]!)
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
    const q = commanderQualityBonus(cmd.fieldCommandScore, cfg)
    tgt.commanderQ = q
    assignedQ.set(tgt.input.regimentId, q)
    assignments.push({ commanderPersonId: cmd.personId, regimentId: tgt.input.regimentId })
  }

  // 隣接 bonus: 割当を持たない frontline 連隊が、隣接 assigned 連隊の正 q × ratio を受ける (最大採用)。
  for (let i = 0; i < frontline.length; i++) {
    const w = frontline[i]!
    if (assignedQ.has(w.input.regimentId)) continue
    let best = 0
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= frontline.length) continue
      const nq = assignedQ.get(frontline[j]!.input.regimentId)
      if (nq !== undefined && nq > 0)
        best = Math.max(best, nq * cfg.commanderAdjacentRegimentEffectRatio)
    }
    w.commanderQ = best
  }
  return assignments
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
function deploy(
  side: WorkRegiment[],
  frontage: number,
  cfg: BattleSimConfigSlice,
): { frontline: WorkRegiment[]; reserve: WorkRegiment[] } {
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
  const frontline = ordered.slice(0, frontage)
  const reserve = ordered.slice(frontage).sort(byPowerDescThenId)
  return { frontline, reserve }
}

// 両端 (wing) の regimentId。length 1 ならその 1 つ。
function wingIds(front: WorkRegiment[]): Set<RegimentId> {
  const ids = new Set<RegimentId>()
  if (front.length === 0) return ids
  ids.add(front[0]!.input.regimentId)
  ids.add(front[front.length - 1]!.input.regimentId)
  return ids
}

// 1 方向の organization damage (§9.2)。commander/cg modifier は draw 後に乗算 (draw 数・順序不変)。
//   §13.5: 攻撃側 src の commander quality で与 damage 増 (1+qSrc)、防御側 tgt の commander で被 damage 減 (1-qTgt)。
//   §14: tgt side の captainGeneral が被 org damage を軽減 (1 - cgDmgReductionBySide[tgt.side])。
function computeOrgDamage(
  src: WorkRegiment,
  tgt: WorkRegiment,
  tgtFlankIds: Set<RegimentId>,
  flankMult: number,
  input: BattleSimInput,
  cfg: BattleSimConfigSlice,
  cgDmgReductionBySide: Record<WarSideKey, number>,
  rng: RngState,
): { dmg: number; rng: RngState } {
  const pairPower = clamp(src.input.effectivePower / (tgt.input.effectivePower + 1), 0.75, 1.35)
  const terrainMult =
    cfg.battleTerrainOrganizationDamageMultiplierByKind[input.battlefieldKind] ?? 1
  const flank = tgtFlankIds.has(tgt.input.regimentId) ? flankMult : 1
  const { value, rng: nextRng } = randomFloat(rng)
  const randomFactor =
    cfg.battleRandomFactorMin + value * (cfg.battleRandomFactorMax - cfg.battleRandomFactorMin)
  const commanderMult = (1 + src.commanderQ) * (1 - tgt.commanderQ)
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

// §11.1 retreat/rout 判定。frontline の生存者 (org > retreatThreshold かつ not routed) を返す。
//   routed は flag を立て追加 morale damage (§9.3)。retreat は frontline から外すのみ (flag なし)。
//   §13.5/§14: commander quality (正のみ) と side の captainGeneral rout 耐性で effRoute を下げ rout しにくくする。
function classifyFrontline(
  front: WorkRegiment[],
  cfg: BattleSimConfigSlice,
  cgRoutResist: number,
): WorkRegiment[] {
  const survivors: WorkRegiment[] = []
  for (const w of front) {
    const routResist = clamp(Math.max(0, w.commanderQ) + cgRoutResist, 0, 0.9)
    const effRoute =
      (cfg.routeOrganizationThreshold +
        Math.max(0, w.input.baselineMorale - w.morale) * cfg.moraleRouteThresholdFactor) *
      (1 - routResist)
    if (w.organization <= effRoute) {
      w.routed = true
      w.morale = clamp(w.morale - cfg.routAdditionalMoraleDamage, 0, w.input.maxMorale)
    } else if (w.organization <= cfg.retreatOrganizationThreshold) {
      // retreat: frontline から離脱 (routed ではない)。当該 battle では戦闘不能。
    } else {
      survivors.push(w)
    }
  }
  return survivors
}

// 欠員 frontline slot を reserve (power 順) から補充。
function fillFrontline(front: WorkRegiment[], reserve: WorkRegiment[], frontage: number): void {
  while (front.length < frontage && reserve.length > 0) {
    front.push(reserve.shift()!)
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

  // 初期 deployment
  const atkDeploy = deploy(atkAll, input.frontage, cfg)
  const defDeploy = deploy(defAll, input.frontage, cfg)
  for (const w of atkDeploy.frontline) w.wasInitialFrontline = true
  for (const w of defDeploy.frontline) w.wasInitialFrontline = true
  const attackerInitialFrontlineIds = atkDeploy.frontline.map((w) => w.input.regimentId)
  const defenderInitialFrontlineIds = defDeploy.frontline.map((w) => w.input.regimentId)

  let atkFront = atkDeploy.frontline
  const atkRes = atkDeploy.reserve
  let defFront = defDeploy.frontline
  const defRes = defDeploy.reserve

  // §13.4: deployment 確定後に指揮官割当 (draw 無し)。WorkRegiment.commanderQ を設定し assignment snapshot を得る。
  const attackerCommanderAssignments = assignCommanders(
    atkFront,
    atkRes,
    input.attackerCommanders,
    cfg,
  )
  const defenderCommanderAssignments = assignCommanders(
    defFront,
    defRes,
    input.defenderCommanders,
    cfg,
  )

  // §14: captainGeneral side-level 補正 (CG 未供給 side は 0 = 無効)。
  const cgDmgReductionBySide: Record<WarSideKey, number> = {
    attacker: cgDamageReduction(input.attackerCaptainGeneralWarCommand, cfg),
    defender: cgDamageReduction(input.defenderCaptainGeneralWarCommand, cfg),
  }
  const cgRoutResistBySide: Record<WarSideKey, number> = {
    attacker: cgRoutResistance(input.attackerCaptainGeneralWarCommand, cfg),
    defender: cgRoutResistance(input.defenderCaptainGeneralWarCommand, cfg),
  }

  let ticksElapsed = 0
  let result: BattleResult | null = null

  for (let tick = 1; tick <= input.maxTicks; tick++) {
    ticksElapsed = tick

    // 1. flank pressure: 短い側 wing に multiplier (§10.2)
    const terrainFlank = cfg.battleFlankTerrainMultiplierByKind[input.battlefieldKind] ?? 1
    const flankMult = clamp(
      1 + cfg.flankPressureBase * terrainFlank,
      1,
      cfg.maxFlankPressureMultiplier,
    )
    let atkWing = new Set<RegimentId>()
    let defWing = new Set<RegimentId>()
    if (atkFront.length > defFront.length && defFront.length > 0) {
      defWing = wingIds(defFront)
    } else if (defFront.length > atkFront.length && atkFront.length > 0) {
      atkWing = wingIds(atkFront)
    }

    // 2. 双方向 organization damage (matchup pair, §9.2)。draw 順 = index asc → atk damage → def damage。
    const n = Math.min(atkFront.length, defFront.length)
    for (let i = 0; i < n; i++) {
      const A = atkFront[i]!
      const D = defFront[i]!
      const toD = computeOrgDamage(A, D, defWing, flankMult, input, cfg, cgDmgReductionBySide, rng)
      rng = toD.rng
      const toA = computeOrgDamage(D, A, atkWing, flankMult, input, cfg, cgDmgReductionBySide, rng)
      rng = toA.rng
      applyOrgAndMorale(D, toD.dmg, cfg)
      applyOrgAndMorale(A, toA.dmg, cfg)
    }

    // 3. retreat / rout 判定 → frontline 生存者のみ残す
    atkFront = classifyFrontline(atkFront, cfg, cgRoutResistBySide.attacker)
    defFront = classifyFrontline(defFront, cfg, cgRoutResistBySide.defender)

    // 4. reserve から frontline 補充
    fillFrontline(atkFront, atkRes, input.frontage)
    fillFrontline(defFront, defRes, input.frontage)

    // 5. 終了判定 (§8.2)。fighting = frontline + reserve (どちらも org > retreat の健全連隊)。
    const atkFighting = atkFront.length + atkRes.length
    const defFighting = defFront.length + defRes.length
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

  // breakthroughSide (§12.1): cosmetic flag。勝者に cavalry reserve 残存 + 敗者に routed + 地形条件。
  let breakthroughSide: WarSideKey | undefined
  if (winnerSide && loserSide) {
    const winnerReserve = winnerSide === 'attacker' ? atkRes : defRes
    const winnerHasCavReserve = winnerReserve.some((w) => w.input.troopKind === 'cavalry')
    const loserRoutedCount = (
      loserSide === 'attacker' ? attackerRoutedRegimentIds : defenderRoutedRegimentIds
    ).length
    if (
      winnerHasCavReserve &&
      loserRoutedCount > 0 &&
      BREAKTHROUGH_KINDS.has(input.battlefieldKind)
    ) {
      breakthroughSide = winnerSide
    }
  }

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
      const strengthAfter = Math.max(0, w.input.strength - strDamage)
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
    pursuitOccurred: false,
    attackerCommanderAssignments,
    defenderCommanderAssignments,
    regimentResults,
    rng,
  }
}
