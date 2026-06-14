import type { TickContext } from './context'
import { createSimEvent } from './context'
import { isLifeStageAtLeast } from '../types/person'
import { nameParam, entityRef } from '../types/event'
import { createOfficeAssignment, revokeOfficesByHolder } from '../mutations/officeMutations'
import {
  getPolityLeader,
  getHouseLeader,
  getActiveOfficeHolders,
  getOfficeAssignments,
} from '../selectors/officeSelectors'
import { getPersonHouseSharePercent } from '../selectors/shareSelectors'
import {
  getPolityInfluenceBreakdown,
  getActorInfluenceFromBreakdown,
} from '../selectors/influenceSelectors'
import type { PolityInfluenceBreakdown } from '../types/influence'
import { getPolityOfficeAppointmentRight } from '../selectors/politicalRightSelectors'
import type { PoliticalRight } from '../types/politicalRight'
import { getPersonPrestige } from '../selectors/statusSelectors'
import { getAttitudeOrDefault, attitudeValueToScore } from '../helpers/attitudeHelpers'
import { getAppointmentTaskModifier } from '../selectors/appointmentTaskSelectors'
import { getAppointmentReputationModifier } from '../selectors/personReputationSelectors'

import type { PersonId, PolityId, HouseId } from '../types/ids'
import type { OfficeRole, OrganizationRef } from '../types/office'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { FactionId } from '../types/ids'
import type { Polity } from '../types/polity'
import type { House } from '../types/house'
import { getRoleScore } from '../selectors/abilitySelectors'
import { getPolityNameRefForEmitFromPolity, houseNameParam } from '../selectors/nameRefSelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import { isRoleEligibleBySex } from '../selectors/roleEligibilitySelectors'
import {
  isEstablishedCommonwealthRepublic,
  getRepublicPoliticalCandidatePersons,
} from '../selectors/republicSelectors'
import {
  hasRelevantFactionForAppointment,
  getFactionalCandidateScore,
  getActiveFactions,
  getFactionNominationPower,
  getFactionActiveMemberIds,
  getActiveFactionMembership,
  collectSubtreeLeaderWeights,
} from '../selectors/factionSelectors'
import {
  getOfficeCompatibilityPenalty,
  getEffectiveOfficeMaxHolders,
  hasActiveHoldingOffice,
} from '../selectors/officeSelectors'
import {
  getHouseProjectedAnnualIncome,
  getHouseAnnualOfficeSalary,
} from '../selectors/houseFinanceSelectors'
import { getOfficeDefinition } from '../config/officeDefinitions'

const POLITY_APPOINTABLE_ROLES: OfficeRole[] = ['administrator', 'treasurer', 'military', 'advisor']
const HOUSE_APPOINTABLE_ROLES: OfficeRole[] = ['administrator', 'treasurer', 'military', 'advisor']

// polity / house 任命の共通前処理: 当該 organization/role の現職のうち
// 死亡 (or 不在) している者の役職を罷免し、更新後の ctx を返す。
function revokeDeadOfficeHolders(
  ctx: TickContext,
  organization: OrganizationRef,
  role: OfficeRole,
): TickContext {
  let currentCtx = ctx
  const currentHolders = getActiveOfficeHolders(currentCtx.state, organization, role)
  for (const holderId of currentHolders) {
    const holder = currentCtx.state.persons[holderId]
    if (!holder || !holder.alive) {
      currentCtx = { ...currentCtx, state: revokeOfficesByHolder(currentCtx.state, holderId) }
    }
  }
  return currentCtx
}

// スコア付き候補から最良を選ぶ共通処理: 降順ソートして先頭が minScore 以上なら採用。
// scored の構築 (どの候補をどの式でスコアリングするか) は呼び出し側に残す。
// NOTE: 同点時は scored の元順序 (= 安定ソートで先に来た候補) が勝つ挙動を保持する。
function pickBestScored(
  scored: { id: PersonId; score: number }[],
  minScore: number,
): { id: PersonId; score: number } | undefined {
  scored.sort((a, b) => b.score - a.score)
  const top = scored[0]
  return top && top.score >= minScore ? top : undefined
}

function getRelevantStat(state: WorldState, personId: PersonId, role: OfficeRole): number {
  switch (role) {
    case 'military':
      return getRoleScore(state, personId, 'warCommand') / 10
    default:
      return getRoleScore(state, personId, 'governance') / 10
  }
}

// ---------------------------------------------------------------------------
// v0.17 §14.6: Pre-computed polity candidate cache
// ---------------------------------------------------------------------------

type PolityCandidateCache = Map<string, PersonId[]>

function buildPolityCandidateCache(
  state: WorldState,
  config: SimulationConfig,
): PolityCandidateCache {
  const housePrimaryPolity = new Map<string, PolityId>()
  for (const houseId of Object.keys(state.houses)) {
    const h = state.houses[houseId as HouseId]
    if (!h || !h.active) continue
    const polityId = getHousePrimaryPolityId(state, houseId as HouseId)
    if (polityId) housePrimaryPolity.set(houseId, polityId)
  }

  const ownerHousePolities = new Map<string, PolityId[]>()
  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue
    if (polity.ownerHouseId !== undefined) {
      const list = ownerHousePolities.get(polity.ownerHouseId) ?? []
      list.push(polityId as PolityId)
      ownerHousePolities.set(polity.ownerHouseId, list)
    }
  }

  const cache: PolityCandidateCache = new Map()
  for (const pid of state.livingPersonIds) {
    const p = state.persons[pid]
    if (!p) continue
    if (p.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(p.lifeStage, 'young_adulthood')) continue
    if (hasActiveHoldingOffice(state, pid)) continue
    if (!p.houseId) continue
    const house = state.houses[p.houseId]
    if (!house || !house.active) continue

    const addedPolities = new Set<string>()
    const primaryPolity = housePrimaryPolity.get(p.houseId)
    if (primaryPolity) {
      const list = cache.get(primaryPolity) ?? []
      list.push(pid)
      cache.set(primaryPolity, list)
      addedPolities.add(primaryPolity)
    }
    const ownerPolities = ownerHousePolities.get(p.houseId)
    if (ownerPolities) {
      for (const polityId of ownerPolities) {
        if (addedPolities.has(polityId)) continue
        const list = cache.get(polityId) ?? []
        list.push(pid)
        cache.set(polityId, list)
      }
    }
  }

  // commonwealth アリーナ化: ownerHouseId を持たない established commonwealth は上記 2 経路では
  // 候補が入らず polity 役職を埋められない。republic 候補プールを投入する (重複は Set で排除)。
  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue
    if (polity.ownerHouseId !== undefined) continue
    if (!isEstablishedCommonwealthRepublic(state, polityId as PolityId)) continue
    const existing = new Set((cache.get(polityId as PolityId) ?? []).map((id) => id as string))
    const list = cache.get(polityId) ?? []
    for (const cand of getRepublicPoliticalCandidatePersons(state, config, polityId as PolityId)) {
      if (existing.has(cand)) continue
      const p = state.persons[cand]
      if (!p || p.kind === 'placeholder') continue
      if (!isLifeStageAtLeast(p.lifeStage, 'young_adulthood')) continue
      if (hasActiveHoldingOffice(state, cand)) continue
      existing.add(cand)
      list.push(cand)
    }
    if (list.length > 0) cache.set(polityId, list)
  }
  return cache
}

function collectHouseCandidatesTraditional(
  state: WorldState,
  config: SimulationConfig,
  house: House,
  alreadyHolding: Set<string>,
): PersonId[] {
  void config
  const result: PersonId[] = []
  for (const memberId of house.memberIds) {
    const member = state.persons[memberId]
    if (!member || !member.alive) continue
    if (member.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(member.lifeStage, 'young_adulthood')) continue
    if (alreadyHolding.has(memberId)) continue
    // v0.17.1 §15.3: active Bailiff (HoldingOffice) 保有者は候補外
    if (hasActiveHoldingOffice(state, memberId)) continue
    result.push(memberId)
  }
  return result
}

// v0.17.1 §15.3: 別 Holding の bailiff として active な HoldingOffice を持つ Person を判定。
// ---------------------------------------------------------------------------
// v0.17 §14.1: Factional candidate collection
// ---------------------------------------------------------------------------

function collectFactionalCandidates(
  state: WorldState,
  config: SimulationConfig,
  org: OrganizationRef,
  role: OfficeRole,
): { factionId: FactionId; candidateId: PersonId; weight: number }[] {
  const result: { factionId: FactionId; candidateId: PersonId; weight: number }[] = []
  for (const faction of getActiveFactions(state)) {
    const np = getFactionNominationPower(state, config, faction.id, org, role)
    if (np < config.factionNominationPowerThreshold) continue
    // 自前メンバー (weight 1.0 = 非入れ子では従来と bit-identical)。
    for (const mid of getFactionActiveMemberIds(state, faction.id)) {
      const m = state.persons[mid]
      if (!m || !m.alive) continue
      if (m.kind === 'placeholder') continue
      if (!isLifeStageAtLeast(m.lifeStage, 'young_adulthood')) continue
      // v0.17.1 §15.3: active Bailiff 保有者は Polity/House Office 候補から除外
      if (hasActiveHoldingOffice(state, mid)) continue
      result.push({ factionId: faction.id, candidateId: mid, weight: 1 })
    }
    // v0.50「副官のみ引き上げ」: 子孫派閥の leader (=直属の副官) を親 umbrella の候補に加える。
    // 子孫の一般メンバーは polity には流入させない (§8 広域再帰は保留)。スコアは depth で割引。
    for (const { leaderId, weight } of collectSubtreeLeaderWeights(state, config, faction.id)) {
      const m = state.persons[leaderId]
      if (!m || !m.alive) continue
      if (m.kind === 'placeholder') continue
      if (!isLifeStageAtLeast(m.lifeStage, 'young_adulthood')) continue
      if (hasActiveHoldingOffice(state, leaderId)) continue
      result.push({ factionId: faction.id, candidateId: leaderId, weight })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// v0.17 §14.5: Traditional scoring with v0.17 adjustments
// ---------------------------------------------------------------------------

function computePolityScoreV017(
  state: WorldState,
  config: SimulationConfig,
  polity: Polity,
  rulerId: PersonId,
  personId: PersonId,
  role: OfficeRole,
  // v0.42 §19.2-1: share% → influence%。perf のため polity ごとに前計算した breakdown を受け取る (§21.2)
  influenceBreakdown: PolityInfluenceBreakdown,
): number {
  const person = state.persons[personId]
  if (!person) return -Infinity
  if (!person.houseId) return -Infinity
  const ruler = state.persons[rulerId]

  const prestige = getPersonPrestige(state, personId)
  const leaderRespect = ruler
    ? attitudeValueToScore(
        getAttitudeOrDefault(state, ruler, { kind: 'polity', id: polity.id }).respect,
      ) / 100
    : 0
  const polityAtt = getAttitudeOrDefault(state, person, { kind: 'polity', id: polity.id })
  const polityAffection = attitudeValueToScore(polityAtt.affection) / 100
  const houseInfluencePct = getActorInfluenceFromBreakdown(influenceBreakdown, {
    kind: 'house',
    id: person.houseId,
  }).percent
  // 影響力個人中心化 Phase 2b: 候補本人の person influence% も加味する。役職 influence が
  // 個人帰属になった (Phase 2b) ため、候補自身の役職/任命権/評判由来 influence を反映する。
  // 家 backing (houseInfluencePct) + 個人の立場 (personInfluencePct) の両建てで評価する。
  const personInfluencePct = getActorInfluenceFromBreakdown(influenceBreakdown, {
    kind: 'person',
    id: personId,
  }).percent
  const personSharePct = getPersonHouseSharePercent(state, person.houseId, personId)

  // same-house polity office count (effective per v0.17 §14.5)
  const polityOfficeIds = state.officeIndex.byOrganization[`polity:${polity.id}`] ?? []
  let sameHousePolityOfficeCount = 0
  for (const oId of polityOfficeIds) {
    const o = state.officeAssignments[oId]
    if (!o || !o.active) continue
    const p = state.persons[o.holderPersonId]
    if (p && p.houseId === person.houseId) sameHousePolityOfficeCount++
  }
  const sameHouseEffective =
    config.sameHousePolityOfficePenalty * (1 - houseInfluencePct / 100) * sameHousePolityOfficeCount

  // ownerHouseBonus: 0 when ownerHouseId is undefined (commonwealth)
  const ownerHouseBonus =
    polity.ownerHouseId !== undefined && polity.ownerHouseId === person.houseId
      ? config.ownerHouseAppointmentBonus
      : 0

  // v0.17 §14.5: replace concurrentOfficePenalty * count with getOfficeCompatibilityPenalty
  // v0.42: compatible-pair の reduction 入力も share% → influence% (前計算 breakdown から)
  const compatibilityPenalty = getOfficeCompatibilityPenalty(
    state,
    config,
    personId,
    { kind: 'polity', id: polity.id },
    role,
    houseInfluencePct,
  )

  return (
    getRelevantStat(state, personId, role) * 1.0 +
    (prestige / 100) * 8 +
    leaderRespect * 4 +
    polityAffection * 3 +
    (houseInfluencePct + personInfluencePct) * config.polityInfluenceAppointmentFactor +
    personSharePct * config.houseShareAppointmentFactor +
    ownerHouseBonus -
    compatibilityPenalty -
    sameHouseEffective +
    getAppointmentTaskModifier(state, config, personId, { kind: 'polity', id: polity.id }, role) +
    // v0.44 §9.3: 成果評判の任用補正 (raw ±cap × officeReputationScoreFactor = 実効 ±5)。
    getAppointmentReputationModifier(state, config, personId, role) -
    // v0.40 §9.3: old_age は固定減算（負スコアでも単調に不利化するため乗算でなく減算）。
    (person.lifeStage === 'old_age' ? config.oldAgeAppointmentScorePenalty : 0)
  )
}

function computeHouseScoreV017(
  state: WorldState,
  config: SimulationConfig,
  house: House,
  leaderId: PersonId,
  personId: PersonId,
  role: OfficeRole,
): number {
  const person = state.persons[personId]
  if (!person) return -Infinity
  const leader = state.persons[leaderId]

  const prestige = getPersonPrestige(state, personId)
  const leaderRespect = leader
    ? attitudeValueToScore(
        getAttitudeOrDefault(state, leader, { kind: 'house', id: house.id }).respect,
      ) / 100
    : 0
  const houseAtt = getAttitudeOrDefault(state, person, { kind: 'house', id: house.id })
  const houseAffection = attitudeValueToScore(houseAtt.affection) / 100
  const personSharePct = getPersonHouseSharePercent(state, house.id, personId)

  // v0.17 §14.5: replace concurrentOfficePenalty * count with getOfficeCompatibilityPenalty
  const compatibilityPenalty = getOfficeCompatibilityPenalty(
    state,
    config,
    personId,
    { kind: 'house', id: house.id },
    role,
  )

  return (
    getRelevantStat(state, personId, role) * 1.0 +
    (prestige / 100) * 10 +
    leaderRespect * 5 +
    houseAffection * 3 +
    personSharePct * 0.1 -
    compatibilityPenalty +
    getAppointmentTaskModifier(state, config, personId, { kind: 'house', id: house.id }, role) +
    // v0.44 §9.3: 成果評判の任用補正。
    getAppointmentReputationModifier(state, config, personId, role) -
    // v0.40 §9.3: old_age は固定減算。
    (person.lifeStage === 'old_age' ? config.oldAgeAppointmentScorePenalty : 0)
  )
}

// ---------------------------------------------------------------------------
// v0.42 §9: polity_office_appointment right の接続
// ---------------------------------------------------------------------------

// right holder の候補 pool 追加 (§9.2)。traditional pool は「家の primary polity がこの
// polity」または「家がこの polity の owner」の member に限られ、それ以外の right holder
// House の member は bonus だけでは空振りするため明示的に追加する。
function collectRightHolderCandidates(
  state: WorldState,
  right: PoliticalRight,
  alreadyHolding: Set<string>,
): PersonId[] {
  const result: PersonId[] = []
  const pushIfEligible = (pid: PersonId) => {
    const p = state.persons[pid]
    if (!p || !p.alive) return
    if (p.kind === 'placeholder') return
    if (!isLifeStageAtLeast(p.lifeStage, 'young_adulthood')) return
    if (hasActiveHoldingOffice(state, pid)) return
    if (alreadyHolding.has(pid)) return
    result.push(pid)
  }
  if (right.holder.kind === 'house') {
    const house = state.houses[right.holder.id]
    if (!house || !house.active) return result
    for (const memberId of house.memberIds) pushIfEligible(memberId)
  } else {
    pushIfEligible(right.holder.id)
  }
  return result
}

// right-backed faction の選定 (§9.3 — 最大 1 つ、5 段階の優先順位)。
// 対象 Polity に anchor された active Faction のうち、right holder と最も関係が強いもの。
export function selectRightBackedFaction(
  state: WorldState,
  polityId: PolityId,
  right: PoliticalRight,
): FactionId | undefined {
  const anchorIds = [...(state.factionIndex.byPolity[polityId] ?? [])]
    .filter((fid) => state.factions[fid]?.active)
    .sort()
  if (anchorIds.length === 0) return undefined

  const membershipFactionOf = (personId: PersonId): FactionId | undefined => {
    const m = getActiveFactionMembership(state, personId)
    if (!m) return undefined
    return anchorIds.includes(m.factionId) ? m.factionId : undefined
  }

  // 1. holder Person が所属する anchor Faction
  if (right.holder.kind === 'person') {
    return membershipFactionOf(right.holder.id)
  }

  // 2. holder House の leader が所属する anchor Faction
  const holderHouseId = right.holder.id
  const leaderId = getHouseLeader(state, holderHouseId)
  if (leaderId !== undefined) {
    const viaLeader = membershipFactionOf(leaderId)
    if (viaLeader !== undefined) return viaLeader
  }

  // 3. holder House の member が最も多く所属する anchor Faction
  //    4. 同数なら faction leader が holder House に属する Faction
  //    5. それでも同点なら factionId 昇順 (anchorIds はソート済)
  let best: { factionId: FactionId; count: number; leaderInHouse: boolean } | undefined
  for (const factionId of anchorIds) {
    const faction = state.factions[factionId]
    if (!faction) continue
    let count = 0
    for (const mid of getFactionActiveMemberIds(state, factionId)) {
      const m = state.persons[mid]
      if (m && m.houseId === holderHouseId) count++
    }
    if (count === 0) continue
    const leaderInHouse = state.persons[faction.leaderPersonId]?.houseId === holderHouseId
    if (
      !best ||
      count > best.count ||
      (count === best.count && leaderInHouse && !best.leaderInHouse)
    ) {
      best = { factionId, count, leaderInHouse }
    }
  }
  return best?.factionId
}

// right による候補スコア補正 (§9.2)。
function getRightAppointmentBonus(
  state: WorldState,
  config: SimulationConfig,
  right: PoliticalRight,
  candidateId: PersonId,
  rightBackedFactionId: FactionId | undefined,
): number {
  const candidate = state.persons[candidateId]
  if (!candidate) return 0
  let bonus = 0
  if (right.holder.kind === 'house') {
    if (candidate.houseId === right.holder.id)
      bonus += config.polityOfficeAppointmentRightHouseBonus
  } else {
    if (candidateId === right.holder.id) bonus += config.polityOfficeAppointmentRightPersonBonus
    const holderPerson = state.persons[right.holder.id]
    if (
      holderPerson &&
      holderPerson.houseId !== undefined &&
      candidate.houseId === holderPerson.houseId
    ) {
      bonus += config.polityOfficeAppointmentRightHouseAssociatedBonus
    }
  }
  if (rightBackedFactionId !== undefined) {
    const membership = getActiveFactionMembership(state, candidateId)
    if (membership && membership.factionId === rightBackedFactionId) {
      bonus += config.rightBackedFactionBonus
    }
  }
  return bonus
}

// ---------------------------------------------------------------------------
// v0.17 §14.1: tryAppoint helpers (dispatch between factional and traditional)
// ---------------------------------------------------------------------------

function tryAppointPolityOffice(
  ctx: TickContext,
  polity: Polity,
  rulerId: PersonId,
  role: OfficeRole,
  cachedCandidates: PersonId[],
  influenceBreakdown: PolityInfluenceBreakdown,
): TickContext {
  const config = ctx.config
  const polityRef: OrganizationRef = { kind: 'polity', id: polity.id }

  // 1. revoke dead holders
  let currentCtx = revokeDeadOfficeHolders(ctx, polityRef, role)

  // v0.42 slot 化: 充足判定は人数 count でなく空き slot の有無で行う。
  // effectiveMax 縮小後に「後ろの slot に着座者が残り count == max だが前の slot が空き」
  // という状態があり得るため (over-max 回収は organizationConsistency Step 3 の責務)、
  // count 基準だと前の空き slot が永久に埋まらない。充足対象は最若の空き slot 1 つ。
  const roleAssignments = getOfficeAssignments(currentCtx.state, polityRef).filter(
    (o) => o.active && o.role === role,
  )
  const effectiveMax = getEffectiveOfficeMaxHolders(currentCtx.state, config, polityRef, role)
  const occupiedSlots = new Set(roleAssignments.map((o) => o.slotIndex))
  let vacantSlot: number | undefined
  for (let s = 0; s < effectiveMax; s++) {
    if (!occupiedSlots.has(s)) {
      vacantSlot = s
      break
    }
  }
  if (vacantSlot === undefined) return currentCtx
  const alreadyHolding = new Set(roleAssignments.map((o) => o.holderPersonId as string))

  // v0.42 §9: 充足対象 slot に appointment right がある場合、unrelated factional path
  // は使わない (任命権は制度的権利として派閥推薦より優先 — §9.3)。right holder の候補を
  // pool に追加し、right bonus + right-backed faction bonus でスコア補正する。
  const appointmentRight = getPolityOfficeAppointmentRight(
    currentCtx.state,
    polity.id,
    role,
    vacantSlot,
  )
  const rightBackedFactionId = appointmentRight
    ? selectRightBackedFaction(currentCtx.state, polity.id, appointmentRight)
    : undefined

  // v0.45.3 性別役職適格ゲート: gated (適格者のみ) で right → factional → traditional の
  // cascade 全体を評価し、空振りした場合のみ ungated 再試行する (per-path fallback だと
  // 「traditional に適格男性が残っているのに factional の不適格女性を着座」が起きる)。
  const selectBest = (gate: boolean): { id: PersonId; score: number } | undefined => {
    const passes = (id: PersonId): boolean =>
      !gate || isRoleEligibleBySex(currentCtx.state, config, id)
    let best: { id: PersonId; score: number } | undefined

    if (appointmentRight) {
      const pool = new Set<PersonId>(
        cachedCandidates.filter((id) => !alreadyHolding.has(id as string) && passes(id)),
      )
      for (const id of collectRightHolderCandidates(
        currentCtx.state,
        appointmentRight,
        alreadyHolding,
      )) {
        if (passes(id)) pool.add(id)
      }
      // v0.49: right-backed faction の member も候補プールに加える。任命権は無関係な派閥は
      // 排除するが、保持者自身が属する派閥の人材（landless でも）には道を開く。
      // getRightAppointmentBonus が既に rightBackedFactionBonus を付与する前提を実体化する
      // (= 従来はプールに居ない人物へボーナス計算するだけで死んでいた抜け穴を塞ぐ)。
      if (rightBackedFactionId !== undefined) {
        for (const mid of getFactionActiveMemberIds(currentCtx.state, rightBackedFactionId)) {
          if (alreadyHolding.has(mid)) continue
          const m = currentCtx.state.persons[mid]
          if (!m || !m.alive || m.kind === 'placeholder') continue
          if (!isLifeStageAtLeast(m.lifeStage, 'young_adulthood')) continue
          if (hasActiveHoldingOffice(currentCtx.state, mid)) continue
          if (!passes(mid)) continue
          pool.add(mid)
        }
      }
      const scored = [...pool].map((id) => ({
        id,
        score:
          computePolityScoreV017(
            currentCtx.state,
            config,
            polity,
            rulerId,
            id,
            role,
            influenceBreakdown,
          ) +
          getRightAppointmentBonus(
            currentCtx.state,
            config,
            appointmentRight,
            id,
            rightBackedFactionId,
          ),
      }))
      best = pickBestScored(scored, config.minAppointmentScore)
    }

    // 2. factional path (right が無い role のみ — §9.3/§9.5)
    if (
      !appointmentRight &&
      hasRelevantFactionForAppointment(currentCtx.state, config, polityRef, role)
    ) {
      const factional = collectFactionalCandidates(
        currentCtx.state,
        config,
        polityRef,
        role,
      ).filter((c) => !alreadyHolding.has(c.candidateId as string) && passes(c.candidateId))
      const scored = factional.map((c) => ({
        id: c.candidateId,
        // v0.50: 引き上げた子孫副官は depth weight (<1) で割引、自前メンバーは weight 1.0 で従来同値。
        // 前提: minAppointmentScore > 0。getFactionalCandidateScore は compatibilityPenalty で負値に
        // なり得るため、minAppointmentScore <= 0 だと weight<1 が負スコアを 0 方向へ持ち上げ深さ割引が
        // 反転する (深い副官が有利化)。現 config は minAppointmentScore=2 で負スコアは着座しないため無害。
        score:
          getFactionalCandidateScore(
            currentCtx.state,
            config,
            c.factionId,
            c.candidateId,
            polityRef,
            role,
          ) * c.weight,
      }))
      best = pickBestScored(scored, config.minAppointmentScore)
    }

    // 3. traditional fallback (uses pre-computed candidate cache)
    if (!appointmentRight && !best) {
      const candidates = cachedCandidates.filter(
        (id) => !alreadyHolding.has(id as string) && passes(id),
      )
      const scored = candidates.map((id) => ({
        id,
        score: computePolityScoreV017(
          currentCtx.state,
          config,
          polity,
          rulerId,
          id,
          role,
          influenceBreakdown,
        ),
      }))
      best = pickBestScored(scored, config.minAppointmentScore)
    }

    return best
  }

  let best = selectBest(true)
  if (!best && config.allowFemaleRolesWhenNoMaleCandidate) best = selectBest(false)

  if (!best) return currentCtx

  const newState = createOfficeAssignment(currentCtx.state, polityRef, role, best.id, vacantSlot)
  currentCtx = { ...currentCtx, state: newState }

  const person = currentCtx.state.persons[best.id]
  if (person && person.houseId) {
    const house = currentCtx.state.houses[person.houseId]
    if (house) {
      const polityNameRef = getPolityNameRefForEmitFromPolity(currentCtx.state, polity)
      const { event, ctx: eventCtx } = createSimEvent(currentCtx, {
        type: 'OFFICE_ASSIGNED',
        importance: 'normal',
        messageKey: 'office.assigned_polity',
        messageParams: {
          person: nameParam('person', person.nameKey),
          role: nameParam('role', `polity_${role}`),
          polity: nameParam(polityNameRef.category, polityNameRef.nameKey),
        },
        entityRefs: [
          entityRef('person', best.id, 'appointee', person.nameKey),
          entityRef('polity', polity.id, 'organization', polityNameRef.nameKey),
        ],
      })
      currentCtx = {
        ...eventCtx,
        state: currentCtx.state,
        events: [...eventCtx.events, event],
      }
    }
  }

  return currentCtx
}

function tryAppointHouseOffice(
  ctx: TickContext,
  house: House,
  leaderId: PersonId,
  role: OfficeRole,
  projectedAnnualIncome: number,
): TickContext {
  const config = ctx.config
  const houseRef: OrganizationRef = { kind: 'house', id: house.id }

  // 1. revoke dead holders
  let currentCtx = revokeDeadOfficeHolders(ctx, houseRef, role)

  const activeHolders = getActiveOfficeHolders(currentCtx.state, houseRef, role)
  const effectiveMax = getEffectiveOfficeMaxHolders(currentCtx.state, config, houseRef, role)
  if (activeHolders.length >= effectiveMax) return currentCtx

  // v0.37: 家役職の支払能力ゲート。家が定常的に得る収入 (PolitySurplus) で
  // 既存役職 + この役職の年間給与を賄えないなら任命しない (収入ベースの役職数)。
  // 収入の無い landless 小家系が給与未払い (OFFICE_SALARY_UNPAID) を量産する問題への対処。
  // leader (baseSalary=0) は対象外。Polity 役職は別経路で財庫から支払われるため不問。
  const roleSalary = getOfficeDefinition('house', role)?.baseSalary ?? 0
  if (roleSalary > 0) {
    const currentSalary = getHouseAnnualOfficeSalary(currentCtx.state, house.id)
    if (currentSalary + roleSalary > projectedAnnualIncome) return currentCtx
  }

  const alreadyHolding = new Set(activeHolders.map((id) => id as string))

  // v0.42 §12.5: House office への factional path は廃止 (Faction は Polity 内政治装置)。
  // traditional スコアリングのみで任命する。
  // v0.45.3 性別役職適格ゲート: gated で空振りした場合のみ ungated 再試行 (polity 側と同形)。
  const selectBest = (gate: boolean): { id: PersonId; score: number } | undefined => {
    const candidates = collectHouseCandidatesTraditional(
      currentCtx.state,
      config,
      house,
      alreadyHolding,
    ).filter((id) => !gate || isRoleEligibleBySex(currentCtx.state, config, id))
    const scored = candidates.map((id) => ({
      id,
      score: computeHouseScoreV017(currentCtx.state, config, house, leaderId, id, role),
    }))
    return pickBestScored(scored, config.minAppointmentScore)
  }

  let best = selectBest(true)
  if (!best && config.allowFemaleRolesWhenNoMaleCandidate) best = selectBest(false)

  if (!best) return currentCtx

  const newState = createOfficeAssignment(currentCtx.state, houseRef, role, best.id)
  currentCtx = { ...currentCtx, state: newState }

  const person = currentCtx.state.persons[best.id]
  if (person) {
    const { event, ctx: eventCtx } = createSimEvent(currentCtx, {
      type: 'OFFICE_ASSIGNED',
      importance: 'normal',
      messageKey: 'office.assigned_house',
      messageParams: {
        person: nameParam('person', person.nameKey),
        role: nameParam('role', `house_${role}`),
        house: houseNameParam(house, house.id),
      },
      entityRefs: [
        entityRef('person', best.id, 'appointee', person.nameKey),
        entityRef('house', house.id, 'organization', house.nameKey),
      ],
    })
    currentCtx = { ...eventCtx, state: currentCtx.state, events: [...eventCtx.events, event] }
  }

  return currentCtx
}

export function runAppointmentSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  const polityCandidateCache = buildPolityCandidateCache(currentCtx.state, currentCtx.config)

  // Polity offices
  for (const polityId of Object.keys(currentCtx.state.polities).sort()) {
    const polity = currentCtx.state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue

    const rulerId = getPolityLeader(currentCtx.state, polityId as PolityId)
    if (!rulerId) continue

    const cachedCandidates = polityCandidateCache.get(polityId) ?? []
    // v0.42 §21.2: influence breakdown は polity ごとに 1 回前計算して候補ループへ渡す。
    // 任命が入っても同 tick 内の他 role 評価には反映されない (1 tick 限りの staleness を許容)。
    const influenceBreakdown = getPolityInfluenceBreakdown(
      currentCtx.state,
      currentCtx.config,
      polityId as PolityId,
    )
    for (const role of POLITY_APPOINTABLE_ROLES) {
      currentCtx = tryAppointPolityOffice(
        currentCtx,
        polity,
        rulerId,
        role,
        cachedCandidates,
        influenceBreakdown,
      )
    }
  }

  // House offices
  for (const houseId of Object.keys(currentCtx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    const leaderId = getHouseLeader(currentCtx.state, houseId as HouseId)
    if (!leaderId) continue

    // v0.37: 家の投影年間収入を 1 家につき 1 回だけ計算 (役職ループ内で共有)。
    // 家役職の任命は当家収入を変えないため (share は年次の shareUpdateSystem でのみ更新)、
    // ループ前に一度確定させてよい。
    const projectedAnnualIncome = getHouseProjectedAnnualIncome(
      currentCtx.state,
      houseId as HouseId,
      currentCtx.config,
    )

    for (const role of HOUSE_APPOINTABLE_ROLES) {
      currentCtx = tryAppointHouseOffice(currentCtx, house, leaderId, role, projectedAnnualIncome)
    }
  }

  return currentCtx
}
