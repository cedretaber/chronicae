import { describe, it, expect } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { collectIntegrityErrors } from './integritySystem'
import { createWar } from '../mutations/warMutations'
import type { WorldState } from '../types/world'
import type { War, WarGoal } from '../types/war'
import type {
  PolityId,
  HouseId,
  HoldingId,
  LandContractId,
  PersonId,
  WarId,
  DiplomaticPlayId,
} from '../types/ids'

// §14 (v0.34) War 整合性検査の本体テスト。
//   War は CLI ゲートでは 0 件 (vacuous pass) なので、各 §14 分岐は手組み war fixture でのみ検証できる。
//   実 generated world に valid war を 1 件注入し、正常 war は §14 エラー 0 / 各破壊で対応エラーを検出する。

function warErrors(state: WorldState): string[] {
  return collectIntegrityErrors(state)
    .filter((e) => e.message.includes('§14'))
    .map((e) => e.message)
}

// 実世界 (polity / holding / landContract が揃う) に valid な transfer-goal war を 1 件作って返す。
function freshValidWar(): { world: WorldState; war: War; polA: PolityId; polB: PolityId } {
  const { world } = generateWorld('war-integrity')
  const activePolities = Object.values(world.polities).filter((p) => p && p.active)
  expect(activePolities.length).toBeGreaterThanOrEqual(2)
  const polA = activePolities[0]!.id
  const polB = activePolities[1]!.id
  const holdingIds = Object.keys(world.holdings) as HoldingId[]
  expect(holdingIds.length).toBeGreaterThanOrEqual(1)
  const holdingId = holdingIds[0]!
  const goal: WarGoal = {
    kind: 'transfer_land_contract',
    holdingId,
    fromPolityId: polB,
    toPolityId: polA,
    requiredWarScore: 60,
  }
  const war = createWar(world, {
    attacker: { kind: 'polity', id: polA },
    defender: { kind: 'polity', id: polB },
    warGoals: [goal],
    targetWarScore: 60,
    startedWeek: world.absoluteWeek,
  })
  return { world, war, polA, polB }
}

// valid な tax-revision-goal war (transfer とは別の §14.5 分岐を踏む)。
function freshValidTaxWar(): { world: WorldState; war: War } {
  const { world } = generateWorld('war-integrity')
  const polities = Object.values(world.polities).filter((p) => p && p.active)
  const contract = Object.values(world.landContracts).find((c) => c && c.holdingId !== undefined)
  expect(contract).toBeDefined()
  const goal: WarGoal = {
    kind: 'change_contract_tax_rate',
    holdingId: contract!.holdingId!,
    landContractId: contract!.id,
    baseTaxRateToGrantor: 0.2,
    newTaxRateToGrantor: 0.3,
    requiredWarScore: 50,
  }
  const war = createWar(world, {
    attacker: { kind: 'polity', id: polities[0]!.id },
    defender: { kind: 'polity', id: polities[1]!.id },
    warGoals: [goal],
    targetWarScore: 50,
    startedWeek: world.absoluteWeek,
  })
  return { world, war }
}

describe('War integrity (§14)', () => {
  it('a valid active war produces no §14 errors', () => {
    const { world } = freshValidWar()
    expect(warErrors(world)).toEqual([])
  })

  it('a valid tax-revision war (using a real landContract) produces no §14 errors', () => {
    const { world } = generateWorld('war-integrity')
    const polities = Object.values(world.polities).filter((p) => p && p.active)
    const contract = Object.values(world.landContracts).find((c) => c && c.holdingId !== undefined)
    expect(contract).toBeDefined()
    const goal: WarGoal = {
      kind: 'change_contract_tax_rate',
      holdingId: contract!.holdingId!,
      landContractId: contract!.id,
      baseTaxRateToGrantor: 0.2,
      newTaxRateToGrantor: 0.3,
      requiredWarScore: 50,
    }
    createWar(world, {
      attacker: { kind: 'polity', id: polities[0]!.id },
      defender: { kind: 'polity', id: polities[1]!.id },
      warGoals: [goal],
      targetWarScore: 50,
      startedWeek: world.absoluteWeek,
    })
    expect(warErrors(world)).toEqual([])
  })

  // §14.2 基本検査
  it('detects invalid status', () => {
    const { world, war } = freshValidWar()
    war.status = 'frobnicate' as War['status']
    expect(warErrors(world).some((m) => m.includes('invalid status'))).toBe(true)
  })

  it('detects warScore out of range', () => {
    const { world, war } = freshValidWar()
    war.warScore = 150
    expect(warErrors(world).some((m) => m.includes('out of range -100..100'))).toBe(true)
  })

  it('detects targetWarScore <= 0', () => {
    const { world, war } = freshValidWar()
    war.targetWarScore = 0
    expect(warErrors(world).some((m) => m.includes('targetWarScore'))).toBe(true)
  })

  // §14.3 active / terminal 整合
  it('detects active war that has endedWeek set', () => {
    const { world, war } = freshValidWar()
    war.endedWeek = 100
    expect(warErrors(world).some((m) => m.includes('active but endedWeek'))).toBe(true)
  })

  it('detects terminal war missing endedWeek', () => {
    const { world, war } = freshValidWar()
    war.status = 'white_peace'
    // endedWeek は createWar 時から未設定 (undefined)。terminal なのに未設定 = §14.3 違反。
    delete war.endedWeek
    expect(warErrors(world).some((m) => m.includes('terminal'))).toBe(true)
  })

  // §14.4 participant 検査
  it('detects participants.length < 1 (v0.43: 1 件固定から >= 1 に緩和)', () => {
    const { world, war } = freshValidWar()
    war.attacker.participants = []
    expect(warErrors(world).some((m) => m.includes('participants.length'))).toBe(true)
  })

  // v0.43: supporter (primary=false の 2 件目以降) は violation ではない
  it('does NOT flag a side with a supporter participant (v0.43 multi-participant)', () => {
    const { world } = generateWorld('war-integrity')
    const activePolities = Object.values(world.polities).filter((p) => p && p.active)
    expect(activePolities.length).toBeGreaterThanOrEqual(3)
    const [polA, polB, polC] = activePolities.map((p) => p.id)
    const holdingId = (Object.keys(world.holdings) as HoldingId[])[0]!
    createWar(world, {
      attacker: { kind: 'polity', id: polA! },
      defender: { kind: 'polity', id: polB! },
      warGoals: [
        {
          kind: 'transfer_land_contract',
          holdingId,
          fromPolityId: polB!,
          toPolityId: polA!,
          requiredWarScore: 60,
        },
      ],
      targetWarScore: 60,
      startedWeek: world.absoluteWeek,
      attackerSupporters: [{ actor: { kind: 'polity', id: polC! } }],
    })
    expect(warErrors(world)).toEqual([])
  })

  // v0.43 W3: participant は polity のみ
  it('detects a non-polity participant (W3)', () => {
    const { world, war } = freshValidWar()
    war.attacker.participants = [
      ...war.attacker.participants,
      {
        actor: { kind: 'house', id: 'h-1' as HouseId },
        joinedWeek: world.absoluteWeek,
        primary: false,
      },
    ]
    expect(warErrors(world).some((m) => m.includes('is not a polity'))).toBe(true)
  })

  // v0.43 W4: 同一 side 内の actor 重複
  it('detects duplicate participant actors within a side (W4)', () => {
    const { world, war, polA } = freshValidWar()
    war.attacker.participants = [
      ...war.attacker.participants,
      { actor: { kind: 'polity', id: polA }, joinedWeek: world.absoluteWeek, primary: false },
    ]
    expect(warErrors(world).some((m) => m.includes('duplicate participant actors'))).toBe(true)
  })

  // v0.43 W5: 両 side をまたいだ actor 重複
  it('detects the same actor on both sides (W5)', () => {
    const { world, war, polA } = freshValidWar()
    war.defender.participants = [
      ...war.defender.participants,
      { actor: { kind: 'polity', id: polA }, joinedWeek: world.absoluteWeek, primary: false },
    ]
    expect(warErrors(world).some((m) => m.includes('appears on both sides'))).toBe(true)
  })

  it('detects inactive participant actor on an active war', () => {
    const { world, war, polB } = freshValidWar()
    world.polities[polB]!.active = false
    expect(warErrors(world).some((m) => m.includes('is not active'))).toBe(true)
    void war
  })

  // §14.5 WarGoal 検査
  it('detects transfer goal with fromPolityId === toPolityId', () => {
    const { world, war } = freshValidWar()
    const g = war.warGoals[0]
    if (g?.kind === 'transfer_land_contract') g.toPolityId = g.fromPolityId
    expect(warErrors(world).some((m) => m.includes('fromPolityId === toPolityId'))).toBe(true)
  })

  it('detects transfer goal referencing a missing holding', () => {
    const { world, war } = freshValidWar()
    const g = war.warGoals[0]
    if (g?.kind === 'transfer_land_contract') g.holdingId = 'hl-999999' as HoldingId
    expect(warErrors(world).some((m) => m.includes('missing holding'))).toBe(true)
  })

  it('detects transfer goal with requiredWarScore <= 0', () => {
    const { world, war } = freshValidWar()
    const g = war.warGoals[0]
    if (g) g.requiredWarScore = 0
    expect(warErrors(world).some((m) => m.includes('requiredWarScore'))).toBe(true)
  })

  // §14.7 warIndex 双方向
  it('detects byParticipant entry referencing a missing war (forward)', () => {
    const { world } = freshValidWar()
    world.warIndex.byParticipant['polity:ghost'] = ['w-999999' as WarId]
    expect(warErrors(world).some((m) => m.includes('references missing War'))).toBe(true)
  })

  it('detects active war participant missing from byParticipant (reverse)', () => {
    const { world, polB } = freshValidWar()
    delete world.warIndex.byParticipant[`polity:${polB as string}`]
    expect(warErrors(world).some((m) => m.includes('not in warIndex.byParticipant'))).toBe(true)
  })

  // §14.5 tax goal の error 経路 (transfer とは構造が別: landContractId / optional holdingId を参照)
  it('detects tax goal referencing a missing landContract', () => {
    const { world, war } = freshValidTaxWar()
    const g = war.warGoals[0]
    if (g?.kind === 'change_contract_tax_rate') g.landContractId = 'lc-999999' as LandContractId
    expect(warErrors(world).some((m) => m.includes('missing landContract'))).toBe(true)
  })

  // §14.5: 参照存在は active War のみ要求する。terminal War の WarGoal は凍結履歴データであり、
  //   retention 中に別システムが landContract を消すのを許容する (今回の CI 違反の回帰テスト)。
  it('does NOT flag a terminal war whose landContract was later deleted (frozen history)', () => {
    const { world, war } = freshValidTaxWar()
    const g = war.warGoals[0]
    // war を terminal 化し、参照先 landContract が別システムで消えた状況を作る。
    war.status = 'defender_won'
    war.endedWeek = world.absoluteWeek
    if (g?.kind === 'change_contract_tax_rate') delete world.landContracts[g.landContractId]
    expect(warErrors(world).some((m) => m.includes('missing landContract'))).toBe(false)
  })

  it('detects tax goal whose landContract.holdingId does not match goal.holdingId', () => {
    const { world, war } = freshValidTaxWar()
    const g = war.warGoals[0]
    if (g?.kind === 'change_contract_tax_rate') g.holdingId = 'hl-999999' as HoldingId
    expect(warErrors(world).some((m) => m.includes('!== goal.holdingId'))).toBe(true)
  })

  it('detects tax goal with newTaxRateToGrantor out of 0..1', () => {
    const { world, war } = freshValidTaxWar()
    const g = war.warGoals[0]
    if (g?.kind === 'change_contract_tax_rate') g.newTaxRateToGrantor = 1.5
    expect(warErrors(world).some((m) => m.includes('out of range 0..1'))).toBe(true)
  })

  it('detects byOriginDiplomaticPlay entry referencing a missing war (forward)', () => {
    const { world } = freshValidWar()
    world.warIndex.byOriginDiplomaticPlay['dp-stale' as DiplomaticPlayId] = 'w-999999' as WarId
    expect(
      warErrors(world).some(
        (m) => m.includes('byOriginDiplomaticPlay') && m.includes('references missing War'),
      ),
    ).toBe(true)
  })
})

// v0.35 (§14.7) WarSide 作戦状態の不変条件。active War のみ検査・soft reference は不問。
describe('War integrity v0.35 (§14.7)', () => {
  it('a valid active war has no §14.7 errors (avoidanceCount=0, no commanders)', () => {
    const { world } = freshValidWar()
    expect(warErrors(world).filter((m) => m.includes('§14.7'))).toEqual([])
  })

  it('detects negative avoidanceCount on an active war', () => {
    const { world, war } = freshValidWar()
    war.attacker.avoidanceCount = -1
    expect(warErrors(world).some((m) => m.includes('avoidanceCount') && m.includes('§14.7'))).toBe(
      true,
    )
  })

  it('detects non-finite avoidanceCount on an active war', () => {
    const { world, war } = freshValidWar()
    war.defender.avoidanceCount = NaN
    expect(warErrors(world).some((m) => m.includes('avoidanceCount') && m.includes('§14.7'))).toBe(
      true,
    )
  })

  it('detects duplicate commanderPersonIds on an active war', () => {
    const { world, war } = freshValidWar()
    war.attacker.commanderPersonIds = ['pe-x' as PersonId, 'pe-x' as PersonId]
    expect(
      warErrors(world).some((m) => m.includes('commanderPersonIds') && m.includes('§14.7')),
    ).toBe(true)
  })

  it('does NOT check §14.7 on a terminal war (soft reference may age during retention)', () => {
    const { world, war } = freshValidWar()
    war.status = 'attacker_won'
    war.endedWeek = world.absoluteWeek
    war.attacker.avoidanceCount = -1
    war.attacker.commanderPersonIds = ['pe-y' as PersonId, 'pe-y' as PersonId]
    expect(warErrors(world).filter((m) => m.includes('§14.7'))).toEqual([])
  })
})
