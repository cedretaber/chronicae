import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'

// v0.61 商会・交易システムの整合性検査。
//   P1: record↔index 同期のみ (collections は P3 worldgen seed まで空)。
//   P3: 静的 hard invariant (ownerHouse active / HQ=city / route 隣接・level・slot cap 等) を追加する。

// index の各 bucket に載る id が record に存在し、重複が無いことを検査する汎用ヘルパー。
function checkIndexRefsExist(
  errors: SimError[],
  label: string,
  buckets: Record<string, readonly string[]>,
  recordHas: (id: string) => boolean,
): void {
  for (const [key, ids] of Object.entries(buckets)) {
    const seen = new Set<string>()
    for (const id of ids) {
      if (!recordHas(id)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `${label} index[${key}] references missing id=${id}`,
        })
      }
      if (seen.has(id)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `${label} index[${key}] has duplicate id=${id}`,
        })
      }
      seen.add(id)
    }
  }
}

export function checkMerchant(state: WorldState, errors: SimError[]): void {
  // --- MerchantCompany ---
  const companyExists = (id: string): boolean => state.merchantCompanies[id as never] !== undefined
  checkIndexRefsExist(
    errors,
    'merchantCompany.byOwnerHouse',
    state.merchantCompanyIndex.byOwnerHouse,
    companyExists,
  )
  checkIndexRefsExist(
    errors,
    'merchantCompany.byStatus',
    state.merchantCompanyIndex.byStatus,
    companyExists,
  )

  // --- Establishment ---
  const estExists = (id: string): boolean =>
    state.merchantCompanyEstablishments[id as never] !== undefined
  checkIndexRefsExist(
    errors,
    'merchantEstablishment.byCompany',
    state.merchantCompanyEstablishmentIndex.byCompany,
    estExists,
  )
  checkIndexRefsExist(
    errors,
    'merchantEstablishment.byHolding',
    state.merchantCompanyEstablishmentIndex.byHolding,
    estExists,
  )
  checkIndexRefsExist(
    errors,
    'merchantEstablishment.byKind',
    state.merchantCompanyEstablishmentIndex.byKind,
    estExists,
  )

  // --- TradeRoute ---
  const routeExists = (id: string): boolean => state.tradeRoutes[id as never] !== undefined
  checkIndexRefsExist(errors, 'tradeRoute.byCompany', state.tradeRouteIndex.byCompany, routeExists)
  checkIndexRefsExist(
    errors,
    'tradeRoute.bySourceState',
    state.tradeRouteIndex.bySourceState,
    routeExists,
  )
  checkIndexRefsExist(
    errors,
    'tradeRoute.byTargetState',
    state.tradeRouteIndex.byTargetState,
    routeExists,
  )
  checkIndexRefsExist(
    errors,
    'tradeRoute.byResource',
    state.tradeRouteIndex.byResource,
    routeExists,
  )
  checkIndexRefsExist(errors, 'tradeRoute.byStatus', state.tradeRouteIndex.byStatus, routeExists)

  // --- Share ---
  const shareExists = (id: string): boolean =>
    state.merchantCompanyShares[id as never] !== undefined
  checkIndexRefsExist(
    errors,
    'merchantShare.byCompany',
    state.merchantCompanyShareIndex.byCompany,
    shareExists,
  )
  checkIndexRefsExist(
    errors,
    'merchantShare.byHolder',
    state.merchantCompanyShareIndex.byHolder,
    shareExists,
  )
}
