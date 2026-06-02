import type { Faction } from '@/sim/types/faction'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import {
  getFactionActiveMemberIds,
  getFactionViabilityScore,
  getFactionOpportunityScore,
} from '@sim/selectors/factionSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import type { PersonId, PolityId, HouseId } from '@/sim/types/ids'
import { PanelHeader, CopyJsonButton } from './shared/widgets'
import { weekToYearMonthWeek } from '@sim/utils/timeUtils'
import { PersonLink, HouseLink } from './shared/links'
import { formatScore } from '@/app/utils/format'

export function FactionDetail({
  faction,
  session,
  onPersonClick,
  onHouseClick,
}: {
  faction: Faction
  session: SimulationSession | null
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
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

  const ROSTER_ROLE_ORDER = ['leader', 'administrator', 'treasurer', 'military', 'advisor']
  const ws: WorldState = worldState
  function getMemberRepresentativeOffice(personId: PersonId): {
    label: string
    extraCount: number
    isUnemployed: boolean
  } {
    const officeIds = ws.officeIndex.byHolderPerson[personId] ?? []
    const offices = officeIds.flatMap((oid) => {
      const o = ws.officeAssignments[oid]
      return o && o.active ? [o] : []
    })
    const bailiffIds = ws.holdingOfficeIndex.byHolderPerson[personId] ?? []
    const bailiffs = bailiffIds.flatMap(
      (aid: import('@sim/types/ids').HoldingOfficeAssignmentId) => {
        const a = ws.holdingOfficeAssignments[aid]
        return a && a.active ? [a] : []
      },
    )
    const polityOfficesLocal = offices
      .filter((o) => o.organization.kind === 'polity')
      .sort((a, b) => ROSTER_ROLE_ORDER.indexOf(a.role) - ROSTER_ROLE_ORDER.indexOf(b.role))
    const houseOfficesLocal = offices
      .filter((o) => o.organization.kind === 'house')
      .sort((a, b) => ROSTER_ROLE_ORDER.indexOf(a.role) - ROSTER_ROLE_ORDER.indexOf(b.role))
    const total = offices.length + bailiffs.length
    if (polityOfficesLocal.length > 0) {
      const o = polityOfficesLocal[0]!
      const roleName = resolveName('role', `${o.organization.kind}_${o.role}`, o.role)
      const orgNameKey = ws.polities[o.organization.id as PolityId]?.nameKey ?? o.organization.id
      const orgName = resolveName('polity', orgNameKey, orgNameKey)
      return {
        label: `${roleName} (${orgName})`,
        extraCount: total - 1,
        isUnemployed: false,
      }
    }
    if (houseOfficesLocal.length > 0) {
      const o = houseOfficesLocal[0]!
      const roleName = resolveName('role', `${o.organization.kind}_${o.role}`, o.role)
      const orgNameKey = ws.houses[o.organization.id as HouseId]?.nameKey ?? o.organization.id
      const orgName = resolveName('house', orgNameKey, orgNameKey)
      return {
        label: `${roleName} (${orgName})`,
        extraCount: total - 1,
        isUnemployed: false,
      }
    }
    if (bailiffs.length > 0) {
      const a = bailiffs[0]!
      const hld = ws.holdings[a.holdingId]
      const provNameKey = hld ? (ws.provinces[hld.provinceId]?.nameKey ?? a.holdingId) : a.holdingId
      const provName = resolveName('province', provNameKey, provNameKey)
      return {
        label: `${t('detail.faction.bailiff_label')} (${provName})`,
        extraCount: total - 1,
        isUnemployed: false,
      }
    }
    return { label: t('detail.faction.unemployed_label'), extraCount: 0, isUnemployed: true }
  }

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
        actions={<CopyJsonButton payload={buildEntitySnapshot('faction', faction, worldState)} />}
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

      {/* v0.17.4 UI: 派閥の "ジョブ被害状況" を一目で見られるよう集計を表示 */}
      {(() => {
        const memberOfficeInfo = memberRows.map((p) => getMemberRepresentativeOffice(p.id))
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
          {memberRows.map((p) => {
            const officeInfo = getMemberRepresentativeOffice(p.id)
            return (
              <div key={p.id} className="flex items-center justify-between rounded bg-gray-700 p-1">
                <div className="flex flex-col">
                  <PersonLink personId={p.id} persons={persons} onClick={onPersonClick} />
                  <span className="text-xs text-gray-400">
                    {!p.houseId ? (
                      <span className="text-gray-500">{t('detail.faction.houseless_member')}</span>
                    ) : (
                      <HouseLink houseId={p.houseId} houses={houses} onClick={onHouseClick} />
                    )}{' '}
                    · {t('detail.faction.age_label', { age: p.age })}
                  </span>
                  <span
                    className={`text-xs ${
                      officeInfo.isUnemployed ? 'text-gray-500' : 'text-amber-300'
                    }`}
                  >
                    {officeInfo.label}
                    {officeInfo.extraCount > 0 && (
                      <span className="text-gray-500"> +{officeInfo.extraCount}</span>
                    )}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {t('detail.faction.prestige_label')} {formatScore(p.legacyPrestige)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
