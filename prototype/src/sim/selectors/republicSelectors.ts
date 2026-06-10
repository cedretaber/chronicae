// v0.46 共和国整備: established commonwealth (民衆叛乱などで成立する owner-house を持たない
// 政体) を「内部政治が動く共和国」として扱うための read-only selector / helper 群。
//
// この層は sim 純粋層であり i18n/app に依存しない。RNG も使わない (全 selector は決定的)。
// 共和国関連の system (RepublicPoliticalInitializationSystem / RepublicLeadershipSystem) と
// UI (CountryDetail) がここを共通の入口として使う。

import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, PersonId, HouseId, HoldingId } from '../types/ids'
import type { PolityOrigin } from '../types/polity'
import type { OfficeRole } from '../types/office'
import type { PolityInfluenceEntry, PolityInfluenceHolderRef } from '../types/influence'
import type { PoliticalRightHolderRef } from '../types/politicalRight'
import { polityInfluenceHolderKey } from '../types/influence'
import { politicalRightHolderKey } from '../types/politicalRight'
import type { Person } from '../types/person'
import { isLifeStageAtLeast, isLivingPerson } from '../types/person'
import type { AppliedRoleKey } from './abilitySelectors'
import { getRoleScore } from './abilitySelectors'
import { getPolityInfluenceBreakdown } from './influenceSelectors'
import { getRightsByPolity } from './politicalRightSelectors'
import { getActiveOfficeHolders, getOfficeAssignments } from './officeSelectors'
import {
  getHouselessPersons,
  isLandlessHouseMember,
  isHouseLandless,
  isRulingHouse,
  isInfluentialHouseInAnyPolity,
} from './availabilitySelectors'
import { getActiveFactionMembership } from './factionSelectors'
import { getPolityTerminalProvinceIds } from './landContractSelectors'
import { getHoldingBailiffPerson } from './provinceOfficeSelectors'
import { getPersonProjectWorkload } from './projectSelectors'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'

// ---------------------------------------------------------------------------
// 4.1 共和国判定
// ---------------------------------------------------------------------------

// established commonwealth = v0.46 でいう「共和国」。active かつ kind==='commonwealth'
// かつ revoltState が established (交渉/叛乱中ではなく成立済み) のもの。
// 共和国関連の system / selector / UI はこの判定を共有し、各所で個別条件を書かない。
export function isEstablishedCommonwealthRepublic(state: WorldState, polityId: PolityId): boolean {
  const polity = state.polities[polityId]
  if (!polity) return false
  return (
    polity.active && polity.kind === 'commonwealth' && polity.revoltState?.kind === 'established'
  )
}

// ---------------------------------------------------------------------------
// 4.4 origin アクセス helper
// ---------------------------------------------------------------------------

// PolityOrigin は kind ごとに field 形状が異なる (popular_revolt=holdingIds[]+startedWeek /
// regime_changed=holdingId+week / worldgen=なし)。両 kind を取りこぼさないため helper 化する。
export function getRepublicOriginHoldingIds(origin: PolityOrigin): HoldingId[] {
  switch (origin.kind) {
    case 'popular_revolt':
      return origin.holdingIds
    case 'regime_changed_by_popular_revolt':
      return [origin.holdingId]
    case 'land_grant':
      return [origin.holdingId]
    case 'worldgen':
      return []
  }
}

export function getRepublicFoundingWeek(origin: PolityOrigin): number | undefined {
  switch (origin.kind) {
    case 'popular_revolt':
      return origin.startedWeek
    case 'regime_changed_by_popular_revolt':
      return origin.week
    case 'land_grant':
      return origin.week
    case 'worldgen':
      return undefined
  }
}

// ---------------------------------------------------------------------------
// 4.2 候補者列挙 (office seed / leader election / obtain_office target で共有)
// ---------------------------------------------------------------------------

const POLITY_NON_LEADER_ROLES: OfficeRole[] = ['administrator', 'treasurer', 'military', 'advisor']

// office role → 役職適性 (AppliedRoleKey) のマッピング (§5.1.6)。
// leader は polity 統治の総合役として diplomacy を主軸に評価する。
const ROLE_TO_APPLIED_ROLE: Record<OfficeRole, AppliedRoleKey> = {
  administrator: 'governance',
  treasurer: 'stewardship',
  military: 'warCommand',
  advisor: 'diplomacy',
  leader: 'diplomacy',
}

export function appliedRoleKeyForOfficeRole(role: OfficeRole): AppliedRoleKey {
  return ROLE_TO_APPLIED_ROLE[role]
}

// 候補列挙の基本除外: 生存・非 placeholder・young_adulthood 以上・対象 Polity への
// attitude が極端に悪くない・project workload が過剰でない。
function isEligibleRepublicCandidate(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  polityId: PolityId,
): boolean {
  const person = state.persons[personId]
  if (!isLivingPerson(person)) return false
  if (!isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) return false

  // 対象 Polity への attitude が極端に悪い人物は共和国政治に参加しない。
  const attitude = getAttitudeOrDefault(state, person, { kind: 'polity', id: polityId })
  if (attitude.affection <= config.republicCandidateMinAffection) return false

  // 既に project を抱えすぎている人物は除外する (過負荷)。
  const workload = getPersonProjectWorkload(state, config, personId)
  if (workload > config.republicCandidateMaxWorkload) return false

  return true
}

// established commonwealth の政治候補者を広めに列挙する (§4.2)。
// 列挙は広く・用途別の scoring/最終フィルタは呼出側 (scoreRepublicOfficeCandidate /
// scoreRepublicLeaderCandidate + isRoleEligibleBySex) の責務。
// 返却は PersonId 昇順で決定的。RNG 不使用。
export function getRepublicPoliticalCandidatePersons(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
): PersonId[] {
  if (!isEstablishedCommonwealthRepublic(state, polityId)) return []
  const polity = state.polities[polityId]
  if (!polity) return []

  const org = { kind: 'polity' as const, id: polityId }
  const candidates = new Set<string>()
  const add = (id: PersonId): void => {
    candidates.add(id)
  }

  // 1. 現 polity:leader / 2. polity office holder
  for (const role of ['leader', ...POLITY_NON_LEADER_ROLES] as OfficeRole[]) {
    for (const holder of getActiveOfficeHolders(state, org, role)) add(holder)
  }

  // 3. PoliticalRight holder / 4. holder House の leader・member
  for (const right of getRightsByPolity(state, polityId)) {
    if (right.holder.kind === 'person') {
      add(right.holder.id)
    } else {
      const house = state.houses[right.holder.id]
      if (house) for (const memberId of house.memberIds) add(memberId)
    }
  }

  // 5. commonwealth origin の leaderPersonId (land_grant origin は founderPersonId)
  if (
    polity.origin.kind === 'popular_revolt' ||
    polity.origin.kind === 'regime_changed_by_popular_revolt'
  ) {
    add(polity.origin.leaderPersonId)
  } else if (polity.origin.kind === 'land_grant') {
    add(polity.origin.founderPersonId)
  }

  // 6. 対象 Holding / Province に関係する人物 (holding bailiff + origin holdings)
  const holdingIds = new Set<string>(
    getRepublicOriginHoldingIds(polity.origin).map((id) => id as string),
  )
  for (const provinceId of getPolityTerminalProvinceIds(state, polityId)) {
    const province = state.provinces[provinceId]
    if (province) for (const hid of province.holdingIds) holdingIds.add(hid)
  }
  for (const hid of holdingIds) {
    const bailiff = getHoldingBailiffPerson(state, hid as HoldingId)
    if (bailiff) add(bailiff.id)
  }

  // 7. houseless person / 8. recruitable outsider / 9. landless House member
  for (const id of getHouselessPersons(state)) add(id)

  // perf (v0.47): step 8/9 は per-person 判定の中に家単位の高コスト判定 (isRulingHouse /
  //   isInfluentialHouseInAnyPolity = 全 active polity × influence breakdown / isHouseLandless)
  //   を内包し、同家メンバーで結果が同一。呼出スコープのローカル memo で 1 家 1 回に抑える。
  //   memo はこの関数の 1 呼出内に限定 (module レベル / 呼出跨ぎ禁止 — 呼出側 system が
  //   officeIndex 等を変異させるため stale 化する)。
  //   走査は livingPersonIds (死者除外): 死者は最終フィルタ isEligibleRepublicCandidate →
  //   isLivingPerson で必ず落ちるため出力は Object.keys(state.persons) 走査と同一。
  //   判定構造は availabilitySelectors の isRecruitableOutsiderPerson /
  //   isPoliticallyEngagedPerson / isLandlessHouseMember と同一に保つこと (変更時は要同期)。
  const houseEngagedMemo = new Map<string, boolean>()
  const isEngagedHouse = (houseId: HouseId): boolean => {
    const cached = houseEngagedMemo.get(houseId)
    if (cached !== undefined) return cached
    const v = isRulingHouse(state, houseId) || isInfluentialHouseInAnyPolity(state, config, houseId)
    houseEngagedMemo.set(houseId, v)
    return v
  }
  const houseLandlessMemo = new Map<string, boolean>()
  const isLandlessHouseMemo = (houseId: HouseId): boolean => {
    const cached = houseLandlessMemo.get(houseId)
    if (cached !== undefined) return cached
    const v = isHouseLandless(state, houseId)
    houseLandlessMemo.set(houseId, v)
    return v
  }
  // 外交劇 delegate は person ごとの plays 全走査を避けるため 1 回だけ集合化 (membership 同値)。
  const activePlayDelegates = new Set<string>()
  for (const play of Object.values(state.diplomaticPlays)) {
    if (!play) continue
    if (play.status !== 'active' && play.status !== 'escalated') continue
    if (play.initiatorDelegatePersonId) activePlayDelegates.add(play.initiatorDelegatePersonId)
    if (play.targetDelegatePersonId) activePlayDelegates.add(play.targetDelegatePersonId)
  }
  // isPoliticallyEngagedPerson のローカル展開 (家判定のみ memo、他は同一構造)。
  const isEngagedPerson = (personId: PersonId, person: Person): boolean => {
    if (person.houseId && isEngagedHouse(person.houseId)) return true
    if (getActiveFactionMembership(state, personId) !== undefined) return true
    for (const oid of state.officeIndex.byHolderPerson[personId as string] ?? []) {
      const o = state.officeAssignments[oid]
      if (o && o.active) return true
    }
    for (const pid of state.projectIndex.bySupervisorPerson[`person:${personId}`] ?? []) {
      const project = state.projects[pid]
      if (project && project.status === 'active') return true
    }
    return activePlayDelegates.has(personId)
  }
  for (const id of state.livingPersonIds) {
    const person = state.persons[id]
    if (!person) continue
    // isRecruitableOutsiderPerson 同値: alive && !placeholder && !engaged
    const recruitable =
      person.alive && person.kind !== 'placeholder' && !isEngagedPerson(id, person)
    // isLandlessHouseMember 同値: houseId を持ち、その家が landless
    if (recruitable || (person.houseId !== undefined && isLandlessHouseMemo(person.houseId))) {
      add(id)
    }
  }

  // 最終的に基本除外を適用し、PersonId 昇順で返す。
  return (Array.from(candidates) as PersonId[])
    .filter((id) => isEligibleRepublicCandidate(state, config, id, polityId))
    .sort((a, b) => (a as string).localeCompare(b))
}

// person が foothold (足がかり) を持つ established commonwealth 共和国の polityId を返す
// (§5.3.3)。obtain_office の commonwealth 向け target 拡張で使う。foothold =
//   - 本人が active な polity office を持つ
//   - 本人が personal PoliticalRight を持つ
//   - 本人の House が PoliticalRight を持つ / House member が polity office を持つ
// established commonwealth 共和国のみに絞る (normal polity は従来の土地ベース候補のまま)。
// 返却は polityId 昇順で決定的。RNG 不使用。
export function getRepublicFootholdPolityIds(state: WorldState, personId: PersonId): PolityId[] {
  const person = state.persons[personId]
  if (!person) return []
  const result = new Set<string>()
  const addIfRepublic = (pid: PolityId | undefined): void => {
    if (pid && isEstablishedCommonwealthRepublic(state, pid)) result.add(pid)
  }

  // 本人の active polity office
  for (const oid of state.officeIndex.byHolderPerson[personId as string] ?? []) {
    const o = state.officeAssignments[oid]
    if (o && o.active && o.organization.kind === 'polity') addIfRepublic(o.organization.id)
  }
  // 本人の personal PoliticalRight
  for (const rid of state.politicalRightIndex.byHolder[
    politicalRightHolderKey({ kind: 'person', id: personId })
  ] ?? []) {
    const r = state.politicalRights[rid]
    if (r) addIfRepublic(r.polityId)
  }
  // House-level foothold (house right + member office)
  if (person.houseId) {
    const house = state.houses[person.houseId]
    if (house) {
      for (const rid of state.politicalRightIndex.byHolder[
        politicalRightHolderKey({ kind: 'house', id: person.houseId })
      ] ?? []) {
        const r = state.politicalRights[rid]
        if (r) addIfRepublic(r.polityId)
      }
      for (const memberId of house.memberIds) {
        for (const oid of state.officeIndex.byHolderPerson[memberId as string] ?? []) {
          const o = state.officeAssignments[oid]
          if (o && o.active && o.organization.kind === 'polity') addIfRepublic(o.organization.id)
        }
      }
    }
  }

  return (Array.from(result) as PolityId[]).sort((a, b) => (a as string).localeCompare(b))
}

// ---------------------------------------------------------------------------
// 用途別 scoring (§4.2)。RNG 不使用・house 非依存 (houseless 候補にも使える)。
// 性別役職適格 (isRoleEligibleBySex) は score に混ぜず、呼出側の最終フィルタで適用する。
// ---------------------------------------------------------------------------

function commonCandidateScore(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  polityId: PolityId,
): number {
  const person = state.persons[personId]
  if (!person) return 0
  let score = 0
  score += person.legacyPrestige * config.republicCandidatePrestigeFactor
  score +=
    Math.min(person.wealth, config.republicCandidateWealthCap) *
    config.republicCandidateWealthFactor
  const attitude = getAttitudeOrDefault(state, person, { kind: 'polity', id: polityId })
  score += attitude.affection * config.republicCandidateAttitudeFactor
  // 既存 office 経験 (この polity の office を 1 つでも持つ) はボーナス。
  const org = { kind: 'polity' as const, id: polityId }
  const hasOffice = getOfficeAssignments(state, org).some(
    (o) => o.active && o.holderPersonId === personId,
  )
  if (hasOffice) score += config.republicOfficeExperienceBonus
  // 無家・没落家の人材は共和国政治への参入動機が強い (寡頭化前夜の功臣プール)。
  if (!person.houseId) score += config.republicHouselessFounderBonus
  else if (isLandlessHouseMember(state, personId)) score += config.republicLandlessHouseMemberBonus
  const workload = getPersonProjectWorkload(state, config, personId)
  score -= workload * config.republicWorkloadPenaltyFactor
  return score
}

// init seed 用 scoring: 役職適性 (getRoleScore) を主軸に共通項を加える。
export function scoreRepublicOfficeCandidate(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  polityId: PolityId,
  role: OfficeRole,
): number {
  const roleScore = getRoleScore(state, personId, appliedRoleKeyForOfficeRole(role))
  return roleScore + commonCandidateScore(state, config, personId, polityId)
}

// leader election 用 scoring: leader 適性 + 共通項。
export function scoreRepublicLeaderCandidate(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  polityId: PolityId,
): number {
  const roleScore = getRoleScore(state, personId, appliedRoleKeyForOfficeRole('leader'))
  return roleScore + commonCandidateScore(state, config, personId, polityId)
}

// ---------------------------------------------------------------------------
// 4.3 共和国の権力分布 (read-only)
// ---------------------------------------------------------------------------

export type RepublicPowerProfile = {
  polityId: PolityId
  topHolder?: PolityInfluenceEntry
  topPercent: number
  top3Percent: number
  effectiveHolderCount: number
  leaderPersonId?: PersonId
  leaderInfluencePercent: number
  leaderHouseId?: HouseId
  leaderHouseInfluencePercent?: number
  officeControlByHolder: Array<{
    holder: PolityInfluenceHolderRef
    officeCount: number
  }>
  rightControlByHolder: Array<{
    holder: PoliticalRightHolderRef
    rightCount: number
  }>
}

// holder key 昇順の決定的タイブレーク (count 降順が同値のとき)。
function compareByCountThenKey(
  a: { count: number; key: string },
  b: { count: number; key: string },
): number {
  if (b.count !== a.count) return b.count - a.count
  return a.key.localeCompare(b.key)
}

export function getRepublicPowerProfile(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
): RepublicPowerProfile {
  const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
  const positiveEntries = breakdown.entries.filter((e) => e.total > 0 && e.percent > 0)

  // effectiveHolderCount = Herfindahl 型の逆数 (total>0 && percent>0 の entry のみ)。
  const shares = positiveEntries.map((e) => e.percent / 100)
  const effectiveHolderCount =
    shares.length === 0 ? 0 : 1 / shares.reduce((sum, s) => sum + s * s, 0)

  // entries は total 降順 (influenceSelectors 保証)。
  const topHolder = breakdown.entries[0]
  const topPercent = topHolder?.percent ?? 0
  const top3Percent = breakdown.entries.slice(0, 3).reduce((sum, e) => sum + e.percent, 0)

  // leader の influence / 家。
  const leaderPersonId = state.polities[polityId]
    ? getActiveOfficeHolders(state, { kind: 'polity', id: polityId }, 'leader')[0]
    : undefined
  const leaderEntry = leaderPersonId
    ? breakdown.entries.find((e) => e.holder.kind === 'person' && e.holder.id === leaderPersonId)
    : undefined
  const leaderInfluencePercent = leaderEntry?.percent ?? 0
  const leaderPerson = leaderPersonId ? state.persons[leaderPersonId] : undefined
  const leaderHouseId = leaderPerson?.houseId
  const leaderHouseEntry = leaderHouseId
    ? breakdown.entries.find((e) => e.holder.kind === 'house' && e.holder.id === leaderHouseId)
    : undefined

  // office control: 対象 polity の active office を holder 別に集計。
  const officeCounts = new Map<string, { holder: PolityInfluenceHolderRef; count: number }>()
  for (const office of getOfficeAssignments(state, { kind: 'polity', id: polityId })) {
    if (!office.active) continue
    const holder: PolityInfluenceHolderRef = { kind: 'person', id: office.holderPersonId }
    const key = polityInfluenceHolderKey(holder)
    const cur = officeCounts.get(key)
    if (cur) cur.count += 1
    else officeCounts.set(key, { holder, count: 1 })
  }
  const officeControlByHolder = Array.from(officeCounts.values())
    .map((v) => ({
      holder: v.holder,
      officeCount: v.count,
      key: polityInfluenceHolderKey(v.holder),
    }))
    .sort((a, b) =>
      compareByCountThenKey(
        { count: a.officeCount, key: a.key },
        { count: b.officeCount, key: b.key },
      ),
    )
    .map((v) => ({ holder: v.holder, officeCount: v.officeCount }))

  // right control: 対象 polity の PoliticalRight を holder 別に集計。
  const rightCounts = new Map<string, { holder: PoliticalRightHolderRef; count: number }>()
  for (const right of getRightsByPolity(state, polityId)) {
    const key = politicalRightHolderKey(right.holder)
    const cur = rightCounts.get(key)
    if (cur) cur.count += 1
    else rightCounts.set(key, { holder: right.holder, count: 1 })
  }
  const rightControlByHolder = Array.from(rightCounts.values())
    .map((v) => ({ holder: v.holder, rightCount: v.count, key: politicalRightHolderKey(v.holder) }))
    .sort((a, b) =>
      compareByCountThenKey(
        { count: a.rightCount, key: a.key },
        { count: b.rightCount, key: b.key },
      ),
    )
    .map((v) => ({ holder: v.holder, rightCount: v.rightCount }))

  const profile: RepublicPowerProfile = {
    polityId,
    topPercent,
    top3Percent,
    effectiveHolderCount,
    leaderInfluencePercent,
    officeControlByHolder,
    rightControlByHolder,
  }
  // exactOptionalPropertyTypes: undefined は代入せず omit する。
  if (topHolder) profile.topHolder = topHolder
  if (leaderPersonId) profile.leaderPersonId = leaderPersonId
  if (leaderHouseId) {
    profile.leaderHouseId = leaderHouseId
    profile.leaderHouseInfluencePercent = leaderHouseEntry?.percent ?? 0
  }
  return profile
}
