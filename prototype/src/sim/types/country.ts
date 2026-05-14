import type { CountryId, HouseId, PersonId, ProvinceId } from './ids'
import type { RoleType } from './role'

export type Country = {
  id: CountryId
  name: string
  rulerHouseId: HouseId
  houseIds: HouseId[]
  treasury: number // >= 0
  legitimacy: number // 0..100
  adminPower: number // 0..100
  stability: number // 0..100
  roleAssignments: Partial<Record<RoleType, PersonId>>
  active: boolean
  lastWarMonth?: number
  capitalProvinceId: ProvinceId
}
