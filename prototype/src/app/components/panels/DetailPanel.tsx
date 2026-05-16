import type {} from 'react'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { formatScore, formatAmount, formatPower } from '@/app/utils/format'
import {
  getCountryLegitimacy,
  getCountryStability,
  getHouseCohesion,
  getHouseLoyaltyToCountry,
} from '@sim/selectors/statusSelectors'
import {
  getAttitudeOrDefault,
  attitudeValueToScore,
  houseAttitudeKey,
  countryAttitudeKey,
} from '@sim/helpers/attitudeHelpers'
import { getPersonRole } from '@/sim/selectors/roleSelectors'
import { getProvinceDevelopmentMultiplier } from '@/sim/selectors/developmentSelectors'
import {
  getProvincePops,
  getProvinceCarryingCapacity,
  getProvincePopulation,
  getProvincePopulationPressure,
  getProvinceAveragePopWealth,
  getProvinceUnrest,
  getPopWealthByClass,
} from '@sim/selectors/popSelectors'
import {
  getProvinceProduction,
  getProvinceManpowerBase,
  getProvinceCountryManpowerBase,
  getProvinceHouseManpowerBase,
} from '@sim/selectors/popEconomySelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import type { Country } from '@/sim/types/country'
import type { House } from '@/sim/types/house'
import type { Person } from '@/sim/types/person'
import type { Province } from '@/sim/types/province'
import type { PopGroup } from '@/sim/types/popGroup'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import type { AttitudeMap } from '@/sim/types/attitude'
import type { CountryId, HouseId, PersonId } from '@/sim/types/ids'
import { calcAmbitionScores } from '@/sim/tick/ambitionSystem'
import { calcPersonImportanceScore } from '@/sim/selectors/importanceSelectors'
import { calcCountryMilitaryPower } from '@/sim/selectors/militarySelectors'
import { normalizedStat } from '@/sim/selectors/personAbilityEffects'
import { clamp } from '@/sim/utils/math'
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

function AttitudeList({
  attitudes,
  worldState,
  onCountryClick,
  onHouseClick,
  onPersonClick,
}: {
  attitudes: AttitudeMap
  worldState: WorldState
  onCountryClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
}) {
  const entries = Object.entries(attitudes)
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(([key, attitude]) => {
        const colonIdx = key.indexOf(':')
        const prefix = key.slice(0, colonIdx)
        const id = key.slice(colonIdx + 1)

        let linkNode: React.ReactNode
        if (prefix === 'country') {
          const c = worldState.countries[id as CountryId]
          const name = c?.name ?? id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onCountryClick(id, 'country')}
            >
              {name}
            </button>
          )
        } else if (prefix === 'house') {
          const h = worldState.houses[id as HouseId]
          const name = h?.name ?? id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onHouseClick(id, 'house')}
            >
              {name}
            </button>
          )
        } else if (prefix === 'person') {
          const p = worldState.persons[id as PersonId]
          const name = p?.name ?? id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onPersonClick(id)}
            >
              {name}
            </button>
          )
        } else {
          linkNode = <span className="text-gray-400">{id}</span>
        }

        const affColor =
          attitude.affection > 0
            ? 'text-green-400'
            : attitude.affection < 0
              ? 'text-red-400'
              : 'text-gray-400'
        const resColor =
          attitude.respect > 0
            ? 'text-green-400'
            : attitude.respect < 0
              ? 'text-red-400'
              : 'text-gray-400'

        return (
          <div key={key} className="rounded bg-gray-700 p-1 text-xs">
            <div className="font-medium text-gray-300">{linkNode}</div>
            <div className="flex justify-between">
              <span className="text-gray-400">Affection:</span>
              <span className={affColor}>{attitude.affection.toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Respect:</span>
              <span className={resColor}>{attitude.respect.toFixed(0)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CountryDetail({
  country,
  session,
  watchlist,
  toggleWatchlist,
  onPersonClick,
  onHouseClick,
  onProvinceClick,
}: {
  country: Country
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
  onProvinceClick: (id: string) => void
}) {
  const isWatching = watchlist.includes(country.id)
  const currentState = session?.currentState
  const houses = currentState?.houses
  const persons = currentState?.persons

  const worldState: WorldState | null = currentState
    ? {
        currentYear: currentState.currentYear,
        currentMonth: currentState.currentMonth,
        provinces: currentState.provinces,
        countries: currentState.countries,
        houses: currentState.houses,
        persons: currentState.persons,
        activePlots: currentState.activePlots ?? {},
        popGroups: currentState.popGroups ?? {},
      }
    : null

  const totalMilitaryPower = worldState
    ? calcCountryMilitaryPower(worldState, defaultConfig, country.id)
    : 0

  const legitimacy = worldState ? getCountryLegitimacy(worldState, country.id) : 50
  const stability = worldState ? getCountryStability(worldState, defaultConfig, country.id) : 50

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
          <span className="text-gray-400">Capital:</span>
          <button
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onProvinceClick(country.capitalProvinceId)}
          >
            {currentState?.provinces?.[country.capitalProvinceId]?.name ??
              country.capitalProvinceId}
          </button>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Ruler House:</span>
          <HouseLink houseId={country.rulerHouseId} houses={houses ?? {}} onClick={onHouseClick} />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Treasury:</span>
          <span>{formatAmount(country.treasury)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Legitimacy:</span>
          <span>{formatScore(legitimacy)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">AdminPower:</span>
          <span>{formatScore(country.adminPower)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Stability:</span>
          <span>{formatScore(stability)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Military Power:</span>
          <span>{formatPower(totalMilitaryPower)}</span>
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
  onProvinceClick,
  eventHistory,
}: {
  house: House
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onCountryClick: ClickHandler
  onProvinceClick: (id: string) => void
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
        popGroups: currentState.popGroups ?? {},
      }
    : null

  const { rebellionTendency, plotTendency } = worldState
    ? calcAmbitionScores(worldState, house.id)
    : { rebellionTendency: 0, plotTendency: 0 }

  const cohesion = worldState ? getHouseCohesion(worldState, house.id) : 50
  const loyaltyToCountry = worldState ? getHouseLoyaltyToCountry(worldState, house.id) : 50

  const levyPower = worldState
    ? house.provinceIds.reduce(
        (sum, pid) => sum + getProvinceHouseManpowerBase(worldState, defaultConfig, pid),
        0,
      ) * defaultConfig.houseManpowerPowerFactor
    : 0

  const availableWarWealth = Math.max(0, house.wealth - defaultConfig.houseMilitaryWealthReserve)
  const rawMercenaryPower = Math.log1p(availableWarWealth) * defaultConfig.houseWealthMilitaryFactor
  const mercenaryPower = Math.min(
    rawMercenaryPower,
    levyPower * defaultConfig.maxMercenaryPowerRatio,
  )

  const bestMartial = worldState
    ? Math.max(0, ...house.memberIds.map((pid) => worldState.persons[pid]?.stats.martial ?? 0))
    : 0

  const commanderModifier = clamp(
    1 + normalizedStat(bestMartial) * defaultConfig.houseCommanderMartialEffect,
    defaultConfig.minCommanderModifier,
    defaultConfig.maxCommanderModifier,
  )

  const totalMilitaryPower = (levyPower + mercenaryPower) * commanderModifier

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
          <span className="text-gray-400">Seat:</span>
          <button
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onProvinceClick(house.seatProvinceId)}
          >
            {currentState?.provinces?.[house.seatProvinceId]?.name ?? house.seatProvinceId}
          </button>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Prestige:</span>
          <span>{formatScore(house.legacyPrestige)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Cohesion:</span>
          <span>{formatScore(cohesion)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Loyalty:</span>
          <span>{formatScore(loyaltyToCountry)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Wealth:</span>
          <span>{formatAmount(house.wealth)}</span>
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

      <div className="mt-1 text-sm font-semibold text-gray-300">Military</div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Levy Power:</span>
          <span>{formatPower(levyPower)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Mercenary Power:</span>
          <span>{formatPower(mercenaryPower)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Commander Mod:</span>
          <span>{commanderModifier.toFixed(2)}x</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Total Military:</span>
          <span className="font-medium">{formatPower(totalMilitaryPower)}</span>
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
        <div>
          <div className="text-sm font-semibold text-gray-300">Members ({aliveMembers} alive):</div>
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
          <span className="text-gray-400">Founder:</span>
          <span>{currentState?.persons?.[house.founderId]?.name ?? house.founderId}</span>
        </div>
      )}
      {house.parentHouseId !== undefined && (
        <div className="flex justify-between">
          <span className="text-gray-400">Parent House:</span>
          <span>{currentState?.houses?.[house.parentHouseId]?.name ?? house.parentHouseId}</span>
        </div>
      )}
      {house.cadetHouseIds.length > 0 && (
        <div className="flex justify-between">
          <span className="text-gray-400">Cadet Houses:</span>
          <span>{house.cadetHouseIds.length}</span>
        </div>
      )}

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
  onPersonClick,
  eventHistory,
}: {
  person: Person
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onHouseClick: ClickHandler
  onCountryClick: ClickHandler
  onPersonClick: (id: string) => void
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
    popGroups: currentState?.popGroups ?? {},
  }
  const role = getPersonRole(worldState, person.id)
  const importanceScore = calcPersonImportanceScore(worldState, person.id, eventHistory)

  const personCountryAtt = getAttitudeOrDefault(
    worldState,
    person,
    countryAttitudeKey(person.countryId),
  )
  const countryLoyalty =
    (attitudeValueToScore(personCountryAtt.affection) * 0.55 +
      attitudeValueToScore(personCountryAtt.respect) * 0.45) /
    100

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
          <span className="text-gray-400">Sex:</span>
          <span>{person.sex === 'male' ? 'Male' : person.sex === 'female' ? 'Female' : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Birth Status:</span>
          <span>
            {person.birthStatus === 'legitimate'
              ? 'Legitimate'
              : person.birthStatus === 'illegitimate'
                ? 'Illegitimate'
                : 'Unknown'}
          </span>
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
          <span>{formatScore(person.legacyPrestige)}</span>
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
          <span>{formatScore(person.traits.ambition)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Country Loyalty:</span>
          <span>{formatScore(countryLoyalty * 100)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Caution:</span>
          <span>{formatScore(person.traits.caution)}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">Family:</div>
      <div className="text-sm">
        {person.fatherId !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">Father:</span>
            <PersonLink
              personId={person.fatherId}
              persons={currentState?.persons ?? {}}
              onClick={onPersonClick}
            />
          </div>
        )}
        {person.motherId !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">Mother:</span>
            <PersonLink
              personId={person.motherId}
              persons={currentState?.persons ?? {}}
              onClick={onPersonClick}
            />
          </div>
        )}
        {person.spouseId !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">Spouse:</span>
            <PersonLink
              personId={person.spouseId}
              persons={currentState?.persons ?? {}}
              onClick={onPersonClick}
            />
          </div>
        )}
        {person.childIds.length > 0 && (
          <div>
            <div className="text-gray-400">Children:</div>
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

      <div className="text-sm font-semibold text-gray-300">Attitudes:</div>
      <AttitudeList
        attitudes={person.attitudes}
        worldState={worldState}
        onCountryClick={onCountryClick}
        onHouseClick={onHouseClick}
        onPersonClick={onPersonClick}
      />
    </div>
  )
}

function getDevelopmentLabel(d: number): string {
  if (d <= -50) return '荒廃'
  if (d <= -10) return '衰退'
  if (d < 10) return '通常'
  if (d < 50) return '発展'
  return '繁栄'
}

function PopGroupDetail({
  popGroup,
  session,
  onCountryClick,
  onHouseClick,
  onPersonClick,
  onProvinceClick,
}: {
  popGroup: PopGroup
  session: SimulationSession | null
  onCountryClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
  onProvinceClick: (id: string) => void
}) {
  const currentState = session?.currentState
  const province = currentState?.provinces[popGroup.provinceId]

  const worldState: WorldState = {
    currentYear: currentState?.currentYear ?? 0,
    currentMonth: currentState?.currentMonth ?? 0,
    provinces: currentState?.provinces ?? {},
    countries: currentState?.countries ?? {},
    houses: currentState?.houses ?? {},
    persons: currentState?.persons ?? {},
    activePlots: currentState?.activePlots ?? {},
    popGroups: currentState?.popGroups ?? {},
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      <span className="text-lg font-bold capitalize">{popGroup.class}</span>
      <div className="text-sm text-gray-400">
        of{' '}
        <button
          className="cursor-pointer text-blue-400 hover:text-blue-300"
          onClick={() => onProvinceClick(popGroup.provinceId)}
        >
          {province?.name ?? '—'}
        </button>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">ID:</span>
          <span className="text-xs text-gray-500">{popGroup.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Size:</span>
          <span>{popGroup.size.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Wealth:</span>
          <span>{popGroup.wealth.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Unrest:</span>
          <span className={popGroup.unrest > 60 ? 'text-red-400' : 'text-gray-200'}>
            {popGroup.unrest.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">Attitudes:</div>
      <AttitudeList
        attitudes={popGroup.attitudes}
        worldState={worldState}
        onCountryClick={onCountryClick}
        onHouseClick={onHouseClick}
        onPersonClick={onPersonClick}
      />
    </div>
  )
}

function ProvinceDetail({
  province,
  session,
  onCountryClick,
  onHouseClick,
  onProvinceClick,
  onPopGroupClick,
}: {
  province: Province
  session: SimulationSession | null
  onCountryClick: ClickHandler
  onHouseClick: ClickHandler
  onProvinceClick: (id: string) => void
  onPopGroupClick: (id: string) => void
}) {
  const currentState = session?.currentState
  const developmentMultiplier = getProvinceDevelopmentMultiplier(province)

  const pops = currentState ? getProvincePops(currentState, province.id) : []
  const carryingCapacity = currentState
    ? getProvinceCarryingCapacity(currentState, defaultConfig, province.id)
    : 0
  const totalPopulation = currentState ? getProvincePopulation(currentState, province.id) : 0
  const populationPressure = currentState
    ? getProvincePopulationPressure(currentState, defaultConfig, province.id)
    : 0
  const avgWealth = currentState ? getProvinceAveragePopWealth(currentState, province.id) : 0
  const derivedUnrest = currentState ? getProvinceUnrest(currentState, province.id) : 0
  const derivedProduction = currentState
    ? getProvinceProduction(currentState, defaultConfig, province.id)
    : 0
  const derivedManpower = currentState
    ? getProvinceManpowerBase(currentState, defaultConfig, province.id)
    : 0

  const countryManpower = currentState
    ? getProvinceCountryManpowerBase(currentState, defaultConfig, province.id)
    : 0
  const houseManpower = currentState
    ? getProvinceHouseManpowerBase(currentState, defaultConfig, province.id)
    : 0

  // Calculate revolt tendency per class
  const calcRevoltTendencyForClass = (
    ws: WorldState,
    popClass: 'peasants' | 'townsmen' | 'nobles',
  ): number => {
    const country = ws.countries[province.countryId]
    if (!country) return 0
    const ownerHouse = ws.houses[province.ownerHouseId]
    if (!ownerHouse) return 0

    const pop = Object.values(ws.popGroups).find(
      (p) => p?.provinceId === province.id && p?.class === popClass,
    )
    if (!pop) return 0

    let tendency =
      pop.unrest * defaultConfig.provinceRevoltUnrestFactor +
      (100 - province.houseControl) * defaultConfig.provinceRevoltLowHouseControlFactor +
      (100 - province.countryControl) * defaultConfig.provinceRevoltLowCountryControlFactor -
      getCountryStability(ws, defaultConfig, province.countryId) *
        defaultConfig.provinceRevoltStabilitySuppressionFactor

    if (popClass === 'peasants') {
      if (pop.wealth < defaultConfig.povertyWealthThreshold) {
        tendency +=
          (defaultConfig.povertyWealthThreshold - pop.wealth) *
          defaultConfig.peasantRevoltPovertyFactor
      }
      const pressure = getProvincePopulationPressure(ws, defaultConfig, province.id)
      tendency += pressure * defaultConfig.peasantRevoltPressureFactor
    } else if (popClass === 'townsmen') {
      const townsmenWealth = getPopWealthByClass(ws, province.id, 'townsmen')
      if (townsmenWealth < defaultConfig.overExtractionWealthSafeThreshold) {
        tendency += defaultConfig.townsmenRevoltExtractionFactor
        tendency +=
          Math.log1p(getProvinceProduction(ws, defaultConfig, province.id)) *
          defaultConfig.townsmenRevoltProductionFactor
      }
    } else if (popClass === 'nobles') {
      const noblesPop = Object.values(ws.popGroups).find(
        (p) => p?.provinceId === province.id && p?.class === 'nobles',
      )
      if (noblesPop) {
        const a_house = getAttitudeOrDefault(ws, noblesPop, houseAttitudeKey(province.ownerHouseId))
        const a_country = getAttitudeOrDefault(
          ws,
          noblesPop,
          countryAttitudeKey(province.countryId),
        )
        const houseScore =
          attitudeValueToScore(a_house.affection) * 0.6 +
          attitudeValueToScore(a_house.respect) * 0.4
        const countryScore =
          attitudeValueToScore(a_country.affection) * 0.6 +
          attitudeValueToScore(a_country.respect) * 0.4
        const nobleDisloyalty = 100 - (0.5 * houseScore + 0.5 * countryScore)
        tendency += nobleDisloyalty * defaultConfig.nobleRevoltHouseDisloyaltyFactor
        tendency += nobleDisloyalty * defaultConfig.nobleRevoltLowLegitimacyFactor * 0.5
      }
    }

    return tendency
  }

  const peasantRevoltTendency = currentState
    ? calcRevoltTendencyForClass(currentState, 'peasants')
    : 0
  const townsmenRevoltTendency = currentState
    ? calcRevoltTendencyForClass(currentState, 'townsmen')
    : 0
  const noblesRevoltTendency = currentState ? calcRevoltTendencyForClass(currentState, 'nobles') : 0

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
          <span className="text-gray-400">Habitability:</span>
          <span>{formatScore(province.habitability)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Development:</span>
          <span>
            {formatScore(province.development)} {getDevelopmentLabel(province.development)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Dev. Multiplier:</span>
          <span>{formatScore(developmentMultiplier)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Country Control:</span>
          <span>{formatPower(province.countryControl)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">House Control:</span>
          <span>{formatPower(province.houseControl)}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">Population</div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Carrying Capacity:</span>
          <span>{carryingCapacity.toFixed(0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Total Population:</span>
          <span>{totalPopulation.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Pop. Pressure:</span>
          <span className={populationPressure > 0.9 ? 'text-red-400' : 'text-gray-200'}>
            {(populationPressure * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Avg Wealth:</span>
          <span>{avgWealth.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Unrest:</span>
          <span className={derivedUnrest > 60 ? 'text-red-400' : 'text-gray-200'}>
            {derivedUnrest.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Production:</span>
          <span>{derivedProduction.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Manpower:</span>
          <span>{derivedManpower.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Country Manpower:</span>
          <span>{countryManpower.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">House Manpower:</span>
          <span>{houseManpower.toFixed(2)}</span>
        </div>
      </div>

      {pops.length > 0 && (
        <>
          <div className="text-sm font-semibold text-gray-300">POP Groups</div>
          {pops.map((pop) => (
            <div key={pop.id} className="rounded bg-gray-700 p-1.5 text-xs">
              <button
                className="w-full cursor-pointer text-left font-medium text-blue-400 capitalize hover:text-blue-300"
                onClick={() => onPopGroupClick(pop.id)}
              >
                {pop.class} →
              </button>
              <div className="flex justify-between">
                <span className="text-gray-400">Size:</span>
                <span>{pop.size.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Wealth:</span>
                <span>{pop.wealth.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Unrest:</span>
                <span className={pop.unrest > 60 ? 'text-red-400' : 'text-gray-200'}>
                  {pop.unrest.toFixed(1)}
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="text-sm font-semibold text-gray-300">Revolt Risk</div>
      <div className="text-sm">
        {(
          [
            ['Peasants', peasantRevoltTendency],
            ['Townsmen', townsmenRevoltTendency],
            ['Nobles', noblesRevoltTendency],
          ] as const
        ).map(([label, tendency]) => (
          <div key={label} className="flex justify-between">
            <span className="text-gray-400">{label}:</span>
            <span
              className={
                tendency >= defaultConfig.provinceRevoltThreshold ? 'text-red-400' : 'text-gray-200'
              }
            >
              {tendency.toFixed(1)}
            </span>
          </div>
        ))}
      </div>

      {province.neighbors.length > 0 && (
        <>
          <div className="text-sm font-semibold text-gray-300">Neighbors</div>
          <div className="flex flex-col gap-0.5 text-sm">
            {province.neighbors.map((nid) => (
              <button
                key={nid}
                className="text-left text-blue-400 underline underline-offset-2 hover:text-blue-300"
                onClick={() => onProvinceClick(nid)}
              >
                {currentState?.provinces?.[nid]?.name ?? nid}
              </button>
            ))}
          </div>
        </>
      )}
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
  const onProvinceClick = (id: string) => setSelected(id, 'province')
  const onPopGroupClick = (id: string) => setSelected(id, 'popGroup')

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
  const popGroup =
    selectedType === 'popGroup' && selectedId && currentState
      ? Object.values(currentState.popGroups).find((pg) => pg?.id === selectedId)
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
            onProvinceClick={onProvinceClick}
          />
        ) : selectedType === 'house' && house ? (
          <HouseDetail
            house={house}
            session={session}
            watchlist={watchlist}
            toggleWatchlist={toggleWatchlist}
            onPersonClick={onPersonClick}
            onCountryClick={onCountryClick}
            onProvinceClick={onProvinceClick}
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
            onPersonClick={onPersonClick}
            eventHistory={eventHistory}
          />
        ) : selectedType === 'province' && province ? (
          <ProvinceDetail
            province={province}
            session={session}
            onCountryClick={onCountryClick}
            onHouseClick={onHouseClick}
            onProvinceClick={onProvinceClick}
            onPopGroupClick={onPopGroupClick}
          />
        ) : selectedType === 'popGroup' && popGroup ? (
          <PopGroupDetail
            popGroup={popGroup}
            session={session}
            onCountryClick={onCountryClick}
            onHouseClick={onHouseClick}
            onPersonClick={onPersonClick}
            onProvinceClick={onProvinceClick}
          />
        ) : (
          <NoSelection />
        )}
      </div>
    </div>
  )
}
