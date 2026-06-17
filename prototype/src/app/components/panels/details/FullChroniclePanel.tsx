import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorldState } from '@sim/types/world'
import type { ChronicleEntry } from '@sim/types/chronicle'
import type { PersonId, HouseId, PolityId, ProvinceId, HoldingId, WarId } from '@sim/types/ids'
import {
  getChronicleEntriesForPerson,
  getChronicleEntriesForHouse,
  getChronicleEntriesForPolity,
  getChronicleEntriesForProvince,
  getChronicleEntriesForHolding,
  getChronicleEntriesForWar,
} from '@sim/selectors/chronicleSelectors'
import type { EntityType } from '@/app/stores/simulationStore'
import { ChronicleAnnal } from './shared/ChronicleAnnal'

// 一度に描画する件数。300 年級の polity は数千件になり得るため全件を一気に DOM 化せず
//   「さらに表示」で段階的に伸ばす (将来のページネーションの土台)。
const PAGE_SIZE = 100

// entityType に応じた chronicle selector を引く。chronicle index を持たない種別 (popGroup /
//   faction / diplomaticPlay / clan) は空配列。selector は永続 chronicleIndex を読むため、
//   live entity が消滅していても履歴は取得できる (= 履歴閲覧の本質的価値)。
function selectEntries(
  state: WorldState,
  entityType: EntityType,
  entityId: string,
): ChronicleEntry[] {
  switch (entityType) {
    case 'person':
      return getChronicleEntriesForPerson(state, entityId as PersonId)
    case 'house':
      return getChronicleEntriesForHouse(state, entityId as HouseId)
    case 'polity':
      return getChronicleEntriesForPolity(state, entityId as PolityId)
    case 'province':
      return getChronicleEntriesForProvince(state, entityId as ProvinceId)
    case 'holding':
      return getChronicleEntriesForHolding(state, entityId as HoldingId)
    case 'war':
      return getChronicleEntriesForWar(state, entityId as WarId)
    default:
      return []
  }
}

// 対象 entity の全 chronicle を「年代記官の台帳」(vellum スキン) として表示する panel。
//   構造 (時の罫 + 年見出し + 行) は ChronicleAnnal に集約。ここは件数・並び順・ページングだけ持つ。
//   古い順 (最初から) / 新しい順を切替可能 (selector は降順を返すので古い順は reverse)。
export function FullChroniclePanel({
  entityType,
  entityId,
  state,
}: {
  entityType: EntityType
  entityId: string
  state: WorldState
}) {
  const { t } = useTranslation()
  const [ascending, setAscending] = useState(true)
  const [shown, setShown] = useState(PAGE_SIZE)

  // tick 毎に state が更新され entries は新 identity になるが、shown は useState なので保持される。
  //   entries 依存の reset は入れない (毎 tick でページが 1 に戻ってしまうため)。
  const ordered = useMemo(() => {
    const base = selectEntries(state, entityType, entityId)
    return ascending ? [...base].reverse() : base
  }, [state, entityType, entityId, ascending])

  const visible = ordered.slice(0, shown)
  const remaining = ordered.length - visible.length

  return (
    <div className="px-3 py-3" style={{ color: '#4A4234' }}>
      <div className="mb-2 flex items-center justify-between">
        <span
          className="text-[13px] italic"
          style={{ fontFamily: "'Spectral', Georgia, serif", color: '#8A7F68' }}
        >
          {t('detail.full_chronicle.count', { count: ordered.length })}
        </span>
        <button
          className="rounded-sm border border-[#CBBD9B] bg-[#DCD2B6]/60 px-2 py-0.5 text-[11px] text-[#5A5140] hover:bg-[#D2C7A8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#9E3B2E]"
          onClick={() => setAscending((v) => !v)}
        >
          {ascending ? t('detail.full_chronicle.order_asc') : t('detail.full_chronicle.order_desc')}
        </button>
      </div>
      {ordered.length === 0 ? (
        <div className="text-xs" style={{ color: '#8A7F68' }}>
          {t('detail.full_chronicle.empty')}
        </div>
      ) : (
        <>
          <ChronicleAnnal entries={visible} tone="vellum" />
          {remaining > 0 && (
            <button
              className="mt-3 w-full rounded-sm border border-[#CBBD9B] bg-[#DCD2B6]/50 px-2 py-1 text-[11px] text-[#5A5140] hover:bg-[#D2C7A8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#9E3B2E]"
              onClick={() => setShown((n) => n + PAGE_SIZE)}
            >
              {t('detail.full_chronicle.show_more', { count: Math.min(PAGE_SIZE, remaining) })}
            </button>
          )}
        </>
      )}
    </div>
  )
}
