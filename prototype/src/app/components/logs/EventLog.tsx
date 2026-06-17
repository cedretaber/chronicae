import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useSimulationStore, type EntityType } from '@/app/stores/simulationStore'
import type { SimEvent } from '@sim/types/event'
import type { EventType } from '@sim/types/event'
import { getFirstEntityId, hasEntityId } from '@sim/types/event'
import type { ClanId } from '@sim/types/ids'
import { useRenderEvent } from '@/app/hooks/useRenderEvent'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getPolityShortName, getHouseDisplayName } from '@/app/hooks/entityNameHelpers'
import { formatYearWeek, formatMonthWeek, formatYear } from '@/app/utils/format'
import { CHRONICLE_PALETTES, CHRONICLE_SERIF } from '@/app/theme/chronicle'

// EventLog は「世界の出来事の生の日録」=束ねた年代記 (ChronicleAnnal) の対。host の暗色バーに
//   馴染む dark トーンの共有トークンで描き、アクセントを鉄丹の朱に一本化する (旧: 青タブ +
//   赤/黄重要度 + 青リンクの 3 系統を解消)。重要度は本文インクの濃淡 + 種別アイコンの色で示す。
const P = CHRONICLE_PALETTES.dark

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
        name: getPolityShortName(state, resolveName, polity.id),
      })
  }
  const houseId = getFirstEntityId(event, 'house')
  if (houseId) {
    const house = state.houses[houseId as keyof typeof state.houses]
    if (house)
      items.push({
        id: house.id,
        type: 'house',
        name: getHouseDisplayName(resolveName, house, house.nameKey),
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
      const clanName = getHouseDisplayName(resolveName, nameHouse, clanEntityId)
      items.push({ id: clan.id, type: 'clan', name: clanName })
    }
  }

  if (items.length === 0) return null
  return (
    <span className="ml-1 inline-flex gap-1">
      {items.map((it) => (
        <button
          key={`${it.type}:${it.id}`}
          // 朱アクセントに合わせた静かな参照チップ (旧: 青)。border は dark.rail / hover で朱に。
          className="rounded-sm border border-[#374151] px-1 text-[10px] text-slate-300 transition-colors hover:border-[#CC7A5C] hover:text-[#CC7A5C]"
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
  REPUBLIC_FOUNDED: '🏛️',
  REPUBLIC_LEADER_ELECTED: '🗳️',
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

// 1 行の出来事。日付 (tabular・二次色) → 種別アイコン (重要度色) → 本文 (重要度でインク濃淡) → 参照。
//   種別アイコンが「余白の印」を兼ね、重要度を色で運ぶ (旧: 赤/黄の本文色を廃し統一)。
function EventRow({
  event,
  renderEvent,
  dateLabel,
  typeLabel,
  highlighted,
}: {
  event: SimEvent
  renderEvent: (e: SimEvent) => string
  dateLabel: string
  typeLabel?: string
  highlighted?: boolean
}) {
  const style: CSSProperties = { color: P.ink[event.importance] }
  if (highlighted) {
    style.borderLeft = `2px solid ${P.rubric}`
    style.paddingLeft = 4
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-0.5 text-xs" style={style}>
      <span className="tabular-nums" style={{ color: P.inkSoft }}>
        [{dateLabel}]
      </span>
      <span style={{ color: P.mark[event.importance].color }}>{getEventIcon(event.type)}</span>
      {typeLabel && (
        <span className="text-[10px] tracking-[0.04em]" style={{ color: P.category }}>
          {typeLabel}
        </span>
      )}
      <span>{renderEvent(event)}</span>
      <EventLinks event={event} />
    </div>
  )
}

function RawLogRow({
  event,
  renderEvent,
}: {
  event: SimEvent
  renderEvent: (e: SimEvent) => string
}) {
  const getTypeLabel = useEventTypeLabel()
  return (
    <EventRow
      event={event}
      renderEvent={renderEvent}
      dateLabel={formatYearWeek(event.year, event.weekOfYear)}
      typeLabel={getTypeLabel(event.type)}
    />
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
  return (
    <EventRow
      event={event}
      renderEvent={renderEvent}
      dateLabel={formatYearWeek(event.year, event.weekOfYear)}
      highlighted={isHighlighted}
    />
  )
}

type YearGroup = { year: number; events: SimEvent[] }

// timeline タブ: 主要イベントの「日録」。年代記パネル (ChronicleAnnal) と双子の、時の罫 +
//   朱書のセリフ年見出し (sticky) を持つ縦の年譜。
function TimelineYear({
  year,
  events,
  renderEvent,
}: YearGroup & { renderEvent: (e: SimEvent) => string }) {
  return (
    <div className="relative mb-1 pl-3">
      {/* 時の罫: 左マージンを貫く一本の縦罫 */}
      <div
        className="pointer-events-none absolute top-0 bottom-0 left-0 w-px"
        style={{ backgroundColor: P.rail }}
      />
      {/* 朱書の年見出し (スクロール時 sticky)。-ml-3 + pl-3 で罫の上まで地色を被せる。 */}
      <div className="sticky top-0 z-10 mb-1 -ml-3 flex items-baseline gap-2 bg-gray-900 py-0.5 pl-3">
        <span
          className={`${P.yearHeadSize} font-semibold`}
          style={{ fontFamily: CHRONICLE_SERIF, color: P.rubric }}
        >
          {formatYear(year)}
        </span>
        <span className="h-px flex-1 translate-y-[-3px]" style={{ backgroundColor: P.rail }} />
      </div>
      {events.map((e) => (
        <EventRow
          key={e.id}
          event={e}
          renderEvent={renderEvent}
          dateLabel={formatMonthWeek(e.weekOfYear)}
        />
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
      <div className="flex border-b" style={{ borderColor: P.rail }}>
        {TAB_KEYS.map((key) => {
          const active = activeTab === key
          return (
            <button
              key={key}
              className={`flex-1 px-3 py-1 text-xs transition-colors ${
                active ? 'bg-gray-800' : 'hover:bg-gray-800'
              }`}
              style={
                active
                  ? { color: P.rubric, borderBottom: `2px solid ${P.rubric}` }
                  : { color: P.inkSoft }
              }
              onClick={() => setActiveTab(key)}
            >
              {t(`tabs.${key === 'raw' ? 'raw_log' : key}`)}
            </button>
          )
        })}
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
