import { useMemo } from 'react'
import { useEntityName } from '@/app/hooks/useEntityName'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { calcPersonImportanceScore } from '@sim/selectors/importanceSelectors'
import { calcPolityMilitaryPower } from '@sim/selectors/militarySelectors'
import {
  getActiveFactions,
  getFactionActiveMemberIds,
  getFactionDepth,
} from '@sim/selectors/factionSelectors'
import {
  getHouseControlledProvinceIds,
  getHouseOwnedPolityIds,
} from '@sim/selectors/landContractSelectors'
import { buildPolityColorMap } from '@/app/utils/polityColors'
import { defaultConfig } from '@/sim/config/defaultConfig'
import type { Polity, PolityRank } from '@/sim/types/polity'
import type { House } from '@/sim/types/house'
import type { Person } from '@/sim/types/person'
import type { Faction } from '@/sim/types/faction'
import type { DiplomaticPlay } from '@/sim/types/diplomaticPlay'
import type { War } from '@/sim/types/war'
import type { StateRegion } from '@/sim/types/stateRegion'
import type { MerchantCompany } from '@/sim/types/merchant'
import type { HouseId } from '@sim/types/ids'
import { getActiveRouteCount } from '@sim/selectors/merchantSelectors'

export type SectionKey =
  | 'countries'
  | 'houses'
  | 'persons'
  | 'factions'
  | 'watchlist'
  | 'plays'
  | 'wars'
  | 'markets'
  | 'merchants'

export const SECTION_KEYS: SectionKey[] = [
  'watchlist',
  'plays',
  'wars',
  'countries',
  'houses',
  'persons',
  'factions',
  'markets',
  'merchants',
]

export type SidebarData = {
  sortedPolities: Polity[]
  polityGroups: { rank: PolityRank; polities: Polity[] }[]
  polityColorMap: Record<string, string>
  polityMilitaryPowers: Record<string, number>
  houseEntries: { house: House; provinceCount: number }[]
  rulingHouses: { house: House; provinceCount: number }[]
  landlessHouses: { house: House; provinceCount: number }[]
  sortedPersons: { person: Person; score: number }[]
  factionEntries: { faction: Faction; leaderName: string; memberCount: number; tier: number }[]
  activePlays: DiplomaticPlay[]
  activeWars: War[]
  stateRegions: StateRegion[]
  merchantEntries: { company: MerchantCompany; routeCount: number }[]
  sectionCount: Record<SectionKey, number>
}

/**
 * Sidebar の各セクション用に派生データ (sort/filter/集計) をまとめて導出する。
 * データ導出と描画を分離するための抽出。recompute 挙動は元の Sidebar と同一
 * (polityColorMap / polityMilitaryPowers のみ useMemo、他は毎レンダー計算)。
 */
export function useSidebarData(): SidebarData {
  const session = useSimulationStore((s) => s.session)
  const watchlist = useSimulationStore((s) => s.watchlist)
  const eventHistory = useSimulationStore((s) => s.session?.eventHistory ?? [])
  const resolveName = useEntityName()

  const polities = session?.currentState.polities
  const houses = session?.currentState.houses
  const persons = session?.currentState.persons

  const sortedPolities: Polity[] = polities
    ? Object.values(polities)
        .filter((p) => p.active)
        .sort((a, b) => {
          if (a.rank !== b.rank) return a.rank - b.rank
          return b.legacyPrestige - a.legacyPrestige
        })
    : []

  const polityGroups: { rank: PolityRank; polities: Polity[] }[] = []
  for (const polity of sortedPolities) {
    const last = polityGroups[polityGroups.length - 1]
    if (last && last.rank === polity.rank) {
      last.polities.push(polity)
    } else {
      polityGroups.push({ rank: polity.rank, polities: [polity] })
    }
  }

  const polityColorMap = useMemo(
    () => (polities ? buildPolityColorMap(Object.keys(polities)) : {}),
    [polities],
  )

  const polityMilitaryPowers = useMemo(() => {
    if (!session?.currentState) return {}
    const state = session.currentState
    return Object.fromEntries(
      Object.values(state.polities ?? {}).map((p) => [
        p.id,
        calcPolityMilitaryPower(state, defaultConfig, p.id),
      ]),
    )
  }, [session])

  const houseEntries: { house: House; provinceCount: number }[] = houses
    ? Object.values(houses)
        .filter((h) => h.active && h.kind !== 'system')
        .map((h) => ({
          house: h,
          provinceCount: session?.currentState
            ? getHouseControlledProvinceIds(session.currentState, h.id).length
            : 0,
        }))
        .sort((a, b) => b.house.legacyPrestige - a.house.legacyPrestige)
    : []

  const hasActivePolity = (houseId: HouseId): boolean => {
    if (!session?.currentState) return false
    return getHouseOwnedPolityIds(session.currentState, houseId).some((pid) => {
      const p = session.currentState.polities[pid]
      return p?.active === true
    })
  }
  const rulingHouses = houseEntries.filter(
    (e) => e.provinceCount > 0 || hasActivePolity(e.house.id),
  )
  const landlessHouses = houseEntries.filter(
    (e) => e.provinceCount === 0 && !hasActivePolity(e.house.id),
  )

  const sortedPersons: { person: Person; score: number }[] = persons
    ? Object.values(persons)
        .filter((p) => p.alive && p.kind !== 'placeholder')
        .map((p) => ({
          person: p,
          score: session?.currentState
            ? calcPersonImportanceScore(session.currentState, p.id, eventHistory)
            : 0,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
    : []

  const factionEntries: {
    faction: Faction
    leaderName: string
    memberCount: number
    tier: number
  }[] = session?.currentState
    ? getActiveFactions(session.currentState)
        .map((f) => {
          const state = session.currentState
          const leader = persons?.[f.leaderPersonId]
          return {
            faction: f,
            leaderName: leader
              ? resolveName('person', leader.nameKey, leader.nameKey)
              : '(unknown)',
            memberCount: getFactionActiveMemberIds(state, f.id).length,
            // 「N 次派閥」: root(深さ0)=1 次、子=2 次、孫=3 次。
            tier: getFactionDepth(state, f.id) + 1,
          }
        })
        .sort((a, b) => {
          if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount
          return a.faction.foundingWeek - b.faction.foundingWeek
        })
    : []

  const activePlays: DiplomaticPlay[] = session?.currentState
    ? Object.values(session.currentState.diplomaticPlays)
        .filter(
          (p): p is DiplomaticPlay => !!p && (p.status === 'active' || p.status === 'escalated'),
        )
        .sort((a, b) => {
          // escalated を先、次に deadline 近いもの
          if (a.status !== b.status) return a.status === 'escalated' ? -1 : 1
          return a.deadlineWeek - b.deadlineWeek
        })
    : []

  const activeWars: War[] = session?.currentState
    ? Object.values(session.currentState.wars).filter((w): w is War => !!w && w.status === 'active')
    : []

  // v0.54 市場: StateRegion ごとに資源市場が存在する。state 数は大マップでも多くないため全件表示する。
  //   province 数の多い (= 市場規模の大きい) 順に並べる。同数は id で安定ソート。
  const stateRegions: StateRegion[] = session?.currentState
    ? Object.values(session.currentState.states).sort((a, b) => {
        if (b.provinceIds.length !== a.provinceIds.length)
          return b.provinceIds.length - a.provinceIds.length
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
    : []

  // v0.61 商会: active な商会を財庫の多い順に並べる。同額は id で安定ソート。
  const merchantEntries: { company: MerchantCompany; routeCount: number }[] = session?.currentState
    ? (session.currentState.merchantCompanyIndex.byStatus.active ?? [])
        .flatMap((id) => {
          const c = session.currentState.merchantCompanies[id]
          return c ? [c] : []
        })
        .map((company) => ({
          company,
          routeCount: getActiveRouteCount(session.currentState, company.id),
        }))
        .sort((a, b) => {
          if (b.company.treasury !== a.company.treasury)
            return b.company.treasury - a.company.treasury
          return a.company.id < b.company.id ? -1 : a.company.id > b.company.id ? 1 : 0
        })
    : []

  const sectionCount: Record<SectionKey, number> = {
    countries: sortedPolities.length,
    houses: houseEntries.length,
    persons: sortedPersons.length,
    factions: factionEntries.length,
    watchlist: watchlist.length,
    plays: activePlays.length,
    wars: activeWars.length,
    markets: stateRegions.length,
    merchants: merchantEntries.length,
  }

  return {
    sortedPolities,
    polityGroups,
    polityColorMap,
    polityMilitaryPowers,
    houseEntries,
    rulingHouses,
    landlessHouses,
    sortedPersons,
    factionEntries,
    activePlays,
    activeWars,
    stateRegions,
    merchantEntries,
    sectionCount,
  }
}
