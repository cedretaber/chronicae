import type {} from 'react'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { formatScore, formatAmount, formatPower, formatPolityRank } from '@/app/utils/format'
import {
  getPolityLegitimacy,
  getPolityStability,
  getHouseCohesion,
  getHouseLoyaltyToPolity,
} from '@sim/selectors/statusSelectors'
import { getAttitudeOrDefault, attitudeValueToScore } from '@sim/helpers/attitudeHelpers'
import {
  getPolityLeaderHouse,
  getPolityLeader,
  getHouseLeader,
  getActiveOfficeHolders,
  getAdministrativeCapacity,
  getAdministrativeLoad,
  getAdministrativeEfficiency,
} from '@sim/selectors/officeSelectors'
import { getDominantPolityHouse, getTopShareholders } from '@sim/selectors/shareSelectors'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { ABILITY_AGE_CURVES } from '@sim/constants/abilityConstants'
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
import type { Polity } from '@/sim/types/polity'
import type { House } from '@/sim/types/house'
import type { Person } from '@/sim/types/person'
import type { Province } from '@/sim/types/province'
import type { PopGroup } from '@/sim/types/popGroup'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import type { AttitudeMap } from '@/sim/types/attitude'
import type { PolityId, HouseId, PersonId } from '@/sim/types/ids'
import { getPersonPrimaryPolityId } from '@sim/selectors/polityRelations'
import {
  getHousePrimaryPolityId,
  getHouseProvinceIdsByPolity,
  getPolityHouseIds,
} from '@sim/selectors/polityRelations'
import {
  getProvinceTerminalPolityId,
  getProvinceEffectiveOwnerHouseId,
  getHouseControlledProvinceIds,
  getProvinceLandContractChain,
  getHouseOwnedPolityIds,
} from '@sim/selectors/landContractSelectors'
import { getBailiffPerson } from '@sim/selectors/provinceOfficeSelectors'
import { calcAmbitionScores } from '@/sim/tick/ambitionSystem'
import { calcPersonImportanceScore } from '@/sim/selectors/importanceSelectors'
import { calcPolityMilitaryPower } from '@/sim/selectors/militarySelectors'
import { normalizedStat } from '@/sim/selectors/personAbilityEffects'
import { OFFICE_DEFINITIONS } from '@sim/config/officeDefinitions'
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

type ClickHandler = (id: PolityId | HouseId | PersonId, type: 'person' | 'house' | 'polity') => void

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
  personId: PersonId
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
  houseId: HouseId | undefined
  houses: Record<string, House>
  onClick: ClickHandler
}) {
  if (!houseId) return <span className="text-gray-500">\u2014</span>
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

function PolityLink({
  polityId,
  polities,
  onClick,
}: {
  polityId: PolityId | undefined
  polities: Record<string, Polity>
  onClick: ClickHandler
}) {
  if (!polityId) return <span className="text-gray-500">\u2014</span>
  const polity = polities[polityId]
  if (!polity) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(polityId, 'polity')}
    >
      {polity.name}
    </button>
  )
}

function RoleDisplay({
  role,
  polityId,
  persons,
  onClick,
  currentState,
}: {
  role: string
  polityId: PolityId
  persons: Record<string, Person>
  onClick: ClickHandler
  currentState: import('@sim/types/world').WorldState | null
}) {
  const polityRef = {
    kind: 'polity' as const,
    id: polityId,
  }
  if (!currentState) return <span className="text-gray-500">\u2014</span>
  const holderIds = getActiveOfficeHolders(
    currentState,
    polityRef,
    role as import('@sim/types/office').OfficeRole,
  )
  if (holderIds.length === 0) return <span className="text-gray-500">\u2014</span>
  const personId = holderIds[0]
  const person = persons[personId as PersonId]
  if (!person) return <span className="text-gray-500">\u2014</span>
  return <PersonLink personId={personId as PersonId} persons={persons} onClick={onClick} />
}

function AttitudeList({
  attitudes,
  worldState,
  onPolityClick,
  onHouseClick,
  onPersonClick,
}: {
  attitudes: AttitudeMap
  worldState: WorldState | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
}) {
  if (!worldState) return null
  const entries = Object.entries(attitudes)
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(([key, attitude]) => {
        const colonIdx = key.indexOf(':')
        const prefix = key.slice(0, colonIdx)
        const id = key.slice(colonIdx + 1)

        let linkNode: React.ReactNode
        if (prefix === 'polity') {
          const p = worldState.polities[id as PolityId]
          const name = p?.name ?? id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onPolityClick(id as PolityId, 'polity')}
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
              onClick={() => onHouseClick(id as HouseId, 'house')}
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
  polity,
  session,
  watchlist,
  toggleWatchlist,
  onPersonClick,
  onHouseClick,
  onProvinceClick,
}: {
  polity: Polity
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
  onProvinceClick: (id: string) => void
}) {
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
    leader: 'Ruler',
    administrator: 'Administrator',
    military: 'Military',
    treasurer: 'Treasurer',
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
          <span className="text-lg font-bold">{polity.name}</span>
          {!polity.active && (
            <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-400">Annexed</span>
          )}
        </div>
        <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(polity.id)} />
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Rank:</span>
          <span>
            {formatPolityRank(polity.rank)}{' '}
            <span className="text-gray-500">(rank {polity.rank})</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Capital:</span>
          <button
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onProvinceClick(polity.capitalProvinceId)}
          >
            {currentState.provinces?.[polity.capitalProvinceId]?.name ?? polity.capitalProvinceId}
          </button>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Ruler:</span>
          {(() => {
            if (!currentState) return <span className="text-gray-500">\u2014</span>
            const rulerId = getPolityLeader(currentState, polity.id)
            if (!rulerId) return <span className="text-gray-500">\u2014</span>
            return <PersonLink personId={rulerId} persons={persons ?? {}} onClick={onPersonClick} />
          })()}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Royal House:</span>
          {(() => {
            if (!currentState) return <span className="text-gray-500">\u2014</span>
            const rulerHouseId = getPolityLeaderHouse(currentState, polity.id)
            if (!rulerHouseId) return <span className="text-gray-500">\u2014</span>
            return <HouseLink houseId={rulerHouseId} houses={houses ?? {}} onClick={onHouseClick} />
          })()}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Dominant House:</span>
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
          <span className="text-gray-400">Treasury:</span>
          <span>{formatAmount(polity.treasury)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Legitimacy:</span>
          <span>{formatScore(legitimacy)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">AdminPower:</span>
          <span>{formatScore(polity.adminPower)}</span>
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

      <div className="text-sm font-semibold text-gray-300">Administration:</div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Capacity:</span>
          <span>
            {worldState
              ? getAdministrativeCapacity(worldState, defaultConfig, polity.id).toFixed(1)
              : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Load:</span>
          <span>
            {worldState
              ? getAdministrativeLoad(worldState, defaultConfig, polity.id).toFixed(1)
              : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Efficiency:</span>
          <span>
            {worldState
              ? `x${getAdministrativeEfficiency(worldState, defaultConfig, polity.id).toFixed(2)}`
              : '—'}
          </span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">Roles:</div>
      <div className="text-sm">
        {(['leader', 'administrator', 'military', 'treasurer'] as const).map((role) => (
          <div key={role} className="flex justify-between">
            <span className="text-gray-400">{roleLabels[role]}:</span>
            <RoleDisplay
              role={role}
              polityId={polity.id}
              persons={persons}
              onClick={onPersonClick}
              currentState={session?.currentState ?? null}
            />
          </div>
        ))}
      </div>

      <div className="text-sm font-semibold text-gray-300">Top Shareholders:</div>
      <div className="text-sm">
        {worldState ? (
          getTopShareholders(worldState, { kind: 'polity', id: polity.id }, 5).map(
            ({ holder, percent }) => (
              <div key={`${holder.kind}:${holder.id}`} className="flex justify-between">
                {holder.kind === 'house' ? (
                  <HouseLink houseId={holder.id} houses={houses ?? {}} onClick={onHouseClick} />
                ) : (
                  <span className="flex items-center gap-1">
                    <PersonLink
                      personId={holder.id}
                      persons={currentState.persons ?? {}}
                      onClick={onPersonClick}
                    />
                    <span
                      className="text-[10px] text-amber-400"
                      title="Individual ruler (autocrat / usurper)"
                    >
                      ★
                    </span>
                  </span>
                )}
                <span className="text-gray-200">{percent.toFixed(1)}%</span>
              </div>
            ),
          )
        ) : (
          <span className="text-gray-500">—</span>
        )}
      </div>

      <div className="text-sm font-semibold text-gray-300">Houses with land here:</div>
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
  onPolityClick,
  onProvinceClick,
  eventHistory,
}: {
  house: House
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onPolityClick: ClickHandler
  onProvinceClick: (id: string) => void
  eventHistory: SimEvent[]
}) {
  const isWatching = watchlist.includes(house.id)
  const currentState = session?.currentState
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
          <span className="text-gray-400">Primary Polity:</span>
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
                {p.name}
              </button>
            )
          })()}
        </div>
        {(() => {
          const ownedIds = getHouseOwnedPolityIds(currentState, house.id)
          if (ownedIds.length <= 1) {
            return (
              <div className="flex justify-between">
                <span className="text-gray-400">Owned Polity:</span>
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
                        {p.name}
                      </button>
                    )
                  })()
                )}
              </div>
            )
          }
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-gray-400">Owned Polities ({ownedIds.length}):</span>
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
                        {p.name}
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
          <span className="text-gray-400">Seat:</span>
          <button
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onProvinceClick(house.seatProvinceId)}
          >
            {currentState.provinces?.[house.seatProvinceId]?.name ?? house.seatProvinceId}
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
          <span>{formatScore(loyaltyToPolity)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Wealth:</span>
          <span>{formatAmount(house.wealth)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Provinces:</span>
          <span>{worldState ? getHouseControlledProvinceIds(worldState, house.id).length : 0}</span>
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
          <span className="text-gray-400">Leader:</span>
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
        <div className="mt-1 text-sm font-semibold text-gray-300">Offices</div>
        <div className="text-sm">
          {(['administrator', 'treasurer', 'military', 'advisor'] as const).map((role) => {
            const houseRef = { kind: 'house' as const, id: house.id }
            const holderIds = worldState ? getActiveOfficeHolders(worldState, houseRef, role) : []
            const roleLabel =
              role === 'administrator'
                ? 'Steward'
                : role === 'treasurer'
                  ? 'Treasurer'
                  : role === 'military'
                    ? 'Guard Captain'
                    : 'Advisor'
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
        <div className="mt-1 text-sm font-semibold text-gray-300">Top Shareholders</div>
        <div className="text-sm">
          {worldState ? (
            getTopShareholders(worldState, { kind: 'house', id: house.id }, 5).map(
              ({ holder, percent }) => (
                <div key={`${holder.kind}:${holder.id}`} className="flex justify-between">
                  {holder.kind === 'person' ? (
                    <PersonLink
                      personId={holder.id}
                      persons={currentState.persons ?? {}}
                      onClick={onPersonClick}
                    />
                  ) : (
                    <span className="text-gray-400">{holder.id}</span>
                  )}
                  <span className="text-gray-200">{percent.toFixed(1)}%</span>
                </div>
              ),
            )
          ) : (
            <span className="text-gray-500">—</span>
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
  onPolityClick,
  onPersonClick,
  eventHistory,
}: {
  person: Person
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onHouseClick: ClickHandler
  onPolityClick: ClickHandler
  onPersonClick: (id: string) => void
  eventHistory: SimEvent[]
}) {
  const isWatching = watchlist.includes(person.id)
  const currentState = session?.currentState
  const worldState: WorldState = currentState ?? {
    currentYear: 0,
    currentMonth: 0,
    provinces: {},
    polities: {},
    houses: {},
    persons: {},
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    landContracts: {},
    provinceOfficeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    landContractIndex: { byProvince: {}, byGranteePolity: {}, byParent: {} },
    provinceTerminalPolityCache: {},
    provinceOfficeIndex: { byProvince: {}, byHolderPerson: {}, byAppointingPolity: {} },
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    nextLandContractId: 0,
    nextProvinceOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
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
    const key = `${office.organization.kind}:${office.role}` as const
    return OFFICE_DEFINITIONS[key]?.displayName ?? office.role
  }

  function officeOrgName(office: (typeof allOffices)[number]): string {
    const org = office.organization
    if (org.kind === 'polity') {
      return worldState.polities[org.id]?.name ?? org.id
    }
    return worldState.houses[org.id]?.name ?? org.id
  }

  const sortByRole = (a: (typeof allOffices)[number], b: (typeof allOffices)[number]) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)

  const polityOffices = allOffices.filter((o) => o.organization.kind === 'polity').sort(sortByRole)
  const houseOffices = allOffices.filter((o) => o.organization.kind === 'house').sort(sortByRole)

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
          <span className="text-gray-400">Primary Polity:</span>
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
                {p.name}
              </button>
            )
          })()}
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
        <div className="mt-1">
          <span className="text-sm text-gray-400">Offices</span>
          {allOffices.length === 0 ? (
            <div className="ml-1 text-sm text-gray-500">—</div>
          ) : (
            <div className="ml-1 text-sm">
              {polityOffices.length > 0 && (
                <div>
                  <span className="text-xs text-gray-500">Country</span>
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
                  <span className="text-xs text-gray-500">House</span>
                  {houseOffices.map((o) => (
                    <div key={o.id} className="flex justify-between gap-2">
                      <span className="text-gray-300">{officeDisplayName(o)}</span>
                      <span className="text-right text-gray-200">{officeOrgName(o)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">Abilities (ability / aptitude):</div>
      <div className="text-sm">
        {(
          [
            ['武勇 Valor', 'valor'],
            ['統率 Command', 'command'],
            ['数理 Numeracy', 'numeracy'],
            ['学識 Learning', 'learning'],
            ['魅力 Charisma', 'charisma'],
            ['洞察 Insight', 'insight'],
          ] as const
        ).map(([label, key]) => {
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

      <div className="text-sm font-semibold text-gray-300">Derived Scores:</div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Governance:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'governance') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Stewardship:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'stewardship') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Diplomacy:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'diplomacy') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Intrigue:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'intrigue') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">WarCommand:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'warCommand') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Prestige:</span>
          <span>{formatScore(person.legacyPrestige)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Wealth:</span>
          <span>{formatAmount(person.wealth)}</span>
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
        onPolityClick={onPolityClick}
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
  onPolityClick,
  onHouseClick,
  onPersonClick,
  onProvinceClick,
}: {
  popGroup: PopGroup
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
  onProvinceClick: (id: string) => void
}) {
  const currentState = session?.currentState
  const province = currentState?.provinces[popGroup.provinceId]

  const worldState: WorldState | null = currentState ?? null

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
        onPolityClick={onPolityClick}
        onHouseClick={onHouseClick}
        onPersonClick={onPersonClick}
      />
    </div>
  )
}

function ProvinceDetail({
  province,
  session,
  onPolityClick,
  onHouseClick,
  onPersonClick,
  onProvinceClick,
  onPopGroupClick,
}: {
  province: Province
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: ClickHandler
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
    const polityId = getProvinceTerminalPolityId(ws, province.id)
    if (!polityId) return 0
    const polity = ws.polities[polityId]
    if (!polity) return 0
    const ownerHouseId = getProvinceEffectiveOwnerHouseId(ws, province.id)
    if (!ownerHouseId) return 0
    const ownerHouse = ws.houses[ownerHouseId]
    if (!ownerHouse) return 0

    const pop = Object.values(ws.popGroups).find(
      (p) => p?.provinceId === province.id && p?.class === popClass,
    )
    if (!pop) return 0

    // v0.16: houseControl 廃止により、polityControl のみ参照する
    let tendency =
      pop.unrest * defaultConfig.provinceRevoltUnrestFactor +
      (100 - province.polityControl) * defaultConfig.provinceRevoltLowCountryControlFactor -
      getPolityStability(ws, defaultConfig, polityId) *
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
        const a_house = getAttitudeOrDefault(ws, noblesPop, {
          kind: 'house',
          id: ownerHouseId,
        })
        const a_country = getAttitudeOrDefault(ws, noblesPop, {
          kind: 'polity',
          id: polityId,
        })
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
          <span className="text-gray-400">Primary Polity:</span>
          <PolityLink
            polityId={
              currentState ? getProvinceTerminalPolityId(currentState, province.id) : undefined
            }
            polities={currentState?.polities ?? {}}
            onClick={onPolityClick}
          />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Owner:</span>
          <HouseLink
            houseId={
              currentState ? getProvinceEffectiveOwnerHouseId(currentState, province.id) : undefined
            }
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
          <span className="text-gray-400">Polity Control:</span>
          <span>{formatPower(province.polityControl)}</span>
        </div>
      </div>

      {currentState && (
        <>
          <div className="text-sm font-semibold text-gray-300">Land Tenure Chain</div>
          <div className="text-sm">
            {(() => {
              const chain = getProvinceLandContractChain(currentState, province.id)
              if (chain.length === 0) {
                return <div className="text-gray-500">— no contracts —</div>
              }
              return chain.map((contract, idx) => {
                const grantee = currentState.polities[contract.granteePolityId]
                const isRoot = contract.parentContractId === undefined
                const isTerminal = idx === chain.length - 1
                const role = isRoot ? 'root' : isTerminal ? 'terminal' : 'intermediate'
                return (
                  <div
                    key={contract.id}
                    className="flex justify-between border-l border-gray-700 pl-2"
                  >
                    <span className="text-gray-400">
                      {'  '.repeat(idx)}↳ {role} (rank {grantee?.rank ?? '?'})
                    </span>
                    {grantee ? (
                      <button
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onPolityClick(grantee.id, 'polity')}
                      >
                        {grantee.name} {(contract.terms.taxRateToGrantor * 100).toFixed(0)}%
                      </button>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </div>
                )
              })
            })()}
            <div className="mt-1 flex justify-between">
              <span className="text-gray-400">Bailiff:</span>
              {(() => {
                const bailiff = getBailiffPerson(currentState, province.id)
                if (!bailiff) return <span className="text-gray-500">vacant</span>
                if (bailiff.kind === 'placeholder') {
                  return <span className="text-gray-500 italic">placeholder</span>
                }
                return (
                  <PersonLink
                    personId={bailiff.id}
                    persons={currentState.persons ?? {}}
                    onClick={onPersonClick}
                  />
                )
              })()}
            </div>
          </div>
        </>
      )}

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
  const onPolityClick = (id: string) => setSelected(id, 'polity')
  const onProvinceClick = (id: string) => setSelected(id, 'province')
  const onPopGroupClick = (id: string) => setSelected(id, 'popGroup')

  const polity =
    selectedType === 'polity' && selectedId && currentState
      ? Object.values(currentState.polities).find((p) => p.id === selectedId)
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
        ) : selectedType === 'polity' && polity ? (
          <CountryDetail
            polity={polity}
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
            onPolityClick={onPolityClick}
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
            onPolityClick={onPolityClick}
            onPersonClick={onPersonClick}
            eventHistory={eventHistory}
          />
        ) : selectedType === 'province' && province ? (
          <ProvinceDetail
            province={province}
            session={session}
            onPolityClick={onPolityClick}
            onHouseClick={onHouseClick}
            onPersonClick={onPersonClick}
            onProvinceClick={onProvinceClick}
            onPopGroupClick={onPopGroupClick}
          />
        ) : selectedType === 'popGroup' && popGroup ? (
          <PopGroupDetail
            popGroup={popGroup}
            session={session}
            onPolityClick={onPolityClick}
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
