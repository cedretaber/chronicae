import type { Polity } from '@/sim/types/polity'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getPolityShortName } from '@/app/hooks/entityNameHelpers'
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
  PanelHeader,
  CopyJsonButton,
  WatchButton,
  PolityLandContracts,
  PolityRegiments,
  PolityThreats,
  RightHolderLine,
  EntityChronicleSection,
  CollapsibleSection,
  DetailSection,
  DetailSubSection,
} from './shared/widgets'
import { useCollapsedSections } from '@/app/hooks/useCollapsedSections'
import { ProjectCard } from './shared/ProjectCard'
import {
  formatPolityRank,
  formatAmount,
  formatScore,
  formatPower,
  formatAbsoluteWeek,
} from '@/app/utils/format'
import {
  getPolityLeader,
  getPolityLeaderHouse,
  getAdministrativeCapacity,
  getAdministrativeLoad,
  getAdministrativeEfficiency,
  getActiveOfficeHolders,
  getOfficeAssignments,
  getEffectiveOfficeMaxHolders,
} from '@sim/selectors/officeSelectors'
import {
  getDominantInfluenceHolder,
  getGroupedPolityInfluence,
} from '@sim/selectors/influenceSelectors'
import { getPolityOfficeAppointmentRight } from '@sim/selectors/politicalRightSelectors'
import { InfluenceSection, RepublicPowerProfileSection } from './shared/widgets'
import {
  isEstablishedCommonwealthRepublic,
  getRepublicPowerProfile,
} from '@sim/selectors/republicSelectors'
import { INFLUENCE_LIST_MIN_GROUP_PERCENT } from './shared/constants'
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
  const sections = useCollapsedSections()
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
    // v0.47: titular Polity の leader は統治者ではなく称号保持者。
    leader:
      polity.territorialStatus === 'titular'
        ? t('detail.polity.title_holder')
        : t('detail.polity.ruler'),
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
      <PanelHeader
        title={getPolityShortName(currentState, resolveName, polity.id)}
        badge={
          !polity.active && (
            <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-400">
              {t('detail.annexed')}
            </span>
          )
        }
        actions={
          <>
            <CopyJsonButton payload={buildEntitySnapshot('polity', polity, currentState ?? null)} />
            <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(polity.id)} />
          </>
        }
      />

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.rank')}:</span>
          <span>
            {formatPolityRank(polity.rank)}{' '}
            <span className="text-gray-500">(rank {polity.rank})</span>
            {polity.territorialStatus === 'titular' && (
              <span className="ml-2 rounded bg-amber-900 px-1.5 py-0.5 text-xs text-amber-200">
                {t('detail.polity.titular_badge')}
              </span>
            )}
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
            const dominant = getDominantInfluenceHolder(currentState, defaultConfig, polity.id)
            if (!dominant || dominant.holder.kind !== 'house')
              return <span className="text-gray-500">\u2014</span>
            return (
              <HouseLink
                houseId={dominant.holder.id}
                houses={houses ?? {}}
                onClick={onHouseClick}
              />
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

      <CollapsibleSection
        title={t('detail.polity.administration')}
        open={sections.isOpen('admin')}
        onToggle={() => sections.toggle('admin')}
      >
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
      </CollapsibleSection>

      {/* v0.42 slot 化: 役職カード — slot ごとに着座者 + その slot の任命権保持者を表示。
          leader は slot 概念なし (right 対象外 §4)。effectiveMax を超えた slot に残る
          着座者 (縮小直後の過渡) も行として出す。 */}
      <CollapsibleSection
        title={t('detail.polity.roles')}
        open={sections.isOpen('roles')}
        onToggle={() => sections.toggle('roles')}
      >
        <div className="grid grid-cols-2 gap-1">
          {(['leader', 'administrator', 'military', 'treasurer', 'advisor'] as const).map(
            (role) => {
              const polityRef = { kind: 'polity' as const, id: polity.id }
              if (role === 'leader') {
                const holderIds = worldState
                  ? getActiveOfficeHolders(worldState, polityRef, role)
                  : []
                return (
                  <div key={role} className="rounded bg-gray-700/60 p-1.5 text-xs">
                    <div className="truncate font-medium text-gray-300">{roleLabels[role]}</div>
                    <div className="flex flex-col gap-0.5">
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
              }
              const assignments = worldState
                ? getOfficeAssignments(worldState, polityRef).filter(
                    (o) => o.active && o.role === role,
                  )
                : []
              const effectiveMax = worldState
                ? getEffectiveOfficeMaxHolders(worldState, defaultConfig, polityRef, role)
                : 0
              const bySlot = new Map(assignments.map((o) => [o.slotIndex, o]))
              const slotCount = Math.max(
                effectiveMax,
                ...assignments.map((o) => o.slotIndex + 1),
                0,
              )
              return (
                <div key={role} className="rounded bg-gray-700/60 p-1.5 text-xs">
                  <div className="truncate font-medium text-gray-300">{roleLabels[role]}</div>
                  <div className="flex flex-col gap-0.5">
                    {slotCount === 0 ? (
                      <span className="text-gray-500">—</span>
                    ) : (
                      Array.from({ length: slotCount }, (_, slot) => {
                        const assignment = bySlot.get(slot)
                        const right = worldState
                          ? getPolityOfficeAppointmentRight(worldState, polity.id, role, slot)
                          : undefined
                        return (
                          <div key={slot}>
                            <div className="flex items-baseline gap-1">
                              <span className="shrink-0 text-[11px] text-gray-500">
                                {t('detail.polity.slot_label', { n: slot + 1 })}
                              </span>
                              {assignment ? (
                                <PersonLink
                                  personId={assignment.holderPersonId}
                                  persons={persons}
                                  onClick={onPersonClick}
                                />
                              ) : (
                                <span className="text-gray-600">—</span>
                              )}
                            </div>
                            <div className="pl-3">
                              <RightHolderLine
                                right={right}
                                label={t('detail.polity.appointment_right')}
                                persons={persons ?? {}}
                                houses={houses ?? {}}
                                onPersonClick={onPersonClick}
                                onHouseClick={onHouseClick}
                              />
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            },
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('detail.polity.influence')}
        open={sections.isOpen('influence')}
        onToggle={() => sections.toggle('influence')}
      >
        {worldState ? (
          <InfluenceSection
            grouped={getGroupedPolityInfluence(
              worldState,
              defaultConfig,
              polity.id,
              INFLUENCE_LIST_MIN_GROUP_PERCENT,
            )}
            persons={currentState.persons ?? {}}
            houses={houses ?? {}}
            onPersonClick={onPersonClick}
            onHouseClick={onHouseClick}
          />
        ) : (
          <span className="text-sm text-gray-500">—</span>
        )}
      </CollapsibleSection>

      {/* v0.46 §8: established commonwealth (共和国) の権力分布 (read-model 表示のみ) */}
      {worldState && isEstablishedCommonwealthRepublic(worldState, polity.id) && (
        <RepublicPowerProfileSection
          profile={getRepublicPowerProfile(worldState, defaultConfig, polity.id)}
          dominantThreshold={defaultConfig.republicDominantHolderThreshold}
          persons={currentState.persons ?? {}}
          houses={houses ?? {}}
          onPersonClick={onPersonClick}
          onHouseClick={onHouseClick}
        />
      )}

      <CollapsibleSection
        title={t('detail.polity.houses_with_land')}
        open={sections.isOpen('houses_land')}
        onToggle={() => sections.toggle('houses_land')}
      >
        <ul className="list-inside list-disc text-sm">
          {inHouseNames.length > 0 ? inHouseNames : <li className="text-gray-500">\u2014</li>}
        </ul>
      </CollapsibleSection>

      <PolityThreats polity={polity} worldState={worldState} />

      <PolityLandContracts
        polity={polity}
        worldState={worldState}
        persons={persons ?? {}}
        houses={houses ?? {}}
        onProvinceClick={onProvinceClick}
        onPersonClick={onPersonClick}
        onHouseClick={onHouseClick}
      />

      <PolityRegiments
        polity={polity}
        worldState={worldState}
        persons={persons ?? {}}
        houses={houses ?? {}}
        onPersonClick={onPersonClick}
        onHouseClick={onHouseClick}
      />

      {/* v0.22 Goal/Aim */}
      {worldState &&
        (() => {
          const owner = { kind: 'polity' as const, id: polity.id }
          const goal = getActiveGoalForOwner(worldState, owner)
          if (!goal) return null
          const activeAims = getActiveAimsForGoal(worldState, goal.id)
          return (
            <>
              <DetailSection title={t('detail.polity.current_goal')} />
              <div className="ml-2 text-sm">
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
              {activeAims.map((activeAim) => (
                <div key={activeAim.id}>
                  <DetailSubSection title={t('detail.polity.active_aim')} />
                  <div className="ml-2 text-sm">
                    <div>{t(`aims:polity.${activeAim.kind}`)}</div>
                    <div>
                      {t('detail.polity.aim_progress')}: {activeAim.progress} /{' '}
                      {activeAim.targetProgress}
                    </div>
                    <div>
                      {t('detail.polity.aim_deadline')}:{' '}
                      {formatAbsoluteWeek(activeAim.deadlineWeek)}
                    </div>
                  </div>
                  {worldState &&
                    (() => {
                      const aimKey = `aim:${activeAim.id}`
                      const projectIds = worldState.projectIndex.byAim[aimKey] ?? []
                      const activeProjects = projectIds
                        .map((pid) => worldState.projects[pid])
                        .filter(
                          (p): p is NonNullable<typeof p> =>
                            p !== undefined && p.status === 'active',
                        )
                      if (activeProjects.length === 0) return null
                      return activeProjects.map((project) => (
                        <div key={project.id} className="mt-1 ml-2">
                          <ProjectCard project={project} worldState={worldState} />
                        </div>
                      ))
                    })()}
                  {activeAim.activeDiplomaticPlayId &&
                    (() => {
                      const play = worldState.diplomaticPlays[activeAim.activeDiplomaticPlayId]
                      if (!play || (play.status !== 'active' && play.status !== 'escalated'))
                        return null
                      return (
                        <>
                          <DetailSubSection title={t('detail.polity.active_play')} />
                          <div className="ml-2 text-sm">
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
                        </>
                      )
                    })()}
                </div>
              ))}
            </>
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
            <>
              <DetailSection
                title={t('detail.polity.projects_section')}
                count={activeProjects.length}
              />
              <div className="mt-1 flex flex-col gap-1">
                {activeProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} worldState={worldState} />
                ))}
              </div>
            </>
          )
        })()}

      {/* v0.38 §8: 国史 (永続 Chronicle) */}
      {worldState && (
        <EntityChronicleSection
          title={t('detail.polity.chronicle')}
          entries={getChronicleEntriesForPolity(worldState, polity.id)}
          entityType="polity"
          entityId={polity.id}
        />
      )}
    </div>
  )
}
