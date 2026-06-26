import type { WorldState } from '../types/world'
import type {
  MerchantCompanyId,
  MerchantCompanyEstablishmentId,
  TradeRouteId,
  MerchantCompanyShareId,
  HouseId,
  HoldingId,
  PersonId,
  StateRegionId,
} from '../types/ids'
import { unbindPopsFromEmployerMut } from './popMutations'
import {
  createMerchantCompanyId,
  createMerchantCompanyEstablishmentId,
  createTradeRouteId,
  createMerchantCompanyShareId,
} from '../types/ids'
import type {
  MerchantCompany,
  MerchantCompanyEstablishment,
  TradeRoute,
  MerchantCompanyShare,
  MerchantCompanyStatus,
  MerchantEstablishmentKind,
  MerchantCompanyEstablishmentStatus,
  TradeRouteStatus,
  MerchantCompanyIndex,
  MerchantCompanyEstablishmentIndex,
  TradeRouteIndex,
  MerchantCompanyShareIndex,
} from '../types/merchant'
import type { ResourceKind } from '../types/resource'

// v0.61 商会 mutation。realEstateAssetMutations のパターンに倣い、ws の各 slice を
// in-place 更新する (mutable draft 前提)。index は record と同期する。

// --- 空 slice 初期化 (worldgen / testFixtures が spread して使う) ---

export function createEmptyMerchantCompanyIndex(): MerchantCompanyIndex {
  return {
    byOwnerHouse: {},
    byStatus: { active: [], bankrupt: [], dormant: [], dissolved: [] },
  }
}

export function createEmptyMerchantCompanyEstablishmentIndex(): MerchantCompanyEstablishmentIndex {
  return { byCompany: {}, byHolding: {}, byKind: { headquarters: [], branch: [] } }
}

export function createEmptyTradeRouteIndex(): TradeRouteIndex {
  return {
    byCompany: {},
    bySourceState: {},
    byTargetState: {},
    byResource: {},
    byStatus: { active: [], closing: [], closed: [] },
  }
}

export function createEmptyMerchantCompanyShareIndex(): MerchantCompanyShareIndex {
  return { byCompany: {}, byHolder: {} }
}

// WorldState の商会 slice 一式を空で初期化する (4 collection + index + nextId + cooldown)。
export function createEmptyMerchantWorldSlices(): Pick<
  WorldState,
  | 'merchantCompanies'
  | 'merchantCompanyIndex'
  | 'nextMerchantCompanyId'
  | 'merchantCompanyEstablishments'
  | 'merchantCompanyEstablishmentIndex'
  | 'nextMerchantCompanyEstablishmentId'
  | 'tradeRoutes'
  | 'tradeRouteIndex'
  | 'nextTradeRouteId'
  | 'merchantCompanyShares'
  | 'merchantCompanyShareIndex'
  | 'nextMerchantCompanyShareId'
  | 'merchantFoundingCooldownByState'
> {
  return {
    merchantCompanies: {},
    merchantCompanyIndex: createEmptyMerchantCompanyIndex(),
    nextMerchantCompanyId: 0,
    merchantCompanyEstablishments: {},
    merchantCompanyEstablishmentIndex: createEmptyMerchantCompanyEstablishmentIndex(),
    nextMerchantCompanyEstablishmentId: 0,
    tradeRoutes: {},
    tradeRouteIndex: createEmptyTradeRouteIndex(),
    nextTradeRouteId: 0,
    merchantCompanyShares: {},
    merchantCompanyShareIndex: createEmptyMerchantCompanyShareIndex(),
    nextMerchantCompanyShareId: 0,
    merchantFoundingCooldownByState: {},
  }
}

// --- index ヘルパー ---

function pushIndex(map: Record<string, string[]>, key: string, id: string): void {
  const slot = map[key]
  map[key] = slot ? [...slot, id] : [id]
}

function removeIndex(map: Record<string, string[]>, key: string, id: string): void {
  const slot = map[key]
  if (!slot) return
  const filtered = slot.filter((x) => x !== id)
  if (filtered.length > 0) map[key] = filtered
  else delete map[key]
}

// --- MerchantCompany ---

export function createMerchantCompanyMut(
  ws: WorldState,
  fields: {
    nameKey: string
    ownerHouseId: HouseId
    treasury: number
    reputation?: number
    createdWeek: number
    headquartersEstablishmentId: MerchantCompanyEstablishmentId
    status?: MerchantCompanyStatus
  },
): MerchantCompany {
  const id = createMerchantCompanyId(ws.nextMerchantCompanyId++)
  const company: MerchantCompany = {
    id,
    nameKey: fields.nameKey,
    ownerHouseId: fields.ownerHouseId,
    status: fields.status ?? 'active',
    treasury: fields.treasury,
    reputation: fields.reputation ?? 0,
    createdWeek: fields.createdWeek,
    lastProfit: 0,
    smoothedProfit: 0,
    headquartersEstablishmentId: fields.headquartersEstablishmentId,
  }
  ws.merchantCompanies[id] = company
  pushIndex(ws.merchantCompanyIndex.byOwnerHouse, fields.ownerHouseId, id)
  ws.merchantCompanyIndex.byStatus[company.status].push(id)
  return company
}

export function setMerchantCompanyStatusMut(
  ws: WorldState,
  companyId: MerchantCompanyId,
  status: MerchantCompanyStatus,
): void {
  const company = ws.merchantCompanies[companyId]
  if (!company) return
  if (company.status === status) return
  const old = company.status
  ws.merchantCompanyIndex.byStatus[old] = ws.merchantCompanyIndex.byStatus[old].filter(
    (x) => (x as string) !== (companyId as string),
  )
  ws.merchantCompanyIndex.byStatus[status].push(companyId)
  ws.merchantCompanies[companyId] = { ...company, status }
}

export function removeMerchantCompanyMut(ws: WorldState, companyId: MerchantCompanyId): void {
  const company = ws.merchantCompanies[companyId]
  if (!company) return
  removeIndex(ws.merchantCompanyIndex.byOwnerHouse, company.ownerHouseId, companyId)
  ws.merchantCompanyIndex.byStatus[company.status] = ws.merchantCompanyIndex.byStatus[
    company.status
  ].filter((x) => (x as string) !== (companyId as string))
  delete ws.merchantCompanies[companyId]
}

// --- Establishment ---

export function createMerchantCompanyEstablishmentMut(
  ws: WorldState,
  fields: {
    companyId: MerchantCompanyId
    holdingId: HoldingId
    kind: MerchantEstablishmentKind
    level: number
    createdWeek: number
    condition?: number
    status?: MerchantCompanyEstablishmentStatus
    managerPersonId?: PersonId
  },
): MerchantCompanyEstablishment {
  const id = createMerchantCompanyEstablishmentId(ws.nextMerchantCompanyEstablishmentId++)
  const est: MerchantCompanyEstablishment = {
    id,
    companyId: fields.companyId,
    holdingId: fields.holdingId,
    kind: fields.kind,
    status: fields.status ?? 'active',
    level: fields.level,
    condition: fields.condition ?? 1,
    createdWeek: fields.createdWeek,
    ...(fields.managerPersonId !== undefined ? { managerPersonId: fields.managerPersonId } : {}),
  }
  ws.merchantCompanyEstablishments[id] = est
  pushIndex(ws.merchantCompanyEstablishmentIndex.byCompany, fields.companyId, id)
  pushIndex(ws.merchantCompanyEstablishmentIndex.byHolding, fields.holdingId, id)
  ws.merchantCompanyEstablishmentIndex.byKind[fields.kind].push(id)
  return est
}

export function setMerchantEstablishmentStatusMut(
  ws: WorldState,
  estId: MerchantCompanyEstablishmentId,
  status: MerchantCompanyEstablishmentStatus,
  closedWeek?: number,
): void {
  const est = ws.merchantCompanyEstablishments[estId]
  if (!est) return
  const updated: MerchantCompanyEstablishment = { ...est, status }
  if (status === 'closed' && closedWeek !== undefined) updated.closedWeek = closedWeek
  ws.merchantCompanyEstablishments[estId] = updated
}

export function setMerchantEstablishmentLevelMut(
  ws: WorldState,
  estId: MerchantCompanyEstablishmentId,
  level: number,
): void {
  const est = ws.merchantCompanyEstablishments[estId]
  if (!est) return
  ws.merchantCompanyEstablishments[estId] = { ...est, level }
}

export function removeMerchantEstablishmentMut(
  ws: WorldState,
  estId: MerchantCompanyEstablishmentId,
): void {
  const est = ws.merchantCompanyEstablishments[estId]
  if (!est) return

  // v0.63 belt-and-suspenders: unbind any remaining employed POPs in this holding
  // before the establishment is deleted from state
  unbindPopsFromEmployerMut(ws, est.holdingId, { kind: 'merchant', id: estId })

  removeIndex(ws.merchantCompanyEstablishmentIndex.byCompany, est.companyId, estId)
  removeIndex(ws.merchantCompanyEstablishmentIndex.byHolding, est.holdingId, estId)
  ws.merchantCompanyEstablishmentIndex.byKind[est.kind] =
    ws.merchantCompanyEstablishmentIndex.byKind[est.kind].filter(
      (x) => (x as string) !== (estId as string),
    )
  delete ws.merchantCompanyEstablishments[estId]
}

// --- TradeRoute ---

export function createTradeRouteMut(
  ws: WorldState,
  fields: {
    companyId: MerchantCompanyId
    sourceStateId: StateRegionId
    targetStateId: StateRegionId
    resource: ResourceKind
    level: number
    createdWeek: number
    status?: TradeRouteStatus
  },
): TradeRoute {
  const id = createTradeRouteId(ws.nextTradeRouteId++)
  const route: TradeRoute = {
    id,
    companyId: fields.companyId,
    status: fields.status ?? 'active',
    sourceStateId: fields.sourceStateId,
    targetStateId: fields.targetStateId,
    resource: fields.resource,
    level: fields.level,
    createdWeek: fields.createdWeek,
    plannedQuantity: 0,
    plannedWeek: fields.createdWeek,
    lastQuantity: 0,
    lastBuyPrice: 0,
    lastSellPrice: 0,
    lastProfit: 0,
    smoothedProfit: 0,
    plannedBuyPrice: 0,
    plannedSellPrice: 0,
    plannedExpectedUnitMargin: 0,
  }
  ws.tradeRoutes[id] = route
  pushIndex(ws.tradeRouteIndex.byCompany, fields.companyId, id)
  pushIndex(ws.tradeRouteIndex.bySourceState, fields.sourceStateId, id)
  pushIndex(ws.tradeRouteIndex.byTargetState, fields.targetStateId, id)
  pushIndex(ws.tradeRouteIndex.byResource, fields.resource, id)
  ws.tradeRouteIndex.byStatus[route.status].push(id)
  return route
}

export function setTradeRouteStatusMut(
  ws: WorldState,
  routeId: TradeRouteId,
  status: TradeRouteStatus,
  closedWeek?: number,
): void {
  const route = ws.tradeRoutes[routeId]
  if (!route) return
  if (route.status !== status) {
    ws.tradeRouteIndex.byStatus[route.status] = ws.tradeRouteIndex.byStatus[route.status].filter(
      (x) => (x as string) !== (routeId as string),
    )
    ws.tradeRouteIndex.byStatus[status].push(routeId)
  }
  const updated: TradeRoute = { ...route, status }
  if ((status === 'closing' || status === 'closed') && closedWeek !== undefined) {
    updated.closedWeek = closedWeek
  }
  ws.tradeRoutes[routeId] = updated
}

export function removeTradeRouteMut(ws: WorldState, routeId: TradeRouteId): void {
  const route = ws.tradeRoutes[routeId]
  if (!route) return
  removeIndex(ws.tradeRouteIndex.byCompany, route.companyId, routeId)
  removeIndex(ws.tradeRouteIndex.bySourceState, route.sourceStateId, routeId)
  removeIndex(ws.tradeRouteIndex.byTargetState, route.targetStateId, routeId)
  removeIndex(ws.tradeRouteIndex.byResource, route.resource, routeId)
  ws.tradeRouteIndex.byStatus[route.status] = ws.tradeRouteIndex.byStatus[route.status].filter(
    (x) => (x as string) !== (routeId as string),
  )
  delete ws.tradeRoutes[routeId]
}

// --- Share ---

export function createMerchantCompanyShareMut(
  ws: WorldState,
  fields: {
    companyId: MerchantCompanyId
    holderPersonId: PersonId
    rawPower: number
  },
): MerchantCompanyShare {
  const id = createMerchantCompanyShareId(ws.nextMerchantCompanyShareId++)
  const share: MerchantCompanyShare = {
    id,
    companyId: fields.companyId,
    holderPersonId: fields.holderPersonId,
    rawPower: fields.rawPower,
  }
  ws.merchantCompanyShares[id] = share
  pushIndex(ws.merchantCompanyShareIndex.byCompany, fields.companyId, id)
  pushIndex(ws.merchantCompanyShareIndex.byHolder, fields.holderPersonId, id)
  return share
}

// §20.4: ownerHouse 断絶時に、当該 House 所有の全商会を dissolved 化する。
//   active route / branch / HQ を closed にし、status=dissolved + closedWeek を立てる。
//   dissolved record の retention purge は cleanupMerchantSystem (P7)。返り値は dissolve した companyId 群。
export function dissolveMerchantCompaniesOfHouseMut(
  ws: WorldState,
  houseId: HouseId,
  week: number,
): MerchantCompanyId[] {
  const companyIds = [...(ws.merchantCompanyIndex.byOwnerHouse[houseId as string] ?? [])]
  const dissolved: MerchantCompanyId[] = []
  for (const companyId of companyIds) {
    const company = ws.merchantCompanies[companyId]
    if (!company || company.status === 'dissolved') continue
    // routes を closed に
    for (const routeId of [...(ws.tradeRouteIndex.byCompany[companyId as string] ?? [])]) {
      const route = ws.tradeRoutes[routeId]
      if (route && route.status !== 'closed') setTradeRouteStatusMut(ws, routeId, 'closed', week)
    }
    // establishments (HQ/branch) を closed に
    for (const estId of [
      ...(ws.merchantCompanyEstablishmentIndex.byCompany[companyId as string] ?? []),
    ]) {
      const est = ws.merchantCompanyEstablishments[estId]
      if (est && est.status !== 'closed')
        setMerchantEstablishmentStatusMut(ws, estId, 'closed', week)
    }
    const updated = ws.merchantCompanies[companyId]
    if (updated) ws.merchantCompanies[companyId] = { ...updated, closedWeek: week }
    setMerchantCompanyStatusMut(ws, companyId, 'dissolved')
    dissolved.push(companyId)
  }
  return dissolved
}

export function removeMerchantCompanyShareMut(
  ws: WorldState,
  shareId: MerchantCompanyShareId,
): void {
  const share = ws.merchantCompanyShares[shareId]
  if (!share) return
  removeIndex(ws.merchantCompanyShareIndex.byCompany, share.companyId, shareId)
  removeIndex(ws.merchantCompanyShareIndex.byHolder, share.holderPersonId, shareId)
  delete ws.merchantCompanyShares[shareId]
}
