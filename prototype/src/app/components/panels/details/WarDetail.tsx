import type { SimulationSession } from '@/sim/types/world'
import type { ClickHandler } from './shared/helpers'
import { useTranslation } from 'react-i18next'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getPolityShortName } from '@/app/hooks/entityNameHelpers'
import { PersonLink, PolityLink, HouseLink } from './shared/links'
import {
  getRegimentsForWarSide,
  getRegimentPowerForWarSide,
} from '@sim/selectors/regimentSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { isContractEliminationRate } from '@sim/selectors/landContractSelectors'
import {
  getWarPrimaryAttacker,
  getWarPrimaryDefender,
  getWarSideSupporters,
} from '@sim/mutations/warMutations'
import type { OrganizationRef } from '@/sim/types/office'
import { weekToYearMonthWeek } from '@sim/utils/timeUtils'
import { formatYearMonthWeek } from '@/app/utils/format'
import { EntityChronicleSection } from './shared/widgets'
import { getChronicleEntriesForWar } from '@sim/selectors/chronicleSelectors'

// v0.34 §16: War 詳細。DiplomaticPlayDetail の縮小版 (交渉系の要素は War に存在しないため全て削除)。
export function WarDetail({
  war,
  session,
  onPersonClick,
  onPolityClick,
  onHouseClick,
  onHoldingClick,
}: {
  war: import('@sim/types/war').War
  session: SimulationSession | null
  onPersonClick: ClickHandler
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onHoldingClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const worldState = session?.currentState ?? null
  if (!worldState) return null

  const polities = worldState.polities
  const houses = worldState.houses
  const persons = worldState.persons

  // v0.35: WarSide ごとの総大将 / 現場指揮官候補 / 回避回数。captainGeneral / commander は soft reference。
  const renderSideCommand = (label: string, side: import('@sim/types/war').WarSide) => {
    const cg = side.captainGeneralPersonId
    return (
      <div className="rounded bg-gray-800 px-2 py-1 text-xs">
        <div className="font-semibold text-gray-300">{label}</div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.war.captain_general')}:</span>
          {cg ? (
            <PersonLink personId={cg} persons={persons} onClick={onPersonClick} />
          ) : (
            <span className="text-gray-500">&mdash;</span>
          )}
        </div>
        <div className="flex justify-between gap-2">
          <span className="shrink-0 text-gray-400">{t('detail.war.commanders')}:</span>
          {side.commanderPersonIds.length === 0 ? (
            <span className="text-gray-500">&mdash;</span>
          ) : (
            <span className="flex flex-wrap justify-end gap-x-2">
              {side.commanderPersonIds.map((pid) => (
                <PersonLink key={pid} personId={pid} persons={persons} onClick={onPersonClick} />
              ))}
            </span>
          )}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.war.avoidance_count')}:</span>
          <span className="text-gray-200">{side.avoidanceCount}</span>
        </div>
      </div>
    )
  }

  // v0.36: WarSide ごとの動員連隊数と連隊戦力。power は mobilized active Regiment の effective power 合計
  //   (getRegimentPowerForWarSide。動員ゼロかつ owner が regiment 非保有なら getActorMilitaryPower へ fallback)。
  const renderSideMobilization = (label: string, sideKey: import('@sim/types/war').WarSideKey) => {
    const mobilizedCount = getRegimentsForWarSide(worldState, war.id, sideKey).filter(
      (r) => r.status === 'active',
    ).length
    const power = Math.round(getRegimentPowerForWarSide(worldState, defaultConfig, war, sideKey))
    return (
      <div className="rounded bg-gray-800 px-2 py-1 text-xs">
        <div className="font-semibold text-gray-300">{label}</div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.war.mobilized')}:</span>
          <span className="text-gray-200">{mobilizedCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.war.regiment_power')}:</span>
          <span className="text-gray-200">{power}</span>
        </div>
      </div>
    )
  }

  const attacker = getWarPrimaryAttacker(war)?.actor
  const defender = getWarPrimaryDefender(war)?.actor
  const attackerLabel =
    attacker?.kind === 'polity' && polities[attacker.id]
      ? getPolityShortName(worldState, resolveName, attacker.id)
      : t('detail.war.attacker')
  const defenderLabel =
    defender?.kind === 'polity' && polities[defender.id]
      ? getPolityShortName(worldState, resolveName, defender.id)
      : t('detail.war.defender')
  const statusBadge: Record<string, { label: string; bg: string }> = {
    active: { label: t('detail.war.status_active'), bg: 'bg-red-700' },
    attacker_won: { label: `${attackerLabel} ${t('detail.war.status_won')}`, bg: 'bg-green-700' },
    defender_won: { label: `${defenderLabel} ${t('detail.war.status_won')}`, bg: 'bg-green-700' },
    white_peace: { label: t('detail.war.status_white_peace'), bg: 'bg-gray-600' },
    cancelled: { label: t('detail.war.status_cancelled'), bg: 'bg-gray-600' },
  }
  const badge = statusBadge[war.status] ?? { label: war.status, bg: 'bg-gray-600' }

  const renderActor = (actor: OrganizationRef | undefined) => {
    if (!actor) return <span className="text-gray-500">&mdash;</span>
    if (actor.kind === 'polity') {
      return <PolityLink polityId={actor.id} world={worldState} onClick={onPolityClick} />
    }
    return <HouseLink houseId={actor.id} houses={houses} onClick={onHouseClick} />
  }

  const started = weekToYearMonthWeek(war.startedWeek)
  const ended = war.endedWeek != null ? weekToYearMonthWeek(war.endedWeek) : null

  // warScore (-100..100, 正=attacker優勢) を 0..100% にマップ。攻撃優勢=右/緑、防衛優勢=左/赤。
  const clampedScore = Math.max(-100, Math.min(100, war.warScore))
  const scorePos = (clampedScore + 100) / 2
  const targetLow = (-war.targetWarScore + 100) / 2
  const targetHigh = (war.targetWarScore + 100) / 2
  const scoreRounded = Math.round(war.warScore)
  const fillLeft = clampedScore >= 0 ? 50 : scorePos
  const fillWidth = Math.abs(scorePos - 50)
  const fillColor = clampedScore >= 0 ? 'bg-green-600' : 'bg-red-600'

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs text-white ${badge.bg}`}>
          {badge.label}
        </span>
      </div>

      <div className="text-sm">
        <div className="flex items-center gap-2">
          {renderActor(attacker)}
          <span className="text-gray-500">vs</span>
          {renderActor(defender)}
        </div>

        {/* v0.43 §18.1: 各 side の supporter (primary 以外の participant)。delegate 等は持たない。 */}
        {(['attacker', 'defender'] as const).map((sideKey) => {
          const supporters = getWarSideSupporters(war, sideKey)
          if (supporters.length === 0) return null
          const label = sideKey === 'attacker' ? attackerLabel : defenderLabel
          return (
            <div key={sideKey} className="flex justify-between gap-2 text-xs">
              <span className="shrink-0 text-gray-400">
                {t('detail.war.supporters')} ({label}):
              </span>
              <span className="flex flex-wrap justify-end gap-x-2">
                {supporters.map((p) => (
                  <span key={`${p.actor.kind}:${p.actor.id}`}>{renderActor(p.actor)}</span>
                ))}
              </span>
            </div>
          )
        })}

        <div className="my-1 border-t border-gray-700" />

        <div className="text-gray-400">{t('detail.war.war_score')}:</div>
        <div className="relative my-1 h-2 w-full rounded bg-gray-700">
          <div
            className={`absolute top-0 h-2 ${fillColor}`}
            style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
          />
          {/* 中央 (warScore=0) */}
          <div className="absolute top-0 h-2 w-px bg-gray-400" style={{ left: '50%' }} />
          {/* 決着閾値 ±targetWarScore */}
          <div
            className="absolute -top-0.5 h-3 w-px bg-yellow-400"
            style={{ left: `${targetLow}%` }}
          />
          <div
            className="absolute -top-0.5 h-3 w-px bg-yellow-400"
            style={{ left: `${targetHigh}%` }}
          />
          {/* 現在の warScore */}
          <div
            className="absolute -top-0.5 h-3 w-1 rounded bg-white"
            style={{ left: `calc(${scorePos}% - 2px)` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">{defenderLabel}</span>
          <span className="text-gray-200">
            {scoreRounded >= 0 ? '+' : ''}
            {scoreRounded}{' '}
            <span className="text-gray-400">
              / {t('detail.war.target')} &plusmn;{war.targetWarScore}
            </span>
          </span>
          <span className="text-gray-500">{attackerLabel}</span>
        </div>

        <div className="my-1 border-t border-gray-700" />

        <div className="flex flex-col gap-1">
          {renderSideCommand(attackerLabel, war.attacker)}
          {renderSideCommand(defenderLabel, war.defender)}
        </div>

        <div className="my-1 border-t border-gray-700" />

        <div className="flex flex-col gap-1">
          {renderSideMobilization(attackerLabel, 'attacker')}
          {renderSideMobilization(defenderLabel, 'defender')}
        </div>

        <div className="my-1 border-t border-gray-700" />

        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.war.started')}:</span>
          <span>{formatYearMonthWeek(started.year, started.month, started.weekOfMonth)}</span>
        </div>
        {ended && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.war.ended')}:</span>
            <span>{formatYearMonthWeek(ended.year, ended.month, ended.weekOfMonth)}</span>
          </div>
        )}

        <div className="my-1 border-t border-gray-700" />

        <div className="text-gray-400">{t('detail.war.goals')}:</div>
        {war.warGoals.length === 0 ? (
          <span className="text-gray-500">&mdash;</span>
        ) : (
          <div className="flex flex-col gap-1">
            {war.warGoals.map((goal, idx) => {
              if (goal.kind === 'popular_revolt_independence') {
                return (
                  <div key={idx} className="rounded bg-gray-800 px-2 py-1 text-xs">
                    <div>
                      <span className="text-gray-400">
                        {t('detail.war.goal_revolt_independence')}:
                      </span>{' '}
                      <span className="text-gray-500">
                        ({goal.holdingIds.length} holdings, &plusmn;{goal.requiredWarScore})
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-gray-400">
                      <PolityLink
                        polityId={goal.originalHolderPolityId}
                        world={worldState}
                        onClick={onPolityClick}
                      />
                      <span>&rarr;</span>
                      <PolityLink
                        polityId={goal.commonwealthPolityId}
                        world={worldState}
                        onClick={onPolityClick}
                      />
                    </div>
                  </div>
                )
              }
              const holding = worldState.holdings[goal.holdingId]
              const provinceId = holding?.provinceId
              const provinceName = provinceId
                ? resolveName(
                    'province',
                    worldState.provinces[provinceId]?.nameKey ?? provinceId,
                    provinceId,
                  )
                : goal.holdingId
              if (goal.kind === 'transfer_land_contract') {
                return (
                  <div key={idx} className="rounded bg-gray-800 px-2 py-1 text-xs">
                    <div>
                      <span className="text-gray-400">{t('detail.war.goal_transfer_land')}:</span>{' '}
                      <button
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onHoldingClick(goal.holdingId)}
                      >
                        {provinceName}
                        {holding ? ` ${holding.kind}` : ''}
                      </button>{' '}
                      <span className="text-gray-500">(&plusmn;{goal.requiredWarScore})</span>
                    </div>
                    <div className="flex items-center gap-1 text-gray-400">
                      <PolityLink
                        polityId={goal.fromPolityId}
                        world={worldState}
                        onClick={onPolityClick}
                      />
                      <span>&rarr;</span>
                      <PolityLink
                        polityId={goal.toPolityId}
                        world={worldState}
                        onClick={onPolityClick}
                      />
                    </div>
                  </div>
                )
              }
              // v0.34: 開戦時に凍結した baseTaxRateToGrantor を before として表示する (live 契約 rate ではない)。
              //   これにより終戦後 (税適用済み) も「元→新」が正しく残り、X%→X% の混乱を防ぐ。
              const baseRate = goal.baseTaxRateToGrantor
              // §6.69: 目標税率が境界クランプ = 契約取消し意図。税率改定 (X%→Y%) でなく「解除」を表示する。
              const isElimination = isContractEliminationRate(
                goal.newTaxRateToGrantor,
                defaultConfig,
              )
              return (
                <div key={idx} className="rounded bg-gray-800 px-2 py-1 text-xs">
                  <div>
                    <span className="text-gray-400">
                      {t(
                        isElimination
                          ? 'detail.war.goal_dissolve_contract'
                          : 'detail.war.goal_change_tax',
                      )}
                      :
                    </span>{' '}
                    <button
                      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                      onClick={() => onHoldingClick(goal.holdingId)}
                    >
                      {provinceName}
                      {holding ? ` ${holding.kind}` : ''}
                    </button>{' '}
                    <span className="text-gray-500">(&plusmn;{goal.requiredWarScore})</span>
                  </div>
                  {!isElimination && (
                    <div className="text-gray-400">
                      {Math.round(baseRate * 100)}% &rarr;{' '}
                      {Math.round(goal.newTaxRateToGrantor * 100)}%
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* v0.38 §8: 戦争の記録 (永続 Chronicle)。v0.49 §16.2: chronicleIndex.byWar 経由 (全走査解消)。 */}
        <EntityChronicleSection
          title={t('detail.war.chronicle')}
          entries={getChronicleEntriesForWar(worldState, war.id)}
          entityType="war"
          entityId={war.id}
        />
      </div>
    </div>
  )
}
