import type { RngState } from '../rng/rng'
import type { ProvinceId, CountryId, HouseId, PersonId, PlotId } from './ids'
import type { Province } from './province'
import type { Country } from './country'
import type { House } from './house'
import type { Person } from './person'
import type { Plot } from './plot'
import type { SimEvent } from './event'

export type WorldState = {
  currentYear: number
  currentMonth: number
  provinces: Record<ProvinceId, Province>
  countries: Record<CountryId, Country>
  houses: Record<HouseId, House>
  persons: Record<PersonId, Person>
  activePlots: Record<PlotId, Plot>
}

export type SimulationSession = {
  initialSeed: string
  currentState: WorldState
  rng: RngState
  eventHistory: SimEvent[]
}
