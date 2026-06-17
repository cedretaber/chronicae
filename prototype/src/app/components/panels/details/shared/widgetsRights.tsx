import { useTranslation } from 'react-i18next'
import type { ClickHandler } from './helpers'
import type { Person } from '@/sim/types/person'
import { PersonLink, HouseLink } from './links'
import type { House } from '@/sim/types/house'
import type { WorldState } from '@/sim/types/world'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getPolityShortName, getHoldingQualifiedName } from '@/app/hooks/entityNameHelpers'
import type { PersonId } from '@/sim/types/ids'
import { getRightsByHolder } from '@sim/selectors/politicalRightSelectors'
import type { PoliticalRight, PoliticalRightTargetRef } from '@sim/types/politicalRight'
import type { ResolveName } from '@/app/hooks/entityNameHelpers'
import type { TFunction } from 'i18next'

// v0.42: PoliticalRight の target 表示名。
//   polity_office_role -> 役職名 + 席番号 (slot 単位 right) / holding_office_role ->
//   Holding 完全名 + 代官 / regiment -> home Province 名 + 連隊 (PolityRegiments と同じ命名)。
function politicalRightTargetLabel(
  worldState: WorldState,
  t: TFunction,
  resolveName: ResolveName,
  target: PoliticalRightTargetRef,
): string {
  switch (target.kind) {
    case 'polity_office_role':
      return `${t(`polity.${target.role}`, { ns: 'roles' })} ${t('detail.polity.slot_label', { n: target.slotIndex + 1 })}`
    case 'holding_office_role':
      return `${getHoldingQualifiedName(worldState, resolveName, target.holdingId)} ${t('holding.bailiff', { ns: 'roles' })}`
    case 'regiment': {
      const regiment = worldState.regiments[target.regimentId]
      const province =
        regiment?.homeProvinceId !== undefined
          ? worldState.provinces[regiment.homeProvinceId]
          : undefined
      const provinceName = province
        ? resolveName('province', province.nameKey, province.nameKey)
        : (regiment?.homeProvinceId ?? target.regimentId)
      return `${provinceName} ${t('detail.polity.regiment_suffix')}`
    }
  }
}

// target kind の表示順 (役職 > 代官 > 連隊)。
const RIGHT_KIND_ORDER: Record<PoliticalRightTargetRef['kind'], number> = {
  polity_office_role: 0,
  holding_office_role: 1,
  regiment: 2,
}

function sortRightRows<T extends { right: PoliticalRight; label: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    const ka = RIGHT_KIND_ORDER[a.right.target.kind]
    const kb = RIGHT_KIND_ORDER[b.right.target.kind]
    if (ka !== kb) return ka - kb
    return a.label.localeCompare(b.label)
  })
}

// v0.42: カード内に right 保持者を 1 行で表示する小パーツ (役職/所領/連隊カードで共有)。
// right が無い対象は統治者の本来権限 (residual authority) なので何も出さない。
export function RightHolderLine({
  right,
  label,
  persons,
  houses,
  onPersonClick,
  onHouseClick,
}: {
  right: PoliticalRight | undefined
  label: string
  persons: Record<string, Person>
  houses: Record<string, House>
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  if (!right) return null
  return (
    <div className="mt-0.5 truncate text-[11px] text-gray-500">
      {label}:{' '}
      {right.holder.kind === 'house' ? (
        <HouseLink houseId={right.holder.id} houses={houses} onClick={onHouseClick} />
      ) : (
        <PersonLink personId={right.holder.id} persons={persons} onClick={onPersonClick} />
      )}
    </div>
  )
}

// v0.42: House が保持する PoliticalRight 一覧。家保持分に加え、生存 member 個人保持分も
// 併記する (個人保持は holder Person を右側に表示)。
export function HouseRightsSection({
  house,
  worldState,
  persons,
  onPersonClick,
  onPolityClick,
}: {
  house: House
  worldState: WorldState
  persons: Record<string, Person>
  onPersonClick: ClickHandler
  onPolityClick: ClickHandler
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const houseRights = getRightsByHolder(worldState, { kind: 'house', id: house.id }).map(
    (right) => ({
      right,
      holderPersonId: undefined as PersonId | undefined,
      label: politicalRightTargetLabel(worldState, t, resolveName, right.target),
    }),
  )
  const memberRights = house.memberIds.flatMap((pid) => {
    if (worldState.persons[pid]?.alive !== true) return []
    return getRightsByHolder(worldState, { kind: 'person', id: pid }).map((right) => ({
      right,
      holderPersonId: pid,
      label: politicalRightTargetLabel(worldState, t, resolveName, right.target),
    }))
  })
  const rows = sortRightRows([...houseRights, ...memberRights])
  return (
    <div className="mt-1">
      <div className="text-sm font-semibold text-gray-300">
        {t('detail.house.political_rights')}
        {rows.length > 0 ? ` (${rows.length})` : ''}:
      </div>
      {rows.length === 0 ? (
        <span className="text-sm text-gray-500">—</span>
      ) : (
        <div className="text-sm">
          {rows.map(({ right, label, holderPersonId }) => (
            <div key={right.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate text-gray-400">
                <button
                  className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                  onClick={() => onPolityClick(right.polityId, 'polity')}
                >
                  {getPolityShortName(worldState, resolveName, right.polityId)}
                </button>
                {' — '}
                {label}
              </span>
              {holderPersonId !== undefined && (
                <span className="shrink-0">
                  <PersonLink personId={holderPersonId} persons={persons} onClick={onPersonClick} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// 人物個人が保持する PoliticalRight（役職任命権）一覧。家詳細の HouseRightsSection の
// person 版（保有者は常に当該人物なので holder 列は出さない）。v0.47.4。
export function PersonRightsSection({
  person,
  worldState,
  onPolityClick,
}: {
  person: Person
  worldState: WorldState
  onPolityClick: ClickHandler
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const rows = sortRightRows(
    getRightsByHolder(worldState, { kind: 'person', id: person.id }).map((right) => ({
      right,
      holderPersonId: undefined as PersonId | undefined,
      label: politicalRightTargetLabel(worldState, t, resolveName, right.target),
    })),
  )
  return (
    <div className="mt-1">
      <div className="text-sm font-semibold text-gray-300">
        {t('detail.person.political_rights')}
        {rows.length > 0 ? ` (${rows.length})` : ''}:
      </div>
      {rows.length === 0 ? (
        <span className="text-sm text-gray-500">—</span>
      ) : (
        <div className="text-sm">
          {rows.map(({ right, label }) => (
            <div key={right.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate text-gray-400">
                <button
                  className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                  onClick={() => onPolityClick(right.polityId, 'polity')}
                >
                  {getPolityShortName(worldState, resolveName, right.polityId)}
                </button>
                {' — '}
                {label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
