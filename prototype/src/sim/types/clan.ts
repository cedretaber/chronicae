import type { ClanId, HouseId, PersonId } from './ids'

export type Clan = {
  id: ClanId
  active: boolean
  rootHouseId: HouseId
  nameSourceHouseId: HouseId
  memberHouseIds: HouseId[]
  founderPersonId?: PersonId
  createdWeek: number
}
