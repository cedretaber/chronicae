import type { EventType } from '../types/event'
import type { ChronicleCategory } from '../types/chronicle'

// v0.38 §6.3: curated allowlist。importance 閾値ではなく EventType allowlist で Chronicle 化対象を決める。
// 低頻度・高 signal を中心にし、高頻度の行政イベント (office / 汎用 project / bailiff) は初期では入れない。
export const CHRONICLE_EVENT_CATEGORIES: Partial<Record<EventType, ChronicleCategory>> = {
  // War / Battle
  WAR_DECLARED: 'war',
  WAR_WON: 'war',
  WAR_LOST: 'war',
  WAR_ENDED: 'war',
  PEACE_SETTLEMENT_APPLIED: 'war',
  BATTLE_OCCURRED: 'battle',
  // Land (LAND_CONTRACT_TRANSFERRED 一本。PURCHASED/CEDED/CONQUERED は二重計上回避で除外)
  LAND_CONTRACT_TRANSFERRED: 'land',
  // House
  HOUSE_FOUNDED: 'house',
  CADET_HOUSE_FOUNDED: 'house',
  HOUSE_SPLIT: 'house',
  HOUSE_EXTINCT: 'house',
  HOUSE_LEADER_CHANGED: 'house',
  // Governance
  POLITY_OWNER_CHANGED: 'governance',
  // Revolt
  REVOLT_POLITY_FOUNDED: 'revolt',
  REVOLT_NEGOTIATION_STARTED: 'revolt',
  // Disaster
  FAMINE: 'disaster',
  PLAGUE: 'disaster',
  // Development
  COUNTRY_LAND_DEVELOPED: 'development',
  // Life
  IMPORTANT_PERSON_DIED: 'life',
}
