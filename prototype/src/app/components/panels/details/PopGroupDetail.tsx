import type { PopGroup, PopType } from '@/sim/types/popGroup'
import { getPopStratum } from '@/sim/types/popGroup'
import type { NeedCategory, NeedTier } from '@sim/types/needCategory'
import { NEED_CATEGORIES, NEED_CATEGORY_TIER } from '@sim/types/needCategory'
import { clamp100 } from '@sim/utils/math'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getHoldingShortName } from '@/app/hooks/entityNameHelpers'
import { CopyJsonButton, AttitudeList, DetailSection } from './shared/widgets'
import { getPopGroupMonthlyPopChange } from '@sim/selectors/popSelectors'
import { classifyMobilityKind } from '@sim/config/popMobilityDefinitions'
import { formatPopCount, formatPopFlow, formatPopDelta } from '@/app/utils/format'

import { isEmployed } from '@sim/types/workplaceRef'
import type { WorkplaceRef } from '@sim/types/workplaceRef'
import type { TFunction } from 'i18next'

export function PopGroupDetail({
  popGroup,
  session,
  onPolityClick,
  onHouseClick,
  onPersonClick,
  onProvinceClick,
  onRealEstateClick,
  onHoldingClick,
}: {
  popGroup: PopGroup
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
  onProvinceClick: (id: string) => void
  onRealEstateClick?: (id: string) => void
  onHoldingClick?: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const currentState = session?.currentState
  const holding = currentState?.holdings[popGroup.holdingId]

  const worldState: WorldState | null = currentState ?? null

  const classLabel = `${t(`detail.province.pop_type.${popGroup.popType}`, {
    defaultValue: popGroup.popType,
  })} (${t(`detail.province.${popGroup.class}`, { defaultValue: popGroup.class })})`

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">{classLabel}</span>
        <span className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300">
          {popGroup.employerId !== null
            ? t(`detail.province.pop_employer_${popGroup.employerId.kind}`, {
                defaultValue: t('detail.province.pop_employed'),
              })
            : t('detail.province.pop_unemployed')}
        </span>
        <CopyJsonButton payload={buildEntitySnapshot('popGroup', popGroup, worldState)} />
      </div>
      <div className="text-sm text-gray-400">
        of{' '}
        <button
          className="cursor-pointer text-blue-400 hover:text-blue-300"
          onClick={() => {
            const holdingId = popGroup.holdingId
            const holding = worldState?.holdings[holdingId]
            if (holding) onProvinceClick(holding.provinceId)
          }}
        >
          {holding ? getHoldingShortName(worldState, resolveName, popGroup.holdingId) : '—'}
        </button>
      </div>

      {popGroup.employerId && currentState && (
        <EmployerInfo
          employerId={popGroup.employerId}
          state={currentState}
          t={t}
          {...(onRealEstateClick ? { onRealEstateClick } : {})}
          {...(onHoldingClick ? { onHoldingClick } : {})}
        />
      )}

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.size')}:</span>
          <span>{formatPopCount(popGroup.size)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.money')}:</span>
          <span>{popGroup.money.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.need_satisfaction')}:</span>
          <span>{popGroup.needSatisfaction.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.unrest')}:</span>
          <span className={popGroup.unrest > 60 ? 'text-red-400' : 'text-gray-200'}>
            {popGroup.unrest.toFixed(1)}
          </span>
        </div>
      </div>

      {/* v0.59: 需要充足率の内訳 (必需品/日用品/贅沢品 × カテゴリ)。直近経済 tick のキャッシュ。
          desire を持つカテゴリのみ表示。食料不足を POP 側から確認するためのビュー。 */}
      {(() => {
        const sat = popGroup.categorySatisfaction
        if (!sat) return null
        const tierOrder: NeedTier[] = ['essential', 'ordinary', 'luxury']
        const byTier = new Map<NeedTier, NeedCategory[]>()
        for (const cat of NEED_CATEGORIES) {
          if (sat[cat] === undefined) continue
          const tier = NEED_CATEGORY_TIER[cat]
          const arr = byTier.get(tier) ?? []
          arr.push(cat)
          byTier.set(tier, arr)
        }
        const tiersToShow = tierOrder.filter((tr) => (byTier.get(tr)?.length ?? 0) > 0)
        if (tiersToShow.length === 0) return null
        const barColor = (pct: number) =>
          pct < 40 ? 'bg-red-600' : pct < 70 ? 'bg-amber-500' : 'bg-emerald-600'
        return (
          <div className="text-sm">
            <DetailSection title={t('detail.popNeed.section_title')} />
            <div className="mt-1 flex flex-col gap-2 text-xs">
              {tiersToShow.map((tier) => (
                <div key={tier} className="flex flex-col gap-0.5">
                  <span className="font-medium text-gray-400">
                    {t(`detail.popNeed.tier_${tier}`)}
                  </span>
                  {(byTier.get(tier) ?? []).map((cat) => {
                    const pct = clamp100(sat[cat] ?? 0)
                    return (
                      <div key={cat} className="flex items-center gap-1.5 pl-2">
                        <span className="w-20 shrink-0 text-gray-500">
                          {t(`detail.popNeed.category_${cat}`)}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-700">
                          <div className={`h-full ${barColor(pct)}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-8 text-right text-gray-400">{pct.toFixed(0)}%</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* v0.59: 先月からの人口変動 (自然増減 + 移住の小計)。転職・雇用変動は下の階層移動セクションに集約。 */}
      {currentState &&
        (() => {
          const change = getPopGroupMonthlyPopChange(currentState, popGroup)
          if (!change) return null
          const netTone =
            change.net > 0 ? 'text-emerald-400' : change.net < 0 ? 'text-rose-400' : 'text-gray-300'
          const naturalTone =
            change.natural > 0
              ? 'text-emerald-400'
              : change.natural < 0
                ? 'text-rose-400'
                : 'text-gray-300'
          return (
            <div className="text-sm">
              <DetailSection title={t('detail.popChange.section_title')} />
              <div className="mt-1 flex flex-col gap-1 text-xs">
                <div className="flex justify-between font-medium">
                  <span className="text-gray-300">{t('detail.popChange.net')}</span>
                  <span className={netTone}>{formatPopDelta(change.net)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span className="ml-2">{t('detail.popChange.natural')}</span>
                  <span className={naturalTone}>{formatPopDelta(change.natural)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span className="ml-2">{t('detail.popChange.migration')}</span>
                  <span>
                    <span className="text-emerald-400">+{formatPopFlow(change.migrationIn)}</span>
                    <span className="text-gray-500"> / </span>
                    <span className="text-amber-400">−{formatPopFlow(change.migrationOut)}</span>
                  </span>
                </div>
                <div className="text-gray-500">{t('detail.popChange.pop_subtotal_note')}</div>
              </div>
            </div>
          )
        })()}

      {/* v0.56: 階層移動・転職 (先月)。この POP への転入 (昇格/降格/転職で来た) と転出を相手職種別に集計。 */}
      {currentState?.monthlyPopMobility &&
        (() => {
          const inflow = new Map<PopType, number>() // key: 転入元 popType
          const outflow = new Map<PopType, number>() // key: 転出先 popType
          for (const m of currentState.monthlyPopMobility.topMovements) {
            if (m.kind !== 'job_change') continue
            if ((m.sourceHoldingId as string) !== (popGroup.holdingId as string)) continue
            if (m.toPopType === popGroup.popType && m.toEmployed === isEmployed(popGroup)) {
              inflow.set(m.fromPopType, (inflow.get(m.fromPopType) ?? 0) + m.amount)
            }
            if (m.fromPopType === popGroup.popType && m.fromEmployed === isEmployed(popGroup)) {
              outflow.set(m.toPopType, (outflow.get(m.toPopType) ?? 0) + m.amount)
            }
          }
          const inRows = [...inflow.entries()].sort((a, b) => b[1] - a[1])
          const outRows = [...outflow.entries()].sort((a, b) => b[1] - a[1])
          const isEmpty = inRows.length === 0 && outRows.length === 0
          const row = (counterpart: PopType, amount: number, dir: 'in' | 'out') => {
            const kind =
              dir === 'in'
                ? classifyMobilityKind(counterpart, popGroup.popType)
                : classifyMobilityKind(popGroup.popType, counterpart)
            const tone =
              kind === 'promotion'
                ? 'text-emerald-400'
                : kind === 'demotion'
                  ? 'text-rose-400'
                  : 'text-sky-400'
            return (
              <div
                key={`${dir}-${counterpart}`}
                className="flex justify-between rounded bg-gray-700 p-1.5"
              >
                <span>
                  <span className="text-gray-400">
                    {t(
                      dir === 'in'
                        ? 'detail.popMobility.pop_inflow'
                        : 'detail.popMobility.pop_outflow',
                    )}
                  </span>{' '}
                  <span className={tone}>{t(`detail.popMobility.kind_${kind}`)}</span>{' '}
                  {t(`detail.province.pop_type.${counterpart}`, { defaultValue: counterpart })}
                  <span className="text-gray-500">
                    {' '}
                    ({t(`detail.province.${getPopStratum(counterpart)}`)})
                  </span>
                </span>
                <span className={dir === 'in' ? 'text-emerald-400' : 'text-amber-400'}>
                  {dir === 'in' ? '+' : '−'}
                  {formatPopFlow(amount)}
                </span>
              </div>
            )
          }
          return (
            <div className="text-sm">
              <DetailSection
                title={t('detail.popMobility.pop_section_title')}
                count={inRows.length + outRows.length}
              />
              {isEmpty ? (
                <div className="mt-1 text-xs text-gray-500">{t('detail.popMobility.none')}</div>
              ) : (
                <div className="mt-1 flex flex-col gap-1 text-xs text-gray-300">
                  {inRows.map(([pt, amt]) => row(pt, amt, 'in'))}
                  {outRows.map(([pt, amt]) => row(pt, amt, 'out'))}
                </div>
              )}
            </div>
          )
        })()}

      <div className="text-sm font-semibold text-gray-300">{t('detail.person.attitudes')}:</div>
      <AttitudeList
        attitudes={popGroup.attitudes}
        worldState={worldState}
        onPolityClick={onPolityClick}
        onHouseClick={onHouseClick}
        onPersonClick={onPersonClick}
      />
    </div>
  )
}

function EmployerInfo({
  employerId,
  state,
  t,
  onRealEstateClick,
  onHoldingClick,
}: {
  employerId: WorkplaceRef
  state: WorldState
  t: TFunction
  onRealEstateClick?: (id: string) => void
  onHoldingClick?: (id: string) => void
}) {
  let kindLabel = ''
  let name = ''
  let clickId: string | undefined
  let clickHandler: ((id: string) => void) | undefined
  switch (employerId.kind) {
    case 'asset': {
      const asset = state.realEstateAssets[employerId.id]
      kindLabel = t('detail.province.pop_employer_asset')
      name = asset
        ? `${t(`detail.realEstate.kind_${asset.realEstateKind}`, { defaultValue: asset.realEstateKind })} Lv.${asset.level}`
        : String(employerId.id)
      if (onRealEstateClick) {
        clickId = employerId.id
        clickHandler = onRealEstateClick
      }
      break
    }
    case 'improvement': {
      const imp = state.holdingImprovements[employerId.id]
      kindLabel = t('detail.province.pop_employer_improvement')
      name = imp
        ? `${t(`detail.holding.improvement_${imp.kind}`, { defaultValue: imp.kind })} Lv.${imp.level}`
        : String(employerId.id)
      if (imp && onHoldingClick) {
        clickId = imp.holdingId
        clickHandler = onHoldingClick
      }
      break
    }
    case 'merchant': {
      const est = state.merchantCompanyEstablishments[employerId.id]
      kindLabel = t('detail.province.pop_employer_merchant')
      if (est) {
        const company = state.merchantCompanies[est.companyId]
        name = company?.nameKey
          ? `${t(`detail.merchant.kind_${est.kind}`, { defaultValue: est.kind })}`
          : String(employerId.id)
      } else {
        name = String(employerId.id)
      }
      break
    }
    case 'barracks': {
      const barracks = state.regimentBarracks[employerId.id]
      kindLabel = t('detail.province.pop_employer_barracks')
      name = barracks ? String(barracks.regimentId) : String(employerId.id)
      break
    }
  }
  return (
    <div className="rounded bg-gray-800/60 px-2 py-1 text-xs">
      <span className="text-gray-400">{kindLabel}:</span>{' '}
      {clickId && clickHandler ? (
        <button
          className="cursor-pointer text-blue-400 hover:text-blue-300"
          onClick={() => clickHandler(clickId)}
        >
          {name}
        </button>
      ) : (
        <span className="text-gray-200">{name}</span>
      )}
    </div>
  )
}
