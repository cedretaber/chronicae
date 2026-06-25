import type { ChronicleEntry } from '@sim/types/chronicle'
import type { ChronicleWriter } from '@sim/chronicle/chronicleStore'
import type { ChronicleReader, EntityRefKind } from './chronicleReader'

const DB_NAME = 'chronicae-chronicle'
const DB_VERSION = 1
const STORE_NAME = 'entries'

const FLUSH_INTERVAL_MS = 300
const BUFFER_SIZE_LIMIT = 500

type IndexedEntry = ChronicleEntry & {
  refPersonIds: string[]
  refHouseIds: string[]
  refPolityIds: string[]
  refProvinceIds: string[]
  refHoldingIds: string[]
  refWarIds: string[]
}

function toIndexedEntry(entry: ChronicleEntry): IndexedEntry {
  const refPersonIds: string[] = []
  const refHouseIds: string[] = []
  const refPolityIds: string[] = []
  const refProvinceIds: string[] = []
  const refHoldingIds: string[] = []
  const refWarIds: string[] = []
  for (const ref of entry.entityRefs) {
    switch (ref.kind) {
      case 'person':
        refPersonIds.push(ref.id)
        break
      case 'house':
        refHouseIds.push(ref.id)
        break
      case 'polity':
        refPolityIds.push(ref.id)
        break
      case 'province':
        refProvinceIds.push(ref.id)
        break
      case 'holding':
        refHoldingIds.push(ref.id)
        break
      case 'war':
        refWarIds.push(ref.id)
        break
    }
  }
  return {
    ...entry,
    refPersonIds,
    refHouseIds,
    refPolityIds,
    refProvinceIds,
    refHoldingIds,
    refWarIds,
  }
}

const KIND_TO_INDEX: Record<EntityRefKind, string> = {
  person: 'by_person',
  house: 'by_house',
  polity: 'by_polity',
  province: 'by_province',
  holding: 'by_holding',
  war: 'by_war',
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('by_person', 'refPersonIds', { multiEntry: true })
        store.createIndex('by_house', 'refHouseIds', { multiEntry: true })
        store.createIndex('by_polity', 'refPolityIds', { multiEntry: true })
        store.createIndex('by_province', 'refProvinceIds', { multiEntry: true })
        store.createIndex('by_holding', 'refHoldingIds', { multiEntry: true })
        store.createIndex('by_war', 'refWarIds', { multiEntry: true })
        store.createIndex('by_year', 'year', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB error'))
  })
}

export function createIndexedDbChronicleStore(): ChronicleWriter &
  ChronicleReader & { dispose(): void } {
  let buffer: ChronicleEntry[] = []
  let flushing: Promise<void> | null = null
  let dbPromise: Promise<IDBDatabase> | null = null
  let timerId: ReturnType<typeof setInterval> | null = null

  function getDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = openDb()
    }
    return dbPromise
  }

  async function drainBuffer(): Promise<void> {
    if (buffer.length === 0) return
    const batch = buffer
    buffer = []
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      for (const entry of batch) {
        store.put(toIndexedEntry(entry))
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'))
    })
  }

  async function scheduledFlush(): Promise<void> {
    if (flushing) return
    flushing = drainBuffer().finally(() => {
      flushing = null
    })
    return flushing
  }

  timerId = setInterval(() => {
    void scheduledFlush()
  }, FLUSH_INTERVAL_MS)

  return {
    append(entries: ChronicleEntry[]): void {
      buffer.push(...entries)
      if (buffer.length >= BUFFER_SIZE_LIMIT) {
        void scheduledFlush()
      }
    },

    async flush(): Promise<void> {
      if (flushing) await flushing
      await drainBuffer()
    },

    async clear(): Promise<void> {
      buffer = []
      if (flushing) await flushing
      const db = await getDb()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const req = store.clear()
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request error'))
      })
    },

    async queryByEntity(kind: EntityRefKind, id: string): Promise<ChronicleEntry[]> {
      if (flushing) await flushing
      await drainBuffer()
      const db = await getDb()
      const indexName = KIND_TO_INDEX[kind]
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const index = store.index(indexName)
        const req = index.getAll(id)
        req.onsuccess = () => {
          const entries = (req.result as ChronicleEntry[]).sort(
            (a, b) => b.year - a.year || b.weekOfYear - a.weekOfYear,
          )
          resolve(entries)
        }
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request error'))
      })
    },

    async queryAll(options?: { limit?: number; offset?: number }): Promise<ChronicleEntry[]> {
      if (flushing) await flushing
      await drainBuffer()
      const db = await getDb()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = store.getAll()
        req.onsuccess = () => {
          let entries = (req.result as ChronicleEntry[]).sort(
            (a, b) => b.year - a.year || b.weekOfYear - a.weekOfYear,
          )
          const offset = options?.offset ?? 0
          const limit = options?.limit
          if (offset > 0 || limit !== undefined) {
            entries = entries.slice(offset, limit !== undefined ? offset + limit : undefined)
          }
          resolve(entries)
        }
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request error'))
      })
    },

    dispose(): void {
      if (timerId !== null) {
        clearInterval(timerId)
        timerId = null
      }
    },
  }
}
