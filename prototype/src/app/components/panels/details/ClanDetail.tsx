import type { Clan } from '@/sim/types/clan'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getHouseDisplayName } from '@/app/hooks/entityNameHelpers'
import {
  getClanActiveHouseIds,
  getClanExtinctHouseIds,
  getClanLivingMemberCount,
  getClanTotalWealth,
  getClanTotalLegacyPrestige,
  getClanRulingHouseIds,
} from '@sim/selectors/clanSelectors'
import { PanelHeader, CopyJsonButton } from './shared/widgets'
import { weekToYearMonthWeek } from '@sim/utils/timeUtils'
import { HouseLink, PersonLink } from './shared/links'
import { formatAmount, formatScore, formatYearMonthWeek } from '@/app/utils/format'

export function ClanDetail({
  clan,
  session,
  onPersonClick,
  onHouseClick,
}: {
  clan: Clan
  session: SimulationSession | null
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const currentState = session?.currentState
  const worldState: WorldState | null = currentState ?? null
  if (!worldState) return null

  const houses = worldState.houses
  const persons = worldState.persons
  const nameHouse = houses[clan.nameSourceHouseId]
  const clanDisplayName = getHouseDisplayName(resolveName, nameHouse, clan.id)
  const rootHouse = houses[clan.rootHouseId]
  const founder = clan.founderPersonId ? persons[clan.founderPersonId] : undefined
  const ageYears = Math.floor((worldState.absoluteWeek - clan.createdWeek) / 48)

  const activeHouseIds = getClanActiveHouseIds(worldState, clan.id)
  const extinctHouseIds = getClanExtinctHouseIds(worldState, clan.id)
  const livingMemberCount = getClanLivingMemberCount(worldState, clan.id)
  const totalWealth = getClanTotalWealth(worldState, clan.id)
  const totalPrestige = getClanTotalLegacyPrestige(worldState, clan.id)
  const rulingHouseIds = getClanRulingHouseIds(worldState, clan.id)

  const MAX_HOUSES_SHOWN = 10

  return (
    <div className="flex flex-col gap-1 p-3">
      <PanelHeader
        title={clanDisplayName}
        badge={
          !clan.active && (
            <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-400">
              {t('detail.clan.status_extinct')}
            </span>
          )
        }
        actions={<CopyJsonButton payload={buildEntitySnapshot('clan', clan, worldState)} />}
      />

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">ID:</span>
          <span className="text-xs text-gray-500">{clan.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.clan.founded')}:</span>
          <span>
            {(() => {
              const f = weekToYearMonthWeek(clan.createdWeek)
              return formatYearMonthWeek(f.year, f.month, f.weekOfMonth)
            })()}{' '}
            <span className="text-xs text-gray-500">
              {t('detail.clan.years_ago', { years: ageYears })}
            </span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.clan.root_house')}:</span>
          {rootHouse ? (
            <HouseLink houseId={rootHouse.id} houses={houses} onClick={onHouseClick} />
          ) : (
            <span className="text-gray-500">—</span>
          )}
        </div>
        {founder && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.clan.founder')}:</span>
            <PersonLink personId={founder.id} persons={persons} onClick={onPersonClick} />
          </div>
        )}
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.clan.total_houses')}:</span>
          <span>{clan.memberHouseIds.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.clan.active_houses')}:</span>
          <span>{activeHouseIds.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.clan.extinct_houses')}:</span>
          <span>{extinctHouseIds.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.clan.living_members')}:</span>
          <span>{livingMemberCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.clan.total_wealth')}:</span>
          <span>{formatAmount(totalWealth)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.clan.total_prestige')}:</span>
          <span>{formatScore(totalPrestige)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.clan.ruling_houses')}:</span>
          <span>{rulingHouseIds.length}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">{t('detail.clan.member_houses')}</div>
      <div className="flex flex-col gap-0.5 text-sm">
        {activeHouseIds.slice(0, MAX_HOUSES_SHOWN).map((hid) => {
          const h = houses[hid]
          if (!h) return null
          const isRoot = hid === clan.rootHouseId
          return (
            <div key={hid} className="flex items-center justify-between">
              <HouseLink houseId={hid} houses={houses} onClick={onHouseClick} />
              {isRoot && (
                <span className="text-xs text-amber-300">{t('detail.clan.role_root')}</span>
              )}
            </div>
          )
        })}
        {activeHouseIds.length > MAX_HOUSES_SHOWN && (
          <span className="text-xs text-gray-500">
            +{activeHouseIds.length - MAX_HOUSES_SHOWN} more
          </span>
        )}
        {extinctHouseIds.length > 0 && (
          <div className="mt-1 text-xs text-gray-500">
            {t('detail.clan.extinct_houses')} ({extinctHouseIds.length}):
          </div>
        )}
        {extinctHouseIds.slice(0, 5).map((hid) => {
          const h = houses[hid]
          if (!h) return null
          return (
            <div key={hid} className="flex items-center justify-between text-gray-500">
              <span>{getHouseDisplayName(resolveName, h, h.nameKey)}</span>
            </div>
          )
        })}
        {extinctHouseIds.length > 5 && (
          <span className="text-xs text-gray-500">+{extinctHouseIds.length - 5} more</span>
        )}
      </div>
    </div>
  )
}
