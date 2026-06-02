import type { House } from '@/sim/types/house'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot, getImportanceColor } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import type { SimEvent } from '@/sim/types/event'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { useRenderEvent } from '@/app/hooks/useRenderEvent'
import { getHouseLeader, getActiveOfficeHolders } from '@sim/selectors/officeSelectors'
import { calcAmbitionScores } from '@/sim/tick/ambitionSystem'
import { getHouseCohesion, getHouseLoyaltyToPolity } from '@sim/selectors/statusSelectors'
import {
  getHouseControlledProvinceIds,
  getHouseOwnedPolityIds,
} from '@sim/selectors/landContractSelectors'
import { getProvinceHouseManpowerBase } from '@sim/selectors/popEconomySelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { clamp } from '@/sim/utils/math'
import { normalizedStat } from '@/sim/selectors/personAbilityEffects'
import { hasEntityId } from '@sim/types/event'
import {
  CopyJsonButton,
  WatchButton,
  ShareholderSection,
  EntityChronicleSection,
  ProjectDetailCard,
  ProjectListItem,
} from './shared/widgets'
import { getHousePrimaryPolityId } from '@sim/selectors/polityRelations'
import { formatPolityRank, formatScore, formatAmount, formatPower } from '@/app/utils/format'
import {
  getHouseProjectedAnnualIncome,
  getHouseAnnualOfficeSalary,
  getHouseProjectedAnnualBalance,
} from '@sim/selectors/houseFinanceSelectors'
import { PersonLink } from './shared/links'
import type { PersonId } from '@/sim/types/ids'
import { getTopShareholders } from '@sim/selectors/shareSelectors'
import { getHouseClanRole } from '@sim/selectors/clanSelectors'
import { getChronicleEntriesForHouse } from '@sim/selectors/chronicleSelectors'
import { getActiveGoalForOwner, getActiveAimsForGoal } from '@sim/selectors/goalSelectors'

export function HouseDetail({
  house,
  session,
  watchlist,
  toggleWatchlist,
  onPersonClick,
  onHouseClick,
  onPolityClick,
  onProvinceClick,
  onDiplomaticPlayClick,
  onClanClick,
  eventHistory,
}: {
  house: House
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
  onPolityClick: ClickHandler
  onProvinceClick: (id: string) => void
  onDiplomaticPlayClick?: (id: string) => void
  onClanClick?: (id: string) => void
  eventHistory: SimEvent[]
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const renderEvent = useRenderEvent()
  const isWatching = watchlist.includes(house.id)
  const currentState = session?.currentState
  const houses = currentState?.houses ?? {}
  if (!currentState) return null
  const leaderId = currentState ? getHouseLeader(currentState, house.id) : undefined
  const head = leaderId ? currentState.persons?.[leaderId] : undefined
  const aliveMembers = house.memberIds.filter(
    (pid) => currentState.persons?.[pid]?.alive === true,
  ).length

  const worldState: WorldState | null = currentState ?? null

  const { rebellionTendency, plotTendency } = worldState
    ? calcAmbitionScores(worldState, house.id)
    : { rebellionTendency: 0, plotTendency: 0 }

  const cohesion = worldState ? getHouseCohesion(worldState, house.id) : 50
  const loyaltyToPolity = worldState ? getHouseLoyaltyToPolity(worldState, house.id) : 50

  const levyPower = worldState
    ? getHouseControlledProvinceIds(worldState, house.id).reduce(
        (sum: number, pid) => sum + getProvinceHouseManpowerBase(worldState, defaultConfig, pid),
        0,
      ) * defaultConfig.houseManpowerPowerFactor
    : 0

  const availableWarWealth = Math.max(0, house.wealth - defaultConfig.houseMilitaryWealthReserve)
  const rawMercenaryPower = Math.log1p(availableWarWealth) * defaultConfig.houseWealthMilitaryFactor
  const mercenaryPower = Math.min(
    rawMercenaryPower,
    levyPower * defaultConfig.maxMercenaryPowerRatio,
  )

  const bestWarCommand = worldState
    ? Math.max(0, ...house.memberIds.map((pid) => getRoleScore(worldState, pid, 'warCommand') / 10))
    : 0

  const commanderModifier = clamp(
    1 + normalizedStat(bestWarCommand) * defaultConfig.houseCommanderMartialEffect,
    defaultConfig.minCommanderModifier,
    defaultConfig.maxCommanderModifier,
  )

  const totalMilitaryPower = (levyPower + mercenaryPower) * commanderModifier

  const recentEvents = eventHistory
    .filter((e) => hasEntityId(e, house.id) || house.memberIds.some((mid) => hasEntityId(e, mid)))
    .slice(-3)
    .reverse()

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">
          {resolveName('house', house.nameKey, house.nameKey)}
        </span>
        <div className="flex items-center gap-1.5">
          <CopyJsonButton payload={buildEntitySnapshot('house', house, currentState ?? null)} />
          <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(house.id)} />
        </div>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.primary_polity')}:</span>
          {(() => {
            const primaryPolityId = getHousePrimaryPolityId(currentState, house.id)
            if (!primaryPolityId) return <span className="text-gray-500">\u2014</span>
            const p = currentState.polities[primaryPolityId]
            if (!p) return <span className="text-gray-500">\u2014</span>
            return (
              <button
                className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                onClick={() => onPolityClick(primaryPolityId, 'polity')}
              >
                {resolveName('polity', p.nameKey, p.nameKey)}
              </button>
            )
          })()}
        </div>
        {(() => {
          const ownedIds = getHouseOwnedPolityIds(currentState, house.id)
          if (ownedIds.length <= 1) {
            return (
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.house.owned_polity')}:</span>
                {ownedIds.length === 0 ? (
                  <span className="text-gray-500">\u2014</span>
                ) : (
                  (() => {
                    const pid = ownedIds[0]!
                    const p = currentState.polities[pid]
                    if (!p) return <span className="text-gray-500">\u2014</span>
                    return (
                      <button
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onPolityClick(pid, 'polity')}
                      >
                        {resolveName('polity', p.nameKey, p.nameKey)}
                      </button>
                    )
                  })()
                )}
              </div>
            )
          }
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-gray-400">
                {t('detail.house.owned_polities')} ({ownedIds.length}):
              </span>
              <ul className="flex flex-col gap-0.5 pl-3">
                {ownedIds.map((pid) => {
                  const p = currentState.polities[pid]
                  if (!p) return null
                  return (
                    <li key={pid}>
                      <button
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onPolityClick(pid, 'polity')}
                      >
                        {resolveName('polity', p.nameKey, p.nameKey)}
                      </button>
                      <span className="ml-1 text-xs text-gray-500">
                        ({formatPolityRank(p.rank)})
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })()}
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.seat')}:</span>
          <button
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onProvinceClick(house.seatProvinceId)}
          >
            {(() => {
              const p = currentState.provinces?.[house.seatProvinceId]
              return p ? resolveName('province', p.nameKey, p.nameKey) : house.seatProvinceId
            })()}
          </button>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.prestige')}:</span>
          <span>{formatScore(house.legacyPrestige)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.cohesion')}:</span>
          <span>{formatScore(cohesion)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.loyalty')}:</span>
          <span>{formatScore(loyaltyToPolity)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.wealth')}:</span>
          <span>{formatAmount(house.wealth)}</span>
        </div>
        {/* v0.37: 投影年間収支 (定常収入 = PolitySurplus − 役職給与)。役職任命の可否はこの収支に基づく。 */}
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.projected_income')}:</span>
          <span>
            {worldState ? formatAmount(getHouseProjectedAnnualIncome(worldState, house.id)) : '-'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.office_salary')}:</span>
          <span>
            {worldState ? formatAmount(getHouseAnnualOfficeSalary(worldState, house.id)) : '-'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.office_balance')}:</span>
          <span
            className={
              worldState && getHouseProjectedAnnualBalance(worldState, house.id) < 0
                ? 'text-red-400'
                : 'text-gray-200'
            }
          >
            {worldState ? formatAmount(getHouseProjectedAnnualBalance(worldState, house.id)) : '-'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.provinces')}:</span>
          <span>{worldState ? getHouseControlledProvinceIds(worldState, house.id).length : 0}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.rebellion_tendency')}:</span>
          <span className={rebellionTendency >= 70 ? 'text-red-400' : 'text-gray-200'}>
            {rebellionTendency.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.plot_tendency')}:</span>
          <span className={plotTendency >= 65 ? 'text-yellow-400' : 'text-gray-200'}>
            {plotTendency.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="mt-1 text-sm font-semibold text-gray-300">{t('detail.house.military')}</div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.levy_power')}:</span>
          <span>{formatPower(levyPower)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.mercenary_power')}:</span>
          <span>{formatPower(mercenaryPower)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.commander_mod')}:</span>
          <span>{commanderModifier.toFixed(2)}x</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.total_military')}:</span>
          <span className="font-medium">{formatPower(totalMilitaryPower)}</span>
        </div>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.leader')}:</span>
          {head ? (
            <PersonLink
              personId={leaderId as PersonId}
              persons={currentState.persons ?? {}}
              onClick={onPersonClick}
            />
          ) : (
            <span className="text-gray-500">\u2014</span>
          )}
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-300">{t('detail.house.offices')}</div>
        <div className="text-sm">
          {(['administrator', 'treasurer', 'military', 'advisor'] as const).map((role) => {
            const houseRef = { kind: 'house' as const, id: house.id }
            const holderIds = worldState ? getActiveOfficeHolders(worldState, houseRef, role) : []
            const roleLabel = t(`house.${role}`, { ns: 'roles' })
            return (
              <div key={role} className="flex justify-between">
                <span className="text-gray-400">{roleLabel}:</span>
                <div className="flex flex-col items-end gap-0.5">
                  {holderIds.length === 0 ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    holderIds.map((pid) => (
                      <PersonLink
                        key={pid as string}
                        personId={pid}
                        persons={currentState.persons ?? {}}
                        onClick={onPersonClick}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-300">
          {t('detail.house.top_shareholders')}
        </div>
        {worldState ? (
          <ShareholderSection
            shareholders={getTopShareholders(worldState, { kind: 'house', id: house.id }, 5)}
            persons={currentState.persons ?? {}}
            houses={houses ?? {}}
            onPersonClick={onPersonClick}
            onHouseClick={onHouseClick}
          />
        ) : (
          <span className="text-sm text-gray-500">—</span>
        )}
        <div>
          <div className="text-sm font-semibold text-gray-300">
            {t('detail.house.members')} ({aliveMembers} {t('detail.house.alive')}):
          </div>
          <div className="flex flex-col gap-0.5 text-sm">
            {house.memberIds
              .filter((pid) => currentState?.persons?.[pid]?.alive === true)
              .slice(0, 8)
              .map((pid) => (
                <PersonLink
                  key={pid}
                  personId={pid}
                  persons={currentState?.persons ?? {}}
                  onClick={onPersonClick}
                />
              ))}
            {aliveMembers > 8 && (
              <span className="text-xs text-gray-500">+{aliveMembers - 8} more</span>
            )}
          </div>
        </div>
      </div>

      {house.founderId !== undefined && (
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.founder')}:</span>
          <span>
            {(() => {
              const p = currentState?.persons?.[house.founderId]
              return p ? resolveName('person', p.nameKey, p.nameKey) : house.founderId
            })()}
          </span>
        </div>
      )}
      {house.parentHouseId !== undefined && (
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.parent_house')}:</span>
          <span>
            {(() => {
              const h = currentState?.houses?.[house.parentHouseId]
              return h ? resolveName('house', h.nameKey, h.nameKey) : house.parentHouseId
            })()}
          </span>
        </div>
      )}
      {house.cadetHouseIds.length > 0 && (
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.cadet_houses')}:</span>
          <span>{house.cadetHouseIds.length}</span>
        </div>
      )}
      {house.clanId !== undefined &&
        (() => {
          const clan = currentState.clans[house.clanId]
          if (!clan) return null
          const clanNameHouse = currentState.houses[clan.nameSourceHouseId]
          const clanName = clanNameHouse
            ? resolveName('house', clanNameHouse.nameKey, clanNameHouse.nameKey)
            : clan.id
          const role = getHouseClanRole(currentState, house.id)
          return (
            <>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.clan.name')}:</span>
                <span>
                  {onClanClick ? (
                    <button
                      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                      onClick={() => onClanClick(clan.id)}
                    >
                      {clanName}
                    </button>
                  ) : (
                    clanName
                  )}
                  {role && (
                    <span className="ml-1 text-xs text-gray-500">
                      ({t(`detail.clan.role_${role}`)})
                    </span>
                  )}
                </span>
              </div>
            </>
          )
        })()}

      {recentEvents.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-gray-300">
            {t('detail.house.recent_events')}:
          </div>
          {recentEvents.map((e) => (
            <div key={e.id} className={`text-xs ${getImportanceColor(e.importance)}`}>
              [{e.year}/W{e.weekOfYear}] {renderEvent(e)}
            </div>
          ))}
        </div>
      )}

      {/* v0.38 §8: 家の記録 (永続 Chronicle) */}
      <EntityChronicleSection
        title={t('detail.house.chronicle')}
        entries={getChronicleEntriesForHouse(currentState, house.id)}
      />

      {/* v0.22 Goal/Aim */}
      {currentState &&
        (() => {
          const owner = { kind: 'house' as const, id: house.id }
          const goal = getActiveGoalForOwner(currentState, owner)
          if (!goal) return null
          const activeAims = getActiveAimsForGoal(currentState, goal.id)
          const activeAim = activeAims[0]
          return (
            <div style={{ marginTop: 8 }}>
              <strong>{t('detail.house.current_goal')}</strong>
              <div style={{ marginLeft: 8 }}>
                <div>{t(`goals:house.${goal.kind}`)}</div>
                {goal.reasonIds.length > 0 && currentState && (
                  <ul style={{ margin: '2px 0', paddingLeft: 20 }}>
                    {goal.reasonIds.map((rid) => {
                      const reason = currentState.decisionReasons[rid]
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
                  {t('detail.house.goal_progress')}: {goal.progress} / {goal.targetProgress}
                </div>
              </div>
              {activeAim && (
                <div style={{ marginLeft: 8, marginTop: 4 }}>
                  <strong>{t('detail.house.active_aim')}</strong>
                  <div style={{ marginLeft: 8 }}>
                    <div>{t(`aims:house.${activeAim.kind}`)}</div>
                    <div>
                      {t('detail.house.aim_progress')}: {activeAim.progress} /{' '}
                      {activeAim.targetProgress}
                    </div>
                    <div>
                      {t('detail.house.aim_deadline')}: {t('detail.common.year')}{' '}
                      {Math.ceil(activeAim.deadlineWeek / 48)}
                    </div>
                  </div>
                </div>
              )}
              {activeAim &&
                (() => {
                  const aimKey = `aim:${activeAim.id}`
                  const projectIds = currentState.projectIndex.byAim[aimKey] ?? []
                  const activeProjects = projectIds
                    .map((pid) => currentState.projects[pid])
                    .filter(
                      (p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active',
                    )
                  if (activeProjects.length === 0) return null
                  return activeProjects.map((project) => (
                    <ProjectDetailCard
                      key={project.id}
                      project={project}
                      persons={currentState.persons}
                      onPersonClick={onPersonClick}
                      label={t('detail.house.active_project')}
                    />
                  ))
                })()}
              {activeAim?.activeDiplomaticPlayId &&
                (() => {
                  const play = currentState.diplomaticPlays[activeAim.activeDiplomaticPlayId]
                  if (!play || (play.status !== 'active' && play.status !== 'escalated'))
                    return null
                  return (
                    <div style={{ marginLeft: 8, marginTop: 4 }}>
                      <strong>{t('detail.house.active_play')}</strong>
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
      {currentState &&
        (() => {
          const ownerKey = `house:${house.id}`
          const projectIds = currentState.projectIndex.byOwner[ownerKey] ?? []
          const activeProjects = projectIds
            .map((pid) => currentState.projects[pid])
            .filter((p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active')
          if (activeProjects.length === 0) return null
          return (
            <div className="mt-2">
              <div className="text-sm font-semibold text-gray-300">
                {t('detail.house.projects_section')} ({activeProjects.length})
              </div>
              <ul className="list-inside text-sm">
                {activeProjects.map((project) => (
                  <ProjectListItem
                    key={project.id}
                    project={project}
                    persons={currentState.persons}
                    onPersonClick={onPersonClick}
                  />
                ))}
              </ul>
            </div>
          )
        })()}
    </div>
  )
}
