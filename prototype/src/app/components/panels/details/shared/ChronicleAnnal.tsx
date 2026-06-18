import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChronicleEntry } from '@sim/types/chronicle'
import { EventText } from '@/app/components/shared/EventText'
import { formatYear, formatMonthWeek } from '@/app/utils/format'
import { CHRONICLE_PALETTES, CHRONICLE_SERIF, type ChronicleTone } from '@/app/theme/chronicle'

// 年代記の「視覚言語」を共有する描画コンポーネント。配色トークンは @/app/theme/chronicle に集約し、
//   FullChroniclePanel (vellum) / EntityChronicleSection (dark) / EventLog (dark) が同じ語彙
//   (時の罫 + 朱書の年見出し + 週·重要度印·カテゴリ·本文) を tone 差し替えで共有する。
//   本文中のエンティティ名は EventText がクリック可能なリンクに解決する (entityRefs 経由)。

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
                  <EventText
                    event={{
                      messageKey: e.templateKey,
                      messageParams: e.params,
                      entityRefs: e.entityRefs,
                    }}
                    tone={tone}
                  />
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
