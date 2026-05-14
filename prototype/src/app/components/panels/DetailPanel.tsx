import { useSimulationStore } from '@/app/stores/simulationStore'
import { getPersonRole } from '@/sim/selectors/roleSelectors'
import type { Country } from '@/sim/types/country'
import type { House } from '@/sim/types/house'
import type { Person } from '@/sim/types/person'
import type { Province } from '@/sim/types/province'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { calcAmbitionScores } from '@/sim/tick/ambitionSystem'
import { calcPersonImportanceScore } from '@/sim/selectors/importanceSelectors'
import type { SimEvent } from '@/sim/types/event'

function getImportanceColor(importance: SimEvent['importance']): string {
  switch (importance) {
    case 'critical':
      return 'text-red-400'
    case 'major':
      return 'text-yellow-400'
    case 'normal':
      return 'text-gray-200'
    case 'minor':
      return 'text-gray-500'
  }
}

type ClickHandler = (id: string, type: 'person' | 'house' | 'country') => void

function WatchButton({ isWatching, onToggle }: { isWatching: boolean; onToggle: () => void }) {
  return (
    <button
      className={`rounded px-2 py-0.5 text-xs transition-colors ${
        isWatching
          ? 'bg-yellow-600 text-white hover:bg-yellow-500'
          : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
      }`}
      onClick={onToggle}
    >
      {isWatching ? '\u2605 Watching' : '\u2606 Watch'}
    </button>
  )
}

function PersonLink({
  personId,
  persons,
  onClick,
}: {
  personId: string
  persons: Record<string, Person>
  onClick: ClickHandler
}) {
  const person = persons[personId]
  if (!person) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(personId, 'person')}
    >
      {person.name}
    </button>
  )
}

function HouseLink({
  houseId,
  houses,
  onClick,
}: {
  houseId: string
  houses: Record<string, House>
  onClick: ClickHandler
}) {
  const house = houses[houseId]
  if (!house) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(houseId, 'house')}
    >
      {house.name}
    </button>
  )
}

function CountryLink({
  countryId,
  countries,
  onClick,
}: {
  countryId: string
  countries: Record<string, Country>
  onClick: ClickHandler
}) {
  const country = countries[countryId]
  if (!country) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(countryId, 'country')}
    >
      {country.name}
    </button>
  )
}

function RoleDisplay({
  role,
  roleAssignments,
  persons,
  onClick,
}: {
  role: string
  roleAssignments: Record<string, string>
  persons: Record<string, Person>
  onClick: ClickHandler
}) {
  const personId = roleAssignments[role]
  if (!personId) return <span className="text-gray-500">\u2014</span>
  return <PersonLink personId={personId} persons={persons} onClick={onClick} />
}

function CountryDetail({
  country,
  session,
  watchlist,
  toggleWatchlist,
  onPersonClick,
  onHouseClick,
}: {
  country: Country
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const isWatching = watchlist.includes(country.id)
  const currentState = session?.currentState
  const houses = currentState?.houses
  const persons = currentState?.persons

  const roleLabels: Record<string, string> = {
    chancellor: 'Chancellor',
    general: 'General',
    treasurer: 'Treasurer',
  }

  const inHouseNames = country.houseIds
    .map((hid) => houses?.[hid])
    .filter((h): h is House => !!h)
    .map((h) => (
      <li key={h.id} className="mb-0.5">
        <HouseLink houseId={h.id} houses={houses!} onClick={onHouseClick} />
      </li>
    ))

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{country.name}</span>
          {!country.active && (
            <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-400">Annexed</span>
          )}
        </div>
        <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(country.id)} />
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Treasury:</span>
          <span>{country.treasury}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Legitimacy:</span>
          <span>{country.legitimacy}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">AdminPower:</span>
          <span>{country.adminPower}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Stability:</span>
          <span>{country.stability}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">Roles:</div>
      <div className="text-sm">
        {(['chancellor', 'general', 'treasurer'] as const).map((role) => (
          <div key={role} className="flex justify-between">
            <span className="text-gray-400">{roleLabels[role]}:</span>
            <RoleDisplay
              role={role}
              roleAssignments={country.roleAssignments}
              persons={persons!}
              onClick={onPersonClick}
            />
          </div>
        ))}
      </div>

      <div className="text-sm font-semibold text-gray-300">Houses:</div>
      <ul className="list-inside list-disc text-sm">
        {inHouseNames.length > 0 ? inHouseNames : <li className="text-gray-500">\u2014</li>}
      </ul>
    </div>
  )
}

function HouseDetail({
  house,
  session,
  watchlist,
  toggleWatchlist,
  onPersonClick,
  onCountryClick,
  eventHistory,
}: {
  house: House
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onCountryClick: ClickHandler
  eventHistory: SimEvent[]
}) {
  const isWatching = watchlist.includes(house.id)
  const currentState = session?.currentState
  const head = currentState?.persons?.[house.headId]
  const aliveMembers = house.memberIds.filter(
    (pid) => currentState?.persons?.[pid]?.alive === true,
  ).length

  const worldState: WorldState | null = currentState
    ? {
        currentYear: currentState.currentYear,
        currentMonth: currentState.currentMonth,
        provinces: currentState.provinces,
        countries: currentState.countries,
        houses: currentState.houses,
        persons: currentState.persons,
        activePlots: currentState.activePlots,
      }
    : null

  const { rebellionTendency, plotTendency } = worldState
    ? calcAmbitionScores(worldState, house.id)
    : { rebellionTendency: 0, plotTendency: 0 }

  const recentEvents = eventHistory
    .filter(
      (e) =>
        e.houseIds.some((id) => (id as string) === house.id) ||
        e.actorIds.some((aid) =>
          house.memberIds.some((mid) => (mid as string) === (aid as string)),
        ),
    )
    .slice(-3)
    .reverse()

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">{house.name}</span>
        <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(house.id)} />
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Country:</span>
          <CountryLink
            countryId={house.countryId}
            countries={currentState?.countries ?? {}}
            onClick={onCountryClick}
          />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Prestige:</span>
          <span>{house.prestige}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Cohesion:</span>
          <span>{house.cohesion}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Loyalty:</span>
          <span>{house.loyaltyToCountry}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Wealth:</span>
          <span>{house.wealth}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Provinces:</span>
          <span>{house.provinceIds.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Rebellion Tendency:</span>
          <span className={rebellionTendency >= 70 ? 'text-red-400' : 'text-gray-200'}>
            {rebellionTendency.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Plot Tendency:</span>
          <span className={plotTendency >= 65 ? 'text-yellow-400' : 'text-gray-200'}>
            {plotTendency.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Head:</span>
          {head ? (
            <PersonLink
              personId={house.headId}
              persons={currentState?.persons ?? {}}
              onClick={onPersonClick}
            />
          ) : (
            <span className="text-gray-500">\u2014</span>
          )}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Members:</span>
          <span>{aliveMembers} alive</span>
        </div>
      </div>

      {recentEvents.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-gray-300">Recent Events:</div>
          {recentEvents.map((e) => (
            <div key={e.id} className={`text-xs ${getImportanceColor(e.importance)}`}>
              [{e.year}/{e.month}] {e.summary}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PersonDetail({
  person,
  session,
  watchlist,
  toggleWatchlist,
  onHouseClick,
  onCountryClick,
  eventHistory,
}: {
  person: Person
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onHouseClick: ClickHandler
  onCountryClick: ClickHandler
  eventHistory: SimEvent[]
}) {
  const isWatching = watchlist.includes(person.id)
  const currentState = session?.currentState
  const worldState: WorldState = {
    currentYear: currentState?.currentYear ?? 0,
    currentMonth: currentState?.currentMonth ?? 0,
    provinces: currentState?.provinces ?? {},
    countries: currentState?.countries ?? {},
    houses: currentState?.houses ?? {},
    persons: currentState?.persons ?? {},
    activePlots: currentState?.activePlots ?? {},
  }
  const role = getPersonRole(worldState, person.id)
  const importanceScore = calcPersonImportanceScore(worldState, person.id, eventHistory)

  const roleLabels: Record<string, string> = {
    chancellor: 'Chancellor',
    general: 'General',
    treasurer: 'Treasurer',
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">{person.name}</span>
        <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(person.id)} />
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Age:</span>
          <span>{person.age}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Alive:</span>
          <span>{person.alive ? 'Yes' : 'No'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">House:</span>
          <HouseLink
            houseId={person.houseId}
            houses={currentState?.houses ?? {}}
            onClick={onHouseClick}
          />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Country:</span>
          <CountryLink
            countryId={person.countryId}
            countries={currentState?.countries ?? {}}
            onClick={onCountryClick}
          />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Role:</span>
          <span>{role ? roleLabels[role] : <span className="text-gray-500">\u2014</span>}</span>
        </div>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Admin:</span>
          <span>{person.stats.admin}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Martial:</span>
          <span>{person.stats.martial}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Prestige:</span>
          <span>{person.prestige}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Importance:</span>
          <span className="text-yellow-400">{Math.round(importanceScore)}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">Traits:</div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Ambition:</span>
          <span>{person.traits.ambition.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Loyalty:</span>
          <span>{person.traits.loyaltyToCountry.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Caution:</span>
          <span>{person.traits.caution.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}

function ProvinceDetail({
  province,
  session,
  onCountryClick,
  onHouseClick,
}: {
  province: Province
  session: SimulationSession | null
  onCountryClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const currentState = session?.currentState

  return (
    <div className="flex flex-col gap-1 p-3">
      <span className="text-lg font-bold">{province.name}</span>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Country:</span>
          <CountryLink
            countryId={province.countryId}
            countries={currentState?.countries ?? {}}
            onClick={onCountryClick}
          />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Owner:</span>
          <HouseLink
            houseId={province.ownerHouseId}
            houses={currentState?.houses ?? {}}
            onClick={onHouseClick}
          />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">BaseTax:</span>
          <span>{province.baseTax}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Manpower:</span>
          <span>{province.manpower}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Unrest:</span>
          <span>{province.unrest}</span>
        </div>
      </div>
    </div>
  )
}

function NoSelection() {
  return (
    <div className="flex h-full items-center justify-center text-gray-500">
      <p>Select an entity to view details</p>
    </div>
  )
}

export function DetailPanel() {
  const selectedId = useSimulationStore((s) => s.selectedId)
  const selectedType = useSimulationStore((s) => s.selectedType)
  const session = useSimulationStore((s) => s.session)
  const watchlist = useSimulationStore((s) => s.watchlist)
  const toggleWatchlist = useSimulationStore((s) => s.toggleWatchlist)
  const setSelected = useSimulationStore((s) => s.setSelected)

  const eventHistory = useSimulationStore((s) => s.session?.eventHistory ?? [])

  const currentState = session?.currentState

  const onPersonClick = (id: string) => setSelected(id, 'person')
  const onHouseClick = (id: string) => setSelected(id, 'house')
  const onCountryClick = (id: string) => setSelected(id, 'country')

  const country =
    selectedType === 'country' && selectedId && currentState
      ? Object.values(currentState.countries).find((c) => c.id === selectedId)
      : undefined
  const house =
    selectedType === 'house' && selectedId && currentState
      ? Object.values(currentState.houses).find((h) => h.id === selectedId)
      : undefined
  const person =
    selectedType === 'person' && selectedId && currentState
      ? Object.values(currentState.persons).find((p) => p.id === selectedId)
      : undefined
  const province =
    selectedType === 'province' && selectedId && currentState
      ? Object.values(currentState.provinces).find((pv) => pv.id === selectedId)
      : undefined

  return (
    <div className="flex h-full w-72 flex-col overflow-hidden bg-gray-800 text-white">
      <div className="border-b border-gray-600 px-3 py-2 text-sm font-semibold text-gray-300">
        Details
      </div>
      <div className="flex-1 overflow-y-auto">
        {!selectedId || !selectedType ? (
          <NoSelection />
        ) : selectedType === 'country' && country ? (
          <CountryDetail
            country={country}
            session={session}
            watchlist={watchlist}
            toggleWatchlist={toggleWatchlist}
            onPersonClick={onPersonClick}
            onHouseClick={onHouseClick}
          />
        ) : selectedType === 'house' && house ? (
          <HouseDetail
            house={house}
            session={session}
            watchlist={watchlist}
            toggleWatchlist={toggleWatchlist}
            onPersonClick={onPersonClick}
            onCountryClick={onCountryClick}
            eventHistory={eventHistory}
          />
        ) : selectedType === 'person' && person ? (
          <PersonDetail
            person={person}
            session={session}
            watchlist={watchlist}
            toggleWatchlist={toggleWatchlist}
            onHouseClick={onHouseClick}
            onCountryClick={onCountryClick}
            eventHistory={eventHistory}
          />
        ) : selectedType === 'province' && province ? (
          <ProvinceDetail
            province={province}
            session={session}
            onCountryClick={onCountryClick}
            onHouseClick={onHouseClick}
          />
        ) : (
          <NoSelection />
        )}
      </div>
    </div>
  )
}
