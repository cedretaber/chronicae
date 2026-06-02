import { describe, it, expect } from 'vitest'
import { runProvinceRevoltSystem } from './provinceRevoltSystem'
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
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { HouseId, PolityId, PersonId, ProvinceId, PopGroupId } from '../types/ids'

function makeCtx(
  state: WorldState,
  seed = 'revolt-test',
  configOverrides: Partial<typeof defaultConfig> = {},
): TickContext {
  return createTickContext({
    state,
    rng: createRng(seed),
    config: { ...defaultConfig, ...configOverrides },
  })
}

function buildWorld(opts: {
  popUnrest: number
  popSize: number
  development: number
  polityControl: number
  treasury: number
}) {
  let s = makeEmptyV016State()
  const provinceId = 'pr-1' as ProvinceId
  const polityId = 'c-1' as PolityId
  const houseId = 'h-1' as HouseId
  const leaderId = 'p-leader' as PersonId
  const popId = 'pg-peasants' as PopGroupId

  s = withProvince(s, provinceId, {})
  s = withPolity(s, polityId, {
    treasury: opts.treasury,
    capitalProvinceId: provinceId,
  })
  s = withHouse(s, houseId, { seatProvinceId: provinceId, wealth: 30 })
  s = withPerson(s, leaderId, { houseId, age: 35 })
  s = bindProvinceToHouseViaPolity(s, provinceId, polityId, houseId)
  const holdingId = 'hl-0' as import('../types/ids').HoldingId
  s = {
    ...s,
    popGroups: {
      ...s.popGroups,
      [popId]: {
        id: popId,
        holdingId,
        class: 'peasants',
        occupation: 'agriculture',
        size: opts.popSize,
        wealth: 10,
        unrest: opts.popUnrest,
        attitudes: {},
      },
    },
    popIndex: {
      byHolding: {
        ...s.popIndex.byHolding,
        [holdingId]: [popId],
      },
    },
  }
  s = { ...s, currentYear: 1000, currentWeekOfYear: 1, absoluteWeek: 1000 * 48 }
  return { state: s, provinceId, polityId, popId }
}

describe('runProvinceRevoltSystem (Stage B)', () => {
  it('skips when month is not January', () => {
    const { state } = buildWorld({
      popUnrest: 95,
      popSize: 1000,
      development: 0,
      polityControl: 10,
      treasury: 0,
    })
    const ctx = makeCtx({ ...state, currentWeekOfYear: 5, absoluteWeek: 1000 * 48 + 4 })
    const next = runProvinceRevoltSystem(ctx)
    expect(Object.keys(next.state.diplomaticPlays).length).toBe(0)
  })

  it('high-unrest conditions can generate a revolt_negotiation Play', () => {
    // High unrest + low polityControl + low treasury → revoltTendency 高
    // 複数 seed を試して 1 つでも Play が出ることを確認
    let foundPlay = false
    for (const seed of [
      'rev-1',
      'rev-2',
      'rev-3',
      'rev-4',
      'rev-5',
      'rev-6',
      'rev-7',
      'rev-8',
      'rev-9',
      'rev-10',
      'rev-11',
      'rev-12',
      'rev-13',
      'rev-14',
      'rev-15',
      'rev-16',
      'rev-17',
      'rev-18',
      'rev-19',
      'rev-20',
      'rev-21',
      'rev-22',
      'rev-23',
      'rev-24',
    ]) {
      const { state, polityId } = buildWorld({
        popUnrest: 99,
        popSize: 2000,
        development: 0,
        polityControl: 5,
        treasury: 0,
      })
      const ctx = makeCtx(state, seed, {
        provinceRevoltChanceDivisor: 30,
        provinceRevoltMaxChance: 1.0,
      })
      const next = runProvinceRevoltSystem(ctx)
      const plays = Object.values(next.state.diplomaticPlays)
      if (plays.length > 0) {
        foundPlay = true
        const play = plays[0]
        expect(play?.kind).toBe('revolt_negotiation')
        expect(play?.status).toBe('active')
        // initiator は新 rebel commonwealth Polity
        expect(play?.initiator.kind).toBe('polity')
        // target は元 polity
        expect(play?.target.kind).toBe('polity')
        expect(play?.target.id).toBe(polityId)
        expect(play?.primaryDemand?.kind).toBe('popular_tax_relief')
        if (play?.primaryDemand?.kind === 'popular_tax_relief') {
          expect(play.primaryDemand.claimantPopClass).toBeDefined()
        }
        // REVOLT_NEGOTIATION_STARTED イベントが発火
        expect(next.events.some((e) => e.type === 'REVOLT_NEGOTIATION_STARTED')).toBe(true)
        // 旧 PROVINCE_REVOLT_SUCCEEDED は発火しない
        expect(next.events.some((e) => e.type === 'PROVINCE_REVOLT_SUCCEEDED')).toBe(false)
        // 旧 PROVINCE_REVOLT_FAILED も発火しない
        expect(next.events.some((e) => e.type === 'PROVINCE_REVOLT_FAILED')).toBe(false)
        break
      }
    }
    expect(foundPlay).toBe(true)
  })

  it('low-unrest conditions: no revolt triggered', () => {
    const { state } = buildWorld({
      popUnrest: 5,
      popSize: 500,
      development: 50,
      polityControl: 100,
      treasury: 1000,
    })
    const ctx = makeCtx(state)
    const next = runProvinceRevoltSystem(ctx)
    expect(Object.keys(next.state.diplomaticPlays).length).toBe(0)
    expect(next.events.some((e) => e.type === 'REVOLT_NEGOTIATION_STARTED')).toBe(false)
  })
})
