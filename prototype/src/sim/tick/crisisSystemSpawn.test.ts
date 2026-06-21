import { describe, it, expect } from 'vitest'
import { runCrisisSystem } from './crisisSystem'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  withPerson,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext } from './context'
import type { WorldState } from '../types/world'
import type {
  HoldingId,
  PolityId,
  HouseId,
  PersonId,
  PopGroupId,
  ProvinceId,
  HoldingOfficeAssignmentId,
  OfficeAssignmentId,
  HoldingImprovementId,
} from '../types/ids'

const PROVINCE = 'pr-1' as ProvinceId
const POLITY = 'c-1' as PolityId
const HOUSE = 'h-1' as HouseId
const LEADER = 'p-leader' as PersonId
const HOLDING = 'hl-0' as HoldingId // withProvince が最初に作る holding
const POP = 'pg-1' as PopGroupId

// famine を必ず当て、pressure 連動を消した config
const FORCE_FAMINE = {
  famineBaseChancePerYear: 1,
  plagueBaseChancePerYear: 0,
  droughtBaseChancePerYear: 0,
  bountifulHarvestBaseChancePerYear: 0,
  populationPressureThreshold: 999999,
  crisisSeverityPressureBonus: 0,
}

// LEADER を POLITY の leader office に就ける (getPolityLeader が返すように)。
function withPolityLeaderOffice(s: WorldState): WorldState {
  const officeId = 'oa-leader' as OfficeAssignmentId
  const orgKey = 'polity:' + POLITY
  return {
    ...s,
    officeAssignments: {
      ...s.officeAssignments,
      [officeId]: {
        id: officeId,
        organization: { kind: 'polity', id: POLITY },
        role: 'leader',
        holderPersonId: LEADER,
        active: true,
        startYear: 1,
        slotIndex: 0,
        unpaidCount: 0,
      },
    },
    officeIndex: {
      byOrganization: {
        ...s.officeIndex.byOrganization,
        [orgKey]: [...(s.officeIndex.byOrganization[orgKey] ?? []), officeId],
      },
      byHolderPerson: {
        ...s.officeIndex.byHolderPerson,
        [LEADER as string]: [...(s.officeIndex.byHolderPerson[LEADER as string] ?? []), officeId],
      },
    },
    nextOfficeAssignmentId: s.nextOfficeAssignmentId + 1,
  }
}

function buildWorld(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, PROVINCE)
  s = withPolity(s, POLITY, { treasury: 1000, capitalProvinceId: PROVINCE })
  s = withHouse(s, HOUSE, { seatProvinceId: PROVINCE })
  s = withPerson(s, LEADER, { houseId: HOUSE })
  s = bindProvinceToHouseViaPolity(s, PROVINCE, POLITY, HOUSE)
  s = withPolityLeaderOffice(s)
  // peasants/agriculture POP を hl-0 に
  s = {
    ...s,
    popGroups: {
      ...s.popGroups,
      [POP]: {
        id: POP,
        holdingId: HOLDING,
        class: 'lower',
        popType: 'peasants',
        employed: true,
        size: 1000,
        wealth: 50,
        unrest: 10,
        attitudes: {},
      },
    },
    popIndex: { byHolding: { ...s.popIndex.byHolding, [HOLDING]: [POP] } },
  }
  // 年初週 (48 % 48 === 0)
  s = { ...s, currentYear: 1, currentWeekOfYear: 0, absoluteWeek: 48 }
  return s
}

function makeCtx(state: WorldState) {
  return createTickContext({
    state,
    rng: createRng('crisis-spawn'),
    config: { ...defaultConfig, ...FORCE_FAMINE },
  })
}

describe('runCrisisSystem spawn (A5)', () => {
  it('該当 holding に famine Crisis を生成し、代官不在でも owner polity の指導者が担当者になる', () => {
    const ctx = makeCtx(buildWorld())
    const next = runCrisisSystem(ctx)
    const crises = Object.values(next.state.crises)
    expect(crises.length).toBe(1)
    expect(crises[0]!.kind).toBe('famine')
    expect(crises[0]!.holdingId).toBe(HOLDING)
    expect(crises[0]!.status).toBe('active')
    expect(next.state.crisisIndex.byHolding[HOLDING]).toHaveLength(1)
    // 代官不在でも Pressure 同様、owner polity の指導者を creator に対処 Project を生成する (§3.2)
    const handleProjects = Object.values(next.state.projects).filter(
      (p) => p && p.kind === 'handle_crisis',
    )
    expect(handleProjects.length).toBe(1)
    expect(handleProjects[0]!.creatorPersonId).toBe(LEADER)
    expect(crises[0]!.responseProjectId).toBe(handleProjects[0]!.id)
  })

  it('代官も指導者もいなければ対処 Project は生成されない (真の放置)', () => {
    let s = buildWorld()
    // leader office を無効化して指導者を消す
    s = {
      ...s,
      officeAssignments: {
        ...s.officeAssignments,
        ['oa-leader' as OfficeAssignmentId]: {
          ...s.officeAssignments['oa-leader' as OfficeAssignmentId]!,
          active: false,
        },
      },
    }
    const next = runCrisisSystem(makeCtx(s))
    expect(Object.values(next.state.crises).length).toBe(1)
    const handleProjects = Object.values(next.state.projects).filter(
      (p) => p && p.kind === 'handle_crisis',
    )
    expect(handleProjects.length).toBe(0)
  })

  it('同 kind active Crisis があれば再 spawn を dedup する', () => {
    const ctx = makeCtx(buildWorld())
    const once = runCrisisSystem(ctx)
    // 同じ年初週でもう一度 (rng は進むが crisis は増えない)
    const twice = runCrisisSystem({ ...once, config: ctx.config })
    expect(Object.values(twice.state.crises).length).toBe(1)
  })

  it('代官がいれば handle_crisis Project を生成し Crisis に紐づける', () => {
    let s = buildWorld()
    // hl-0 に active な bailiff を割り当てる
    const bailiff = 'p-bailiff' as PersonId
    s = withPerson(s, bailiff, { houseId: HOUSE })
    const officeId = 'ho-1' as HoldingOfficeAssignmentId
    s = {
      ...s,
      holdingOfficeAssignments: {
        ...s.holdingOfficeAssignments,
        [officeId]: {
          id: officeId,
          holdingId: HOLDING,
          role: 'bailiff',
          holderPersonId: bailiff,
          appointingPolityId: POLITY,
          active: true,
          startWeek: 0,
          unpaidCount: 0,
          contractedRemittanceRate: 0.5,
          expectedFeeRate: 0.1,
        },
      },
      holdingOfficeIndex: {
        ...s.holdingOfficeIndex,
        byHolding: { ...s.holdingOfficeIndex.byHolding, [HOLDING]: officeId },
      },
    }
    const next = runCrisisSystem(makeCtx(s))
    const handleProjects = Object.values(next.state.projects).filter(
      (p) => p && p.kind === 'handle_crisis',
    )
    expect(handleProjects.length).toBe(1)
    const crisis = Object.values(next.state.crises)[0]!
    expect(crisis.responseProjectId).toBe(handleProjects[0]!.id)
    expect(handleProjects[0]!.supervisorPersonId).toBe(bailiff)
    // targetProgress = 初期 severity
    expect(handleProjects[0]!.targetProgress).toBe(crisis.severity)
  })
})

describe('設備による Crisis 被害軽減 (v0.48.1 §6.6b)', () => {
  const IMP = 'hi-mit' as HoldingImprovementId

  function withImprovement(
    s: WorldState,
    kind: 'storage_infrastructure' | 'irrigation_infrastructure',
    level: number,
    condition = 100,
  ): WorldState {
    return {
      ...s,
      holdingImprovements: {
        ...s.holdingImprovements,
        [IMP]: { id: IMP, holdingId: HOLDING, kind, level, condition, createdWeek: 0 },
      },
      holdingImprovementIndex: {
        byHolding: { ...s.holdingImprovementIndex.byHolding, [HOLDING as string]: [IMP] },
      },
    }
  }

  it('貯蔵設備が飢饉の severity と初期ショックを軽減する', () => {
    // 設備なし: severity = base (pressureBonus=0 のため)
    const baseline = runCrisisSystem(makeCtx(buildWorld()))
    const baseFamine = Object.values(baseline.state.crises).find((c) => c?.kind === 'famine')!
    expect(baseFamine.severity).toBeCloseTo(defaultConfig.crisisInitialSeverityByKind.famine)

    // 貯蔵 Lv2 → factor 1 - 0.25×2 = 0.5
    const next = runCrisisSystem(
      makeCtx(withImprovement(buildWorld(), 'storage_infrastructure', 2)),
    )
    const famine = Object.values(next.state.crises).find((c) => c?.kind === 'famine')!
    expect(famine.severity).toBeCloseTo(defaultConfig.crisisInitialSeverityByKind.famine * 0.5)
    // POP も軽減ショックで減るが全滅しない (size > 0)
    expect(next.state.popGroups[POP]!.size).toBeGreaterThan(0)
  })

  it('灌漑設備が干魃の severity を軽減する', () => {
    const FORCE_DROUGHT = {
      famineBaseChancePerYear: 0,
      plagueBaseChancePerYear: 0,
      droughtBaseChancePerYear: 1,
      bountifulHarvestBaseChancePerYear: 0,
      populationPressureThreshold: 999999,
      crisisSeverityPressureBonus: 0,
    }
    const ctx = (s: WorldState) =>
      createTickContext({
        state: s,
        rng: createRng('drought'),
        config: { ...defaultConfig, ...FORCE_DROUGHT },
      })

    // 灌漑 Lv3 → factor 1 - 0.25×3 = 0.25
    const next = runCrisisSystem(ctx(withImprovement(buildWorld(), 'irrigation_infrastructure', 3)))
    const drought = Object.values(next.state.crises).find((c) => c?.kind === 'drought')!
    expect(drought.severity).toBeCloseTo(defaultConfig.crisisInitialSeverityByKind.drought * 0.25)
  })

  it('登録外の設備種別では軽減されない (灌漑は飢饉に効かない)', () => {
    const next = runCrisisSystem(
      makeCtx(withImprovement(buildWorld(), 'irrigation_infrastructure', 3)),
    )
    const famine = Object.values(next.state.crises).find((c) => c?.kind === 'famine')!
    expect(famine.severity).toBeCloseTo(defaultConfig.crisisInitialSeverityByKind.famine)
  })

  it('機能不全 (condition 0) の貯蔵設備は飢饉を軽減しない (壊れた蔵は守れない)', () => {
    // condition 0 → conditionEffectiveness 0 → 実効レベル 0 → factor 1 (軽減なし)
    const next = runCrisisSystem(
      makeCtx(withImprovement(buildWorld(), 'storage_infrastructure', 2, 0)),
    )
    const famine = Object.values(next.state.crises).find((c) => c?.kind === 'famine')!
    expect(famine.severity).toBeCloseTo(defaultConfig.crisisInitialSeverityByKind.famine)
  })

  it('機能不全閾値未満の貯蔵設備は軽減効果が比例して下がる', () => {
    // condition 25 (閾値 50 の半分) → eff 0.5 → 実効レベル 2×0.5=1 → factor 1-0.25×1=0.75
    const next = runCrisisSystem(
      makeCtx(withImprovement(buildWorld(), 'storage_infrastructure', 2, 25)),
    )
    const famine = Object.values(next.state.crises).find((c) => c?.kind === 'famine')!
    expect(famine.severity).toBeCloseTo(defaultConfig.crisisInitialSeverityByKind.famine * 0.75)
  })
})

// v0.55 §B: 飢饉の人口ショックを「扶養力超過の不足分に比例した急性餓死」に変更した。
//   buildWorld は食料供給なし → carrying capacity = floor 50、POP 1000 → pressure = clamp(20, 0, 2) = 2.0。
//   deficit = pressure − famineOnsetPressure(1.0) = 1.0。
describe('飢饉の急性餓死 (v0.55 §B: deficit 比例)', () => {
  function ctxWith(configOverride: Partial<typeof defaultConfig>) {
    return createTickContext({
      state: buildWorld(),
      rng: createRng('crisis-spawn'),
      config: { ...defaultConfig, ...FORCE_FAMINE, ...configOverride },
    })
  }

  it('pressure 超過時に不足分比例の餓死を適用し、famineMaxMortalityRate で頭打ちになる', () => {
    // deficit 1.0 × perDeficit 0.3 = 0.3 だが max 0.15 で cap → 1000 × (1−0.15) = 850。
    const next = runCrisisSystem(ctxWith({}))
    expect(next.state.popGroups[POP]!.size).toBeCloseTo(
      1000 * (1 - defaultConfig.famineMaxMortalityRate),
    )
  })

  it('cap 未満では perDeficit × deficit に比例した餓死になる', () => {
    // perDeficit 0.05 × deficit 1.0 = 0.05 (< cap 0.15) → 1000 × (1−0.05) = 950。
    const next = runCrisisSystem(ctxWith({ famineMortalityPerDeficit: 0.05 }))
    expect(next.state.popGroups[POP]!.size).toBeCloseTo(950)
  })

  it('pressure が famineOnsetPressure 以下なら餓死は起きない (飢饉 Crisis は発生しても死者ゼロ)', () => {
    // onset を pressure 上限超に設定 → deficit 0 → 餓死なし。Crisis 自体は base=1 で発生する。
    const next = runCrisisSystem(ctxWith({ famineOnsetPressure: 999 }))
    expect(Object.values(next.state.crises).some((c) => c?.kind === 'famine')).toBe(true)
    expect(next.state.popGroups[POP]!.size).toBe(1000)
  })
})
