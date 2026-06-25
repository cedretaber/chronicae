import type { ChronicleEntry } from '@sim/types/chronicle'

export type EntityRefKind = 'person' | 'house' | 'polity' | 'province' | 'holding' | 'war'

export interface ChronicleReader {
  queryByEntity(kind: EntityRefKind, id: string): Promise<ChronicleEntry[]>
  queryAll(options?: { limit?: number; offset?: number }): Promise<ChronicleEntry[]>
}
