import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { advanceTime } from './advanceTime'

function makeCtx(year: number, month: number): TickContext {
  return {
    state: {
      currentYear: year,
      currentMonth: month,
      provinces: {},
      countries: {},
      houses: {},
      persons: {},
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments: {},
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 0,
    },
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextCountryIndex: 0,
  }
}

describe('advanceTime', () => {
  it('increments month from 1 to 2', () => {
    const ctx = makeCtx(1, 1)
    const result = advanceTime(ctx)
    expect(result.state.currentMonth).toBe(2)
    expect(result.state.currentYear).toBe(1)
  })

  it('increments month from 6 to 7', () => {
    const ctx = makeCtx(1, 6)
    const result = advanceTime(ctx)
    expect(result.state.currentMonth).toBe(7)
    expect(result.state.currentYear).toBe(1)
  })

  it('wraps month 12 to 1 and increments year', () => {
    const ctx = makeCtx(5, 12)
    const result = advanceTime(ctx)
    expect(result.state.currentMonth).toBe(1)
    expect(result.state.currentYear).toBe(6)
  })

  it('year 5 month 12 wraps to year 6 month 1', () => {
    const ctx = makeCtx(5, 12)
    const result = advanceTime(ctx)
    expect(result.state.currentMonth).toBe(1)
    expect(result.state.currentYear).toBe(6)
  })

  it('does not mutate original ctx state', () => {
    const ctx = makeCtx(3, 6)
    const originalYear = ctx.state.currentYear
    const originalMonth = ctx.state.currentMonth

    advanceTime(ctx)

    expect(ctx.state.currentYear).toBe(originalYear)
    expect(ctx.state.currentMonth).toBe(originalMonth)
  })
})
