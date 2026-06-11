import type { PersonId } from '@/sim/types/ids'
import type { WorldState } from '@/sim/types/world'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getHouseDisplayName } from '@/app/hooks/entityNameHelpers'
import { getHouseLeader } from '@sim/selectors/officeSelectors'
import { isLandlessHouseMember } from '@sim/selectors/availabilitySelectors'
import type { ClickHandler } from './helpers'
import { getPersonRepresentativeOffice } from './helpers'
import { HouseLink } from './links'

/**
 * 人物を 2〜3 行のカードで表示する共通コンポーネント。
 * 家詳細の構成員一覧・人物詳細の家族・派閥メンバー一覧で共有する。
 *
 * - 1 行目: 性別記号 + 名前リンク + 続柄ラベル(任意) + 天才バッジ
 * - 2 行目: 年齢・人生段階 / 故人なら享年。当主・landless・家(任意) のステータス
 * - 3 行目: 代表役職(生存者・showOffice 時のみ)
 */
export function PersonCard({
  personId,
  worldState,
  onPersonClick,
  onHouseClick,
  relationLabel,
  showHouse = false,
  showOffice = true,
}: {
  personId: PersonId
  worldState: WorldState
  onPersonClick: ClickHandler
  onHouseClick?: ClickHandler
  relationLabel?: string
  showHouse?: boolean
  showOffice?: boolean
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const person = worldState.persons[personId]
  if (!person) {
    return <div className="rounded bg-gray-700/60 p-1 text-xs text-gray-500">—</div>
  }

  const isHead =
    person.houseId !== undefined &&
    person.alive &&
    getHouseLeader(worldState, person.houseId) === personId

  const sexSymbol = person.sex === 'male' ? '♂' : person.sex === 'female' ? '♀' : '·'
  const sexColor =
    person.sex === 'male'
      ? 'text-sky-400'
      : person.sex === 'female'
        ? 'text-pink-400'
        : 'text-gray-500'

  const office =
    showOffice && person.alive
      ? getPersonRepresentativeOffice(worldState, personId, resolveName, t)
      : null

  const landless =
    person.alive && person.houseId !== undefined && isLandlessHouseMember(worldState, personId)

  return (
    <div className="rounded bg-gray-700/60 p-1">
      <div className="flex items-center gap-1 text-sm">
        <span className={`shrink-0 ${sexColor}`}>{sexSymbol}</span>
        <button
          className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
          onClick={() => onPersonClick(personId, 'person')}
        >
          {resolveName('person', person.nameKey, person.nameKey)}
        </button>
        {relationLabel && <span className="text-xs text-gray-500">（{relationLabel}）</span>}
        {person.geniusType !== undefined && (
          <span className="text-xs font-semibold text-purple-400">
            ✦{t(`enum.geniusType.${person.geniusType}`, { ns: 'events' })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-1 text-xs text-gray-400">
        {person.alive ? (
          <span>
            {t('detail.person_card.age', { age: person.age })} ·{' '}
            {t(`life_stage.${person.lifeStage}`, { ns: 'statuses' })}
          </span>
        ) : (
          <span className="text-gray-500">
            {t('detail.person_card.deceased')} ·{' '}
            {t('detail.person_card.years_of_life', { age: person.age })}
          </span>
        )}
        {isHead && <span className="text-amber-300">· {t('detail.person_card.head')}</span>}
        {landless && <span className="text-amber-400">· {t('detail.person_card.landless')}</span>}
        {showHouse &&
          (person.houseId ? (
            <span className="flex items-center gap-1">
              ·{' '}
              {onHouseClick ? (
                <HouseLink
                  houseId={person.houseId}
                  houses={worldState.houses}
                  onClick={onHouseClick}
                />
              ) : (
                getHouseDisplayName(resolveName, worldState.houses[person.houseId], person.houseId)
              )}
            </span>
          ) : (
            <span className="text-gray-500">· {t('detail.person_card.houseless')}</span>
          ))}
      </div>
      {office && (
        <div className={`text-xs ${office.isUnemployed ? 'text-gray-500' : 'text-amber-300'}`}>
          {office.label}
          {office.extraCount > 0 && <span className="text-gray-500"> +{office.extraCount}</span>}
        </div>
      )}
    </div>
  )
}
