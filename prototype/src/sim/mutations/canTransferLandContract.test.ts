import { describe, it, expect } from 'vitest'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import type { WorldState } from '../types/world'
import type { HouseId, PolityId, ProvinceId, HoldingId } from '../types/ids'
import type { PolityRank } from '../types/polity'
import {
  planLandContractTransfer,
  canTransferLandContract,
  applyLandContractTransferGoal,
  createChildLandContract,
} from './landContractMutations'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { TickContext } from '../tick/context'

// root contract grantor は ROOT_WORLD (rank 0)。grantee polity の rank を振り分けて
// rank invariant の成否を直接テストする。bindProvinceToHouseViaPolity は当該 province の
// holding を polity に root grant する。
function buildWorld(holderRank: PolityRank): {
  state: WorldState
  holderPolityId: PolityId
  otherPolityId: PolityId
  holdingId: HoldingId
} {
  let s = makeEmptyV016State()
  const provinceId = 'pr-1' as ProvinceId
  const holderPolityId = 'c-holder' as PolityId
  const otherPolityId = 'c-other' as PolityId
  const holderHouseId = 'h-holder' as HouseId

  s = withProvince(s, provinceId)
  s = withHouse(s, holderHouseId, { seatProvinceId: provinceId })
  s = withPolity(s, holderPolityId, { rank: holderRank, capitalProvinceId: provinceId })
  // other は後で rank を上書きする (テストごとに setRank)。
  s = withPolity(s, otherPolityId, { rank: holderRank, capitalProvinceId: provinceId })
  s = bindProvinceToHouseViaPolity(s, provinceId, holderPolityId, holderHouseId)
  const holdingId = s.provinces[provinceId]?.holdingIds[0] as HoldingId
  return { state: s, holderPolityId, otherPolityId, holdingId }
}

function setRank(state: WorldState, polityId: PolityId, rank: PolityRank): WorldState {
  const p = state.polities[polityId]
  if (!p) return state
  return { ...state, polities: { ...state.polities, [polityId]: { ...p, rank } } }
}

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('can-transfer-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
  }
}

describe('planLandContractTransfer / canTransferLandContract', () => {
  it('rank invariant OK: root(0) grantor < new grantee rank → swap_grantee', () => {
    // holder rank 3 (root grant), claimer rank 2: grantor=ROOT(0) < 2 → 適用可能。
    const built = buildWorld(3)
    const { holderPolityId, otherPolityId, holdingId } = built
    const state = setRank(built.state, otherPolityId, 2)

    const plan = planLandContractTransfer(state, {
      holdingId,
      fromPolityId: holderPolityId,
      toPolityId: otherPolityId,
    })
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.value.kind).toBe('swap_grantee')
    expect(canTransferLandContract(state, holdingId, holderPolityId, otherPolityId)).toBe(true)
  })

  it('noop: holding は既に toPolity 所有', () => {
    const { state, holderPolityId, holdingId } = buildWorld(2)
    const plan = planLandContractTransfer(state, {
      holdingId,
      fromPolityId: holderPolityId,
      toPolityId: holderPolityId,
    })
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.value.kind).toBe('noop')
    expect(canTransferLandContract(state, holdingId, holderPolityId, holderPolityId)).toBe(true)
  })

  it('CONTRACT_NOT_FOUND: fromPolity が chain の grantee でない', () => {
    const { state, holderPolityId, otherPolityId, holdingId } = buildWorld(2)
    // from = other (chain の grantee でない) / to = holder (実在 active) → chain に該当 contract なし。
    const plan = planLandContractTransfer(state, {
      holdingId,
      fromPolityId: otherPolityId,
      toPolityId: holderPolityId,
    })
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.error.code).toBe('CONTRACT_NOT_FOUND')
  })

  it('POLITY_NOT_FOUND: toPolity が存在しない', () => {
    const { state, holderPolityId, holdingId } = buildWorld(2)
    expect(canTransferLandContract(state, holdingId, holderPolityId, 'c-missing' as PolityId)).toBe(
      false,
    )
  })

  it('canTransfer と applyLandContractTransferGoal の成否が一致する (単一の真実)', () => {
    // 適用可能ケース
    const okWorld = buildWorld(3)
    const okState = setRank(okWorld.state, okWorld.otherPolityId, 2)
    const can = canTransferLandContract(
      okState,
      okWorld.holdingId,
      okWorld.holderPolityId,
      okWorld.otherPolityId,
    )
    const applied = applyLandContractTransferGoal(makeCtx(okState), {
      holdingId: okWorld.holdingId,
      fromPolityId: okWorld.holderPolityId,
      toPolityId: okWorld.otherPolityId,
      reason: 'war',
    })
    expect(can).toBe(applied.ok)
    expect(can).toBe(true)

    // 適用不能ケース (toPolity 不在)
    const cantState = okState
    const cant = canTransferLandContract(
      cantState,
      okWorld.holdingId,
      okWorld.holderPolityId,
      'c-missing' as PolityId,
    )
    const notApplied = applyLandContractTransferGoal(makeCtx(cantState), {
      holdingId: okWorld.holdingId,
      fromPolityId: okWorld.holderPolityId,
      toPolityId: 'c-missing' as PolityId,
      reason: 'war',
    })
    expect(cant).toBe(notApplied.ok)
    expect(cant).toBe(false)
  })

  // --- 5-c 分岐 (claimer が下位 rank = 高 rank-number) のチェーン構造検証 ---
  // refactor (planLandContractTransfer 抽出) で最もリスクの高い chain-walk 経路を直接固定する。

  it('5-c create_child: 下位 rank claimer が leaf holding を取得 → 親 contract の子を新設', () => {
    // holder rank 2 (root grant) / claimer rank 3 (下位 tier)。toPolity.rank(3) > fromRank(2) →
    //   anchor(root) に子が無い → create_child。
    const built = buildWorld(2)
    const claimer = built.otherPolityId
    const state = setRank(built.state, claimer, 3)
    const rootId = state.landContractIndex.byHolding[built.holdingId]![0]!

    const plan = planLandContractTransfer(state, {
      holdingId: built.holdingId,
      fromPolityId: built.holderPolityId,
      toPolityId: claimer,
    })
    expect(plan.ok).toBe(true)
    if (plan.ok && plan.value.kind === 'create_child') {
      expect(plan.value.parentContractId).toBe(rootId)
    } else {
      expect.fail(`expected create_child, got ${plan.ok ? plan.value.kind : 'err'}`)
    }

    const applied = applyLandContractTransferGoal(makeCtx(state), {
      holdingId: built.holdingId,
      fromPolityId: built.holderPolityId,
      toPolityId: claimer,
      reason: 'war',
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const after = applied.value.ctx.state
    const chain = after.landContractIndex.byHolding[built.holdingId]!
    expect(chain.length).toBe(2)
    const terminal = after.landContracts[chain[chain.length - 1]!]!
    expect(terminal.granteePolityId).toBe(claimer)
    expect(terminal.parentContractId).toBe(rootId)
    expect(after.holdingTerminalPolityCache[built.holdingId]).toBe(claimer)
  })

  it('5-c insert_below: 中位 rank claimer が chain 途中 (root と深い子の間) に挿入', () => {
    // chain: root=holder A(rank 1) → child=C(rank 4)。claimer B(rank 2) が A から取得。
    //   toPolity.rank(2) > fromRank(1) → branch B。child C の rank(4) > 2 → insert_below(belowContractId=C)。
    const provinceId = 'pr-1' as ProvinceId
    const built = buildWorld(1)
    const deepPolity = 'c-deep' as PolityId
    let s = withPolity(built.state, deepPolity, { rank: 4, capitalProvinceId: provinceId })
    const rootId = s.landContractIndex.byHolding[built.holdingId]![0]!
    const created = createChildLandContract(s, {
      provinceId,
      parentContractId: rootId,
      granteePolityId: deepPolity,
      taxRateToGrantor: 0.3,
      holdingId: built.holdingId,
    })
    s = created.state
    const childId = created.contractId
    const claimer = built.otherPolityId
    s = setRank(s, claimer, 2)

    const plan = planLandContractTransfer(s, {
      holdingId: built.holdingId,
      fromPolityId: built.holderPolityId,
      toPolityId: claimer,
    })
    expect(plan.ok).toBe(true)
    if (plan.ok && plan.value.kind === 'insert_below') {
      expect(plan.value.belowContractId).toBe(childId)
    } else {
      expect.fail(`expected insert_below, got ${plan.ok ? plan.value.kind : 'err'}`)
    }

    const applied = applyLandContractTransferGoal(makeCtx(s), {
      holdingId: built.holdingId,
      fromPolityId: built.holderPolityId,
      toPolityId: claimer,
      reason: 'war',
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const after = applied.value.ctx.state
    const chain = after.landContractIndex.byHolding[built.holdingId]!
    // root(A) → B(挿入) → C(deep) の 3 段。terminal は依然 C。
    expect(chain.length).toBe(3)
    expect(chain[0]).toBe(rootId)
    const inserted = after.landContracts[chain[1]!]!
    expect(inserted.granteePolityId).toBe(claimer)
    expect(inserted.parentContractId).toBe(rootId)
    expect(chain[2]).toBe(childId)
    expect(after.landContracts[childId]!.parentContractId).toBe(chain[1])
    // terminal grantee は C のまま (挿入は terminal を変えない)。
    expect(after.holdingTerminalPolityCache[built.holdingId]).toBe(deepPolity)
  })
})
