import type { Holding } from '@/sim/types/landContract'
import type { SimulationSession } from '@/sim/types/world'
import { buildEntitySnapshot, resolveHoldingImprovements } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getPolityShortName, getHoldingQualifiedName } from '@/app/hooks/entityNameHelpers'
import {
  PanelHeader,
  CopyJsonButton,
  EntityChronicleSection,
  RightHolderLine,
} from './shared/widgets'
import { getHoldingOfficeAppointmentRight } from '@sim/selectors/politicalRightSelectors'
import { getHoldingImage } from '@/app/utils/assetHash'
import { getHoldingDevelopment } from '@sim/selectors/holdingImprovementSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { PersonLink } from './shared/links'
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
import { WEEKS_PER_YEAR } from '@sim/utils/timeUtils'
import { getPrimaryOccupationForClass } from '@/sim/types/popGroup'
import {
  getHoldingPopSizeByClassAndOccupation,
  getHoldingOccupationCapacity,
  getHoldingPops,
} from '@sim/selectors/popSelectors'
import { getChronicleEntriesForHolding } from '@sim/selectors/chronicleSelectors'
import { formatAbsoluteWeek } from '@/app/utils/format'

export function HoldingDetail({
  holding,
  session,
  onPolityClick,
  onPersonClick,
  onHouseClick,
  onProvinceClick,
  onPopGroupClick,
}: {
  holding: Holding
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onPersonClick: (id: string) => void
  onHouseClick: ClickHandler
  onProvinceClick: (id: string) => void
  onPopGroupClick: (id: string) => void
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

      {/* Improvements */}
      {currentState &&
        (() => {
          const impIds = currentState.holdingImprovementIndex.byHolding[holding.id as string] ?? []
          const improvements = impIds
            .map((id) => currentState.holdingImprovements[id])
            .filter((imp): imp is NonNullable<typeof imp> => imp !== undefined)
          if (improvements.length === 0) return null
          return (
            <div className="text-sm">
              <div className="font-semibold text-gray-300">{t('detail.province.improvements')}</div>
              {improvements.map((imp) => {
                const nameKey = `detail.province.improvement_name_${imp.kind}_${holding.kind}_${imp.level}`
                // v0.33 §12.3: flavor → category → kind 文字列 のフォールバック（生キーを出さない）
                const categoryName = t(`detail.province.improvement_${imp.kind}`, {
                  defaultValue: imp.kind,
                })
                const flavorName = t(nameKey, { defaultValue: categoryName })
                return (
                  <div key={imp.id} className="ml-2 flex items-baseline justify-between">
                    <span className="text-gray-200">{flavorName}</span>
                    <span className="text-xs text-gray-500">
                      （{categoryName}{' '}
                      {t('detail.province.improvement_level', { level: imp.level })}）
                    </span>
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
                p !== undefined && p.status === 'active' && p.kind === 'develop_holding',
            )
          if (!activeProject || activeProject.kind !== 'develop_holding') return null
          const supervisor = currentState.persons[activeProject.supervisorPersonId]
          return (
            <div className="text-sm">
              <div className="font-semibold text-gray-300">
                {t('detail.province.active_develop_project')}
              </div>
              <div className="ml-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">{t('detail.province.project_stage')}:</span>
                  <span>{t(`detail.province.project_stage_${activeProject.currentStageKey}`)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    {t(`detail.province.improvement_${activeProject.improvementKind}`, {
                      defaultValue: String(activeProject.improvementKind),
                    })}
                  </span>
                  <span>&rarr; Lv.{activeProject.targetImprovementLevel}</span>
                </div>
                {activeProject.currentStageKey === 'execute_project' && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('detail.house.project_progress')}:</span>
                    <span>
                      {activeProject.progress}/{activeProject.targetProgress}
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
              <div className="font-semibold text-red-300">{t('detail.crisis.section_title')}</div>
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
                    <div className="flex justify-between">
                      <span className="text-gray-400">{t('detail.crisis.deadline')}:</span>
                      <span>{formatAbsoluteWeek(crisis.deadlineWeek)}</span>
                    </div>
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
                        ↓ {(nextContract.terms.taxRateToGrantor * 100).toFixed(0)}%
                        {protectedRemaining != null && (
                          <span className="ml-1 text-yellow-500">
                            🛡{' '}
                            {t('detail.province.terms_protected_until', {
                              years: protectedRemaining,
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
          <div className="text-sm font-semibold text-gray-300">POP</div>
          {(['peasants', 'townsmen', 'nobles'] as const).map((popClass) => {
            const primaryOcc = getPrimaryOccupationForClass(popClass)
            const employed = getHoldingPopSizeByClassAndOccupation(
              currentState,
              holding.id,
              popClass,
              primaryOcc,
            )
            const cap = getHoldingOccupationCapacity(
              currentState,
              defaultConfig,
              holding.id,
              popClass,
              primaryOcc,
            )
            const unemployed = getHoldingPopSizeByClassAndOccupation(
              currentState,
              holding.id,
              popClass,
              'none',
            )
            if (employed === 0 && unemployed === 0) return null
            return (
              <div key={popClass} className="text-sm">
                <div className="font-medium text-gray-300">{t(`detail.province.${popClass}`)}</div>
                <div className="ml-2 text-gray-400">
                  <div className="flex justify-between">
                    <span>{t(`popOccupation.${primaryOcc}`)}:</span>
                    <span>
                      {employed.toFixed(1)} / {cap.toFixed(1)}
                    </span>
                  </div>
                  {unemployed > 0 && (
                    <div className="flex justify-between">
                      <span className="text-yellow-400">{t('popOccupation.none')}:</span>
                      <span className="text-yellow-400">{unemployed.toFixed(1)}</span>
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
              <div className="text-sm font-semibold text-gray-300">
                {t('detail.province.pop_groups')}
              </div>
              {pops.map((pop) => (
                <div key={pop.id} className="rounded bg-gray-700 p-1.5 text-xs">
                  <button
                    className="w-full cursor-pointer text-left font-medium text-blue-400 capitalize hover:text-blue-300"
                    onClick={() => onPopGroupClick(pop.id)}
                  >
                    {t(`detail.province.${pop.class}`, { defaultValue: pop.class })}{' '}
                    <span className="text-xs font-normal text-gray-400">
                      ({t(`popOccupation.${pop.occupation}`)})
                    </span>{' '}
                    →
                  </button>
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('detail.province.size')}:</span>
                    <span>{pop.size.toFixed(1)}</span>
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
