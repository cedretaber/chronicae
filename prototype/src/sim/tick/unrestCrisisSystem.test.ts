import { describe, it, expect } from 'vitest'
import { runUnrestCrisisSystem } from './unrestCrisisSystem'
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
import { createCrisisMut, setCrisisStatusMut } from '../mutations/crisisMutations'
import type { WorldState } from '../types/world'
import type { RevoltDemand } from '../types/crisis'
import type { HoldingId, PolityId, HouseId, PersonId, ProvinceId, PopGroupId } from '../types/ids'

const PROVINCE = 'pr-1' as ProvinceId
const POLITY = 'c-1' as PolityId
const HOUSE = 'h-1' as HouseId
const HOLDING = 'hl-0' as HoldingId
const POP = 'pg-1' as PopGroupId

function buildWorld(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, PROVINCE)
  s = withPolity(s, POLITY, { treasury: 500, capitalProvinceId: PROVINCE })
  s = withHouse(s, HOUSE, { seatProvinceId: PROVINCE })
  s = withPerson(s, 'p-leader' as PersonId, { houseId: HOUSE })
  s = bindProvinceToHouseViaPolity(s, PROVINCE, POLITY, HOUSE)
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
        wealth: 30,
        unrest: 80,
        attitudes: {},
      },
    },
    popIndex: { byHolding: { ...s.popIndex.byHolding, [HOLDING]: [POP] } },
  }
  return { ...s, currentYear: 10, currentWeekOfYear: 5, absoluteWeek: 10 * 48 + 5 }
}

function makeCtx(state: WorldState) {
  return createTickContext({ state, rng: createRng('unrest'), config: defaultConfig })
}

function addResolvedUnrest(s: WorldState, demand: RevoltDemand) {
  const crisis = createCrisisMut(s, {
    kind: 'unrest',
    holdingId: HOLDING,
    severity: 0,
    createdWeek: 0,
    deadlineWeek: 100,
    status: 'active',
    reasonIds: [],
    demand,
  })
  setCrisisStatusMut(s, crisis.id, 'resolved')
  return crisis
}

describe('unrestCrisisSystem (Phase C)', () => {
  it('resolved unrest (tax_relief) → 減税の譲歩を適用 (REVOLT_SETTLED) し Crisis を purge する', () => {
    // NOTE: fixture の terminal contract は root (parent なし) のため adjustLandContractTaxRate は
    //   no-op。減税の数値は既存 applier 由来で不変なので、ここでは concession 経路が走ったこと
    //   (REVOLT_SETTLED emit + unrest 低下 + purge) を検証する。
    const s = buildWorld()
    const beforeUnrest = s.popGroups[POP]!.unrest
    const crisis = addResolvedUnrest(s, { kind: 'tax_relief', claimantPopClass: 'lower' })

    const next = runUnrestCrisisSystem(makeCtx(s))

    expect(next.state.crises[crisis.id]).toBeUndefined() // purged
    expect(next.state.popGroups[POP]!.unrest).toBeLessThan(beforeUnrest) // 沈静化
    expect(next.events.some((e) => e.type === 'REVOLT_SETTLED')).toBe(true)
  })

  it('resolved unrest (secession) → 鎮圧 (lastRevoltSuppressedWeek) し Crisis を purge する', () => {
    const s = buildWorld()
    const crisis = addResolvedUnrest(s, { kind: 'secession', claimantPopClass: 'lower' })

    const next = runUnrestCrisisSystem(makeCtx(s))

    expect(next.state.crises[crisis.id]).toBeUndefined()
    expect(next.state.holdings[HOLDING]!.lastRevoltSuppressedWeek).toBe(s.absoluteWeek)
    expect(next.events.some((e) => e.type === 'CRISIS_RESOLVED')).toBe(true)
  })

  it('expired unrest → commonwealth + revolt_negotiation play を生成し武装蜂起・Crisis を purge する', () => {
    const s = buildWorld()
    const crisis = createCrisisMut(s, {
      kind: 'unrest',
      holdingId: HOLDING,
      severity: 40,
      createdWeek: 0,
      deadlineWeek: 100,
      status: 'active',
      reasonIds: [],
      demand: { kind: 'secession', claimantPopClass: 'lower' },
    })
    setCrisisStatusMut(s, crisis.id, 'expired')

    const next = runUnrestCrisisSystem(makeCtx(s))

    expect(next.state.crises[crisis.id]).toBeUndefined() // purged
    // commonwealth + play が生成される (案 A の vestigial play → war 配管)
    const plays = Object.values(next.state.diplomaticPlays)
    expect(plays.some((p) => p?.kind === 'revolt_negotiation')).toBe(true)
    expect(next.events.some((e) => e.type === 'REVOLT_NEGOTIATION_STARTED')).toBe(true)
  })
})
