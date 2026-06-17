import type { Project } from '@/sim/types/project'
import type { SimulationSession } from '@/sim/types/world'
import { useTranslation } from 'react-i18next'
import { describeProject } from '@sim/selectors/projectSelectors'
import { getProjectStageType } from '@sim/config/projectStageSequences'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { formatAbsoluteWeek } from '@/app/utils/format'
import { CopyJsonButton, WatchButton } from './shared/widgets'
import { ProjectFieldRow, EntityRefLink } from './shared/ProjectCard'
import { clamp100 } from '@sim/utils/math'

// Project 詳細パネル。describeProject の純粋データをラベル/リンクに描画する。
// 他の click-only entity (Holding/Clan) と同じく Sidebar には出さず、カード経由で開く。
export function ProjectDetail({
  project,
  session,
  watchlist,
  toggleWatchlist,
}: {
  project: Project
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
}) {
  const { t } = useTranslation()
  const onNavigate = useSimulationStore((s) => s.openDetailWindow)
  const worldState = session?.currentState ?? null
  const descriptor = describeProject(project)
  const kindLabel = t(`detail.project_kind.${project.kind}`)
  const projectIdStr = project.id as string

  const statusColor =
    project.status === 'active'
      ? 'bg-blue-900 text-blue-200'
      : project.status === 'completed'
        ? 'bg-green-900 text-green-300'
        : 'bg-gray-700 text-gray-300'

  return (
    <div className="flex flex-col gap-1 p-3 text-sm">
      {/* 上段: ステータス (左) と Watch / JSON コピー (右)。下段: プロジェクト名。 */}
      <div className="flex items-center justify-between">
        <span className={`rounded px-1.5 py-0.5 text-xs ${statusColor}`}>
          {t(`detail.project.status_${project.status}`)}
        </span>
        <div className="flex items-center gap-1.5">
          <WatchButton
            isWatching={watchlist.includes(projectIdStr)}
            onToggle={() => toggleWatchlist(projectIdStr)}
          />
          <CopyJsonButton payload={project} />
        </div>
      </div>
      <div className="text-lg font-bold">{kindLabel}</div>

      {worldState && (
        <>
          {/* 効果説明: 種別名だけでは効果が読み取れないため、何が起きるかを1行で示す */}
          <div className="rounded bg-gray-800/60 px-2 py-1 text-xs text-gray-400">
            <span className="text-gray-500">{t('detail.project.effect_label')}: </span>
            {t(`detail.project.effect.${project.kind}`, { defaultValue: '' })}
          </div>

          {/* 進捗・段階 */}
          <div className="flex gap-1">
            <span className="text-gray-400">{t('detail.project.progress')}:</span>
            <span className="text-gray-300">
              {project.progress} / {project.targetProgress}
            </span>
          </div>
          <div className="flex gap-1">
            <span className="text-gray-400">{t('detail.project.stage')}:</span>
            <span className="text-gray-300">
              {t(`detail.play.stage_${project.currentStageKey}`)}
            </span>
          </div>

          {/* 主体・発案者・監督者 */}
          <div className="flex gap-1">
            <span className="text-gray-400">{t('detail.project.owner')}:</span>
            <EntityRefLink
              entityRef={project.owner}
              worldState={worldState}
              onNavigate={onNavigate}
            />
          </div>
          <div className="flex gap-1">
            <span className="text-gray-400">{t('detail.project.creator')}:</span>
            <EntityRefLink
              entityRef={{ kind: 'person', id: project.creatorPersonId }}
              worldState={worldState}
              onNavigate={onNavigate}
            />
          </div>
          <div className="flex gap-1">
            <span className="text-gray-400">{t('detail.project.supervisor')}:</span>
            <EntityRefLink
              entityRef={{ kind: 'person', id: project.supervisorPersonId }}
              worldState={worldState}
              onNavigate={onNavigate}
            />
          </div>

          {/* 外圧対応: 対応中の外圧 (出元・種別・関連外交劇) を解決して表示。
              Pressure は専用パネルを持たないため、ここで内容を展開する。 */}
          {project.kind === 'respond_to_pressure' &&
            (() => {
              const pressure = worldState.pressures[project.pressureId]
              if (!pressure) return null
              const play =
                pressure.relatedDiplomaticPlayId !== undefined
                  ? worldState.diplomaticPlays[pressure.relatedDiplomaticPlayId]
                  : undefined
              return (
                <div className="mt-1 flex flex-col gap-1 rounded border border-gray-700 p-2">
                  <div className="flex gap-1">
                    <span className="text-gray-400">{t('detail.project.pressure_source')}:</span>
                    <EntityRefLink
                      entityRef={pressure.source}
                      worldState={worldState}
                      onNavigate={onNavigate}
                    />
                  </div>
                  <div className="flex gap-1">
                    <span className="text-gray-400">{t('detail.project.pressure_type')}:</span>
                    <span className="text-gray-300">
                      {t(`detail.project.pressure_kind.${pressure.kind}`, {
                        defaultValue: pressure.kind,
                      })}
                    </span>
                  </div>
                  {play && (
                    <div className="flex gap-1">
                      <span className="text-gray-400">{t('detail.project.pressure_play')}:</span>
                      <button
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onNavigate('diplomaticPlay', play.id)}
                      >
                        {t(`play_kind.${play.kind}`, { ns: 'diplomacy', defaultValue: play.kind })}
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}

          {/* v0.48.1: 危機対応 (handle_crisis) — 対応中の危機の種別を常に表示。担当者探索中でも
              「何の危機に対応しようとしているか」が分かる。disrepair は加えて対象設備・状態を出す。 */}
          {project.kind === 'handle_crisis' &&
            (() => {
              const crisis = worldState.crises[project.crisisId]
              if (!crisis) return null
              const imp =
                crisis.kind === 'disrepair' && crisis.targetImprovementId
                  ? worldState.holdingImprovements[crisis.targetImprovementId]
                  : undefined
              return (
                <div className="mt-1 flex flex-col gap-1 rounded border border-gray-700 p-2">
                  <div className="flex gap-1">
                    <span className="text-gray-400">{t('detail.project.crisis_kind')}:</span>
                    <span className="text-gray-300">
                      {t(`detail.crisis.kind.${crisis.kind}`, { defaultValue: crisis.kind })}
                    </span>
                  </div>
                  {crisis.kind === 'disrepair' && (
                    <div className="flex gap-1">
                      <span className="text-gray-400">{t('detail.project.repair_target')}:</span>
                      <span className="text-gray-300">
                        {imp
                          ? t(`detail.province.improvement_${imp.kind}`, { defaultValue: imp.kind })
                          : t('detail.project.repair_target_lost')}
                      </span>
                    </div>
                  )}
                  {imp && (
                    <div className="flex gap-1">
                      <span className="text-gray-400">{t('detail.facility.condition')}:</span>
                      <span className="text-gray-300">{clamp100(imp.condition).toFixed(0)}</span>
                    </div>
                  )}
                </div>
              )
            })()}

          {/* 種別固有フィールド (primary を含む全件) */}
          {descriptor.fields.map((field, i) => (
            <ProjectFieldRow
              key={`${field.role}-${i}`}
              field={field}
              worldState={worldState}
              onNavigate={onNavigate}
            />
          ))}

          {/* 予算 (持つ種別のみ) */}
          {descriptor.budget && (
            <div className="flex flex-wrap gap-x-2">
              <span className="text-gray-400">{t('detail.project.budget')}:</span>
              {descriptor.budget.required !== undefined && (
                <span className="text-gray-300">
                  {t('detail.project.budget_required')} {Math.round(descriptor.budget.required)}
                </span>
              )}
              <span className="text-gray-300">
                {t('detail.project.budget_spent')} {Math.round(descriptor.budget.spent)}
              </span>
              {descriptor.budget.remaining !== undefined && (
                <span className="text-gray-300">
                  {t('detail.project.budget_remaining')} {Math.round(descriptor.budget.remaining)}
                </span>
              )}
            </div>
          )}

          {/* 期間。createdWeek/deadlineWeek は絶対週なので 年/月/週 に分解して表示。
              期限は最終ステージ (negotiate / execute_project 等) でのみ発効するため、
              それ以前は過去日付を出さず「最終段階で発効」と注記する (誤解防止)。 */}
          <div className="flex flex-wrap gap-x-2 text-xs text-gray-500">
            <span>
              {t('detail.project.created')}: {formatAbsoluteWeek(project.createdWeek)}
            </span>
            {project.deadlineWeek !== undefined && (
              <span>
                {t('detail.project.deadline')}:{' '}
                {getProjectStageType(project.kind, project.currentStageKey) === 'final'
                  ? formatAbsoluteWeek(project.deadlineWeek)
                  : t('detail.project.deadline_pending')}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
