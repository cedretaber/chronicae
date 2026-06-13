import type { Faction } from '@/sim/types/faction'
import type { FactionId } from '@/sim/types/ids'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot, getPersonRepresentativeOffice } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getPolityShortName } from '@/app/hooks/entityNameHelpers'
import {
  getFactionActiveMemberIds,
  getFactionViabilityScore,
  getFactionOpportunityScore,
} from '@sim/selectors/factionSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { PanelHeader, CopyJsonButton } from './shared/widgets'
import { weekToYearMonthWeek } from '@sim/utils/timeUtils'
import { PersonLink, HouseLink } from './shared/links'
import { PersonCard } from './shared/PersonCard'
import { formatScore } from '@/app/utils/format'

export function FactionDetail({
  faction,
  session,
  onPersonClick,
  onHouseClick,
  onFactionClick,
  onOpenFactionTree,
}: {
  faction: Faction
  session: SimulationSession | null
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
  onFactionClick: (id: FactionId) => void
  onOpenFactionTree?: (id: FactionId) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const currentState = session?.currentState
  const worldState: WorldState | null = currentState ?? null
  if (!worldState) return null

  const persons = worldState.persons
  const houses = worldState.houses
  const leader = persons[faction.leaderPersonId]
  const memberIds = getFactionActiveMemberIds(worldState, faction.id)
  const viability = getFactionViabilityScore(worldState, defaultConfig, faction.id)
  const leaderOpportunity = getFactionOpportunityScore(
    worldState,
    defaultConfig,
    faction.leaderPersonId,
  )
  const ageYears = Math.floor((worldState.absoluteWeek - faction.foundingWeek) / 48)

  const memberRows = memberIds
    .filter((pid) => pid !== faction.leaderPersonId)
    .map((pid) => {
      const p = persons[pid]
      return p
    })
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .sort((a, b) => b.legacyPrestige - a.legacyPrestige)

  return (
    <div className="flex flex-col gap-1 p-3">
      <PanelHeader
        title={leader ? `${leader.nameKey}'s faction` : faction.id}
        badge={
          !faction.active && (
            <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-400">
              {t('detail.faction.dissolved')}
            </span>
          )
        }
        actions={
          <div className="flex items-center gap-1.5">
            {onOpenFactionTree && (
              <button
                className="rounded border border-gray-600 px-2 py-0.5 text-xs text-blue-400 hover:bg-gray-700 hover:text-blue-300"
                onClick={() => onOpenFactionTree(faction.id)}
              >
                {t('detail.faction_tree.open')}
              </button>
            )}
            <CopyJsonButton payload={buildEntitySnapshot('faction', faction, worldState)} />
          </div>
        }
      />

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">ID:</span>
          <span className="text-xs text-gray-500">{faction.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.founded')}:</span>
          <span>
            {(() => {
              const f = weekToYearMonthWeek(faction.foundingWeek)
              return `${f.year}/${f.month}/${f.weekOfMonth}`
            })()}{' '}
            <span className="text-xs text-gray-500">
              {t('detail.faction.years_ago', { years: ageYears })}
            </span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.leader')}:</span>
          {leader ? (
            <PersonLink personId={leader.id} persons={persons} onClick={onPersonClick} />
          ) : (
            <span className="text-gray-500">—</span>
          )}
        </div>
        {leader && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.faction.leader_house')}:</span>
            <HouseLink houseId={leader.houseId} houses={houses} onClick={onHouseClick} />
          </div>
        )}
        {/* v0.42 §16.3: anchor Polity 表示 */}
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.anchor_polity')}:</span>
          <span>{getPolityShortName(worldState, resolveName, faction.polityId)}</span>
        </div>
        {/* 入れ子派閥: 親派閥へのリンク */}
        {faction.parentFactionId &&
          (() => {
            const parent = worldState.factions[faction.parentFactionId]
            if (!parent) return null
            const parentLeader = persons[parent.leaderPersonId]
            const parentName = parentLeader ? `${parentLeader.nameKey}'s faction` : parent.id
            const parentId = parent.id
            return (
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.faction.parent_faction')}:</span>
                <button
                  className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                  onClick={() => onFactionClick(parentId)}
                >
                  ◈ {parentName}
                </button>
              </div>
            )
          })()}
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.members')}:</span>
          <span>{memberIds.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.viability')}:</span>
          <span>{formatScore(viability)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.opportunity')}:</span>
          <span>{formatScore(leaderOpportunity)}</span>
        </div>
      </div>

      {/* 指導者カード (Roster の構成員数には含めず、別ブロックで簡易情報を表示) */}
      {leader && (
        <>
          <span className="text-sm font-semibold text-gray-300">{t('detail.faction.leader')}</span>
          <div className="flex flex-col gap-0.5 text-sm">
            <PersonCard
              personId={leader.id}
              worldState={worldState}
              onPersonClick={onPersonClick}
              onHouseClick={onHouseClick}
              showHouse
            />
          </div>
        </>
      )}

      {/* 入れ子派閥: 傘下(子派閥)の一覧。子派閥のリーダーは「親の構成員」ではなく
          子派閥側の所属なので Roster には出ない。傘下として別ブロックで明示する。 */}
      {(() => {
        const childIds = worldState.factionIndex.byParent[faction.id] ?? []
        const children = childIds
          .map((cid) => worldState.factions[cid])
          .filter((c): c is NonNullable<typeof c> => Boolean(c) && c!.active)
        if (children.length === 0) return null
        return (
          <>
            <span className="text-sm font-semibold text-gray-300">
              {t('detail.faction.child_factions', { count: children.length })}
            </span>
            <div className="flex flex-col gap-1 text-sm">
              {children.map((c) => {
                const childLeader = persons[c.leaderPersonId]
                const childName = childLeader ? `${childLeader.nameKey}'s faction` : c.id
                return (
                  <div key={c.id} className="flex flex-col gap-0.5">
                    <button
                      className="self-start text-blue-400 underline underline-offset-2 hover:text-blue-300"
                      onClick={() => onFactionClick(c.id)}
                    >
                      ◈ {childName}
                    </button>
                    {childLeader && (
                      <PersonCard
                        personId={childLeader.id}
                        worldState={worldState}
                        onPersonClick={onPersonClick}
                        onHouseClick={onHouseClick}
                        relationLabel={t('detail.faction.leader')}
                        showHouse
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )
      })()}

      {/* v0.17.4 UI: 派閥の "ジョブ被害状況" を一目で見られるよう集計を表示 */}
      {(() => {
        const memberOfficeInfo = memberRows.map((p) =>
          getPersonRepresentativeOffice(worldState, p.id, resolveName, t),
        )
        const employedCount = memberOfficeInfo.filter((info) => !info.isUnemployed).length
        const totalRoster = memberRows.length
        return (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-300">
              {t('detail.faction.roster')}
            </span>
            {totalRoster > 0 && (
              <span className="text-xs text-gray-400">
                {t('detail.faction.employed_count', {
                  employed: employedCount,
                  total: totalRoster,
                })}
              </span>
            )}
          </div>
        )
      })()}
      {memberRows.length === 0 ? (
        <div className="text-xs text-gray-500">{t('detail.faction.leader_only')}</div>
      ) : (
        <div className="flex flex-col gap-0.5 text-sm">
          {memberRows.map((p) => (
            <PersonCard
              key={p.id}
              personId={p.id}
              worldState={worldState}
              onPersonClick={onPersonClick}
              onHouseClick={onHouseClick}
              showHouse
            />
          ))}
        </div>
      )}
    </div>
  )
}
