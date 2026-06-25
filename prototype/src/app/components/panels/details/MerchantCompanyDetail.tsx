import type { MerchantCompany } from '@/sim/types/merchant'
import type { SimulationSession } from '@/sim/types/world'
import { useTranslation } from 'react-i18next'
import { PanelHeader, DetailSection } from './shared/widgets'
import { HouseLink, PersonLink } from './shared/links'
import { TradeRouteCard } from './shared/TradeRouteCard'
import { ProjectCard } from './shared/ProjectCard'
import type { ClickHandler } from './shared/helpers'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getHoldingQualifiedName } from '@/app/hooks/entityNameHelpers'
import type { HoldingId } from '@sim/types/ids'
import { formatAmount } from '@/app/utils/format'
import {
  getCompanyEstablishments,
  getCompanyRoutes,
  getMerchantCompanyDecisionMaker,
} from '@sim/selectors/merchantSelectors'
import { getActiveOfficeHolders } from '@sim/selectors/officeSelectors'

// v0.61 §22: 商会の read-only detail パネル。所有家・会頭/番頭・財務・本支店・交易路を表示する。
export function MerchantCompanyDetail({
  company,
  session,
  onHouseClick,
  onPersonClick,
  onHoldingClick,
  onTradeRouteClick,
}: {
  company: MerchantCompany
  session: SimulationSession | null
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
  onHoldingClick: (id: string) => void
  onTradeRouteClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const state = session?.currentState ?? null

  const companyName = resolveName('house', company.nameKey, company.id)
  const establishments = state ? getCompanyEstablishments(state, company.id) : []
  const routes = state ? getCompanyRoutes(state, company.id) : []
  const chairman = state ? getMerchantCompanyDecisionMaker(state, company.id) : undefined
  const administrator = state
    ? getActiveOfficeHolders(
        state,
        { kind: 'merchant_company', id: company.id },
        'administrator',
      )[0]
    : undefined

  const holdingLabel = (hid: string): string =>
    getHoldingQualifiedName(state, resolveName, hid as HoldingId)

  const statusLabel = t(`detail.merchant.status_${company.status}`, {
    defaultValue: company.status,
  })

  return (
    <div className="flex flex-col gap-1 p-3 text-sm">
      <PanelHeader
        title={companyName}
        badge={<span className="text-xs text-gray-400">{statusLabel}</span>}
      />

      <div className="flex flex-col gap-0.5">
        <div className="flex justify-between">
          <span className="text-gray-500">
            {t('detail.merchant.owner', { defaultValue: '所有家' })}
          </span>
          {state && (
            <HouseLink
              houseId={company.ownerHouseId}
              houses={state.houses}
              onClick={onHouseClick}
            />
          )}
        </div>
        {chairman && state && (
          <div className="flex justify-between">
            <span className="text-gray-500">
              {t('detail.merchant.chairman', { defaultValue: '会頭' })}
            </span>
            <PersonLink personId={chairman} persons={state.persons} onClick={onPersonClick} />
          </div>
        )}
        {administrator && state && (
          <div className="flex justify-between">
            <span className="text-gray-500">
              {t('detail.merchant.administrator', { defaultValue: '番頭' })}
            </span>
            <PersonLink personId={administrator} persons={state.persons} onClick={onPersonClick} />
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-500">
            {t('detail.merchant.treasury', { defaultValue: '財庫' })}
          </span>
          <span className="text-gray-300 tabular-nums">{formatAmount(company.treasury)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">
            {t('detail.merchant.smoothed_profit', { defaultValue: '平滑利益' })}
          </span>
          <span className="text-gray-300 tabular-nums">{company.smoothedProfit.toFixed(1)}</span>
        </div>
      </div>

      <DetailSection
        title={t('detail.merchant.establishments', { defaultValue: '店舗' })}
        count={establishments.length}
      />
      <div className="flex flex-col gap-0.5">
        {establishments.map((est) => (
          <div key={est.id} className="flex justify-between">
            <button
              className="text-left text-sky-400 hover:underline"
              onClick={() => onHoldingClick(est.holdingId)}
            >
              {t(`detail.merchant.kind_${est.kind}`, { defaultValue: est.kind })} @{' '}
              {holdingLabel(est.holdingId as string)}
            </button>
            <span className="text-gray-400">
              Lv{est.level}
              {est.status !== 'active' ? ` (${est.status})` : ''}
            </span>
          </div>
        ))}
      </div>

      <DetailSection
        title={t('detail.merchant.routes', { defaultValue: '交易路' })}
        count={routes.length}
      />
      <div className="flex flex-col gap-1">
        {state &&
          routes.map((r) => (
            <TradeRouteCard
              key={r.id}
              route={r}
              state={state}
              onClick={() => onTradeRouteClick(r.id)}
            />
          ))}
      </div>

      {state &&
        (() => {
          const ownerKey = `merchant_company:${company.id}`
          const projectIds = state.projectIndex.byOwner[ownerKey] ?? []
          const activeProjects = projectIds
            .map((pid) => state.projects[pid])
            .filter((p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active')
          if (activeProjects.length === 0) return null
          return (
            <>
              <DetailSection
                title={t('detail.merchant.projects_section', { defaultValue: 'プロジェクト' })}
                count={activeProjects.length}
              />
              <div className="mt-1 flex flex-col gap-1">
                {activeProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} worldState={state} />
                ))}
              </div>
            </>
          )
        })()}
    </div>
  )
}
