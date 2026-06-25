import type { House } from '@/sim/types/house'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot, getImportanceColor } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import type { SimEvent } from '@/sim/types/event'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getPolityShortName, getHouseDisplayName } from '@/app/hooks/entityNameHelpers'
import { useRenderEvent } from '@/app/hooks/useRenderEvent'
import { getHouseLeader, getActiveOfficeHolders } from '@sim/selectors/officeSelectors'
import { computeRawConspiracyDrive } from '@/sim/selectors/conspiracySelectors'
import { getHouseCohesion, getHouseLoyaltyToPolity } from '@sim/selectors/statusSelectors'
import {
  getHouseControlledProvinceIds,
  getHouseOwnedPolityIds,
} from '@sim/selectors/landContractSelectors'
import { getProvinceHouseManpowerBase } from '@sim/selectors/popEconomySelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { clamp } from '@/sim/utils/math'
import { normalizedStat } from '@/sim/selectors/personAbilityEffects'
import { hasEntityId } from '@sim/types/event'
import {
  PanelHeader,
  CopyJsonButton,
  WatchButton,
  ShareholderSection,
  HouseRightsSection,
  EntityChronicleSection,
  CollapsibleSection,
  DetailSection,
  DetailSubSection,
} from './shared/widgets'
import { useCollapsedSections } from '@/app/hooks/useCollapsedSections'
import { ProjectCard } from './shared/ProjectCard'
import { getHousePrimaryPolityId } from '@sim/selectors/polityRelations'
import {
  formatPolityRank,
  formatScore,
  formatAmount,
  formatPower,
  formatYearWeek,
  formatAbsoluteWeek,
} from '@/app/utils/format'
import {
  getHouseProjectedAnnualIncome,
  getHouseAnnualOfficeSalary,
  getHouseProjectedAnnualBalance,
} from '@sim/selectors/houseFinanceSelectors'
import { PersonLink } from './shared/links'
import { PersonCard } from './shared/PersonCard'
import type { PersonId, PolityId } from '@/sim/types/ids'
import { getTopShareholders } from '@sim/selectors/shareSelectors'
import { getHouseClanRole } from '@sim/selectors/clanSelectors'
import { getChronicleEntriesForHouse } from '@sim/selectors/chronicleSelectors'
import { getActiveGoalForOwner, getActiveAimsForGoal } from '@sim/selectors/goalSelectors'
import { assetOwnerKey } from '@sim/types/realEstateAsset'
import { getHoldingQualifiedName } from '@/app/hooks/entityNameHelpers'
import { estimateMonthlyOwnerIncome } from '@sim/selectors/resourceRevenueSelectors'
import {
  getActiveSeizureForAsset,
  getSeizurePrescriptionRemainingYears,
} from '@sim/selectors/realEstateSeizureSelectors'
import {
  getActiveDefaultsForClaimantPolity,
  getActiveDefaultsForOccupierPolity,
  getDefaultPrescriptionRemainingYears,
} from '@sim/selectors/landContractDefaultSelectors'
import { MONTHS_PER_YEAR } from '@sim/utils/timeUtils'
import { REAL_ESTATE_DEFINITIONS } from '@sim/config/realEstateDefinitions'

export function HouseDetail({
  house,
  session,
  watchlist,
  toggleWatchlist,
  onPersonClick,
  onHouseClick,
  onPolityClick,
  onProvinceClick,
  onDiplomaticPlayClick,
  onClanClick,
  onOpenFamilyTree,
  onHoldingClick,
  onMerchantCompanyClick,
  eventHistory,
}: {
  house: House
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
  onPolityClick: ClickHandler
  onProvinceClick: (id: string) => void
  onDiplomaticPlayClick?: (id: string) => void
  onClanClick?: (id: string) => void
  onOpenFamilyTree?: (houseId: string) => void
  onHoldingClick?: (id: string) => void
  onMerchantCompanyClick?: (id: string) => void
  eventHistory: SimEvent[]
}) {
  void onHouseClick // v0.42c: ShareholderSection の person-only 化で未使用に (props API は維持)
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const sections = useCollapsedSections()
  const renderEvent = useRenderEvent()
  const isWatching = watchlist.includes(house.id)
  const currentState = session?.currentState
  if (!currentState) return null
  const leaderId = currentState ? getHouseLeader(currentState, house.id) : undefined
  const head = leaderId ? currentState.persons?.[leaderId] : undefined
  const aliveMembers = house.memberIds.filter(
    (pid) => currentState.persons?.[pid]?.alive === true,
  ).length

  const worldState: WorldState | null = currentState ?? null

  const conspiracyDrive = worldState ? computeRawConspiracyDrive(worldState, house.id) : 0

  const cohesion = worldState ? getHouseCohesion(worldState, house.id) : 50
  const loyaltyToPolity = worldState ? getHouseLoyaltyToPolity(worldState, house.id) : 50

  const levyPower = worldState
    ? getHouseControlledProvinceIds(worldState, house.id).reduce(
        (sum: number, pid) => sum + getProvinceHouseManpowerBase(worldState, defaultConfig, pid),
        0,
      ) * defaultConfig.houseManpowerPowerFactor
    : 0

  const availableWarWealth = Math.max(0, house.wealth - defaultConfig.houseMilitaryWealthReserve)
  const rawMercenaryPower = Math.log1p(availableWarWealth) * defaultConfig.houseWealthMilitaryFactor
  const mercenaryPower = Math.min(
    rawMercenaryPower,
    levyPower * defaultConfig.maxMercenaryPowerRatio,
  )

  const bestWarCommand = worldState
    ? Math.max(0, ...house.memberIds.map((pid) => getRoleScore(worldState, pid, 'warCommand') / 10))
    : 0

  const commanderModifier = clamp(
    1 + normalizedStat(bestWarCommand) * defaultConfig.houseCommanderMartialEffect,
    defaultConfig.minCommanderModifier,
    defaultConfig.maxCommanderModifier,
  )

  const totalMilitaryPower = (levyPower + mercenaryPower) * commanderModifier

  const recentEvents = eventHistory
    .filter((e) => hasEntityId(e, house.id) || house.memberIds.some((mid) => hasEntityId(e, mid)))
    .slice(-3)
    .reverse()

  return (
    <div className="flex flex-col gap-1 p-3">
      <PanelHeader
        title={getHouseDisplayName(resolveName, house, house.nameKey)}
        actions={
          <>
            <CopyJsonButton payload={buildEntitySnapshot('house', house, currentState ?? null)} />
            <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(house.id)} />
          </>
        }
      />
      {currentState &&
        (currentState.merchantCompanyIndex.byOwnerHouse[house.id] ?? []).length > 0 && (
          <div className="flex flex-col gap-0.5 text-sm">
            <DetailSection title={t('detail.merchant.companies', { defaultValue: '商会' })} />
            {(currentState.merchantCompanyIndex.byOwnerHouse[house.id] ?? []).map((cid) => {
              const company = currentState.merchantCompanies[cid]
              if (!company) return null
              return (
                <button
                  key={cid}
                  className="text-left text-sky-400 hover:underline"
                  onClick={() => onMerchantCompanyClick?.(cid)}
                >
                  {resolveName('house', company.nameKey, cid)} (
                  {t(`detail.merchant.status_${company.status}`, { defaultValue: company.status })})
                </button>
              )
            })}
          </div>
        )}

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.primary_polity')}:</span>
          {(() => {
            const primaryPolityId = getHousePrimaryPolityId(currentState, house.id)
            if (!primaryPolityId) return <span className="text-gray-500">\u2014</span>
            const p = currentState.polities[primaryPolityId]
            if (!p) return <span className="text-gray-500">\u2014</span>
            return (
              <button
                className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                onClick={() => onPolityClick(primaryPolityId, 'polity')}
              >
                {getPolityShortName(currentState, resolveName, p.id)}
              </button>
            )
          })()}
        </div>
        {(() => {
          const ownedIds = getHouseOwnedPolityIds(currentState, house.id)
          if (ownedIds.length <= 1) {
            return (
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.house.owned_polity')}:</span>
                {ownedIds.length === 0 ? (
                  <span className="text-gray-500">\u2014</span>
                ) : (
                  (() => {
                    const pid = ownedIds[0]!
                    const p = currentState.polities[pid]
                    if (!p) return <span className="text-gray-500">\u2014</span>
                    return (
                      <button
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onPolityClick(pid, 'polity')}
                      >
                        {getPolityShortName(currentState, resolveName, p.id)}
                      </button>
                    )
                  })()
                )}
              </div>
            )
          }
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-gray-400">
                {t('detail.house.owned_polities')} ({ownedIds.length}):
              </span>
              <ul className="flex flex-col gap-0.5 pl-3">
                {ownedIds.map((pid) => {
                  const p = currentState.polities[pid]
                  if (!p) return null
                  return (
                    <li key={pid}>
                      <button
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onPolityClick(pid, 'polity')}
                      >
                        {getPolityShortName(currentState, resolveName, p.id)}
                      </button>
                      <span className="ml-1 text-xs text-gray-500">
                        ({formatPolityRank(p.rank)})
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })()}
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.seat')}:</span>
          <button
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onProvinceClick(house.seatProvinceId)}
          >
            {(() => {
              const p = currentState.provinces?.[house.seatProvinceId]
              return p ? resolveName('province', p.nameKey, p.nameKey) : house.seatProvinceId
            })()}
          </button>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.prestige')}:</span>
          <span>{formatScore(house.legacyPrestige)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.cohesion')}:</span>
          <span>{formatScore(cohesion)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.loyalty')}:</span>
          <span>{formatScore(loyaltyToPolity)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.wealth')}:</span>
          <span>{formatAmount(house.wealth)}</span>
        </div>
        {/* v0.37: 投影年間収支 (定常収入 = PolitySurplus − 役職給与)。役職任命の可否はこの収支に基づく。 */}
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.projected_income')}:</span>
          <span>
            {worldState ? formatAmount(getHouseProjectedAnnualIncome(worldState, house.id)) : '-'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.office_salary')}:</span>
          <span>
            {worldState ? formatAmount(getHouseAnnualOfficeSalary(worldState, house.id)) : '-'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.office_balance')}:</span>
          <span
            className={
              worldState && getHouseProjectedAnnualBalance(worldState, house.id) < 0
                ? 'text-red-400'
                : 'text-gray-200'
            }
          >
            {worldState ? formatAmount(getHouseProjectedAnnualBalance(worldState, house.id)) : '-'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.provinces')}:</span>
          <span>{worldState ? getHouseControlledProvinceIds(worldState, house.id).length : 0}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.conspiracy_drive')}:</span>
          <span className={conspiracyDrive >= 75 ? 'text-yellow-400' : 'text-gray-200'}>
            {conspiracyDrive.toFixed(1)}
          </span>
        </div>
      </div>

      <CollapsibleSection
        title={t('detail.house.military')}
        open={sections.isOpen('military')}
        onToggle={() => sections.toggle('military')}
      >
        <div className="text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.house.levy_power')}:</span>
            <span>{formatPower(levyPower)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.house.mercenary_power')}:</span>
            <span>{formatPower(mercenaryPower)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.house.commander_mod')}:</span>
            <span>{commanderModifier.toFixed(2)}x</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.house.total_military')}:</span>
            <span className="font-medium">{formatPower(totalMilitaryPower)}</span>
          </div>
        </div>
      </CollapsibleSection>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.leader')}:</span>
          {head ? (
            <PersonLink
              personId={leaderId as PersonId}
              persons={currentState.persons ?? {}}
              onClick={onPersonClick}
            />
          ) : (
            <span className="text-gray-500">\u2014</span>
          )}
        </div>
        <DetailSubSection title={t('detail.house.offices')} />
        <div className="text-sm">
          {(['administrator', 'treasurer', 'military', 'advisor'] as const).map((role) => {
            const houseRef = { kind: 'house' as const, id: house.id }
            const holderIds = worldState ? getActiveOfficeHolders(worldState, houseRef, role) : []
            const roleLabel = t(`house.${role}`, { ns: 'roles' })
            return (
              <div key={role} className="flex justify-between">
                <span className="text-gray-400">{roleLabel}:</span>
                <div className="flex flex-col items-end gap-0.5">
                  {holderIds.length === 0 ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    holderIds.map((pid) => (
                      <PersonLink
                        key={pid as string}
                        personId={pid}
                        persons={currentState.persons ?? {}}
                        onClick={onPersonClick}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <DetailSubSection title={t('detail.house.top_shareholders')} />
        {worldState ? (
          <ShareholderSection
            shareholders={getTopShareholders(worldState, house.id, 5)}
            persons={currentState.persons ?? {}}
            onPersonClick={onPersonClick}
          />
        ) : (
          <span className="text-sm text-gray-500">—</span>
        )}
        {/* v0.42: この家 (+ 生存 member 個人) が保持する PoliticalRight 一覧 */}
        {worldState && (
          <HouseRightsSection
            house={house}
            worldState={worldState}
            persons={currentState.persons ?? {}}
            onPersonClick={onPersonClick}
            onPolityClick={onPolityClick}
          />
        )}
        {/* v0.52: 所有不動産一覧 */}
        {worldState &&
          (() => {
            const ownerKey = assetOwnerKey({ kind: 'house', id: house.id })
            const assetIds = worldState.realEstateAssetIndex.byOwner[ownerKey] ?? []
            const assets = assetIds
              .map((id) => worldState.realEstateAssets[id])
              .filter((a): a is NonNullable<typeof a> => a !== undefined)
            if (assets.length === 0) return null
            return (
              <CollapsibleSection
                title={t('detail.house.owned_real_estate')}
                count={assets.length}
                open={sections.isOpen('owned_real_estate')}
                onToggle={() => sections.toggle('owned_real_estate')}
              >
                <div className="flex flex-col gap-1">
                  {assets.map((asset) => {
                    const holdingName = getHoldingQualifiedName(
                      worldState,
                      resolveName,
                      asset.holdingId,
                    )
                    const monthlyIncome = estimateMonthlyOwnerIncome(
                      worldState,
                      defaultConfig,
                      asset,
                    )
                    const annualIncome = monthlyIncome * MONTHS_PER_YEAR
                    const def = REAL_ESTATE_DEFINITIONS[asset.realEstateKind]
                    const maxLevel =
                      def.maxLevelByHoldingKind[
                        worldState.holdings[asset.holdingId]?.kind ?? 'manor'
                      ] ?? 3
                    return (
                      <div key={asset.id} className="rounded bg-gray-700 p-1.5 text-xs">
                        <div className="flex items-baseline justify-between">
                          <span className="font-medium text-gray-200">
                            {t(`detail.realEstate.kind_${asset.realEstateKind}`, {
                              defaultValue: asset.realEstateKind,
                            })}
                          </span>
                          <span className="text-gray-500">
                            Lv.{asset.level}/{maxLevel}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">
                            {t('detail.house.real_estate_location')}:
                          </span>
                          {onHoldingClick ? (
                            <button
                              className="text-blue-400 hover:text-blue-300"
                              onClick={() => onHoldingClick(asset.holdingId)}
                            >
                              {holdingName}
                            </button>
                          ) : (
                            <span className="text-gray-400">{holdingName}</span>
                          )}
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">
                            {t('detail.house.real_estate_annual_income')}:
                          </span>
                          <span className={annualIncome > 0 ? 'text-emerald-400' : 'text-gray-500'}>
                            {annualIncome > 0 ? '+' : ''}
                            {formatAmount(annualIncome)}
                          </span>
                        </div>
                        {(() => {
                          // v0.53: この不動産が押領されていれば明示。
                          const seizure = getActiveSeizureForAsset(worldState, asset.id)
                          if (!seizure) return null
                          const years = Math.floor(
                            getSeizurePrescriptionRemainingYears(
                              worldState,
                              defaultConfig,
                              seizure,
                            ),
                          )
                          return (
                            <div className="mt-0.5 rounded border border-amber-700/50 bg-amber-950/30 px-1 py-0.5 text-[11px] text-amber-300">
                              ⚠ {t('detail.obligation.seized', { defaultValue: '押領中' })} (
                              {t('detail.obligation.seized_by', { defaultValue: '押領者' })}:{' '}
                              {getPolityShortName(worldState, resolveName, seizure.seizerPolityId)},{' '}
                              {t('detail.obligation.prescription_remaining', {
                                defaultValue: '時効まで残り {{years}} 年',
                                years,
                              })}
                              )
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              </CollapsibleSection>
            )
          })()}
        {/* v0.53: この家が支配する Polity が関与する上納拒否 (claimant=被害 / occupier=加害) */}
        {worldState &&
          (() => {
            const ownedPolityIds = getHouseOwnedPolityIds(worldState, house.id)
            const asClaimant = ownedPolityIds.flatMap((pid) =>
              getActiveDefaultsForClaimantPolity(worldState, pid),
            )
            const asOccupier = ownedPolityIds.flatMap((pid) =>
              getActiveDefaultsForOccupierPolity(worldState, pid),
            )
            if (asClaimant.length === 0 && asOccupier.length === 0) return null
            const renderRow = (d: (typeof asClaimant)[number], counterpartyId: PolityId) => {
              const years = Math.floor(
                getDefaultPrescriptionRemainingYears(worldState, defaultConfig, d),
              )
              const holdingName = getHoldingQualifiedName(worldState, resolveName, d.holdingId)
              return (
                <div key={d.id} className="flex justify-between text-[11px] text-gray-300">
                  <span className="truncate">{holdingName}</span>
                  <span className="shrink-0 text-gray-400">
                    {getPolityShortName(worldState, resolveName, counterpartyId)} ·{' '}
                    {t('detail.obligation.prescription_remaining', {
                      defaultValue: '時効まで残り {{years}} 年',
                      years,
                    })}
                  </span>
                </div>
              )
            }
            return (
              <div className="mt-1 rounded border border-red-900/40 bg-red-950/20 px-1.5 py-1 text-sm">
                {asClaimant.length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-red-300">
                      ⚠{' '}
                      {t('detail.obligation.defaults_as_claimant', {
                        defaultValue: '上納を拒否されている契約',
                      })}{' '}
                      ({asClaimant.length})
                    </div>
                    {asClaimant.map((d) => renderRow(d, d.occupiedByPolityId))}
                  </>
                )}
                {asOccupier.length > 0 && (
                  <>
                    <div className="mt-0.5 text-xs font-semibold text-amber-300">
                      {t('detail.obligation.defaults_as_occupier', {
                        defaultValue: '上納を拒否中の契約',
                      })}{' '}
                      ({asOccupier.length})
                    </div>
                    {asOccupier.map((d) => renderRow(d, d.claimantPolityId))}
                  </>
                )}
              </div>
            )
          })()}
        <CollapsibleSection
          title={t('detail.house.members')}
          count={aliveMembers}
          open={sections.isOpen('members')}
          onToggle={() => sections.toggle('members')}
        >
          {onOpenFamilyTree && (
            <div className="mb-1 flex justify-end">
              <button
                className="rounded border border-gray-600 px-2 py-0.5 text-xs text-blue-400 hover:bg-gray-700 hover:text-blue-300"
                onClick={() => onOpenFamilyTree(house.id)}
              >
                {t('detail.family_tree.open')}
              </button>
            </div>
          )}
          <div className="flex flex-col gap-0.5 text-sm">
            {house.memberIds
              .filter((pid) => currentState?.persons?.[pid]?.alive === true)
              .slice(0, 8)
              .map((pid) => (
                <PersonCard
                  key={pid}
                  personId={pid}
                  worldState={currentState}
                  onPersonClick={onPersonClick}
                />
              ))}
            {aliveMembers > 8 && (
              <span className="text-xs text-gray-500">+{aliveMembers - 8} more</span>
            )}
          </div>
        </CollapsibleSection>
      </div>

      {house.founderId !== undefined && (
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.founder')}:</span>
          <span>
            {(() => {
              const p = currentState?.persons?.[house.founderId]
              return p ? resolveName('person', p.nameKey, p.nameKey) : house.founderId
            })()}
          </span>
        </div>
      )}
      {house.parentHouseId !== undefined && (
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.parent_house')}:</span>
          <span>
            {(() => {
              const h = currentState?.houses?.[house.parentHouseId]
              return getHouseDisplayName(resolveName, h, house.parentHouseId)
            })()}
          </span>
        </div>
      )}
      {house.cadetHouseIds.length > 0 && (
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.cadet_houses')}:</span>
          <span>{house.cadetHouseIds.length}</span>
        </div>
      )}
      {house.clanId !== undefined &&
        (() => {
          const clan = currentState.clans[house.clanId]
          if (!clan) return null
          const clanNameHouse = currentState.houses[clan.nameSourceHouseId]
          const clanName = getHouseDisplayName(resolveName, clanNameHouse, clan.id)
          const role = getHouseClanRole(currentState, house.id)
          return (
            <>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.clan.name')}:</span>
                <span>
                  {onClanClick ? (
                    <button
                      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                      onClick={() => onClanClick(clan.id)}
                    >
                      {clanName}
                    </button>
                  ) : (
                    clanName
                  )}
                  {role && (
                    <span className="ml-1 text-xs text-gray-500">
                      ({t(`detail.clan.role_${role}`)})
                    </span>
                  )}
                </span>
              </div>
            </>
          )
        })()}

      {recentEvents.length > 0 && (
        <CollapsibleSection
          title={t('detail.house.recent_events')}
          open={sections.isOpen('recent_events')}
          onToggle={() => sections.toggle('recent_events')}
        >
          {recentEvents.map((e) => (
            <div key={e.id} className={`text-xs ${getImportanceColor(e.importance)}`}>
              [{formatYearWeek(e.year, e.weekOfYear)}] {renderEvent(e)}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* v0.22 Goal/Aim — 現在の活動 (chronicle の前。spine: identity→domain→current activity→年代記) */}
      {currentState &&
        (() => {
          const owner = { kind: 'house' as const, id: house.id }
          const goal = getActiveGoalForOwner(currentState, owner)
          if (!goal) return null
          const activeAims = getActiveAimsForGoal(currentState, goal.id)
          return (
            <>
              <DetailSection title={t('detail.house.current_goal')} />
              <div className="ml-2 text-sm">
                <div>{t(`goals:house.${goal.kind}`)}</div>
                {goal.reasonIds.length > 0 && currentState && (
                  <ul style={{ margin: '2px 0', paddingLeft: 20 }}>
                    {goal.reasonIds.map((rid) => {
                      const reason = currentState.decisionReasons[rid]
                      if (!reason) return null
                      return (
                        <li key={rid} style={{ fontSize: '0.9em', opacity: 0.85 }}>
                          {t(reason.summaryKey, { ns: 'decision_reasons' })}
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div>
                  {t('detail.house.goal_progress')}: {goal.progress} / {goal.targetProgress}
                </div>
              </div>
              {activeAims.map((activeAim) => (
                <div key={activeAim.id}>
                  <DetailSubSection title={t('detail.house.active_aim')} />
                  <div className="ml-2 text-sm">
                    <div>{t(`aims:house.${activeAim.kind}`)}</div>
                    <div>
                      {t('detail.house.aim_progress')}: {activeAim.progress} /{' '}
                      {activeAim.targetProgress}
                    </div>
                    <div>
                      {t('detail.house.aim_deadline')}: {formatAbsoluteWeek(activeAim.deadlineWeek)}
                    </div>
                  </div>
                  {(() => {
                    const aimKey = `aim:${activeAim.id}`
                    const projectIds = currentState.projectIndex.byAim[aimKey] ?? []
                    const activeProjects = projectIds
                      .map((pid) => currentState.projects[pid])
                      .filter(
                        (p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active',
                      )
                    if (activeProjects.length === 0) return null
                    return activeProjects.map((project) => (
                      <div key={project.id} className="mt-1 ml-2">
                        <ProjectCard project={project} worldState={currentState} />
                      </div>
                    ))
                  })()}
                  {activeAim.activeDiplomaticPlayId &&
                    (() => {
                      const play = currentState.diplomaticPlays[activeAim.activeDiplomaticPlayId]
                      if (!play || (play.status !== 'active' && play.status !== 'escalated'))
                        return null
                      return (
                        <>
                          <DetailSubSection title={t('detail.house.active_play')} />
                          <div className="ml-2 text-sm">
                            {onDiplomaticPlayClick ? (
                              <button
                                className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                                onClick={() => onDiplomaticPlayClick(play.id)}
                              >
                                {t(`play_kind.${play.kind}`, { ns: 'diplomacy' })}
                              </button>
                            ) : (
                              <div>{t(`play_kind.${play.kind}`, { ns: 'diplomacy' })}</div>
                            )}
                            <div>
                              {t('sidebar.play_progress')}: {Math.round(play.progress)} |{' '}
                              {t('sidebar.play_tension')}: {Math.round(play.tension)}
                            </div>
                          </div>
                        </>
                      )
                    })()}
                </div>
              ))}
            </>
          )
        })()}

      {/* Projects Section */}
      {currentState &&
        (() => {
          const ownerKey = `house:${house.id}`
          const projectIds = currentState.projectIndex.byOwner[ownerKey] ?? []
          const activeProjects = projectIds
            .map((pid) => currentState.projects[pid])
            .filter((p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active')
          if (activeProjects.length === 0) return null
          return (
            <>
              <DetailSection
                title={t('detail.house.projects_section')}
                count={activeProjects.length}
              />
              <div className="mt-1 flex flex-col gap-1">
                {activeProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} worldState={currentState} />
                ))}
              </div>
            </>
          )
        })()}

      {/* v0.38 §8: 家の記録 (永続 Chronicle) — spine 末尾 */}
      <EntityChronicleSection
        title={t('detail.house.chronicle')}
        entries={getChronicleEntriesForHouse(currentState, house.id)}
        entityType="house"
        entityId={house.id}
      />
    </div>
  )
}
