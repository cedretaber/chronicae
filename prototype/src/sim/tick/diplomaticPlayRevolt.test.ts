import { describe, it, expect } from 'vitest'
import { progressRevoltNegotiation } from './diplomaticPlayRevolt'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  withPerson,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createChildLandContract } from '../mutations/landContractMutations'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext } from './context'
import type { WorldState } from '../types/world'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type {
  PolityId,
  HouseId,
  PersonId,
  ProvinceId,
  HoldingId,
  PopGroupId,
  LandContractId,
  DiplomaticPlayId,
} from '../types/ids'

// v0.47.x 回帰: 叛乱交渉の escalation 分岐は「現」terminal holder の rank で判定する。
// play.target は play 生成時の terminal holder で固定されるため、交渉中に当該 holding が
// land_grant 等で rank 5 polity へ再分封されると play.target は stale (rank 2-4) のまま
// terminal holder だけ rank 5 になる。旧実装は stale な play.target.rank を見て rank 2-4 と
// 誤判定し、rank 5 terminal holder の下に revolt_seizure 子契約 (grantee=rank 5 commonwealth)
// を作って §25 #7 (grantor rank < grantee rank) を破っていた。
//
// 現 terminal holder の rank を基準にすることで、rank 5 terminal holder は internal revolt に
// 分岐し seizure 子契約を作らない。通常の rank 2-4 terminal holder は従来どおり seizure を作る。

const PROVINCE_ID = 'pr-1' as ProvinceId
const ROOT_POLITY_ID = 'c-1' as PolityId // play.target に使う (stale 化させる側)
const ROOT_HOUSE_ID = 'h-1' as HouseId
const TERMINAL_POLITY_ID = 'dp-1' as PolityId // 現 terminal holder
const COMMONWEALTH_ID = 'cw-1' as PolityId
const LEADER_ID = 'p-leader' as PersonId
const LEADER_HOUSE_ID = 'h-leader' as HouseId
const POP_ID = 'pg-1' as PopGroupId
const PLAY_ID = 'dpl-1' as DiplomaticPlayId

// terminal holder の rank を引数に取り、stale な play.target=rank 2 (c-1) との組合せで
// escalation 直前の状態を構築する。
function buildEscalationState(terminalRank: 2 | 3 | 5): {
  state: WorldState
  holdingId: HoldingId
  terminalContractId: LandContractId
} {
  let s = makeEmptyV016State()
  s = withProvince(s, PROVINCE_ID, {})
  const holdingId = ('hl-' + 0) as HoldingId // withProvince が hl-0 を作る
  s = withPolity(s, ROOT_POLITY_ID, { rank: 2, capitalProvinceId: PROVINCE_ID })
  s = withHouse(s, ROOT_HOUSE_ID, { seatProvinceId: PROVINCE_ID })
  s = bindProvinceToHouseViaPolity(s, PROVINCE_ID, ROOT_POLITY_ID, ROOT_HOUSE_ID)
  const rootContractId = s.landContractIndex.byHolding[holdingId]![0]!

  // 末端保有者を別 polity (terminalRank) に分封して terminal holder を差し替える。
  s = withPolity(s, TERMINAL_POLITY_ID, { rank: terminalRank, capitalProvinceId: PROVINCE_ID })
  const childRes = createChildLandContract(s, {
    provinceId: PROVINCE_ID,
    parentContractId: rootContractId,
    granteePolityId: TERMINAL_POLITY_ID,
    taxRateToGrantor: 0.5,
    holdingId,
  })
  s = childRes.state
  const terminalContractId = childRes.contractId

  // 反乱する POP (高 unrest peasants)。
  s = {
    ...s,
    popGroups: {
      ...s.popGroups,
      [POP_ID]: {
        id: POP_ID,
        holdingId,
        class: 'peasants',
        employed: true,
        size: 100,
        wealth: 10,
        unrest: 80,
        attitudes: {},
      },
    },
    popIndex: {
      byHolding: { ...s.popIndex.byHolding, [holdingId]: [POP_ID] },
    },
  }

  // 交渉用 commonwealth (rank 5, 反乱軍) と首謀者。
  s = withHouse(s, LEADER_HOUSE_ID, { seatProvinceId: PROVINCE_ID })
  s = withPerson(s, LEADER_ID, { houseId: LEADER_HOUSE_ID, age: 35 })
  s = {
    ...s,
    polities: {
      ...s.polities,
      [COMMONWEALTH_ID]: {
        id: COMMONWEALTH_ID,
        nameSource: { kind: 'holding', holdingId },
        treasury: 0,
        adminPower: 0,
        legacyPrestige: 0,
        active: true,
        capitalProvinceId: PROVINCE_ID,
        rank: 5,
        kind: 'commonwealth',
        origin: {
          kind: 'popular_revolt',
          originalPolityId: ROOT_POLITY_ID,
          provinceId: PROVINCE_ID,
          holdingIds: [holdingId],
          popClass: 'peasants',
          leaderPersonId: LEADER_ID,
          startedWeek: 0,
        },
        revoltState: { kind: 'negotiating', diplomaticPlayId: PLAY_ID },
      },
    },
  }

  return { state: s, holdingId, terminalContractId }
}

function buildPlay(holdingId: HoldingId, targetContractId: LandContractId): DiplomaticPlay {
  return {
    id: PLAY_ID,
    kind: 'revolt_negotiation',
    initiator: { kind: 'polity', id: COMMONWEALTH_ID },
    // play.target は stale な「元」terminal holder (rank 2 の c-1)。
    target: { kind: 'polity', id: ROOT_POLITY_ID },
    // v0.48: escalation を駆動するのは secession demand (即時武装蜂起)。rank 判定ロジックは
    //   demand kind に依らず applyRevoltEscalation 内で共通。
    primaryDemand: {
      kind: 'secession',
      holdingId,
      targetContractId,
      claimantPopClass: 'peasants',
    },
    status: 'active',
    startedWeek: 0,
    deadlineWeek: 0,
    progress: 5,
    tension: 95,
    initiatorDelegatePersonId: LEADER_ID,
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
  }
}

function hasRevoltSeizureContract(state: WorldState): boolean {
  return Object.values(state.landContracts).some((c) => c?.specialStatus?.kind === 'revolt_seizure')
}

describe('progressRevoltNegotiation escalation: rank judged on current terminal holder', () => {
  it('rank 5 terminal holder (stale rank-2 play.target) → internal revolt, NO revolt_seizure contract (§25 #7)', () => {
    const { state, holdingId, terminalContractId } = buildEscalationState(5)
    const play = buildPlay(holdingId, terminalContractId)
    const ctx = createTickContext({ state, rng: createRng('revolt-rank5'), config: defaultConfig })

    const next = progressRevoltNegotiation(ctx, play)

    // 旧実装ではここで grantor rank 5 >= grantee rank 5 の seizure 子契約が作られていた。
    expect(hasRevoltSeizureContract(next.state)).toBe(false)
  })

  it('rank 3 terminal holder → seizure path retained (revolt_seizure contract created)', () => {
    const { state, holdingId, terminalContractId } = buildEscalationState(3)
    const play = buildPlay(holdingId, terminalContractId)
    const ctx = createTickContext({ state, rng: createRng('revolt-rank3'), config: defaultConfig })

    const next = progressRevoltNegotiation(ctx, play)

    // 通常の rank 2-4 terminal holder では従来どおり seizure 子契約が作られる。
    expect(hasRevoltSeizureContract(next.state)).toBe(true)
  })
})
