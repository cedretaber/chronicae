import { useState, useMemo } from 'react'
import { calcPersonImportanceScore } from '@sim/selectors/importanceSelectors'
import { calcPolityMilitaryPower } from '@sim/selectors/militarySelectors'
import { getPolityLegitimacy, getPolityStability } from '@sim/selectors/statusSelectors'
import type { SimEvent } from '@sim/types/event'
import { useSimulationStore } from '@/app/stores/simulationStore'
import type { Polity } from '@/sim/types/polity'
import type { House } from '@/sim/types/house'
import type { Person } from '@/sim/types/person'
import type { WorldState } from '@/sim/types/world'
import { getHousePrimaryPolityId } from '@sim/selectors/polityRelations'
import { getHouseControlledProvinceIds } from '@sim/selectors/landContractSelectors'
import { buildPolityColorMap } from '@/app/utils/polityColors'
import { formatScore, formatPower } from '@/app/utils/format'
import { defaultConfig } from '@/sim/config/defaultConfig'

type TabKey = 'countries' | 'houses' | 'persons' | 'watchlist'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'countries', label: 'Countries' },
  { key: 'houses', label: 'Houses' },
  { key: 'persons', label: 'Persons' },
  { key: 'watchlist', label: 'Watchlist' },
]

function getRecentEventCount(
  watchId: string,
  eventHistory: SimEvent[],
  currentYear: number,
  currentMonth: number,
): number {
  const cutoffMonths = currentYear * 12 + currentMonth - 12
  return eventHistory.filter((e) => {
    const eMonths = e.year * 12 + e.month
    return (
      eMonths >= cutoffMonths &&
      (e.actorIds.some((id) => (id as string) === watchId) ||
        e.houseIds.some((id) => (id as string) === watchId) ||
        e.polityIds.some((id) => (id as string) === watchId) ||
        e.provinceIds.some((id) => (id as string) === watchId))
    )
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
        <span className="font-bold">{polity.name}</span>
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
  return (
    <div
      className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-700 ${
        isSelected ? 'bg-blue-700' : ''
      }`}
      onClick={onClick}
    >
      <div className="font-bold">{house.name}</div>
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
  return (
    <div
      className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-700 ${
        isSelected ? 'bg-blue-700' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="font-bold">{person.name}</span>
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
  const [activeTab, setActiveTab] = useState<TabKey>('countries')

  const session = useSimulationStore((s) => s.session)
  const selectedId = useSimulationStore((s) => s.selectedId)
  const selectedType = useSimulationStore((s) => s.selectedType)
  const watchlist = useSimulationStore((s) => s.watchlist)
  const setSelected = useSimulationStore((s) => s.setSelected)
  const toggleWatchlist = useSimulationStore((s) => s.toggleWatchlist)

  const eventHistory = useSimulationStore((s) => s.session?.eventHistory ?? [])

  const polities = session?.currentState.polities
  const houses = session?.currentState.houses
  const persons = session?.currentState.persons

  const sortedPolities: Polity[] = polities
    ? Object.values(polities)
        .filter((p) => p.active)
        .sort((a, b) => b.legacyPrestige - a.legacyPrestige)
    : []

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

  const sortedHouses: House[] = houses
    ? Object.values(houses)
        .filter((h) => h.active)
        .sort((a, b) => b.legacyPrestige - a.legacyPrestige)
    : []

  const sortedPersons: { person: Person; score: number }[] = persons
    ? Object.values(persons)
        .filter((p) => p.alive)
        .map((p) => ({
          person: p,
          score: session?.currentState
            ? calcPersonImportanceScore(session.currentState, p.id, eventHistory)
            : 0,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
    : []

  return (
    <div className="flex h-full w-64 flex-col overflow-hidden bg-gray-800 text-white">
      <div className="flex border-b border-gray-600">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`flex-1 py-1 text-xs ${
              activeTab === tab.key ? 'border-b-2 border-blue-400 bg-gray-700' : 'hover:bg-gray-700'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'countries' &&
          sortedPolities.map((polity) => {
            const worldState: WorldState | null = session?.currentState ?? null
            return (
              <PolityRow
                key={polity.id}
                polity={polity}
                color={polityColorMap[polity.id] ?? '#888'}
                militaryPower={polityMilitaryPowers[polity.id] ?? 0}
                isSelected={selectedId === polity.id && selectedType === 'polity'}
                onClick={() => setSelected(polity.id, 'polity')}
                worldState={worldState}
              />
            )
          })}

        {activeTab === 'houses' &&
          sortedHouses.map((house) => {
            const primaryPolityId = session?.currentState
              ? getHousePrimaryPolityId(session.currentState, house.id)
              : undefined
            return (
              <HouseRow
                key={house.id}
                house={house}
                polityName={primaryPolityId ? (polities?.[primaryPolityId]?.name ?? '') : ''}
                polityColor={primaryPolityId ? (polityColorMap[primaryPolityId] ?? '#888') : '#888'}
                provinceCount={
                  session?.currentState
                    ? getHouseControlledProvinceIds(session.currentState, house.id).length
                    : 0
                }
                isSelected={selectedId === house.id && selectedType === 'house'}
                onClick={() => setSelected(house.id, 'house')}
              />
            )
          })}

        {activeTab === 'persons' &&
          sortedPersons.map(({ person, score }) => (
            <PersonRow
              key={person.id}
              person={person}
              score={score}
              isSelected={selectedId === person.id && selectedType === 'person'}
              onClick={() => setSelected(person.id, 'person')}
            />
          ))}

        {activeTab === 'watchlist' &&
          watchlist.map((watchId) => {
            const type = inferWatchlistType(watchId)
            if (!type) return null

            let name = watchId
            if (type === 'polity' && polities) {
              const found = Object.values(polities).find((p) => p.id === watchId)
              if (found) name = found.name
            } else if (type === 'house' && houses) {
              const found = Object.values(houses).find((h) => h.id === watchId)
              if (found) name = found.name
            } else if (type === 'person' && persons) {
              const found = Object.values(persons).find((p) => p.id === watchId)
              if (found) name = found.name
            }

            const currentState = session?.currentState
            const eventCount = currentState
              ? getRecentEventCount(
                  watchId,
                  eventHistory,
                  currentState.currentYear,
                  currentState.currentMonth,
                )
              : 0

            return (
              <WatchlistRow
                key={watchId}
                name={name}
                type={type}
                eventCount={eventCount}
                onRemove={() => toggleWatchlist(watchId)}
                onClick={() => setSelected(watchId, type)}
              />
            )
          })}
      </div>
    </div>
  )
}
