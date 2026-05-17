import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId, createPlotId } from '../types/ids'
import type { CountryId, HouseId, PersonId, PlotId, ProvinceId } from '../types/ids'
import type { Plot } from '../types/plot'
import type { WorldState } from '../types/world'
import { collectIntegrityErrors } from '../tick/integritySystem'
import { addPlot, removePlot, resolvePlot } from './plotMutations'

function makeFixture(): {
  state: WorldState
  plotId: PlotId
  leaderId: PersonId
  country1Id: CountryId
  house1Id: HouseId
} {
  const country1Id = createCountryId('c', 0)
  const house1Id = createHouseId('h', 0)
  const leaderId = createPersonId('pe', 0)
  const plotId = createPlotId('pl', 0)

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {},
    countries: {
      [country1Id]: {
        id: country1Id,
        name: 'Country 1',
        houseIds: [house1Id],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [house1Id]: {
        id: house1Id,
        name: 'House 1',
        active: true,
        countryId: country1Id,
        provinceIds: [],
        memberIds: [leaderId],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [leaderId]: {
        id: leaderId,
        name: 'Leader',
        sex: 'male',
        age: 35,
        alive: true,
        houseId: house1Id,
        countryId: country1Id,
        childIds: [],
        birthStatus: 'legitimate',
        stats: { admin: 5, martial: 5 },
        traits: { ambition: 0.7, caution: 0.3 },
        legacyPrestige: 20,
        wealth: 0,
        attitudes: {},
      },
    },
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
  }
  return { state, plotId, leaderId, country1Id, house1Id }
}

function makePlot(plotId: PlotId, leaderId: PersonId): Plot {
  return {
    id: plotId,
    type: 'replace_house_leader',
    status: 'active',
    startedYear: 1444,
    startedMonth: 1,
    durationMonths: 12,
    elapsedMonths: 0,
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
