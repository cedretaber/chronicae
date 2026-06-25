import type { TradeRoute } from '@/sim/types/merchant'
import type { SimulationSession } from '@/sim/types/world'
import type { StateRegionId } from '@/sim/types/ids'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { PanelHeader, DetailSection } from './shared/widgets'
import { formatAbsoluteWeek } from '@/app/utils/format'

// ラベル + 右寄せ値の 1 行。render 内でコンポーネントを生成しないよう module 階層に置く。
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="text-right text-gray-300 tabular-nums">{children}</span>
    </div>
  )
}

// v0.61 §22: 交易路の read-only 詳細パネル。所有商会・接続 state（市場リンク）・対象商品・
//   交易量・直近の売買価格・収益を表示する。
export function TradeRouteDetail({
  route,
  session,
  onMerchantCompanyClick,
  onMarketClick,
}: {
  route: TradeRoute
  session: SimulationSession | null
  onMerchantCompanyClick: (id: string) => void
  onMarketClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const state = session?.currentState ?? null

  const stateName = (sid: StateRegionId): string =>
    resolveName('state_region', state?.states[sid]?.nameKey, sid)
  const resourceName = t(`detail.realEstate.resource_${route.resource}`, {
    defaultValue: route.resource,
  })
  const company = state ? state.merchantCompanies[route.companyId] : undefined
  const companyName = company ? resolveName('person', company.nameKey, company.id) : route.companyId

  const statusLabel = t(`detail.merchant.route_status_${route.status}`, {
    defaultValue: route.status,
  })

  const profit = route.smoothedProfit
  const profitColor =
    profit > 0.05 ? 'text-emerald-400' : profit < -0.05 ? 'text-rose-400' : 'text-gray-300'

  return (
    <div className="flex flex-col gap-1 p-3 text-sm">
      <PanelHeader
        title={`${stateName(route.sourceStateId)} → ${stateName(route.targetStateId)}`}
        badge={<span className="text-xs text-gray-400">{statusLabel}</span>}
      />

      <div className="flex flex-col gap-0.5">
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">
            {t('detail.merchant.companies', { defaultValue: '商会' })}
          </span>
          <button
            className="text-right text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onMerchantCompanyClick(route.companyId)}
          >
            {companyName}
          </button>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">
            {t('detail.merchant.route_source', { defaultValue: '産地' })}
          </span>
          <button
            className="text-right text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onMarketClick(route.sourceStateId)}
          >
            {stateName(route.sourceStateId)}
          </button>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">
            {t('detail.merchant.route_target', { defaultValue: '販路' })}
          </span>
          <button
            className="text-right text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onMarketClick(route.targetStateId)}
          >
            {stateName(route.targetStateId)}
          </button>
        </div>
        <InfoRow label={t('detail.merchant.route_resource', { defaultValue: '対象商品' })}>
          {resourceName}
        </InfoRow>
        <InfoRow label={t('detail.merchant.route_level', { defaultValue: '規模' })}>
          Lv{route.level}
        </InfoRow>
      </div>

      <DetailSection title={t('detail.merchant.route_trade', { defaultValue: '交易状況' })} />
      <div className="flex flex-col gap-0.5">
        <InfoRow label={t('detail.merchant.route_planned', { defaultValue: '予定交易量' })}>
          {route.plannedQuantity.toFixed(1)}
        </InfoRow>
        <InfoRow label={t('detail.merchant.route_last_quantity', { defaultValue: '直近交易量' })}>
          {route.lastQuantity.toFixed(1)}
        </InfoRow>
        <InfoRow label={t('detail.merchant.route_buy_price', { defaultValue: '仕入価格' })}>
          {route.lastBuyPrice.toFixed(2)}
        </InfoRow>
        <InfoRow label={t('detail.merchant.route_sell_price', { defaultValue: '販売価格' })}>
          {route.lastSellPrice.toFixed(2)}
        </InfoRow>
        <InfoRow label={t('detail.merchant.route_last_profit', { defaultValue: '直近利益' })}>
          {route.lastProfit.toFixed(1)}
        </InfoRow>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">
            {t('detail.merchant.smoothed_profit', { defaultValue: '平滑利益' })}
          </span>
          <span className={`text-right tabular-nums ${profitColor}`}>
            {profit >= 0 ? '+' : ''}
            {profit.toFixed(1)}
          </span>
        </div>
        <InfoRow label={t('detail.merchant.route_created', { defaultValue: '開設' })}>
          {formatAbsoluteWeek(route.createdWeek)}
        </InfoRow>
      </div>
    </div>
  )
}
