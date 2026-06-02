import type { Polity } from '@/sim/types/polity'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { calcPolityMilitaryPower } from '@/sim/selectors/militarySelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { getPolityLegitimacy, getPolityStability } from '@sim/selectors/statusSelectors'
import {
  getPolityHouseIds,
  getHouseProvinceIdsByPolity,
  getHousePrimaryPolityId,
} from '@sim/selectors/polityRelations'
import type { House } from '@/sim/types/house'
import { HouseLink, PersonLink } from './shared/links'
import {
  CopyJsonButton,
  WatchButton,
  ShareholderSection,
  PolityLandContracts,
  PolityRegiments,
  ProjectDetailCard,
  ProjectListItem,
  EntityChronicleSection,
} from './shared/widgets'
import { formatPolityRank, formatAmount, formatScore, formatPower } from '@/app/utils/format'
import {
  getPolityLeader,
  getPolityLeaderHouse,
  getAdministrativeCapacity,
  getAdministrativeLoad,
  getAdministrativeEfficiency,
  getActiveOfficeHolders,
} from '@sim/selectors/officeSelectors'
import { getDominantPolityHouse, getTopShareholders } from '@sim/selectors/shareSelectors'
import { getActiveGoalForOwner, getActiveAimsForGoal } from '@sim/selectors/goalSelectors'
import { getChronicleEntriesForPolity } from '@sim/selectors/chronicleSelectors'

export function CountryDetail({
  polity,
  session,
  watchlist,
  toggleWatchlist,
  onPersonClick,
  onHouseClick,
  onProvinceClick,
  onDiplomaticPlayClick,
}: {
  polity: Polity
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
  onProvinceClick: (id: string) => void
  onDiplomaticPlayClick?: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const isWatching = watchlist.includes(polity.id)
  const currentState = session?.currentState
  if (!currentState) return null
  const houses = currentState.houses
  const persons = currentState.persons

  const worldState: WorldState | null = currentState ?? null

  const totalMilitaryPower = worldState
    ? calcPolityMilitaryPower(worldState, defaultConfig, polity.id)
    : 0

  const legitimacy = worldState ? getPolityLegitimacy(worldState, polity.id) : 50
  const stability = worldState ? getPolityStability(worldState, defaultConfig, polity.id) : 50

  const roleLabels: Record<string, string> = {
    leader: t('detail.polity.ruler'),
    administrator: t('polity.administrator', { ns: 'roles' }),
    military: t('polity.military', { ns: 'roles' }),
    treasurer: t('polity.treasurer', { ns: 'roles' }),
    advisor: t('polity.advisor', { ns: 'roles' }),
  }

  // v0.15: この Polity に Province を持つ active House を、所領 Province 数とともに表示する。
  // 多 Polity 所領家も他 Polity の Detail に出る (primary 限定はしない)。
  // Province 数 desc → HouseId 昇順でソートし、primary がここでない家には「外様」表示を付ける。
  const houseEntries = currentState
    ? getPolityHouseIds(currentState, polity.id)
        .map((hid) => {
          const house = houses[hid]
          if (!house || !house.active) return null
          const count = getHouseProvinceIdsByPolity(currentState, hid, polity.id).length
          const primary = getHousePrimaryPolityId(currentState, hid)
          return { house, count, isPrimaryHere: primary === polity.id }
        })
        .filter((e): e is { house: House; count: number; isPrimaryHere: boolean } => e !== null)
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count
          return a.house.id.localeCompare(b.house.id)
        })
    : []
  const inHouseNames = houseEntries.map(({ house, count, isPrimaryHere }) => (
    <li key={house.id} className="mb-0.5">
      <HouseLink houseId={house.id} houses={houses} onClick={onHouseClick} />
      <span className="ml-1 text-xs text-gray-400">
        ({count} province{count === 1 ? '' : 's'}
        {isPrimaryHere ? '' : ', non-primary'})
      </span>
    </li>
  ))

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">
            {resolveName('polity', polity.nameKey, polity.nameKey)}
          </span>
          {!polity.active && (
            <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-400">
              {t('detail.annexed')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <CopyJsonButton payload={buildEntitySnapshot('polity', polity, currentState ?? null)} />
          <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(polity.id)} />
        </div>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.rank')}:</span>
          <span>
            {formatPolityRank(polity.rank)}{' '}
            <span className="text-gray-500">(rank {polity.rank})</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.capital')}:</span>
          <button
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onProvinceClick(polity.capitalProvinceId)}
          >
            {(() => {
              const p = currentState.provinces?.[polity.capitalProvinceId]
              return p ? resolveName('province', p.nameKey, p.nameKey) : polity.capitalProvinceId
            })()}
          </button>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.ruler')}:</span>
          {(() => {
            if (!currentState) return <span className="text-gray-500">\u2014</span>
            const rulerId = getPolityLeader(currentState, polity.id)
            if (!rulerId) return <span className="text-gray-500">\u2014</span>
            return <PersonLink personId={rulerId} persons={persons ?? {}} onClick={onPersonClick} />
          })()}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.royal_house')}:</span>
          {(() => {
            if (!currentState) return <span className="text-gray-500">\u2014</span>
            const rulerHouseId = getPolityLeaderHouse(currentState, polity.id)
            if (!rulerHouseId) return <span className="text-gray-500">\u2014</span>
            return <HouseLink houseId={rulerHouseId} houses={houses ?? {}} onClick={onHouseClick} />
          })()}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.dominant_house')}:</span>
          {(() => {
            if (!currentState) return <span className="text-gray-500">\u2014</span>
            const dominantHouseId = getDominantPolityHouse(currentState, polity.id)
            if (!dominantHouseId) return <span className="text-gray-500">\u2014</span>
            return (
              <HouseLink houseId={dominantHouseId} houses={houses ?? {}} onClick={onHouseClick} />
            )
          })()}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.treasury')}:</span>
          <span>{formatAmount(polity.treasury)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.legitimacy')}:</span>
          <span>{formatScore(legitimacy)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.admin_power')}:</span>
          <span>{formatScore(polity.adminPower)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.stability')}:</span>
          <span>{formatScore(stability)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.military_power')}:</span>
          <span>{formatPower(totalMilitaryPower)}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">
        {t('detail.polity.administration')}:
      </div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.capacity')}:</span>
          <span>
            {worldState
              ? getAdministrativeCapacity(worldState, defaultConfig, polity.id).toFixed(1)
              : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.load')}:</span>
          <span>
            {worldState
              ? getAdministrativeLoad(worldState, defaultConfig, polity.id).toFixed(1)
              : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.efficiency')}:</span>
          <span>
            {worldState
              ? `x${getAdministrativeEfficiency(worldState, defaultConfig, polity.id).toFixed(2)}`
              : '—'}
          </span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">{t('detail.polity.roles')}:</div>
      <div className="text-sm">
        {(['leader', 'administrator', 'military', 'treasurer', 'advisor'] as const).map((role) => {
          const polityRef = { kind: 'polity' as const, id: polity.id }
          const holderIds = worldState ? getActiveOfficeHolders(worldState, polityRef, role) : []
          return (
            <div key={role} className="flex justify-between">
              <span className="text-gray-400">{roleLabels[role]}:</span>
              <div className="flex flex-col items-end gap-0.5">
                {holderIds.length === 0 ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  holderIds.map((pid) => (
                    <PersonLink
                      key={pid as string}
                      personId={pid}
                      persons={persons}
                      onClick={onPersonClick}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-sm font-semibold text-gray-300">
        {t('detail.polity.top_shareholders')}:
      </div>
      {worldState ? (
        <ShareholderSection
          shareholders={getTopShareholders(worldState, { kind: 'polity', id: polity.id }, 5)}
          persons={currentState.persons ?? {}}
          houses={houses ?? {}}
          onPersonClick={onPersonClick}
          onHouseClick={onHouseClick}
        />
      ) : (
        <span className="text-sm text-gray-500">—</span>
      )}

      <div className="text-sm font-semibold text-gray-300">
        {t('detail.polity.houses_with_land')}:
      </div>
      <ul className="list-inside list-disc text-sm">
        {inHouseNames.length > 0 ? inHouseNames : <li className="text-gray-500">\u2014</li>}
      </ul>

      <PolityLandContracts
        polity={polity}
        worldState={worldState}
        onProvinceClick={onProvinceClick}
      />

      <PolityRegiments polity={polity} worldState={worldState} />

      {/* v0.22 Goal/Aim */}
      {worldState &&
        (() => {
          const owner = { kind: 'polity' as const, id: polity.id }
          const goal = getActiveGoalForOwner(worldState, owner)
          if (!goal) return null
          const activeAims = getActiveAimsForGoal(worldState, goal.id)
          const activeAim = activeAims[0]
          return (
            <div style={{ marginTop: 8 }}>
              <strong>{t('detail.polity.current_goal')}</strong>
              <div style={{ marginLeft: 8 }}>
                <div>{t(`goals:polity.${goal.kind}`)}</div>
                {goal.reasonIds.length > 0 && (
                  <ul style={{ margin: '2px 0', paddingLeft: 20 }}>
                    {goal.reasonIds.map((rid) => {
                      const reason = worldState.decisionReasons[rid]
                      if (!reason) return null
                      return (
                        <li key={rid} style={{ fontSize: '0.9em', opacity: 0.85 }}>
                          {t(reason.summaryKey, { ns: 'decision_reasons' })}
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div>
                  {t('detail.polity.goal_progress')}: {goal.progress} / {goal.targetProgress}
                </div>
              </div>
              {activeAim && (
                <div style={{ marginLeft: 8, marginTop: 4 }}>
                  <strong>{t('detail.polity.active_aim')}</strong>
                  <div style={{ marginLeft: 8 }}>
                    <div>{t(`aims:polity.${activeAim.kind}`)}</div>
                    <div>
                      {t('detail.polity.aim_progress')}: {activeAim.progress} /{' '}
                      {activeAim.targetProgress}
                    </div>
                    <div>
                      {t('detail.polity.aim_deadline')}: {t('detail.common.year')}{' '}
                      {Math.ceil(activeAim.deadlineWeek / 48)}
                    </div>
                  </div>
                </div>
              )}
              {activeAim &&
                worldState &&
                (() => {
                  const aimKey = `aim:${activeAim.id}`
                  const projectIds = worldState.projectIndex.byAim[aimKey] ?? []
                  const activeProjects = projectIds
                    .map((pid) => worldState.projects[pid])
                    .filter(
                      (p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active',
                    )
                  if (activeProjects.length === 0) return null
                  return activeProjects.map((project) => (
                    <ProjectDetailCard
                      key={project.id}
                      project={project}
                      persons={worldState.persons}
                      onPersonClick={onPersonClick}
                      label={t('detail.polity.active_project')}
                    />
                  ))
                })()}
              {activeAim?.activeDiplomaticPlayId &&
                (() => {
                  const play = worldState.diplomaticPlays[activeAim.activeDiplomaticPlayId]
                  if (!play || (play.status !== 'active' && play.status !== 'escalated'))
                    return null
                  return (
                    <div style={{ marginLeft: 8, marginTop: 4 }}>
                      <strong>{t('detail.polity.active_play')}</strong>
                      <div style={{ marginLeft: 8 }}>
                        {onDiplomaticPlayClick ? (
                          <button
                            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                            onClick={() => onDiplomaticPlayClick(play.id)}
                          >
                            {t(`play_kind.${play.kind}`, { ns: 'diplomacy' })}
                          </button>
                        ) : (
                          <div>{t(`play_kind.${play.kind}`, { ns: 'diplomacy' })}</div>
                        )}
                        <div>
                          {t('sidebar.play_progress')}: {Math.round(play.progress)} |{' '}
                          {t('sidebar.play_tension')}: {Math.round(play.tension)}
                        </div>
                      </div>
                    </div>
                  )
                })()}
            </div>
          )
        })()}

      {/* Projects Section */}
      {worldState &&
        (() => {
          const ownerKey = `polity:${polity.id}`
          const projectIds = worldState.projectIndex.byOwner[ownerKey] ?? []
          const activeProjects = projectIds
            .map((pid) => worldState.projects[pid])
            .filter((p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active')
          if (activeProjects.length === 0) return null
          return (
            <div className="mt-2">
              <div className="text-sm font-semibold text-gray-300">
                {t('detail.polity.projects_section')} ({activeProjects.length})
              </div>
              <ul className="list-inside text-sm">
                {activeProjects.map((project) => (
                  <ProjectListItem
                    key={project.id}
                    project={project}
                    persons={worldState.persons}
                    onPersonClick={onPersonClick}
                  />
                ))}
              </ul>
            </div>
          )
        })()}

      {/* v0.38 §8: 国史 (永続 Chronicle) */}
      {worldState && (
        <EntityChronicleSection
          title={t('detail.polity.chronicle')}
          entries={getChronicleEntriesForPolity(worldState, polity.id)}
        />
      )}
    </div>
  )
}
