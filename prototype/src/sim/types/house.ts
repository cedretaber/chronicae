import type { HouseId, ProvinceId, PersonId, CountryId } from './ids'

export type House = {
  id: HouseId
  name: string
  active: boolean
  countryId: CountryId
  provinceIds: ProvinceId[]
  memberIds: PersonId[]
  headId: PersonId
  prestige: number // 0..100
  cohesion: number // 0..100
  loyaltyToCountry: number // 0..100
  wealth: number // >= 0
}
