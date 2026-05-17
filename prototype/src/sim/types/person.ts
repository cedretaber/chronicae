import type { PersonId, HouseId, CountryId } from './ids'
import type { AttitudeMap } from './attitude'

export type Sex = 'male' | 'female'
export type BirthStatus = 'legitimate' | 'illegitimate' | 'unknown'

export type Person = {
  id: PersonId
  name: string
  sex: Sex
  age: number
  alive: boolean
  houseId: HouseId
  countryId: CountryId
  fatherId?: PersonId
  motherId?: PersonId
  spouseId?: PersonId
  childIds: PersonId[]
  birthStatus: BirthStatus
  stats: {
    admin: number // 0..10
    martial: number // 0..10
  }
  traits: {
    ambition: number // 0.0..1.0
    caution: number // 0.0..1.0
  }
  legacyPrestige: number // 0..100
  wealth: number // >= 0
  attitudes: AttitudeMap
}
