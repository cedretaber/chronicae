import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { calcPersonImportanceScore } from '@sim/selectors/importanceSelectors'
import { calcPolityMilitaryPower } from '@sim/selectors/militarySelectors'
import { getPolityLegitimacy, getPolityStability } from '@sim/selectors/statusSelectors'
import { getActiveFactions, getFactionActiveMemberIds } from '@sim/selectors/factionSelectors'
import type { SimEvent } from '@sim/types/event'
import { hasEntityId } from '@sim/types/event'
import { useSimulationStore } from '@/app/stores/simulationStore'
import type { Polity } from '@/sim/types/polity'
import type { House } from '@/sim/types/house'
import type { Person } from '@/sim/types/person'
import type { WorldState } from '@/sim/types/world'
import type { Faction } from '@/sim/types/faction'
import type { DiplomaticPlay } from '@/sim/types/diplomaticPlay'
import { getHousePrimaryPolityId } from '@sim/selectors/polityRelations'
import {
  getHouseControlledProvinceIds,
  getHouseOwnedPolityIds,
} from '@sim/selectors/landContractSelectors'
import { buildPolityColorMap } from '@/app/utils/polityColors'
import { formatScore, formatPower, formatPolityRank } from '@/app/utils/format'
import type { PolityRank } from '@/sim/types/polity'
import { defaultConfig } from '@/sim/config/defaultConfig'
import { weekToYearMonthWeek } from '@sim/utils/timeUtils'

type SectionKey = 'countries' | 'houses' | 'persons' | 'factions' | 'watchlist' | 'plays'

const SECTION_KEYS: SectionKey[] = [
  'watchlist',
  'plays',
  'countries',
  'houses',
  'persons',
  'factions',
]

function getRecentEventCount(
  watchId: string,
  eventHistory: SimEvent[],
  currentYear: number,
  currentWeekOfYear: number,
): number {
  const cutoffWeek = currentYear * 48 + currentWeekOfYear - 48
  return eventHistory.filter((e) => {
    const eWeek = e.year * 48 + e.weekOfYear
    return eWeek >= cutoffWeek && hasEntityId(e, watchId)
  }).length
}

function inferWatchlistType(id: string): 'polity' | 'house' | 'person' | null {
  if (id.startsWith('c-')) return 'polity'
  if (id.startsWith('h-')) return 'house'
  if (id.startsWith('pe-')) return 'person'
  return null
}

function PolityRow({
  polity,
  color,
  militaryPower,
  isSelected,
  onClick,
  worldState,
}: {
  polity: Polity
  color: string
  militaryPower: number
  isSelected: boolean
  onClick: () => void
  worldState: WorldState | null
}) {
  const resolveName = useEntityName()
  const legitimacy = worldState ? getPolityLegitimacy(worldState, polity.id) : 50
  const stability = worldState ? getPolityStability(worldState, defaultConfig, polity.id) : 50
  return (
    <div
      className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-700 ${
        isSelected ? 'bg-blue-700' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: color }} />
        <span className="font-bold">{resolveName('polity', polity.nameKey, polity.nameKey)}</span>
      </div>
      <div className="text-gray-300">
        Leg: {formatScore(legitimacy)} | Stab: {formatScore(stability)} | Mil:{' '}
        {formatPower(militaryPower)}
      </div>
    </div>
  )
}

function HouseRow({
  house,
  polityName,
  polityColor,
  provinceCount,
  isSelected,
  onClick,
}: {
  house: House
  provinceCount: number
  polityName: string
  polityColor: string
  isSelected: boolean
  onClick: () => void
}) {
  const resolveName = useEntityName()
  return (
    <div
      className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-700 ${
        isSelected ? 'bg-blue-700' : ''
      }`}
      onClick={onClick}
    >
      <div className="font-bold">{resolveName('house', house.nameKey, house.nameKey)}</div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-sm"
          style={{ background: polityColor }}
        />
        <span>{polityName}</span>
      </div>
      <div className="text-gray-300">
        Prestige: {formatScore(house.legacyPrestige)} | Provinces: {provinceCount}
      </div>
    </div>
  )
}

function PersonRow({
  person,
  score,
  isSelected,
  onClick,
}: {
  person: Person
  score: number
  isSelected: boolean
  onClick: () => void
}) {
  const resolveName = useEntityName()
  return (
    <div
      className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-700 ${
        isSelected ? 'bg-blue-700' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="font-bold">{resolveName('person', person.nameKey, person.nameKey)}</span>
        <span className="text-xs text-yellow-400">{Math.round(score)}</span>
      </div>
      <div className="text-gray-300">
        Age: {person.age} | Governance:{' '}
        {(Math.round(
          person.abilities.numeracy * 0.3 +
            person.abilities.learning * 0.3 +
            person.abilities.charisma * 0.2 +
            person.abilities.insight * 0.2,
        ) /
          10) *
          10}{' '}
        | WarCommand:{' '}
        {(Math.round(
          person.abilities.command * 0.6 +
            person.abilities.insight * 0.2 +
            person.abilities.learning * 0.1 +
            person.abilities.valor * 0.1,
        ) /
          10) *
          10}{' '}
        | Valor: {person.abilities.valor} | Charisma: {person.abilities.charisma}
      </div>
    </div>
  )
}

function FactionRow({
  faction,
  leaderName,
  memberCount,
  isSelected,
  onClick,
}: {
  faction: Faction
  leaderName: string
  memberCount: number
  isSelected: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const founded = weekToYearMonthWeek(faction.foundingWeek)
  return (
    <div
      className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-700 ${
        isSelected ? 'bg-blue-700' : ''
      }`}
      onClick={onClick}
    >
      <div className="font-bold">{leaderName}</div>
      <div className="text-xs text-gray-400">
        {t('detail.faction.leader')}: {leaderName}
      </div>
      <div className="text-gray-300">
        {t('detail.faction.members')}: {memberCount} | {t('detail.faction.founded')}: {founded.year}
        /{founded.month}/{founded.weekOfMonth}
      </div>
    </div>
  )
}

// v0.18 Stage E/F §21: Active DiplomaticPlay 一覧の row
function PlayRow({
  play,
  polities,
  onClick,
}: {
  play: DiplomaticPlay
  polities: Record<string, Polity>
  onClick: () => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const kindLabel: Record<string, string> = {
    revolt_negotiation: t('sidebar.play_kind.revolt'),
    land_claim: t('sidebar.play_kind.claim'),
    contract_tax_revision: t('sidebar.play_kind.tax'),
  }
  const statusBadge: Record<string, { label: string; bg: string }> = {
    active: { label: t('sidebar.play_status.active'), bg: 'bg-blue-700' },
    escalated: { label: t('sidebar.play_status.escalated'), bg: 'bg-red-700' },
  }

  const initiatorNameKey = polities[play.initiator.id]?.nameKey ?? play.initiator.id
  const targetNameKey = polities[play.target.id]?.nameKey ?? play.target.id
  const initiatorName = resolveName('polity', initiatorNameKey, initiatorNameKey)
  const targetName = resolveName('polity', targetNameKey, targetNameKey)
  const badge = statusBadge[play.status] ?? { label: play.status, bg: 'bg-gray-600' }
  const kindLabelText = kindLabel[play.kind] ?? play.kind
  const hasOffer = play.offerHistoryIds.length > 0
  const naturePrefix = play.kind === 'land_claim' ? (hasOffer ? '\u{1F4B0} ' : '\u{2694} ') : ''

  return (
    <div
      className="cursor-pointer border-b border-gray-700/50 px-3 py-1.5 text-sm hover:bg-gray-700"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-white">
          {naturePrefix}
          {kindLabelText}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-xs text-white ${badge.bg}`}>
          {badge.label}
        </span>
      </div>
      <div className="mt-1 truncate text-xs text-gray-300">
        <span className="font-bold">{initiatorName}</span> → {targetName}
      </div>
    </div>
  )
}

function WatchlistRow({
  name,
  type,
  eventCount,
  onRemove,
  onClick,
}: {
  name: string
  type: 'polity' | 'house' | 'person'
  eventCount: number
  onRemove: () => void
  onClick: () => void
}) {
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)

  return (
    <div
      className="group flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-700"
      onClick={onClick}
    >
      <div className="flex items-center gap-2 truncate">
        <span className="font-bold">{name}</span>
        <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-200">{typeLabel}</span>
        {eventCount > 0 && (
          <span className="rounded bg-blue-700 px-1.5 py-0.5 text-xs text-white">{eventCount}</span>
        )}
      </div>
      <button
        className="ml-2 hidden text-gray-400 group-hover:block hover:text-red-400"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        title="Remove from watchlist"
      >
        &times;
      </button>
    </div>
  )
}

export function Sidebar() {
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    countries: true,
    houses: false,
    persons: false,
    factions: false,
    watchlist: false,
    plays: false,
  })
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const toggleSection = (key: SectionKey) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

  const session = useSimulationStore((s) => s.session)
  const openWindows = useSimulationStore((s) => s.openWindows)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)
  const watchlist = useSimulationStore((s) => s.watchlist)
  const toggleWatchlist = useSimulationStore((s) => s.toggleWatchlist)

  const focused =
    openWindows.length === 0
      ? undefined
      : openWindows.reduce((a, b) => (a.zIndex >= b.zIndex ? a : b))
  const focusedType = focused?.entityType
  const focusedId = focused?.entityId

  const eventHistory = useSimulationStore((s) => s.session?.eventHistory ?? [])

  const polities = session?.currentState.polities
  const houses = session?.currentState.houses
  const persons = session?.currentState.persons

  const sortedPolities: Polity[] = polities
    ? Object.values(polities)
        .filter((p) => p.active)
        .sort((a, b) => {
          if (a.rank !== b.rank) return a.rank - b.rank
          return b.legacyPrestige - a.legacyPrestige
        })
    : []

  const polityGroups: { rank: PolityRank; polities: Polity[] }[] = []
  for (const polity of sortedPolities) {
    const last = polityGroups[polityGroups.length - 1]
    if (last && last.rank === polity.rank) {
      last.polities.push(polity)
    } else {
      polityGroups.push({ rank: polity.rank, polities: [polity] })
    }
  }

  const polityColorMap = useMemo(
    () => (polities ? buildPolityColorMap(Object.keys(polities)) : {}),
    [polities],
  )

  const polityMilitaryPowers = useMemo(() => {
    if (!session?.currentState) return {}
    const state = session.currentState
    return Object.fromEntries(
      Object.values(state.polities ?? {}).map((p) => [
        p.id,
        calcPolityMilitaryPower(state, defaultConfig, p.id),
      ]),
    )
  }, [session])

  const houseEntries: { house: House; provinceCount: number }[] = houses
    ? Object.values(houses)
        .filter((h) => h.active && h.kind !== 'system')
        .map((h) => ({
          house: h,
          provinceCount: session?.currentState
            ? getHouseControlledProvinceIds(session.currentState, h.id).length
            : 0,
        }))
        .sort((a, b) => b.house.legacyPrestige - a.house.legacyPrestige)
    : []

  const hasActivePolity = (houseId: import('@sim/types/ids').HouseId): boolean => {
    if (!session?.currentState) return false
    return getHouseOwnedPolityIds(session.currentState, houseId).some((pid) => {
      const p = session.currentState.polities[pid]
      return p?.active === true
    })
  }
  const rulingHouses = houseEntries.filter(
    (e) => e.provinceCount > 0 || hasActivePolity(e.house.id),
  )
  const landlessHouses = houseEntries.filter(
    (e) => e.provinceCount === 0 && !hasActivePolity(e.house.id),
  )

  const sortedPersons: { person: Person; score: number }[] = persons
    ? Object.values(persons)
        .filter((p) => p.alive && p.kind !== 'placeholder')
        .map((p) => ({
          person: p,
          score: session?.currentState
            ? calcPersonImportanceScore(session.currentState, p.id, eventHistory)
            : 0,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
    : []

  const factionEntries: { faction: Faction; leaderName: string; memberCount: number }[] =
    session?.currentState
      ? getActiveFactions(session.currentState)
          .map((f) => {
            const leader = persons?.[f.leaderPersonId]
            return {
              faction: f,
              leaderName: leader
                ? resolveName('person', leader.nameKey, leader.nameKey)
                : '(unknown)',
              memberCount: getFactionActiveMemberIds(session.currentState, f.id).length,
            }
          })
          .sort((a, b) => {
            if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount
            return a.faction.foundingWeek - b.faction.foundingWeek
          })
      : []

  const activePlays: DiplomaticPlay[] = session?.currentState
    ? Object.values(session.currentState.diplomaticPlays)
        .filter(
          (p): p is DiplomaticPlay => !!p && (p.status === 'active' || p.status === 'escalated'),
        )
        .sort((a, b) => {
          // escalated を先、次に deadline 近いもの
          if (a.status !== b.status) return a.status === 'escalated' ? -1 : 1
          return a.deadlineWeek - b.deadlineWeek
        })
    : []

  const sectionCount: Record<SectionKey, number> = {
    countries: sortedPolities.length,
    houses: houseEntries.length,
    persons: sortedPersons.length,
    factions: factionEntries.length,
    watchlist: watchlist.length,
    plays: activePlays.length,
  }

  const renderSectionBody = (key: SectionKey) => {
    if (key === 'countries') {
      const worldState: WorldState | null = session?.currentState ?? null
      return polityGroups.map((group) => (
        <div key={group.rank}>
          <div className="sticky top-0 z-10 border-b border-gray-700 bg-gray-900 px-3 py-1 text-xs font-bold text-gray-400">
            {formatPolityRank(group.rank)}{' '}
            <span className="font-normal text-gray-500">({group.polities.length})</span>
          </div>
          {group.polities.map((polity) => (
            <PolityRow
              key={polity.id}
              polity={polity}
              color={polityColorMap[polity.id] ?? '#888'}
              militaryPower={polityMilitaryPowers[polity.id] ?? 0}
              isSelected={focusedId === polity.id && focusedType === 'polity'}
              onClick={() => openDetailWindow('polity', polity.id)}
              worldState={worldState}
            />
          ))}
        </div>
      ))
    }
    if (key === 'houses') {
      return (
        [
          { key: 'ruling', label: '支配家', entries: rulingHouses },
          { key: 'landless', label: '無領家', entries: landlessHouses },
        ] as const
      ).map((section) => (
        <div key={section.key}>
          <div className="sticky top-0 z-10 border-b border-gray-700 bg-gray-900 px-3 py-1 text-xs font-bold text-gray-400">
            {section.label}{' '}
            <span className="font-normal text-gray-500">({section.entries.length})</span>
          </div>
          {section.entries.map(({ house, provinceCount }) => {
            const primaryPolityId = session?.currentState
              ? getHousePrimaryPolityId(session.currentState, house.id)
              : undefined
            return (
              <HouseRow
                key={house.id}
                house={house}
                polityName={
                  primaryPolityId
                    ? (() => {
                        const p = polities?.[primaryPolityId]
                        return p ? resolveName('polity', p.nameKey, p.nameKey) : ''
                      })()
                    : ''
                }
                polityColor={primaryPolityId ? (polityColorMap[primaryPolityId] ?? '#888') : '#888'}
                provinceCount={provinceCount}
                isSelected={focusedId === house.id && focusedType === 'house'}
                onClick={() => openDetailWindow('house', house.id)}
              />
            )
          })}
        </div>
      ))
    }
    if (key === 'persons') {
      return sortedPersons.map(({ person, score }) => (
        <PersonRow
          key={person.id}
          person={person}
          score={score}
          isSelected={focusedId === person.id && focusedType === 'person'}
          onClick={() => openDetailWindow('person', person.id)}
        />
      ))
    }
    if (key === 'factions') {
      if (factionEntries.length === 0) {
        return (
          <div className="px-3 py-2 text-xs text-gray-500">{t('sidebar.no_active_factions')}</div>
        )
      }
      return factionEntries.map(({ faction, leaderName, memberCount }) => (
        <FactionRow
          key={faction.id}
          faction={faction}
          leaderName={leaderName}
          memberCount={memberCount}
          isSelected={focusedId === faction.id && focusedType === 'faction'}
          onClick={() => openDetailWindow('faction', faction.id)}
        />
      ))
    }
    if (key === 'plays') {
      if (activePlays.length === 0) {
        return <div className="px-3 py-2 text-xs text-gray-500">No active plays</div>
      }
      const politiesMap = polities ?? {}
      return activePlays.map((play) => (
        <PlayRow
          key={play.id}
          play={play}
          polities={politiesMap as Record<string, Polity>}
          onClick={() => openDetailWindow('diplomaticPlay', play.id)}
        />
      ))
    }
    // watchlist
    if (watchlist.length === 0) {
      return <div className="px-3 py-2 text-xs text-gray-500">Watchlist is empty</div>
    }
    return watchlist.map((watchId) => {
      const type = inferWatchlistType(watchId)
      if (!type) return null

      let name = watchId
      if (type === 'polity' && polities) {
        const found = Object.values(polities).find((p) => p.id === watchId)
        if (found) name = resolveName('polity', found.nameKey, found.nameKey)
      } else if (type === 'house' && houses) {
        const found = Object.values(houses).find((h) => h.id === watchId)
        if (found) name = resolveName('house', found.nameKey, found.nameKey)
      } else if (type === 'person' && persons) {
        const found = Object.values(persons).find((p) => p.id === watchId)
        if (found) name = resolveName('person', found.nameKey, found.nameKey)
      }

      const currentState = session?.currentState
      const eventCount = currentState
        ? getRecentEventCount(
            watchId,
            eventHistory,
            currentState.currentYear,
            currentState.currentWeekOfYear,
          )
        : 0

      return (
        <WatchlistRow
          key={watchId}
          name={name}
          type={type}
          eventCount={eventCount}
          onRemove={() => toggleWatchlist(watchId)}
          onClick={() => openDetailWindow(type, watchId)}
        />
      )
    })
  }

  return (
    <div className="flex h-full w-64 flex-col overflow-hidden bg-gray-800 text-white">
      <div className="flex-1 overflow-y-auto">
        {SECTION_KEYS.map((key) => {
          const isOpen = expanded[key]
          return (
            <div key={key} className="border-b border-gray-700">
              <button
                className="sticky top-0 z-20 flex w-full items-center justify-between bg-gray-900 px-3 py-1.5 text-left text-xs font-bold text-gray-200 hover:bg-gray-700"
                onClick={() => toggleSection(key)}
              >
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 text-gray-500">{isOpen ? '▼' : '▶'}</span>
                  <span>{t(`sidebar.${key}`)}</span>
                  <span className="font-normal text-gray-500">({sectionCount[key]})</span>
                </span>
              </button>
              {isOpen && <div>{renderSectionBody(key)}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
