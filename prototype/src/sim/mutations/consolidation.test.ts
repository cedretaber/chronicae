// v0.47 §12 一円支配集約 (applyConsolidationMut) のユニットテスト。
// danger #2 (collapse 反復 / 他家挟在 / 順序) を構築 state で決定的に検証する。

import { describe, expect, it } from 'vitest'
import {
  createHouseId,
  createPolityId,
  createProvinceId,
  createHoldingId,
  type LandContractId,
  type PolityId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import { applyConsolidationMut } from './consolidationMutations'
import { createChildLandContract } from './landContractMutations'
import { collectIntegrityErrors } from '../tick/integritySystem'
import { runPolityOwnerConsistencySystem } from '../tick/polityOwnerConsistencySystem'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import {
  makeEmptyV016State,
  withHouse,
  withPolity,
  withProvince,
  withHolding,
  bindProvinceToPolity,
} from '../testFixtures'

const houseId = createHouseId('dh', 0)
const otherHouseId = createHouseId('dh', 1)
const sinkPolityId = createPolityId('dp', 0)
const subPolityId = createPolityId('dp', 1)
const otherPolityId = createPolityId('dp', 2)
const provinceId = createProvinceId('p', 0)
const h0 = createHoldingId(0)

function baseState(): WorldState {
  let s = makeEmptyV016State()
  s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  s = withProvince(s, provinceId, { nameKey: 'Province0', holdingIds: [h0] })
  s = withHolding(s, h0, provinceId, { nameKey: 'Holding0' })
  s = withHouse(s, houseId, { nameKey: 'House0', seatProvinceId: provinceId })
  return s
}

// root → sink(rank2) → grantee(rank5) の chain を holding h0 に作る。
function chainRootSinkGrantee(s: WorldState, granteePolityId: PolityId): WorldState {
  let st = bindProvinceToPolity(s, provinceId, sinkPolityId) // root → sink (sink terminal)
  const sinkContractId = (st.landContractIndex.byHolding[h0] ?? [])[0] as LandContractId
  const r = createChildLandContract(st, {
    provinceId,
    parentContractId: sinkContractId,
    granteePolityId,
    taxRateToGrantor: 0.5,
    holdingId: h0,
  })
  st = r.state
  return st
}

describe('v0.47 一円支配集約', () => {
  it('同家の multi-level chain を sink まで畳む (sink が holding を terminal 掌握)', () => {
    let s = baseState()
    s = withPolity(s, sinkPolityId, {
      rank: 2,
      ownerHouseId: houseId,
      capitalProvinceId: provinceId,
    })
    s = withPolity(s, subPolityId, {
      rank: 5,
      ownerHouseId: houseId,
      capitalProvinceId: provinceId,
    })
    s = chainRootSinkGrantee(s, subPolityId)
    // 集約前: sub が terminal。
    expect(s.holdingTerminalPolityCache[h0]).toBe(subPolityId)

    const baseline = new Set(
      collectIntegrityErrors(s, { debug: false, config: defaultConfig }).map((e) => e.message),
    )
    const { ws, consolidatedCount } = applyConsolidationMut(s, houseId, sinkPolityId)
    expect(consolidatedCount).toBe(1)
    // 集約後: sink が terminal。
    expect(ws.holdingTerminalPolityCache[h0]).toBe(sinkPolityId)

    // §12.9: landless 化した sub-polity (rank5) は polityOwnerConsistencySystem で abolish される。
    const ctx = {
      state: ws,
      rng: createRng('test'),
      config: defaultConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 10,
      nextHouseIndex: 10,
      nextPolityIndex: 10,
    }
    const after = runPolityOwnerConsistencySystem(ctx).state
    expect(after.polities[subPolityId]!.active).toBe(false) // rank5 landless → abolished
    // integrity clean (新規違反なし)。
    const newErrors = collectIntegrityErrors(after, { debug: false, config: defaultConfig })
      .map((e) => e.message)
      .filter((m) => !baseline.has(m))
    expect(newErrors).toEqual([])
  })

  it('他家が chain に挟まる場合は畳まない (他家排除は future)', () => {
    let s = baseState()
    s = withHouse(s, otherHouseId, { nameKey: 'House1', seatProvinceId: provinceId })
    s = withPolity(s, sinkPolityId, {
      rank: 2,
      ownerHouseId: houseId,
      capitalProvinceId: provinceId,
    })
    // sink の直下が他家 Polity → collapse は停止する。
    s = withPolity(s, otherPolityId, {
      rank: 4,
      ownerHouseId: otherHouseId,
      capitalProvinceId: provinceId,
    })
    s = chainRootSinkGrantee(s, otherPolityId)
    expect(s.holdingTerminalPolityCache[h0]).toBe(otherPolityId)

    const { ws, consolidatedCount } = applyConsolidationMut(s, houseId, sinkPolityId)
    expect(consolidatedCount).toBe(0)
    // 他家 Polity は terminal のまま (collapse されない)。
    expect(ws.holdingTerminalPolityCache[h0]).toBe(otherPolityId)
  })

  // §12.7 step3: sink と terminal が同家でも、間に他家が挟まる sandwich chain は
  // holding を丸ごと skip しなければならない。途中の同家 contract だけ畳むと
  // 他家 Polity の grantor を sink に繋ぎ替えてしまう (他家 chain 改変は future)。
  it('sink〜terminal 間に他家が挟まる sandwich は畳まない (途中の同家 contract も触らない)', () => {
    const terminalPolityId = createPolityId('dp', 3)
    let s = baseState()
    s = withHouse(s, otherHouseId, { nameKey: 'House1', seatProvinceId: provinceId })
    s = withPolity(s, sinkPolityId, {
      rank: 2,
      ownerHouseId: houseId,
      capitalProvinceId: provinceId,
    })
    s = withPolity(s, subPolityId, {
      rank: 3,
      ownerHouseId: houseId,
      capitalProvinceId: provinceId,
    }) // A 同家
    s = withPolity(s, otherPolityId, {
      rank: 4,
      ownerHouseId: otherHouseId,
      capitalProvinceId: provinceId,
    }) // B 他家
    s = withPolity(s, terminalPolityId, {
      rank: 5,
      ownerHouseId: houseId,
      capitalProvinceId: provinceId,
    }) // T 同家 terminal

    // chain: root → sink(H,2) → A(H,3) → B(other,4) → T(H,5)
    s = bindProvinceToPolity(s, provinceId, sinkPolityId)
    const sinkContractId = (s.landContractIndex.byHolding[h0] ?? [])[0] as LandContractId
    const linkChild = (parentContractId: LandContractId, granteePolityId: PolityId): WorldState =>
      createChildLandContract(s, {
        provinceId,
        parentContractId,
        granteePolityId,
        taxRateToGrantor: 0.5,
        holdingId: h0,
      }).state
    const contractTo = (st: WorldState, pid: PolityId): LandContractId =>
      (st.landContractIndex.byHolding[h0] ?? []).find(
        (id) => st.landContracts[id]?.granteePolityId === pid,
      ) as LandContractId
    s = linkChild(sinkContractId, subPolityId)
    const aContractId = contractTo(s, subPolityId)
    s = linkChild(aContractId, otherPolityId)
    const bContractId = contractTo(s, otherPolityId)
    s = linkChild(bContractId, terminalPolityId)

    expect(s.holdingTerminalPolityCache[h0]).toBe(terminalPolityId)
    const contractCountBefore = (s.landContractIndex.byHolding[h0] ?? []).length

    const { ws, consolidatedCount } = applyConsolidationMut(s, houseId, sinkPolityId)

    // sandwich は丸ごと skip: 集約数 0・terminal 不変・chain 構造不変。
    expect(consolidatedCount).toBe(0)
    expect(ws.holdingTerminalPolityCache[h0]).toBe(terminalPolityId)
    expect((ws.landContractIndex.byHolding[h0] ?? []).length).toBe(contractCountBefore)
    // 同家 A を畳んでいない = 他家 B の親契約は A のまま (sink に繋ぎ替えられていない)。
    expect(ws.landContracts[bContractId]?.parentContractId).toBe(aContractId)
  })
})
