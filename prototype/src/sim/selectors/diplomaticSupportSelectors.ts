// v0.43 §8-9: DiplomaticPlay supporter の候補選定と joinScore。
//
// 決定論規約 (§8.2):
//   - 候補列挙は Object.keys().sort() による PolityId 昇順
//   - score 同点時も PolityId 昇順で tie-break
//   - RNG 不使用 (selectBestSupportCandidate は純関数)
//
// 正規化規約 (§9.1): 各項は必ず 0..100 / -100..100 に正規化してから weight を掛ける。
// raw military power / raw treasury を直接 weight に掛けない。

import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, ProvinceId } from '../types/ids'
import type { DiplomaticPlay, DiplomaticPlaySideKey } from '../types/diplomaticPlay'
import type { OrganizationRef } from '../types/office'
import { organizationKey } from './organizationSelectors'
import { politiesShareOwnerHouse } from './polityRelations'
import { estimateWarSidePower } from './warEstimateSelectors'
import { getPolityTerminalProvinceIds } from './landContractSelectors'
import {
  getPolityInfluenceBreakdown,
  getWeightedOpinionFromInfluenceBreakdown,
} from './influenceSelectors'
import { clamp } from '../utils/math'

// --- 内部定数 (観察調整が必要になったら config 化する) ---

// treasuryScore: この額で 100 点 (線形)。
const TREASURY_FULL_SCORE = 1000
// lastWarPenalty: 終戦からこの週数で penalty 0 まで線形減衰 (taxRevisionSystem の 96 週慣習)。
const LAST_WAR_PENALTY_DECAY_WEEKS = 96
// militarySparePowerScore: 敵 primary と同等戦力 (ratio 1.0) で 50 点。
const SPARE_POWER_RATIO_SCALE = 50
// threatContainmentScore: 敵 primary が自分の 2 倍 (ratio 2.0) で base 50 点。
const THREAT_RATIO_SCALE = 50
// v0.47.2 説得ボーナスの能力配合: 魅力 (弁舌・好感) 主軸 + 洞察 (相手の利害を読む)。
//   learning は task 前進ゲート側に分離済 (taskSelectors)。観察調整が要れば config 化する。
const PERSUASION_WEIGHT_CHARISMA = 0.7
const PERSUASION_WEIGHT_INSIGHT = 0.3

// --- joinScore の内訳 (DEBUG ログ / テスト用) ---

export type JoinScoreBreakdown = {
  total: number
  politicalOpinion: number
  proximity: number
  militarySparePower: number
  treasury: number
  threatContainment: number
  lastWarPenalty: number
  // v0.47.2: 募集側 delegate の説得力による candidate 非依存の底上げ (0..supportPersuasionScale)。
  persuasion: number
  // v0.47.2: 反乱軍 (rebel side) 募集時のみ。landed candidate は負 (肩入れ忌避) / 同志の叛乱国家は正。
  rebelBacking: number
}

// polity の LandContract chain を上向きに辿り、直接・間接の宗主 polity 集合を返す。
//   walk 順は結果 (Set) に影響しない。循環は visited で防御。
export function getPolityOverlordPolityIds(state: WorldState, polityId: PolityId): Set<string> {
  const result = new Set<string>()
  const visited = new Set<string>([polityId])
  const queue: PolityId[] = [polityId]
  while (queue.length > 0) {
    const current = queue.pop()!
    for (const cid of state.landContractIndex.byGranteePolity[current] ?? []) {
      const contract = state.landContracts[cid]
      if (!contract || contract.parentContractId === undefined) continue
      const parent = state.landContracts[contract.parentContractId]
      if (!parent) continue
      const grantorId = parent.granteePolityId
      if (visited.has(grantorId)) continue
      visited.add(grantorId)
      result.add(grantorId)
      queue.push(grantorId)
    }
  }
  return result
}

// 双方向の宗主-臣下 chain 関係にあるか。
function hasSuzerainVassalRelation(
  candidateOverlords: Set<string>,
  primaryOverlords: Set<string>,
  candidateId: PolityId,
  primaryId: PolityId,
): boolean {
  return candidateOverlords.has(primaryId) || primaryOverlords.has(candidateId)
}

// --- 争点 Province (§9.8 の proximity target) ---

export function getPlayIssueProvinceIds(state: WorldState, play: DiplomaticPlay): ProvinceId[] {
  if (play.issue?.kind === 'land_claim') return [play.issue.provinceId]
  if (play.issue?.kind === 'contract_tax_revision') {
    const provinceId = state.holdings[play.issue.holdingId]?.provinceId
    return provinceId ? [provinceId] : []
  }
  if (play.kind === 'revolt_negotiation' && play.initiator.kind === 'polity') {
    // 叛乱 commonwealth: origin holdings の Province が争点。
    const commonwealth = state.polities[play.initiator.id]
    if (commonwealth?.origin?.kind === 'popular_revolt') {
      const seen = new Set<string>()
      const result: ProvinceId[] = []
      for (const holdingId of commonwealth.origin.holdingIds) {
        const provinceId = state.holdings[holdingId]?.provinceId
        if (!provinceId || seen.has(provinceId)) continue
        seen.add(provinceId)
        result.push(provinceId)
      }
      if (result.length > 0) return result
    }
    return getPolityTerminalProvinceIds(state, play.initiator.id)
  }
  return []
}

// --- 個別 score 関数 (§9.8-9.12、各 0..100) ---

// §9.8: 隣接 terminal 支配 = 100 / 同 State 内に terminal = 50 / それ以外 0。
export function computeProximityScore(
  state: WorldState,
  issueProvinceIds: ProvinceId[],
  candidateId: PolityId,
): number {
  if (issueProvinceIds.length === 0) return 0
  const candidateProvinces = getPolityTerminalProvinceIds(state, candidateId)
  if (candidateProvinces.length === 0) return 0
  const candidateSet = new Set(candidateProvinces.map((p) => p as string))

  const issueStateIds = new Set<string>()
  for (const issueId of issueProvinceIds) {
    const issueProvince = state.provinces[issueId]
    if (!issueProvince) continue
    issueStateIds.add(issueProvince.stateId)
    for (const neighborId of issueProvince.neighbors) {
      if (candidateSet.has(neighborId)) return 100
    }
  }
  for (const pid of candidateProvinces) {
    const province = state.provinces[pid]
    if (province && issueStateIds.has(province.stateId)) return 50
  }
  return 0
}

// §9.9: candidate の動員可能戦力を敵 primary との比で 0..100 に正規化。
//   ratio 1.0 (同等) = 50 / ratio >= 2.0 = 100。敵戦力 0 なら candidate が戦力を持てば 100。
export function computeMilitarySparePowerScore(
  state: WorldState,
  config: SimulationConfig,
  candidateId: PolityId,
  enemyPrimary: OrganizationRef,
): number {
  const candidatePower = estimateWarSidePower(state, config, { kind: 'polity', id: candidateId })
  if (candidatePower <= 0) return 0
  const enemyPower = estimateWarSidePower(state, config, enemyPrimary)
  if (enemyPower <= 0) return 100
  return clamp((candidatePower / enemyPower) * SPARE_POWER_RATIO_SCALE, 0, 100)
}

// §9.10: treasury の 0..100 正規化 (TREASURY_FULL_SCORE で 100)。
export function computeTreasuryScore(state: WorldState, candidateId: PolityId): number {
  const treasury = state.polities[candidateId]?.treasury ?? 0
  return clamp((treasury / TREASURY_FULL_SCORE) * 100, 0, 100)
}

// §9.12: 敵 primary が candidate より強大で近接しているほど高い (最小補正)。
//   base = 強大度 (ratio 2.0 で 50)、係数 = candidate と敵 primary の地理近接 (隣接 1.0 / 同 State 0.5)。
export function computeThreatContainmentScore(
  state: WorldState,
  config: SimulationConfig,
  candidateId: PolityId,
  enemyPrimary: OrganizationRef,
): number {
  const enemyPower = estimateWarSidePower(state, config, enemyPrimary)
  if (enemyPower <= 0) return 0
  const candidatePower = estimateWarSidePower(state, config, {
    kind: 'polity',
    id: candidateId,
  })
  const base =
    candidatePower <= 0
      ? 100
      : clamp((enemyPower / candidatePower - 1) * THREAT_RATIO_SCALE, 0, 100)
  if (base === 0) return 0

  if (enemyPrimary.kind !== 'polity') return 0
  const candidateProvinces = getPolityTerminalProvinceIds(state, candidateId)
  const enemyProvinces = getPolityTerminalProvinceIds(state, enemyPrimary.id)
  if (candidateProvinces.length === 0 || enemyProvinces.length === 0) return 0
  const candidateSet = new Set(candidateProvinces.map((p) => p as string))
  const candidateStateIds = new Set<string>()
  for (const pid of candidateProvinces) {
    const province = state.provinces[pid]
    if (province) candidateStateIds.add(province.stateId)
  }
  let factor = 0
  for (const pid of enemyProvinces) {
    const province = state.provinces[pid]
    if (!province) continue
    for (const neighborId of province.neighbors) {
      if (candidateSet.has(neighborId)) {
        factor = 1
        break
      }
    }
    if (factor === 1) break
    if (candidateStateIds.has(province.stateId)) factor = Math.max(factor, 0.5)
  }
  return base * factor
}

// §9.11: 終戦直後ほど高い penalty 値 (0..100)。負の weight を掛けるのは呼出側 (§9.1)。
export function computeLastWarPenalty(state: WorldState, candidateId: PolityId): number {
  const lastWarWeek = state.polities[candidateId]?.lastWarWeek
  if (lastWarWeek === undefined) return 0
  const weeksSince = state.absoluteWeek - lastWarWeek
  if (weeksSince >= LAST_WAR_PENALTY_DECAY_WEEKS) return 0
  return clamp(100 * (1 - weeksSince / LAST_WAR_PENALTY_DECAY_WEEKS), 0, 100)
}

// --- 候補列挙 (§8.1 hard exclude) ---

// 全 active/escalated play の supporter polity key 集合 (excludePlayId を除く)。
function collectOtherPlaySupporterKeys(state: WorldState, excludePlayId: string): Set<string> {
  const keys = new Set<string>()
  for (const idStr of Object.keys(state.diplomaticPlays)) {
    if (idStr === excludePlayId) continue
    const play = state.diplomaticPlays[idStr as keyof typeof state.diplomaticPlays]
    if (!play) continue
    if (play.status !== 'active' && play.status !== 'escalated') continue
    for (const s of [...play.initiatorSupporters, ...play.targetSupporters]) {
      keys.add(organizationKey(s.actor))
    }
  }
  return keys
}

// candidate が active War に参加中か (terminal War の retention 残留は不問)。
export function isPolityInActiveWar(state: WorldState, polityId: PolityId): boolean {
  const warIds = state.warIndex.byParticipant[`polity:${polityId as string}`] ?? []
  for (const wid of warIds) {
    if (state.wars[wid]?.status === 'active') return true
  }
  return false
}

// §8.1 の hard exclude を全適用した候補 PolityId リスト (昇順)。
//   通常は side 非依存 (exclude は両 side 対称)。score / side 文脈は computeJoinScore 側。
//
// v0.47.2 (ルートA): side を渡すと「叛乱の鎮圧側 (revolt_negotiation の target)」に限り
//   宗主-臣下除外をスキップする。叛乱では target の宗主チェーン (収入を失う上位契約者) と
//   又臣下こそが鎮圧の自然な利害当事者であり、それを third-party 除外で弾くと鎮圧側が永久に
//   援軍ゼロになる。なお nominal occupation contract により initiator (反乱軍 commonwealth) の overlord
//   集合は target チェーンに汚染されているため、両方向のチェック (vs initiator / vs target) を
//   まとめてスキップして初めて宗主が候補に乗る。side 省略時は従来どおり除外を全適用する。
//
// v0.47.2 (反乱軍の援軍非対称): commonwealth は原則候補外だが、「叛乱の rebel side (initiator)」が
//   募集する場合に限り、同じ popular_revolt 由来の commonwealth (同志の叛乱国家) は候補に許す。
//   landed polity は別途 joinScore で penalty を受ける (computeJoinScore の rebelBacking)。
export function enumerateSupportCandidates(
  state: WorldState,
  play: DiplomaticPlay,
  side?: DiplomaticPlaySideKey,
): PolityId[] {
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') return []
  const initiatorId = play.initiator.id
  const targetId = play.target.id
  const relaxSuzerainExclusion = play.kind === 'revolt_negotiation' && side === 'target'
  const rebelSeeking = play.kind === 'revolt_negotiation' && side === 'initiator'

  const existingSupporterKeys = new Set<string>()
  for (const s of [...play.initiatorSupporters, ...play.targetSupporters]) {
    existingSupporterKeys.add(organizationKey(s.actor))
  }
  const otherPlaySupporterKeys = collectOtherPlaySupporterKeys(state, play.id)
  const initiatorOverlords = getPolityOverlordPolityIds(state, initiatorId)
  const targetOverlords = getPolityOverlordPolityIds(state, targetId)

  const result: PolityId[] = []
  for (const idStr of Object.keys(state.polities).sort()) {
    const candidateId = idStr as PolityId
    const polity = state.polities[candidateId]
    if (!polity || !polity.active) continue
    if (candidateId === initiatorId || candidateId === targetId) continue
    if (polity.kind === 'commonwealth') {
      // rebel side 募集に限り、同志の叛乱国家 (popular_revolt 由来) のみ候補に許す。
      if (!(rebelSeeking && polity.origin.kind === 'popular_revolt')) continue
    }
    const key = `polity:${idStr}`
    if (existingSupporterKeys.has(key)) continue
    if (otherPlaySupporterKeys.has(key)) continue
    if (isPolityInActiveWar(state, candidateId)) continue
    if (!relaxSuzerainExclusion) {
      const candidateOverlords = getPolityOverlordPolityIds(state, candidateId)
      if (
        hasSuzerainVassalRelation(candidateOverlords, initiatorOverlords, candidateId, initiatorId)
      )
        continue
      if (hasSuzerainVassalRelation(candidateOverlords, targetOverlords, candidateId, targetId))
        continue
    }
    result.push(candidateId)
  }
  return result
}

// --- joinScore (§9.1) ---

export function computeJoinScore(
  state: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: DiplomaticPlaySideKey,
  candidateId: PolityId,
): JoinScoreBreakdown {
  const supportedPrimary = side === 'initiator' ? play.initiator : play.target
  const enemyPrimary = side === 'initiator' ? play.target : play.initiator

  // politicalOpinion (§9.2): v0.43 では weight 0 の休眠項。weight 0 のとき breakdown 計算を省く。
  let politicalOpinion = 0
  if (
    config.supportJoinScoreWeightPoliticalOpinion !== 0 &&
    supportedPrimary.kind === 'polity' &&
    enemyPrimary.kind === 'polity'
  ) {
    const breakdown = getPolityInfluenceBreakdown(state, config, candidateId)
    politicalOpinion =
      getWeightedOpinionFromInfluenceBreakdown(state, breakdown, supportedPrimary.id) -
      getWeightedOpinionFromInfluenceBreakdown(state, breakdown, enemyPrimary.id)
  }

  const issueProvinceIds = getPlayIssueProvinceIds(state, play)
  const proximity = computeProximityScore(state, issueProvinceIds, candidateId)
  const militarySparePower = computeMilitarySparePowerScore(
    state,
    config,
    candidateId,
    enemyPrimary,
  )
  const treasury = computeTreasuryScore(state, candidateId)
  const threatContainment = computeThreatContainmentScore(state, config, candidateId, enemyPrimary)
  const lastWarPenalty = computeLastWarPenalty(state, candidateId)
  // v0.47.2 説得ボーナス: 募集側 (= supported side) の delegate 能力で全 candidate を一律底上げ。
  //   candidate 非依存なので「最良候補が閾値を越えるか」を有能な交渉担当者ほど後押しする
  //   (ランキング自体は地理・軍事で決まる)。delegate 不在なら 0。
  const persuasion = computePersuasionBonus(state, config, play, side)
  // v0.47.2 反乱軍の援軍非対称: rebel side 募集時のみ、候補の素性で加減点する。
  //   landed polity = 農民反乱への肩入れ忌避で penalty / 同志の叛乱国家 = sympathy で bonus。
  let rebelBacking = 0
  if (play.kind === 'revolt_negotiation' && side === 'initiator') {
    const candidate = state.polities[candidateId]
    rebelBacking =
      candidate?.origin.kind === 'popular_revolt'
        ? config.supportFellowRevoltBonus
        : -config.supportRebelBackingPenalty
  }

  const total =
    config.supportJoinScoreWeightPoliticalOpinion * politicalOpinion +
    config.supportJoinScoreWeightProximity * proximity +
    config.supportJoinScoreWeightMilitarySparePower * militarySparePower +
    config.supportJoinScoreWeightTreasury * treasury +
    config.supportJoinScoreWeightThreatContainment * threatContainment +
    config.supportJoinScoreWeightLastWarPenalty * lastWarPenalty +
    persuasion +
    rebelBacking

  return {
    total,
    politicalOpinion,
    proximity,
    militarySparePower,
    treasury,
    threatContainment,
    lastWarPenalty,
    persuasion,
    rebelBacking,
  }
}

// §9.x (v0.47.2): 募集側 delegate (反乱軍なら首謀者) の説得力ボーナス (0..supportPersuasionScale)。
//   charisma 主軸 + insight。candidate 非依存 (delegate の固有値) なので最良候補のみ計算すれば
//   足りるが、breakdown 一貫性のため computeJoinScore 内で都度算出する (delegate 取得は map 参照1回)。
function computePersuasionBonus(
  state: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: DiplomaticPlaySideKey,
): number {
  const delegateId =
    side === 'initiator' ? play.initiatorDelegatePersonId : play.targetDelegatePersonId
  if (!delegateId) return 0
  const delegate = state.persons[delegateId]
  if (!delegate || !delegate.alive) return 0
  const ab = delegate.abilities
  const weighted = ab.charisma * PERSUASION_WEIGHT_CHARISMA + ab.insight * PERSUASION_WEIGHT_INSIGHT
  return clamp((weighted / 100) * config.supportPersuasionScale, 0, config.supportPersuasionScale)
}

// --- 最良候補 (§8.2: score 降順・同点 PolityId 昇順。RNG 不使用) ---

export function selectBestSupportCandidate(
  state: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: DiplomaticPlaySideKey,
): { polityId: PolityId; score: JoinScoreBreakdown } | undefined {
  const candidates = enumerateSupportCandidates(state, play, side)
  // v0.45.2 同家戦争防止ゲート: 反対側 primary と同じ支配家の polity は、その side の
  //   候補にしない (家が自分の polity への攻撃に加担する不自然の防止)。side 依存のため
  //   enumerateSupportCandidates (side 非依存・対称 exclude) ではなくここで弾く。
  //   自 side の primary と同家は除外しない (家が自分の polity を支援するのは自然)。
  const enemyPrimary = side === 'initiator' ? play.target : play.initiator
  let best: { polityId: PolityId; score: JoinScoreBreakdown } | undefined
  for (const candidateId of candidates) {
    if (
      enemyPrimary.kind === 'polity' &&
      politiesShareOwnerHouse(state, candidateId, enemyPrimary.id)
    ) {
      continue
    }
    const score = computeJoinScore(state, config, play, side, candidateId)
    // 列挙が PolityId 昇順なので、同点では先勝ち = PolityId 昇順 tie-break。
    if (!best || score.total > best.score.total) {
      best = { polityId: candidateId, score }
    }
  }
  return best
}
