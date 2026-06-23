import type { PopGroup, PopType } from '@/sim/types/popGroup'
import { getPopStratum } from '@/sim/types/popGroup'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getHoldingShortName } from '@/app/hooks/entityNameHelpers'
import { CopyJsonButton, AttitudeList, DetailSection } from './shared/widgets'
import { getHoldingClassCapacity, getPopGroupMonthlyPopChange } from '@sim/selectors/popSelectors'
import { classifyMobilityKind } from '@sim/config/popMobilityDefinitions'
import { formatPopCount, formatPopFlow, formatPopDelta } from '@/app/utils/format'
import { defaultConfig } from '@sim/config/defaultConfig'

export function PopGroupDetail({
  popGroup,
  session,
  onPolityClick,
  onHouseClick,
  onPersonClick,
  onProvinceClick,
}: {
  popGroup: PopGroup
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
  onProvinceClick: (id: string) => void
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
          {popGroup.employed
            ? t('detail.province.pop_employed')
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

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">ID:</span>
          <span className="text-xs text-gray-500">{popGroup.id}</span>
        </div>
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

      {popGroup.employed && currentState && (
        <div className="text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.province.capacity')}:</span>
            <span>
              {formatPopCount(popGroup.size)} /{' '}
              {formatPopCount(
                getHoldingClassCapacity(
                  currentState,
                  defaultConfig,
                  popGroup.holdingId,
                  popGroup.class,
                ),
              )}
            </span>
          </div>
        </div>
      )}

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
            if (m.toPopType === popGroup.popType && m.toEmployed === popGroup.employed) {
              inflow.set(m.fromPopType, (inflow.get(m.fromPopType) ?? 0) + m.amount)
            }
            if (m.fromPopType === popGroup.popType && m.fromEmployed === popGroup.employed) {
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
