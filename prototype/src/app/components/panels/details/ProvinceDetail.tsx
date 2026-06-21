import type { Province } from '@/sim/types/province'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import {
  buildEntitySnapshot,
  getDevelopmentLabel,
  resolveHoldingImprovements,
} from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getPolityShortName, getHoldingShortName } from '@/app/hooks/entityNameHelpers'
import {
  getProvinceDevelopmentFromHoldings,
  getProvincePolityControlFromHoldings,
} from '@/sim/selectors/landContractSelectors'
import { getProvinceDevelopmentMultiplier } from '@/sim/selectors/developmentSelectors'
import {
  getProvincePops,
  getProvinceCarryingCapacity,
  getProvincePopulation,
  getProvincePopulationPressure,
  getProvinceAveragePopWealth,
  getProvinceUnrest,
  getPopWealthByClass,
  getHoldingEmployedPopSize,
  getHoldingUnemployedPopSize,
  getHoldingClassCapacity,
} from '@sim/selectors/popSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import {
  getProvinceManpowerBase,
  getProvinceCountryManpowerBase,
  getProvinceHouseManpowerBase,
} from '@sim/selectors/popEconomySelectors'
import { getProvinceMonthlyResourceRevenue } from '@sim/selectors/resourceRevenueSelectors'
import {
  getProvinceTerminalPolityId,
  getProvinceEffectiveOwnerHouseId,
  getProvinceHoldings,
  getHoldingLandContractChain,
} from '@sim/selectors/landContractSelectors'
import { getPolityStability } from '@sim/selectors/statusSelectors'
import { getAttitudeOrDefault, attitudeValueToScore } from '@sim/helpers/attitudeHelpers'
import {
  PanelHeader,
  CopyJsonButton,
  EntityChronicleSection,
  DetailSection,
} from './shared/widgets'
import { getProvinceImage, getHoldingImage } from '@/app/utils/assetHash'
import { PolityLink, HouseLink, PersonLink } from './shared/links'
import { formatScore, formatPower } from '@/app/utils/format'
import { getHoldingBailiffPerson } from '@sim/selectors/provinceOfficeSelectors'
import { getHoldingDevelopment } from '@sim/selectors/holdingImprovementSelectors'
import { getChronicleEntriesForProvince } from '@sim/selectors/chronicleSelectors'

export function ProvinceDetail({
  province,
  session,
  onPolityClick,
  onHouseClick,
  onPersonClick,
  onProvinceClick,
  onPopGroupClick,
  onHoldingClick,
}: {
  province: Province
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: ClickHandler
  onProvinceClick: (id: string) => void
  onPopGroupClick: (id: string) => void
  onHoldingClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const currentState = session?.currentState
  const holdingDev = currentState
    ? getProvinceDevelopmentFromHoldings(currentState, province.id)
    : 0
  const holdingCtrl = currentState
    ? getProvincePolityControlFromHoldings(currentState, province.id)
    : 0
  const developmentMultiplier = getProvinceDevelopmentMultiplier(holdingDev)

  const pops = currentState ? getProvincePops(currentState, province.id) : []
  const carryingCapacity = currentState
    ? getProvinceCarryingCapacity(currentState, defaultConfig, province.id)
    : 0
  const totalPopulation = currentState ? getProvincePopulation(currentState, province.id) : 0
  const populationPressure = currentState
    ? getProvincePopulationPressure(currentState, defaultConfig, province.id)
    : 0
  const avgWealth = currentState ? getProvinceAveragePopWealth(currentState, province.id) : 0
  const derivedUnrest = currentState ? getProvinceUnrest(currentState, province.id) : 0
  const derivedProduction = currentState
    ? getProvinceMonthlyResourceRevenue(currentState, defaultConfig, province.id)
    : 0
  const derivedManpower = currentState
    ? getProvinceManpowerBase(currentState, defaultConfig, province.id)
    : 0

  const countryManpower = currentState
    ? getProvinceCountryManpowerBase(currentState, defaultConfig, province.id)
    : 0
  const houseManpower = currentState
    ? getProvinceHouseManpowerBase(currentState, defaultConfig, province.id)
    : 0

  // Calculate revolt tendency per class
  const calcRevoltTendencyForClass = (
    ws: WorldState,
    popClass: 'peasants' | 'townsmen' | 'nobles',
  ): number => {
    const polityId = getProvinceTerminalPolityId(ws, province.id)
    if (!polityId) return 0
    const polity = ws.polities[polityId]
    if (!polity) return 0
    const ownerHouseId = getProvinceEffectiveOwnerHouseId(ws, province.id)
    if (!ownerHouseId) return 0
    const ownerHouse = ws.houses[ownerHouseId]
    if (!ownerHouse) return 0

    const pop = (() => {
      for (const holdingId of province.holdingIds) {
        const popIds = ws.popIndex?.byHolding[holdingId]
        if (!popIds) continue
        for (const popId of popIds) {
          const p = ws.popGroups[popId]
          if (p && p.class === popClass) return p
        }
      }
      return undefined
    })()
    if (!pop) return 0

    // v0.16: houseControl 廃止により、polityControl のみ参照する
    const polityControl = ws ? getProvincePolityControlFromHoldings(ws, province.id) : 0
    let tendency =
      pop.unrest * defaultConfig.provinceRevoltUnrestFactor +
      (100 - polityControl) * defaultConfig.provinceRevoltLowCountryControlFactor -
      getPolityStability(ws, defaultConfig, polityId) *
        defaultConfig.provinceRevoltStabilitySuppressionFactor

    if (popClass === 'peasants') {
      if (pop.wealth < defaultConfig.povertyWealthThreshold) {
        tendency +=
          (defaultConfig.povertyWealthThreshold - pop.wealth) *
          defaultConfig.peasantRevoltPovertyFactor
      }
      const pressure = getProvincePopulationPressure(ws, defaultConfig, province.id)
      tendency += pressure * defaultConfig.peasantRevoltPressureFactor
    } else if (popClass === 'townsmen') {
      const townsmenWealth = getPopWealthByClass(ws, province.id, 'townsmen')
      if (townsmenWealth < defaultConfig.overExtractionWealthSafeThreshold) {
        tendency += defaultConfig.townsmenRevoltExtractionFactor
        tendency +=
          Math.log1p(getProvinceMonthlyResourceRevenue(ws, defaultConfig, province.id)) *
          defaultConfig.townsmenRevoltProductionFactor
      }
    } else if (popClass === 'nobles') {
      const noblesPop = (() => {
        for (const holdingId of province.holdingIds) {
          const popIds = ws.popIndex?.byHolding[holdingId]
          if (!popIds) continue
          for (const popId of popIds) {
            const p = ws.popGroups[popId]
            if (p && p.class === 'nobles') return p
          }
        }
        return undefined
      })()
      if (noblesPop) {
        const a_house = getAttitudeOrDefault(ws, noblesPop, {
          kind: 'house',
          id: ownerHouseId,
        })
        const a_country = getAttitudeOrDefault(ws, noblesPop, {
          kind: 'polity',
          id: polityId,
        })
        const houseScore =
          attitudeValueToScore(a_house.affection) * 0.6 +
          attitudeValueToScore(a_house.respect) * 0.4
        const countryScore =
          attitudeValueToScore(a_country.affection) * 0.6 +
          attitudeValueToScore(a_country.respect) * 0.4
        const nobleDisloyalty = 100 - (0.5 * houseScore + 0.5 * countryScore)
        tendency += nobleDisloyalty * defaultConfig.nobleRevoltHouseDisloyaltyFactor
        tendency += nobleDisloyalty * defaultConfig.nobleRevoltLowLegitimacyFactor * 0.5
      }
    }

    return tendency
  }

  const peasantRevoltTendency = currentState
    ? calcRevoltTendencyForClass(currentState, 'peasants')
    : 0
  const townsmenRevoltTendency = currentState
    ? calcRevoltTendencyForClass(currentState, 'townsmen')
    : 0
  const noblesRevoltTendency = currentState ? calcRevoltTendencyForClass(currentState, 'nobles') : 0

  return (
    <div className="flex flex-col gap-1 p-3">
      <PanelHeader
        title={resolveName('province', province.nameKey, province.nameKey)}
        actions={
          <CopyJsonButton
            payload={buildEntitySnapshot('province', province, currentState ?? null)}
          />
        }
      />

      <img
        src={getProvinceImage(province.terrain, province.features)}
        alt={resolveName('province', province.nameKey, province.nameKey)}
        className="h-24 w-full rounded object-cover"
        draggable={false}
      />

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.terminal_polity')}:</span>
          <PolityLink
            polityId={
              currentState ? getProvinceTerminalPolityId(currentState, province.id) : undefined
            }
            world={currentState ?? undefined}
            onClick={onPolityClick}
          />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.effective_owner')}:</span>
          <HouseLink
            houseId={
              currentState ? getProvinceEffectiveOwnerHouseId(currentState, province.id) : undefined
            }
            houses={currentState?.houses ?? {}}
            onClick={onHouseClick}
          />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.terrain')}:</span>
          <span>{t(`detail.province.terrain_value.${province.terrain}`)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.features')}:</span>
          <span>
            {province.features.length > 0
              ? province.features.map((f) => t(`detail.province.feature_value.${f}`)).join(', ')
              : t('detail.province.no_features')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.development')}:</span>
          <span>
            {formatScore(holdingDev)} {getDevelopmentLabel(holdingDev)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.dev_multiplier')}:</span>
          <span>{formatScore(developmentMultiplier)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.polity_control')}:</span>
          <span>{formatPower(holdingCtrl)}</span>
        </div>
      </div>

      <DetailSection title={t('detail.province.holdings')} count={province.holdingIds.length} />
      {currentState &&
        getProvinceHoldings(currentState, province.id).map((holding) => {
          const bailiff = getHoldingBailiffPerson(currentState, holding.id)
          const holdingDisplay = getHoldingShortName(currentState, resolveName, holding.id)
          return (
            <div
              key={holding.id}
              className="mb-1 flex gap-2 rounded border border-gray-700 bg-gray-800 p-1.5 text-sm"
            >
              <img
                src={getHoldingImage(
                  holding.kind,
                  resolveHoldingImprovements(currentState, holding.id),
                )}
                alt={holdingDisplay}
                className="h-16 w-16 flex-shrink-0 rounded object-cover"
                draggable={false}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <button
                    className="cursor-pointer font-medium text-blue-400 hover:text-blue-300"
                    onClick={() => onHoldingClick(holding.id)}
                  >
                    {holdingDisplay}
                  </button>
                  <span
                    className={`rounded px-1 text-xs ${holding.kind === 'city' ? 'bg-amber-800 text-amber-200' : 'bg-green-900 text-green-300'}`}
                  >
                    {holding.kind}
                  </span>
                </div>
                <div className="mt-0.5 grid grid-cols-2 gap-x-2 text-xs text-gray-400">
                  <span>
                    {t('detail.province.dev')}:{' '}
                    {(currentState
                      ? getHoldingDevelopment(currentState, defaultConfig, holding.id)
                      : 0
                    ).toFixed(1)}
                  </span>
                  <span>
                    {t('detail.province.control')}: {holding.polityControl.toFixed(0)}%
                  </span>
                  <span>
                    {t('detail.province.quality')}: {holding.landQuality.toFixed(2)}
                  </span>
                  <span>
                    {t('detail.province.weight')}: {holding.weight.toFixed(1)}
                  </span>
                </div>
                {(() => {
                  const chain = getHoldingLandContractChain(currentState, holding.id)
                  if (chain.length === 0) return null
                  return (
                    <div className="mt-0.5 text-xs">
                      <span className="text-gray-500">{t('detail.province.contract_chain')}:</span>
                      {chain.map((contract, idx) => {
                        const grantee = currentState.polities[contract.granteePolityId]
                        const nextContract = idx + 1 < chain.length ? chain[idx + 1] : undefined
                        return (
                          <div key={contract.id}>
                            <div className="border-l border-gray-700 pl-2">
                              {grantee ? (
                                <button
                                  className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline"
                                  onClick={() => onPolityClick(grantee.id, 'polity')}
                                >
                                  {getPolityShortName(currentState, resolveName, grantee.id)}
                                </button>
                              ) : (
                                <span className="text-gray-500">—</span>
                              )}
                            </div>
                            {nextContract && (
                              <div className="border-l border-gray-700 pl-3 text-gray-500">
                                ↓ {(nextContract.terms.taxRateToGrantor * 100).toFixed(0)}%
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
                <div className="mt-0.5 text-xs text-gray-400">
                  {t('detail.province.bailiff')}:{' '}
                  {bailiff ? (
                    bailiff.kind === 'placeholder' ? (
                      <span className="text-gray-500 italic">
                        {t('detail.province.placeholder')}
                      </span>
                    ) : (
                      <PersonLink
                        personId={bailiff.id}
                        persons={currentState.persons ?? {}}
                        onClick={onPersonClick}
                      />
                    )
                  ) : (
                    <span className="text-gray-500">{t('detail.province.vacant')}</span>
                  )}
                </div>
                <div className="mt-1 border-t border-gray-700 pt-1">
                  {(['peasants', 'townsmen', 'nobles'] as const).map((popClass) => {
                    const empSize = getHoldingEmployedPopSize(currentState, holding.id, popClass)
                    const cap = getHoldingClassCapacity(
                      currentState,
                      defaultConfig,
                      holding.id,
                      popClass,
                    )
                    const unempSize = getHoldingUnemployedPopSize(
                      currentState,
                      holding.id,
                      popClass,
                    )
                    if (empSize === 0 && unempSize === 0) return null
                    return (
                      <div key={popClass} className="text-xs text-gray-400">
                        <span className="text-gray-300">{t(`detail.province.${popClass}`)}</span>
                        <div className="ml-2">
                          <span>
                            {t('detail.province.pop_employed')}: {empSize.toFixed(1)} /{' '}
                            {cap.toFixed(1)}
                          </span>
                          {unempSize > 0 && (
                            <span className="ml-2 text-yellow-400">
                              {t('detail.province.pop_unemployed')}: {unempSize.toFixed(1)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}

      <DetailSection title={t('detail.province.population_section')} />
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.carrying_capacity')}:</span>
          <span>{carryingCapacity.toFixed(0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.population')}:</span>
          <span>{totalPopulation.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.pop_pressure')}:</span>
          <span className={populationPressure > 0.9 ? 'text-red-400' : 'text-gray-200'}>
            {(populationPressure * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.avg_wealth')}:</span>
          <span>{avgWealth.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.unrest')}:</span>
          <span className={derivedUnrest > 60 ? 'text-red-400' : 'text-gray-200'}>
            {derivedUnrest.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.production')}:</span>
          <span>{derivedProduction.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.manpower')}:</span>
          <span>{derivedManpower.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.country_manpower')}:</span>
          <span>{countryManpower.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.house_manpower')}:</span>
          <span>{houseManpower.toFixed(2)}</span>
        </div>
      </div>

      {pops.length > 0 && (
        <>
          <DetailSection title={t('detail.province.pop_groups')} />
          {pops.map((pop) => (
            <div key={pop.id} className="rounded bg-gray-700 p-1.5 text-xs">
              <button
                className="w-full cursor-pointer text-left font-medium text-blue-400 capitalize hover:text-blue-300"
                onClick={() => onPopGroupClick(pop.id)}
              >
                {t(`detail.province.${pop.class}`, { defaultValue: pop.class })}{' '}
                <span className="text-xs font-normal text-gray-400">
                  (
                  {pop.employed
                    ? t('detail.province.pop_employed')
                    : t('detail.province.pop_unemployed')}
                  )
                </span>{' '}
                →
              </button>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.province.size')}:</span>
                <span>{pop.size.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.province.wealth')}:</span>
                <span>{pop.wealth.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.province.unrest')}:</span>
                <span className={pop.unrest > 60 ? 'text-red-400' : 'text-gray-200'}>
                  {pop.unrest.toFixed(1)}
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      <DetailSection title={t('detail.province.revolt_risk')} />
      <div className="text-sm">
        {(
          [
            [t('detail.province.peasants'), peasantRevoltTendency],
            [t('detail.province.townsmen'), townsmenRevoltTendency],
            [t('detail.province.nobles'), noblesRevoltTendency],
          ] as const
        ).map(([label, tendency]) => (
          <div key={label} className="flex justify-between">
            <span className="text-gray-400">{label}:</span>
            <span
              className={
                tendency >= defaultConfig.provinceRevoltThreshold ? 'text-red-400' : 'text-gray-200'
              }
            >
              {tendency.toFixed(1)}
            </span>
          </div>
        ))}
      </div>

      {province.neighbors.length > 0 && (
        <>
          <DetailSection title={t('detail.province.neighbors')} />
          <div className="flex flex-col gap-0.5 text-sm">
            {province.neighbors.map((nid) => (
              <button
                key={nid}
                className="text-left text-blue-400 underline underline-offset-2 hover:text-blue-300"
                onClick={() => onProvinceClick(nid)}
              >
                {(() => {
                  const np = currentState?.provinces?.[nid]
                  return np ? resolveName('province', np.nameKey, np.nameKey) : nid
                })()}
              </button>
            ))}
          </div>
        </>
      )}

      {/* v0.38 §8: 地方史 (永続 Chronicle) */}
      {currentState && (
        <EntityChronicleSection
          title={t('detail.province.chronicle')}
          entries={getChronicleEntriesForProvince(currentState, province.id)}
          entityType="province"
          entityId={province.id}
        />
      )}
    </div>
  )
}
