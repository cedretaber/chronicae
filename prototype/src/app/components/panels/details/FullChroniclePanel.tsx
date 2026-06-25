import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChronicleEntry } from '@sim/types/chronicle'
import type { EntityType } from '@/app/stores/simulationStore'
import { ChronicleAnnal } from './shared/ChronicleAnnal'
import { getChronicleReader } from '@/app/chronicle/useChronicleEntries'
import type { EntityRefKind } from '@/app/chronicle/chronicleReader'

const PAGE_SIZE = 100

const ENTITY_TYPE_TO_REF_KIND: Partial<Record<EntityType, EntityRefKind>> = {
  person: 'person',
  house: 'house',
  polity: 'polity',
  province: 'province',
  holding: 'holding',
  war: 'war',
}

export function FullChroniclePanel({
  entityType,
  entityId,
}: {
  entityType: EntityType
  entityId: string
}) {
  const { t } = useTranslation()
  const [ascending, setAscending] = useState(true)
  const [shown, setShown] = useState(PAGE_SIZE)
  const [entries, setEntries] = useState<ChronicleEntry[]>([])

  const refKind = ENTITY_TYPE_TO_REF_KIND[entityType]

  useEffect(() => {
    const reader = getChronicleReader()
    if (!reader || !refKind) return
    let cancelled = false
    reader.queryByEntity(refKind, entityId).then(
      (result) => {
        if (!cancelled) setEntries(result)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [entityType, entityId, refKind])

  const ordered = useMemo(() => {
    return ascending ? [...entries].reverse() : entries
  }, [entries, ascending])

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
