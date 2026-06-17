import { useTranslation } from 'react-i18next'
import type { ClickHandler } from './helpers'
import type { Person } from '@/sim/types/person'
import { PersonLink, HouseLink } from './links'
import type { House } from '@/sim/types/house'
import { ShareDonutChart, NestedDonutChart } from './charts'
import {
  SHARE_COLORS,
  INFLUENCE_OTHERS_COLOR,
  influenceGroupColor,
  influenceSegmentColor,
} from './constants'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getHouseDisplayName } from '@/app/hooks/entityNameHelpers'

// v0.42 §16.1 / 影響力個人中心化: Polity Influence を「家の支配率」単位にグループ化して表示。
//   - 二重円: 外周 = 家の支配率 (家本体 + 家中メンバー)、内周 = その内訳 (家本体 + 各メンバー)。
//   - リスト: 家ごとに見出し (家の支配率%) → メンバー個人を influence 順にぶら下げる。
//   - 家を持たない有力 person は単独グループ、小勢力は「その他」に集約。
// grouped は getGroupedPolityInfluence の戻り値 (sim 層でグループ化・並べ替え・閾値処理済み)。
type DomainMap = Partial<Record<import('@sim/types/influence').PolityInfluenceDomain, number>>

export function InfluenceSection({
  grouped,
  persons,
  houses,
  onPersonClick,
  onHouseClick,
}: {
  grouped: import('@sim/types/influence').GroupedPolityInfluence
  persons: Record<string, Person>
  houses: Record<string, House>
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  if (grouped.groups.length === 0 && grouped.othersPercent <= 0.5)
    return <span className="text-gray-500">—</span>

  const domainLine = (byDomain: DomainMap): string =>
    Object.entries(byDomain)
      .filter((kv): kv is [string, number] => typeof kv[1] === 'number' && kv[1] > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([domain, v]) => `${t(`detail.polity.influence_domain.${domain}`)} ${v.toFixed(0)}`)
      .join(' · ')

  // 二重円データ: 内周セグメントは外周グループと同じ並びで連結 → 角度が揃う。
  const chartGroups = grouped.groups.map((g, gi) => ({
    color: influenceGroupColor(gi),
    aggregatePercent: g.aggregatePercent,
    segments: g.segments.map((s, si) => ({
      percent: s.percent,
      color: influenceSegmentColor(gi, si),
    })),
  }))
  if (grouped.othersPercent > 0.5) {
    chartGroups.push({
      color: INFLUENCE_OTHERS_COLOR,
      aggregatePercent: grouped.othersPercent,
      segments: [{ percent: grouped.othersPercent, color: INFLUENCE_OTHERS_COLOR }],
    })
  }

  // 中心ラベル = 支配的グループ (家名 or 家無し個人名) + 家の支配率。
  const dominant = grouped.groups[0]
  let centerLabel: { title: string; value: string } | undefined
  if (dominant) {
    let title = '—'
    if (dominant.houseId !== undefined) {
      const h = houses[dominant.houseId]
      if (h) title = getHouseDisplayName(resolveName, h, h.nameKey)
    } else {
      const seg = dominant.segments[0]
      const pid = seg && seg.holder.kind === 'person' ? seg.holder.id : undefined
      const p = pid ? persons[pid] : undefined
      if (p) title = resolveName('person', p.nameKey, p.nameKey)
    }
    if (title.length > 7) title = `${title.slice(0, 6)}…`
    centerLabel = { title, value: `${dominant.aggregatePercent.toFixed(0)}%` }
  }

  return (
    <div className="flex items-start gap-3">
      <NestedDonutChart groups={chartGroups} centerLabel={centerLabel} />
      <div className="min-w-0 flex-1 text-sm">
        {grouped.groups.map((g, gi) => {
          const groupKey =
            g.houseId !== undefined ? `house:${g.houseId}` : `group:${gi}:${g.segments[0]?.percent}`
          const isHouse = g.houseId !== undefined
          const headSeg = g.segments[0]
          const headPersonId =
            !isHouse && headSeg && headSeg.holder.kind === 'person' ? headSeg.holder.id : undefined
          return (
            <div key={groupKey} className="mb-1 flex flex-col">
              {/* 家見出し (家の支配率) */}
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: influenceGroupColor(gi) }}
                />
                <span className="min-w-0 truncate font-medium">
                  {isHouse ? (
                    <HouseLink houseId={g.houseId} houses={houses} onClick={onHouseClick} />
                  ) : headPersonId ? (
                    <PersonLink personId={headPersonId} persons={persons} onClick={onPersonClick} />
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 text-gray-200">
                  {g.aggregatePercent.toFixed(1)}%
                </span>
              </div>
              {/* 家全体の domain 内訳 (声望/役職/軍事 等) を見出し直下に 1 行 */}
              {domainLine(g.aggregateByDomain) && (
                <div className="ml-4 truncate text-xs text-gray-500">
                  {domainLine(g.aggregateByDomain)}
                </div>
              )}
              {/* 内訳: 家本体 + メンバー (家グループのみ) */}
              {isHouse &&
                g.segments.map((s, si) => (
                  <div
                    key={`${s.holder.kind}:${s.holder.id}`}
                    className="ml-4 flex items-center gap-1.5 text-xs"
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: influenceSegmentColor(gi, si) }}
                    />
                    <span className="min-w-0 truncate text-gray-300">
                      {s.holder.kind === 'house' ? (
                        <span className="text-gray-400">
                          {t('detail.polity.influence_house_self')}
                        </span>
                      ) : (
                        <PersonLink
                          personId={s.holder.id}
                          persons={persons}
                          onClick={onPersonClick}
                        />
                      )}
                    </span>
                    <span className="ml-auto shrink-0 text-gray-400">{s.percent.toFixed(1)}%</span>
                  </div>
                ))}
            </div>
          )
        })}
        {grouped.othersPercent > 0.5 && (
          <div className="flex items-center gap-1.5 text-gray-500">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: INFLUENCE_OTHERS_COLOR }}
            />
            <span>{t('detail.polity.influence_others')}</span>
            <span className="ml-auto shrink-0">{grouped.othersPercent.toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function ShareholderSection({
  shareholders,
  persons,
  onPersonClick,
}: {
  // v0.42c: house share holder は Person のみ
  shareholders: Array<{ holderPersonId: import('@/sim/types/ids').PersonId; percent: number }>
  persons: Record<string, Person>
  onPersonClick: ClickHandler
}) {
  const { t } = useTranslation()
  if (shareholders.length === 0) return <span className="text-gray-500">—</span>
  const othersPercent = Math.max(0, 100 - shareholders.reduce((s, h) => s + h.percent, 0))
  const slices = shareholders.map((h, i) => ({
    percent: h.percent,
    color: SHARE_COLORS[i % SHARE_COLORS.length]!,
  }))
  if (othersPercent > 0.5) {
    slices.push({ percent: othersPercent, color: SHARE_COLORS[SHARE_COLORS.length - 1]! })
  }
  return (
    <div className="flex items-start gap-3">
      <ShareDonutChart slices={slices} />
      <div className="min-w-0 flex-1 text-sm">
        {shareholders.map((h, i) => (
          <div key={h.holderPersonId} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length] }}
            />
            <span className="min-w-0 truncate">
              <PersonLink personId={h.holderPersonId} persons={persons} onClick={onPersonClick} />
            </span>
            <span className="ml-auto shrink-0 text-gray-200">{h.percent.toFixed(1)}%</span>
          </div>
        ))}
        {othersPercent > 0.5 && (
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: SHARE_COLORS[SHARE_COLORS.length - 1] }}
            />
            <span className="text-gray-400">{t('detail.polity.others')}</span>
            <span className="ml-auto shrink-0 text-gray-200">{othersPercent.toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  )
}
