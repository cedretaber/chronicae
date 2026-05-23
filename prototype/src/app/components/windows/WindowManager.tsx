import { useSimulationStore } from '@/app/stores/simulationStore'
import { useEntityName } from '@/app/hooks/useEntityName'
import type { FactionId, DiplomaticPlayId } from '@/sim/types/ids'
import {
  CountryDetail,
  HouseDetail,
  PersonDetail,
  PopGroupDetail,
  ProvinceDetail,
  FactionDetail,
  DiplomaticPlayDetail,
} from '@/app/components/panels/DetailPanel'
import { DraggableWindow } from './DraggableWindow'

export function WindowManager() {
  const session = useSimulationStore((s) => s.session)
  const openWindows = useSimulationStore((s) => s.openWindows)
  const watchlist = useSimulationStore((s) => s.watchlist)
  const toggleWatchlist = useSimulationStore((s) => s.toggleWatchlist)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)

  const resolveName = useEntityName()
  const state = session?.currentState
  if (!state) return null

  const eventHistory = session.eventHistory

  const onPersonClick = (id: string) => openDetailWindow('person', id)
  const onHouseClick = (id: string) => openDetailWindow('house', id)
  const onPolityClick = (id: string) => openDetailWindow('polity', id)
  const onProvinceClick = (id: string) => openDetailWindow('province', id)
  const onPopGroupClick = (id: string) => openDetailWindow('popGroup', id)
  const onFactionClick = (id: FactionId) => openDetailWindow('faction', id)
  const onDiplomaticPlayClick = (id: string) => openDetailWindow('diplomaticPlay', id)

  return (
    <>
      {openWindows.map((win) => {
        const { entityType, entityId } = win
        if (entityType === 'polity') {
          const polity = Object.values(state.polities).find((p) => p.id === entityId)
          if (!polity) return null
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={`Polity: ${resolveName('polity', polity.nameKey, polity.nameKey)}`}
            >
              <CountryDetail
                polity={polity}
                session={session}
                watchlist={watchlist}
                toggleWatchlist={toggleWatchlist}
                onPersonClick={onPersonClick}
                onHouseClick={onHouseClick}
                onProvinceClick={onProvinceClick}
                onDiplomaticPlayClick={onDiplomaticPlayClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'house') {
          const house = Object.values(state.houses).find((h) => h.id === entityId)
          if (!house) return null
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={`House: ${resolveName('house', house.nameKey, house.nameKey)}`}
            >
              <HouseDetail
                house={house}
                session={session}
                watchlist={watchlist}
                toggleWatchlist={toggleWatchlist}
                onPersonClick={onPersonClick}
                onHouseClick={onHouseClick}
                onPolityClick={onPolityClick}
                onProvinceClick={onProvinceClick}
                onDiplomaticPlayClick={onDiplomaticPlayClick}
                eventHistory={eventHistory}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'person') {
          const person = Object.values(state.persons).find((p) => p.id === entityId)
          if (!person) return null
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={`Person: ${resolveName('person', person.nameKey, person.nameKey)}`}
            >
              <PersonDetail
                person={person}
                session={session}
                watchlist={watchlist}
                toggleWatchlist={toggleWatchlist}
                onHouseClick={onHouseClick}
                onPolityClick={onPolityClick}
                onPersonClick={onPersonClick}
                onFactionClick={onFactionClick}
                onProvinceClick={onProvinceClick}
                eventHistory={eventHistory}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'province') {
          const province = Object.values(state.provinces).find((pv) => pv.id === entityId)
          if (!province) return null
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={`Province: ${resolveName('province', province.nameKey, province.nameKey)}`}
            >
              <ProvinceDetail
                province={province}
                session={session}
                onPolityClick={onPolityClick}
                onHouseClick={onHouseClick}
                onPersonClick={onPersonClick}
                onProvinceClick={onProvinceClick}
                onPopGroupClick={onPopGroupClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'popGroup') {
          const popGroup = Object.values(state.popGroups).find((pg) => pg?.id === entityId)
          if (!popGroup) return null
          return (
            <DraggableWindow key={win.id} win={win} title={`Pop: ${popGroup.class}`}>
              <PopGroupDetail
                popGroup={popGroup}
                session={session}
                onPolityClick={onPolityClick}
                onHouseClick={onHouseClick}
                onPersonClick={onPersonClick}
                onProvinceClick={onProvinceClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'faction') {
          const faction = state.factions[entityId as FactionId]
          if (!faction) return null
          const leader = state.persons[faction.leaderPersonId]
          const factionDisplayName = leader
            ? `${resolveName('person', leader.nameKey, leader.nameKey)}'s faction`
            : faction.id
          return (
            <DraggableWindow key={win.id} win={win} title={`Faction: ${factionDisplayName}`}>
              <FactionDetail
                faction={faction}
                session={session}
                onPersonClick={onPersonClick}
                onHouseClick={onHouseClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'diplomaticPlay') {
          const play = state.diplomaticPlays[entityId as DiplomaticPlayId]
          if (!play) return null
          const kindLabel: Record<string, string> = {
            land_claim: 'Land Claim',
            contract_tax_revision: 'Tax Revision',
            revolt_negotiation: 'Revolt Negotiation',
          }
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={`Play: ${kindLabel[play.kind] ?? play.kind}`}
            >
              <DiplomaticPlayDetail
                play={play}
                session={session}
                onPersonClick={onPersonClick}
                onPolityClick={onPolityClick}
                onProvinceClick={onProvinceClick}
              />
            </DraggableWindow>
          )
        }
        return null
      })}
    </>
  )
}
