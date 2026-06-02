import type { Person } from '@/sim/types/person'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import type { FactionId } from '@/sim/types/ids'
import type { SimEvent } from '@/sim/types/event'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { useState } from 'react'
import { calcPersonImportanceScore } from '@/sim/selectors/importanceSelectors'
import { getPersonPrimaryPolityId } from '@sim/selectors/polityRelations'
import {
  PanelHeader,
  CopyJsonButton,
  WatchButton,
  AttitudeList,
  ProjectListItem,
  EntityChronicleSection,
} from './shared/widgets'
import { HouseLink, PersonLink } from './shared/links'
import { isLandlessHouseMember, isHouselessPerson } from '@sim/selectors/availabilitySelectors'
import { getFactionByLeader, getActiveFactionMembership } from '@sim/selectors/factionSelectors'
import { getBailiffPolicy } from '@sim/selectors/bailiffSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { AbilityRadarChart } from './shared/charts'
import { ABILITY_KEYS } from './shared/constants'
import { ABILITY_AGE_CURVES } from '@sim/constants/abilityConstants'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { formatScore, formatAmount } from '@/app/utils/format'
import { getActiveGoalForOwner, getActiveAimForOwner } from '@sim/selectors/goalSelectors'
import { getPersonGoalFulfillment } from '@sim/selectors/personGoalSelectors'
import { computeEffectivePriority } from '@sim/selectors/taskSelectors'
import { getChronicleEntriesForPerson } from '@sim/selectors/chronicleSelectors'

export function PersonDetail({
  person,
  session,
  watchlist,
  toggleWatchlist,
  onHouseClick,
  onPolityClick,
  onPersonClick,
  onFactionClick,
  onProvinceClick,
  eventHistory,
}: {
  person: Person
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onHouseClick: ClickHandler
  onPolityClick: ClickHandler
  onPersonClick: (id: string) => void
  onFactionClick: (id: FactionId) => void
  onProvinceClick: (id: string) => void
  eventHistory: SimEvent[]
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const [abilityView, setAbilityView] = useState<'table' | 'radar'>('table')
  const isWatching = watchlist.includes(person.id)
  const currentState = session?.currentState
  const worldState: WorldState = currentState ?? {
    currentYear: 0,
    currentWeekOfYear: 0,
    absoluteWeek: 0,
    provinces: {},
    holdings: {},
    states: {},
    polities: {},
    houses: {},
    persons: {},
    livingPersonIds: [],
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    landContracts: {},
    holdingOfficeAssignments: {},
    holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    landContractIndex: { byProvince: {}, byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    holdingImprovements: {},
    holdingImprovementIndex: { byHolding: {} },
    nextHoldingImprovementId: 0,
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    nextLandContractId: 0,
    nextHoldingOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    projects: {},
    projectIndex: {
      byOwner: {},
      byAim: {},
      byParentProject: {},
      byCreatorPerson: {},
      bySupervisorPerson: {},
      byRelatedEntity: {},
    },
    diplomaticPlays: {},
    diplomaticOffers: {},
    pressures: {},
    pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
    chronicleEntries: {},
    chronicleIndex: { byPerson: {}, byHouse: {}, byPolity: {}, byProvince: {}, byHolding: {} },
    nextChronicleEntryId: 0,
    nextProjectId: 0,
    nextDiplomaticPlayId: 0,
    wars: {},
    warIndex: { byParticipant: {}, byOriginDiplomaticPlay: {} },
    regiments: {},
    regimentIndex: { byOwner: {}, byWar: {}, byHomeProvince: {}, byHomeHolding: {} },
    nextRegimentId: 0,
    battles: {},
    battleIndex: { byWar: {} },
    nextBattleId: 0,
    nextWarId: 0,
    nextDiplomaticOfferId: 0,
    nextPressureId: 1,
    // v0.22 Goal/Aim system
    goals: {},
    aims: {},
    decisionReasons: {},
    goalIndex: { byOwner: {} },
    aimIndex: { byOwner: {}, byGoal: {} },
    nextGoalId: 0,
    nextAimId: 0,
    nextDecisionReasonId: 0,
    tasks: {},
    taskIndex: { byAssignee: {}, byOwner: {}, byTarget: {} },
    personActivityLogs: {},
    personActivityLogIndex: { byPerson: {} },
    personTrainingExperience: {},
    popIndex: { byHolding: {} },
    nextPopGroupId: 0,
    waitingAimIds: [],
    nextTaskId: 0,
    nextPersonActivityLogId: 0,
    clans: {},
    nextClanId: 1,
  }
  const allOfficeIds = worldState.officeIndex.byHolderPerson[person.id] ?? []
  const allOffices = allOfficeIds.flatMap((id) => {
    const o = worldState.officeAssignments[id]
    return o && o.active ? [o] : []
  })
  const importanceScore = calcPersonImportanceScore(worldState, person.id, eventHistory)

  const primaryPolityId = getPersonPrimaryPolityId(worldState, person.id)

  const ROLE_ORDER = ['leader', 'administrator', 'treasurer', 'military', 'advisor']

  function officeDisplayName(office: (typeof allOffices)[number]): string {
    return t(`${office.organization.kind}.${office.role}`, { ns: 'roles' })
  }

  function officeOrgName(office: (typeof allOffices)[number]): string {
    const org = office.organization
    if (org.kind === 'polity') {
      const p = worldState.polities[org.id]
      return p ? resolveName('polity', p.nameKey, p.nameKey) : org.id
    }
    const h = worldState.houses[org.id]
    return h ? resolveName('house', h.nameKey, h.nameKey) : org.id
  }

  const sortByRole = (a: (typeof allOffices)[number], b: (typeof allOffices)[number]) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)

  const polityOffices = allOffices.filter((o) => o.organization.kind === 'polity').sort(sortByRole)
  const houseOffices = allOffices.filter((o) => o.organization.kind === 'house').sort(sortByRole)

  const bailiffAssignmentIds = worldState.holdingOfficeIndex.byHolderPerson[person.id] ?? []
  const bailiffAssignments = bailiffAssignmentIds.flatMap((aid) => {
    const a = worldState.holdingOfficeAssignments[aid]
    return a && a.active ? [a] : []
  })

  return (
    <div className="flex flex-col gap-1 p-3">
      <PanelHeader
        title={resolveName('person', person.nameKey, person.nameKey)}
        actions={
          <>
            <CopyJsonButton payload={buildEntitySnapshot('person', person, currentState ?? null)} />
            <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(person.id)} />
          </>
        }
      />

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.age')}:</span>
          <span>{person.age}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.alive')}:</span>
          <span>
            {person.alive
              ? t('detail.person.alive_yes')
              : person.deathCircumstance === 'faded_from_history'
                ? `${t('detail.person.faded')} (${worldState.currentYear})`
                : t('detail.person.alive_no')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.house')}:</span>
          {!person.houseId ? (
            <span className="text-gray-400">({t('detail.person.houseless')})</span>
          ) : (
            <span className="flex items-center gap-1">
              <HouseLink
                houseId={person.houseId}
                houses={currentState?.houses ?? {}}
                onClick={onHouseClick}
              />
              {isLandlessHouseMember(worldState, person.id) && (
                <span className="text-xs text-amber-400">(landless)</span>
              )}
            </span>
          )}
        </div>
        {person.occupation && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.person.occupation')}:</span>
            <span>
              {t(`detail.occupations.${person.occupation}`, { defaultValue: person.occupation })}
            </span>
          </div>
        )}
        {(() => {
          const factionAsLeader = getFactionByLeader(worldState, person.id)
          const membership = getActiveFactionMembership(worldState, person.id)
          if (!factionAsLeader && !membership) return null
          const targetFactionId = factionAsLeader?.id ?? membership?.factionId
          const faction = targetFactionId ? worldState.factions[targetFactionId] : undefined
          if (!faction) return null
          const roleLabel = factionAsLeader ? 'leader' : 'member'
          const factionLeader = worldState.persons[faction.leaderPersonId]
          const factionDisplayName = factionLeader
            ? `${factionLeader.nameKey}'s faction`
            : faction.id
          return (
            <div className="flex justify-between">
              <span className="text-gray-400">{t('detail.person.faction')}:</span>
              <span>
                ◈{' '}
                <button
                  className="cursor-pointer text-blue-400 underline underline-offset-2 hover:text-blue-300"
                  onClick={() => onFactionClick(faction.id)}
                >
                  {factionDisplayName}
                </button>{' '}
                <span className="text-xs text-gray-500">({roleLabel})</span>
              </span>
            </div>
          )
        })()}
        {isHouselessPerson(worldState, person.id) && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.person.status')}:</span>
            <span className="text-amber-400">{t('detail.person.houseless')}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.primary_polity')}:</span>
          {(() => {
            if (!primaryPolityId) return <span className="text-gray-500">\u2014</span>
            if (!currentState) return <span className="text-gray-500">\u2014</span>
            const p = currentState.polities?.[primaryPolityId]
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
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.sex')}:</span>
          <span>
            {person.sex === 'male'
              ? t('sex.male', { ns: 'statuses' })
              : person.sex === 'female'
                ? t('sex.female', { ns: 'statuses' })
                : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.birth_status')}:</span>
          <span>
            {person.birthStatus === 'legitimate'
              ? t('birth_status.legitimate', { ns: 'statuses' })
              : person.birthStatus === 'illegitimate'
                ? t('birth_status.illegitimate', { ns: 'statuses' })
                : t('birth_status.unknown', { ns: 'statuses' })}
          </span>
        </div>
        <div className="mt-1">
          <span className="text-sm text-gray-400">{t('detail.person.offices')}</span>
          {allOffices.length === 0 && bailiffAssignments.length === 0 ? (
            <div className="ml-1 text-sm text-gray-500">—</div>
          ) : (
            <div className="ml-1 text-sm">
              {polityOffices.length > 0 && (
                <div>
                  <span className="text-xs text-gray-500">
                    {t('detail.person.country_offices')}
                  </span>
                  {polityOffices.map((o) => (
                    <div key={o.id} className="flex justify-between gap-2">
                      <span className="text-gray-300">{officeDisplayName(o)}</span>
                      <span className="text-right text-gray-200">{officeOrgName(o)}</span>
                    </div>
                  ))}
                </div>
              )}
              {houseOffices.length > 0 && (
                <div className={polityOffices.length > 0 ? 'mt-0.5' : ''}>
                  <span className="text-xs text-gray-500">{t('detail.person.house_offices')}</span>
                  {houseOffices.map((o) => (
                    <div key={o.id} className="flex justify-between gap-2">
                      <span className="text-gray-300">{officeDisplayName(o)}</span>
                      <span className="text-right text-gray-200">{officeOrgName(o)}</span>
                    </div>
                  ))}
                </div>
              )}
              {bailiffAssignments.length > 0 && (
                <div
                  className={polityOffices.length > 0 || houseOffices.length > 0 ? 'mt-0.5' : ''}
                >
                  <span className="text-xs text-gray-500">
                    {t('detail.person.bailiff_offices')}
                  </span>
                  {bailiffAssignments.map((a) => {
                    const holding = worldState.holdings[a.holdingId]
                    const policy = getBailiffPolicy(worldState, defaultConfig, a.id)
                    const policyColor: Record<string, string> = {
                      passive: 'text-gray-400',
                      loyal_remittance: 'text-blue-400',
                      profit_seeking: 'text-amber-400',
                      protect_residents: 'text-green-400',
                    }
                    return (
                      <div key={a.id} className="flex items-center justify-between gap-2">
                        <span className="text-gray-300">
                          {t('holding.bailiff', { ns: 'roles' })}
                          <span
                            className={`ml-1 text-xs ${policyColor[policy] ?? 'text-gray-300'}`}
                          >
                            ({t(`detail.province.bailiff_policy_${policy}`)})
                          </span>
                        </span>
                        <button
                          className="text-right text-blue-400 underline underline-offset-2 hover:text-blue-300"
                          onClick={() => onProvinceClick(holding?.provinceId ?? '')}
                        >
                          {holding
                            ? (worldState.provinces[holding.provinceId]?.nameKey ?? a.holdingId)
                            : a.holdingId}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-300">{t('detail.person.abilities')}</span>
        <div className="flex gap-0.5 rounded bg-gray-700 p-0.5 text-[10px]">
          <button
            className={`rounded px-1.5 py-0.5 ${abilityView === 'table' ? 'bg-gray-500 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
            onClick={() => setAbilityView('table')}
          >
            Table
          </button>
          <button
            className={`rounded px-1.5 py-0.5 ${abilityView === 'radar' ? 'bg-gray-500 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
            onClick={() => setAbilityView('radar')}
          >
            Radar
          </button>
        </div>
      </div>
      {abilityView === 'table' ? (
        <div className="text-sm">
          {ABILITY_KEYS.map((key) => {
            const label = t(`detail.person.ability_${key}`)
            const curve = ABILITY_AGE_CURVES[key]
            const curveIcon = curve === 'youthPeak' ? '▲' : curve === 'midLifePeak' ? '●' : '↗'
            const curveColor =
              curve === 'youthPeak'
                ? 'text-yellow-400'
                : curve === 'midLifePeak'
                  ? 'text-orange-400'
                  : 'text-green-400'
            const abilityPct = (person.abilities[key] / 120) * 100
            const aptitudePct = (person.aptitudes[key] / 120) * 100
            return (
              <div key={key} className="mb-0.5">
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    <span className={`mr-1 text-xs ${curveColor}`}>{curveIcon}</span>
                    {label}:
                  </span>
                  <span>
                    <span className="text-gray-100">{person.abilities[key]}</span>
                    <span className="text-gray-500"> / </span>
                    <span className="text-gray-400">{person.aptitudes[key]}</span>
                  </span>
                </div>
                <div className="relative h-1 w-full rounded bg-gray-600">
                  <div
                    className="absolute h-1 rounded bg-gray-400"
                    style={{ width: `${aptitudePct}%` }}
                  />
                  <div
                    className="absolute h-1 rounded bg-blue-400"
                    style={{ width: `${abilityPct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div>
          <AbilityRadarChart abilities={person.abilities} aptitudes={person.aptitudes} />
          <div className="mt-1 flex justify-center gap-3 text-[10px]">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded bg-blue-400/40" />
              <span className="text-gray-400">{t('detail.person.ability')}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded bg-gray-400/30" />
              <span className="text-gray-400">{t('detail.person.aptitude')}</span>
            </span>
          </div>
        </div>
      )}

      <div className="text-sm font-semibold text-gray-300">
        {t('detail.person.derived_scores')}:
      </div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.governance')}:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'governance') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.stewardship')}:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'stewardship') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.diplomacy')}:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'diplomacy') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.intrigue')}:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'intrigue') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.war_command')}:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'warCommand') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.prestige')}:</span>
          <span>{formatScore(person.legacyPrestige)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.wealth')}:</span>
          <span>{formatAmount(person.wealth)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.importance')}:</span>
          <span className="text-yellow-400">{Math.round(importanceScore)}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">{t('detail.person.traits')}:</div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.ambition')}:</span>
          <span>{formatScore(person.traits.ambition)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.caution')}:</span>
          <span>{formatScore(person.traits.caution)}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">{t('detail.person.family')}:</div>
      <div className="text-sm">
        {person.fatherId !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.person.father')}:</span>
            <PersonLink
              personId={person.fatherId}
              persons={currentState?.persons ?? {}}
              onClick={onPersonClick}
            />
          </div>
        )}
        {person.motherId !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.person.mother')}:</span>
            <PersonLink
              personId={person.motherId}
              persons={currentState?.persons ?? {}}
              onClick={onPersonClick}
            />
          </div>
        )}
        {person.spouseId !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.person.spouse')}:</span>
            <PersonLink
              personId={person.spouseId}
              persons={currentState?.persons ?? {}}
              onClick={onPersonClick}
            />
          </div>
        )}
        {person.childIds.length > 0 && (
          <div>
            <div className="text-gray-400">{t('detail.person.children')}:</div>
            <div className="flex flex-col gap-0.5">
              {person.childIds.slice(0, 8).map((cid) => (
                <PersonLink
                  key={cid}
                  personId={cid}
                  persons={currentState?.persons ?? {}}
                  onClick={onPersonClick}
                />
              ))}
              {person.childIds.length > 8 && (
                <span className="text-xs text-gray-500">+{person.childIds.length - 8} more</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="text-sm font-semibold text-gray-300">{t('detail.person.attitudes')}:</div>
      <AttitudeList
        attitudes={person.attitudes}
        worldState={worldState}
        onPolityClick={onPolityClick}
        onHouseClick={onHouseClick}
        onPersonClick={onPersonClick}
      />

      {/* v0.23 Person Goal/Aim */}
      {person.alive &&
        person.kind !== 'placeholder' &&
        (() => {
          const owner = { kind: 'person' as const, id: person.id }
          const goal = getActiveGoalForOwner(worldState, owner)
          if (!goal) return null
          const fulfillment = getPersonGoalFulfillment(worldState, person.id)
          const activeAim = getActiveAimForOwner(worldState, owner)

          return (
            <>
              <div className="text-sm font-semibold text-gray-300">
                {t('detail.person.current_goal')}:
              </div>
              <div className="text-sm" style={{ marginLeft: 8 }}>
                <div>{t(`goals:person.${goal.kind}`)}</div>
                <div>
                  {t('detail.person.goal_fulfillment')}: {Math.round(fulfillment)}%
                </div>
              </div>

              {activeAim && (
                <>
                  <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 4 }}>
                    {t('detail.person.active_aim')}:
                  </div>
                  <div className="text-sm" style={{ marginLeft: 8 }}>
                    <div>{t(`aims:person.${activeAim.kind}`)}</div>
                    <div>
                      {t('detail.person.aim_progress')}: {activeAim.progress} /{' '}
                      {activeAim.targetProgress}
                    </div>
                    <div>
                      {t('detail.person.aim_deadline')}: {t('detail.common.year')}{' '}
                      {Math.ceil(activeAim.deadlineWeek / 48)}
                    </div>
                    {activeAim.waitingReasonKey && (
                      <div className="text-xs text-yellow-400">
                        {t('detail.person.aim_status_waiting')}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )
        })()}

      {/* Task list + Activity log (independent of Goal) */}
      {person.alive &&
        person.kind !== 'placeholder' &&
        (() => {
          const taskIds = worldState.taskIndex.byAssignee[person.id as string] ?? []
          const activeTasks = taskIds
            .map((tid) => worldState.tasks[tid])
            .filter((t): t is NonNullable<typeof t> => t !== undefined && t.status === 'active')
            .sort(
              (a, b) =>
                computeEffectivePriority(worldState, defaultConfig, b) -
                computeEffectivePriority(worldState, defaultConfig, a),
            )
          const activityLogIds =
            worldState.personActivityLogIndex.byPerson[person.id as string] ?? []
          const recentLogs = activityLogIds
            .map((lid) => worldState.personActivityLogs[lid])
            .filter((l): l is NonNullable<typeof l> => l !== undefined)
            .sort((a, b) => b.week - a.week)
            .slice(0, 5)

          if (activeTasks.length === 0 && recentLogs.length === 0) return null

          return (
            <>
              {activeTasks.length > 0 && (
                <>
                  <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 4 }}>
                    {t('detail.person.assigned_tasks')} ({activeTasks.length}):
                  </div>
                  <div className="text-sm" style={{ marginLeft: 8 }}>
                    {activeTasks.map((task) => {
                      const ep = computeEffectivePriority(worldState, defaultConfig, task)
                      return (
                        <div
                          key={task.id}
                          className="mb-1 rounded bg-gray-700/50 px-2 py-1 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-gray-200">{t(task.kind, { ns: 'tasks' })}</span>
                            <span className="text-gray-500">P:{ep}</span>
                          </div>
                          <div className="text-gray-400">
                            {t('detail.person.task_effort')}: {Math.round(task.effortDone)} /{' '}
                            {task.effortRequired}
                          </div>
                          <div className="text-gray-500">
                            {task.targetRef.kind === 'aim' &&
                              (() => {
                                const aim = worldState.aims[task.targetRef.id]
                                if (!aim) return t('detail.person.task_target_aim')
                                if (
                                  aim.owner.kind === 'person' &&
                                  (aim.owner.id as string) === (person.id as string)
                                ) {
                                  return t('detail.person.task_target_own_aim')
                                }
                                if (aim.owner.kind === 'house') {
                                  const h = worldState.houses[aim.owner.id]
                                  const name = h
                                    ? resolveName('house', h.nameKey, h.nameKey)
                                    : aim.owner.id
                                  return t('detail.person.task_target_house_aim', { name })
                                }
                                if (aim.owner.kind === 'polity') {
                                  const p = worldState.polities[aim.owner.id]
                                  const name = p
                                    ? resolveName('polity', p.nameKey, p.nameKey)
                                    : aim.owner.id
                                  return t('detail.person.task_target_polity_aim', { name })
                                }
                                return t('detail.person.task_target_aim')
                              })()}
                            {task.targetRef.kind === 'project' &&
                              (() => {
                                if (task.owner.kind === 'house') {
                                  const h = worldState.houses[task.owner.id]
                                  const name = h
                                    ? resolveName('house', h.nameKey, h.nameKey)
                                    : task.owner.id
                                  return t('detail.person.task_target_house_project', { name })
                                }
                                if (task.owner.kind === 'polity') {
                                  const p = worldState.polities[task.owner.id]
                                  const name = p
                                    ? resolveName('polity', p.nameKey, p.nameKey)
                                    : task.owner.id
                                  return t('detail.person.task_target_polity_project', { name })
                                }
                                return t('detail.person.task_target_project')
                              })()}
                            {task.targetRef.kind === 'diplomatic_play' &&
                              (() => {
                                if (task.owner.kind === 'house') {
                                  const h = worldState.houses[task.owner.id]
                                  const name = h
                                    ? resolveName('house', h.nameKey, h.nameKey)
                                    : task.owner.id
                                  return t('detail.person.task_target_house_play', { name })
                                }
                                if (task.owner.kind === 'polity') {
                                  const p = worldState.polities[task.owner.id]
                                  const name = p
                                    ? resolveName('polity', p.nameKey, p.nameKey)
                                    : task.owner.id
                                  return t('detail.person.task_target_polity_play', { name })
                                }
                                return t('detail.person.task_target_play')
                              })()}
                            {task.targetRef.kind === 'holding_office_assignment' &&
                              (() => {
                                const hoa = worldState.holdingOfficeAssignments[task.targetRef.id]
                                if (!hoa) return t('detail.person.task_target_bailiff_duty')
                                const holding = worldState.holdings[hoa.holdingId]
                                if (!holding) return t('detail.person.task_target_bailiff_duty')
                                const prov = worldState.provinces[holding.provinceId]
                                const name = prov
                                  ? resolveName('province', prov.nameKey, prov.nameKey)
                                  : (holding.provinceId as string)
                                return t('detail.person.task_target_bailiff_holding', { name })
                              })()}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {recentLogs.length > 0 && (
                <>
                  <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 4 }}>
                    {t('detail.person.recent_activities')}:
                  </div>
                  <div className="text-sm" style={{ marginLeft: 8 }}>
                    {recentLogs.map((log) => (
                      <div
                        key={log.id}
                        className={`text-xs ${'outcome' in log ? (log.outcome === 'success' ? 'text-green-400' : log.outcome === 'failure' ? 'text-red-400' : 'text-gray-400') : log.kind === 'project_completed' ? 'text-blue-400' : 'text-red-400'}`}
                      >
                        [Y{Math.ceil(log.week / 48)}/W{((log.week - 1) % 48) + 1}]{' '}
                        {'taskKind' in log ? (
                          <>
                            {t(log.taskKind, { ns: 'tasks' })}{' '}
                            {log.outcome === 'success' ? '✓' : '✗'}
                          </>
                        ) : (
                          <>
                            {log.params?.improvementKind
                              ? t(
                                  `detail.activity.${log.kind === 'project_completed' ? 'project_completed' : 'project_failed'}`,
                                  {
                                    kind: t(
                                      `detail.province.improvement_${log.params.improvementKind}`,
                                      { defaultValue: String(log.params.improvementKind) },
                                    ),
                                    level: log.params.targetLevel ?? '?',
                                  },
                                )
                              : `${t(`detail.project_kind.${log.projectKind}`)} ${log.kind === 'project_completed' ? '✓' : '✗'}`}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )
        })()}

      {/* Supervised / Created Projects */}
      {(() => {
        const pKey = person.id as string
        const supervisedIds = worldState.projectIndex.bySupervisorPerson[pKey] ?? []
        const supervisedProjects = supervisedIds
          .map((pid) => worldState.projects[pid])
          .filter((p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active')
        const createdIds = worldState.projectIndex.byCreatorPerson[pKey] ?? []
        const createdProjects = createdIds
          .map((pid) => worldState.projects[pid])
          .filter(
            (p): p is NonNullable<typeof p> =>
              p !== undefined && p.status === 'active' && (p.supervisorPersonId as string) !== pKey,
          )
        if (supervisedProjects.length === 0 && createdProjects.length === 0) return null
        return (
          <div className="mt-2">
            {supervisedProjects.length > 0 && (
              <>
                <div className="text-sm font-semibold text-gray-300">
                  {t('detail.person.supervised_projects')} ({supervisedProjects.length})
                </div>
                <ul className="list-inside text-sm">
                  {supervisedProjects.map((project) => (
                    <ProjectListItem
                      key={project.id}
                      project={project}
                      persons={worldState.persons}
                      onPersonClick={onPersonClick}
                      showSupervisor={false}
                    />
                  ))}
                </ul>
              </>
            )}
            {createdProjects.length > 0 && (
              <>
                <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 4 }}>
                  {t('detail.person.created_projects')} ({createdProjects.length})
                </div>
                <ul className="list-inside text-sm">
                  {createdProjects.map((project) => (
                    <ProjectListItem
                      key={project.id}
                      project={project}
                      persons={worldState.persons}
                      onPersonClick={onPersonClick}
                    />
                  ))}
                </ul>
              </>
            )}
          </div>
        )
      })()}

      {/* v0.38 §8: 履歴 (永続 Chronicle) */}
      <EntityChronicleSection
        title={t('detail.person.chronicle')}
        entries={getChronicleEntriesForPerson(worldState, person.id)}
      />
    </div>
  )
}
