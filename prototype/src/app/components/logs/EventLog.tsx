import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSimulationStore, type EntityType } from '@/app/stores/simulationStore'
import type { SimEvent } from '@sim/types/event'
import type { EventType } from '@sim/types/event'
import { getFirstEntityId, hasEntityId } from '@sim/types/event'
import type { ClanId } from '@sim/types/ids'
import { useRenderEvent } from '@/app/hooks/useRenderEvent'
import { useEntityName } from '@/app/hooks/useEntityName'

type LinkItem = { id: string; type: EntityType; name: string }

function EventLinks({ event }: { event: SimEvent }) {
  const session = useSimulationStore((s) => s.session)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)
  const resolveName = useEntityName()

  if (!session) return null
  const state = session.currentState

  const items: LinkItem[] = []
  const polityId = getFirstEntityId(event, 'polity')
  if (polityId) {
    const polity = state.polities[polityId as keyof typeof state.polities]
    if (polity)
      items.push({
        id: polity.id,
        type: 'polity',
        name: resolveName('polity', polity.nameKey, polity.nameKey),
      })
  }
  const houseId = getFirstEntityId(event, 'house')
  if (houseId) {
    const house = state.houses[houseId as keyof typeof state.houses]
    if (house)
      items.push({
        id: house.id,
        type: 'house',
        name: resolveName('house', house.nameKey, house.nameKey),
      })
  }
  const actorId = getFirstEntityId(event, 'person')
  if (actorId) {
    const person = state.persons[actorId as keyof typeof state.persons]
    if (person)
      items.push({
        id: person.id,
        type: 'person',
        name: resolveName('person', person.nameKey, person.nameKey),
      })
  }
  const clanEntityId = getFirstEntityId(event, 'clan')
  if (clanEntityId) {
    const clan = state.clans[clanEntityId as ClanId]
    if (clan) {
      const nameHouse = state.houses[clan.nameSourceHouseId]
      const clanName = nameHouse
        ? resolveName('house', nameHouse.nameKey, nameHouse.nameKey)
        : clanEntityId
      items.push({ id: clan.id, type: 'clan', name: clanName })
    }
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

const TAB_KEYS: TabKey[] = ['raw', 'chronicle', 'timeline']

const MAX_RAW_EVENTS = 100
const MAX_CHRONICLE_EVENTS = 50

// v0.40 §10.6: メイン EventLog は major/critical のみ表示する。加えて成人/老年入りの
//   life event は主要人物（importance==='normal'）のときのみ表示する例外を設ける。
//   一般人物（minor）の life event は Person Chronicle のみで確認できる。
function isMainLogEvent(e: SimEvent): boolean {
  if (e.importance === 'major' || e.importance === 'critical') return true
  if (
    (e.type === 'PERSON_CAME_OF_AGE' || e.type === 'PERSON_ENTERED_OLD_AGE') &&
    e.importance === 'normal'
  ) {
    return true
  }
  return false
}

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
  // v0.35 WarManeuver
  BATTLE_OCCURRED: '⚔',
  BATTLE_AVOIDED: '🛡',
  WAR_CAPTAIN_GENERAL_CHANGED: '🎖',
  // v0.36 補充・再編成
  REGIMENT_REFORMED: '🛡',
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
  CONTRACT_TAX_REVISED: '📜',
  CONTRACT_ELIMINATED: '🔥',
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
  // v0.32 Clan
  CLAN_FOUNDED: '🏛',
}

function getEventIcon(type: EventType): string {
  return EVENT_ICON[type] ?? '·'
}

function isWatchlistRelated(event: SimEvent, watchlist: string[]): boolean {
  return watchlist.some((id) => hasEntityId(event, id))
}

function useEventTypeLabel(): (type: EventType) => string {
  const { t } = useTranslation('ui')
  return (type: EventType) => {
    const key = `event_type.${type}`
    const translated = t(key, { defaultValue: '' })
    if (translated && translated !== key) return translated
    return type.replace(/_/g, ' ')
  }
}

function RawLogRow({
  event,
  renderEvent,
}: {
  event: SimEvent
  renderEvent: (e: SimEvent) => string
}) {
  const colorClass = getImportanceColor(event.importance)
  const getTypeLabel = useEventTypeLabel()
  const typeLabel = getTypeLabel(event.type)

  return (
    <div className={`flex flex-wrap items-center gap-2 py-0.5 text-xs ${colorClass}`}>
      <span className="text-gray-500">
        [{event.year}/{event.weekOfYear}] {getEventIcon(event.type)} {typeLabel}
      </span>
      <span>{renderEvent(event)}</span>
      <EventLinks event={event} />
    </div>
  )
}

function ChronicleRow({
  event,
  isHighlighted,
  renderEvent,
}: {
  event: SimEvent
  isHighlighted: boolean
  renderEvent: (e: SimEvent) => string
}) {
  const colorClass = getImportanceColor(event.importance)
  const icon = getEventIcon(event.type)

  return (
    <div
      className={`flex flex-wrap items-center gap-2 py-0.5 text-xs ${colorClass} ${
        isHighlighted ? 'border-l-2 border-yellow-400 pl-1' : ''
      }`}
    >
      <span className="text-gray-500">
        [{event.year}/{event.weekOfYear}] {icon}
      </span>
      <span>{renderEvent(event)}</span>
      <EventLinks event={event} />
    </div>
  )
}

type YearGroup = { year: number; events: SimEvent[] }

function TimelineYear({
  year,
  events,
  renderEvent,
}: YearGroup & { renderEvent: (e: SimEvent) => string }) {
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
          <span className="text-gray-500">[W{e.weekOfYear}] </span>
          <span>{renderEvent(e)}</span>
          <EventLinks event={e} />
        </div>
      ))}
    </div>
  )
}

export function EventLog() {
  const { t } = useTranslation()
  const renderEvent = useRenderEvent()
  const [activeTab, setActiveTab] = useState<TabKey>('raw')
  const eventHistory = useSimulationStore((s) => s.session?.eventHistory ?? [])
  const watchlist = useSimulationStore((s) => s.watchlist)

  const rawEvents = [...eventHistory].reverse().slice(0, MAX_RAW_EVENTS)
  const chronicleEvents = [...eventHistory]
    .reverse()
    .filter(isMainLogEvent)
    .slice(0, MAX_CHRONICLE_EVENTS)

  const timelineEvents = eventHistory.filter(isMainLogEvent)
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
        {TAB_KEYS.map((key) => (
          <button
            key={key}
            className={`flex-1 px-3 py-1 text-xs ${
              activeTab === key
                ? 'border-b-2 border-blue-400 bg-gray-800'
                : 'text-gray-400 hover:bg-gray-800'
            }`}
            onClick={() => setActiveTab(key)}
          >
            {t(`tabs.${key === 'raw' ? 'raw_log' : key}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'raw' &&
          rawEvents.map((event) => (
            <RawLogRow key={event.id} event={event} renderEvent={renderEvent} />
          ))}
        {activeTab === 'chronicle' &&
          chronicleEvents.map((event) => (
            <ChronicleRow
              key={event.id}
              event={event}
              isHighlighted={isWatchlistRelated(event, watchlist)}
              renderEvent={renderEvent}
            />
          ))}
        {activeTab === 'timeline' &&
          sortedGroups.map((group) => (
            <TimelineYear key={group.year} {...group} renderEvent={renderEvent} />
          ))}
      </div>
    </div>
  )
}
