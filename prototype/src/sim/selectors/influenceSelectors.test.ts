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

  it('includes a landless office holder house in the entry universe (§5.3)', () => {
    let state = makeBaseState()
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      outsiderId,
    )
    const entry = entryOf(state, `house:${landlessHouseId}`)
    expect(entry).toBeDefined()
    expect(entry!.byDomain.office).toBe(defaultConfig.polityInfluenceOfficeFactor)
    // House entry なので base も付く
    expect(entry!.byDomain.base).toBe(defaultConfig.polityInfluenceBase)
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

  it('grants house soft-power in a commonwealth so an embedded wealthy house can dominate (僭主 creation, v0.45.5)', () => {
    // commonwealth 化 (ownerHouseId を外す)。getPolityHouseIds は land ベースで空になる。
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
    // 富豪家 (wealth 高め) を embed: その家のメンバーを leader + administrator に据える
    const richHouseId = createHouseId('dh', 7)
    const richMemberA = createPersonId('pe', 7)
    const richMemberB = createPersonId('pe', 8)
    state = withHouse(state, richHouseId, {
      nameKey: 'RichHouse',
      wealth: 2000,
      legacyPrestige: 80,
      memberIds: [richMemberA, richMemberB],
    })
    state = withPerson(state, richMemberA, { nameKey: 'RichA', houseId: richHouseId })
    state = withPerson(state, richMemberB, { nameKey: 'RichB', houseId: richHouseId })
    // leader は別人 (houseless 相当の outsider) — ruler bonus は Person entry に付く
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', outsiderId)
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      richMemberB,
    )

    // commonwealth でも富豪家は house-global soft-power を受け取る (#3 抑止を入れない設計)
    const rich = entryOf(state, `house:${richHouseId}`)
    expect(rich).toBeDefined()
    expect(rich!.byDomain.base).toBe(defaultConfig.polityInfluenceBase)
    expect(rich!.byDomain.wealth).toBeCloseTo(2000 * defaultConfig.polityInfluenceWealthFactor)
    expect(rich!.byDomain.prestige).toBeCloseTo(80 * defaultConfig.polityInfluencePrestigeFactor)

    // 富豪家が wealth で leader (ruler bonus) を上回り、支配 holder = 僭主 になりうる
    const dominant = getDominantInfluenceHolder(state, defaultConfig, polityId)
    expect(dominant).toBeDefined()
    expect(polityInfluenceHolderKey(dominant!.holder)).toBe(`house:${richHouseId}`)
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
