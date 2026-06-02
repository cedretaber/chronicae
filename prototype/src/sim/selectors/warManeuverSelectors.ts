import type { WorldState } from '@sim/types/world'
import type { War, WarSideKey, BattlefieldKind } from '@sim/types/war'
import type { PersonId, PolityId, ProvinceId } from '@sim/types/ids'
import type { Province, ProvinceTerrain } from '@sim/types/province'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { RngState, RngResult } from '@sim/rng/rng'
import { randomFloat } from '@sim/rng/rng'
import { getActiveOfficeHolders, getPolityLeader } from '@sim/selectors/officeSelectors'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import type { BattleSimCommanderInput } from '@sim/helpers/simulateBattle'

// v0.35 Phase A: 「誰が指揮するか / どの province で戦うか」の構造 selector。
//   pure / config 非依存 / sim 層 (i18n・app 非依存)。WarManeuverSystem (Phase B) が消費する。
//   captainGeneral / commander は soft reference のため、ここでは「現時点で適格な候補」を都度算出する
//   (毎週 lazy 再選出する前提。state に保存された ID の生存保証はしない)。

// --- eligibility ---

// 総大将 / 指揮官候補になれる人物の最小条件: 実在・生存・非 placeholder。
//   getActiveOfficeHolders は office.active のみで filter し死亡者を除外しないため、ここで明示する。
//   WarManeuverSystem の captainGeneral lazy refresh が「現 CG が据置可能か」判定に再利用する。
export function isEligibleWarPerson(state: WorldState, personId: PersonId): boolean {
  const p = state.persons[personId]
  return Boolean(p && p.alive && p.kind !== 'placeholder')
}

// v0.40 §9.3: commander / captain general 選定スコア。warCommand role score を base にし、
//   old_age は乗算でのみ不利化する（候補除外はしない＝指揮官不在を避ける）。config 省略時は無調整。
function warCommandSelectionScore(
  state: WorldState,
  personId: PersonId,
  config?: SimulationConfig,
): number {
  const base = getRoleScore(state, personId, 'warCommand')
  if (!config) return base
  const p = state.persons[personId]
  if (p && p.lifeStage === 'old_age') return base * config.oldAgeCommandScoreMultiplier
  return base
}

// warCommand 降順 → personId 昇順で安定ソートする (replay 決定性のための tie-break)。
//   config 指定時は old_age 乗算ペナルティを反映した選定スコアでソートする（§9.3）。
function sortByWarCommandThenId(
  state: WorldState,
  ids: PersonId[],
  config?: SimulationConfig,
): PersonId[] {
  return [...ids].sort((a, b) => {
    const scoreB = warCommandSelectionScore(state, b, config)
    const scoreA = warCommandSelectionScore(state, a, config)
    if (scoreB !== scoreA) return scoreB - scoreA // warCommand desc
    return a.localeCompare(b) // personId asc
  })
}

// --- selectors ---

// WarSide の primary participant が polity actor ならその PolityId を返す。
//   War は polity-polity 固定 (WarCreationSystem が strict polity-polity) なので実質常に解決する。
export function getWarSidePrimaryPolityActor(war: War, sideKey: WarSideKey): PolityId | undefined {
  const side = sideKey === 'attacker' ? war.attacker : war.defender
  const actor = side.participants.find((p) => p.primary)?.actor
  return actor?.kind === 'polity' ? actor.id : undefined
}

// その polity の総大将を選出する。
//   優先順: active military office holder (warCommand 最高) → polity leader → undefined。
//   leader は総大将としては除外しない (commander 候補とは異なり、総大将は leader 親征を許容する)。
export function selectCaptainGeneralForWarSide(
  state: WorldState,
  polityId: PolityId,
  config?: SimulationConfig,
): PersonId | undefined {
  const military = getActiveOfficeHolders(
    state,
    { kind: 'polity', id: polityId },
    'military',
  ).filter((id) => isEligibleWarPerson(state, id))
  if (military.length > 0) {
    return sortByWarCommandThenId(state, military, config)[0]
  }
  const leader = getPolityLeader(state, polityId)
  if (leader !== undefined && isEligibleWarPerson(state, leader)) return leader
  return undefined
}

// 指定人物が現場指揮官として適格か。
//   条件: 適格人物 (生存・非placeholder) かつ active military office holder。
//   leader 除外: polity leader は「総大将を兼ねる」場合を除き commander 候補にならない (§5.4)。
export function isEligibleBattleCommander(
  state: WorldState,
  polityId: PolityId,
  personId: PersonId,
  captainGeneralId: PersonId | undefined,
): boolean {
  if (!isEligibleWarPerson(state, personId)) return false
  const military = getActiveOfficeHolders(state, { kind: 'polity', id: polityId }, 'military')
  if (!military.includes(personId)) return false
  const leader = getPolityLeader(state, polityId)
  if (leader !== undefined && personId === leader) {
    // leader は captainGeneral を兼ねる時のみ commander 候補に残る。
    if (captainGeneralId === undefined || personId !== captainGeneralId) return false
  }
  return true
}

// その polity の現場指揮官候補リストを構築する (leader 除外 + 重複排除 + warCommand desc / personId asc)。
export function buildWarSideCommanderCandidates(
  state: WorldState,
  polityId: PolityId,
  captainGeneralId: PersonId | undefined,
  config?: SimulationConfig,
): PersonId[] {
  const military = getActiveOfficeHolders(state, { kind: 'polity', id: polityId }, 'military')
  const eligible = military.filter((id) =>
    isEligibleBattleCommander(state, polityId, id, captainGeneralId),
  )
  const deduped = [...new Set(eligible)]
  return sortByWarCommandThenId(state, deduped, config)
}

// §13.2/§13.3: commander pool (PersonId[]) を BattleSimCommanderInput[] に変換する。
//   fieldCommandScore = warCommand role score (§13.2、既存式を再利用)。
//   breakthroughScore = command*0.5 + valor*0.4 + insight*0.1 (§13.3、突撃適性は valor 寄り)。
//   不在人物は除外 (refreshCommanders で eligible 済だが防御的に skip)。順序は入力 (warCommand desc) を保つ。
export function buildBattleSimCommanderInputs(
  state: WorldState,
  commanderPersonIds: readonly PersonId[],
): BattleSimCommanderInput[] {
  const out: BattleSimCommanderInput[] = []
  for (const id of commanderPersonIds) {
    const p = state.persons[id]
    if (!p) continue
    const a = p.abilities
    out.push({
      personId: id,
      fieldCommandScore: getRoleScore(state, id, 'warCommand'),
      breakthroughScore: a.command * 0.5 + a.valor * 0.4 + a.insight * 0.1,
    })
  }
  return out
}

// War の係争 province を warGoals[0] から解決する。未解決 (goal / holding 不在) は undefined。
export function getWarGoalProvince(state: WorldState, war: War): ProvinceId | undefined {
  const goal = war.warGoals[0]
  if (!goal) return undefined
  if (goal.kind === 'popular_revolt_independence') {
    // 叛乱 WarGoal は holdingIds[] を持つ。先頭の holding から province を解決する。
    const firstHoldingId = goal.holdingIds[0]
    if (!firstHoldingId) return undefined
    return state.holdings[firstHoldingId]?.provinceId
  }
  return state.holdings[goal.holdingId]?.provinceId
}

// --- battlefield 生成 (§6.3 / §6.4) ---

// terrain → base BattlefieldKind の素マッピング。
const TERRAIN_TO_BATTLEFIELD: Record<ProvinceTerrain, BattlefieldKind> = {
  plains: 'open_field',
  forest: 'forest_battle',
  hills: 'hill_battle',
  mountains: 'mountain_pass',
  wetlands: 'wetland_battle',
}

// 毎週 active War ごとに Candidate Battlefield を 1 つ生成する (§6.3)。
//   base = terrain マッピング。feature による特殊化は固定優先順 (major_river → coastal)、
//   先に roll 成功した方を採用し、両 miss / feature 無しは base terrain。
//   lake は v0.35 では無効、siege は生成しない、off-terrain 低確率分岐は非採用。
//   rng は feature 有無に応じ 0〜2 draw（state 依存なので deterministic replay を満たす）。
export function generateCandidateBattlefield(
  province: Province,
  rng: RngState,
  config: SimulationConfig,
): RngResult<BattlefieldKind> {
  let currentRng = rng
  if (province.features.includes('major_river')) {
    const { value, rng: nextRng } = randomFloat(currentRng)
    currentRng = nextRng
    if (value < config.warBattlefieldRiverCrossingChance) {
      return { value: 'river_crossing', rng: currentRng }
    }
  }
  if (province.features.includes('coastal')) {
    const { value, rng: nextRng } = randomFloat(currentRng)
    currentRng = nextRng
    if (value < config.warBattlefieldCoastalBattleChance) {
      return { value: 'coastal_battle', rng: currentRng }
    }
  }
  return { value: TERRAIN_TO_BATTLEFIELD[province.terrain], rng: currentRng }
}
