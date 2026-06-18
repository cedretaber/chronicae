import type { WorldState } from '@sim/types/world'
import type { War, WarSideKey, BattlefieldKind } from '@sim/types/war'
import type { PersonId, PolityId, ProvinceId } from '@sim/types/ids'
import type { Province, ProvinceTerrain } from '@sim/types/province'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { RngState, RngResult } from '@sim/rng/rng'
import { randomFloat } from '@sim/rng/rng'
import { getActiveOfficeHolders, getPolityLeader } from '@sim/selectors/officeSelectors'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { getPersonReputationModifierForCategories } from './personReputationSelectors'
import { getPolityPersonIds } from '@sim/selectors/polityRelations'
import { getFactionActiveMemberIds } from '@sim/selectors/factionSelectors'
import { isLifeStageAtLeast, isLivingPerson } from '@sim/types/person'
import { isRoleEligibleBySex } from '@sim/selectors/roleEligibilitySelectors'
import type {
  BattleSimCommanderInput,
  BattleSimCaptainGeneralInput,
} from '@sim/helpers/simulateBattle'

// v0.35 Phase A: 「誰が指揮するか / どの province で戦うか」の構造 selector。
//   pure / config 非依存 / sim 層 (i18n・app 非依存)。WarManeuverSystem (Phase B) が消費する。
//   captainGeneral / commander は soft reference のため、ここでは「現時点で適格な候補」を都度算出する
//   (毎週 lazy 再選出する前提。state に保存された ID の生存保証はしない)。

// --- eligibility ---

// 総大将 / 指揮官候補になれる人物の最小条件: 実在・生存・非 placeholder。
//   getActiveOfficeHolders は office.active のみで filter し死亡者を除外しないため、ここで明示する。
//   WarManeuverSystem の captainGeneral lazy refresh が「現 CG が据置可能か」判定に再利用する。
export function isEligibleWarPerson(state: WorldState, personId: PersonId): boolean {
  return isLivingPerson(state.persons[personId])
}

// v0.40 §9.3: commander / captain general 選定スコア。warCommand role score を base にし、
//   old_age は乗算でのみ不利化する（候補除外はしない＝指揮官不在を避ける）。config 省略時は無調整。
function warCommandSelectionScore(
  state: WorldState,
  personId: PersonId,
  config?: SimulationConfig,
): number {
  let base = getRoleScore(state, personId, 'warCommand')
  if (!config) return base
  // v0.44 §9.4: military 評判の指揮官選定補正 (raw ±cap × warCommandReputationScoreFactor =
  //   実効 ±15)。効くのは commanderPersonIds ランキング。captain general は役職優先順選定の
  //   ため原則対象外 (仕様どおり)。
  base +=
    getPersonReputationModifierForCategories(state, config, personId, ['military']) *
    config.warCommandReputationScoreFactor
  const p = state.persons[personId]
  if (p && p.lifeStage === 'old_age') return base * config.oldAgeCommandScoreMultiplier
  return base
}

// warCommand 降順 → personId 昇順で安定ソートする (replay 決定性のための tie-break)。
//   config 指定時は old_age 乗算ペナルティを反映した選定スコアでソートする（§9.3）。
//   スコアは事前計算する (候補プールが在野人材まで広がり数百人になりうるため、
//   comparator 内での再計算を避ける Schwartzian transform)。
function sortByWarCommandThenId(
  state: WorldState,
  ids: PersonId[],
  config?: SimulationConfig,
): PersonId[] {
  const scores = new Map<string, number>()
  for (const id of ids) scores.set(id, warCommandSelectionScore(state, id, config))
  return [...ids].sort((a, b) => {
    const diff = (scores.get(b) ?? 0) - (scores.get(a) ?? 0)
    if (diff !== 0) return diff // warCommand desc
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

// WarSide の全 polity participant (primary + supporters) の PolityId を participants 配列順で返す。
//   v0.43 追補: 指揮官候補を supporter 含む全 polity から選出するための列挙。
//   participants は primary 先頭 + supporter 追加順 (createWar の構築順) で決定的。
export function getWarSidePolityActors(war: War, sideKey: WarSideKey): PolityId[] {
  const side = sideKey === 'attacker' ? war.attacker : war.defender
  const out: PolityId[] = []
  for (const p of side.participants) {
    if (p.actor.kind === 'polity') out.push(p.actor.id)
  }
  return out
}

// その polity の総大将を選出する。
//   優先順: active military office holder (warCommand 最高) → polity leader → undefined。
//   leader は総大将としては除外しない (commander 候補とは異なり、総大将は leader 親征を許容する)。
//   v0.45.2: exclude (両陣営 CG 重複の解消で反対 side が確保した人物) は military 候補・
//   leader fallback の両方から除外する。
//   v0.45.3: 性別役職適格ゲートは military 経路のみに適用する。leader fallback はゲート
//   しない (女王の親征を許容)。military が gate で空になっても leader fallback が逃げ道に
//   なるため ungated 再試行は不要。
export function selectCaptainGeneralForWarSide(
  state: WorldState,
  polityId: PolityId,
  config?: SimulationConfig,
  exclude?: ReadonlySet<string>,
): PersonId | undefined {
  const military = getActiveOfficeHolders(state, { kind: 'polity', id: polityId }, 'military')
    .filter((id) => !exclude?.has(id))
    .filter((id) => isEligibleWarPerson(state, id))
    .filter((id) => !config || isRoleEligibleBySex(state, config, id))
  if (military.length > 0) {
    return sortByWarCommandThenId(state, military, config)[0]
  }
  const leader = getPolityLeader(state, polityId)
  if (leader !== undefined && !exclude?.has(leader) && isEligibleWarPerson(state, leader)) {
    return leader
  }
  return undefined
}

// 指定人物が現場指揮官として適格か (人物そのものの条件のみ)。
//   条件: 生存・非 placeholder・成人 (young_adulthood 以上 — project 候補 §12.4 と同基準)。
//   v0.43 追補: military office 保有は要件から外れた (在野の House メンバー・派閥食客も候補)。
//   leader 除外は buildWarSideCommanderCandidates 側で participant 全 polity の leader 集合に
//   対して行う (広いプールでは「支援国 leader が primary の House 経由で混入」がありうるため)。
export function isEligibleBattleCommander(state: WorldState, personId: PersonId): boolean {
  if (!isEligibleWarPerson(state, personId)) return false
  const person = state.persons[personId]
  if (!person || !isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) return false
  return true
}

// polity の「宮廷人材プール」: military office holder + polity 関係 House の生存メンバー
//   (getPolityPersonIds) + anchor 派閥のメンバー (客分・食客 — supervisor 候補 §12.4 と同じ
//   考え方で、派閥が介入できるのは anchor Polity のみ)。
//   列挙は決定的: office 順 → getPolityPersonIds (sorted) → FactionId 昇順 × member 順。
export function getPolityWarCandidatePersonIds(state: WorldState, polityId: PolityId): PersonId[] {
  const out: PersonId[] = []
  const seen = new Set<string>()
  const push = (id: PersonId): void => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  for (const id of getActiveOfficeHolders(state, { kind: 'polity', id: polityId }, 'military')) {
    push(id)
  }
  for (const id of getPolityPersonIds(state, polityId)) push(id)
  for (const fid of [...(state.factionIndex.byPolity[polityId] ?? [])].sort()) {
    const faction = state.factions[fid]
    if (!faction || !faction.active) continue
    for (const id of getFactionActiveMemberIds(state, fid)) push(id)
  }
  return out
}

// side の全 polity participant から現場指揮官候補リスト (uncapped・ソート済) を構築する。
//   v0.43 追補: 候補は military office holder に限らず宮廷人材プール全体から warCommand 順に
//   選ぶ (役職優遇なし。総大将経路は従来どおり military 限定なので役職の意味はそちらに残る)。
//   leader 除外: participant いずれかの polity の leader は CG を兼ねる場合を除き候補外 (§5.4)。
//   cap と両陣営重複 (両属) の除外は finalizeWarCommanderCandidates の責務 — 両 side の
//   フル候補が揃ってからでないと正しく適用できないため。
export function buildWarSideCommanderCandidates(
  state: WorldState,
  polityIds: readonly PolityId[],
  captainGeneralId: PersonId | undefined,
  config?: SimulationConfig,
): PersonId[] {
  const leaderIds = new Set<string>()
  for (const polityId of polityIds) {
    const leader = getPolityLeader(state, polityId)
    if (leader !== undefined) leaderIds.add(leader)
  }
  const eligible: PersonId[] = []
  const seen = new Set<string>()
  for (const polityId of polityIds) {
    for (const id of getPolityWarCandidatePersonIds(state, polityId)) {
      if (seen.has(id)) continue
      seen.add(id)
      if (!isEligibleBattleCommander(state, id)) continue
      // v0.45.3 性別役職適格ゲート。指揮官は任意役割 (CG が常在) のため ungated 再試行なし。
      if (config && !isRoleEligibleBySex(state, config, id)) continue
      // leader は captainGeneral を兼ねる時のみ候補に残る。
      if (leaderIds.has(id) && (captainGeneralId === undefined || id !== captainGeneralId)) {
        continue
      }
      eligible.push(id)
    }
  }
  return sortByWarCommandThenId(state, eligible, config)
}

// 両陣営のフル候補から両属人物 (両 side の候補に同時に現れる人物) を双方から除外し、
//   各 side を warCommand 上位 cap 名に切り詰める。両属は派閥食客が他国出身者を含むため
//   理論上起こりうる (忠誠の板挟みでどちらの陣営でも指揮を執らない、という表現)。
//   除外 → cap の順 (cap 後に除外すると「片側では cap 外」の両属を取りこぼす)。
export function finalizeWarCommanderCandidates(
  attackerCandidates: readonly PersonId[],
  defenderCandidates: readonly PersonId[],
  cap: number,
): { attacker: PersonId[]; defender: PersonId[] } {
  const atkSet = new Set<string>(attackerCandidates)
  const dup = new Set<string>()
  for (const id of defenderCandidates) {
    if (atkSet.has(id)) dup.add(id)
  }
  return {
    attacker: attackerCandidates.filter((id) => !dup.has(id)).slice(0, cap),
    defender: defenderCandidates.filter((id) => !dup.has(id)).slice(0, cap),
  }
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
      // v0.49 §10.3: 追撃適性は command + insight 主・valor 補助。
      pursuitScore: a.command * 0.5 + a.insight * 0.35 + a.valor * 0.15,
      command: a.command,
      insight: a.insight,
      valor: a.valor,
    })
  }
  return out
}

// v0.49 §10.3: 総大将 (captain general) person を BattleSimCaptainGeneralInput に変換する。
//   warCommand role score + 生能力 (insight/command/valor) + traits (ambition/caution)。不在は undefined。
export function buildBattleSimCaptainGeneralInput(
  state: WorldState,
  personId: PersonId | undefined,
): BattleSimCaptainGeneralInput | undefined {
  if (personId === undefined) return undefined
  const p = state.persons[personId]
  if (!p) return undefined
  const a = p.abilities
  return {
    personId,
    warCommand: getRoleScore(state, personId, 'warCommand'),
    command: a.command,
    insight: a.insight,
    valor: a.valor,
    ambition: p.traits.ambition,
    caution: p.traits.caution,
  }
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
