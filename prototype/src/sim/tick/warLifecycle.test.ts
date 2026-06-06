import { describe, it, expect } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext, type TickContext } from './context'
import type { WorldState } from '../types/world'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type { HoldingId, PolityId, ProvinceId, HouseId, DiplomaticPlayId } from '../types/ids'
import { createWar } from '../mutations/warMutations'
import { getHoldingTerminalPolityId } from '../selectors/landContractSelectors'
import { runWarCreationSystem } from './warCreationSystem'
import { runCancelOrphanedWarsSystem } from './cancelOrphanedWarsSystem'
import { runPeaceSettlementSystem } from './peaceSettlementSystem'
import { runCleanupWarSystem } from './cleanupWarSystem'

// v0.34 §B-10: War lifecycle system のテスト。decisive-path (land 移転 / tax 実変更 / stale→white_peace)
//   は warScore が乱数なし＝CLI で全 War が white_peace に倒れる可能性があるため unit test で必ず踏ませる。

function makeCtx(world: WorldState, seed = 'war-lifecycle'): TickContext {
  // v0.42: これらは War lifecycle (creation→決着→cleanup) を検証するテストで、開戦判断そのものは
  //   対象外。勝率/性格ゲート (warEstimateSelectors / warCreationSystem.test.ts で別途検証) は OFF にし、
  //   従来どおり escalated play → War 化を確実に踏ませる。
  const config = { ...defaultConfig, winChanceWarGateEnabled: false }
  return createTickContext({ state: world, rng: createRng(seed), config })
}

function freshWorld(seed = 'war-lifecycle'): WorldState {
  return generateWorld(seed).world
}

// holding と、その terminal owner / 別の active polity を 1 組返す。
function pickHoldingAndPolities(world: WorldState): {
  holdingId: HoldingId
  owner: PolityId
  other: PolityId
} {
  const activePolities = Object.values(world.polities)
    .filter((p) => p && p.active)
    .map((p) => p.id)
  for (const hid of Object.keys(world.holdings) as HoldingId[]) {
    const owner = getHoldingTerminalPolityId(world, hid)
    if (!owner || !world.polities[owner]?.active) continue
    const other = activePolities.find((id) => (id as string) !== (owner as string))
    if (!other) continue
    return { holdingId: hid, owner, other }
  }
  throw new Error('no suitable holding/polities in generated world')
}

// escalated land_claim play を注入する。
function injectEscalatedLandClaim(
  world: WorldState,
  playId: string,
  initiator: PolityId,
  target: PolityId,
  holdingId: HoldingId,
): void {
  const holding = world.holdings[holdingId]
  const firstProvinceId = (Object.keys(world.provinces)[0] ?? 'pr-0') as ProvinceId
  const provinceId = holding ? holding.provinceId : firstProvinceId
  const play: DiplomaticPlay = {
    id: playId as DiplomaticPlayId,
    kind: 'land_claim',
    initiator: { kind: 'polity', id: initiator },
    target: { kind: 'polity', id: target },
    issue: { kind: 'land_claim', holdingId, provinceId },
    status: 'escalated',
    startedWeek: world.absoluteWeek,
    deadlineWeek: world.absoluteWeek + 48,
    progress: 10,
    tension: 70,
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
  world.diplomaticPlays[play.id] = play
}

// rank 互換な 2 polity + 移転可能な holding を持つ統制 fixture (旧 conflict test の setupLTD と同等)。
//   generateWorld の任意 rank では applyLandContractTransferGoal の rank invariant に阻まれるため、
//   transfer 成功を確実にしたい decisive test ではこちらを使う。
function setupTransferableHolding(): {
  world: WorldState
  holdingId: HoldingId
  attacker: PolityId
  defender: PolityId
} {
  let s = makeEmptyV016State()
  const pAtt = 'pr-att' as ProvinceId
  const pDef = 'pr-def' as ProvinceId
  const attacker = 'c-att' as PolityId
  const defender = 'c-def' as PolityId
  const hAtt = 'h-att' as HouseId
  const hDef = 'h-def' as HouseId
  s = withProvince(s, pAtt, { neighbors: [pDef] })
  s = withProvince(s, pDef, { neighbors: [pAtt] })
  s = withHouse(s, hAtt, { seatProvinceId: pAtt, wealth: 200 })
  s = withHouse(s, hDef, { seatProvinceId: pDef, wealth: 50 })
  s = withPolity(s, attacker, { rank: 2, treasury: 2000, capitalProvinceId: pAtt })
  s = withPolity(s, defender, { rank: 3, treasury: 500, capitalProvinceId: pDef })
  s = bindProvinceToHouseViaPolity(s, pAtt, attacker, hAtt)
  s = bindProvinceToHouseViaPolity(s, pDef, defender, hDef)
  const holdingId = s.provinces[pDef]?.holdingIds[0]
  if (!holdingId) throw new Error('no holding in defender province')
  return { world: s, holdingId, attacker, defender }
}

describe('WarCreationSystem (§6)', () => {
  it('escalated land_claim → War 1 件生成 + play=resolved_by_conflict + WAR_DECLARED', () => {
    // §6.5: WarCreation は rank invariant 上 transfer 可能な goal のみ War 化する。generateWorld の
    //   任意 rank holding では canTransferLandContract に阻まれるため、移転可能な統制 fixture を使う。
    const { world, holdingId, attacker, defender } = setupTransferableHolding()
    injectEscalatedLandClaim(world, 'dp-a', attacker, defender, holdingId)
    const before = Object.keys(world.wars).length

    const next = runWarCreationSystem(makeCtx(world))

    expect(Object.keys(next.state.wars).length).toBe(before + 1)
    expect(next.state.diplomaticPlays['dp-a' as DiplomaticPlayId]?.status).toBe(
      'resolved_by_conflict',
    )
    expect(next.events.some((e) => e.type === 'WAR_DECLARED')).toBe(true)
    const war = Object.values(next.state.wars).find((w) => w?.originDiplomaticPlayId === 'dp-a')
    expect(war?.status).toBe('active')
    expect(war?.warGoals[0]?.kind).toBe('transfer_land_contract')
  })

  it('同一 holding の 2 件目 escalated land_claim は dedup で cancelled・War は増えない', () => {
    const { world, holdingId, attacker, defender } = setupTransferableHolding()
    injectEscalatedLandClaim(world, 'dp-a', attacker, defender, holdingId)
    injectEscalatedLandClaim(world, 'dp-b', attacker, defender, holdingId)
    const before = Object.keys(world.wars).length

    const next = runWarCreationSystem(makeCtx(world))

    expect(Object.keys(next.state.wars).length).toBe(before + 1)
    expect(next.state.diplomaticPlays['dp-a' as DiplomaticPlayId]?.status).toBe(
      'resolved_by_conflict',
    )
    expect(next.state.diplomaticPlays['dp-b' as DiplomaticPlayId]?.status).toBe('cancelled')
  })

  // v0.43 §10.3a/§10.4: supporter copy filter
  it('play の supporter が copy filter を通過して War participants に入り WAR_PARTICIPANT_JOINED が出る', () => {
    const { world, holdingId, attacker, defender } = setupTransferableHolding()
    const s = withPolity(world, 'c-sup' as PolityId, { rank: 2, treasury: 100 })
    injectEscalatedLandClaim(s, 'dp-a', attacker, defender, holdingId)
    s.diplomaticPlays['dp-a' as DiplomaticPlayId] = {
      ...s.diplomaticPlays['dp-a' as DiplomaticPlayId]!,
      initiatorSupporters: [
        { actor: { kind: 'polity', id: 'c-sup' as PolityId }, joinedWeek: 0, commitment: 50 },
      ],
    }

    const next = runWarCreationSystem(makeCtx(s))

    const war = Object.values(next.state.wars).find((w) => w?.originDiplomaticPlayId === 'dp-a')
    expect(war?.attacker.participants).toHaveLength(2)
    expect(war?.attacker.participants[1]).toMatchObject({
      actor: { kind: 'polity', id: 'c-sup' },
      primary: false,
    })
    expect(next.state.warIndex.byParticipant['polity:c-sup']).toContain(war!.id)
    expect(next.events.some((e) => e.type === 'WAR_PARTICIPANT_JOINED')).toBe(true)
  })

  it('他 active War 参加中の supporter は copy filter で落ち、event も出ない (War は続行)', () => {
    const { world, holdingId, attacker, defender } = setupTransferableHolding()
    let s = withPolity(world, 'c-sup' as PolityId, { rank: 2, treasury: 100 })
    s = withPolity(s, 'c-other' as PolityId, { rank: 2, treasury: 100 })
    // supporter を既存の active War に参加させておく
    createWar(s, {
      attacker: { kind: 'polity', id: 'c-sup' as PolityId },
      defender: { kind: 'polity', id: 'c-other' as PolityId },
      warGoals: [],
      targetWarScore: 50,
      startedWeek: s.absoluteWeek,
    })
    injectEscalatedLandClaim(s, 'dp-a', attacker, defender, holdingId)
    s.diplomaticPlays['dp-a' as DiplomaticPlayId] = {
      ...s.diplomaticPlays['dp-a' as DiplomaticPlayId]!,
      initiatorSupporters: [
        { actor: { kind: 'polity', id: 'c-sup' as PolityId }, joinedWeek: 0, commitment: 50 },
      ],
    }

    const next = runWarCreationSystem(makeCtx(s))

    const war = Object.values(next.state.wars).find((w) => w?.originDiplomaticPlayId === 'dp-a')
    expect(war).toBeDefined()
    expect(war?.attacker.participants).toHaveLength(1)
    expect(next.events.some((e) => e.type === 'WAR_PARTICIPANT_JOINED')).toBe(false)
  })

  it('同 tick に 2 play が escalate しても同一 supporter は先に処理された War のみに入る (§10.3a 逐次要件)', () => {
    // 2 組目の attacker/defender + 移転可能 holding を追加 (rank 2 → rank 3)
    const { world, holdingId, attacker, defender } = setupTransferableHolding()
    let s = world
    const pAtt2 = 'pr-att2' as ProvinceId
    const pDef2 = 'pr-def2' as ProvinceId
    const attacker2 = 'c-att2' as PolityId
    const defender2 = 'c-def2' as PolityId
    s = withProvince(s, pAtt2, { neighbors: [pDef2] })
    s = withProvince(s, pDef2, { neighbors: [pAtt2] })
    s = withHouse(s, 'h-att2' as HouseId, { seatProvinceId: pAtt2, wealth: 200 })
    s = withHouse(s, 'h-def2' as HouseId, { seatProvinceId: pDef2, wealth: 50 })
    s = withPolity(s, attacker2, { rank: 2, treasury: 2000, capitalProvinceId: pAtt2 })
    s = withPolity(s, defender2, { rank: 3, treasury: 500, capitalProvinceId: pDef2 })
    s = bindProvinceToHouseViaPolity(s, pAtt2, attacker2, 'h-att2' as HouseId)
    s = bindProvinceToHouseViaPolity(s, pDef2, defender2, 'h-def2' as HouseId)
    const holdingId2 = s.provinces[pDef2]!.holdingIds[0]!
    s = withPolity(s, 'c-sup' as PolityId, { rank: 2, treasury: 100 })

    injectEscalatedLandClaim(s, 'dp-a', attacker, defender, holdingId)
    injectEscalatedLandClaim(s, 'dp-b', attacker2, defender2, holdingId2)
    const supporter = {
      actor: { kind: 'polity' as const, id: 'c-sup' as PolityId },
      joinedWeek: 0,
      commitment: 50,
    }
    s.diplomaticPlays['dp-a' as DiplomaticPlayId] = {
      ...s.diplomaticPlays['dp-a' as DiplomaticPlayId]!,
      initiatorSupporters: [supporter],
    }
    s.diplomaticPlays['dp-b' as DiplomaticPlayId] = {
      ...s.diplomaticPlays['dp-b' as DiplomaticPlayId]!,
      initiatorSupporters: [supporter],
    }

    const next = runWarCreationSystem(makeCtx(s))

    const warA = Object.values(next.state.wars).find((w) => w?.originDiplomaticPlayId === 'dp-a')
    const warB = Object.values(next.state.wars).find((w) => w?.originDiplomaticPlayId === 'dp-b')
    expect(warA).toBeDefined()
    expect(warB).toBeDefined()
    // 列挙は play id 昇順 → dp-a が先に処理され supporter を獲得、dp-b では他 War 参加中で落ちる
    expect(warA?.attacker.participants).toHaveLength(2)
    expect(warB?.attacker.participants).toHaveLength(1)
    expect(next.state.warIndex.byParticipant['polity:c-sup']).toEqual([warA!.id])
  })

  it('変換不能 (holding 消失) な escalated land_claim は cancelled・War 生成なし', () => {
    const world = freshWorld()
    const { owner, other } = pickHoldingAndPolities(world)
    injectEscalatedLandClaim(world, 'dp-x', other, owner, 'hl-999999' as HoldingId)
    const before = Object.keys(world.wars).length

    const next = runWarCreationSystem(makeCtx(world))

    expect(Object.keys(next.state.wars).length).toBe(before)
    expect(next.state.diplomaticPlays['dp-x' as DiplomaticPlayId]?.status).toBe('cancelled')
  })
})

// v0.35: WarProgressSystem (§7) は WarManeuverSystem に置換。lastWarWeek 更新 / dead-participant guard の
//   等価カバレッジは warManeuverSystem.test.ts に移管した (per-tick drift 撤廃で warScore の符号確定テストは廃止)。

describe('cancelOrphanedWarsSystem (§7.9)', () => {
  it('participant が inactive 化した active War を cancelled + endedWeek + WAR_ENDED', () => {
    const world = freshWorld()
    const { holdingId, owner, other } = pickHoldingAndPolities(world)
    const war = createWar(world, {
      attacker: { kind: 'polity', id: other },
      defender: { kind: 'polity', id: owner },
      warGoals: [
        {
          kind: 'transfer_land_contract',
          holdingId,
          fromPolityId: owner,
          toPolityId: other,
          requiredWarScore: 60,
        },
      ],
      targetWarScore: 60,
      startedWeek: world.absoluteWeek,
    })
    const d = world.polities[owner]!
    world.polities[owner] = { ...d, active: false }

    const next = runCancelOrphanedWarsSystem(makeCtx(world))
    const w = next.state.wars[war.id]
    expect(w?.status).toBe('cancelled')
    expect(w?.endedWeek).toBe(world.absoluteWeek)
    expect(next.events.some((e) => e.type === 'WAR_ENDED')).toBe(true)
  })
})

describe('PeaceSettlementSystem (§8) — decisive paths', () => {
  it('attacker_won: transfer goal が holding を実際に移転する', () => {
    const { world, holdingId, attacker, defender } = setupTransferableHolding()
    const war = createWar(world, {
      attacker: { kind: 'polity', id: attacker },
      defender: { kind: 'polity', id: defender },
      warGoals: [
        {
          kind: 'transfer_land_contract',
          holdingId,
          fromPolityId: defender,
          toPolityId: attacker,
          requiredWarScore: 60,
        },
      ],
      targetWarScore: 60,
      startedWeek: world.absoluteWeek,
    })
    // warScore を target まで進めて attacker 勝利を発火。
    world.wars[war.id] = { ...world.wars[war.id]!, warScore: 60 }
    expect(getHoldingTerminalPolityId(world, holdingId)).toBe(defender)

    const next = runPeaceSettlementSystem(makeCtx(world))
    expect(next.state.wars[war.id]?.status).toBe('attacker_won')
    expect(getHoldingTerminalPolityId(next.state, holdingId)).toBe(attacker)
    expect(next.events.some((e) => e.type === 'WAR_WON')).toBe(true)
    expect(next.events.some((e) => e.type === 'WAR_LOST')).toBe(true)
  })

  it('attacker_won: tax goal が landContract の税率を実際に変更する', () => {
    const world = freshWorld()
    // holdingId を持つ非 root の landContract を 1 件選ぶ (root は adjustLandContractTaxRate が no-op)。
    const contract = Object.values(world.landContracts).find(
      (c) => c && c.holdingId !== undefined && c.parentContractId !== undefined,
    )
    expect(contract).toBeDefined()
    const holdingId = contract!.holdingId!
    const grantee = contract!.granteePolityId
    const attacker = Object.values(world.polities).find(
      (p) => p && p.active && (p.id as string) !== (grantee as string),
    )!.id
    const war = createWar(world, {
      attacker: { kind: 'polity', id: attacker },
      defender: { kind: 'polity', id: grantee },
      warGoals: [
        {
          kind: 'change_contract_tax_rate',
          holdingId,
          landContractId: contract!.id,
          baseTaxRateToGrantor: 0.2,
          newTaxRateToGrantor: 0.3,
          requiredWarScore: 50,
        },
      ],
      targetWarScore: 50,
      startedWeek: world.absoluteWeek,
    })
    world.wars[war.id] = { ...world.wars[war.id]!, warScore: 50 }

    const next = runPeaceSettlementSystem(makeCtx(world))
    expect(next.state.wars[war.id]?.status).toBe('attacker_won')
    expect(next.state.landContracts[contract!.id]?.terms.taxRateToGrantor).toBe(0.3)
    expect(next.events.some((e) => e.type === 'PEACE_SETTLEMENT_APPLIED')).toBe(true)
  })

  it('stale な transfer goal (fromPolity が現 grantee でない) は white_peace に落ち land は不変', () => {
    const world = freshWorld()
    const { holdingId, owner, other } = pickHoldingAndPolities(world)
    // fromPolityId に owner でない polity (other) を指定 → chain に該当 contract 無し → stale。
    const stranger = Object.values(world.polities).find(
      (p) =>
        p &&
        p.active &&
        (p.id as string) !== (owner as string) &&
        (p.id as string) !== (other as string),
    )?.id
    const fromStale = stranger ?? other
    const war = createWar(world, {
      attacker: { kind: 'polity', id: other },
      defender: { kind: 'polity', id: owner },
      warGoals: [
        {
          kind: 'transfer_land_contract',
          holdingId,
          fromPolityId: fromStale,
          toPolityId: other,
          requiredWarScore: 60,
        },
      ],
      targetWarScore: 60,
      startedWeek: world.absoluteWeek,
    })
    world.wars[war.id] = { ...world.wars[war.id]!, warScore: 60 }

    const next = runPeaceSettlementSystem(makeCtx(world))
    expect(next.state.wars[war.id]?.status).toBe('white_peace')
    // 移転していない。
    expect(getHoldingTerminalPolityId(next.state, holdingId)).toBe(owner)
    expect(next.events.some((e) => e.type === 'WAR_ENDED')).toBe(true)
  })

  it('timeout (maxWarDurationWeeks 超過) で拮抗 War が white_peace 終結する', () => {
    const world = freshWorld()
    const { holdingId, owner, other } = pickHoldingAndPolities(world)
    const war = createWar(world, {
      attacker: { kind: 'polity', id: other },
      defender: { kind: 'polity', id: owner },
      warGoals: [
        {
          kind: 'transfer_land_contract',
          holdingId,
          fromPolityId: owner,
          toPolityId: other,
          requiredWarScore: 60,
        },
      ],
      targetWarScore: 60,
      // 拮抗 (warScore 0) のまま maxWarDurationWeeks 経過させる。
      startedWeek: world.absoluteWeek - defaultConfig.maxWarDurationWeeks,
    })

    const next = runPeaceSettlementSystem(makeCtx(world))
    expect(next.state.wars[war.id]?.status).toBe('white_peace')
    expect(next.state.wars[war.id]?.endedWeek).toBe(world.absoluteWeek)
  })
})

describe('cleanupWarSystem (§9)', () => {
  it('retention 超過の terminal War を records / warIndex から削除する', () => {
    const world = freshWorld()
    const { holdingId, owner, other } = pickHoldingAndPolities(world)
    const war = createWar(world, {
      attacker: { kind: 'polity', id: other },
      defender: { kind: 'polity', id: owner },
      warGoals: [
        {
          kind: 'transfer_land_contract',
          holdingId,
          fromPolityId: owner,
          toPolityId: other,
          requiredWarScore: 60,
        },
      ],
      targetWarScore: 60,
      startedWeek: world.absoluteWeek - 600,
    })
    world.wars[war.id] = {
      ...world.wars[war.id]!,
      status: 'white_peace',
      endedWeek: world.absoluteWeek - defaultConfig.terminalWarRetentionWeeks,
    }
    expect(world.warIndex.byParticipant[`polity:${other as string}`]).toContain(war.id)

    const next = runCleanupWarSystem(makeCtx(world))
    expect(next.state.wars[war.id]).toBeUndefined()
    expect(next.state.warIndex.byParticipant[`polity:${other as string}`]).toBeUndefined()
  })

  it('retention 未満の terminal War は残す', () => {
    const world = freshWorld()
    const { holdingId, owner, other } = pickHoldingAndPolities(world)
    const war = createWar(world, {
      attacker: { kind: 'polity', id: other },
      defender: { kind: 'polity', id: owner },
      warGoals: [
        {
          kind: 'transfer_land_contract',
          holdingId,
          fromPolityId: owner,
          toPolityId: other,
          requiredWarScore: 60,
        },
      ],
      targetWarScore: 60,
      startedWeek: world.absoluteWeek - 10,
    })
    world.wars[war.id] = {
      ...world.wars[war.id]!,
      status: 'white_peace',
      endedWeek: world.absoluteWeek - 1,
    }

    const next = runCleanupWarSystem(makeCtx(world))
    expect(next.state.wars[war.id]).toBeDefined()
  })
})
