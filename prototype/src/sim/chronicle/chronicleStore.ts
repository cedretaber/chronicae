import type { ChronicleEntry } from '../types/chronicle'

export interface ChronicleWriter {
  append(entries: ChronicleEntry[]): void
  flush(): Promise<void>
  clear(): Promise<void>
}

export const nullChronicleWriter: ChronicleWriter = {
  append() {},
  flush() {
    return Promise.resolve()
  },
  clear() {
    return Promise.resolve()
  },
}
