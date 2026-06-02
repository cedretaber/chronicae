import type { PopGroup } from '@/sim/types/popGroup'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import { buildEntitySnapshot } from './shared/helpers'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { CopyJsonButton, AttitudeList } from './shared/widgets'
import { getHoldingOccupationCapacity } from '@sim/selectors/popSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'

export function PopGroupDetail({
  popGroup,
  session,
  onPolityClick,
  onHouseClick,
  onPersonClick,
  onProvinceClick,
}: {
  popGroup: PopGroup
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
  onProvinceClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const currentState = session?.currentState
  const holding = currentState?.holdings[popGroup.holdingId]
  const province = holding ? currentState?.provinces[holding.provinceId] : undefined

  const worldState: WorldState | null = currentState ?? null

  const classLabel =
    popGroup.class === 'peasants'
      ? t('detail.province.peasants')
      : popGroup.class === 'townsmen'
        ? t('detail.province.townsmen')
        : popGroup.class === 'nobles'
          ? t('detail.province.nobles')
          : popGroup.class

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">{classLabel}</span>
        <span className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300">
          {t(`popOccupation.${popGroup.occupation}`)}
        </span>
        <CopyJsonButton payload={buildEntitySnapshot('popGroup', popGroup, worldState)} />
      </div>
      <div className="text-sm text-gray-400">
        of{' '}
        <button
          className="cursor-pointer text-blue-400 hover:text-blue-300"
          onClick={() => {
            const holdingId = popGroup.holdingId
            const holding = worldState?.holdings[holdingId]
            if (holding) onProvinceClick(holding.provinceId)
          }}
        >
          {province
            ? `${resolveName('province', province.nameKey, province.nameKey)} ${holding?.kind ?? ''}`
            : '—'}
        </button>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">ID:</span>
          <span className="text-xs text-gray-500">{popGroup.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.size')}:</span>
          <span>{popGroup.size.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.wealth')}:</span>
          <span>{popGroup.wealth.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.unrest')}:</span>
          <span className={popGroup.unrest > 60 ? 'text-red-400' : 'text-gray-200'}>
            {popGroup.unrest.toFixed(1)}
          </span>
        </div>
      </div>

      {popGroup.occupation !== 'none' && currentState && (
        <div className="text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.province.capacity')}:</span>
            <span>
              {popGroup.size.toFixed(1)} /{' '}
              {getHoldingOccupationCapacity(
                currentState,
                defaultConfig,
                popGroup.holdingId,
                popGroup.class,
                popGroup.occupation,
              ).toFixed(1)}
            </span>
          </div>
        </div>
      )}

      <div className="text-sm font-semibold text-gray-300">{t('detail.person.attitudes')}:</div>
      <AttitudeList
        attitudes={popGroup.attitudes}
        worldState={worldState}
        onPolityClick={onPolityClick}
        onHouseClick={onHouseClick}
        onPersonClick={onPersonClick}
      />
    </div>
  )
}
