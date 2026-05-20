import { useState } from 'react'
import { useSimulationStore, type EntityType } from '@/app/stores/simulationStore'
import type { SimEvent } from '@/sim/types/event'
import type { EventType } from '@/sim/types/event'

type LinkItem = { id: string; type: EntityType; name: string }

function EventLinks({ event }: { event: SimEvent }) {
  const session = useSimulationStore((s) => s.session)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)

  if (!session) return null
  const state = session.currentState

  const items: LinkItem[] = []
  const polityId = event.polityIds[0]
  if (polityId) {
    const polity = state.polities[polityId]
    if (polity) items.push({ id: polity.id, type: 'polity', name: polity.name })
  }
  const houseId = event.houseIds[0]
  if (houseId) {
    const house = state.houses[houseId]
    if (house) items.push({ id: house.id, type: 'house', name: house.name })
  }
  const actorId = event.actorIds[0]
  if (actorId) {
    const person = state.persons[actorId]
    if (person) items.push({ id: person.id, type: 'person', name: person.name })
  }

  if (items.length === 0) return null
  return (
    <span className="ml-1 inline-flex gap-1">
      {items.map((it) => (
        <button
          key={`${it.type}:${it.id}`}
          className="rounded bg-gray-800 px-1 text-[10px] text-blue-300 hover:bg-gray-700 hover:text-blue-200"
          onClick={(e) => {
            e.stopPropagation()
            openDetailWindow(it.type, it.id)
          }}
          title={`${it.type}: ${it.name}`}
        >
          {it.name}
        </button>
      ))}
    </span>
  )
}

type TabKey = 'raw' | 'chronicle' | 'timeline'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'raw', label: 'Raw Log' },
  { key: 'chronicle', label: 'Chronicle' },
  { key: 'timeline', label: 'Timeline' },
]

const MAX_RAW_EVENTS = 100
const MAX_CHRONICLE_EVENTS = 50

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

const EVENT_ICON: Partial<Record<EventType, string>> = {
  WAR_DECLARED: '⚔',
  WAR_WON: '⚔',
  WAR_LOST: '⚔',
  PROVINCE_CONQUERED: '⚔',
  PROVINCE_REVOLT_STARTED: '🔥',
  PROVINCE_REVOLT_SUCCEEDED: '🔥',
  PROVINCE_REVOLT_FAILED: '🔥',
  REVOLT_POLITY_FOUNDED: '🔥',
  PERSON_DIED: '✝',
  IMPORTANT_PERSON_DIED: '✝',
  CHILD_BORN: '✦',
  BOUNTIFUL_HARVEST: '✦',
  DISASTER_RELIEF_FUNDED: '✦',
  MARRIAGE_FORMED: '◇',
  HOUSE_LEADER_CHANGED: '♛',
  SUCCESSION_CRISIS: '♛',
  POLITY_LEADER_CHANGED: '♛',
  POLITY_OWNER_CHANGED: '♛',
  POLITY_EXTINCT: '♛',
  POLITY_LANDLESS: '♛',
  HOUSE_EXTINCT: '♛',
  POLITY_ANNEXED: '♛',
  POLITY_SPLIT: '♛',
  FAMINE: '⚠',
  PLAGUE: '⚠',
  DISASTER_RELIEF_FAILED: '⚠',
  OMEN: '⚠',
  OFFICE_ASSIGNED: '⚜',
  OFFICE_REVOKED: '📜',
  OFFICE_SALARY_UNPAID: '💸',
  OFFICE_SALARY_PARTIALLY_PAID: '💸',
  SHARE_SHIFTED: '⚖',
  ESTATE_SETTLED: '⚱',
  ESTATE_DISPUTED: '⚖',
  LAND_CONTRACT_GRANTED: '📜',
  LAND_CONTRACT_TRANSFERRED: '📜',
  LAND_CONTRACT_INSERTED: '📜',
  LAND_CONTRACT_REPLACED: '📜',
  LAND_CONTRACT_TAX_CHANGED: '📜',
  LAND_CONTRACT_REVOKED: '📜',
  LAND_CONTRACT_PURCHASED: '💰',
  LAND_CONTRACT_CEDED: '🤝',
  LAND_CONTRACT_CONQUERED: '⚔',
  BAILIFF_APPOINTED: '🛡',
  BAILIFF_VACATED: '🛡',
  BAILIFF_PLACEHOLDER_INSTALLED: '🛡',
  // v0.17 §18
  FACTION_FOUNDED: '◈',
  FACTION_DISSOLVED: '◈',
  FACTION_LEADER_CHANGED: '◈',
  PERSON_RECRUITED_TO_FACTION: '◈',
  FACTION_FUNDS_SHORTAGE: '◈',
  FACTION_MEMBER_ABANDONED: '◈',
  FACTION_LEADER_BANKRUPT: '◈',
  OFFICE_TERM_ENDED: '⌛',
  PERSON_FADED_FROM_HISTORY: '✶',
  PERSON_BORN_IN_OBSCURITY: '✶',
  HOUSE_MEMBERS_DISPERSED: '✶',
}

function getEventIcon(type: EventType): string {
  return EVENT_ICON[type] ?? '·'
}

function isWatchlistRelated(event: SimEvent, watchlist: string[]): boolean {
  return (
    event.actorIds.some((id) => watchlist.includes(id)) ||
    event.houseIds.some((id) => watchlist.includes(id)) ||
    event.polityIds.some((id) => watchlist.includes(id)) ||
    event.provinceIds.some((id) => watchlist.includes(id))
  )
}

function RawLogRow({ event }: { event: SimEvent }) {
  const colorClass = getImportanceColor(event.importance)
  const typeLabel = event.type.replace(/_/g, ' ').toUpperCase()

  return (
    <div className={`flex flex-wrap items-center gap-2 py-0.5 text-xs ${colorClass}`}>
      <span className="text-gray-500">
        [{event.year}/{event.month}] {getEventIcon(event.type)} {typeLabel}
      </span>
      <span>{event.summary}</span>
      <EventLinks event={event} />
    </div>
  )
}

function ChronicleRow({ event, isHighlighted }: { event: SimEvent; isHighlighted: boolean }) {
  const colorClass = getImportanceColor(event.importance)
  const icon = getEventIcon(event.type)

  return (
    <div
      className={`flex flex-wrap items-center gap-2 py-0.5 text-xs ${colorClass} ${
        isHighlighted ? 'border-l-2 border-yellow-400 pl-1' : ''
      }`}
    >
      <span className="text-gray-500">
        [{event.year}/{event.month}] {icon}
      </span>
      <span>{event.summary}</span>
      <EventLinks event={event} />
    </div>
  )
}

type YearGroup = { year: number; events: SimEvent[] }

function TimelineYear({ year, events }: YearGroup) {
  return (
    <div className="mb-2">
      <div className="sticky top-0 bg-gray-900 px-2 py-0.5 text-xs font-bold text-gray-400">
        Year {year}
      </div>
      {events.map((e) => (
        <div
          key={e.id}
          className={`flex flex-wrap items-center gap-2 px-3 py-0.5 text-xs ${getImportanceColor(e.importance)}`}
        >
          <span className="text-gray-500">[{e.month}] </span>
          <span>{e.summary}</span>
          <EventLinks event={e} />
        </div>
      ))}
    </div>
  )
}

export function EventLog() {
  const [activeTab, setActiveTab] = useState<TabKey>('raw')
  const eventHistory = useSimulationStore((s) => s.session?.eventHistory ?? [])
  const watchlist = useSimulationStore((s) => s.watchlist)

  const rawEvents = [...eventHistory].reverse().slice(0, MAX_RAW_EVENTS)
  const chronicleEvents = [...eventHistory]
    .reverse()
    .filter((e) => e.importance === 'major' || e.importance === 'critical')
    .slice(0, MAX_CHRONICLE_EVENTS)

  const timelineEvents = eventHistory.filter(
    (e) => e.importance === 'major' || e.importance === 'critical',
  )
  const byYear = new Map<number, SimEvent[]>()
  for (const e of timelineEvents) {
    const arr = byYear.get(e.year) ?? []
    arr.push(e)
    byYear.set(e.year, arr)
  }
  const sortedGroups: YearGroup[] = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, events]) => ({ year, events }))

  return (
    <div className="flex h-40 flex-col overflow-hidden bg-gray-900 text-white">
      <div className="flex border-b border-gray-700">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`flex-1 px-3 py-1 text-xs ${
              activeTab === tab.key
                ? 'border-b-2 border-blue-400 bg-gray-800'
                : 'text-gray-400 hover:bg-gray-800'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'raw' &&
          rawEvents.map((event) => <RawLogRow key={event.id} event={event} />)}
        {activeTab === 'chronicle' &&
          chronicleEvents.map((event) => (
            <ChronicleRow
              key={event.id}
              event={event}
              isHighlighted={isWatchlistRelated(event, watchlist)}
            />
          ))}
        {activeTab === 'timeline' &&
          sortedGroups.map((group) => <TimelineYear key={group.year} {...group} />)}
      </div>
    </div>
  )
}
