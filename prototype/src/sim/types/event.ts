import type { EventId, PersonId, HouseId, CountryId, ProvinceId } from './ids'

export type EventType =
  | 'ROLE_ASSIGNED'
  | 'ROLE_REVOKED'
  | 'PERSON_DIED'
  | 'IMPORTANT_PERSON_DIED'
  | 'PERSON_EMERGED'
  | 'HOUSE_HEAD_CHANGED'
  | 'HOUSE_EXTINCT'
  | 'PLOT_STARTED'
  | 'PLOT_SUCCEEDED'
  | 'PLOT_FAILED'
  | 'PLOT_CANCELLED'
  | 'REBELLION_STARTED'
  | 'REBELLION_SUCCEEDED'
  | 'REBELLION_FAILED'
  | 'COUNTRY_SPLIT'
  | 'RULER_HOUSE_CHANGED'
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
  | 'ALMS_DISTRIBUTED'

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
