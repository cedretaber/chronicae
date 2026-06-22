import type { Holding } from '@/sim/types/landContract'
import type { HoldingId } from '@/sim/types/ids'
import type { PopType } from '@/sim/types/popGroup'
import { getPopStratum } from '@/sim/types/popGroup'
import type { SimulationSession } from '@/sim/types/world'
import { buildEntitySnapshot, resolveHoldingImprovements } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import {
  getPolityShortName,
  getHoldingQualifiedName,
  getHoldingShortName,
} from '@/app/hooks/entityNameHelpers'
import {
  PanelHeader,
  CopyJsonButton,
  EntityChronicleSection,
  RightHolderLine,
  DetailSection,
  FulfillmentBar,
} from './shared/widgets'
import { getHoldingOfficeAppointmentRight } from '@sim/selectors/politicalRightSelectors'
import { getHoldingImage } from '@/app/utils/assetHash'
import { getHoldingDevelopment } from '@sim/selectors/holdingImprovementSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { clamp100 } from '@sim/utils/math'
import { PersonLink, HouseLink, PolityLink } from './shared/links'
import { getHoldingBailiffPerson } from '@sim/selectors/provinceOfficeSelectors'
import {
  getBailiffPolicy,
  getBailiffLocalExtractionRate,
  getRecentBailiffRevenueTaskStatus,
  getBailiffCollectionEfficiency,
  getBailiffFeeRate,
  computeBailiffBurdenComponents,
} from '@sim/selectors/bailiffSelectors'
import { personAttitudeKey } from '@sim/helpers/attitudeHelpers'
import { getHoldingLandContractChain } from '@sim/selectors/landContractSelectors'
import {
  getActiveSeizureForAsset,
  getSeizurePrescriptionRemainingYears,
} from '@sim/selectors/realEstateSeizureSelectors'
import {
  getActiveDefaultForContract,
  getDefaultPrescriptionRemainingYears,
} from '@sim/selectors/landContractDefaultSelectors'
import { formatAmount, formatPopCount, formatPopFlow } from '@/app/utils/format'
import { WEEKS_PER_YEAR } from '@sim/utils/timeUtils'
import {
  getHoldingEmployedPopSize,
  getHoldingUnemployedPopSize,
  getHoldingClassCapacity,
  getHoldingPops,
} from '@sim/selectors/popSelectors'
import { getChronicleEntriesForHolding } from '@sim/selectors/chronicleSelectors'
import { formatAbsoluteWeek } from '@/app/utils/format'
import { IMPROVEMENT_DEFINITIONS } from '@sim/config/improvementDefinitions'

export function HoldingDetail({
  holding,
  session,
  onPolityClick,
  onPersonClick,
  onHouseClick,
  onProvinceClick,
  onHoldingClick,
  onPopGroupClick,
  onRealEstateClick,
}: {
  holding: Holding
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onPersonClick: (id: string) => void
  onHouseClick: ClickHandler
  onProvinceClick: (id: string) => void
  onHoldingClick: (id: string) => void
  onPopGroupClick: (id: string) => void
  onRealEstateClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const currentState = session?.currentState
  const province = currentState?.provinces[holding.provinceId]

  // v0.41 (§8): Holding 自身の名前 (kind→category) を Province 名で qualify した完全名。
  const holdingDisplay = getHoldingQualifiedName(currentState, resolveName, holding.id)

  return (
    <div className="flex flex-col gap-1 p-3">
      {/* Header: Holding name + kind badge + copy */}
      <PanelHeader
        title={holdingDisplay}
        actions={
          <>
            <CopyJsonButton
              payload={buildEntitySnapshot('holding', holding, currentState ?? null)}
            />
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${holding.kind === 'city' ? 'bg-amber-800 text-amber-200' : 'bg-green-900 text-green-300'}`}
            >
              {holding.kind}
            </span>
          </>
        }
      />

      {/* Header image */}
      <img
        src={getHoldingImage(
          holding.kind,
          currentState ? resolveHoldingImprovements(currentState, holding.id) : [],
        )}
        alt={holdingDisplay}
        className="h-24 w-full rounded object-cover"
        draggable={false}
      />

      {/* Province link */}
      {province && (
        <div className="text-sm text-gray-400">
          <button
            className="cursor-pointer text-blue-400 hover:text-blue-300"
            onClick={() => onProvinceClick(province.id)}
          >
            {resolveName('province', province.nameKey, province.nameKey)}
          </button>
        </div>
      )}

      {/* Basic stats */}
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.dev')}:</span>
          <span>
            {(currentState
              ? getHoldingDevelopment(currentState, defaultConfig, holding.id)
              : 0
            ).toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.control')}:</span>
          <span>{holding.polityControl.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.quality')}:</span>
          <span>{holding.landQuality.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.weight')}:</span>
          <span>{holding.weight.toFixed(1)}</span>
        </div>
      </div>

      {/* RealEstateAssets */}
      {currentState &&
        (() => {
          const assetIds = currentState.realEstateAssetIndex.byHolding[holding.id as string] ?? []
          const assets = assetIds
            .map((id) => currentState.realEstateAssets[id])
            .filter((a): a is NonNullable<typeof a> => a !== undefined)
          const slotCap = defaultConfig.realEstateSlotCapacityBase[holding.kind] ?? 3
          const emptySlots = Math.max(0, slotCap - assets.length)
          if (assets.length === 0 && emptySlots === 0) return null

          // v0.54: 月次資源 snapshot から asset 別 revenue を引く。
          const revenueSnapshot = currentState.monthlyHoldingResourceRevenue[holding.id]
          const assetResultById = new Map(
            (revenueSnapshot?.assetResults ?? []).map((ar) => [ar.assetId as string, ar]),
          )

          return (
            <div className="text-sm">
              <DetailSection title={t('detail.realEstate.title')} count={assets.length} />
              <div className="mt-1 flex justify-between text-xs text-gray-500">
                <span>
                  {t('detail.realEstate.slots')}: {assets.length}/{slotCap}
                </span>
                {revenueSnapshot ? (
                  <span>
                    {t('detail.realEstate.monthly_net', { defaultValue: '月次純益' })}:{' '}
                    <span className="text-emerald-400">
                      {formatAmount(revenueSnapshot.totalNetRevenue)}
                    </span>
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-col gap-1">
                {assets.map((asset) => {
                  // v0.55: カードは要約のみ (種別・所有者・押領・月次純益)。レシピ構成/雇用枠/産出内訳の
                  //   詳細はクリックで開く RealEstateDetail パネルに集約する。
                  const ar = assetResultById.get(asset.id)
                  const seizure = getActiveSeizureForAsset(currentState, asset.id)
                  return (
                    <div
                      key={asset.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onRealEstateClick(asset.id)}
                      className="cursor-pointer rounded bg-gray-700 p-1.5 text-xs hover:bg-gray-600"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="font-medium text-gray-200">
                          {t(`detail.realEstate.kind_${asset.realEstateKind}`, {
                            defaultValue: asset.realEstateKind,
                          })}{' '}
                          <span className="text-gray-500">Lv.{asset.level}</span>
                        </span>
                        <span className="text-gray-500">→</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('detail.realEstate.owner')}:</span>
                        {/* 所有者リンクのクリックがカード遷移を兼ねないよう伝播を止める */}
                        <span onClick={(e) => e.stopPropagation()}>
                          {asset.owner ? (
                            asset.owner.kind === 'house' ? (
                              <HouseLink
                                houseId={asset.owner.id}
                                houses={currentState.houses}
                                onClick={onHouseClick}
                              />
                            ) : asset.owner.kind === 'person' ? (
                              <PersonLink
                                personId={asset.owner.id}
                                persons={currentState.persons}
                                onClick={onPersonClick}
                              />
                            ) : (
                              <PolityLink
                                polityId={asset.owner.id}
                                world={currentState}
                                onClick={onPolityClick}
                              />
                            )
                          ) : (
                            <span className="text-gray-500">{t('detail.realEstate.unowned')}</span>
                          )}
                        </span>
                      </div>
                      {seizure ? (
                        <div className="mt-0.5 rounded border border-amber-700/50 bg-amber-950/30 px-1 py-0.5 text-amber-300">
                          ⚠ {t('detail.realEstate.seized', { defaultValue: '押領中' })}
                          {' — '}
                          {t('detail.realEstate.prescriptionRemaining', {
                            years: Math.floor(
                              getSeizurePrescriptionRemainingYears(
                                currentState,
                                defaultConfig,
                                seizure,
                              ),
                            ),
                          })}
                        </div>
                      ) : null}
                      {ar ? (
                        <div className="mt-1 flex flex-col gap-1 border-t border-gray-600/50 pt-0.5 text-[11px]">
                          <div className="flex justify-between">
                            <span className="text-gray-500">
                              {t('detail.realEstate.net_revenue', { defaultValue: '純益' })}:
                            </span>
                            <span
                              className={ar.netRevenue >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                            >
                              {formatAmount(ar.netRevenue)}
                            </span>
                          </div>
                          {/* その不動産全体の充足率 (asset 単位・slotCount 加重)。一覧で供給/労働の詰まりを把握する。 */}
                          <FulfillmentBar
                            label={t('detail.realEstate.input_fulfillment')}
                            value={ar.inputFulfillment}
                            compact
                          />
                          <FulfillmentBar
                            label={t('detail.realEstate.labor_type_fulfillment')}
                            value={ar.laborTypeFulfillment}
                            compact
                          />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {Array.from({ length: emptySlots }, (_, i) => (
                  <div
                    key={`empty-${String(i)}`}
                    className="flex items-center justify-center rounded border border-dashed border-gray-600 p-2 text-xs text-gray-500"
                  >
                    {t('detail.realEstate.empty_slot')}
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

      {/* v0.56: 移住 (先月)。相手 Holding 別に流入元・流出先を集計。job_change は POP 詳細に集約。 */}
      {currentState?.monthlyPopMobility
        ? (() => {
            // 相手 holding × popType 単位で集計（移住は class/popType を保持する）。
            type MigrationFlow = { counterpartId: string; popType: PopType; amount: number }
            const accumulate = (
              map: Map<string, MigrationFlow>,
              counterpartId: string,
              popType: PopType,
              amount: number,
            ) => {
              const key = `${counterpartId} ${popType}`
              const existing = map.get(key)
              if (existing) existing.amount += amount
              else map.set(key, { counterpartId, popType, amount })
            }
            const inflow = new Map<string, MigrationFlow>()
            const outflow = new Map<string, MigrationFlow>()
            for (const m of currentState.monthlyPopMobility.topMovements) {
              if (m.kind !== 'migration' || !m.targetHoldingId) continue
              if ((m.targetHoldingId as string) === (holding.id as string)) {
                accumulate(inflow, m.sourceHoldingId, m.fromPopType, m.amount)
              } else if ((m.sourceHoldingId as string) === (holding.id as string)) {
                accumulate(outflow, m.targetHoldingId, m.toPopType, m.amount)
              }
            }
            const inRows = [...inflow.values()].sort((a, b) => b.amount - a.amount)
            const outRows = [...outflow.values()].sort((a, b) => b.amount - a.amount)
            const isEmpty = inRows.length === 0 && outRows.length === 0
            const counterpartRow = (flow: MigrationFlow, dir: 'in' | 'out') => {
              const tone = dir === 'in' ? 'text-emerald-400' : 'text-amber-400'
              return (
                <div
                  key={`${dir}-${flow.counterpartId}-${flow.popType}`}
                  className="flex justify-between rounded bg-gray-700 p-1.5"
                >
                  <span>
                    <span className={tone}>
                      {t(
                        dir === 'in'
                          ? 'detail.popMobility.migration_in_from'
                          : 'detail.popMobility.migration_out_to',
                      )}
                    </span>{' '}
                    <button
                      className="cursor-pointer text-blue-400 hover:text-blue-300"
                      onClick={() => onHoldingClick(flow.counterpartId)}
                    >
                      {getHoldingShortName(
                        currentState,
                        resolveName,
                        flow.counterpartId as HoldingId,
                      )}
                    </button>{' '}
                    <span className="text-gray-400">
                      {t(`detail.province.pop_type.${flow.popType}`, {
                        defaultValue: flow.popType,
                      })}
                    </span>
                    <span className="text-gray-500">
                      {' '}
                      ({t(`detail.province.${getPopStratum(flow.popType)}`)})
                    </span>
                  </span>
                  <span className={tone}>
                    {dir === 'in' ? '+' : '−'}
                    {formatPopFlow(flow.amount)}
                  </span>
                </div>
              )
            }
            return (
              <div className="text-sm">
                <DetailSection
                  title={t('detail.popMobility.migration_section_title')}
                  count={inRows.length + outRows.length}
                />
                {isEmpty ? (
                  <div className="mt-1 text-xs text-gray-500">{t('detail.popMobility.none')}</div>
                ) : (
                  <div className="mt-1 flex flex-col gap-1 text-xs text-gray-300">
                    {inRows.map((flow) => counterpartRow(flow, 'in'))}
                    {outRows.map((flow) => counterpartRow(flow, 'out'))}
                  </div>
                )}
              </div>
            )
          })()
        : null}

      {/* Infrastructure */}
      {currentState &&
        (() => {
          const impIds = currentState.holdingImprovementIndex.byHolding[holding.id as string] ?? []
          const improvements = impIds
            .map((id) => currentState.holdingImprovements[id])
            .filter((imp): imp is NonNullable<typeof imp> => imp !== undefined)
          if (improvements.length === 0) return null
          return (
            <div className="text-sm">
              <DetailSection title={t('detail.province.improvements')} />
              {improvements.map((imp) => {
                const nameKey = `detail.province.improvement_name_${imp.kind}_${holding.kind}_${imp.level}`
                // v0.33 §12.3: flavor → category → kind 文字列 のフォールバック（生キーを出さない）
                const categoryName = t(`detail.province.improvement_${imp.kind}`, {
                  defaultValue: imp.kind,
                })
                const flavorName = t(nameKey, { defaultValue: categoryName })
                // v0.48.1 §8: condition バー + 機能不全バッジ (閾値割れ)
                const threshold = defaultConfig.facilityDisrepairThreshold
                const condition = clamp100(imp.condition)
                const disrepaired = condition < threshold
                const impDef = IMPROVEMENT_DEFINITIONS[imp.kind]
                return (
                  <div key={imp.id} className="ml-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-gray-200">
                        {flavorName}
                        {disrepaired && (
                          <span className="ml-1 rounded bg-red-900 px-1 py-0.5 text-xs text-red-300">
                            {t('detail.facility.disrepair_badge')}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-gray-500">
                        （{categoryName}{' '}
                        {t('detail.province.improvement_level', { level: imp.level })}）
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-xs text-gray-500">
                        {t('detail.facility.condition')}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-700">
                        <div
                          className={`h-full ${disrepaired ? 'bg-red-600' : 'bg-emerald-600'}`}
                          style={{ width: `${condition}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs text-gray-400">
                        {condition.toFixed(0)}
                      </span>
                    </div>
                    {impDef.employmentSlots &&
                      impDef.employmentSlots.map((slot) => {
                        const empSize = getHoldingEmployedPopSize(
                          currentState,
                          holding.id,
                          slot.stratum,
                        )
                        const cap = getHoldingClassCapacity(
                          currentState,
                          defaultConfig,
                          holding.id,
                          slot.stratum,
                        )
                        const pct = cap > 0 ? clamp100((empSize / cap) * 100) : 0
                        return (
                          <div key={slot.stratum} className="mt-0.5 flex items-center gap-1.5">
                            <span className="text-xs text-gray-500">
                              {t(`detail.province.${slot.stratum}`)}
                            </span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-600">
                              <div
                                className={`h-full ${pct >= 90 ? 'bg-amber-500' : 'bg-emerald-600'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-16 text-right text-xs text-gray-400">
                              {formatPopCount(empSize)}/{formatPopCount(cap)}
                            </span>
                          </div>
                        )
                      })}
                  </div>
                )
              })}
            </div>
          )
        })()}

      {/* Active develop_holding Project */}
      {currentState &&
        (() => {
          const relKey = `holding:${holding.id}`
          const projectIds = currentState.projectIndex.byRelatedEntity[relKey] ?? []
          const activeProject = projectIds
            .map((pid) => currentState.projects[pid])
            .find(
              (p): p is NonNullable<typeof p> =>
                p !== undefined &&
                p.status === 'active' &&
                (p.kind === 'develop_holding' ||
                  p.kind === 'develop_real_estate' ||
                  p.kind === 'upgrade_owned_real_estate'),
            )
          if (!activeProject) return null
          if (
            activeProject.kind !== 'develop_holding' &&
            activeProject.kind !== 'develop_real_estate' &&
            activeProject.kind !== 'upgrade_owned_real_estate'
          )
            return null
          const supervisor = currentState.persons[activeProject.supervisorPersonId]
          return (
            <div className="text-sm">
              <DetailSection title={t('detail.province.active_develop_project')} />
              <div className="ml-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">{t('detail.province.project_stage')}:</span>
                  <span>{t(`detail.province.project_stage_${activeProject.currentStageKey}`)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    {activeProject.kind === 'develop_holding'
                      ? t(`detail.province.improvement_${activeProject.improvementKind}`, {
                          defaultValue: String(activeProject.improvementKind),
                        })
                      : t(`detail.realEstate.kind_${activeProject.realEstateKind}`, {
                          defaultValue: String(activeProject.realEstateKind),
                        })}
                  </span>
                  <span>
                    &rarr; Lv.
                    {activeProject.kind === 'develop_holding'
                      ? activeProject.targetImprovementLevel
                      : activeProject.targetRealEstateLevel}
                  </span>
                </div>
                {activeProject.currentStageKey === 'execute_project' && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('detail.house.project_progress')}:</span>
                    <span>
                      {Math.round(activeProject.progress)}/
                      {Math.round(activeProject.targetProgress)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    {t('detail.province.project_budget_total')}:
                  </span>
                  <span>{activeProject.budget.required.toFixed(0)}</span>
                </div>
                {activeProject.currentStageKey === 'execute_project' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-400">
                        {t('detail.province.project_budget_remaining')}:
                      </span>
                      <span>{activeProject.budget.remaining.toFixed(0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">
                        {t('detail.province.project_budget_spent')}:
                      </span>
                      <span>{activeProject.budget.spent.toFixed(0)}</span>
                    </div>
                  </>
                )}
                {supervisor && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('detail.house.project_supervisor')}:</span>
                    <PersonLink
                      personId={supervisor.id}
                      persons={currentState.persons}
                      onClick={onPersonClick}
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })()}

      {/* v0.48 Active Crisis (災害・戦災・反乱前段) */}
      {currentState &&
        (() => {
          const crisisIds = currentState.crisisIndex.byHolding[holding.id] ?? []
          const activeCrises = crisisIds
            .map((cid) => currentState.crises[cid])
            .filter((c): c is NonNullable<typeof c> => c !== undefined && c.status === 'active')
          if (activeCrises.length === 0) return null
          return (
            <div className="text-sm">
              <DetailSection title={t('detail.crisis.section_title')} tone="alert" />
              {activeCrises.map((crisis) => {
                const project = crisis.responseProjectId
                  ? currentState.projects[crisis.responseProjectId]
                  : undefined
                const supervisor =
                  project && project.kind === 'handle_crisis'
                    ? currentState.persons[project.supervisorPersonId]
                    : undefined
                return (
                  <div key={crisis.id} className="mb-1 ml-2 border-l border-red-900 pl-2">
                    <div className="flex justify-between">
                      <span className="text-red-200">
                        {t(`detail.crisis.kind.${crisis.kind}`, { defaultValue: crisis.kind })}
                      </span>
                      <span className="text-gray-400">
                        {t('detail.crisis.severity')}: {crisis.severity.toFixed(0)}
                      </span>
                    </div>
                    {/* v0.48.1: disrepair は deadline を持たない (終端 repaired/destroyed) ので非表示 */}
                    {crisis.kind !== 'disrepair' && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('detail.crisis.deadline')}:</span>
                        <span>{formatAbsoluteWeek(crisis.deadlineWeek)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-400">{t('detail.crisis.handler')}:</span>
                      {supervisor ? (
                        <PersonLink
                          personId={supervisor.id}
                          persons={currentState.persons}
                          onClick={onPersonClick}
                        />
                      ) : (
                        <span className="text-amber-400">{t('detail.crisis.unhandled')}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}

      {/* Bailiff */}
      {currentState &&
        (() => {
          const bailiff = getHoldingBailiffPerson(currentState, holding.id)
          const assignmentId = currentState.holdingOfficeIndex.byHolding[holding.id]

          const policyColorMap: Record<string, string> = {
            passive: 'text-gray-400',
            loyal_remittance: 'text-blue-400',
            profit_seeking: 'text-amber-400',
            protect_residents: 'text-green-400',
          }

          return (
            <div className="text-sm">
              <span className="text-gray-400">{t('detail.province.bailiff')}: </span>
              {bailiff ? (
                bailiff.kind === 'placeholder' ? (
                  <span className="text-gray-500 italic">{t('detail.province.placeholder')}</span>
                ) : (
                  <PersonLink
                    personId={bailiff.id}
                    persons={currentState.persons ?? {}}
                    onClick={onPersonClick}
                  />
                )
              ) : (
                <span className="text-gray-500">{t('detail.province.vacant')}</span>
              )}
              {/* v0.42: この Holding の代官任命権の保持者 (right 無し = 統治者の本来権限) */}
              <RightHolderLine
                right={getHoldingOfficeAppointmentRight(currentState, holding.id)}
                label={t('detail.province.bailiff_right')}
                persons={currentState.persons ?? {}}
                houses={currentState.houses ?? {}}
                onPersonClick={onPersonClick}
                onHouseClick={onHouseClick}
              />
              {bailiff &&
                assignmentId &&
                (() => {
                  const isPlaceholder = bailiff.kind === 'placeholder'
                  const policy = getBailiffPolicy(currentState, defaultConfig, assignmentId)
                  const localExtractionRate = getBailiffLocalExtractionRate(
                    currentState,
                    defaultConfig,
                    assignmentId,
                  )
                  const recentTaskStatus = getRecentBailiffRevenueTaskStatus(
                    currentState,
                    assignmentId,
                  )
                  const collectionEfficiency = getBailiffCollectionEfficiency(
                    currentState,
                    defaultConfig,
                    assignmentId,
                    recentTaskStatus,
                  )
                  const bailiffFeeRate = getBailiffFeeRate(
                    currentState,
                    defaultConfig,
                    assignmentId,
                  )
                  const burden = computeBailiffBurdenComponents(
                    localExtractionRate,
                    collectionEfficiency,
                    defaultConfig.collectionFrictionFactor,
                  )

                  return (
                    <div className="mt-1 ml-2 space-y-0.5 text-xs text-gray-400">
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_policy')}:</span>
                        <span className={policyColorMap[policy] ?? 'text-gray-300'}>
                          {t(`detail.province.bailiff_policy_${policy}`)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_local_extraction')}:</span>
                        <span>{(localExtractionRate * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_collection_efficiency')}:</span>
                        <span>{(collectionEfficiency * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_fee_rate')}:</span>
                        <span>{(bailiffFeeRate * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_total_burden')}:</span>
                        <span>{(burden.totalBurdenRate * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_friction')}:</span>
                        <span>{(burden.collectionFrictionBurdenRate * 100).toFixed(1)}%</span>
                      </div>
                      {!isPlaceholder && (
                        <>
                          <div className="flex justify-between">
                            <span>{t('detail.province.bailiff_recent_task')}:</span>
                            <span>
                              {recentTaskStatus === 'completed'
                                ? t('detail.province.bailiff_task_completed')
                                : t('detail.province.bailiff_task_none')}
                            </span>
                          </div>
                          {(() => {
                            const popIds = currentState.popIndex.byHolding[holding.id] ?? []
                            let totalAffection = 0
                            let totalRespect = 0
                            let totalSize = 0
                            const attKey = personAttitudeKey(bailiff.id)
                            for (const popId of popIds) {
                              const pop = currentState.popGroups[popId]
                              if (!pop) continue
                              const att = pop.attitudes[attKey]
                              if (att) {
                                totalAffection += (att.affection ?? 0) * pop.size
                                totalRespect += (att.respect ?? 0) * pop.size
                              }
                              totalSize += pop.size
                            }
                            const avgAffection = totalSize > 0 ? totalAffection / totalSize : 0
                            const avgRespect = totalSize > 0 ? totalRespect / totalSize : 0
                            return (
                              <div className="flex justify-between">
                                <span>{t('detail.province.bailiff_pop_attitude')}:</span>
                                <span>
                                  {t('detail.province.bailiff_affection')}{' '}
                                  <span
                                    className={
                                      avgAffection >= 0 ? 'text-green-400' : 'text-red-400'
                                    }
                                  >
                                    {avgAffection >= 0 ? '+' : ''}
                                    {avgAffection.toFixed(2)}
                                  </span>
                                  {' / '}
                                  {t('detail.province.bailiff_respect')}{' '}
                                  <span
                                    className={avgRespect >= 0 ? 'text-blue-400' : 'text-red-400'}
                                  >
                                    {avgRespect >= 0 ? '+' : ''}
                                    {avgRespect.toFixed(2)}
                                  </span>
                                </span>
                              </div>
                            )
                          })()}
                        </>
                      )}
                    </div>
                  )
                })()}
            </div>
          )
        })()}

      {/* Contract chain */}
      {currentState &&
        (() => {
          const chain = getHoldingLandContractChain(currentState, holding.id)
          if (chain.length === 0) return null
          return (
            <div className="text-sm">
              <div className="text-gray-400">{t('detail.province.contract_chain')}:</div>
              {chain.map((contract, idx) => {
                const grantee = currentState.polities[contract.granteePolityId]
                const nextContract = idx + 1 < chain.length ? chain[idx + 1] : undefined
                const protectedRemaining =
                  nextContract?.termsProtectedUntilWeek &&
                  currentState.absoluteWeek < nextContract.termsProtectedUntilWeek
                    ? Math.ceil(
                        (nextContract.termsProtectedUntilWeek - currentState.absoluteWeek) /
                          WEEKS_PER_YEAR,
                      )
                    : null
                // ↓ の税率は nextContract が contract (grantor) へ支払う率。その契約が
                //   上納拒否中なら、この税率リンク自体が機能不全 → ここにマーカーを出す。
                const linkDefault = nextContract
                  ? getActiveDefaultForContract(currentState, nextContract.id)
                  : undefined
                return (
                  <div key={contract.id}>
                    <div className="border-l border-gray-700 pl-2 text-sm">
                      {grantee ? (
                        <button
                          className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline"
                          onClick={() => onPolityClick(grantee.id, 'polity')}
                        >
                          {getPolityShortName(currentState, resolveName, grantee.id)}
                        </button>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </div>
                    {nextContract && (
                      <div className="border-l border-gray-700 pl-3 text-xs text-gray-500">
                        <span className={linkDefault ? 'text-red-300 line-through' : ''}>
                          ↓ {(nextContract.terms.taxRateToGrantor * 100).toFixed(0)}%
                        </span>
                        {protectedRemaining != null && (
                          <span className="ml-1 text-yellow-500">
                            🛡{' '}
                            {t('detail.province.terms_protected_until', {
                              years: protectedRemaining,
                            })}
                          </span>
                        )}
                        {linkDefault && (
                          <span className="ml-1 rounded bg-red-950/50 px-1 text-[11px] text-red-300">
                            ⚠{' '}
                            {linkDefault.origin === 'revolt_independence'
                              ? t('detail.obligation.default_revolt', { defaultValue: '反乱占拠' })
                              : t('detail.obligation.default_active', {
                                  defaultValue: '上納拒否中',
                                })}
                            {' · '}
                            {t('detail.obligation.default_claimant', {
                              defaultValue: '請求元',
                            })}
                            :{' '}
                            {getPolityShortName(
                              currentState,
                              resolveName,
                              linkDefault.claimantPolityId,
                            )}
                            {' · '}
                            {t('detail.obligation.prescription_remaining', {
                              defaultValue: '時効まで残り {{years}} 年',
                              years: Math.floor(
                                getDefaultPrescriptionRemainingYears(
                                  currentState,
                                  defaultConfig,
                                  linkDefault,
                                ),
                              ),
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}

      {/* POP breakdown by class */}
      {currentState && (
        <>
          <DetailSection title="POP" />
          {(['lower', 'middle', 'upper'] as const).map((popClass) => {
            const empSize = getHoldingEmployedPopSize(currentState, holding.id, popClass)
            const cap = getHoldingClassCapacity(currentState, defaultConfig, holding.id, popClass)
            const unempSize = getHoldingUnemployedPopSize(currentState, holding.id, popClass)
            if (empSize === 0 && unempSize === 0) return null
            return (
              <div key={popClass} className="text-sm">
                <div className="font-medium text-gray-300">{t(`detail.province.${popClass}`)}</div>
                <div className="ml-2 text-gray-400">
                  <div className="flex justify-between">
                    <span>{t('detail.province.pop_employed')}:</span>
                    <span>
                      {formatPopCount(empSize)} / {formatPopCount(cap)}
                    </span>
                  </div>
                  {unempSize > 0 && (
                    <div className="flex justify-between">
                      <span className="text-yellow-400">
                        {t('detail.province.pop_unemployed')}:
                      </span>
                      <span className="text-yellow-400">{formatPopCount(unempSize)}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* Individual POP group list (clickable) */}
      {currentState &&
        (() => {
          const pops = getHoldingPops(currentState, holding.id)
          if (pops.length === 0) return null
          return (
            <>
              <DetailSection title={t('detail.province.pop_groups')} />
              {pops.map((pop) => (
                <div key={pop.id} className="rounded bg-gray-700 p-1.5 text-xs">
                  <button
                    className="w-full cursor-pointer text-left font-medium text-blue-400 capitalize hover:text-blue-300"
                    onClick={() => onPopGroupClick(pop.id)}
                  >
                    {t(`detail.province.pop_type.${pop.popType}`, { defaultValue: pop.popType })}{' '}
                    <span className="text-xs font-normal text-gray-400">
                      ({t(`detail.province.${pop.class}`, { defaultValue: pop.class })} /{' '}
                      {pop.employed
                        ? t('detail.province.pop_employed')
                        : t('detail.province.pop_unemployed')}
                      )
                    </span>{' '}
                    →
                  </button>
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('detail.province.size')}:</span>
                    <span>{formatPopCount(pop.size)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('detail.province.wealth')}:</span>
                    <span>{pop.wealth.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('detail.province.unrest')}:</span>
                    <span className={pop.unrest > 60 ? 'text-red-400' : 'text-gray-200'}>
                      {pop.unrest.toFixed(1)}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )
        })()}

      {/* v0.38 §8: 土地の歴史 (永続 Chronicle) */}
      {currentState && (
        <EntityChronicleSection
          title={t('detail.holding.chronicle')}
          entries={getChronicleEntriesForHolding(currentState, holding.id)}
          entityType="holding"
          entityId={holding.id}
        />
      )}
    </div>
  )
}
