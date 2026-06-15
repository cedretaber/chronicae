// v0.42 §5: Polity Influence read-model selector。
//
// 旧 shareUpdateSystem の polity 枝 (年次再計算 cache) を「随時計算の selector」に昇格し、
// domain 別 breakdown に分解したもの。係数は polityShare* 流用 (config は polityInfluence* — §18)。
// 旧実装の shareYearlyRetentionRate は捨てる (全 entry に同係数が掛かるため percent に無意味)。
//
// entry 母集合 (§5.3) = 以下の和集合:
//   - getPolityHouseIds (土地ベース) の active House
//   - 対象 Polity の active office holder の House (houseless なら Person entry)
//   - 対象 Polity の PoliticalRight holder (House / houseless Person)
//   - 対象 Polity に anchor された active Faction の leader の House
//   - ownerHouseId === undefined の polity の leader Person (commonwealth / 反乱政体)
//   - ownerHouse / 非 ownerHouse 出身 leader の House (ruler domain)
//
// perf (§21.2): province / office / right / faction を歩くため、候補者ループ内で
// 何度も呼ばない。呼出側は polity ごとに 1 回計算して cache を渡すこと。

import type { WorldState } from '../types/world'
import type { PolityId, PersonId, HouseId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import type {
  PolityInfluenceBreakdown,
  PolityInfluenceDomain,
  PolityInfluenceEntry,
  PolityInfluenceHolderRef,
  PolityInfluenceGroup,
  PolityInfluenceGroupSegment,
  GroupedPolityInfluence,
} from '../types/influence'
import { polityInfluenceHolderKey } from '../types/influence'
import { personReputationOrganizationKey } from '../types/personReputation'
import { getCurrentPersonReputationScore } from './personReputationSelectors'
import { isLivingPerson } from '../types/person'
import { getOfficeAssignments, getPolityLeader, getHouseLeader } from './officeSelectors'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'
import {
  getPolityHouseIds,
  getHouseProvinceIdsByPolity,
  getPolityProvinceIds,
} from './polityRelations'
import { getRightsByPolity } from './politicalRightSelectors'
import { PLACEHOLDER_PERSON_ID } from '../types/person'
import { getHouseShares, getHouseTotalRawPower } from './shareSelectors'

type EntryAccumulator = {
  holder: PolityInfluenceHolderRef
  byDomain: Partial<Record<PolityInfluenceDomain, number>>
}

export function getPolityInfluenceBreakdown(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
): PolityInfluenceBreakdown {
  const polity = state.polities[polityId]
  if (!polity || !polity.active) {
    return { polityId, entries: [], totalScore: 0 }
  }

  const entries = new Map<string, EntryAccumulator>()

  function ensureEntry(holder: PolityInfluenceHolderRef): EntryAccumulator {
    const key = polityInfluenceHolderKey(holder)
    let entry = entries.get(key)
    if (!entry) {
      entry = { holder, byDomain: {} }
      entries.set(key, entry)
    }
    return entry
  }

  function add(holder: PolityInfluenceHolderRef, domain: PolityInfluenceDomain, value: number) {
    if (value === 0) return
    const entry = ensureEntry(holder)
    entry.byDomain[domain] = (entry.byDomain[domain] ?? 0) + value
  }

  // person → 寄与先 holder (House 所属なら House、houseless なら Person entry — §5.3)
  function holderForPerson(personId: PersonId): PolityInfluenceHolderRef | undefined {
    const person = state.persons[personId]
    if (!isLivingPerson(person)) return undefined
    if (person.houseId !== undefined) {
      const house = state.houses[person.houseId]
      if (house && house.active) return { kind: 'house', id: person.houseId }
      return undefined
    }
    return { kind: 'person', id: personId }
  }

  // 影響力個人中心化 Phase 2b: 個人が保持する position (役職・代官・person 保有任命権) の
  // influence は家に fold せず person entry に直接計上する (個人帰属の核)。houseless でも同じ。
  // 家保有の土地・owner bonus・house 保有任命権は引き続き house entry (holderForPerson)。
  function livingPersonEntry(personId: PersonId): PolityInfluenceHolderRef | undefined {
    return isLivingPerson(state.persons[personId]) ? { kind: 'person', id: personId } : undefined
  }

  // --- 母集合: 土地ベースの House ---
  const landHouseIds = getPolityHouseIds(state, polityId)
  for (const houseId of landHouseIds) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue
    ensureEntry({ kind: 'house', id: houseId })
  }

  // --- ruler domain (§5.4) ---
  const leaderId = getPolityLeader(state, polityId)
  if (polity.ownerHouseId !== undefined) {
    const ownerHouse = state.houses[polity.ownerHouseId]
    if (ownerHouse && ownerHouse.active) {
      add(
        { kind: 'house', id: polity.ownerHouseId },
        'ruler',
        config.polityInfluenceOwnerHouseBonus,
      )
    }
    // 非 ownerHouse 出身 leader の家に補正 (leader ∈ ownerHouse なら二重計上しない)
    if (leaderId !== undefined) {
      const leader = state.persons[leaderId]
      if (
        isLivingPerson(leader) &&
        leader.houseId !== undefined &&
        leader.houseId !== polity.ownerHouseId
      ) {
        const leaderHouse = state.houses[leader.houseId]
        if (leaderHouse && leaderHouse.active) {
          add(
            { kind: 'house', id: leader.houseId },
            'ruler',
            config.polityInfluenceLeaderHouseBonus,
          )
        }
      }
    }
  } else if (leaderId !== undefined) {
    // commonwealth / 反乱政体: leader Person を直接 entry にする (§5.3)
    const leader = state.persons[leaderId]
    if (isLivingPerson(leader)) {
      add({ kind: 'person', id: leaderId }, 'ruler', config.polityInfluenceOwnerHouseBonus)
    }
  }

  // --- office domain (§5.4 — leader 除外) ---
  // 影響力個人中心化 Phase 2b: 役職 influence は保有者「個人」に計上する (家に fold しない)。
  // office-overlap house bonus は house-level の概念ゆえ撤去 (個人帰属では適用不能)。
  const officeAssignments = getOfficeAssignments(state, { kind: 'polity', id: polityId }).filter(
    (o) => o.active && o.role !== 'leader',
  )
  for (const office of officeAssignments) {
    const holder = livingPersonEntry(office.holderPersonId)
    if (!holder) continue
    add(holder, 'office', config.polityInfluenceOfficeFactor)
    // military domain: polity:military office holder (office domain と重複計上 — §5.4 で許容)
    if (office.role === 'military') {
      add(holder, 'military', config.polityInfluenceMilitaryOfficeBonus)
    }
  }

  // --- PoliticalRight: military / land_administration / office domain (§5.4) ---
  // 影響力個人中心化 Phase 2b: person 保有任命権の influence は person entry に計上する
  // (家に fold しない)。house 保有任命権は house entry。Phase 4 で acquire 個人化された
  // person-held right がここで person influence を生む。
  for (const right of getRightsByPolity(state, polityId)) {
    const holder: PolityInfluenceHolderRef | undefined =
      right.holder.kind === 'house'
        ? state.houses[right.holder.id]?.active
          ? { kind: 'house', id: right.holder.id }
          : undefined
        : livingPersonEntry(right.holder.id)
    if (!holder) continue
    switch (right.target.kind) {
      case 'regiment': {
        // destroyed は寄与 0 (right は存続 — §11.3)
        const regiment = state.regiments[right.target.regimentId]
        if (regiment && regiment.status === 'active') {
          add(holder, 'military', config.polityInfluenceRegimentControlFactor)
        } else {
          ensureEntry(holder)
        }
        break
      }
      case 'holding_office_role':
        add(holder, 'land_administration', config.polityInfluenceHoldingOfficeAppointmentFactor)
        break
      case 'polity_office_role':
        // 影響力個人中心化 Phase 2: 役職任命権 保有者も直接 influence を得る (3 種任命権を
        // 揃える §6-7)。任命された役職者の office 寄与とは別計上で両立する。person holder は
        // person entry に計上される (Phase 4 で acquire 個人化されると production で活性化)。
        add(holder, 'office', config.polityInfluencePolityOfficeAppointmentFactor)
        break
    }
  }

  // --- land_administration: 現職 bailiff の House (§5.4) ---
  for (const provinceId of getPolityProvinceIds(state, polityId)) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const holdingId of province.holdingIds) {
      if (state.holdingTerminalPolityCache[holdingId] !== polityId) continue
      const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]
      if (assignmentId === undefined) continue
      const assignment = state.holdingOfficeAssignments[assignmentId]
      if (!assignment || !assignment.active) continue
      if (assignment.holderPersonId === PLACEHOLDER_PERSON_ID) continue
      // 影響力個人中心化 Phase 2b: 代官 (現職 bailiff) も個人に計上する
      const holder = livingPersonEntry(assignment.holderPersonId)
      if (!holder) continue
      add(holder, 'land_administration', config.polityInfluenceHoldingOfficeAppointmentFactor)
    }
  }

  // --- faction domain: anchor faction leader の House のみ (§5.4 最小実装) ---
  for (const factionId of state.factionIndex.byPolity[polityId] ?? []) {
    const faction = state.factions[factionId]
    if (!faction || !faction.active) continue
    const holder = holderForPerson(faction.leaderPersonId)
    if (!holder || holder.kind !== 'house') continue
    add(holder, 'faction', config.polityInfluenceFactionFactor)
  }

  // --- reputation domain (影響力個人中心化 Phase 1a): polity-tag 評判の現在値合計 ---
  // 成果項。評判は person キー (個人帰属) なので holderForPerson で家に fold せず、
  // {kind:'person'} entry に直接加算する → housed person でも成果は本人のものになる
  // ("家は個人の権力基盤")。母集合にも評判保有 person を列挙する (役職なし評判保有者の漏れ防止)。
  // byOrganization index で polity-tag 評判を引く (byPerson 全走査の perf 退行を回避 — R1)。
  // 集計後に entry ごとに reputation 項を 0 床にする (負評判で「反影響力」を作らない — §6/3b)。
  const reputationOrgKey = personReputationOrganizationKey({ kind: 'polity', id: polityId })
  const reputationIds = state.personReputationIndex.byOrganization[reputationOrgKey] ?? []
  for (const repId of [...reputationIds].sort()) {
    const reputation = state.personReputations[repId]
    if (!reputation) continue
    const person = state.persons[reputation.personId]
    if (!isLivingPerson(person)) continue
    const score = getCurrentPersonReputationScore(reputation, state.absoluteWeek, config)
    add(
      { kind: 'person', id: reputation.personId },
      'reputation',
      score * config.polityInfluenceReputationFactor,
    )
  }
  // reputation domain の 0 床 (per-entry sum・per-record でない — 正負レコードの打ち消し後に clamp)
  for (const entry of entries.values()) {
    const rep = entry.byDomain.reputation
    if (rep !== undefined && rep < 0) entry.byDomain.reputation = 0
  }

  // --- base / landed_power / wealth / prestige: House entry に一律 (§5.4) ---
  // 影響力個人中心化 (§6.64a-(1)): wealth / base / prestige の soft-power factor は 0 にしたため、
  // この経路で House に付くのは landed_power (構造項・対象 Polity 内の province 数ベース) のみ。
  // commonwealth (反乱独立政体) でも分岐せず一律処理するが、soft-power が 0 なので「embed した
  // 富豪家が wealth で支配 holder になる」旧 (v0.45.5) 挙動は発生しない。僭主は構造項 (役職・任命権)
  // ＋成果項 (評判) を握った「個人」(person entry) として創発する。base / wealth / prestige の行は
  // config-gated で残置 (将来 prestige を間接効果に再接続する余地・§6.64a-(1))。
  for (const entry of entries.values()) {
    if (entry.holder.kind !== 'house') continue
    const house = state.houses[entry.holder.id]
    if (!house || !house.active) continue
    entry.byDomain.base = (entry.byDomain.base ?? 0) + config.polityInfluenceBase
    // landed_power: 対象 Polity 内限定 (§12.3 踏襲) + military proxy (province 数ベース)
    const provinceCount = getHouseProvinceIdsByPolity(state, entry.holder.id, polityId).length
    if (provinceCount > 0) {
      const landed =
        provinceCount * config.polityInfluenceProvinceFactor +
        provinceCount * 10 * config.polityInfluenceMilitaryFactor
      entry.byDomain.landed_power = (entry.byDomain.landed_power ?? 0) + landed
    }
    if (house.wealth > 0) {
      entry.byDomain.wealth =
        (entry.byDomain.wealth ?? 0) + house.wealth * config.polityInfluenceWealthFactor
    }
    if (house.legacyPrestige > 0) {
      entry.byDomain.prestige =
        (entry.byDomain.prestige ?? 0) + house.legacyPrestige * config.polityInfluencePrestigeFactor
    }
  }

  // --- 集計 ---
  const built: PolityInfluenceEntry[] = []
  let totalScore = 0
  for (const entry of entries.values()) {
    let total = 0
    for (const v of Object.values(entry.byDomain)) total += v ?? 0
    built.push({ holder: entry.holder, byDomain: entry.byDomain, total, percent: 0 })
    totalScore += total
  }
  for (const e of built) {
    e.percent = totalScore > 0 ? (e.total / totalScore) * 100 : 0
  }
  built.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return polityInfluenceHolderKey(a.holder).localeCompare(polityInfluenceHolderKey(b.holder))
  })

  return { polityId, entries: built, totalScore }
}

export function getActorInfluenceInPolity(
  state: WorldState,
  config: SimulationConfig,
  actor: PolityInfluenceHolderRef,
  polityId: PolityId,
): { score: number; percent: number } {
  const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
  return getActorInfluenceFromBreakdown(breakdown, actor)
}

// 前計算済み breakdown から actor の influence を引く (候補者ループでの再計算回避 — §21.2)。
export function getActorInfluenceFromBreakdown(
  breakdown: PolityInfluenceBreakdown,
  actor: PolityInfluenceHolderRef,
): { score: number; percent: number } {
  const key = polityInfluenceHolderKey(actor)
  const entry = breakdown.entries.find((e) => polityInfluenceHolderKey(e.holder) === key)
  if (!entry) return { score: 0, percent: 0 }
  return { score: entry.total, percent: entry.percent }
}

// 家の支配率 (影響力個人中心化): 家 entry + 家中の (生存) メンバー person entry の influence を合算する。
// 「家の中で対立はあっても、国の支配は家全体で見る」— 個人帰属化した influence (役職 / 評判 /
// person 保有任命権 / 代官) を、家単位の支配力評価では再集約する。役職取得などの動機ゲート (§13.3) /
// 死亡時継承判定 (§6.64a-(8)) / 家断絶時の領地継承先 / 有力家門判定がこの定義を共有する。
// 余剰金分配の収入投影 (houseFinanceSelectors) は実配分が entry 単位なので集約しない (過大投影回避)。
export function getHouseAggregateInfluenceFromBreakdown(
  state: WorldState,
  breakdown: PolityInfluenceBreakdown,
  houseId: HouseId,
): { score: number; percent: number } {
  const house = state.houses[houseId]
  const memberSet = new Set<string>(house ? house.memberIds.map((id) => id as string) : [])
  let score = 0
  for (const entry of breakdown.entries) {
    if (entry.holder.kind === 'house') {
      if (entry.holder.id === houseId) score += entry.total
    } else if (memberSet.has(entry.holder.id)) {
      score += entry.total
    }
  }
  const percent = breakdown.totalScore > 0 ? (score / breakdown.totalScore) * 100 : 0
  return { score, percent }
}

export function getHouseAggregateInfluenceInPolity(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
  polityId: PolityId,
): { score: number; percent: number } {
  const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
  return getHouseAggregateInfluenceFromBreakdown(state, breakdown, houseId)
}

// breakdown を「家の支配率」単位にグループ化する (UI 二重円 + グループ表示用 read-model)。
//   - 家本体 entry + 家中メンバー person entry を 1 グループに束ね、aggregatePercent = segments の和。
//   - person.houseId が active な家を指す場合のみその家に束ねる。houseless / 指す家が
//     inactive・不在の person は houseId=undefined の単独グループ (家アークを持たない)。
//   - segments は家本体 (kind:'house') を先頭に、メンバーを percent 降順。
//   - minGroupPercent 未満のグループは othersPercent に集約 (家無し小物・小家門を「その他」へ)。
// 表示閾値は config 化せず呼出側 (UI) が定数で渡す。read-only (tick / integrity 非経路)。
export function getGroupedPolityInfluence(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  minGroupPercent = 0,
): GroupedPolityInfluence {
  const breakdown = getPolityInfluenceBreakdown(state, config, polityId)

  // groupKey -> { houseId, segments }
  // houseId が定まるグループは `house:${houseId}`、houseless person は `person:${personId}`。
  type Building = { houseId: HouseId | undefined; segments: PolityInfluenceGroupSegment[] }
  const groups = new Map<string, Building>()

  const segmentOf = (e: PolityInfluenceEntry): PolityInfluenceGroupSegment => ({
    holder: e.holder,
    byDomain: e.byDomain,
    percent: e.percent,
  })

  for (const entry of breakdown.entries) {
    if (entry.holder.kind === 'house') {
      const key = `house:${entry.holder.id}`
      const g = groups.get(key) ?? { houseId: entry.holder.id, segments: [] }
      g.segments.push(segmentOf(entry))
      groups.set(key, g)
      continue
    }
    // person entry: active な所属家があればその家グループへ、なければ単独グループ。
    const person = state.persons[entry.holder.id]
    const houseId = person?.houseId
    const house = houseId ? state.houses[houseId] : undefined
    if (houseId && house && house.active) {
      const key = `house:${houseId}`
      const g = groups.get(key) ?? { houseId, segments: [] }
      g.segments.push(segmentOf(entry))
      groups.set(key, g)
    } else {
      const key = `person:${entry.holder.id}`
      groups.set(key, { houseId: undefined, segments: [segmentOf(entry)] })
    }
  }

  const finalize = (b: Building): PolityInfluenceGroup => {
    // 家本体を先頭に、メンバーを percent 降順 (同値は holder key 昇順)。
    const segments = [...b.segments].sort((x, y) => {
      const xHouse = x.holder.kind === 'house'
      const yHouse = y.holder.kind === 'house'
      if (xHouse !== yHouse) return xHouse ? -1 : 1
      if (y.percent !== x.percent) return y.percent - x.percent
      return polityInfluenceHolderKey(x.holder).localeCompare(polityInfluenceHolderKey(y.holder))
    })
    const aggregateByDomain: Partial<Record<PolityInfluenceDomain, number>> = {}
    let aggregatePercent = 0
    for (const s of segments) {
      aggregatePercent += s.percent
      for (const [domain, v] of Object.entries(s.byDomain)) {
        if (typeof v !== 'number') continue
        const d = domain as PolityInfluenceDomain
        aggregateByDomain[d] = (aggregateByDomain[d] ?? 0) + v
      }
    }
    return { houseId: b.houseId, aggregatePercent, aggregateByDomain, segments }
  }

  const all = [...groups.entries()]
    .map(([key, b]) => ({ key, group: finalize(b) }))
    .sort((a, z) => {
      if (z.group.aggregatePercent !== a.group.aggregatePercent) {
        return z.group.aggregatePercent - a.group.aggregatePercent
      }
      return a.key.localeCompare(z.key)
    })

  const shown: PolityInfluenceGroup[] = []
  const othersByDomain: Partial<Record<PolityInfluenceDomain, number>> = {}
  let othersPercent = 0
  for (const { group } of all) {
    if (group.aggregatePercent >= minGroupPercent) {
      shown.push(group)
    } else {
      othersPercent += group.aggregatePercent
      for (const [domain, v] of Object.entries(group.aggregateByDomain)) {
        if (typeof v !== 'number') continue
        const d = domain as PolityInfluenceDomain
        othersByDomain[d] = (othersByDomain[d] ?? 0) + v
      }
    }
  }

  return { polityId, groups: shown, othersPercent, othersByDomain }
}

// v0.43 §9.3: Polity の「targetPolityId への influence 加重意見」(-100..100)。
//   breakdown の各 holder の attitude を influence percent で加重平均する。
//   - Person holder → 本人の attitude / House holder → house leader の attitude
//   - leader 不在の House entry は weight ごと除外 (中立 0 と混同しない)
//   - 有効 holder が 0 なら 0 (中立)
//   - breakdown.entries の組込ソート順 (total 降順 + holder key 昇順) のまま畳み込む (決定論)
//   v0.43 では joinScore の休眠項 (weight 0) として配線される。呼出側は polity ごとに
//   breakdown を 1 回計算して渡すこと (§21.2 と同じ規律)。
export function getWeightedOpinionFromInfluenceBreakdown(
  state: WorldState,
  breakdown: PolityInfluenceBreakdown,
  targetPolityId: PolityId,
): number {
  let weightedSum = 0
  let weightTotal = 0
  for (const entry of breakdown.entries) {
    const personId =
      entry.holder.kind === 'person' ? entry.holder.id : getHouseLeader(state, entry.holder.id)
    if (personId === undefined) continue
    const person = state.persons[personId]
    if (!isLivingPerson(person)) continue
    const attitude = getAttitudeOrDefault(state, person, {
      kind: 'polity',
      id: targetPolityId,
    })
    // opinion 数値化 (§9.3): 0.7*affection + 0.3*respect、clamp -100..100
    const opinion = Math.max(-100, Math.min(100, 0.7 * attitude.affection + 0.3 * attitude.respect))
    weightedSum += opinion * entry.percent
    weightTotal += entry.percent
  }
  if (weightTotal <= 0) return 0
  return weightedSum / weightTotal
}

// v0.47 §11.7: Polity 譲渡 (分家創設) の SOFT 同意。HouseShare holder の加重意見 (-100..100)。
//   getWeightedOpinionFromInfluenceBreakdown の HouseShare 版。各 holder の percent を weight に、
//   petitioner (targetPersonId) への attitude を加重平均する。
//   - holder ごとに rawPower を集約し holderPersonId 昇順で畳む (決定論)
//   - petitioner 本人の自己票は除外 (subject であり voter ではない)
//   - house leader は追加 weight を持つが絶対拒否権は持たない (§11.7)
//   - 生存 holder が 0 なら 0 (中立)
//   Project progress / Task outcome 補正は呼出側 (resolveImmediateStage) で加える。
export function getWeightedOpinionFromHouseShareholders(
  state: WorldState,
  houseId: HouseId,
  targetPersonId: PersonId,
): number {
  const leaderId = getHouseLeader(state, houseId)
  const total = getHouseTotalRawPower(state, houseId)
  if (total <= 0) return 0

  const byHolder = new Map<PersonId, number>()
  for (const share of getHouseShares(state, houseId)) {
    byHolder.set(share.holderPersonId, (byHolder.get(share.holderPersonId) ?? 0) + share.rawPower)
  }

  let weightedSum = 0
  let weightTotal = 0
  const entries = [...byHolder.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [holderId, rawPower] of entries) {
    if (holderId === targetPersonId) continue
    const holder = state.persons[holderId]
    if (!isLivingPerson(holder)) continue
    const percent = (rawPower / total) * 100
    // house leader は影響力が大きいが拒否権はない (§11.7) → 1.5x の加重に留める
    const weight = leaderId !== undefined && holderId === leaderId ? percent * 1.5 : percent
    const attitude = getAttitudeOrDefault(state, holder, { kind: 'person', id: targetPersonId })
    const opinion = Math.max(-100, Math.min(100, 0.7 * attitude.affection + 0.3 * attitude.respect))
    weightedSum += opinion * weight
    weightTotal += weight
  }
  if (weightTotal <= 0) return 0
  return weightedSum / weightTotal
}

// 「家の土地/称号を手放すには家の同意が要る」の共通 SOFT 支持スコア (§11.7)。
//   家 share 加重意見 (getWeightedOpinionFromHouseShareholders) + Project progress 補正。
//   cadet branch 譲渡 (finalize_cadet_branch) と有家分封 (finalize_land_grant) の両 accept で
//   この単一式を共有し、両者の同意セマンティクスが drift しないようにする (閾値だけ呼出側で比較)。
export function getHouseConsentSupportScore(
  state: WorldState,
  houseId: HouseId,
  petitionerPersonId: PersonId,
  projectProgress: number,
): number {
  return (
    getWeightedOpinionFromHouseShareholders(state, houseId, petitionerPersonId) + projectProgress
  )
}

export function getDominantInfluenceHolder(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  domain?: PolityInfluenceDomain,
): PolityInfluenceEntry | undefined {
  return getTopInfluenceHoldersInPolity(state, config, polityId, 1, domain)[0]
}

export function getTopInfluenceHoldersInPolity(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  limit?: number,
  domain?: PolityInfluenceDomain,
): PolityInfluenceEntry[] {
  const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
  let list = breakdown.entries
  if (domain !== undefined) {
    list = [...list]
      .filter((e) => (e.byDomain[domain] ?? 0) > 0)
      .sort((a, b) => {
        const diff = (b.byDomain[domain] ?? 0) - (a.byDomain[domain] ?? 0)
        if (diff !== 0) return diff
        return polityInfluenceHolderKey(a.holder).localeCompare(polityInfluenceHolderKey(b.holder))
      })
  }
  return limit !== undefined ? list.slice(0, limit) : list
}

// 母集合に House entry が 1 つでもあるか (§14.2 — commonwealth surplus 判定などに使う)。
export function hasHouseInfluenceEntry(breakdown: PolityInfluenceBreakdown): boolean {
  return breakdown.entries.some((e) => e.holder.kind === 'house')
}
