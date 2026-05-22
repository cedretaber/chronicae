import { describe, expect, it } from 'vitest'
import {
  createPolityId,
  createHouseId,
  createPersonId,
  createPlotId,
  createProvinceId,
} from '../types/ids'
import type { PolityId, HouseId, PersonId, PlotId, ProvinceId } from '../types/ids'
import type { Plot } from '../types/plot'
import type { WorldState } from '../types/world'
import { collectIntegrityErrors } from '../tick/integritySystem'
import { addPlot, removePlot, resolvePlot } from './plotMutations'
import {
  bindProvinceToHouseViaPolity,
  bindProvinceToPolity,
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
} from '../testFixtures'

function makeFixture(): {
  state: WorldState
  plotId: PlotId
  leaderId: PersonId
  polity1Id: PolityId
  house1Id: HouseId
} {
  const polity1Id = createPolityId('c', 0)
  const house1Id = createHouseId('h', 0)
  const leaderId = createPersonId('pe', 0)
  const plotId = createPlotId('pl', 0)
  const provinceId = createProvinceId('p', 0)

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312 }
  state = withProvince(state, provinceId)
  state = withProvince(state, 'p-1' as ProvinceId)
  state = withHouse(state, house1Id, {
    nameKey: 'House 1',
    memberIds: [leaderId],
    seatProvinceId: provinceId,
  })
  state = withPolity(state, polity1Id, {
    nameKey: 'Polity 1',
    ownerHouseId: house1Id,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polity1Id, house1Id)
  state = bindProvinceToPolity(state, 'p-1' as ProvinceId, polity1Id)
  state = withPerson(state, leaderId, {
    nameKey: 'Leader',
    age: 35,
    houseId: house1Id,
    traits: { ambition: 0.7, caution: 0.3 },
    legacyPrestige: 20,
  })
  return { state, plotId, leaderId, polity1Id, house1Id }
}

function makePlot(plotId: PlotId, leaderId: PersonId): Plot {
  return {
    id: plotId,
    type: 'replace_house_leader',
    status: 'active',
    startedWeek: 1444 * 48 + 1 - 1,
    durationWeeks: 12 * 4,
    leaderId,
    participantIds: [],
    power: 50,
    secrecy: 70,
    risk: 30,
  }
}

describe('addPlot', () => {
  it('adds a plot to activePlots', () => {
    const { state, plotId, leaderId } = makeFixture()
    const plot = makePlot(plotId, leaderId)
    const result = addPlot(state, plot)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.activePlots[plotId]).toBeDefined()
    expect(collectIntegrityErrors(result.value)).toEqual([])
  })

  it('returns err when plot already exists', () => {
    const { state, plotId, leaderId } = makeFixture()
    const plot = makePlot(plotId, leaderId)
    const first = addPlot(state, plot)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const result = addPlot(first.value, plot)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INTEGRITY_VIOLATION')
  })
})

describe('removePlot', () => {
  it('removes a plot from activePlots', () => {
    const { state, plotId, leaderId } = makeFixture()
    const plot = makePlot(plotId, leaderId)
    const withPlot = addPlot(state, plot)
    expect(withPlot.ok).toBe(true)
    if (!withPlot.ok) return

    const result = removePlot(withPlot.value, plotId)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.activePlots[plotId]).toBeUndefined()
      expect(collectIntegrityErrors(result.value)).toEqual([])
    }
  })

  it('is a no-op when plot not found', () => {
    const { state, plotId } = makeFixture()
    const result = removePlot(state, plotId)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(state)
  })
})

describe('resolvePlot', () => {
  it('removes the plot from activePlots', () => {
    const { state, plotId, leaderId } = makeFixture()
    const plot = makePlot(plotId, leaderId)
    const withPlot = addPlot(state, plot)
    expect(withPlot.ok).toBe(true)
    if (!withPlot.ok) return

    const result = resolvePlot(withPlot.value, plotId)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.activePlots[plotId]).toBeUndefined()
      expect(collectIntegrityErrors(result.value)).toEqual([])
    }
  })

  it('returns err when plot not found', () => {
    const { state, plotId } = makeFixture()
    const result = resolvePlot(state, plotId)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INTEGRITY_VIOLATION')
  })
})
