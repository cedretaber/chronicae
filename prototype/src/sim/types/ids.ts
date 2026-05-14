type Branded<T, B> = T & { readonly _brand: B }

export type ProvinceId = Branded<string, 'ProvinceId'>
export type CountryId = Branded<string, 'CountryId'>
export type HouseId = Branded<string, 'HouseId'>
export type PersonId = Branded<string, 'PersonId'>
export type PlotId = Branded<string, 'PlotId'>
export type EventId = Branded<string, 'EventId'>

export function createProvinceId(prefix: string, n: number): ProvinceId {
  return (prefix + '-' + n) as ProvinceId
}

export function createCountryId(prefix: string, n: number): CountryId {
  return (prefix + '-' + n) as CountryId
}

export function createHouseId(prefix: string, n: number): HouseId {
  return (prefix + '-' + n) as HouseId
}

export function createPersonId(prefix: string, n: number): PersonId {
  return (prefix + '-' + n) as PersonId
}

export function createPlotId(prefix: string, n: number): PlotId {
  return (prefix + '-' + n) as PlotId
}

export function createEventId(prefix: string, n: number): EventId {
  return (prefix + '-' + n) as EventId
}
