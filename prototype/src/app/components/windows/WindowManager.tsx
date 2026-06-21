import { useTranslation } from 'react-i18next'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { useEntityName } from '@/app/hooks/useEntityName'
import {
  getPolityShortName,
  getHoldingQualifiedName,
  getHouseDisplayName,
} from '@/app/hooks/entityNameHelpers'
import type {
  FactionId,
  DiplomaticPlayId,
  HoldingId,
  ClanId,
  WarId,
  ProjectId,
  BattleLogId,
  RealEstateAssetId,
} from '@/sim/types/ids'
import {
  CountryDetail,
  HouseDetail,
  PersonDetail,
  PopGroupDetail,
  ProvinceDetail,
  FactionDetail,
  DiplomaticPlayDetail,
  HoldingDetail,
  ClanDetail,
  WarDetail,
  ProjectDetail,
  BattleReplayPanel,
  MarketDetail,
  RealEstateDetail,
} from '@/app/components/panels/DetailPanel'
import { FullChroniclePanel } from '@/app/components/panels/details/FullChroniclePanel'
import type { PolityId, HouseId, PersonId, ProvinceId, StateRegionId } from '@/sim/types/ids'
import { DraggableWindow } from './DraggableWindow'

export function WindowManager() {
  const session = useSimulationStore((s) => s.session)
  const openWindows = useSimulationStore((s) => s.openWindows)
  const watchlist = useSimulationStore((s) => s.watchlist)
  const toggleWatchlist = useSimulationStore((s) => s.toggleWatchlist)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)
  const openFamilyTree = useSimulationStore((s) => s.openFamilyTree)
  const openFactionTree = useSimulationStore((s) => s.openFactionTree)

  const resolveName = useEntityName()
  const { t } = useTranslation()
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
  const onHoldingClick = (id: string) => openDetailWindow('holding', id)
  const onRealEstateClick = (id: string) => openDetailWindow('realEstate', id)
  const onClanClick = (id: string) => openDetailWindow('clan', id)
  const onBattleLogClick = (id: string) => openDetailWindow('battleLog', id)
  const onOpenFamilyTree = (id: string) => openFamilyTree(id as HouseId)
  const onOpenFactionTree = (id: FactionId) => openFactionTree(id)

  return (
    <>
      {openWindows.map((win) => {
        const { entityType, entityId } = win
        // 全履歴 (年代記) パネルは entity 種別を問わず単一コンポーネントで描画する。
        //   履歴は永続なので live entity の消滅で blank にせず、title だけ defensive に解決する。
        if (win.view === 'chronicle') {
          const prefix = t('detail.full_chronicle.title_prefix')
          let title: string
          if (entityType === 'war') {
            title = t('detail.full_chronicle.war_title')
          } else {
            let name = entityId
            if (entityType === 'polity') {
              const p = state.polities[entityId as PolityId]
              if (p) name = getPolityShortName(state, resolveName, entityId as PolityId)
            } else if (entityType === 'house') {
              const h = state.houses[entityId as HouseId]
              if (h) name = getHouseDisplayName(resolveName, h, h.nameKey)
            } else if (entityType === 'person') {
              const p = state.persons[entityId as PersonId]
              if (p) name = resolveName('person', p.nameKey, p.nameKey)
            } else if (entityType === 'province') {
              const pv = state.provinces[entityId as ProvinceId]
              if (pv) name = resolveName('province', pv.nameKey, pv.nameKey)
            } else if (entityType === 'holding') {
              const hd = state.holdings[entityId as HoldingId]
              if (hd) {
                name = getHoldingQualifiedName(state, resolveName, entityId as HoldingId)
              }
            }
            title = `${prefix}: ${name}`
          }
          return (
            <DraggableWindow key={win.id} win={win} title={title} variant="vellum">
              <FullChroniclePanel entityType={entityType} entityId={entityId} state={state} />
            </DraggableWindow>
          )
        }
        if (entityType === 'polity') {
          const polity = Object.values(state.polities).find((p) => p.id === entityId)
          if (!polity) return null
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={`Polity: ${getPolityShortName(state, resolveName, polity.id)}`}
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
              title={`House: ${getHouseDisplayName(resolveName, house, house.nameKey)}`}
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
                onClanClick={onClanClick}
                onOpenFamilyTree={onOpenFamilyTree}
                onHoldingClick={onHoldingClick}
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
                onHoldingClick={onHoldingClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'popGroup') {
          const popGroup = Object.values(state.popGroups).find((pg) => pg?.id === entityId)
          if (!popGroup) return null
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={`Pop: ${popGroup.class} (${popGroup.employed ? 'employed' : 'unemployed'})`}
            >
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
                onFactionClick={onFactionClick}
                onOpenFactionTree={onOpenFactionTree}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'diplomaticPlay') {
          const play = state.diplomaticPlays[entityId as DiplomaticPlayId]
          if (!play) return null
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={`Play: ${t(`play_kind.${play.kind}`, { ns: 'diplomacy', defaultValue: play.kind })}`}
            >
              <DiplomaticPlayDetail
                play={play}
                session={session}
                onPersonClick={onPersonClick}
                onPolityClick={onPolityClick}
                onProvinceClick={onProvinceClick}
                onHoldingClick={onHoldingClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'holding') {
          const holding = state.holdings[entityId as HoldingId]
          if (!holding) return null
          const holdingTitle = getHoldingQualifiedName(state, resolveName, entityId as HoldingId)
          return (
            <DraggableWindow key={win.id} win={win} title={`Holding: ${holdingTitle}`}>
              <HoldingDetail
                holding={holding}
                session={session}
                onPolityClick={onPolityClick}
                onPersonClick={onPersonClick}
                onHouseClick={onHouseClick}
                onProvinceClick={onProvinceClick}
                onPopGroupClick={onPopGroupClick}
                onRealEstateClick={onRealEstateClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'realEstate') {
          const asset = state.realEstateAssets[entityId as RealEstateAssetId]
          if (!asset) return null
          const reKindName = t(`detail.realEstate.kind_${asset.realEstateKind}`, {
            defaultValue: asset.realEstateKind,
          })
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={t('detail.realEstate.detail_window_title', {
                name: `${reKindName} Lv.${asset.level}`,
              })}
            >
              <RealEstateDetail
                asset={asset}
                session={session}
                onHouseClick={onHouseClick}
                onPersonClick={onPersonClick}
                onPolityClick={onPolityClick}
                onHoldingClick={onHoldingClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'clan') {
          const clan = state.clans[entityId as ClanId]
          if (!clan) return null
          const nameHouse = state.houses[clan.nameSourceHouseId]
          const clanDisplayName = getHouseDisplayName(resolveName, nameHouse, entityId)
          return (
            <DraggableWindow key={win.id} win={win} title={`Clan: ${clanDisplayName}`}>
              <ClanDetail
                clan={clan}
                session={session}
                onPersonClick={onPersonClick}
                onHouseClick={onHouseClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'war') {
          const war = state.wars[entityId as WarId]
          if (!war) return null
          return (
            <DraggableWindow key={win.id} win={win} title={`War`}>
              <WarDetail
                war={war}
                session={session}
                onPersonClick={onPersonClick}
                onPolityClick={onPolityClick}
                onHouseClick={onHouseClick}
                onHoldingClick={onHoldingClick}
                onBattleLogClick={onBattleLogClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'battleLog') {
          const log = state.battleLogs[entityId as BattleLogId]
          if (!log) return null
          const place = state.provinces[log.provinceId]
            ? resolveName(
                'province',
                state.provinces[log.provinceId]?.nameKey ?? log.provinceId,
                log.provinceId,
              )
            : (log.provinceId as string)
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={t('detail.battle.window_title', {
                place,
                kind: t(`enum.battlefieldKind.${log.battlefieldKind}`, { ns: 'events' }),
              })}
            >
              <BattleReplayPanel
                log={log}
                session={session}
                onPersonClick={onPersonClick}
                onPolityClick={onPolityClick}
                onHouseClick={onHouseClick}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'project') {
          const project = state.projects[entityId as ProjectId]
          if (!project) return null
          const projectTitle = t(`detail.project_kind.${project.kind}`)
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={t('detail.project.window_title', { name: projectTitle })}
            >
              <ProjectDetail
                project={project}
                session={session}
                watchlist={watchlist}
                toggleWatchlist={toggleWatchlist}
              />
            </DraggableWindow>
          )
        }
        if (entityType === 'market') {
          const stateRegion = state.states[entityId as StateRegionId]
          if (!stateRegion) return null
          const regionName = resolveName('state_region', stateRegion.nameKey, stateRegion.nameKey)
          return (
            <DraggableWindow
              key={win.id}
              win={win}
              title={t('detail.market.window_title', { name: regionName })}
            >
              <MarketDetail stateRegion={stateRegion} session={session} />
            </DraggableWindow>
          )
        }
        return null
      })}
    </>
  )
}
