import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChronicleEntry } from '@sim/types/chronicle'
import type { EventEntityRef } from '@sim/types/event'
import type { WorldState } from '@sim/types/world'
import { useRenderEvent } from '@/app/hooks/useRenderEvent'
import { useEntityName } from '@/app/hooks/useEntityName'
import {
  getPolityShortName,
  getHouseDisplayName,
  getHoldingShortName,
} from '@/app/hooks/entityNameHelpers'
import { useSimulationStore, type EntityType } from '@/app/stores/simulationStore'
import { formatYear, formatMonthWeek } from '@/app/utils/format'
import { CHRONICLE_PALETTES, CHRONICLE_SERIF, type ChronicleTone } from '@/app/theme/chronicle'

// ChronicleEntry.entityRefs を「クリック可能な参照チップ」に解決する。EventLog の EventLinks の
//   ChronicleEntry 版。EventLog と同じく「種別ごとに先頭 1 件・実在する対象のみ」に絞る (chip 過多回避)。
//   会戦再生 UI: major BATTLE_OCCURRED が持つ battleLog ref を会戦再生パネルへのリンクにする。
type ChronicleLinkItem = { id: string; type: EntityType; name: string }

function resolveRefLink(
  state: WorldState,
  resolveName: ReturnType<typeof useEntityName>,
  ref: EventEntityRef,
): ChronicleLinkItem | null {
  switch (ref.kind) {
    case 'person': {
      const p = state.persons[ref.id as keyof typeof state.persons]
      return p
        ? { id: ref.id, type: 'person', name: resolveName('person', p.nameKey, p.nameKey) }
        : null
    }
    case 'house': {
      const h = state.houses[ref.id as keyof typeof state.houses]
      return h
        ? { id: ref.id, type: 'house', name: getHouseDisplayName(resolveName, h, h.nameKey) }
        : null
    }
    case 'polity': {
      const pl = state.polities[ref.id as keyof typeof state.polities]
      return pl
        ? { id: ref.id, type: 'polity', name: getPolityShortName(state, resolveName, pl.id) }
        : null
    }
    case 'province': {
      const pr = state.provinces[ref.id as keyof typeof state.provinces]
      return pr
        ? { id: ref.id, type: 'province', name: resolveName('province', pr.nameKey, ref.id) }
        : null
    }
    case 'holding': {
      const ho = state.holdings[ref.id as keyof typeof state.holdings]
      return ho
        ? { id: ref.id, type: 'holding', name: getHoldingShortName(state, resolveName, ho.id) }
        : null
    }
    case 'clan': {
      const c = state.clans[ref.id as keyof typeof state.clans]
      if (!c) return null
      const nh = state.houses[c.nameSourceHouseId]
      return { id: ref.id, type: 'clan', name: getHouseDisplayName(resolveName, nh, ref.id) }
    }
    case 'battleLog': {
      const b = state.battleLogs[ref.id as keyof typeof state.battleLogs]
      if (!b) return null
      const prov = state.provinces[b.provinceId]
      const place = prov
        ? resolveName('province', prov.nameKey, b.provinceId)
        : (b.provinceId as string)
      return { id: ref.id, type: 'battleLog', name: `⚔ ${place}` }
    }
    default:
      // war/faction/goal/aim 等は detail window が無い or 終結で消えるためリンク化しない。
      return null
  }
}

function ChronicleLinks({ refs, tone }: { refs: readonly EventEntityRef[]; tone: ChronicleTone }) {
  const session = useSimulationStore((s) => s.session)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)
  const resolveName = useEntityName()
  if (!session) return null
  const state = session.currentState
  const items: ChronicleLinkItem[] = []
  const seenKinds = new Set<string>()
  for (const ref of refs) {
    if (seenKinds.has(ref.kind)) continue
    const link = resolveRefLink(state, resolveName, ref)
    if (!link) continue
    seenKinds.add(ref.kind)
    items.push(link)
  }
  if (items.length === 0) return null
  const p = CHRONICLE_PALETTES[tone]
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {items.map((it) => (
        <button
          key={`${it.type}:${it.id}`}
          className="rounded-sm border px-1 text-[10px] transition-opacity hover:opacity-70"
          style={{ borderColor: p.rail, color: p.category }}
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

// 年代記の「視覚言語」を共有する描画コンポーネント。配色トークンは @/app/theme/chronicle に集約し、
//   FullChroniclePanel (vellum) / EntityChronicleSection (dark) / EventLog (dark) が同じ語彙
//   (時の罫 + 朱書の年見出し + 週·重要度印·カテゴリ·本文) を tone 差し替えで共有する。

// 表示順を保ったまま、連続する同年エントリを 1 つの年グループに畳む。
//   年代記は「年で編まれる」(annal) ので、年をグルーピングの単位にすること自体が情報。
type YearGroup = { year: number; entries: ChronicleEntry[] }
function groupByYear(entries: ChronicleEntry[]): YearGroup[] {
  const groups: YearGroup[] = []
  for (const e of entries) {
    const last = groups[groups.length - 1]
    if (last && last.year === e.year) {
      last.entries.push(e)
    } else {
      groups.push({ year: e.year, entries: [e] })
    }
  }
  return groups
}

// 既に表示順・件数調整済みの entries を「年代記官の台帳」として描画する。
//   左マージンを貫く時の罫が全年を串刺しにし、朱書の年見出しがアンカーになる。
export function ChronicleAnnal({
  entries,
  tone,
}: {
  entries: ChronicleEntry[]
  tone: ChronicleTone
}) {
  const { t } = useTranslation()
  const renderEvent = useRenderEvent()
  const p = CHRONICLE_PALETTES[tone]
  const groups = useMemo(() => groupByYear(entries), [entries])

  return (
    <div className="relative pl-3">
      {/* 時の罫: 左マージンを貫く一本の縦罫 (写本の綴じ目・罫線)。全年グループを串刺しにする。 */}
      <div
        className="pointer-events-none absolute top-0 bottom-0 left-0 w-px"
        style={{ backgroundColor: p.rail }}
      />
      {groups.map((g) => (
        <div key={`${g.year}-${g.entries[0]?.id ?? ''}`}>
          {/* 朱書の年見出し + 右へ伸びるヘアライン */}
          <div className="mt-3 mb-1 flex items-baseline gap-2 first:mt-0">
            <span
              className={`${p.yearHeadSize} font-semibold`}
              style={{ fontFamily: CHRONICLE_SERIF, color: p.rubric }}
            >
              {formatYear(g.year)}
            </span>
            <span className="h-px flex-1 translate-y-[-3px]" style={{ backgroundColor: p.rail }} />
          </div>
          {g.entries.map((e) => {
            const mark = p.mark[e.importance]
            return (
              <div key={e.id} className="flex gap-2 py-[3px] text-[12px] leading-[1.45]">
                <span
                  className="w-[4.75rem] shrink-0 text-right tabular-nums"
                  style={{ color: p.inkSoft }}
                >
                  {formatMonthWeek(e.weekOfYear)}
                </span>
                <span className="w-3 shrink-0 text-center" style={{ color: mark.color }}>
                  {mark.glyph}
                </span>
                <span className="min-w-0 flex-1" style={{ color: p.ink[e.importance] }}>
                  <span
                    className="mr-1.5 text-[10px] tracking-[0.08em] uppercase"
                    style={{ color: p.category }}
                  >
                    {t(`chronicle.category.${e.category}`)}
                  </span>
                  {renderEvent({ messageKey: e.templateKey, messageParams: e.params })}
                  <ChronicleLinks refs={e.entityRefs} tone={tone} />
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
