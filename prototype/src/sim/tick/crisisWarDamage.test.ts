import { describe, it, expect } from 'vitest'
import { spawnWarDamageCrisis } from './crisisSystem'
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
  ProvinceId,
  WarId,
  HoldingImprovementId,
} from '../types/ids'

const PROVINCE = 'pr-1' as ProvinceId
const POLITY = 'c-1' as PolityId
const HOUSE = 'h-1' as HouseId
const HOLDING = 'hl-0' as HoldingId
const WAR = 'w-1' as WarId

function buildWorld(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, PROVINCE)
  s = withPolity(s, POLITY, { treasury: 1000, capitalProvinceId: PROVINCE })
  s = withHouse(s, HOUSE, { seatProvinceId: PROVINCE })
  s = withPerson(s, 'p-leader' as import('../types/ids').PersonId, { houseId: HOUSE })
  s = bindProvinceToHouseViaPolity(s, PROVINCE, POLITY, HOUSE)
  return { ...s, currentYear: 5, currentWeekOfYear: 10, absoluteWeek: 5 * 48 + 10 }
}

function makeCtx(state: WorldState) {
  return createTickContext({ state, rng: createRng('war-damage'), config: defaultConfig })
}

describe('spawnWarDamageCrisis (Phase B)', () => {
  it('終戦の領地移転後に war_damage Crisis を新支配 polity owner で生成する', () => {
    const next = spawnWarDamageCrisis(makeCtx(buildWorld()), HOLDING, POLITY, WAR)
    const crises = Object.values(next.state.crises)
    expect(crises.length).toBe(1)
    expect(crises[0]!.kind).toBe('war_damage')
    expect(crises[0]!.holdingId).toBe(HOLDING)
    expect(crises[0]!.sourceWarId).toBe(WAR)
    expect(crises[0]!.status).toBe('active')
    // CRISIS_CREATED が emit される
    expect(next.events.some((e) => e.type === 'CRISIS_CREATED')).toBe(true)
  })

  it('同 holding に active war_damage があれば dedup する', () => {
    const once = spawnWarDamageCrisis(makeCtx(buildWorld()), HOLDING, POLITY, WAR)
    const twice = spawnWarDamageCrisis({ ...once }, HOLDING, POLITY, WAR)
    expect(Object.values(twice.state.crises).length).toBe(1)
  })

  it('owner polity が inactive なら生成しない', () => {
    let s = buildWorld()
    s = { ...s, polities: { ...s.polities, [POLITY]: { ...s.polities[POLITY]!, active: false } } }
    const next = spawnWarDamageCrisis(makeCtx(s), HOLDING, POLITY, WAR)
    expect(Object.values(next.state.crises).length).toBe(0)
  })

  it('案 B: 再戦災で新規 Crisis を作らず deadline をリセット + 設備を再損傷する', () => {
    const IMP = 'hi-0' as HoldingImprovementId
    let s = buildWorld()
    s = {
      ...s,
      holdingImprovements: {
        ...s.holdingImprovements,
        [IMP]: {
          id: IMP,
          holdingId: HOLDING,
          kind: 'irrigation_infrastructure',
          level: 1,
          condition: 100,
          createdWeek: 0,
        },
      },
      holdingImprovementIndex: {
        byHolding: { ...s.holdingImprovementIndex.byHolding, [HOLDING as string]: [IMP] },
      },
    }
    const drop = defaultConfig.warDamageConditionDrop

    const once = spawnWarDamageCrisis(makeCtx(s), HOLDING, POLITY, WAR)
    const c1 = Object.values(once.state.crises)[0]!
    expect(once.state.holdingImprovements[IMP]!.condition).toBe(100 - drop)
    const firstDeadline = c1.deadlineWeek

    // 時間を進めて再戦災
    const advanced = {
      ...once,
      state: { ...once.state, absoluteWeek: once.state.absoluteWeek + 10 },
    }
    const twice = spawnWarDamageCrisis(advanced, HOLDING, POLITY, WAR)

    // 新規 Crisis は作られない (count 不変)
    expect(Object.values(twice.state.crises).length).toBe(1)
    const c2 = twice.state.crises[c1.id]!
    // deadline がリセット (延長) される
    expect(c2.deadlineWeek).toBe(
      advanced.state.absoluteWeek + defaultConfig.crisisDeadlineWeeksByKind.war_damage,
    )
    expect(c2.deadlineWeek).toBeGreaterThan(firstDeadline)
    // 設備が再度損傷する (2 回分の drop)
    expect(twice.state.holdingImprovements[IMP]!.condition).toBe(100 - 2 * drop)
  })
})
