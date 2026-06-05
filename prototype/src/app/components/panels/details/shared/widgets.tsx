import type { ChronicleEntry, ChronicleCategory } from '@sim/types/chronicle'
import { useRenderEvent } from '@/app/hooks/useRenderEvent'
import { useTranslation } from 'react-i18next'
import { getImportanceColor } from './helpers'
import type { ClickHandler } from './helpers'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Project } from '@/sim/types/project'
import type { Person } from '@/sim/types/person'
import { PersonLink, HouseLink } from './links'
import type { House } from '@/sim/types/house'
import { ShareDonutChart } from './charts'
import { SHARE_COLORS } from './constants'
import type { AttitudeMap } from '@/sim/types/attitude'
import type { WorldState } from '@/sim/types/world'
import { useEntityName } from '@/app/hooks/useEntityName'
import {
  getPolityShortName,
  getHoldingQualifiedName,
  getHoldingShortName,
} from '@/app/hooks/entityNameHelpers'
import { useSimulationStore, type EntityType } from '@/app/stores/simulationStore'
import type {
  PolityId,
  HouseId,
  PersonId,
  LandContractId,
  HoldingId,
  ProvinceId,
} from '@/sim/types/ids'
import type { Polity } from '@/sim/types/polity'
import { getHoldingLandContractChain } from '@sim/selectors/landContractSelectors'
import { getProvincePolityControlFromHoldings } from '@/sim/selectors/landContractSelectors'
import { getProvinceProduction } from '@sim/selectors/popEconomySelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { getRegimentsForActor } from '@sim/selectors/regimentSelectors'
import {
  getRightsByHolder,
  getHoldingOfficeAppointmentRight,
  getRegimentControllerRight,
} from '@sim/selectors/politicalRightSelectors'
import { getHoldingBailiffPerson } from '@sim/selectors/provinceOfficeSelectors'
import type { PoliticalRight, PoliticalRightTargetRef } from '@sim/types/politicalRight'
import type { ResolveName } from '@/app/hooks/entityNameHelpers'
import type { TFunction } from 'i18next'

// Detail パネル共通のヘッダー行。タイトル (text-lg font-bold) と、任意の badge
// (タイトル右隣) / actions (右端、CopyJsonButton や WatchButton 等) を配置する。
// title 直接 span だったパネルも gap-2 ラッパ・gap-1.5 ラッパで囲うが、単一子では
// 視覚的に従来と同一。
export function PanelHeader({
  title,
  badge,
  actions,
}: {
  title: ReactNode
  badge?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold">{title}</span>
        {badge}
      </div>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  )
}

// 単一 ChronicleEntry の表示行 (category badge + [year/Wweek] + 翻訳済みテキスト)。
//   EntityChronicleSection (直近 N 件) と FullChroniclePanel (全件) で共有する。
export function ChronicleEntryLine({ entry }: { entry: ChronicleEntry }) {
  const renderEvent = useRenderEvent()
  const { t } = useTranslation()
  return (
    <div className={`text-xs ${getImportanceColor(entry.importance)}`}>
      <span className="mr-1 rounded bg-gray-700 px-1 text-[10px] text-gray-400">
        {t(`chronicle.category.${entry.category}`)}
      </span>
      [{entry.year}/W{entry.weekOfYear}]{' '}
      {renderEvent({ messageKey: entry.templateKey, messageParams: entry.params })}
    </div>
  )
}

// v0.38 §8: 対象 entity の永続歴史 (ChronicleEntry) を時系列降順で表示する共通 section。
//   entries は selector 側で既に降順 sort 済み。category filter を後付けできるよう
//   showCategories prop を最初から受け取る (未指定なら全カテゴリ表示。§8.2)。
//   entityType/entityId を渡すと「完全版を見る」ボタンを出し、全履歴パネルを開ける。
export function EntityChronicleSection({
  title,
  entries,
  limit = 10,
  showCategories,
  entityType,
  entityId,
}: {
  title: string
  entries: ChronicleEntry[]
  limit?: number
  showCategories?: ReadonlySet<ChronicleCategory>
  entityType?: EntityType
  entityId?: string
}) {
  const { t } = useTranslation()
  const openChronicleWindow = useSimulationStore((s) => s.openChronicleWindow)
  const filtered = showCategories ? entries.filter((e) => showCategories.has(e.category)) : entries
  const visible = filtered.slice(0, limit)
  if (filtered.length === 0) return null
  return (
    <div className="mt-2">
      <div className="text-sm font-semibold text-gray-300">{title}:</div>
      {visible.map((e) => (
        <ChronicleEntryLine key={e.id} entry={e} />
      ))}
      {entityType && entityId && (
        <button
          className="mt-1 text-xs text-blue-400 hover:text-blue-300"
          onClick={() => openChronicleWindow(entityType, entityId)}
        >
          {t('detail.full_chronicle.open', { count: filtered.length })}
        </button>
      )}
    </div>
  )
}

export function WatchButton({
  isWatching,
  onToggle,
}: {
  isWatching: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      className={`rounded px-2 py-0.5 text-xs transition-colors ${
        isWatching
          ? 'bg-yellow-600 text-white hover:bg-yellow-500'
          : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
      }`}
      onClick={onToggle}
    >
      {isWatching ? `\u2605 ${t('buttons.watching')}` : `\u2606 ${t('buttons.watch')}`}
    </button>
  )
}

// v0.17.4 UI: \u8a73\u7d30\u30d1\u30cd\u30eb\u306e\u5185\u5bb9\u3092 JSON \u5f62\u5f0f\u3067\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u3078\u30b3\u30d4\u30fc\u3059\u308b\u30dc\u30bf\u30f3\u3002
// LLM \u3084\u5916\u90e8\u30c4\u30fc\u30eb\u306b\u300c\u753b\u9762\u3067\u898b\u3048\u3066\u3044\u308b\u4eba\u7269\u30fb\u56fd\u30fb\u5bb6\u30fb\u5dde\u30fbPOP\u300d\u3092\u69cb\u9020\u5316\u5171\u6709\u3059\u308b\u305f\u3081\u306e\u88dc\u52a9\u3002
export function CopyJsonButton({ payload }: { payload: unknown }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleClick = (): void => {
    const text = JSON.stringify(payload, null, 2)
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch((e: unknown) => {
        console.error('Failed to copy JSON to clipboard', e)
      })
  }
  return (
    <button
      className="rounded bg-gray-600 px-2 py-0.5 text-xs text-gray-300 transition-colors hover:bg-gray-500"
      onClick={handleClick}
      title="Copy this entity as JSON to clipboard"
    >
      {copied ? `\u2713 ${t('buttons.copied')}` : `\u29c9 ${t('buttons.copy_json')}`}
    </button>
  )
}

export function ProjectDetailCard({
  project,
  persons,
  onPersonClick,
  label,
}: {
  project: Project
  persons: Record<string, Person>
  onPersonClick: ClickHandler
  label: string
}) {
  const { t } = useTranslation()
  return (
    <div style={{ marginLeft: 8, marginTop: 4 }}>
      <strong>{label}</strong>
      <div style={{ marginLeft: 8 }}>
        <div>{t(`detail.project_kind.${project.kind}`)}</div>
        <div>
          {t('detail.play.project_stage')}: {t(`detail.play.stage_${project.currentStageKey}`)}
        </div>
        <div>
          {t('detail.polity.project_progress')}: {project.progress} / {project.targetProgress}
        </div>
        <div>
          {t('detail.polity.project_supervisor')}:{' '}
          <PersonLink
            personId={project.supervisorPersonId}
            persons={persons}
            onClick={onPersonClick}
          />
        </div>
        {project.deadlineWeek && (
          <div>
            {t('detail.polity.project_deadline')}: {t('detail.common.year')}{' '}
            {Math.ceil(project.deadlineWeek / 48)}
          </div>
        )}
      </div>
    </div>
  )
}

export function ProjectListItem({
  project,
  persons,
  onPersonClick,
  showSupervisor = true,
}: {
  project: Project
  persons: Record<string, Person>
  onPersonClick: ClickHandler
  showSupervisor?: boolean
}) {
  const { t } = useTranslation()
  return (
    <li className="mb-1 text-gray-400">
      <span className="text-gray-200">{t(`detail.project_kind.${project.kind}`)}</span> —{' '}
      {t(`detail.play.stage_${project.currentStageKey}`)} — {project.progress}/
      {project.targetProgress}
      {showSupervisor && (
        <>
          {' — '}
          <PersonLink
            personId={project.supervisorPersonId}
            persons={persons}
            onClick={onPersonClick}
          />
        </>
      )}
    </li>
  )
}

// v0.42 §16.1: Polity Influence breakdown の表示。上位 holder の percent + domain 内訳。
// entry.holder は ShareHolderRef と同形 ({ kind: 'house' | 'person', id })。
export function InfluenceSection({
  entries,
  persons,
  houses,
  onPersonClick,
  onHouseClick,
}: {
  entries: import('@sim/types/influence').PolityInfluenceEntry[]
  persons: Record<string, Person>
  houses: Record<string, House>
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation()
  if (entries.length === 0) return <span className="text-gray-500">—</span>
  const othersPercent = Math.max(0, 100 - entries.reduce((s, e) => s + e.percent, 0))
  const slices = entries.map((e, i) => ({
    percent: e.percent,
    color: SHARE_COLORS[i % SHARE_COLORS.length]!,
  }))
  if (othersPercent > 0.5) {
    slices.push({ percent: othersPercent, color: SHARE_COLORS[SHARE_COLORS.length - 1]! })
  }
  const domainLine = (e: import('@sim/types/influence').PolityInfluenceEntry): string => {
    const items = Object.entries(e.byDomain)
      .filter((kv): kv is [string, number] => typeof kv[1] === 'number' && kv[1] > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([domain, v]) => `${t(`detail.polity.influence_domain.${domain}`)} ${v.toFixed(0)}`)
    return items.join(' · ')
  }
  return (
    <div className="flex items-start gap-3">
      <ShareDonutChart slices={slices} />
      <div className="min-w-0 flex-1 text-sm">
        {entries.map((e, i) => (
          <div key={`${e.holder.kind}:${e.holder.id}`} className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length] }}
              />
              <span className="min-w-0 truncate">
                {e.holder.kind === 'house' ? (
                  <HouseLink houseId={e.holder.id} houses={houses} onClick={onHouseClick} />
                ) : (
                  <PersonLink personId={e.holder.id} persons={persons} onClick={onPersonClick} />
                )}
              </span>
              <span className="ml-auto shrink-0 text-gray-200">{e.percent.toFixed(1)}%</span>
            </div>
            <div className="ml-4 truncate text-xs text-gray-500">{domainLine(e)}</div>
          </div>
        ))}
        {othersPercent > 0.5 && (
          <div className="flex items-center gap-1.5 text-gray-500">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: SHARE_COLORS[SHARE_COLORS.length - 1] }}
            />
            <span>{t('detail.polity.influence_others')}</span>
            <span className="ml-auto shrink-0">{othersPercent.toFixed(1)}%</span>
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

export function AttitudeList({
  attitudes,
  worldState,
  onPolityClick,
  onHouseClick,
  onPersonClick,
}: {
  attitudes: AttitudeMap
  worldState: WorldState | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  if (!worldState) return null
  const entries = Object.entries(attitudes)
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(([key, attitude]) => {
        const colonIdx = key.indexOf(':')
        const prefix = key.slice(0, colonIdx)
        const id = key.slice(colonIdx + 1)

        let linkNode: React.ReactNode
        if (prefix === 'polity') {
          const p = worldState.polities[id as PolityId]
          const displayName = p ? getPolityShortName(worldState, resolveName, id as PolityId) : id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onPolityClick(id as PolityId, 'polity')}
            >
              {displayName}
            </button>
          )
        } else if (prefix === 'house') {
          const h = worldState.houses[id as HouseId]
          const displayName = h ? resolveName('house', h.nameKey, h.nameKey) : id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onHouseClick(id as HouseId, 'house')}
            >
              {displayName}
            </button>
          )
        } else if (prefix === 'person') {
          const p = worldState.persons[id as PersonId]
          const displayName = p ? resolveName('person', p.nameKey, p.nameKey) : id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onPersonClick(id)}
            >
              {displayName}
            </button>
          )
        } else {
          linkNode = <span className="text-gray-400">{id}</span>
        }

        const affColor =
          attitude.affection > 0
            ? 'text-green-400'
            : attitude.affection < 0
              ? 'text-red-400'
              : 'text-gray-400'
        const resColor =
          attitude.respect > 0
            ? 'text-green-400'
            : attitude.respect < 0
              ? 'text-red-400'
              : 'text-gray-400'

        return (
          <div key={key} className="rounded bg-gray-700 p-1 text-xs">
            <div className="font-medium text-gray-300">{linkNode}</div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t('detail.person.affection')}:</span>
              <span className={affColor}>{attitude.affection.toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t('detail.person.respect')}:</span>
              <span className={resColor}>{attitude.respect.toFixed(0)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PolityLandContracts({
  polity,
  worldState,
  persons,
  houses,
  onProvinceClick,
  onPersonClick,
  onHouseClick,
}: {
  polity: Polity
  worldState: WorldState | null
  persons: Record<string, Person>
  houses: Record<string, House>
  onProvinceClick: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  if (!worldState) return null
  const contractIds = worldState.landContractIndex.byGranteePolity[polity.id] ?? []
  if (contractIds.length === 0) return null

  type ContractInfo = {
    id: LandContractId
    holdingId: HoldingId | undefined
    holdingName: string
    taxRate: number
    isRoot: boolean
    isTerminal: boolean
    estimatedRevenue: number
    bailiffPersonId: PersonId | undefined
    appointmentRight: PoliticalRight | undefined
  }
  type ProvinceGroup = {
    provinceId: ProvinceId
    provinceName: string
    holdings: ContractInfo[]
    totalRevenue: number
  }

  const groupMap = new Map<string, ProvinceGroup>()

  for (const cid of contractIds) {
    const c = worldState.landContracts[cid]
    if (!c) continue
    const province = worldState.provinces[c.provinceId]
    const isRoot = c.parentContractId === undefined
    const isTerminal = worldState.landContractIndex.byParent[c.id] === undefined
    const holdingId = c.holdingId
    const holding = holdingId ? worldState.holdings[holdingId] : undefined

    let estimatedRevenue = 0
    if (province && holdingId) {
      const chain = getHoldingLandContractChain(worldState, holdingId)
      const idx = chain.findIndex((cc) => cc.id === c.id)
      if (idx >= 0) {
        const polityControl = getProvincePolityControlFromHoldings(worldState, c.provinceId)
        const grossTax =
          getProvinceProduction(worldState, defaultConfig, c.provinceId) * (polityControl / 100)
        let remaining = grossTax
        for (let i = chain.length - 1; i >= 0; i--) {
          const seg = chain[i]
          if (!seg) continue
          const rate = seg.terms.taxRateToGrantor
          const retained = remaining * (1 - rate)
          if (i === idx) {
            estimatedRevenue = Math.round(retained * 10) / 10
            break
          }
          remaining = remaining * rate
        }
      }
    }

    const key = c.provinceId as string
    let group = groupMap.get(key)
    if (!group) {
      group = {
        provinceId: c.provinceId,
        provinceName: province
          ? resolveName('province', province.nameKey, province.nameKey)
          : String(c.provinceId),
        holdings: [],
        totalRevenue: 0,
      }
      groupMap.set(key, group)
    }
    // 代官・任命権はこの Polity が terminal (実効支配) の Holding でのみ意味を持つ
    // (非 terminal 行の代官は下位 Polity に仕えるため表示しない)。
    const bailiff =
      isTerminal && holdingId ? getHoldingBailiffPerson(worldState, holdingId) : undefined
    group.holdings.push({
      id: c.id,
      holdingId,
      // Province 見出しの下に並ぶため短名で十分 (qualified 名は冗長)
      holdingName: holding ? getHoldingShortName(worldState, resolveName, holding.id) : '(unknown)',
      taxRate: c.terms.taxRateToGrantor,
      isRoot,
      isTerminal,
      estimatedRevenue,
      bailiffPersonId: bailiff && bailiff.kind !== 'placeholder' ? bailiff.id : undefined,
      appointmentRight:
        isTerminal && holdingId
          ? getHoldingOfficeAppointmentRight(worldState, holdingId)
          : undefined,
    })
    group.totalRevenue += estimatedRevenue
  }

  const groups = [...groupMap.values()].sort((a, b) => b.totalRevenue - a.totalRevenue)
  const totalContracts = groups.reduce((sum, g) => sum + g.holdings.length, 0)

  return (
    <div className="mt-1">
      <div className="text-sm font-semibold text-gray-300">
        {t('detail.polity.land_contracts')} ({totalContracts}):
      </div>
      <div className="max-h-64 overflow-y-auto text-sm">
        {groups.map((g) => (
          <div key={g.provinceId} className="mb-1">
            <div className="flex items-baseline gap-1">
              <button
                className="text-xs font-semibold text-blue-300 hover:underline"
                onClick={() => onProvinceClick(g.provinceId)}
              >
                {g.provinceName}
              </button>
              <span className="text-xs text-gray-500">({g.holdings.length})</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {g.holdings.map((c) => (
                <div key={c.id} className="rounded bg-gray-700/60 p-1.5 text-xs">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="min-w-0 truncate font-medium text-gray-300">
                      {c.holdingName}
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-500">
                      {c.isRoot && c.isTerminal
                        ? `${t('detail.province.root')}+${t('detail.province.term')}`
                        : c.isRoot
                          ? t('detail.province.root')
                          : c.isTerminal
                            ? t('detail.province.term')
                            : ''}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>{Math.round(c.taxRate * 100)}%</span>
                    <span className="text-amber-300">
                      {c.estimatedRevenue > 0 ? c.estimatedRevenue.toFixed(1) : '—'}
                    </span>
                  </div>
                  {c.bailiffPersonId !== undefined && (
                    <div className="mt-0.5 truncate text-[11px] text-gray-500">
                      {t('holding.bailiff', { ns: 'roles' })}:{' '}
                      <PersonLink
                        personId={c.bailiffPersonId}
                        persons={persons}
                        onClick={onPersonClick}
                      />
                    </div>
                  )}
                  <RightHolderLine
                    right={c.appointmentRight}
                    label={t('detail.polity.appointment_right')}
                    persons={persons}
                    houses={houses}
                    onPersonClick={onPersonClick}
                    onHouseClick={onHouseClick}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// v0.36 Regiment: Polity が保有する連隊一覧。観賞用スナップショットなので active のみ表示
//   (destroyed は再編成待ちの過渡状態・strength≈0、disbanded は恒久解散)。連隊詳細パネルは未実装。
// v0.42: カード化し、regiment_control right の保持者 (管理権) をカード内に表示。
export function PolityRegiments({
  polity,
  worldState,
  persons,
  houses,
  onPersonClick,
  onHouseClick,
}: {
  polity: Polity
  worldState: WorldState | null
  persons: Record<string, Person>
  houses: Record<string, House>
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  if (!worldState) return null
  const regiments = getRegimentsForActor(worldState, { kind: 'polity', id: polity.id }).filter(
    (r) => r.status === 'active',
  )
  if (regiments.length === 0) return null

  const rows = regiments
    .map((r) => {
      const province = r.homeProvinceId ? worldState.provinces[r.homeProvinceId] : undefined
      const provinceName = province
        ? resolveName('province', province.nameKey, province.nameKey)
        : String(r.homeProvinceId ?? r.id)
      return {
        id: r.id,
        name: `${provinceName} ${t('detail.polity.regiment_suffix')}`,
        organization: Math.round(r.organization),
        baselineOrganization: Math.round(r.baselineOrganization),
        morale: Math.round(r.morale),
        baselineMorale: Math.round(r.baselineMorale),
        strength: Math.round(r.strength),
        controlRight: getRegimentControllerRight(worldState, r.id),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mt-1">
      <div className="text-sm font-semibold text-gray-300">
        {t('detail.polity.regiments')} ({rows.length}):
        <span className="ml-2 text-xs font-normal text-gray-500">
          {t('detail.polity.reg_baseline_hint')}
        </span>
      </div>
      <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto text-xs">
        {rows.map((r) => (
          <div key={r.id} className="rounded bg-gray-700/60 p-1.5">
            <div className="truncate font-medium text-gray-300">{r.name}</div>
            <div className="flex justify-between text-gray-400">
              <span>{t('detail.polity.reg_organization')}:</span>
              <span className="text-gray-300">
                {r.organization}
                <span className="text-gray-500">/{r.baselineOrganization}</span>%
              </span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>{t('detail.polity.reg_morale')}:</span>
              <span className="text-gray-300">
                {r.morale}
                <span className="text-gray-500">/{r.baselineMorale}</span>
              </span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>{t('detail.polity.reg_strength')}:</span>
              <span className="text-gray-300">{r.strength}%</span>
            </div>
            <RightHolderLine
              right={r.controlRight}
              label={t('detail.polity.control_right')}
              persons={persons}
              houses={houses}
              onPersonClick={onPersonClick}
              onHouseClick={onHouseClick}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
