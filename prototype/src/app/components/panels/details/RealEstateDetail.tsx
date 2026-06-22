import type { RealEstateAsset } from '@/sim/types/realEstateAsset'
import type { SimulationSession } from '@/sim/types/world'
import type { ProductionRecipeId } from '@/sim/types/ids'
import { useTranslation } from 'react-i18next'
import { PanelHeader, DetailSection, FulfillmentBar } from './shared/widgets'
import { PersonLink, HouseLink, PolityLink } from './shared/links'
import type { ClickHandler } from './shared/helpers'
import { REAL_ESTATE_DEFINITIONS } from '@sim/config/realEstateDefinitions'
import { getHoldingShortName } from '@/app/hooks/entityNameHelpers'
import { useEntityName } from '@/app/hooks/useEntityName'
import { defaultConfig } from '@sim/config/defaultConfig'
import {
  getActiveSeizureForAsset,
  getSeizurePrescriptionRemainingYears,
} from '@sim/selectors/realEstateSeizureSelectors'
import { getHoldingEmployedPopSize, getHoldingClassCapacity } from '@sim/selectors/popSelectors'
import { formatAmount, formatPopCount } from '@/app/utils/format'
import { RESOURCE_PRICE_DEFINITIONS } from '@sim/config/resourceEconomyDefinitions'
import { marketResourcePriceKey } from '@sim/types/resourceEconomy'
import type { ResourceKind } from '@sim/types/resource'

// レシピ構成 ■ 積み上げバーの色パレット (recipe 出現順で固定割当・index cycle)。farm=10 / workshop=8 が最多。
const RECIPE_COLORS = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-lime-500',
  'bg-indigo-500',
]

// 資源量の簡易フォーマット。小さい値 (<10) は小数1桁、それ以上は整数。
const fmtQty = (n: number): string => (n >= 10 ? n.toFixed(0) : n.toFixed(1))

// 資源の現在市場価格を chip に併記する。基準価格比 ±5% 超で色付け:
//   input は高値=不利(赤)/安値=有利(緑)、output は高値=有利(緑)/安値=不利(赤)。これでレシピの黒字/赤字理由が読める。
function ResourcePrice({
  info,
  role,
}: {
  info: { price: number; base: number } | null
  role: 'input' | 'output'
}) {
  if (!info || info.base <= 0) return null
  const dev = info.price / info.base - 1
  const favorable = role === 'output' ? dev : -dev // 価格が自分に有利な方向か
  const tone =
    Math.abs(dev) < 0.05 ? 'text-gray-500' : favorable > 0 ? 'text-emerald-400' : 'text-rose-400'
  const arrow = Math.abs(dev) < 0.05 ? '' : dev > 0 ? '▲' : '▼'
  return (
    <span className={`ml-0.5 ${tone}`}>
      @{info.price.toFixed(1)}
      {arrow}
    </span>
  )
}

// v0.55 不動産詳細パネル。HoldingDetail のカードは要約のみとし、レシピ構成・雇用枠・産出/収支の
//   詳細はこちらに集約する (カードクリックで開く)。
export function RealEstateDetail({
  asset,
  session,
  onHouseClick,
  onPersonClick,
  onPolityClick,
  onHoldingClick,
}: {
  asset: RealEstateAsset
  session: SimulationSession | null
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
  onPolityClick: ClickHandler
  onHoldingClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const currentState = session?.currentState ?? null
  const def = REAL_ESTATE_DEFINITIONS[asset.realEstateKind]

  const kindName = t(`detail.realEstate.kind_${asset.realEstateKind}`, {
    defaultValue: asset.realEstateKind,
  })

  // レシピ構成: recipeSlots の値合計を分母に割合化。count 降順・同点は recipeId 昇順で決定論的。
  const recipeEntries = (
    Object.entries(asset.recipeSlots) as [ProductionRecipeId, number | undefined][]
  )
    .filter((e): e is [ProductionRecipeId, number] => (e[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const totalSlots = recipeEntries.reduce((sum, [, n]) => sum + n, 0)

  // per-asset の雇用枠 (capacityPerLevel × level)。employedSize は holding 単位でしか取れないため、
  //   単一 asset では誤読を避けて capacity (枠) のみを表示する。
  //   雇用充足率は holding 単位 (employed / effectiveCapacity)。POP は holding 帰属で asset へは枠比按分の
  //   ため、同 holding 内の各 asset で同一値になる (holding-level の充足率 proxy)。
  const capacitySlots = def.employmentSlots.map((slot) => {
    let fill: number | null = null
    if (currentState) {
      const employed = getHoldingEmployedPopSize(currentState, asset.holdingId, slot.stratum)
      const cap = getHoldingClassCapacity(
        currentState,
        defaultConfig,
        asset.holdingId,
        slot.stratum,
      )
      fill = cap > 0 ? employed / cap : null
    }
    return {
      stratum: slot.stratum,
      capacity: slot.capacityPerLevel * asset.level,
      fill,
    }
  })

  // per-asset の月次産出・収支 (snapshot がある場合)。
  const revenueSnapshot = currentState?.monthlyHoldingResourceRevenue[asset.holdingId]
  const assetResult = revenueSnapshot?.assetResults.find((ar) => ar.assetId === asset.id)
  // v0.56: recipe 別内訳 (産出のあるもののみ・純益降順、同点は recipeId)。
  const recipeBreakdown = (assetResult?.recipeBreakdown ?? [])
    .filter((b) => Object.values(b.outputs).some((v) => (v ?? 0) > 0) || b.grossRevenue > 0)
    .sort((a, b) => b.netRevenue - a.netRevenue || (a.recipeId < b.recipeId ? -1 : 1))

  // 資源の市場価格 (holding → province.stateId が StateRegion 市場)。基準価格比でレシピの黒字/赤字理由を示す。
  const holding = currentState?.holdings[asset.holdingId]
  const province = holding ? currentState?.provinces[holding.provinceId] : undefined
  const stateId = province?.stateId
  const priceOf = (res: string): { price: number; base: number } | null => {
    if (!currentState || !stateId) return null
    const ps =
      currentState.marketResourcePrices[marketResourcePriceKey(stateId, res as ResourceKind)]
    const base = RESOURCE_PRICE_DEFINITIONS[res as ResourceKind]?.basePrice
    if (!ps || base === undefined) return null
    return { price: ps.lastPrice, base }
  }

  const seizure = currentState ? getActiveSeizureForAsset(currentState, asset.id) : null

  return (
    <div className="flex flex-col gap-1 p-3">
      <PanelHeader title={`${kindName} Lv.${asset.level}`} />

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.realEstate.owner')}:</span>
          {asset.owner ? (
            asset.owner.kind === 'house' && currentState ? (
              <HouseLink
                houseId={asset.owner.id}
                houses={currentState.houses}
                onClick={onHouseClick}
              />
            ) : asset.owner.kind === 'person' && currentState ? (
              <PersonLink
                personId={asset.owner.id}
                persons={currentState.persons}
                onClick={onPersonClick}
              />
            ) : asset.owner.kind === 'polity' && currentState ? (
              <PolityLink polityId={asset.owner.id} world={currentState} onClick={onPolityClick} />
            ) : (
              <span className="text-gray-500">{t('detail.realEstate.unowned')}</span>
            )
          ) : (
            <span className="text-gray-500">{t('detail.realEstate.unowned')}</span>
          )}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.realEstate.location')}:</span>
          <button
            className="cursor-pointer text-blue-400 hover:text-blue-300"
            onClick={() => onHoldingClick(asset.holdingId)}
          >
            {currentState ? getHoldingShortName(currentState, resolveName, asset.holdingId) : '—'}
          </button>
        </div>
      </div>

      {seizure && currentState && (
        <div className="mt-0.5 rounded border border-amber-700/50 bg-amber-950/30 px-1.5 py-1 text-xs text-amber-300">
          <div className="font-medium">
            ⚠ {t('detail.realEstate.seized')}
            {' — '}
            {t('detail.realEstate.prescriptionRemaining', {
              years: Math.floor(
                getSeizurePrescriptionRemainingYears(currentState, defaultConfig, seizure),
              ),
            })}
          </div>
          <div className="mt-0.5 flex justify-between">
            <span className="text-amber-400/70">
              {t('detail.obligation.seized_by', { defaultValue: '押領者' })}:
            </span>
            <PolityLink
              polityId={seizure.seizerPolityId}
              world={currentState}
              onClick={onPolityClick}
            />
          </div>
        </div>
      )}

      <DetailSection
        title={t('detail.realEstate.recipe_composition')}
        count={recipeEntries.length}
      />
      {recipeEntries.length === 0 ? (
        <div className="text-xs text-gray-500 italic">{t('detail.realEstate.no_recipe')}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {/* slot を ■ で積み上げた構成バー (slotCount は ~20 で level 非依存)。色は recipe 順で固定割当。 */}
          <div className="flex flex-wrap gap-0.5">
            {recipeEntries.flatMap(([recipeId, slots], i) =>
              Array.from({ length: slots }, (_, j) => (
                <span
                  key={`${recipeId}-${j}`}
                  className={`inline-block h-3 w-3 rounded-sm ${RECIPE_COLORS[i % RECIPE_COLORS.length]}`}
                />
              )),
            )}
          </div>
          {/* 凡例: 色 + レシピ名 + slot 数 (割合) */}
          <div className="flex flex-col gap-0.5">
            {recipeEntries.map(([recipeId, slots], i) => {
              const pct = totalSlots > 0 ? (slots / totalSlots) * 100 : 0
              return (
                <div key={recipeId} className="flex items-center gap-1.5 text-xs">
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${RECIPE_COLORS[i % RECIPE_COLORS.length]}`}
                  />
                  <span className="flex-1 text-gray-300">
                    {t(`detail.realEstate.recipe.${recipeId}`, { defaultValue: recipeId })}
                  </span>
                  <span className="shrink-0 text-right text-gray-400">
                    {slots} ({pct.toFixed(0)}%)
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <DetailSection
        title={t('detail.realEstate.employment_capacity')}
        count={capacitySlots.length}
      />
      <div className="flex flex-col gap-1 text-xs">
        {capacitySlots.map((slot) => {
          const fillPct = slot.fill !== null ? Math.min(100, slot.fill * 100) : null
          const barColor =
            slot.fill === null
              ? 'bg-gray-500'
              : slot.fill >= 0.8
                ? 'bg-emerald-500'
                : slot.fill >= 0.4
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
          return (
            <div key={slot.stratum} className="flex flex-col gap-0.5">
              <div className="flex justify-between">
                <span className="text-gray-400">{t(`detail.province.${slot.stratum}`)}:</span>
                <span className="text-gray-300">
                  {formatPopCount(slot.capacity)}
                  {slot.fill !== null && (
                    <span className="ml-1 text-gray-500">
                      ({t('detail.realEstate.employment_fulfillment')}{' '}
                      {(slot.fill * 100).toFixed(0)}
                      %)
                    </span>
                  )}
                </span>
              </div>
              {fillPct !== null && (
                <div className="h-1.5 overflow-hidden rounded bg-gray-600">
                  <div className={`h-full ${barColor}`} style={{ width: `${fillPct}%` }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {assetResult && (
        <>
          {/* v0.56 レシピ別: 原材料(数量) → ⚙ → 産出(数量) + レシピ毎の売上・原価・純益。 */}
          <DetailSection
            title={t('detail.realEstate.recipe_production')}
            count={recipeBreakdown.length}
          />
          {recipeBreakdown.length === 0 ? (
            <div className="text-xs text-gray-500 italic">
              {t('detail.realEstate.no_production')}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 text-xs">
              {recipeBreakdown.map((b) => {
                const inRows = Object.entries(b.inputs).filter(
                  (e): e is [string, number] => e[1] !== undefined && e[1] > 0,
                )
                const outRows = Object.entries(b.outputs).filter(
                  (e): e is [string, number] => e[1] !== undefined && e[1] > 0,
                )
                return (
                  <div
                    key={b.recipeId}
                    className="flex flex-col gap-1 rounded bg-gray-800/40 p-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-gray-200">
                        {t(`detail.realEstate.recipe.${b.recipeId}`, { defaultValue: b.recipeId })}
                      </span>
                      <span className={b.netRevenue >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {formatAmount(b.netRevenue)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      {inRows.map(([res, amount]) => (
                        <span key={`in-${res}`} className="text-amber-300">
                          {t(`detail.realEstate.resource_${res}`, { defaultValue: res })}
                          <span className="text-amber-400/60"> {fmtQty(amount)}</span>
                          <ResourcePrice info={priceOf(res)} role="input" />
                        </span>
                      ))}
                      {inRows.length > 0 && <span className="text-gray-500">→</span>}
                      <span title={t('detail.realEstate.processing')}>⚙</span>
                      <span className="text-gray-500">→</span>
                      {outRows.map(([res, amount]) => (
                        <span key={`out-${res}`} className="text-emerald-300">
                          {t(`detail.realEstate.resource_${res}`, { defaultValue: res })}
                          <span className="text-emerald-400/60"> {fmtQty(amount)}</span>
                          <ResourcePrice info={priceOf(res)} role="output" />
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-3 text-[10px] text-gray-500">
                      <span>
                        {t('detail.realEstate.gross_revenue')}: {formatAmount(b.grossRevenue)}
                      </span>
                      {b.inputCost > 0 && (
                        <span>
                          {t('detail.realEstate.input_cost')}: {formatAmount(b.inputCost)}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <DetailSection title={t('detail.realEstate.facility_total')} />
          <div className="flex flex-col gap-0.5 border-t border-gray-600/50 pt-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">{t('detail.realEstate.gross_revenue')}:</span>
              <span className="text-gray-300">{formatAmount(assetResult.grossRevenue)}</span>
            </div>
            {assetResult.inputCost > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">{t('detail.realEstate.input_cost')}:</span>
                <span className="text-rose-400">-{formatAmount(assetResult.inputCost)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">{t('detail.realEstate.net_revenue')}:</span>
              <span className={assetResult.netRevenue >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {formatAmount(assetResult.netRevenue)}
              </span>
            </div>
          </div>
          <div className="mt-1 flex flex-col gap-1 border-t border-gray-600/50 pt-1 text-xs">
            <FulfillmentBar
              label={t('detail.realEstate.input_fulfillment')}
              value={assetResult.inputFulfillment}
            />
            <FulfillmentBar
              label={t('detail.realEstate.labor_type_fulfillment')}
              value={assetResult.laborTypeFulfillment}
            />
          </div>
        </>
      )}
    </div>
  )
}
