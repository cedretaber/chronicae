import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorldState } from '@/sim/types/world'
import type { PersonId } from '@/sim/types/ids'
import type { PersonReputation, ReputationCategory } from '@sim/types/personReputation'
import { defaultConfig } from '@sim/config/defaultConfig'
import {
  getPersonReputationSummary,
  getCurrentPersonReputationScore,
} from '@sim/selectors/personReputationSelectors'
import { WEEKS_PER_YEAR } from '@sim/utils/timeUtils'

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

function scoreColor(value: number): string {
  return value >= 0 ? 'text-green-400' : 'text-red-400'
}

/** v0.44 追補: 人物の現在評判。category 別合算 + クリックで個々の評判エンティティを展開表示。 */
export function PersonReputationSection({
  worldState,
  personId,
}: {
  worldState: WorldState
  personId: PersonId
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<Set<ReputationCategory>>(new Set())

  const summary = getPersonReputationSummary(worldState, defaultConfig, personId)
  if (summary.length === 0) return null

  const reputationIds = worldState.personReputationIndex.byPerson[personId] ?? []
  const reputations = reputationIds
    .map((id) => worldState.personReputations[id])
    .filter((r): r is PersonReputation => r !== undefined)

  function toggle(category: ReputationCategory) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  function sourceLabel(reputation: PersonReputation): string {
    const source = reputation.source
    switch (source.kind) {
      case 'project':
        return t(`detail.project_kind.${source.projectKind}`)
      case 'diplomatic_play':
        return t(`play_kind.${source.playKind}`, { ns: 'diplomacy' })
      case 'war':
        return t('enum.sourceKind.war', { ns: 'events' })
      case 'revolt':
        return t('enum.sourceKind.revolt', { ns: 'events' })
    }
  }

  function ageLabel(createdWeek: number): string {
    const years = Math.floor((worldState.absoluteWeek - createdWeek) / WEEKS_PER_YEAR)
    return years <= 0
      ? t('detail.person.reputation_this_year')
      : t('detail.person.reputation_years_ago', { n: years })
  }

  return (
    <>
      <div className="text-sm font-semibold text-gray-300">{t('detail.person.reputation')}:</div>
      <div className="text-sm">
        {summary.map((entry) => {
          const isExpanded = expanded.has(entry.category)
          const categoryReputations = reputations
            .filter((r) => r.category === entry.category)
            .map((r) => ({
              reputation: r,
              current: getCurrentPersonReputationScore(r, worldState.absoluteWeek, defaultConfig),
            }))
            .sort((a, b) => Math.abs(b.current) - Math.abs(a.current))
          return (
            <div key={entry.category}>
              <button
                className="flex w-full cursor-pointer justify-between hover:bg-gray-700/40"
                onClick={() => toggle(entry.category)}
              >
                <span className="text-gray-400">
                  <span className="mr-1 inline-block w-3 text-gray-500">
                    {isExpanded ? '▾' : '▸'}
                  </span>
                  {t(`enum.category.${entry.category}`, { ns: 'events' })}:
                </span>
                <span>
                  <span className={scoreColor(entry.score)}>{formatSigned(entry.score)}</span>
                  <span className="ml-1 text-xs text-gray-500">
                    ({t('detail.person.reputation_sources', { n: entry.count })})
                  </span>
                </span>
              </button>
              {isExpanded && (
                <div className="mb-1 ml-4 text-xs">
                  {categoryReputations.map(({ reputation, current }) => {
                    const remainingPct = Math.round((current / reputation.baseScore) * 100)
                    return (
                      <div key={reputation.id} className="flex justify-between text-gray-400">
                        <span>{sourceLabel(reputation)}</span>
                        <span>
                          <span className="text-gray-500">
                            {formatSigned(reputation.baseScore)} →{' '}
                          </span>
                          <span className={scoreColor(current)}>{formatSigned(current)}</span>
                          <span className="ml-1 text-gray-500">
                            ({t('detail.person.reputation_remaining', { pct: remainingPct })} ・{' '}
                            {ageLabel(reputation.createdWeek)})
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
