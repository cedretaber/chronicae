import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity, withProvince, bindProvinceToPolity } from '../testFixtures'
import {
  enumerateSupportCandidates,
  computeJoinScore,
  selectBestSupportCandidate,
  computeProximityScore,
  computeTreasuryScore,
  computeLastWarPenalty,
  computeMilitarySparePowerScore,
  computeThreatContainmentScore,
  getPolityOverlordPolityIds,
  isPolityInActiveWar,
  getPlayIssueProvinceIds,
} from './diplomaticSupportSelectors'
import { createWar } from '../mutations/warMutations'
import { defaultConfig } from '../config/defaultConfig'
import type { WorldState } from '../types/world'
import type {
  PolityId,
  ProvinceId,
  RegimentId,
  LandContractId,
  DiplomaticPlayId,
  HoldingId,
  PersonId,
} from '../types/ids'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type { Regiment } from '../types/regiment'

// v0.43 §8-9: supporter 候補選定と joinScore の決定論・hard exclude・正規化テスト。

const INITIATOR = 'c-init' as PolityId
const TARGET = 'c-target' as PolityId

function makePlay(overrides: Partial<DiplomaticPlay> = {}): DiplomaticPlay {
  return {
    id: 'dp-1' as DiplomaticPlayId,
    kind: 'contract_tax_revision',
    initiator: { kind: 'polity', id: INITIATOR },
    target: { kind: 'polity', id: TARGET },
    status: 'active',
    startedWeek: 0,
    deadlineWeek: 48,
    progress: 0,
    tension: 0,
    initiatorPreparation: 0,
    initiatorLeverage: 0,
    initiatorCommitment: 0,
    targetPreparation: 0,
    targetLeverage: 0,
    targetCommitment: 0,
    initiatorSupporters: [],
    targetSupporters: [],
    initiatorActiveTaskIds: [],
    targetActiveTaskIds: [],
    offerHistoryIds: [],
    ...overrides,
  }
}

function makeBaseState(): WorldState {
  let s = makeEmptyV016State()
  s = withPolity(s, INITIATOR, {})
  s = withPolity(s, TARGET, {})
  return s
}

function withRegiment(s: WorldState, id: string, ownerId: PolityId, basePower: number): WorldState {
  const regimentId = id as RegimentId
  const regiment: Regiment = {
    id: regimentId,
    owner: { kind: 'polity', id: ownerId },
    status: 'active',
    sourceKind: 'levy',
    troopKind: 'infantry',
    strength: 100,
    organization: 100,
    morale: 50,
    maxStrength: 100,
    basePower,
    baselineOrganization: 100,
    maxOrganization: 100,
    baselineMorale: 50,
    maxMorale: 100,
    createdWeek: 0,
  }
  const key = `polity:${ownerId as string}`
  return {
    ...s,
    regiments: { ...s.regiments, [regimentId]: regiment },
    regimentIndex: {
      ...s.regimentIndex,
      byOwner: {
        ...s.regimentIndex.byOwner,
        [key]: [...(s.regimentIndex.byOwner[key] ?? []), regimentId],
      },
    },
  }
}

// overlordPolityId の root 契約に対する vassal 契約を作る (chain テスト用)。
function withVassalContract(
  s: WorldState,
  vassalId: PolityId,
  overlordId: PolityId,
  provinceId: ProvinceId,
): WorldState {
  const parentContractId = (s.landContractIndex.byGranteePolity[overlordId] ?? []).find((cid) => {
    const c = s.landContracts[cid]
    return c && c.provinceId === provinceId
  })
  if (!parentContractId) throw new Error('overlord has no contract for province')
  const parent = s.landContracts[parentContractId]!
  const childId = ('lc-' + s.nextLandContractId) as LandContractId
  return {
    ...s,
    landContracts: {
      ...s.landContracts,
      [childId]: {
        id: childId,
        provinceId,
        ...(parent.holdingId !== undefined ? { holdingId: parent.holdingId } : {}),
        granteePolityId: vassalId,
        parentContractId,
        terms: { taxRateToGrantor: 0.2 },
      },
    },
    landContractIndex: {
      ...s.landContractIndex,
      byGranteePolity: {
        ...s.landContractIndex.byGranteePolity,
        [vassalId]: [...(s.landContractIndex.byGranteePolity[vassalId] ?? []), childId],
      },
      byParent: { ...s.landContractIndex.byParent, [parentContractId]: childId },
      ...(parent.holdingId !== undefined
        ? {
            byHolding: {
              ...s.landContractIndex.byHolding,
              [parent.holdingId]: [
                ...(s.landContractIndex.byHolding[parent.holdingId] ?? []),
                childId,
              ],
            },
          }
        : {}),
    },
    ...(parent.holdingId !== undefined
      ? {
          holdingTerminalPolityCache: {
            ...s.holdingTerminalPolityCache,
            [parent.holdingId]: vassalId,
          },
        }
      : {}),
    nextLandContractId: s.nextLandContractId + 1,
  }
}

describe('enumerateSupportCandidates (§8.1 hard exclude)', () => {
  it('returns active polities in ascending PolityId order, excluding primaries', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-b' as PolityId, {})
    s = withPolity(s, 'c-a' as PolityId, {})
    s = withPolity(s, 'c-c' as PolityId, {})
    const result = enumerateSupportCandidates(s, makePlay())
    expect(result).toEqual(['c-a', 'c-b', 'c-c'])
  })

  it('excludes inactive polities', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, { active: false })
    expect(enumerateSupportCandidates(s, makePlay())).toEqual([])
  })

  it('excludes commonwealth polities', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, { kind: 'commonwealth' })
    expect(enumerateSupportCandidates(s, makePlay())).toEqual([])
  })

  // §8.1 例外: commonwealth は candidate にはなれないが、rebel primary としては支援を受けられる (§16)
  it('allows a commonwealth as the play initiator (rebel primary)', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-cw' as PolityId, { kind: 'commonwealth' })
    s = withPolity(s, 'c-a' as PolityId, {})
    const play = makePlay({
      kind: 'revolt_negotiation',
      initiator: { kind: 'polity', id: 'c-cw' as PolityId },
    })
    expect(enumerateSupportCandidates(s, play)).toEqual(['c-a', 'c-init'])
  })

  it('excludes existing supporters on either side of the play', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, {})
    s = withPolity(s, 'c-b' as PolityId, {})
    const play = makePlay({
      initiatorSupporters: [
        { actor: { kind: 'polity', id: 'c-a' as PolityId }, joinedWeek: 0, commitment: 50 },
      ],
      targetSupporters: [
        { actor: { kind: 'polity', id: 'c-b' as PolityId }, joinedWeek: 0, commitment: 50 },
      ],
    })
    expect(enumerateSupportCandidates(s, play)).toEqual([])
  })

  it('excludes supporters of other active plays but not of terminal-status plays', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, {})
    s = withPolity(s, 'c-b' as PolityId, {})
    const otherActive = makePlay({
      id: 'dp-other' as DiplomaticPlayId,
      initiatorSupporters: [
        { actor: { kind: 'polity', id: 'c-a' as PolityId }, joinedWeek: 0, commitment: 50 },
      ],
    })
    const otherTerminal = makePlay({
      id: 'dp-done' as DiplomaticPlayId,
      status: 'settled',
      initiatorSupporters: [
        { actor: { kind: 'polity', id: 'c-b' as PolityId }, joinedWeek: 0, commitment: 50 },
      ],
    })
    s = {
      ...s,
      diplomaticPlays: { [otherActive.id]: otherActive, [otherTerminal.id]: otherTerminal },
    }
    expect(enumerateSupportCandidates(s, makePlay())).toEqual(['c-b'])
  })

  it('excludes polities participating in an active war (and counts supporters too)', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, {})
    s = withPolity(s, 'c-b' as PolityId, {})
    s = withPolity(s, 'c-war1' as PolityId, {})
    s = withPolity(s, 'c-war2' as PolityId, {})
    createWar(s, {
      attacker: { kind: 'polity', id: 'c-war1' as PolityId },
      defender: { kind: 'polity', id: 'c-war2' as PolityId },
      warGoals: [],
      targetWarScore: 50,
      startedWeek: 0,
      attackerSupporters: [{ actor: { kind: 'polity', id: 'c-a' as PolityId } }],
    })
    expect(enumerateSupportCandidates(s, makePlay())).toEqual(['c-b'])
  })

  it('does not exclude participants of terminal wars (retention)', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, {})
    const war = createWar(s, {
      attacker: { kind: 'polity', id: 'c-a' as PolityId },
      defender: { kind: 'polity', id: TARGET },
      warGoals: [],
      targetWarScore: 50,
      startedWeek: 0,
    })
    s.wars[war.id] = { ...war, status: 'white_peace', endedWeek: 10 }
    expect(enumerateSupportCandidates(s, makePlay())).toEqual(['c-a'])
    expect(isPolityInActiveWar(s, 'c-a' as PolityId)).toBe(false)
  })

  it('excludes direct vassals and overlords of a primary (chain §8.1)', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-vassal' as PolityId, {})
    s = withPolity(s, 'c-free' as PolityId, {})
    s = withProvince(s, 'pr-1' as ProvinceId, {})
    s = bindProvinceToPolity(s, 'pr-1' as ProvinceId, INITIATOR)
    // c-vassal は INITIATOR の直接臣下
    s = withVassalContract(s, 'c-vassal' as PolityId, INITIATOR, 'pr-1' as ProvinceId)
    expect(enumerateSupportCandidates(s, makePlay())).toEqual(['c-free'])
  })

  it('excludes indirect (transitive) vassals of a primary', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-mid' as PolityId, {})
    s = withPolity(s, 'c-leaf' as PolityId, {})
    s = withProvince(s, 'pr-1' as ProvinceId, {})
    s = bindProvinceToPolity(s, 'pr-1' as ProvinceId, INITIATOR)
    s = withVassalContract(s, 'c-mid' as PolityId, INITIATOR, 'pr-1' as ProvinceId)
    // c-leaf は c-mid の臣下 = INITIATOR の間接臣下
    const midContractId = s.landContractIndex.byGranteePolity['c-mid' as PolityId]![0]!
    const midContract = s.landContracts[midContractId]!
    const leafId = ('lc-' + s.nextLandContractId) as LandContractId
    s = {
      ...s,
      landContracts: {
        ...s.landContracts,
        [leafId]: {
          id: leafId,
          provinceId: midContract.provinceId,
          ...(midContract.holdingId !== undefined ? { holdingId: midContract.holdingId } : {}),
          granteePolityId: 'c-leaf' as PolityId,
          parentContractId: midContractId,
          terms: { taxRateToGrantor: 0.2 },
        },
      },
      landContractIndex: {
        ...s.landContractIndex,
        byGranteePolity: {
          ...s.landContractIndex.byGranteePolity,
          ['c-leaf' as PolityId]: [leafId],
        },
        byParent: { ...s.landContractIndex.byParent, [midContractId]: leafId },
      },
      nextLandContractId: s.nextLandContractId + 1,
    }
    const overlords = getPolityOverlordPolityIds(s, 'c-leaf' as PolityId)
    expect(overlords.has(INITIATOR as string)).toBe(true)
    expect(enumerateSupportCandidates(s, makePlay())).toEqual([])
  })

  it('returns [] when a primary is not a polity', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, {})
    const play = makePlay({
      initiator: { kind: 'house', id: 'h-1' as never },
    })
    expect(enumerateSupportCandidates(s, play)).toEqual([])
  })
})

describe('score functions (§9.8-9.12 normalization)', () => {
  it('proximity: adjacent terminal province = 100', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, {})
    s = withProvince(s, 'pr-issue' as ProvinceId, {})
    s = withProvince(s, 'pr-next' as ProvinceId, {}) // 同 state → 自動相互隣接
    s = bindProvinceToPolity(s, 'pr-next' as ProvinceId, 'c-a' as PolityId)
    expect(computeProximityScore(s, ['pr-issue' as ProvinceId], 'c-a' as PolityId)).toBe(100)
  })

  it('proximity: same state but not adjacent = 50, unrelated = 0', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, {})
    s = withPolity(s, 'c-far' as PolityId, {})
    // 同 state 非隣接 (neighbors を明示指定して自動隣接を抑止)
    s = withProvince(s, 'pr-issue' as ProvinceId, { neighbors: [] })
    s = withProvince(s, 'pr-same-state' as ProvinceId, { neighbors: [] })
    s = bindProvinceToPolity(s, 'pr-same-state' as ProvinceId, 'c-a' as PolityId)
    expect(computeProximityScore(s, ['pr-issue' as ProvinceId], 'c-a' as PolityId)).toBe(50)
    // 別 state・非隣接
    s = withProvince(s, 'pr-other' as ProvinceId, { stateId: 'sr-other' as never, neighbors: [] })
    s = bindProvinceToPolity(s, 'pr-other' as ProvinceId, 'c-far' as PolityId)
    expect(computeProximityScore(s, ['pr-issue' as ProvinceId], 'c-far' as PolityId)).toBe(0)
  })

  it('treasury: normalized 0..100 with clamp (raw 値を直接使わない)', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-poor' as PolityId, { treasury: 0 })
    s = withPolity(s, 'c-mid' as PolityId, { treasury: 500 })
    s = withPolity(s, 'c-rich' as PolityId, { treasury: 99999 })
    expect(computeTreasuryScore(s, 'c-poor' as PolityId)).toBe(0)
    expect(computeTreasuryScore(s, 'c-mid' as PolityId)).toBe(50)
    expect(computeTreasuryScore(s, 'c-rich' as PolityId)).toBe(100)
  })

  it('lastWarPenalty: undefined = 0 / fresh = 100 / linear decay to 0 at 96 weeks', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-never' as PolityId, {})
    s = withPolity(s, 'c-fresh' as PolityId, { lastWarWeek: 1000 })
    s = withPolity(s, 'c-half' as PolityId, { lastWarWeek: 1000 - 48 })
    s = withPolity(s, 'c-old' as PolityId, { lastWarWeek: 1000 - 96 })
    s = { ...s, absoluteWeek: 1000 }
    expect(computeLastWarPenalty(s, 'c-never' as PolityId)).toBe(0)
    expect(computeLastWarPenalty(s, 'c-fresh' as PolityId)).toBe(100)
    expect(computeLastWarPenalty(s, 'c-half' as PolityId)).toBe(50)
    expect(computeLastWarPenalty(s, 'c-old' as PolityId)).toBe(0)
  })

  it('militarySparePower: ratio-normalized (equal = 50, double = 100, zero = 0)', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, {})
    s = withRegiment(s, 'r-a1', 'c-a' as PolityId, 100)
    s = withRegiment(s, 'r-t1', TARGET, 100)
    expect(
      computeMilitarySparePowerScore(s, defaultConfig, 'c-a' as PolityId, {
        kind: 'polity',
        id: TARGET,
      }),
    ).toBe(50)
    s = withRegiment(s, 'r-a2', 'c-a' as PolityId, 100)
    s = withRegiment(s, 'r-a3', 'c-a' as PolityId, 100)
    expect(
      computeMilitarySparePowerScore(s, defaultConfig, 'c-a' as PolityId, {
        kind: 'polity',
        id: TARGET,
      }),
    ).toBe(100)
  })

  it('threatContainment: strong adjacent enemy = high, distant enemy = 0', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, {})
    // c-a と TARGET (enemy) が隣接 province を terminal 支配
    s = withProvince(s, 'pr-a' as ProvinceId, {})
    s = withProvince(s, 'pr-t' as ProvinceId, {}) // 同 state → 自動相互隣接
    s = bindProvinceToPolity(s, 'pr-a' as ProvinceId, 'c-a' as PolityId)
    s = bindProvinceToPolity(s, 'pr-t' as ProvinceId, TARGET)
    // enemy = TARGET が 3 倍の戦力
    s = withRegiment(s, 'r-a1', 'c-a' as PolityId, 100)
    s = withRegiment(s, 'r-t1', TARGET, 300)
    const score = computeThreatContainmentScore(s, defaultConfig, 'c-a' as PolityId, {
      kind: 'polity',
      id: TARGET,
    })
    expect(score).toBe(100) // base clamp((3-1)*50)=100 × adjacency 1.0
    // 弱い enemy なら 0
    const weak = computeThreatContainmentScore(s, defaultConfig, TARGET, {
      kind: 'polity',
      id: 'c-a' as PolityId,
    })
    expect(weak).toBe(0)
  })
})

describe('computeJoinScore / selectBestSupportCandidate (§9.1 / §8.2)', () => {
  it('combines weighted normalized terms (politicalOpinion dormant at weight 0)', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-a' as PolityId, { treasury: 1000 })
    const play = makePlay()
    const score = computeJoinScore(s, defaultConfig, play, 'initiator', 'c-a' as PolityId)
    expect(score.politicalOpinion).toBe(0)
    expect(score.treasury).toBe(100)
    // total = 0.10 × 100 (treasury のみ。他項は 0)
    expect(score.total).toBeCloseTo(10)
  })

  it('selectBest: picks the highest score, tie-break by ascending PolityId', () => {
    let s = makeBaseState()
    s = withPolity(s, 'c-b' as PolityId, { treasury: 1000 })
    s = withPolity(s, 'c-a' as PolityId, { treasury: 1000 })
    s = withPolity(s, 'c-weak' as PolityId, { treasury: 0 })
    const play = makePlay()
    const best = selectBestSupportCandidate(s, defaultConfig, play, 'initiator')
    expect(best?.polityId).toBe('c-a') // 同点 → PolityId 昇順
    expect(best?.score.total).toBeCloseTo(10)
  })

  it('selectBest: returns undefined when no candidates', () => {
    const s = makeBaseState()
    expect(selectBestSupportCandidate(s, defaultConfig, makePlay(), 'initiator')).toBeUndefined()
  })
})

describe('getPlayIssueProvinceIds', () => {
  it('land_claim: issue.provinceId', () => {
    const s = makeBaseState()
    const play = makePlay({
      kind: 'land_claim',
      issue: {
        kind: 'land_claim',
        holdingId: 'hl-1' as HoldingId,
        provinceId: 'pr-9' as ProvinceId,
      },
    })
    expect(getPlayIssueProvinceIds(s, play)).toEqual(['pr-9'])
  })

  it('contract_tax_revision: holding の province', () => {
    let s = makeBaseState()
    s = withProvince(s, 'pr-1' as ProvinceId, {})
    const holdingId = s.provinces['pr-1' as ProvinceId]!.holdingIds[0]!
    const play = makePlay({
      issue: {
        kind: 'contract_tax_revision',
        holdingId,
        landContractId: 'lc-1' as LandContractId,
        baseTaxRateToGrantor: 0.2,
        desiredTaxRateToGrantor: 0.1,
        direction: 'decrease',
      },
    })
    expect(getPlayIssueProvinceIds(s, play)).toEqual(['pr-1'])
  })

  it('revolt_negotiation: commonwealth origin holdings の province', () => {
    let s = makeBaseState()
    s = withProvince(s, 'pr-1' as ProvinceId, {})
    const holdingId = s.provinces['pr-1' as ProvinceId]!.holdingIds[0]!
    s = withPolity(s, 'c-cw' as PolityId, {
      kind: 'commonwealth',
      origin: {
        kind: 'popular_revolt',
        originalPolityId: TARGET,
        provinceId: 'pr-1' as ProvinceId,
        holdingIds: [holdingId],
        popClass: 'peasants',
        leaderPersonId: 'pe-1' as PersonId,
        startedWeek: 0,
      },
    })
    const play = makePlay({
      kind: 'revolt_negotiation',
      initiator: { kind: 'polity', id: 'c-cw' as PolityId },
    })
    expect(getPlayIssueProvinceIds(s, play)).toEqual(['pr-1'])
  })
})
