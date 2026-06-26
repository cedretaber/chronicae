import { describe, expect, it } from 'vitest'
import {
  getPopPredictedLifeCost,
  getPopContributableSurplus,
  getProjectFundingStakeholders,
  computeContributorPledge,
  type FundingContributor,
} from './projectFundingSelectors'
import { defaultConfig } from '../config/defaultConfig'
import type { PopGroup } from '../types/popGroup'
import type { WorldState } from '../types/world'
import type { Project } from '../types/project'
import type { HoldingOfficeAssignmentId } from '../types/ids'
import {
  createPopGroupId,
  createHoldingId,
  createProvinceId,
  createPolityId,
  createHouseId,
  createPersonId,
} from '../types/ids'
import {
  makeEmptyV016State,
  withProvince,
  withHolding,
  withPolity,
  withHouse,
  withPerson,
} from '../testFixtures'

function makePop(money: number, size = 100): PopGroup {
  return {
    id: createPopGroupId(0),
    holdingId: createHoldingId(0),
    class: 'lower',
    popType: 'peasants',
    employerId: null,
    size,
    money,
    needSatisfaction: 50,
    unrest: 0,
    attitudes: {},
  }
}

// 全資源 price=1 の単純 lookup。lifeCost = Σ buyOrders。
const price1 = () => 1

describe('v0.60 POP 拠出余剰', () => {
  it('lifeCost は正（peasants は staple/protein 等 essential need を持つ）', () => {
    const cost = getPopPredictedLifeCost(makePop(0), defaultConfig, price1)
    expect(cost).toBeGreaterThan(0)
  })

  it('飢えた POP（money < lifeCost×horizon）は surplus 0', () => {
    const cost = getPopPredictedLifeCost(makePop(0), defaultConfig, price1)
    const poor = makePop(cost) // horizon(3)×cost に満たない
    expect(getPopContributableSurplus(poor, defaultConfig, price1)).toBe(0)
  })

  it('余剰のある POP は (money − lifeCost×horizon) を返す', () => {
    const cost = getPopPredictedLifeCost(makePop(0), defaultConfig, price1)
    const rich = makePop(cost * defaultConfig.popContributionHorizonMonths + 500)
    expect(getPopContributableSurplus(rich, defaultConfig, price1)).toBeCloseTo(500, 6)
  })
})

// --- ステークホルダー列挙用 fixture ---
const PR = createProvinceId('pr', 0)
const HOLD = createHoldingId(0)
const POL = createPolityId('po', 0)
const HOUSE = createHouseId('ho', 0)
const CREATOR = createPersonId('pe', 1)
const SUPERVISOR = createPersonId('pe', 2)
const MEMBER = createPersonId('pe', 3)
const BAILIFF = createPersonId('pe', 4)
const POP1 = createPopGroupId(10)

// owner=polity, House(メンバー), 代官, ローカル POP を備えた develop_holding world を組む。
function buildPolityOwnedWorld(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, PR)
  s = withHolding(s, HOLD, PR)
  s = withHouse(s, HOUSE, { memberIds: [] })
  s = withPolity(s, POL, { ownerHouseId: HOUSE })
  s = withPerson(s, CREATOR, { houseId: HOUSE })
  s = withPerson(s, SUPERVISOR, { houseId: HOUSE })
  s = withPerson(s, MEMBER, { houseId: HOUSE })
  s = withPerson(s, BAILIFF, { houseId: HOUSE })
  // 代官 (非 placeholder・active) を holding に設置。
  const hoaId = 'ho-bailiff' as HoldingOfficeAssignmentId
  s = {
    ...s,
    holdingOfficeAssignments: {
      ...s.holdingOfficeAssignments,
      [hoaId]: {
        id: hoaId,
        holdingId: HOLD,
        role: 'bailiff',
        holderPersonId: BAILIFF,
        appointingPolityId: POL,
        active: true,
        startWeek: 0,
        unpaidCount: 0,
        contractedRemittanceRate: 0.4,
        expectedFeeRate: 0.1,
      },
    },
    holdingOfficeIndex: {
      ...s.holdingOfficeIndex,
      byHolding: { ...s.holdingOfficeIndex.byHolding, [HOLD]: hoaId },
    },
    popIndex: {
      ...s.popIndex,
      byHolding: { ...s.popIndex.byHolding, [HOLD]: [POP1] },
    },
  }
  return s
}

function makeDevelopHoldingProject(): Project {
  return {
    kind: 'develop_holding',
    owner: { kind: 'polity', id: POL },
    creatorPersonId: CREATOR,
    supervisorPersonId: SUPERVISOR,
    holdingId: HOLD,
  } as unknown as Project
}

describe('v0.60 ステークホルダー列挙', () => {
  it('develop_holding: owner/creator/supervisor/代官 は insider=true', () => {
    const s = buildPolityOwnedWorld()
    const result = getProjectFundingStakeholders(s, defaultConfig, makeDevelopHoldingProject())
    const find = (kind: string, id: string) =>
      result.find((c) => c.kind === kind && (c.id as string) === id)
    expect(find('polity', POL as string)?.insider).toBe(true)
    expect(find('person', CREATOR as string)?.insider).toBe(true)
    expect(find('person', SUPERVISOR as string)?.insider).toBe(true)
    expect(find('person', BAILIFF as string)?.insider).toBe(true)
  })

  it('ローカル POP は external として含まれる', () => {
    const s = buildPolityOwnedWorld()
    const result = getProjectFundingStakeholders(s, defaultConfig, makeDevelopHoldingProject())
    const pop = result.find((c) => c.kind === 'pop')
    expect(pop).toBeDefined()
    expect(pop?.insider).toBe(false)
  })

  it('結果は kind:id 昇順かつ重複なし (同一 Person が複数役割でも 1 回)', () => {
    const s = buildPolityOwnedWorld()
    // creator と supervisor を同一人物にして重複排除を検証。
    const project = {
      kind: 'develop_holding',
      owner: { kind: 'polity', id: POL },
      creatorPersonId: CREATOR,
      supervisorPersonId: CREATOR,
      holdingId: HOLD,
    } as unknown as Project
    const result = getProjectFundingStakeholders(s, defaultConfig, project)
    const keys = result.map((c) => `${c.kind}:${c.id}`)
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)))
    expect(new Set(keys).size).toBe(keys.length)
    // CREATOR は insider(person) として 1 回だけ。
    const creatorEntries = result.filter(
      (c) => c.kind === 'person' && (c.id as string) === (CREATOR as string),
    )
    expect(creatorEntries.length).toBe(1)
    expect(creatorEntries[0]?.insider).toBe(true)
  })

  it('acquire_real_estate は POP を含めない (owner House＋メンバーのみ)', () => {
    const s = buildPolityOwnedWorld()
    const project = {
      kind: 'acquire_real_estate',
      owner: { kind: 'house', id: HOUSE },
      creatorPersonId: CREATOR,
      supervisorPersonId: SUPERVISOR,
      holdingId: HOLD,
    } as unknown as Project
    const result = getProjectFundingStakeholders(s, defaultConfig, project)
    expect(result.some((c) => c.kind === 'pop')).toBe(false)
    expect(result.some((c) => c.kind === 'house' && (c.id as string) === (HOUSE as string))).toBe(
      true,
    )
  })

  it('commonwealth(ownerHouseId 無) owned でも空にならない (insider で担保)', () => {
    let s = makeEmptyV016State()
    s = withProvince(s, PR)
    s = withHolding(s, HOLD, PR)
    s = withPolity(s, POL) // ownerHouseId 無し
    s = withPerson(s, CREATOR, { houseId: HOUSE })
    s = withHouse(s, HOUSE, { memberIds: [CREATOR] })
    s = withPerson(s, SUPERVISOR, { houseId: HOUSE })
    const result = getProjectFundingStakeholders(s, defaultConfig, makeDevelopHoldingProject())
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('v0.60 pledge 算出', () => {
  const noPrice = () => 1

  it('v0.60.2 insider Person は能力 0 だと floor 分のみ拠出 (関係非依存)', () => {
    let s = makeEmptyV016State()
    s = withHouse(s, HOUSE, {})
    // supervisor の能力を 0 にすると insider でも floor (insiderAbilityFloor) 倍まで縮む。
    s = withPerson(s, SUPERVISOR, {
      houseId: HOUSE,
      abilities: { valor: 0, command: 0, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
    })
    s = withPerson(s, MEMBER, { houseId: HOUSE, wealth: 1000 })
    const project = makeDevelopHoldingProject()
    const c: FundingContributor = { kind: 'person', id: MEMBER, insider: true }
    expect(computeContributorPledge(s, defaultConfig, project, c, noPrice)).toBeCloseTo(
      1000 * defaultConfig.insiderMaxContributionFraction * defaultConfig.insiderAbilityFloor,
      6,
    )
  })

  it('v0.60.2 insider Person は supervisor 能力が高いほど多く拠出する', () => {
    function pledgeWithAbility(zero: boolean): number {
      let s = makeEmptyV016State()
      s = withHouse(s, HOUSE, {})
      s = zero
        ? withPerson(s, SUPERVISOR, {
            houseId: HOUSE,
            abilities: {
              valor: 0,
              command: 0,
              numeracy: 0,
              learning: 0,
              charisma: 0,
              insight: 0,
            },
          })
        : withPerson(s, SUPERVISOR, { houseId: HOUSE }) // default = diplomacy 50 → factor 1.0
      s = withPerson(s, MEMBER, { houseId: HOUSE, wealth: 1000 })
      const project = makeDevelopHoldingProject()
      const c: FundingContributor = { kind: 'person', id: MEMBER, insider: true }
      return computeContributorPledge(s, defaultConfig, project, c, noPrice)
    }
    // 能力 50 の supervisor は full (insiderMaxContributionFraction) 倍まで拠出。
    expect(pledgeWithAbility(false)).toBeCloseTo(
      1000 * defaultConfig.insiderMaxContributionFraction,
      6,
    )
    // 能力 0 の supervisor は floor 倍に留まり、より少ない。
    expect(pledgeWithAbility(false)).toBeGreaterThan(pledgeWithAbility(true))
  })

  it('external Person は supervisor 能力 0 だと拠出ほぼ 0', () => {
    let s = makeEmptyV016State()
    s = withHouse(s, HOUSE, {})
    s = withPerson(s, SUPERVISOR, {
      houseId: HOUSE,
      abilities: { valor: 0, command: 0, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
    })
    s = withPerson(s, MEMBER, {
      houseId: HOUSE,
      wealth: 1000,
      attitudes: { [`person:${SUPERVISOR}`]: { affection: 100, respect: 100 } },
    })
    const project = makeDevelopHoldingProject()
    const c: FundingContributor = { kind: 'person', id: MEMBER, insider: false }
    expect(computeContributorPledge(s, defaultConfig, project, c, noPrice)).toBe(0)
  })

  it('external Person は friendly(attitude 高) だと拠出が増える', () => {
    let s = makeEmptyV016State()
    s = withHouse(s, HOUSE, {})
    s = withPerson(s, SUPERVISOR, { houseId: HOUSE }) // 能力 50 (diplomacy>0)
    s = withPerson(s, MEMBER, {
      houseId: HOUSE,
      wealth: 1000,
      attitudes: { [`person:${SUPERVISOR}`]: { affection: 100, respect: 100 } },
    })
    s = withPerson(s, CREATOR, { houseId: HOUSE, wealth: 1000 }) // attitude 無し (中立)
    const project = makeDevelopHoldingProject()
    const friendly: FundingContributor = { kind: 'person', id: MEMBER, insider: false }
    const neutral: FundingContributor = { kind: 'person', id: CREATOR, insider: false }
    const friendlyPledge = computeContributorPledge(s, defaultConfig, project, friendly, noPrice)
    const neutralPledge = computeContributorPledge(s, defaultConfig, project, neutral, noPrice)
    expect(friendlyPledge).toBeGreaterThan(neutralPledge)
  })

  it('pledge は stock を超えない (clamp)', () => {
    let s = makeEmptyV016State()
    s = withHouse(s, HOUSE, {})
    s = withPerson(s, SUPERVISOR, { houseId: HOUSE })
    s = withPerson(s, MEMBER, { houseId: HOUSE, wealth: 100 })
    const project = makeDevelopHoldingProject()
    // insiderMaxContributionFraction を 1 超に設定 → clamp01+min で wealth に張り付く。
    const config = { ...defaultConfig, insiderMaxContributionFraction: 5 }
    const c: FundingContributor = { kind: 'person', id: MEMBER, insider: true }
    expect(computeContributorPledge(s, config, project, c, noPrice)).toBe(100)
  })

  it('飢えた POP は pledge 0', () => {
    let s = makeEmptyV016State()
    s = withHouse(s, HOUSE, {})
    s = withPerson(s, SUPERVISOR, { houseId: HOUSE })
    const pop: PopGroup = {
      id: POP1,
      holdingId: HOLD,
      class: 'lower',
      popType: 'peasants',
      employerId: null,
      size: 100,
      money: 0, // 余剰なし
      needSatisfaction: 50,
      unrest: 0,
      attitudes: {},
    }
    s = { ...s, popGroups: { ...s.popGroups, [POP1]: pop } }
    const project = makeDevelopHoldingProject()
    const c: FundingContributor = { kind: 'pop', id: POP1, insider: false }
    expect(computeContributorPledge(s, defaultConfig, project, c, noPrice)).toBe(0)
  })
})
