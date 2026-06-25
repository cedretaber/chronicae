import type { TradeRoute } from '@/sim/types/merchant'
import type { WorldState } from '@/sim/types/world'
import type { StateRegionId } from '@/sim/types/ids'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'

// v0.61 §22: 交易路の最小情報カード。対象商品・収益（平滑利益）・接続 state を表示し、
//   クリックで交易路詳細を開く。商会詳細 / 市場詳細の双方から共有する。
//   highlightStateId: 当該市場側の端点を強調（市場詳細での使用）。
//   showCompany: 所有商会名を併記（市場詳細では複数商会の路が混在するため有用）。
export function TradeRouteCard({
  route,
  state,
  highlightStateId,
  showCompany = false,
  onClick,
}: {
  route: TradeRoute
  state: WorldState
  highlightStateId?: StateRegionId
  showCompany?: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()

  const stateName = (sid: StateRegionId): string =>
    resolveName('state_region', state.states[sid]?.nameKey, sid)
  const resourceName = t(`detail.realEstate.resource_${route.resource}`, {
    defaultValue: route.resource,
  })
  const company = state.merchantCompanies[route.companyId]
  const companyName = company ? resolveName('person', company.nameKey, company.id) : route.companyId

  const isActive = route.status === 'active'
  const profit = route.smoothedProfit
  const profitColor =
    profit > 0.05 ? 'text-emerald-400' : profit < -0.05 ? 'text-rose-400' : 'text-gray-400'

  const endpointClass = (sid: StateRegionId): string =>
    highlightStateId && (sid as string) === (highlightStateId as string)
      ? 'font-bold text-gray-100'
      : 'text-gray-300'

  return (
    <button
      onClick={onClick}
      className="w-full rounded bg-gray-700 p-1.5 text-left text-xs hover:bg-gray-600"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-200">
          {resourceName} <span className="text-gray-500">Lv{route.level}</span>
        </span>
        {isActive ? (
          <span className={`tabular-nums ${profitColor}`}>
            {profit >= 0 ? '+' : ''}
            {profit.toFixed(1)}
          </span>
        ) : (
          <span className="text-gray-500">
            {t(`detail.merchant.route_status_${route.status}`, { defaultValue: route.status })}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-gray-400">
        <span className={endpointClass(route.sourceStateId)}>{stateName(route.sourceStateId)}</span>
        <span className="text-gray-500">→</span>
        <span className={endpointClass(route.targetStateId)}>{stateName(route.targetStateId)}</span>
        {isActive && (
          <span className="ml-auto text-gray-500">
            {t('detail.merchant.route_quantity', { defaultValue: '量' })}{' '}
            {route.lastQuantity.toFixed(1)}
          </span>
        )}
      </div>
      {showCompany && (
        <div className="mt-0.5 truncate text-[11px] text-gray-500">{companyName}</div>
      )}
    </button>
  )
}
