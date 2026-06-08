// v0.42 §5 Influence selector のユニットテスト (spec §20.1)。
// - known fixture での domain breakdown
// - percent 合計 100 (許容誤差つき)
// - commonwealth leader person entry が ruler domain に出る
// - 土地を持たない office holder / right holder の House が entry に含まれる (母集合 §5.3)
// - 非 ownerHouse 出身 leader の家への leaderHouse bonus / ownerHouse 所属 leader では加算なし

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createRegimentId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { Regiment } from '../types/regiment'
import { defaultConfig } from '../config/defaultConfig'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import { addPersonReputationMut } from '../mutations/personReputationMutations'
import {
  getPolityInfluenceBreakdown,
  getActorInfluenceInPolity,
  getHouseAggregateInfluenceFromBreakdown,
  getGroupedPolityInfluence,
  getDominantInfluenceHolder,
  getTopInfluenceHoldersInPolity,
} from './influenceSelectors'
import { polityInfluenceHolderKey } from '../types/influence'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'

const polityId = createPolityId('dp', 0)
const ownerHouseId = createHouseId('dh', 0)
const landlessHouseId = createHouseId('dh', 1)
const ownerLeaderId = createPersonId('pe', 0)
const outsiderId = createPersonId('pe', 1)
const provinceId = createProvinceId('p', 0)
const regimentId = createRegimentId(0)

function makeBaseState(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, provinceId, { nameKey: 'Province0' })
  s = withHouse(s, ownerHouseId, {
    nameKey: 'OwnerHouse',
    seatProvinceId: provinceId,
    wealth: 100,
    legacyPrestige: 50,
  })
  s = withHouse(s, landlessHouseId, {
    nameKey: 'LandlessHouse',
    seatProvinceId: provinceId,
    wealth: 0,
    legacyPrestige: 0,
  })
  s = withPerson(s, ownerLeaderId, { nameKey: 'OwnerLeader', houseId: ownerHouseId })
  s = withPerson(s, outsiderId, { nameKey: 'Outsider', houseId: landlessHouseId })
  s = withPolity(s, polityId, { ownerHouseId, capitalProvinceId: provinceId })
  s = bindProvinceToHouseViaPolity(s, provinceId, polityId, ownerHouseId)
  return s
}

function entryOf(state: WorldState, holderKey: string) {
  const breakdown = getPolityInfluenceBreakdown(state, defaultConfig, polityId)
  return breakdown.entries.find((e) => polityInfluenceHolderKey(e.holder) === holderKey)
}

describe('getPolityInfluenceBreakdown', () => {
  it('computes expected domains for a simple owner-house polity', () => {
    const state = makeBaseState()
    const breakdown = getPolityInfluenceBreakdown(state, defaultConfig, polityId)
    const owner = breakdown.entries.find(
      (e) => polityInfluenceHolderKey(e.holder) === `house:${ownerHouseId}`,
    )
    expect(owner).toBeDefined()
    expect(owner!.byDomain.base).toBe(defaultConfig.polityInfluenceBase)
    expect(owner!.byDomain.ruler).toBe(defaultConfig.polityInfluenceOwnerHouseBonus)
    // province 1 = provinceFactor + 10 × militaryFactor
    expect(owner!.byDomain.landed_power).toBeCloseTo(
      defaultConfig.polityInfluenceProvinceFactor +
        10 * defaultConfig.polityInfluenceMilitaryFactor,
    )
    expect(owner!.byDomain.wealth).toBeCloseTo(100 * defaultConfig.polityInfluenceWealthFactor)
    expect(owner!.byDomain.prestige).toBeCloseTo(50 * defaultConfig.polityInfluencePrestigeFactor)
    // 土地のみの fixture では office / military / faction は空
    expect(owner!.byDomain.office).toBeUndefined()
    expect(owner!.byDomain.faction).toBeUndefined()
  })

  it('percent sums to 100 across entries (with tolerance)', () => {
    let state = makeBaseState()
    // office holder を足して entry を複数にする
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      outsiderId,
    )
    const breakdown = getPolityInfluenceBreakdown(state, defaultConfig, polityId)
    expect(breakdown.entries.length).toBeGreaterThan(1)
    const sum = breakdown.entries.reduce((acc, e) => acc + e.percent, 0)
    expect(sum).toBeCloseTo(100, 6)
  })

  it('役職保有者の office influence は person entry に計上される (Phase 2b 個人帰属)', () => {
    let state = makeBaseState()
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      outsiderId,
    )
    // Phase 2b: 役職 influence は保有者「個人」(outsiderId) に付き、家には fold しない
    const personEntry = entryOf(state, `person:${outsiderId}`)
    expect(personEntry).toBeDefined()
    expect(personEntry!.byDomain.office).toBe(defaultConfig.polityInfluenceOfficeFactor)
    // 家 (landlessHouse) には office が乗らない
    const houseEntry = entryOf(state, `house:${landlessHouseId}`)
    expect(houseEntry?.byDomain.office).toBeUndefined()
  })

  it('includes a landless right holder house + military domain for active regiment right', () => {
    let state = makeBaseState()
    const regiment: Regiment = {
      id: regimentId,
      owner: { kind: 'polity', id: polityId },
      status: 'active',
      sourceKind: 'levy',
      troopKind: 'infantry',
      strength: 100,
      organization: 50,
      morale: 30,
      maxStrength: 100,
      basePower: 10,
      baselineOrganization: 50,
      maxOrganization: 100,
      baselineMorale: 30,
      maxMorale: 100,
      createdWeek: 0,
    }
    state = {
      ...state,
      regiments: { [regimentId]: regiment },
      regimentIndex: { ...state.regimentIndex, byOwner: { [`polity:${polityId}`]: [regimentId] } },
    }
    const created = createPoliticalRight(state, {
      polityId,
      target: { kind: 'regiment', regimentId },
      holder: { kind: 'house', id: landlessHouseId },
      grantedWeek: 100,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const entry = entryOf(created.value.state, `house:${landlessHouseId}`)
    expect(entry).toBeDefined()
    expect(entry!.byDomain.military).toBe(defaultConfig.polityInfluenceRegimentControlFactor)

    // destroyed にすると military 寄与は 0 になるが entry は残る (§11.3)
    const destroyed: WorldState = {
      ...created.value.state,
      regiments: {
        [regimentId]: { ...regiment, status: 'destroyed', destroyedWeek: 200 },
      },
    }
    const entryAfter = entryOf(destroyed, `house:${landlessHouseId}`)
    expect(entryAfter).toBeDefined()
    expect(entryAfter!.byDomain.military).toBeUndefined()
  })

  it('polity_office_role 任命権 保有者は office domain に直接 influence を得る (Phase 2 2a)', () => {
    const state = makeBaseState()
    const created = createPoliticalRight(state, {
      polityId,
      target: { kind: 'polity_office_role', polityId, role: 'administrator', slotIndex: 0 },
      holder: { kind: 'house', id: landlessHouseId },
      grantedWeek: 100,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const entry = entryOf(created.value.state, `house:${landlessHouseId}`)
    expect(entry).toBeDefined()
    expect(entry!.byDomain.office).toBe(defaultConfig.polityInfluencePolityOfficeAppointmentFactor)
  })

  it('puts the commonwealth leader person entry in the ruler domain', () => {
    let state = makeBaseState()
    // ownerHouseId を外して commonwealth 相当にし、leader office を付ける
    state = {
      ...state,
      polities: {
        ...state.polities,
        [polityId]: (() => {
          const p = { ...state.polities[polityId]! }
          delete p.ownerHouseId
          return p
        })(),
      },
      polityIndex: { byOwnerHouse: {} },
    }
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', outsiderId)
    const entry = entryOf(state, `person:${outsiderId}`)
    expect(entry).toBeDefined()
    expect(entry!.byDomain.ruler).toBe(defaultConfig.polityInfluenceOwnerHouseBonus)
    // Person entry には base が付かない (§5.4)
    expect(entry!.byDomain.base).toBeUndefined()
  })

  it('commonwealth の僭主は wealth でなく構造項+成果項で個人創発する (Phase 1b 個人中心化)', () => {
    // 影響力個人中心化 Phase 1b: 受動 soft-power (wealth/base/prestige) を全廃したため、
    // v0.45.5 の「富豪家が wealth で commonwealth を支配」ルートは消滅。代わりに僭主は
    // 役職 (構造項) を握り評判 (成果項) を積んだ「個人」として創発する。家でなく個人に帰属する
    // のが redesign の核 (家は権力基盤)。
    let state = makeBaseState()
    state = {
      ...state,
      polities: {
        ...state.polities,
        [polityId]: (() => {
          const p = { ...state.polities[polityId]! }
          delete p.ownerHouseId
          return p
        })(),
      },
      polityIndex: { byOwnerHouse: {} },
    }
    const richHouseId = createHouseId('dh', 7)
    const usurper = createPersonId('pe', 8)
    state = withHouse(state, richHouseId, {
      nameKey: 'RichHouse',
      wealth: 2000, // wealth は influence に効かない (soft-power 全廃)
      legacyPrestige: 80,
      memberIds: [usurper],
    })
    state = withPerson(state, usurper, { nameKey: 'Usurper', houseId: richHouseId })
    // leader は別人 (houseless outsider) — ruler bonus 30 が person entry に付く
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', outsiderId)

    // wealth/base/prestige は influence に寄与しない (soft-power 全廃の確認)
    const richHouseEntry = entryOf(state, `house:${richHouseId}`)
    expect(richHouseEntry?.byDomain.wealth).toBeUndefined()
    expect(richHouseEntry?.byDomain.base).toBeUndefined()
    expect(richHouseEntry?.byDomain.prestige).toBeUndefined()

    // usurper が役職 (administrator) を握り polity-tag 評判を積むと、個人 entry が
    // leader (ruler 30) を上回り支配 holder = 僭主 になる
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      usurper,
    )
    const ws = { ...state }
    addPersonReputationMut(ws, {
      personId: usurper,
      source: { kind: 'war' },
      outcome: 'success',
      category: 'military',
      baseScore: 80,
      createdWeek: ws.absoluteWeek,
      expiryWeek: ws.absoluteWeek + 10000,
      relatedOrganization: { kind: 'polity', id: polityId },
      relatedRefs: [],
    })

    const dominant = getDominantInfluenceHolder(ws, defaultConfig, polityId)
    expect(dominant).toBeDefined()
    // 僭主は家でなく「個人」(person entry) として支配する
    expect(polityInfluenceHolderKey(dominant!.holder)).toBe(`person:${usurper}`)
    expect(dominant!.byDomain.reputation ?? 0).toBeGreaterThan(0)
  })

  it('adds leaderHouse bonus only when the leader is from a non-owner house (§5.4)', () => {
    // leader ∈ ownerHouse → 加算なし
    let sameHouse = makeBaseState()
    sameHouse = createOfficeAssignment(
      sameHouse,
      { kind: 'polity', id: polityId },
      'leader',
      ownerLeaderId,
    )
    const ownerEntry = entryOf(sameHouse, `house:${ownerHouseId}`)
    expect(ownerEntry!.byDomain.ruler).toBe(defaultConfig.polityInfluenceOwnerHouseBonus)

    // leader が別の家 → leaderHouse bonus が leader の家に付く
    let otherHouse = makeBaseState()
    otherHouse = createOfficeAssignment(
      otherHouse,
      { kind: 'polity', id: polityId },
      'leader',
      outsiderId,
    )
    const leaderHouseEntry = entryOf(otherHouse, `house:${landlessHouseId}`)
    expect(leaderHouseEntry).toBeDefined()
    expect(leaderHouseEntry!.byDomain.ruler).toBe(defaultConfig.polityInfluenceLeaderHouseBonus)
    const ownerEntry2 = entryOf(otherHouse, `house:${ownerHouseId}`)
    expect(ownerEntry2!.byDomain.ruler).toBe(defaultConfig.polityInfluenceOwnerHouseBonus)
  })

  it('getActorInfluenceInPolity / getDominantInfluenceHolder / getTop are consistent', () => {
    const state = makeBaseState()
    const owner = getActorInfluenceInPolity(
      state,
      defaultConfig,
      { kind: 'house', id: ownerHouseId },
      polityId,
    )
    expect(owner.score).toBeGreaterThan(0)
    expect(owner.percent).toBeGreaterThan(0)
    const dominant = getDominantInfluenceHolder(state, defaultConfig, polityId)
    expect(dominant).toBeDefined()
    expect(polityInfluenceHolderKey(dominant!.holder)).toBe(`house:${ownerHouseId}`)
    const top = getTopInfluenceHoldersInPolity(state, defaultConfig, polityId, 5)
    expect(top.length).toBeGreaterThan(0)
    expect(top[0]!.total).toBeGreaterThanOrEqual(top[top.length - 1]!.total)
    // 不在 actor は 0
    const none = getActorInfluenceInPolity(
      state,
      defaultConfig,
      { kind: 'person', id: createPersonId('pe', 99) },
      polityId,
    )
    expect(none).toEqual({ score: 0, percent: 0 })
  })

  it('returns an empty breakdown for an inactive polity', () => {
    let state = makeBaseState()
    state = {
      ...state,
      polities: { ...state.polities, [polityId]: { ...state.polities[polityId]!, active: false } },
    }
    const breakdown = getPolityInfluenceBreakdown(state, defaultConfig, polityId)
    expect(breakdown.entries).toEqual([])
    expect(breakdown.totalScore).toBe(0)
  })
})

describe('reputation domain (影響力個人中心化 Phase 1a)', () => {
  function addPolityRep(
    state: WorldState,
    personId: ReturnType<typeof createPersonId>,
    baseScore: number,
  ): WorldState {
    const ws = { ...state }
    addPersonReputationMut(ws, {
      personId,
      source: { kind: 'war' },
      outcome: baseScore >= 0 ? 'success' : 'failure',
      category: 'military',
      baseScore,
      createdWeek: ws.absoluteWeek,
      expiryWeek: ws.absoluteWeek + 10000,
      relatedOrganization: { kind: 'polity', id: polityId },
      relatedRefs: [],
    })
    return ws
  }

  it('polity-tag 評判は housed person でも person entry に加算される (家 fold しない)', () => {
    let state = makeBaseState()
    // ownerLeaderId は ownerHouse 所属。評判は本人 (person entry) に付き、家には fold しない。
    state = addPolityRep(state, ownerLeaderId, 10)
    const personEntry = entryOf(state, `person:${ownerLeaderId}`)
    expect(personEntry).toBeDefined()
    expect(personEntry!.byDomain.reputation).toBeCloseTo(
      10 * defaultConfig.polityInfluenceReputationFactor,
    )
    // house entry には reputation domain が乗らない
    const houseEntry = entryOf(state, `house:${ownerHouseId}`)
    expect(houseEntry?.byDomain.reputation).toBeUndefined()
  })

  it('評判だけ持つ役職なし houseless person が母集合に追加される', () => {
    let state = makeBaseState()
    const loner = createPersonId('pe', 50)
    // houseless person を直接登録 (withPerson は houseId 必須なので直で置く)
    const lonerPerson = { ...state.persons[ownerLeaderId]!, id: loner, houseId: undefined }
    state = {
      ...state,
      persons: { ...state.persons, [loner]: lonerPerson },
      livingPersonIds: [...state.livingPersonIds, loner].sort(),
    }
    state = addPolityRep(state, loner, 8)
    const entry = entryOf(state, `person:${loner}`)
    expect(entry).toBeDefined()
    expect(entry!.byDomain.reputation).toBeCloseTo(
      8 * defaultConfig.polityInfluenceReputationFactor,
    )
  })

  it('負評判は per-entry sum で 0 床になる (反影響力を作らない)', () => {
    let state = makeBaseState()
    state = addPolityRep(state, ownerLeaderId, 10)
    state = addPolityRep(state, ownerLeaderId, -30) // 合計 -20 → 0 床
    const entry = entryOf(state, `person:${ownerLeaderId}`)
    expect(entry!.byDomain.reputation).toBe(0)
  })

  it('inactive polity の評判は影響しない (breakdown が空)', () => {
    let state = makeBaseState()
    state = addPolityRep(state, ownerLeaderId, 10)
    state = {
      ...state,
      polities: { ...state.polities, [polityId]: { ...state.polities[polityId]!, active: false } },
    }
    const breakdown = getPolityInfluenceBreakdown(state, defaultConfig, polityId)
    expect(breakdown.entries).toEqual([])
  })
})

describe('getHouseAggregateInfluenceFromBreakdown (家の支配率 §6.64a-(10))', () => {
  it('家 entry + 家中メンバー person entry の influence% を合算する', () => {
    let state = makeBaseState()
    // landlessHouse の member (outsiderId) に役職を与える → office は person entry に付く (Phase 2b)。
    // 家 entry は 0、aggregate は member 個人分を拾うので > 0 になる。
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      outsiderId,
    )
    const breakdown = getPolityInfluenceBreakdown(state, defaultConfig, polityId)
    const houseEntryPct = getActorInfluenceInPolity(
      state,
      defaultConfig,
      { kind: 'house', id: landlessHouseId },
      polityId,
    ).percent
    const personEntryPct = getActorInfluenceInPolity(
      state,
      defaultConfig,
      { kind: 'person', id: outsiderId },
      polityId,
    ).percent
    const aggregate = getHouseAggregateInfluenceFromBreakdown(state, breakdown, landlessHouseId)

    // member が役職を持つので person 分が乗り、house entry 単独より高い
    expect(personEntryPct).toBeGreaterThan(0)
    expect(aggregate.percent).toBeGreaterThan(houseEntryPct)
    // aggregate = 家 entry% + メンバー person entry%
    expect(aggregate.percent).toBeCloseTo(houseEntryPct + personEntryPct, 6)
  })

  it('メンバー以外の person entry は合算しない', () => {
    let state = makeBaseState()
    // ownerLeaderId (ownerHouse 所属) に評判を付ける → person entry が立つ
    const ws = { ...state }
    addPersonReputationMut(ws, {
      personId: ownerLeaderId,
      source: { kind: 'war' },
      outcome: 'success',
      category: 'military',
      baseScore: 40,
      createdWeek: ws.absoluteWeek,
      expiryWeek: ws.absoluteWeek + 10000,
      relatedOrganization: { kind: 'polity', id: polityId },
      relatedRefs: [],
    })
    state = ws
    const breakdown = getPolityInfluenceBreakdown(state, defaultConfig, polityId)
    // landlessHouse の aggregate は ownerLeader (別家メンバー) を拾わない
    const landlessAgg = getHouseAggregateInfluenceFromBreakdown(state, breakdown, landlessHouseId)
    const landlessHousePct = getActorInfluenceInPolity(
      state,
      defaultConfig,
      { kind: 'house', id: landlessHouseId },
      polityId,
    ).percent
    expect(landlessAgg.percent).toBeCloseTo(landlessHousePct, 6)
  })
})

describe('getGroupedPolityInfluence (家グループ化 UI read-model)', () => {
  function addPolityRep(
    state: WorldState,
    personId: ReturnType<typeof createPersonId>,
    baseScore: number,
  ): WorldState {
    const ws = { ...state }
    addPersonReputationMut(ws, {
      personId,
      source: { kind: 'war' },
      outcome: 'success',
      category: 'military',
      baseScore,
      createdWeek: ws.absoluteWeek,
      expiryWeek: ws.absoluteWeek + 10000,
      relatedOrganization: { kind: 'polity', id: polityId },
      relatedRefs: [],
    })
    return ws
  }

  it('家本体 + 家中メンバーを 1 グループに束ね、家本体を先頭に置く', () => {
    let state = makeBaseState()
    // ownerHouse メンバー (ownerLeader) に役職 → person entry が立つ
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      ownerLeaderId,
    )
    const grouped = getGroupedPolityInfluence(state, defaultConfig, polityId, 0)
    const ownerGroup = grouped.groups.find((g) => g.houseId === ownerHouseId)
    expect(ownerGroup).toBeDefined()
    // 家本体が先頭セグメント
    expect(ownerGroup!.segments[0]!.holder.kind).toBe('house')
    // メンバー person が同グループに含まれる
    expect(
      ownerGroup!.segments.some((s) => s.holder.kind === 'person' && s.holder.id === ownerLeaderId),
    ).toBe(true)
    // aggregatePercent = segments の和
    const segSum = ownerGroup!.segments.reduce((a, s) => a + s.percent, 0)
    expect(ownerGroup!.aggregatePercent).toBeCloseTo(segSum, 6)
    // 家の支配率 helper と一致する
    const breakdown = getPolityInfluenceBreakdown(state, defaultConfig, polityId)
    const agg = getHouseAggregateInfluenceFromBreakdown(state, breakdown, ownerHouseId)
    expect(ownerGroup!.aggregatePercent).toBeCloseTo(agg.percent, 6)
  })

  it('groups は aggregatePercent 降順、全グループ + その他で 100% を成す', () => {
    let state = makeBaseState()
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      outsiderId,
    )
    const grouped = getGroupedPolityInfluence(state, defaultConfig, polityId, 0)
    for (let i = 1; i < grouped.groups.length; i++) {
      expect(grouped.groups[i - 1]!.aggregatePercent).toBeGreaterThanOrEqual(
        grouped.groups[i]!.aggregatePercent,
      )
    }
    const total = grouped.groups.reduce((a, g) => a + g.aggregatePercent, 0) + grouped.othersPercent
    expect(total).toBeCloseTo(100, 4)
  })

  it('minGroupPercent 未満のグループは othersPercent に集約される', () => {
    let state = makeBaseState()
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      outsiderId,
    )
    // 全グループを超える閾値 → すべて その他 に落ち、合計は保存される
    const high = getGroupedPolityInfluence(state, defaultConfig, polityId, 1000)
    expect(high.groups.length).toBe(0)
    expect(high.othersPercent).toBeCloseTo(100, 4)
  })

  it('家を持たない有力 person は houseId=undefined の単独グループになる', () => {
    let state = makeBaseState()
    const loner = createPersonId('pe', 50)
    const lonerPerson = { ...state.persons[ownerLeaderId]!, id: loner, houseId: undefined }
    state = {
      ...state,
      persons: { ...state.persons, [loner]: lonerPerson },
      livingPersonIds: [...state.livingPersonIds, loner].sort(),
    }
    state = addPolityRep(state, loner, 30)
    const grouped = getGroupedPolityInfluence(state, defaultConfig, polityId, 0)
    const lonerGroup = grouped.groups.find(
      (g) =>
        g.houseId === undefined &&
        g.segments.some((s) => s.holder.kind === 'person' && s.holder.id === loner),
    )
    expect(lonerGroup).toBeDefined()
    expect(lonerGroup!.segments.length).toBe(1)
    expect(lonerGroup!.segments[0]!.holder).toEqual({ kind: 'person', id: loner })
  })
})
