import type { EventId, PersonId, HouseId, PolityId, ProvinceId } from './ids'

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
  | 'POLITY_SPLIT'
  | 'OMEN'
  | 'FAMINE'
  | 'BOUNTIFUL_HARVEST'
  | 'PLAGUE'
  | 'WAR_DECLARED'
  | 'WAR_WON'
  | 'WAR_LOST'
  | 'PROVINCE_CONQUERED'
  | 'POLITY_ANNEXED'
  | 'DISASTER_RELIEF_FUNDED'
  | 'DISASTER_RELIEF_FAILED'
  | 'COUNTRY_LAND_DEVELOPED'
  | 'HOUSE_LAND_DEVELOPED'
  | 'POP_LAND_DEVELOPED'
  | 'POP_HARDSHIP'
  | 'POP_PROSPERITY'
  | 'POP_UNREST_RISING'
  | 'POP_DECLINED'
  | 'PROVINCE_REVOLT_STARTED'
  | 'PROVINCE_REVOLT_SUCCEEDED'
  | 'PROVINCE_REVOLT_FAILED'
  | 'REVOLT_POLITY_FOUNDED'
  | 'OFFICE_ASSIGNED'
  | 'OFFICE_REVOKED'
  | 'OFFICE_SALARY_UNPAID'
  | 'OFFICE_SALARY_PARTIALLY_PAID'
  | 'POLITY_LEADER_CHANGED'
  | 'POLITY_OWNER_CHANGED'
  | 'POLITY_EXTINCT'
  | 'HOUSE_LEADER_CHANGED'
  | 'SHARE_SHIFTED'
  | 'ESTATE_SETTLED'
  | 'ESTATE_DISPUTED'
  | 'LAND_CONTRACT_GRANTED'
  | 'LAND_CONTRACT_TRANSFERRED'
  | 'LAND_CONTRACT_INSERTED'
  | 'LAND_CONTRACT_REPLACED'
  | 'LAND_CONTRACT_TAX_CHANGED'
  | 'LAND_CONTRACT_REVOKED'
  | 'LAND_CONTRACT_PURCHASED'
  | 'BAILIFF_APPOINTED'
  | 'BAILIFF_VACATED'
  | 'BAILIFF_PLACEHOLDER_INSTALLED'
  | 'POLITY_LANDLESS'
  | 'FACTION_FOUNDED'
  | 'FACTION_DISSOLVED'
  | 'FACTION_LEADER_CHANGED'
  | 'PERSON_RECRUITED_TO_FACTION'
  | 'OFFICE_TERM_ENDED'
  | 'PERSON_FADED_FROM_HISTORY'
  | 'PERSON_BORN_IN_OBSCURITY'
  | 'HOUSE_MEMBERS_DISPERSED'
  | 'FACTION_FUNDS_SHORTAGE'
  | 'FACTION_MEMBER_ABANDONED'
  | 'FACTION_LEADER_BANKRUPT'

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
  polityIds: PolityId[]
  provinceIds: ProvinceId[]
  summary: string
  description?: string
  reasons: EventReason[]
  effects: EventEffect[]
}
