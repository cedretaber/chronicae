import type {
  MerchantCompanyId,
  MerchantCompanyEstablishmentId,
  TradeRouteId,
  MerchantCompanyShareId,
  HouseId,
  HoldingId,
  PersonId,
  StateRegionId,
} from './ids'
import type { ResourceKind } from './resource'

// v0.61 商会・交易システム。
// MerchantCompany は polity / house と並ぶ第三の組織種であり、Goal/Aim/Project を持つ
// 自律経済主体。OrganizationRef / DecisionSubjectRef に merchant_company として統合される。

export type MerchantCompanyStatus = 'active' | 'bankrupt' | 'dormant' | 'dissolved'

export type MerchantCompany = {
  id: MerchantCompanyId
  nameKey: string

  ownerHouseId: HouseId

  status: MerchantCompanyStatus

  treasury: number
  // v0.61 予約・未使用 (商会信用・特権・融資の将来基盤)。増減則は future。
  reputation: number

  createdWeek: number
  closedWeek?: number

  lastProfit: number
  smoothedProfit: number

  // v0.61 §20.1: 経営難（treasury<閾値 かつ smoothedProfit<0）が始まった週。回復で undefined に戻る。
  //   (week - distressSince) >= graceWeeks で bankrupt 判定。
  distressSince?: number

  headquartersEstablishmentId: MerchantCompanyEstablishmentId
}

export type MerchantEstablishmentKind = 'headquarters' | 'branch'

export type MerchantCompanyEstablishmentStatus = 'active' | 'closed'

export type MerchantCompanyEstablishment = {
  id: MerchantCompanyEstablishmentId
  companyId: MerchantCompanyId

  holdingId: HoldingId // city only

  kind: MerchantEstablishmentKind
  status: MerchantCompanyEstablishmentStatus

  level: number
  // v0.61 予約・未使用 (facilityMaintenanceSystem の対象にしない。劣化なし)。
  condition: number

  createdWeek: number
  closedWeek?: number

  // v0.61 予約・未使用 (将来の支店長)。
  managerPersonId?: PersonId
}

export type TradeRouteStatus = 'active' | 'closing' | 'closed'

export type TradeRoute = {
  id: TradeRouteId
  companyId: MerchantCompanyId

  status: TradeRouteStatus

  sourceStateId: StateRegionId
  targetStateId: StateRegionId

  resource: ResourceKind

  level: number

  createdWeek: number
  closedWeek?: number
  lastUpgradedWeek?: number

  // TradePlanningSystem が前月 snapshot から算出する予定交易量。
  plannedQuantity: number
  plannedWeek: number

  // v0.61 は 2 相清算しないため原則 lastQuantity = plannedQuantity。
  lastQuantity: number
  lastBuyPrice: number
  lastSellPrice: number
  lastProfit: number
  smoothedProfit: number
}

export type MerchantCompanyShare = {
  id: MerchantCompanyShareId
  companyId: MerchantCompanyId
  holderPersonId: PersonId
  rawPower: number // >= 0
}

// --- Index 型 ---

export type MerchantCompanyIndex = {
  byOwnerHouse: Record<string, MerchantCompanyId[]>
  byStatus: Record<MerchantCompanyStatus, MerchantCompanyId[]>
}

export type MerchantCompanyEstablishmentIndex = {
  byCompany: Record<string, MerchantCompanyEstablishmentId[]>
  byHolding: Record<string, MerchantCompanyEstablishmentId[]>
  byKind: Record<MerchantEstablishmentKind, MerchantCompanyEstablishmentId[]>
}

export type TradeRouteIndex = {
  byCompany: Record<string, TradeRouteId[]>
  bySourceState: Record<string, TradeRouteId[]>
  byTargetState: Record<string, TradeRouteId[]>
  byResource: Record<string, TradeRouteId[]>
  byStatus: Record<TradeRouteStatus, TradeRouteId[]>
}

export type MerchantCompanyShareIndex = {
  byCompany: Record<string, MerchantCompanyShareId[]>
  byHolder: Record<string, MerchantCompanyShareId[]>
}
