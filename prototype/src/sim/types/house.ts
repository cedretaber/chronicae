import type { HouseId, ProvinceId, PersonId, CountryId } from './ids'

export type House = {
  id: HouseId
  name: string
  active: boolean
  countryId: CountryId
  provinceIds: ProvinceId[]
  memberIds: PersonId[]
  headId: PersonId
  founderId?: PersonId
  parentHouseId?: HouseId
  cadetHouseIds: HouseId[]
  nameSource?: 'pool' | 'province' | 'founder' | 'fallback'
  prestige: number // 0..100
  cohesion: number // 0..100
  loyaltyToCountry: number // 0..100
  wealth: number // >= 0
  seatProvinceId: ProvinceId
}
