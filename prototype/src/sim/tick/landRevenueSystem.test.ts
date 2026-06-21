import { describe, it, expect } from 'vitest'
import { runLandRevenueSystem } from './landRevenueSystem'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext } from './context'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PopGroup, PopClass } from '../types/popGroup'
import type { RealEstateAsset, AssetOwnerRef } from '../types/realEstateAsset'
import type {
  ProvinceId,
  PolityId,
  HouseId,
  PersonId,
  PopGroupId,
  HoldingId,
  RealEstateAssetId,
  RealEstateSeizureId,
} from '../types/ids'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  withPerson,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { appointHoldingBailiff, vacateHoldingBailiff } from '../mutations/provinceOfficeMutations'
import { defaultLandContractConfig } from '../config/landContractConfig'
import {
  getBailiffLocalExtractionRate,
  getBailiffCollectionEfficiency,
  getBailiffFeeRate,
} from '../selectors/bailiffSelectors'
import { personAttitudeKey } from '../helpers/attitudeHelpers'

function withPopGroup(
  state: WorldState,
  id: PopGroupId,
  holdingId: HoldingId,
  popClass: PopClass,
  size: number,
  wealth: number,
  unrest: number = 0,
): WorldState {
  const pop: PopGroup = {
    id,
    holdingId,
    class: popClass,
    popType: popClass === 'lower' ? 'peasants' : popClass === 'middle' ? 'freeholders' : 'nobles',
    employed: true,
    size,
    wealth,
    unrest,
    attitudes: {},
  }
  const existingPopIds = state.popIndex.byHolding[holdingId] ?? []
  return {
    ...state,
    popGroups: { ...state.popGroups, [id]: pop },
    popIndex: {
      byHolding: {
        ...state.popIndex.byHolding,
        [holdingId]: [...existingPopIds, id],
      },
    },
  }
}

// v0.54: landRevenue の source は monthlyHoldingResourceRevenue snapshot。
//   テスト用に「所有なし asset 1 つ・netRevenue=totalNet の月次 snapshot」を注入する。
//   所有なし asset の holding taxable = max(0, netRevenue) なので totalNet が旧 gross に相当する。
const GROSS = 100
function withHoldingResourceRevenue(
  state: WorldState,
  holdingId: HoldingId,
  totalNet: number,
): WorldState {
  const assetId = ('re-test-' + (holdingId as string)) as RealEstateAssetId
  const asset: RealEstateAsset = {
    id: assetId,
    holdingId,
    realEstateKind: 'farm',
    level: 1,
    createdWeek: 0,
    recipeSlots: {},
  }
  const existingByHolding = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
  return {
    ...state,
    realEstateAssets: { ...state.realEstateAssets, [assetId]: asset },
    realEstateAssetIndex: {
      byHolding: {
        ...state.realEstateAssetIndex.byHolding,
        [holdingId as string]: [...existingByHolding, assetId],
      },
      byOwner: state.realEstateAssetIndex.byOwner,
    },
    monthlyHoldingResourceRevenue: {
      ...state.monthlyHoldingResourceRevenue,
      [holdingId]: {
        holdingId,
        week: state.absoluteWeek,
        totalNetRevenue: Math.max(0, totalNet),
        byResource: { food: totalNet },
        assetResults: [
          {
            assetId,
            holdingId,
            outputs: { food: totalNet },
            inputs: {},
            grossRevenue: totalNet,
            inputCost: 0,
            netRevenue: totalNet,
          },
        ],
      },
    },
  }
}

function makeCtx(state: WorldState): TickContext {
  return createTickContext({ state, config: defaultConfig, rng: createRng('test') })
}

function setupBaseWorld(): {
  state: WorldState
  polityId: PolityId
  houseId: HouseId
  provinceId: ProvinceId
  holdingId: HoldingId
  popId: PopGroupId
} {
  const polityId = 'dp-0' as PolityId
  const houseId = 'dh-0' as HouseId
  const provinceId = 'pr-0' as ProvinceId
  const popId = 'pg-0' as PopGroupId

  let state = makeEmptyV016State()
  state = withHouse(state, houseId, { seatProvinceId: provinceId })
  state = withProvince(state, provinceId, {})
  state = withPolity(state, polityId, {
    treasury: 0,
    capitalProvinceId: provinceId,
    ownerHouseId: houseId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  const holdingId = state.provinces[provinceId]!.holdingIds[0]!
  state = withPopGroup(state, popId, holdingId, 'lower', 100, 100)
  state = withHoldingResourceRevenue(state, holdingId, GROSS)
  return { state, polityId, houseId, provinceId, holdingId, popId }
}

function setupWithNormalBailiff(): ReturnType<typeof setupBaseWorld> & {
  bailiffPersonId: PersonId
} {
  const base = setupBaseWorld()
  let state = vacateHoldingBailiff(base.state, base.holdingId)
  const bailiffPersonId = 'pe-bailiff' as PersonId
  state = withPerson(state, bailiffPersonId, {
    houseId: base.houseId,
    age: 25,
    wealth: 0,
    kind: 'normal',
  })
  state = appointHoldingBailiff(state, {
    holdingId: base.holdingId,
    holderPersonId: bailiffPersonId,
    appointingPolityId: base.polityId,
    week: state.absoluteWeek,
  }).state
  return { ...base, state, bailiffPersonId }
}

describe('runLandRevenueSystem — v0.25 extraction model', () => {
  it('placeholder bailiff: treasury receives remittanceToTerminal (after fee deduction)', () => {
    const { state, polityId, holdingId } = setupBaseWorld()
    const ctx = makeCtx(state)
    const result = runLandRevenueSystem(ctx)
    const treasury = result.state.polities[polityId]!.treasury

    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const localExtractionRate = getBailiffLocalExtractionRate(state, ctx.config, assignmentId)
    const collectionEfficiency = getBailiffCollectionEfficiency(
      state,
      ctx.config,
      assignmentId,
      'none',
    )
    const bailiffFeeRate = getBailiffFeeRate(state, ctx.config, assignmentId)
    const gross = GROSS
    const collected = gross * localExtractionRate * collectionEfficiency
    const remittance = collected * (1 - bailiffFeeRate)
    const expectedTreasury = remittance * defaultLandContractConfig.taxFlowEfficiency

    expect(treasury).toBeCloseTo(expectedTreasury, 3)
    expect(treasury).toBeLessThan(gross)
  })

  it('normal bailiff: fee goes to bailiff wealth, rest to treasury', () => {
    const { state, polityId, holdingId, bailiffPersonId } = setupWithNormalBailiff()
    const ctx = makeCtx(state)
    const result = runLandRevenueSystem(ctx)

    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const localExtractionRate = getBailiffLocalExtractionRate(state, ctx.config, assignmentId)
    const collectionEfficiency = getBailiffCollectionEfficiency(
      state,
      ctx.config,
      assignmentId,
      'none',
    )
    const bailiffFeeRate = getBailiffFeeRate(state, ctx.config, assignmentId)
    const gross = GROSS
    const collected = gross * localExtractionRate * collectionEfficiency
    const bailiffFee = collected * bailiffFeeRate
    const remittance = collected - bailiffFee

    const bailiff = result.state.persons[bailiffPersonId]!
    expect(bailiff.wealth).toBeCloseTo(bailiffFee, 3)
    expect(bailiff.wealth).toBeGreaterThan(0)

    const treasury = result.state.polities[polityId]!.treasury
    const expectedTreasury = remittance * defaultLandContractConfig.taxFlowEfficiency
    expect(treasury).toBeCloseTo(expectedTreasury, 3)
  })

  it('production=0: bailiff and treasury both 0', () => {
    const { state, polityId, bailiffPersonId, holdingId } = setupWithNormalBailiff()
    // v0.54: source は月次 snapshot。revenue 0 の snapshot を注入すると holding taxable=0。
    const zeroed = withHoldingResourceRevenue(state, holdingId, 0)
    const result = runLandRevenueSystem(makeCtx(zeroed))
    expect(result.state.persons[bailiffPersonId]!.wealth).toBe(0)
    expect(result.state.polities[polityId]!.treasury).toBe(0)
  })

  it('dead bailiff: fallback, no fee, treasury gets full gross', () => {
    const { state: base, polityId, houseId, holdingId } = setupBaseWorld()
    let state = vacateHoldingBailiff(base, holdingId)
    const bailiffPersonId = 'pe-bailiff' as PersonId
    state = withPerson(state, bailiffPersonId, {
      houseId,
      age: 25,
      wealth: 0,
      kind: 'normal',
      alive: false,
    })
    state = appointHoldingBailiff(state, {
      holdingId,
      holderPersonId: bailiffPersonId,
      appointingPolityId: polityId,
      week: state.absoluteWeek,
    }).state

    const result = runLandRevenueSystem(makeCtx(state))
    const bailiff = result.state.persons[bailiffPersonId]!
    expect(bailiff.wealth).toBe(0)
  })

  it('collectionFrictionBurdenRate damages POP wealth proportional to current wealth', () => {
    const { state, holdingId } = setupWithNormalBailiff()
    const ctx = makeCtx(state)
    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const localExtractionRate = getBailiffLocalExtractionRate(state, ctx.config, assignmentId)
    const collectionEfficiency = getBailiffCollectionEfficiency(
      state,
      ctx.config,
      assignmentId,
      'none',
    )
    const frictionRate =
      localExtractionRate * (1 - collectionEfficiency) * ctx.config.collectionFrictionFactor
    const drainAt100 = frictionRate * ctx.config.localExtractionWealthPenalty * (100 / 100)
    const drainAt50 = frictionRate * ctx.config.localExtractionWealthPenalty * (50 / 100)
    expect(drainAt100).toBeGreaterThan(0)
    expect(drainAt50).toBeCloseTo(drainAt100 / 2, 5)
  })

  it('totalBurdenRate over comfort increases POP unrest', () => {
    const { state, popId } = setupWithNormalBailiff()
    const popBefore = state.popGroups[popId]!
    expect(popBefore.unrest).toBe(0)
    const result = runLandRevenueSystem(makeCtx(state))
    const popAfter = result.state.popGroups[popId]!
    expect(popAfter.unrest).toBeGreaterThan(0)
  })

  it('retainedToPop is based on provinceCollected, not gross', () => {
    const base = setupWithNormalBailiff()
    const popId = base.popId
    const newPopGroups = {
      ...base.state.popGroups,
      [popId]: { ...base.state.popGroups[popId]!, wealth: 50 },
    }
    const state = { ...base.state, popGroups: newPopGroups }
    const result = runLandRevenueSystem(makeCtx(state))
    const popAfter = result.state.popGroups[popId]!
    expect(popAfter.wealth).toBeGreaterThan(0)
    expect(popAfter.wealth).toBeLessThan(100)
  })

  it('POP→Bailiff attitude is set for normal bailiff', () => {
    const { state, popId, bailiffPersonId } = setupWithNormalBailiff()
    const result = runLandRevenueSystem(makeCtx(state))
    const popAfter = result.state.popGroups[popId]!
    const attKey = personAttitudeKey(bailiffPersonId)
    const attitude = popAfter.attitudes[attKey]
    expect(attitude).toBeDefined()
  })

  it('placeholder bailiff: no POP→Bailiff attitude update', () => {
    const { state, popId } = setupBaseWorld()
    const result = runLandRevenueSystem(makeCtx(state))
    const popAfter = result.state.popGroups[popId]!
    expect(Object.keys(popAfter.attitudes).length).toBe(0)
  })

  it('chain receives remittanceToTerminal, not grossHoldingRevenue', () => {
    const { state, polityId, holdingId } = setupWithNormalBailiff()
    const ctx = makeCtx(state)
    const result = runLandRevenueSystem(ctx)
    const treasury = result.state.polities[polityId]!.treasury

    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const localExtractionRate = getBailiffLocalExtractionRate(state, ctx.config, assignmentId)
    const collectionEfficiency = getBailiffCollectionEfficiency(
      state,
      ctx.config,
      assignmentId,
      'none',
    )
    const bailiffFeeRate = getBailiffFeeRate(state, ctx.config, assignmentId)
    const gross = GROSS
    const collected = gross * localExtractionRate * collectionEfficiency
    const remittance = collected * (1 - bailiffFeeRate)

    const expectedTreasury = remittance * defaultLandContractConfig.taxFlowEfficiency
    expect(treasury).toBeCloseTo(expectedTreasury, 3)
    expect(treasury).toBeLessThan(gross * defaultLandContractConfig.taxFlowEfficiency)
  })
})

// v0.54 §17.4/§17.5: owner income / holding due 分割と押領遮断。
//   所有 asset 1 つ・net=NET の snapshot を注入し owner 支払いを検証する。
function withOwnedAssetSnapshot(
  state: WorldState,
  holdingId: HoldingId,
  owner: AssetOwnerRef,
  net: number,
  opts: { seized?: boolean } = {},
): { state: WorldState; assetId: RealEstateAssetId } {
  const assetId = ('re-owned-' + (holdingId as string)) as RealEstateAssetId
  const asset: RealEstateAsset = {
    id: assetId,
    holdingId,
    realEstateKind: 'farm',
    level: 1,
    createdWeek: 0,
    recipeSlots: {},
    owner,
  }
  let next: WorldState = {
    ...state,
    realEstateAssets: { ...state.realEstateAssets, [assetId]: asset },
    realEstateAssetIndex: {
      byHolding: {
        ...state.realEstateAssetIndex.byHolding,
        [holdingId as string]: [assetId],
      },
      byOwner: state.realEstateAssetIndex.byOwner,
    },
    monthlyHoldingResourceRevenue: {
      ...state.monthlyHoldingResourceRevenue,
      [holdingId]: {
        holdingId,
        week: state.absoluteWeek,
        totalNetRevenue: Math.max(0, net),
        byResource: { food: net },
        assetResults: [
          {
            assetId,
            holdingId,
            outputs: { food: net },
            inputs: {},
            grossRevenue: net,
            inputCost: 0,
            netRevenue: net,
          },
        ],
      },
    },
  }
  if (opts.seized) {
    next = {
      ...next,
      realEstateSeizureIndex: {
        ...next.realEstateSeizureIndex,
        byAsset: {
          ...next.realEstateSeizureIndex.byAsset,
          [assetId as string]: 'rs-test' as RealEstateSeizureId,
        },
      },
    }
  }
  return { state: next, assetId }
}

describe('runLandRevenueSystem — v0.54 owner income / holding due', () => {
  const NET = 100
  const DUE_RATE = defaultConfig.realEstateHoldingDueRate

  it('house owner receives ownerIncome = positiveNet * (1 - dueRate); due flows to treasury', () => {
    const base = setupBaseWorld()
    const { state } = withOwnedAssetSnapshot(
      base.state,
      base.holdingId,
      { kind: 'house', id: base.houseId },
      NET,
    )
    const houseBefore = state.houses[base.houseId]!.wealth
    const result = runLandRevenueSystem(makeCtx(state))
    const houseAfter = result.state.houses[base.houseId]!.wealth
    // owner は ownerIncome を受け取る
    expect(houseAfter - houseBefore).toBeCloseTo(NET * (1 - DUE_RATE), 3)
    // holding due (= NET * DUE_RATE) は bailiff/chain 経由で treasury に流れる (>0)
    expect(result.state.polities[base.polityId]!.treasury).toBeGreaterThan(0)
  })

  it('person owner receives ownerIncome into Person.wealth', () => {
    const base = setupBaseWorld()
    const personId = 'pe-owner' as PersonId
    let state = withPerson(base.state, personId, { houseId: base.houseId, age: 40, wealth: 10 })
    state = withOwnedAssetSnapshot(
      state,
      base.holdingId,
      { kind: 'person', id: personId },
      NET,
    ).state
    const result = runLandRevenueSystem(makeCtx(state))
    expect(result.state.persons[personId]!.wealth).toBeCloseTo(10 + NET * (1 - DUE_RATE), 3)
  })

  it('inactive owner: ownerIncome is NOT dropped — it falls back to holding taxable (conservation §21.4)', () => {
    // 所有なし asset と inactive-house 所有 asset の treasury が一致する
    // (どちらも全 positiveNet が taxable に入り保存則が閉じる) ことを確認する。
    const unownedBase = setupBaseWorld()
    const unowned = withHoldingResourceRevenue(unownedBase.state, unownedBase.holdingId, NET)
    const unownedTreasury = runLandRevenueSystem(makeCtx(unowned)).state.polities[
      unownedBase.polityId
    ]!.treasury

    const ownedBase = setupBaseWorld()
    const { state: ownedState } = withOwnedAssetSnapshot(
      ownedBase.state,
      ownedBase.holdingId,
      { kind: 'house', id: ownedBase.houseId },
      NET,
    )
    // owner house を inactive にする → ownerIncome は支払えない。
    const inactiveState: WorldState = {
      ...ownedState,
      houses: {
        ...ownedState.houses,
        [ownedBase.houseId]: { ...ownedState.houses[ownedBase.houseId]!, active: false },
      },
    }
    const result = runLandRevenueSystem(makeCtx(inactiveState))
    // owner は受け取らない
    expect(result.state.houses[ownedBase.houseId]!.wealth).toBe(
      ownedState.houses[ownedBase.houseId]!.wealth,
    )
    // treasury は所有なしケースと一致 (ownerIncome が holding taxable に戻り保存則が閉じる)
    expect(result.state.polities[ownedBase.polityId]!.treasury).toBeCloseTo(unownedTreasury, 6)
  })

  it('active seizure: owner is NOT paid; full positiveNet becomes holding taxable', () => {
    const base = setupBaseWorld()
    const { state } = withOwnedAssetSnapshot(
      base.state,
      base.holdingId,
      { kind: 'house', id: base.houseId },
      NET,
      { seized: true },
    )
    const houseBefore = state.houses[base.houseId]!.wealth
    const result = runLandRevenueSystem(makeCtx(state))
    // 押領中: owner には支払われない
    expect(result.state.houses[base.houseId]!.wealth).toBe(houseBefore)
    // 全額 taxable → treasury に (一部) 流れる
    expect(result.state.polities[base.polityId]!.treasury).toBeGreaterThan(0)
  })

  // v0.54 market-clearing rewrite: raw 不足 workshop は netRevenue が負になり得る。
  //   positiveNet = max(0, netRevenue) の床留めで、負の asset は分配に寄与せず保存則が閉じる (§6.3c.1 / §21.4)。
  //   net=0 の asset と net=-50 の asset は (どちらも床留め 0 で) 同一 treasury になることを確認する。
  it('negative netRevenue asset: floored to 0 — owner not paid, treasury == zero-net case (conservation)', () => {
    const zeroBase = setupBaseWorld()
    const { state: zeroState } = withOwnedAssetSnapshot(
      zeroBase.state,
      zeroBase.holdingId,
      { kind: 'house', id: zeroBase.houseId },
      0,
    )
    const zeroHouseBefore = zeroState.houses[zeroBase.houseId]!.wealth
    const zeroResult = runLandRevenueSystem(makeCtx(zeroState))
    const zeroTreasury = zeroResult.state.polities[zeroBase.polityId]!.treasury

    const lossBase = setupBaseWorld()
    const { state } = withOwnedAssetSnapshot(
      lossBase.state,
      lossBase.holdingId,
      { kind: 'house', id: lossBase.houseId },
      -50, // 赤字 asset
    )
    const houseBefore = state.houses[lossBase.houseId]!.wealth
    const result = runLandRevenueSystem(makeCtx(state))
    // owner は赤字分を負担しない (床留め)。net=0 ケースでも owner は受け取らない。
    expect(zeroResult.state.houses[zeroBase.houseId]!.wealth).toBe(zeroHouseBefore)
    expect(result.state.houses[lossBase.houseId]!.wealth).toBe(houseBefore)
    // 赤字 asset は分配に寄与せず treasury は net=0 ケースと一致
    expect(result.state.polities[lossBase.polityId]!.treasury).toBeCloseTo(zeroTreasury, 6)
  })
})
