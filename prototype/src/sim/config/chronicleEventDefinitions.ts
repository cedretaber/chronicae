import type { EventType, EventEntityRef, SimEvent } from '../types/event'
import type { ChronicleCategory } from '../types/chronicle'

// v0.38 §6.2: Chronicle 化対象 EventType の定義。importance 閾値ではなく allowlist で決める。
//   低頻度・高 signal を中心にし、高頻度の行政イベントは byPerson 限定などで選択投入する。
export type ChronicleEventDefinition = {
  category: ChronicleCategory
  // この event を chronicle 化する際、entityRefs をこの kind のみに絞る (projection で filter)。
  //   未指定なら全 ref を保持 (Phase 1 挙動)。office を byPerson 限定にするため ['person']。
  //   ref を絞ることで byHouse/byPolity index に載らず、かつ entry.entityRefs が
  //   絞り込み後と一致するので integrity (index↔entry) は無改修で通る。
  retainRefKinds?: readonly EventEntityRef['kind'][]
  // templateKey override。string=固定、関数=event の params から narrative key を選ぶ。
  //   未指定なら event.messageKey をそのまま使う (Phase 1 挙動)。
  templateKey?: string | ((event: SimEvent) => string)
}

export const CHRONICLE_EVENT_TYPE_DEFINITIONS: Partial<
  Record<EventType, ChronicleEventDefinition>
> = {
  // War / Battle
  WAR_DECLARED: { category: 'war' },
  WAR_WON: { category: 'war' },
  WAR_LOST: { category: 'war' },
  WAR_ENDED: { category: 'war' },
  PEACE_SETTLEMENT_APPLIED: { category: 'war' },
  BATTLE_OCCURRED: { category: 'battle' },
  // Land (LAND_CONTRACT_TRANSFERRED 一本。PURCHASED/CEDED/CONQUERED は二重計上回避で除外)
  LAND_CONTRACT_TRANSFERRED: { category: 'land' },
  // House
  HOUSE_FOUNDED: { category: 'house' },
  CADET_HOUSE_FOUNDED: { category: 'house' },
  HOUSE_SPLIT: { category: 'house' },
  HOUSE_EXTINCT: { category: 'house' },
  HOUSE_LEADER_CHANGED: { category: 'house' },
  // Governance
  POLITY_OWNER_CHANGED: { category: 'governance' },
  // Revolt
  REVOLT_POLITY_FOUNDED: { category: 'revolt' },
  REVOLT_NEGOTIATION_STARTED: { category: 'revolt' },
  // Disaster
  FAMINE: { category: 'disaster' },
  PLAGUE: { category: 'disaster' },
  // Development
  COUNTRY_LAND_DEVELOPED: { category: 'development' },
  // Life
  IMPORTANT_PERSON_DIED: { category: 'life' },
}
