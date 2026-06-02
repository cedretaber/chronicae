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
import { ChronicleEntryLine } from './shared/widgets'

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

// 対象 entity の全 chronicle を一覧表示する panel。古い順 (最初から) / 新しい順を切替可能。
//   selector は降順 (新しい順) を返すので、古い順は reverse する。
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
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-gray-300">
          {t('detail.full_chronicle.count', { count: ordered.length })}
        </span>
        <button
          className="rounded bg-gray-600 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-500"
          onClick={() => setAscending((v) => !v)}
        >
          {ascending ? t('detail.full_chronicle.order_asc') : t('detail.full_chronicle.order_desc')}
        </button>
      </div>
      {ordered.length === 0 ? (
        <div className="text-xs text-gray-500">{t('detail.full_chronicle.empty')}</div>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            {visible.map((e) => (
              <ChronicleEntryLine key={e.id} entry={e} />
            ))}
          </div>
          {remaining > 0 && (
            <button
              className="mt-2 w-full rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
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
