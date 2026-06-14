import type { SimulationSession } from '@/sim/types/world'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { weekToYearMonthWeek } from '@sim/utils/timeUtils'
import type { ProvinceId, HoldingId, PolityId } from '@/sim/types/ids'
import { PolityLink, PersonLink } from './shared/links'

export function DiplomaticPlayDetail({
  play,
  session,
  onPersonClick,
  onPolityClick,
  onProvinceClick,
  onHoldingClick,
}: {
  play: import('@sim/types/diplomaticPlay').DiplomaticPlay
  session: SimulationSession | null
  onPersonClick: ClickHandler
  onPolityClick: ClickHandler
  onProvinceClick: (id: string) => void
  onHoldingClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const worldState = session?.currentState ?? null
  if (!worldState) return null

  const polities = worldState.polities
  const persons = worldState.persons

  const started = weekToYearMonthWeek(play.startedWeek)
  const deadline = weekToYearMonthWeek(play.deadlineWeek)

  const statusBadge: Record<string, { label: string; bg: string }> = {
    active: { label: t('sidebar.play_status.active'), bg: 'bg-blue-700' },
    escalated: { label: t('sidebar.play_status.escalated'), bg: 'bg-red-700' },
    settled: { label: t('detail.play.status_settled'), bg: 'bg-green-700' },
    failed: { label: t('detail.play.status_failed'), bg: 'bg-gray-600' },
    resolved_by_conflict: {
      label: t('detail.play.status_resolved_by_conflict'),
      bg: 'bg-orange-700',
    },
    cancelled: { label: t('detail.play.status_cancelled'), bg: 'bg-gray-600' },
  }
  const badge = statusBadge[play.status] ?? { label: play.status, bg: 'bg-gray-600' }

  let provinceId: ProvinceId | undefined
  let holdingId: HoldingId | undefined
  if (play.issue?.kind === 'land_claim') {
    holdingId = play.issue.holdingId
    provinceId = play.issue.provinceId
  } else if (play.issue?.kind === 'contract_tax_revision') {
    holdingId = play.issue.holdingId
    provinceId = worldState.holdings[holdingId]?.provinceId
  }
  const holding = holdingId ? worldState.holdings[holdingId] : undefined

  const initiatorPolity = polities[play.initiator.id as PolityId]
  const targetPolity = polities[play.target.id as PolityId]

  const initiatorTasks = play.initiatorActiveTaskIds
    .map((tid) => worldState.tasks[tid])
    .filter((tk): tk is NonNullable<typeof tk> => !!tk)
  const targetTasks = play.targetActiveTaskIds
    .map((tid) => worldState.tasks[tid])
    .filter((tk): tk is NonNullable<typeof tk> => !!tk)

  // Related projects
  const initiatorProject = play.originProjectId
    ? worldState.projects[play.originProjectId]
    : undefined
  const pressureIds = worldState.pressureIndex.byDiplomaticPlay[play.id]
  const targetPressure = pressureIds
    ?.map((pid) => worldState.pressures[pid])
    .find((p) => p && p.responseProjectId)
  const targetProject = targetPressure?.responseProjectId
    ? worldState.projects[targetPressure.responseProjectId]
    : undefined

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-white">
          {t(`play_kind.${play.kind}`, { ns: 'diplomacy' })}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-xs text-white ${badge.bg}`}>
          {badge.label}
        </span>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.play.initiator')}:</span>
          {initiatorPolity ? (
            <PolityLink polityId={initiatorPolity.id} world={worldState} onClick={onPolityClick} />
          ) : (
            <span>{play.initiator.id}</span>
          )}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.play.target')}:</span>
          {targetPolity ? (
            <PolityLink polityId={targetPolity.id} world={worldState} onClick={onPolityClick} />
          ) : (
            <span>{play.target.id}</span>
          )}
        </div>
        {/* v0.43 §18.1: 各 side の supporter Polity (delegate / preparation 等は持たない)。 */}
        {(
          [
            ['initiator', play.initiatorSupporters],
            ['target', play.targetSupporters],
          ] as const
        ).map(([sideKey, supporters]) => {
          if (supporters.length === 0) return null
          return (
            <div key={sideKey} className="flex justify-between gap-2 text-xs">
              <span className="shrink-0 text-gray-400">
                {t('detail.play.supporters')} ({t(`detail.play.${sideKey}`)}):
              </span>
              <span className="flex flex-wrap justify-end gap-x-2">
                {supporters.map((s) =>
                  s.actor.kind === 'polity' ? (
                    <PolityLink
                      key={s.actor.id}
                      polityId={s.actor.id}
                      world={worldState}
                      onClick={onPolityClick}
                    />
                  ) : (
                    <span key={s.actor.id}>{s.actor.id}</span>
                  ),
                )}
              </span>
            </div>
          )
        })}
        {provinceId && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.play.province')}:</span>
            <button
              className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
              onClick={() => onProvinceClick(provinceId)}
            >
              {resolveName(
                'province',
                worldState.provinces[provinceId]?.nameKey ?? provinceId,
                provinceId,
              )}
            </button>
          </div>
        )}
        {holding && provinceId && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.play.holding')}:</span>
            <button
              className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
              onClick={() => onHoldingClick(holding.id)}
            >
              {resolveName(
                'province',
                worldState.provinces[provinceId]?.nameKey ?? provinceId,
                provinceId,
              )}{' '}
              {holding.kind}
            </button>
          </div>
        )}

        <div className="my-1 border-t border-gray-700" />

        <div className="flex justify-between">
          <span className="text-gray-400">{t('sidebar.play_progress')}:</span>
          <span>{Math.round(play.progress)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('sidebar.play_tension')}:</span>
          <span>{Math.round(play.tension)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.play.started')}:</span>
          <span>
            {started.year}/{started.month}/{started.weekOfMonth}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('sidebar.play_deadline')}:</span>
          <span>
            {deadline.year}/{deadline.month}/{deadline.weekOfMonth}
          </span>
        </div>

        <div className="my-1 border-t border-gray-700" />

        {
          <>
            <div className="text-sm font-semibold text-gray-300">
              {t('detail.play.initiator_side')}
            </div>
            <div style={{ marginLeft: 8 }}>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.play.delegate')}:</span>
                {play.initiatorDelegatePersonId ? (
                  <PersonLink
                    personId={play.initiatorDelegatePersonId}
                    persons={persons}
                    onClick={onPersonClick}
                  />
                ) : (
                  <span className="text-gray-500">—</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('diplomacy:params.preparation')}:</span>
                <span>{Math.round(play.initiatorPreparation)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('diplomacy:params.leverage')}:</span>
                <span>{Math.round(play.initiatorLeverage)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('diplomacy:params.commitment')}:</span>
                <span>{Math.round(play.initiatorCommitment)}</span>
              </div>
              {initiatorTasks.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div className="text-xs font-semibold text-gray-400">
                    {t('detail.play.active_tasks')}:
                  </div>
                  {initiatorTasks.map((task) => (
                    <div key={task.id} className="text-xs text-gray-300" style={{ marginLeft: 8 }}>
                      {t(task.kind, { ns: 'tasks' })} — {Math.round(task.effortDone)}/
                      {task.effortRequired}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 4 }}>
              {t('detail.play.target_side')}
            </div>
            <div style={{ marginLeft: 8 }}>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.play.delegate')}:</span>
                {play.targetDelegatePersonId ? (
                  <PersonLink
                    personId={play.targetDelegatePersonId}
                    persons={persons}
                    onClick={onPersonClick}
                  />
                ) : (
                  <span className="text-gray-500">—</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('diplomacy:params.preparation')}:</span>
                <span>{Math.round(play.targetPreparation)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('diplomacy:params.leverage')}:</span>
                <span>{Math.round(play.targetLeverage)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('diplomacy:params.commitment')}:</span>
                <span>{Math.round(play.targetCommitment)}</span>
              </div>
              {targetTasks.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div className="text-xs font-semibold text-gray-400">
                    {t('detail.play.active_tasks')}:
                  </div>
                  {targetTasks.map((task) => (
                    <div key={task.id} className="text-xs text-gray-300" style={{ marginLeft: 8 }}>
                      {t(task.kind, { ns: 'tasks' })} — {Math.round(task.effortDone)}/
                      {task.effortRequired}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        }

        <div className="my-1 border-t border-gray-700" />

        <div className="text-sm font-semibold text-gray-300">{t('detail.play.demand')}</div>
        <div className="text-xs text-gray-400" style={{ marginLeft: 8 }}>
          {play.issue?.kind === 'land_claim' && `${t('detail.play.demand_transfer_land')}`}
          {play.issue?.kind === 'contract_tax_revision' &&
            (() => {
              const currentRate =
                worldState.landContracts[play.issue.landContractId]?.terms.taxRateToGrantor
              return `${t('detail.play.demand_tax_change')} ${currentRate != null ? Math.round(currentRate * 100) : '?'}% → ${Math.round(play.issue.desiredTaxRateToGrantor * 100)}%`
            })()}
          {play.primaryDemand?.kind === 'popular_tax_relief' &&
            `${t('detail.play.demand_tax_relief')} ${Math.round(play.primaryDemand.currentTaxRate * 100)}% → ${Math.round(play.primaryDemand.demandedTaxRate * 100)}%`}
          {play.primaryDemand?.kind === 'bailiff_dismissal' &&
            `${t('detail.play.demand_bailiff_dismissal')}`}
          {play.primaryDemand?.kind === 'secession' && `${t('detail.play.demand_secession')}`}
        </div>

        {(initiatorProject || targetProject) && (
          <>
            <div className="my-1 border-t border-gray-700" />
            <div className="text-sm font-semibold text-gray-300">
              {t('detail.play.related_projects')}
            </div>
            {initiatorProject && (
              <div style={{ marginLeft: 8 }}>
                <div className="text-xs font-semibold text-gray-400">
                  {t('detail.play.initiator_project')}
                </div>
                <div className="text-xs text-gray-300" style={{ marginLeft: 8 }}>
                  <div>
                    {t(`detail.project_kind.${initiatorProject.kind}`)} —{' '}
                    <span className="text-gray-400">
                      {t(`detail.play.stage_${initiatorProject.currentStageKey}`)}
                    </span>
                  </div>
                  <div>
                    {t('detail.play.project_progress')}: {Math.round(initiatorProject.progress)}/
                    {initiatorProject.targetProgress}
                  </div>
                </div>
              </div>
            )}
            {targetProject && (
              <div style={{ marginLeft: 8, marginTop: 4 }}>
                <div className="text-xs font-semibold text-gray-400">
                  {t('detail.play.target_project')}
                </div>
                <div className="text-xs text-gray-300" style={{ marginLeft: 8 }}>
                  <div>
                    {t(`detail.project_kind.${targetProject.kind}`)} —{' '}
                    <span className="text-gray-400">
                      {t(`detail.play.stage_${targetProject.currentStageKey}`)}
                    </span>
                  </div>
                  <div>
                    {t('detail.play.project_progress')}: {Math.round(targetProject.progress)}/
                    {targetProject.targetProgress}
                  </div>
                  {targetProject.kind === 'respond_to_pressure' && targetProject.stance && (
                    <div>
                      {t('detail.play.stance')}: {t(`detail.play.stance_${targetProject.stance}`)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
