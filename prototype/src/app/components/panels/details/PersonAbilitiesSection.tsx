import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Person } from '@/sim/types/person'
import { AbilityRadarChart } from './shared/charts'
import { ABILITY_KEYS } from './shared/constants'
import { ABILITY_AGE_CURVES } from '@sim/constants/abilityConstants'

/** Person の 6 能力を table / radar 切替で表示するセクション (表示切替 state を内包)。 */
export function PersonAbilitiesSection({ person }: { person: Person }) {
  const { t } = useTranslation()
  const [abilityView, setAbilityView] = useState<'table' | 'radar'>('table')

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-300">{t('detail.person.abilities')}</span>
        <div className="flex gap-0.5 rounded bg-gray-700 p-0.5 text-[10px]">
          <button
            className={`rounded px-1.5 py-0.5 ${abilityView === 'table' ? 'bg-gray-500 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
            onClick={() => setAbilityView('table')}
          >
            Table
          </button>
          <button
            className={`rounded px-1.5 py-0.5 ${abilityView === 'radar' ? 'bg-gray-500 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
            onClick={() => setAbilityView('radar')}
          >
            Radar
          </button>
        </div>
      </div>
      {abilityView === 'table' ? (
        <div className="text-sm">
          {ABILITY_KEYS.map((key) => {
            const label = t(`detail.person.ability_${key}`)
            const curve = ABILITY_AGE_CURVES[key]
            const curveIcon = curve === 'youthPeak' ? '▲' : curve === 'midLifePeak' ? '●' : '↗'
            const curveColor =
              curve === 'youthPeak'
                ? 'text-yellow-400'
                : curve === 'midLifePeak'
                  ? 'text-orange-400'
                  : 'text-green-400'
            const abilityPct = (person.abilities[key] / 120) * 100
            const aptitudePct = (person.aptitudes[key] / 120) * 100
            return (
              <div key={key} className="mb-0.5">
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    <span className={`mr-1 text-xs ${curveColor}`}>{curveIcon}</span>
                    {label}:
                  </span>
                  <span>
                    <span className="text-gray-100">{person.abilities[key]}</span>
                    <span className="text-gray-500"> / </span>
                    <span className="text-gray-400">{person.aptitudes[key]}</span>
                  </span>
                </div>
                <div className="relative h-1 w-full rounded bg-gray-600">
                  <div
                    className="absolute h-1 rounded bg-gray-400"
                    style={{ width: `${aptitudePct}%` }}
                  />
                  <div
                    className="absolute h-1 rounded bg-blue-400"
                    style={{ width: `${abilityPct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div>
          <AbilityRadarChart abilities={person.abilities} aptitudes={person.aptitudes} />
          <div className="mt-1 flex justify-center gap-3 text-[10px]">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded bg-blue-400/40" />
              <span className="text-gray-400">{t('detail.person.ability')}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded bg-gray-400/30" />
              <span className="text-gray-400">{t('detail.person.aptitude')}</span>
            </span>
          </div>
        </div>
      )}
    </>
  )
}
