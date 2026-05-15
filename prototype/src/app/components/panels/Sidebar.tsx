import { useState, useMemo } from 'react'
import { calcPersonImportanceScore } from '@sim/selectors/importanceSelectors'
import { calcCountryMilitaryPower } from '@sim/selectors/militarySelectors'
import type { SimEvent } from '@sim/types/event'
import { useSimulationStore } from '@/app/stores/simulationStore'
import type { Country } from '@/sim/types/country'
import type { House } from '@/sim/types/house'
import type { Person } from '@/sim/types/person'
import type { WorldState } from '@/sim/types/world'
import { buildCountryColorMap } from '@/app/utils/countryColors'
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
        e.countryIds.some((id) => (id as string) === watchId) ||
        e.provinceIds.some((id) => (id as string) === watchId))
    )
  }).length
}

function inferWatchlistType(id: string): 'country' | 'house' | 'person' | null {
  if (id.startsWith('c-')) return 'country'
  if (id.startsWith('h-')) return 'house'
  if (id.startsWith('pe-')) return 'person'
  return null
}

function CountryRow({
  country,
  color,
  militaryPower,
  isSelected,
  onClick,
}: {
  country: Country
  color: string
  militaryPower: number
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
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: color }} />
        <span className="font-bold">{country.name}</span>
      </div>
      <div className="text-gray-300">
        Leg: {formatScore(country.legitimacy)} | Stab: {formatScore(country.stability)} | Mil:{' '}
        {formatPower(militaryPower)}
      </div>
    </div>
  )
}

function HouseRow({
  house,
  countryName,
  countryColor,
  isSelected,
  onClick,
}: {
  house: House
  countryName: string
  countryColor: string
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
          style={{ background: countryColor }}
        />
        <span>{countryName}</span>
      </div>
      <div className="text-gray-300">
        Prestige: {formatScore(house.prestige)} | Provinces: {house.provinceIds.length}
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
        Age: {person.age} | Admin: {person.stats.admin} | Martial: {person.stats.martial}
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
  type: 'country' | 'house' | 'person'
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

  const countries = session?.currentState.countries
  const houses = session?.currentState.houses
  const persons = session?.currentState.persons

  const sortedCountries: Country[] = countries
    ? Object.values(countries)
        .filter((c) => c.active)
        .sort((a, b) => b.legitimacy - a.legitimacy)
    : []

  const countryColorMap = useMemo(
    () => (countries ? buildCountryColorMap(Object.keys(countries)) : {}),
    [countries],
  )

  const countryMilitaryPowers = useMemo(() => {
    if (!session?.currentState) return {}
    const state = session.currentState
    const worldState: WorldState = {
      currentYear: state.currentYear,
      currentMonth: state.currentMonth,
      provinces: state.provinces,
      countries: state.countries,
      houses: state.houses,
      persons: state.persons,
      activePlots: state.activePlots ?? {},
      popGroups: state.popGroups ?? {},
    }
    return Object.fromEntries(
      Object.values(state.countries ?? {}).map((c) => [
        c.id,
        calcCountryMilitaryPower(worldState, defaultConfig, c.id),
      ]),
    )
  }, [session])

  const sortedHouses: House[] = houses
    ? Object.values(houses)
        .filter((h) => h.active)
        .sort((a, b) => b.prestige - a.prestige)
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
          sortedCountries.map((country) => (
            <CountryRow
              key={country.id}
              country={country}
              color={countryColorMap[country.id] ?? '#888'}
              militaryPower={countryMilitaryPowers[country.id] ?? 0}
              isSelected={selectedId === country.id && selectedType === 'country'}
              onClick={() => setSelected(country.id, 'country')}
            />
          ))}

        {activeTab === 'houses' &&
          sortedHouses.map((house) => (
            <HouseRow
              key={house.id}
              house={house}
              countryName={countries?.[house.countryId]?.name ?? ''}
              countryColor={countryColorMap[house.countryId] ?? '#888'}
              isSelected={selectedId === house.id && selectedType === 'house'}
              onClick={() => setSelected(house.id, 'house')}
            />
          ))}

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
            if (type === 'country' && countries) {
              const found = Object.values(countries).find((c) => c.id === watchId)
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
