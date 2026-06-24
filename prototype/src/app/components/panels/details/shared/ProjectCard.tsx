import { useTranslation } from 'react-i18next'
import type { Project } from '@/sim/types/project'
import type { WorldState } from '@/sim/types/world'
import type { EntityRef, DecisionSubjectRef } from '@/sim/types/goal'
import { useSimulationStore, type EntityType } from '@/app/stores/simulationStore'
import {
  describeProject,
  PANEL_ENTITY_KINDS,
  type ProjectInfoField,
} from '@sim/selectors/projectSelectors'
import { useEntityName } from '@/app/hooks/useEntityName'
import {
  getPolityShortName,
  getHouseDisplayName,
  getHoldingShortName,
} from '@/app/hooks/entityNameHelpers'
import { formatPolityRank } from '@/app/utils/format'

// 詳細パネル間の汎用ナビゲーション (openDetailWindow と同形)。ClickHandler (person/house/polity
// のみ) では holding/province を扱えないため、Project 系では entityType を直接渡す。
export type NavigateHandler = (entityType: EntityType, id: string) => void

// EntityRef.kind のうちパネルを持つもの → EntityType。これ以外は describeProject が
// entity ではなく enum/number で返すため、ここに来ない。リンク可能 kind の集合は
// sim 側 PANEL_ENTITY_KINDS を単一情報源として共有する (5 kind はすべて EntityType の部分集合)。
// v0.61: owner/contributor/pressure source 等は DecisionSubjectRef (merchant_company を含む)。
//   EntityRefLink は両方を受ける。パネルを持たない kind は default でプレーンテキスト。
type LinkableRef = EntityRef | DecisionSubjectRef

function panelTypeOf(ref: LinkableRef): EntityType | undefined {
  return PANEL_ENTITY_KINDS.has(ref.kind as EntityRef['kind'])
    ? (ref.kind as EntityType)
    : undefined
}

function resolveEntityName(
  ref: LinkableRef,
  worldState: WorldState,
  resolveName: ReturnType<typeof useEntityName>,
): string {
  switch (ref.kind) {
    case 'polity':
      return getPolityShortName(worldState, resolveName, ref.id)
    case 'house': {
      const house = worldState.houses[ref.id]
      return getHouseDisplayName(resolveName, house, ref.id)
    }
    case 'person': {
      const person = worldState.persons[ref.id]
      return person ? resolveName('person', person.nameKey, person.nameKey) : ref.id
    }
    case 'holding':
      return getHoldingShortName(worldState, resolveName, ref.id)
    case 'province': {
      const province = worldState.provinces[ref.id]
      return province ? resolveName('province', province.nameKey, province.nameKey) : ref.id
    }
    case 'merchant_company': {
      const company = worldState.merchantCompanies[ref.id]
      return company ? resolveName('merchant_company', company.nameKey, company.nameKey) : ref.id
    }
    default:
      return ref.kind
  }
}

// entityType + id のリンクボタン (名前解決込み)。
function EntityLink({
  entityType,
  id,
  label,
  onNavigate,
}: {
  entityType: EntityType
  id: string
  label: string
  onNavigate: NavigateHandler
}) {
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onNavigate(entityType, id)}
    >
      {label}
    </button>
  )
}

// EntityRef を名前解決してリンク化する。パネルを持たない kind はプレーンテキスト。
export function EntityRefLink({
  entityRef,
  worldState,
  onNavigate,
}: {
  entityRef: LinkableRef
  worldState: WorldState
  onNavigate: NavigateHandler
}) {
  const resolveName = useEntityName()
  const type = panelTypeOf(entityRef)
  const label = resolveEntityName(entityRef, worldState, resolveName)
  // panelTypeOf が返す kind は全て id を持つが、TS は narrow しないため明示ガード。
  if (!type || !('id' in entityRef)) return <span className="text-gray-300">{label}</span>
  return <EntityLink entityType={type} id={entityRef.id} label={label} onNavigate={onNavigate} />
}

// ProjectInfoField の「値」部分のみを描画する (ラベルは ProjectFieldRow / カードが付ける)。
// entity → リンク、enum → namespace 別に i18n 解決、number → role 別に整形。
function ProjectFieldValue({
  field,
  worldState,
  onNavigate,
}: {
  field: ProjectInfoField
  worldState: WorldState
  onNavigate: NavigateHandler
}) {
  const { t } = useTranslation()

  if (field.kind === 'entity') {
    return <EntityRefLink entityRef={field.ref} worldState={worldState} onNavigate={onNavigate} />
  }

  if (field.kind === 'enum') {
    return <span className="text-gray-300">{resolveEnumLabel(field.enumNs, field.value, t)}</span>
  }

  // number
  return <span className="text-gray-300">{formatNumberField(field.role, field.value, t)}</span>
}

function resolveEnumLabel(
  enumNs: string,
  value: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (enumNs) {
    case 'holdingImprovement':
      return t(`detail.province.improvement_${value}`, { defaultValue: value })
    case 'ability':
      return t(`enum.ability.${value}`, { ns: 'events', defaultValue: value })
    case 'pressureStance':
      return t(`detail.play.stance_${value}`)
    case 'politicalRightTarget':
      return t(`detail.project.right_target.${value}`)
    default:
      return value
  }
}

function formatNumberField(
  role: ProjectInfoField['role'],
  value: number,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (role) {
    case 'newRank':
      return formatPolityRank(value)
    case 'desiredTaxRate':
      return `${Math.round(value * 100)}%`
    case 'targetLevel':
      return t('detail.province.improvement_level', { level: value })
    default:
      return String(Math.round(value))
  }
}

// 詳細パネル用のラベル付き 1 行 (ラベル: 値)。
export function ProjectFieldRow({
  field,
  worldState,
  onNavigate,
}: {
  field: ProjectInfoField
  worldState: WorldState
  onNavigate: NavigateHandler
}) {
  const { t } = useTranslation()
  return (
    <div className="flex gap-1">
      <span className="text-gray-400">{t(`detail.project.field.${field.role}`)}:</span>
      <ProjectFieldValue field={field} worldState={worldState} onNavigate={onNavigate} />
    </div>
  )
}

/**
 * 一覧用のプロジェクトカード (PersonCard と同じ角丸・グレー背景の 2 行カード)。
 * - 1 行目: 種別ラベル (クリックで Project 詳細を開く) + 主対象 (primary)
 * - 2 行目: ステージ + 進捗 + 監督者
 */
// オーナー種別 (国 / 家 / 個人) のバッジ配色。一覧で誰の事業かを一目で区別するため。
const OWNER_KIND_BADGE: Record<Project['owner']['kind'], string> = {
  polity: 'bg-sky-900 text-sky-200',
  house: 'bg-amber-900 text-amber-200',
  person: 'bg-emerald-900 text-emerald-200',
  merchant_company: 'bg-purple-900 text-purple-200',
}

export function ProjectCard({ project, worldState }: { project: Project; worldState: WorldState }) {
  const { t } = useTranslation()
  const onNavigate = useSimulationStore((s) => s.openDetailWindow)
  const descriptor = describeProject(project)
  const supervisor = worldState.persons[project.supervisorPersonId]

  return (
    <div className="rounded bg-gray-700/60 p-1">
      <div className="flex flex-wrap items-center gap-x-1 text-sm">
        <span
          className={`shrink-0 rounded px-1 text-[10px] ${OWNER_KIND_BADGE[project.owner.kind]}`}
        >
          {t(`entity.${project.owner.kind}`, { ns: 'entities' })}
        </span>
        <button
          className="font-medium text-blue-400 underline underline-offset-2 hover:text-blue-300"
          onClick={() => onNavigate('project', project.id)}
        >
          {t(`detail.project_kind.${project.kind}`)}
        </button>
        {descriptor.primary && (
          <span className="text-xs text-gray-400">
            ·{' '}
            <ProjectFieldValue
              field={descriptor.primary}
              worldState={worldState}
              onNavigate={onNavigate}
            />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-1 text-xs text-gray-400">
        <span>{t(`detail.play.stage_${project.currentStageKey}`)}</span>
        <span>
          · {Math.round(project.progress)}/{Math.round(project.targetProgress)}
        </span>
        {supervisor && (
          <span>
            ·{' '}
            <EntityRefLink
              entityRef={{ kind: 'person', id: project.supervisorPersonId }}
              worldState={worldState}
              onNavigate={onNavigate}
            />
          </span>
        )}
      </div>
    </div>
  )
}
