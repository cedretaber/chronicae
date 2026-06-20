import type { SimulationSession } from '@/sim/types/world'
import type { StateRegion } from '@/sim/types/stateRegion'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { PanelHeader, DetailSection } from './shared/widgets'
import { RESOURCE_KINDS } from '@sim/types/resource'
import { RESOURCE_PRICE_DEFINITIONS } from '@sim/config/resourceEconomyDefinitions'
import { marketResourcePriceKey } from '@sim/types/resourceEconomy'
import { formatAmount } from '@/app/utils/format'

// v0.54 市場詳細パネル: StateRegion ごとの資源市場 (food / raw_materials / processed_goods)。
//   各資源について「基本価格」「現在価格」「基本価格からの乖離 (高い/安い)」を表示する。
//   価格は ResourceEconomySystem が月次で更新するため、初回 tick 前や未取引の市場はデータ無し表示。
export function MarketDetail({
  stateRegion,
  session,
}: {
  stateRegion: StateRegion
  session: SimulationSession | null
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const currentState = session?.currentState
  const regionName = resolveName('state_region', stateRegion.nameKey, stateRegion.nameKey)

  return (
    <div className="flex flex-col gap-1 p-3">
      <PanelHeader title={regionName} />
      <div className="text-sm text-gray-400">
        {t('detail.market.province_count', { count: stateRegion.provinceIds.length })}
      </div>

      <DetailSection title={t('detail.market.prices')} count={RESOURCE_KINDS.length} />
      <div className="mt-1 flex flex-col gap-1.5">
        {RESOURCE_KINDS.map((resource) => {
          const def = RESOURCE_PRICE_DEFINITIONS[resource]
          const ps =
            currentState?.marketResourcePrices[marketResourcePriceKey(stateRegion.id, resource)]
          const resourceName = t(`detail.realEstate.resource_${resource}`, {
            defaultValue: resource,
          })

          if (!ps) {
            // まだ市場が成立していない (初回 tick 前 / 未取引)。
            return (
              <div key={resource} className="rounded bg-gray-700 p-1.5 text-xs">
                <div className="font-medium text-gray-200">{resourceName}</div>
                <div className="mt-0.5 flex justify-between">
                  <span className="text-gray-400">{t('detail.market.base_price')}:</span>
                  <span className="text-gray-300">{def.basePrice.toFixed(2)}</span>
                </div>
                <div className="mt-0.5 text-gray-500 italic">{t('detail.market.no_data')}</div>
              </div>
            )
          }

          // 乖離率 (現在価格 / 基本価格 - 1)。正 = 基本より高い、負 = 安い。
          const deviation = ps.lastPrice / def.basePrice - 1
          const deviationPct = deviation * 100
          const deviationColor =
            Math.abs(deviationPct) < 0.5
              ? 'text-gray-400'
              : deviation > 0
                ? 'text-amber-400'
                : 'text-sky-400'
          const last = ps.history[ps.history.length - 1]

          return (
            <div key={resource} className="rounded bg-gray-700 p-1.5 text-xs">
              <div className="flex items-baseline justify-between">
                <span className="font-medium text-gray-200">{resourceName}</span>
                <span className={`font-medium ${deviationColor}`}>
                  {deviationPct >= 0 ? '+' : ''}
                  {deviationPct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-0.5 flex justify-between">
                <span className="text-gray-400">{t('detail.market.base_price')}:</span>
                <span className="text-gray-300">{def.basePrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.market.current_price')}:</span>
                <span className={deviationColor}>{ps.lastPrice.toFixed(2)}</span>
              </div>
              {last && (
                <div className="mt-0.5 flex justify-between border-t border-gray-600/50 pt-0.5 text-[11px] text-gray-500">
                  <span>
                    {t('detail.market.supply')}: {formatAmount(last.sellOrders)}
                  </span>
                  <span>
                    {t('detail.market.demand')}: {formatAmount(last.buyOrders)}
                  </span>
                  <span>
                    {t('detail.market.sold')}: {formatAmount(last.fulfillmentRatio)}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
