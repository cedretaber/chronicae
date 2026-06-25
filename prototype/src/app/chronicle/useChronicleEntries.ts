import { useState, useEffect } from 'react'
import type { ChronicleEntry } from '@sim/types/chronicle'
import type { ChronicleReader, EntityRefKind } from './chronicleReader'

let _reader: ChronicleReader | null = null

export function setChronicleReader(reader: ChronicleReader | null): void {
  _reader = reader
}

export function getChronicleReader(): ChronicleReader | null {
  return _reader
}

export function useChronicleEntriesForEntity(
  kind: EntityRefKind,
  id: string | undefined,
): { entries: ChronicleEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<ChronicleEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!_reader || !id) return
    let cancelled = false
    const reader = _reader
    void reader.queryByEntity(kind, id).then((result) => {
      if (!cancelled) {
        setEntries(result)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [kind, id])

  return { entries, loading }
}
