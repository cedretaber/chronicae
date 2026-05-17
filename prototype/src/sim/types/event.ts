import type { EventId, PersonId, HouseId, CountryId, ProvinceId } from './ids'

export type EventType =
  | 'PERSON_DIED'
  | 'IMPORTANT_PERSON_DIED'
  | 'HOUSE_EXTINCT'
  | 'MARRIAGE_FORMED'
  | 'CHILD_BORN'
  | 'HOUSE_SPLIT'
  | 'SUCCESSION_CRISIS'
  | 'PLOT_STARTED'
  | 'PLOT_SUCCEEDED'
  | 'PLOT_FAILED'
  | 'PLOT_CANCELLED'
  | 'REBELLION_STARTED'
  | 'REBELLION_SUCCEEDED'
  | 'REBELLION_FAILED'
  | 'COUNTRY_SPLIT'
  | 'OMEN'
  | 'FAMINE'
  | 'BOUNTIFUL_HARVEST'
  | 'PLAGUE'
  | 'WAR_DECLARED'
  | 'WAR_WON'
  | 'WAR_LOST'
  | 'PROVINCE_CONQUERED'
  | 'COUNTRY_ANNEXED'
  | 'DISASTER_RELIEF_FUNDED'
  | 'DISASTER_RELIEF_FAILED'
  | 'MONUMENT_BUILT'
  | 'COUNTRY_LAND_DEVELOPED'
  | 'HOUSE_LAND_DEVELOPED'
  | 'LORDSHIP_TRANSFERRED'
  | 'POP_LAND_DEVELOPED'
  | 'POP_HARDSHIP'
  | 'POP_PROSPERITY'
  | 'POP_UNREST_RISING'
  | 'POP_DECLINED'
  | 'PROVINCE_REVOLT_STARTED'
  | 'PROVINCE_REVOLT_SUCCEEDED'
  | 'PROVINCE_REVOLT_FAILED'
  | 'LORDSHIP_USURPED'
  | 'REVOLT_COUNTRY_FOUNDED'
  | 'OFFICE_ASSIGNED'
  | 'OFFICE_REVOKED'
  | 'OFFICE_SALARY_UNPAID'
  | 'OFFICE_SALARY_PARTIALLY_PAID'
  | 'RULER_CHANGED'
  | 'HOUSE_LEADER_CHANGED'
  | 'SHARE_SHIFTED'

export type EventReason = {
  label: string
  value?: number
  contribution?: number
}

export type EventEffect = {
  label: string
  value?: number
}

export type SimEvent = {
  id: EventId
  year: number
  month: number
  type: EventType
  importance: 'minor' | 'normal' | 'major' | 'critical'
  actorIds: PersonId[]
  houseIds: HouseId[]
  countryIds: CountryId[]
  provinceIds: ProvinceId[]
  summary: string
  description?: string
  reasons: EventReason[]
  effects: EventEffect[]
}
