import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { FactionId, PersonId } from '../types/ids'
import { isLifeStageAtLeast, isLivingPerson } from '../types/person'
import { getFactionActiveMemberIds } from './factionSelectors'
import type { EntityRef, Aim, DecisionSubjectRef } from '../types/goal'
import type { Project, ProjectKind } from '../types/project'
import type { AppliedRoleKey } from './abilitySelectors'
import { getRoleScore } from './abilitySelectors'
import { getPolityLeader } from './officeSelectors'
import { getHouseDecisionMaker } from './officeSelectors'
import { getPolityPersonIds } from './polityRelations'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'
import { isRoleEligibleBySex } from './roleEligibilitySelectors'

// 関連エンティティ「索引」(byTarget) 用の per-kind ref 列挙。表示用の describeProject() と
// 種別 switch が似るが意味は意図的に別物なので統合しないこと:
//   - personal_training は person を索引から除外 (byOwner/byCreator/bySupervisor で引けるため)
//     が、describeProject は trainee を表示フィールドとして含める。
//   - commission_chronicle は subjectRef をパネル非対応 kind でも索引に載せるが、describeProject は
//     PANEL_ENTITY_KINDS でフィルタする。
// どちらかを他方から導出すると索引が壊れる。両方を更新する際は両関数を見ること。
export function getProjectRelatedRefs(project: Project): EntityRef[] {
  switch (project.kind) {
    case 'develop_holding':
      return [{ kind: 'holding', id: project.holdingId }]

    case 'acquire_political_right':
      return [
        { kind: 'polity', id: project.polityId },
        ...(project.target.kind === 'holding_office_role'
          ? [{ kind: 'holding' as const, id: project.target.holdingId }]
          : []),
      ]

    case 'promote_policy_shift':
      return [
        { kind: 'polity', id: project.polityId },
        { kind: 'house', id: project.houseId },
      ]

    case 'patronize_artist':
      return [
        { kind: 'house', id: project.houseId },
        ...(project.artistPersonId
          ? [{ kind: 'person' as const, id: project.artistPersonId }]
          : []),
      ]

    case 'commission_chronicle':
      return [
        { kind: 'house', id: project.houseId },
        ...(project.subjectRef ? [project.subjectRef] : []),
      ]

    case 'acquire_land':
    case 'sell_land':
      return [
        ...(project.holdingId ? [{ kind: 'holding' as const, id: project.holdingId }] : []),
        ...(project.provinceId ? [{ kind: 'province' as const, id: project.provinceId }] : []),
        ...(project.counterpartyPolityId
          ? [{ kind: 'polity' as const, id: project.counterpartyPolityId }]
          : []),
      ]

    case 'improve_contract_terms':
    case 'demand_tax_increase':
      return [
        ...(project.holdingId ? [{ kind: 'holding' as const, id: project.holdingId }] : []),
        ...(project.counterpartyPolityId
          ? [{ kind: 'polity' as const, id: project.counterpartyPolityId }]
          : []),
      ]

    case 'respond_to_pressure':
      return []

    // v0.44: 本人完結のため related entity index には載せない (person は byOwner/byCreator/
    // bySupervisor で引ける)
    case 'personal_training':
      return []

    // 影響力個人中心化 Phase 1b: 運動。対象 polity と推薦個人を related に載せる
    case 'movement_campaign':
      return [
        { kind: 'polity', id: project.targetPolityId },
        { kind: 'person', id: project.sponsoredPersonId },
      ]

    // v0.47 称号・分封・領邦再編
    case 'request_rank_promotion':
      return [{ kind: 'polity', id: project.polityId }]

    case 'request_land_grant':
      return [
        { kind: 'polity', id: project.donorPolityId },
        { kind: 'holding', id: project.targetHoldingId },
      ]

    case 'request_cadet_branch_title_transfer':
      return [
        { kind: 'polity', id: project.targetPolityId },
        { kind: 'house', id: project.parentHouseId },
      ]

    case 'republic_house_foundation':
      return [{ kind: 'polity', id: project.commonwealthPolityId }]

    case 'consolidate_internal_contracts':
      return [
        { kind: 'house', id: project.houseId },
        { kind: 'polity', id: project.sinkPolityId },
      ]

    // v0.51 陰謀リファイン: 対象 polity と rival (家/人物) を related に載せる
    case 'undermine_influence':
      return [
        { kind: 'polity', id: project.polityId },
        project.target.kind === 'house'
          ? { kind: 'house', id: project.target.id }
          : { kind: 'person', id: project.target.id },
      ]

    // v0.51 陰謀リファイン: 対象 polity と (holding_office_role なら) 対象 holding を related に
    case 'revoke_political_right':
      return [
        { kind: 'polity', id: project.polityId },
        ...(project.target.kind === 'holding_office_role'
          ? [{ kind: 'holding' as const, id: project.target.holdingId }]
          : []),
      ]

    // v0.51 陰謀リファイン: 対象分家を related に
    case 'replace_house_leader':
      return [{ kind: 'house', id: project.targetHouseId }]

    // v0.48 Crisis: 被災 holding を related に載せる (dedup の hasActiveDev 相当 + HoldingDetail 索引)
    case 'handle_crisis':
      return [{ kind: 'holding', id: project.holdingId }]
  }
}

// ---------------------------------------------------------------------------
// describeProject: UI 表示用に Project 種別ごとの「主対象 + 付随情報」を純粋データ
// として返す (app 層がラベル/リンクに描画)。i18n キーや ReactNode は返さない。
// enum の enumNs は意味ドメイン名 (UI キーパスではない) で、app 側が実キーに解決する。
// ---------------------------------------------------------------------------

type ProjectFieldRole =
  | 'targetHolding'
  | 'targetProvince'
  | 'targetPolity'
  | 'targetHouse'
  | 'targetPerson'
  | 'counterpartyPolity'
  | 'rival'
  | 'donorPolity'
  | 'sinkPolity'
  | 'petitioner'
  | 'sponsoredPerson'
  | 'approver'
  | 'artist'
  | 'subject'
  | 'parentHouse'
  | 'improvementKind'
  | 'targetLevel'
  | 'newRank'
  | 'trainingAbility'
  | 'desiredTaxRate'
  | 'stance'
  | 'rightTarget'
  | 'preparation'
  | 'leverage'
  | 'commitment'

export type ProjectInfoField =
  | { kind: 'entity'; role: ProjectFieldRole; ref: EntityRef }
  | { kind: 'enum'; role: ProjectFieldRole; enumNs: string; value: string }
  | { kind: 'number'; role: ProjectFieldRole; value: number }

type ProjectBudgetInfo = {
  required?: number
  allocated?: number
  remaining?: number
  spent: number
}

export type ProjectDescriptor = {
  // カードに出す最重要 1 件 (fields に必ず含まれる)
  primary?: ProjectInfoField
  // 詳細パネルに出す全件 (primary を含む)
  fields: ProjectInfoField[]
  // 予算を持つ種別のみ
  budget?: ProjectBudgetInfo
}

// パネルを持つ EntityRef.kind (app 側でリンク化できるもの)。これ以外は enum/number で表現する。
// app 側 (ProjectCard.panelTypeOf) もこの集合を import して使う — リンク可能 kind の単一情報源。
export const PANEL_ENTITY_KINDS: ReadonlySet<EntityRef['kind']> = new Set([
  'polity',
  'house',
  'person',
  'holding',
  'province',
])

function ent(role: ProjectFieldRole, ref: EntityRef): ProjectInfoField {
  return { kind: 'entity', role, ref }
}

// fields[0] は noUncheckedIndexedAccess で undefined を含むため、exactOptionalPropertyTypes
// 下では optional primary に直接代入できない。空配列なら primary 省略でラップする。
function descriptor(fields: ProjectInfoField[], budget?: ProjectBudgetInfo): ProjectDescriptor {
  const d: ProjectDescriptor = { fields }
  if (fields[0]) d.primary = fields[0]
  if (budget) d.budget = budget
  return d
}

// UI「表示」用の per-kind 記述子。索引用の getProjectRelatedRefs() とは意図的に意味が異なる
// (上記コメント参照)。表示フィールドのみを扱い、パネルを持たない EntityRef は enum/number で表す。
export function describeProject(project: Project): ProjectDescriptor {
  switch (project.kind) {
    case 'develop_holding': {
      const fields: ProjectInfoField[] = [
        ent('targetHolding', { kind: 'holding', id: project.holdingId }),
        {
          kind: 'enum',
          role: 'improvementKind',
          enumNs: 'holdingImprovement',
          value: project.improvementKind,
        },
        { kind: 'number', role: 'targetLevel', value: project.targetImprovementLevel },
      ]
      return descriptor(fields, {
        required: project.budget.required,
        allocated: project.budget.allocated,
        remaining: project.budget.remaining,
        spent: project.budget.spent,
      })
    }

    case 'promote_policy_shift': {
      // policyKey は型上 optional だが現状どの生成経路も設定しないため表示フィールド化しない
      // (設定するロジックを足すときに enum フィールド + i18n value キーを併せて追加すること)。
      const fields: ProjectInfoField[] = [
        ent('targetPolity', { kind: 'polity', id: project.polityId }),
        ent('targetHouse', { kind: 'house', id: project.houseId }),
      ]
      return descriptor(fields)
    }

    case 'acquire_political_right': {
      const fields: ProjectInfoField[] = [
        ent('targetPolity', { kind: 'polity', id: project.polityId }),
        {
          kind: 'enum',
          role: 'rightTarget',
          enumNs: 'politicalRightTarget',
          value: project.target.kind,
        },
        ...(project.target.kind === 'holding_office_role'
          ? [ent('targetHolding', { kind: 'holding' as const, id: project.target.holdingId })]
          : []),
      ]
      return descriptor(fields, { required: project.budget, spent: project.spentBudget })
    }

    case 'patronize_artist': {
      const fields: ProjectInfoField[] = [
        ...(project.artistPersonId
          ? [ent('artist', { kind: 'person' as const, id: project.artistPersonId })]
          : []),
        ent('targetHouse', { kind: 'house', id: project.houseId }),
      ]
      return descriptor(fields, { required: project.budget, spent: project.spentBudget })
    }

    case 'commission_chronicle': {
      const subjectField =
        project.subjectRef && PANEL_ENTITY_KINDS.has(project.subjectRef.kind)
          ? ent('subject', project.subjectRef)
          : undefined
      const fields: ProjectInfoField[] = [
        ...(subjectField ? [subjectField] : []),
        ent('targetHouse', { kind: 'house', id: project.houseId }),
      ]
      return descriptor(fields, { required: project.budget, spent: project.spentBudget })
    }

    case 'acquire_land':
    case 'sell_land': {
      const fields: ProjectInfoField[] = [
        ...(project.holdingId
          ? [ent('targetHolding', { kind: 'holding' as const, id: project.holdingId })]
          : []),
        ...(project.provinceId
          ? [ent('targetProvince', { kind: 'province' as const, id: project.provinceId })]
          : []),
        ...(project.counterpartyPolityId
          ? [
              ent('counterpartyPolity', {
                kind: 'polity' as const,
                id: project.counterpartyPolityId,
              }),
            ]
          : []),
        { kind: 'number', role: 'preparation', value: project.preparation },
        { kind: 'number', role: 'leverage', value: project.leverage },
        { kind: 'number', role: 'commitment', value: project.commitment },
      ]
      return descriptor(fields)
    }

    case 'improve_contract_terms':
    case 'demand_tax_increase': {
      const fields: ProjectInfoField[] = [
        ...(project.holdingId
          ? [ent('targetHolding', { kind: 'holding' as const, id: project.holdingId })]
          : []),
        ...(project.counterpartyPolityId
          ? [
              ent('counterpartyPolity', {
                kind: 'polity' as const,
                id: project.counterpartyPolityId,
              }),
            ]
          : []),
        ...(project.desiredTaxRateToGrantor !== undefined
          ? [
              {
                kind: 'number' as const,
                role: 'desiredTaxRate' as const,
                value: project.desiredTaxRateToGrantor,
              },
            ]
          : []),
        { kind: 'number', role: 'preparation', value: project.preparation },
        { kind: 'number', role: 'leverage', value: project.leverage },
        { kind: 'number', role: 'commitment', value: project.commitment },
      ]
      return descriptor(fields)
    }

    case 'respond_to_pressure': {
      const fields: ProjectInfoField[] = project.stance
        ? [{ kind: 'enum', role: 'stance', enumNs: 'pressureStance', value: project.stance }]
        : []
      return descriptor(fields)
    }

    case 'personal_training': {
      const fields: ProjectInfoField[] = [
        ent('targetPerson', { kind: 'person', id: project.traineePersonId }),
        {
          kind: 'enum',
          role: 'trainingAbility',
          enumNs: 'ability',
          value: project.trainingAbilityKey,
        },
      ]
      return descriptor(fields)
    }

    case 'movement_campaign': {
      const fields: ProjectInfoField[] = [
        ent('targetPolity', { kind: 'polity', id: project.targetPolityId }),
        ent('sponsoredPerson', { kind: 'person', id: project.sponsoredPersonId }),
      ]
      return descriptor(fields, { required: project.budget, spent: project.spentBudget })
    }

    case 'request_rank_promotion': {
      const fields: ProjectInfoField[] = [
        ent('targetPolity', { kind: 'polity', id: project.polityId }),
        { kind: 'number', role: 'newRank', value: project.newRank },
        ...(project.approverPersonId
          ? [ent('approver', { kind: 'person' as const, id: project.approverPersonId })]
          : []),
      ]
      return descriptor(fields)
    }

    case 'request_land_grant': {
      const fields: ProjectInfoField[] = [
        ent('targetHolding', { kind: 'holding', id: project.targetHoldingId }),
        ent('donorPolity', { kind: 'polity', id: project.donorPolityId }),
        ent('petitioner', { kind: 'person', id: project.petitionerPersonId }),
        ...(project.parentHouseId
          ? [ent('parentHouse', { kind: 'house' as const, id: project.parentHouseId })]
          : []),
        ...(project.approverPersonId
          ? [ent('approver', { kind: 'person' as const, id: project.approverPersonId })]
          : []),
      ]
      return descriptor(fields)
    }

    case 'request_cadet_branch_title_transfer': {
      const fields: ProjectInfoField[] = [
        ent('targetPolity', { kind: 'polity', id: project.targetPolityId }),
        ent('parentHouse', { kind: 'house', id: project.parentHouseId }),
        ent('petitioner', { kind: 'person', id: project.petitionerPersonId }),
      ]
      return descriptor(fields)
    }

    case 'republic_house_foundation': {
      const fields: ProjectInfoField[] = [
        ent('targetPolity', { kind: 'polity', id: project.commonwealthPolityId }),
        ent('petitioner', { kind: 'person', id: project.petitionerPersonId }),
      ]
      return descriptor(fields)
    }

    case 'consolidate_internal_contracts': {
      const fields: ProjectInfoField[] = [
        ent('targetHouse', { kind: 'house', id: project.houseId }),
        ent('sinkPolity', { kind: 'polity', id: project.sinkPolityId }),
      ]
      return descriptor(fields)
    }

    case 'undermine_influence': {
      const rivalRef: EntityRef =
        project.target.kind === 'house'
          ? { kind: 'house', id: project.target.id }
          : { kind: 'person', id: project.target.id }
      const fields: ProjectInfoField[] = [
        ent('rival', rivalRef),
        ent('targetPolity', { kind: 'polity', id: project.polityId }),
      ]
      return descriptor(fields)
    }

    case 'revoke_political_right': {
      const fields: ProjectInfoField[] = [
        ent('targetPolity', { kind: 'polity', id: project.polityId }),
        {
          kind: 'enum',
          role: 'rightTarget',
          enumNs: 'politicalRightTarget',
          value: project.target.kind,
        },
        ...(project.target.kind === 'holding_office_role'
          ? [ent('targetHolding', { kind: 'holding' as const, id: project.target.holdingId })]
          : []),
      ]
      return descriptor(fields)
    }

    case 'replace_house_leader': {
      const fields: ProjectInfoField[] = [
        ent('targetHouse', { kind: 'house', id: project.targetHouseId }),
      ]
      return descriptor(fields)
    }

    // v0.48 Crisis: 被災 holding と予算を表示 (kind/severity は Crisis entity 側で HoldingDetail が表示)
    case 'handle_crisis': {
      const fields: ProjectInfoField[] = [
        ent('targetHolding', { kind: 'holding', id: project.holdingId }),
      ]
      return descriptor(fields, {
        required: project.budget.required,
        allocated: project.budget.allocated,
        remaining: project.budget.remaining,
        spent: project.budget.spent,
      })
    }

    default: {
      const _exhaustive: never = project
      return _exhaustive
    }
  }
}

export const PROJECT_KIND_ROLE_MAP: Record<ProjectKind, AppliedRoleKey> = {
  develop_holding: 'stewardship',
  acquire_political_right: 'diplomacy',
  promote_policy_shift: 'diplomacy',
  patronize_artist: 'diplomacy',
  commission_chronicle: 'governance',
  acquire_land: 'warCommand',
  sell_land: 'stewardship',
  improve_contract_terms: 'stewardship',
  demand_tax_increase: 'stewardship',
  respond_to_pressure: 'diplomacy',
  // v0.44: nominal — personal_training は supervisor 選定を通らず (本人固定 §6.4)、
  // 経験 weight も getProjectExperienceWeights が trainingAbilityKey 単独に分岐する (§3.1)
  personal_training: 'governance',
  // 影響力個人中心化 Phase 1b: 運動 = 政治的キャンペーン (charisma/diplomacy)
  movement_campaign: 'diplomacy',
  // v0.47 称号・分封・領邦再編: petition は外交、集約・共和国 House 創設は統治系
  request_rank_promotion: 'diplomacy',
  request_land_grant: 'diplomacy',
  request_cadet_branch_title_transfer: 'diplomacy',
  republic_house_foundation: 'governance',
  consolidate_internal_contracts: 'stewardship',
  // v0.51 陰謀リファイン: 策謀は intrigue
  undermine_influence: 'intrigue',
  revoke_political_right: 'intrigue',
  replace_house_leader: 'intrigue',
  // v0.48 Crisis: 災害対処は統治実務 (develop_holding と同じ stewardship)
  handle_crisis: 'stewardship',
}

export function getPersonProjectWorkload(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): number {
  const pKey = personId as string
  const taskIds = state.taskIndex.byAssignee[pKey] ?? []
  let activeTasks = 0
  for (const tid of taskIds) {
    const t = state.tasks[tid]
    if (t && t.status === 'active') activeTasks++
  }

  const supervisedIds = state.projectIndex.bySupervisorPerson[pKey] ?? []
  let activeProjects = 0
  for (const pid of supervisedIds) {
    const p = state.projects[pid]
    if (p && p.status === 'active') activeProjects++
  }

  const officeIds = state.officeIndex.byHolderPerson[pKey] ?? []
  let activeOffices = 0
  for (const oaId of officeIds) {
    const oa = state.officeAssignments[oaId]
    if (oa && oa.active) activeOffices++
  }

  return (
    activeTasks * config.activeTaskWorkloadWeight +
    activeProjects * config.supervisedProjectWorkloadWeight +
    activeOffices * config.officeWorkloadWeight
  )
}

function getCandidatePersonIds(state: WorldState, owner: DecisionSubjectRef): PersonId[] {
  if (owner.kind === 'polity') {
    return getPolityPersonIds(state, owner.id)
  }
  if (owner.kind === 'house') {
    const house = state.houses[owner.id]
    if (!house || !house.active) return []
    return [...house.memberIds]
  }
  return [owner.id]
}

// supervisor 候補の母集合。creator 用 (getCandidatePersonIds) との違いは、owner の
// 宮廷に出入りする派閥のメンバー (客分・食客) まで含めること。派閥が介入できるのは
// anchor Polity のみ (§12.4) なので、無関係な国の派閥メンバーは届かない:
// - polity: owner polity に anchor された active 派閥のメンバー
// - house: 家の生存メンバーが率いる active 派閥のメンバー (家の食客)
// Project の発案 (creator) は組織内部の人間に限り、派閥は実務の担い手としてのみ参加する。
function getSupervisorCandidatePersonIds(state: WorldState, owner: DecisionSubjectRef): PersonId[] {
  const base = getCandidatePersonIds(state, owner)
  const seen = new Set<string>(base as string[])
  const extra: PersonId[] = []

  function addFactionMembers(factionId: FactionId): void {
    const faction = state.factions[factionId]
    if (!faction || !faction.active) return
    for (const pid of getFactionActiveMemberIds(state, factionId)) {
      if (!seen.has(pid)) {
        seen.add(pid)
        extra.push(pid)
      }
    }
  }

  if (owner.kind === 'polity') {
    const factionIds = [...(state.factionIndex.byPolity[owner.id] ?? [])].sort()
    for (const fid of factionIds) addFactionMembers(fid)
  } else if (owner.kind === 'house') {
    const house = state.houses[owner.id]
    if (house && house.active) {
      const factionIds: FactionId[] = []
      for (const mid of house.memberIds) {
        if (!isLivingPerson(state.persons[mid])) continue
        factionIds.push(...(state.factionIndex.byLeader[mid] ?? []))
      }
      for (const fid of factionIds.sort()) addFactionMembers(fid)
    }
  }

  return [...base, ...extra]
}

function isEligibleCandidate(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  if (!person.alive) return false
  if (person.kind === 'placeholder') return false
  if (!isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) return false
  return true
}

export function selectProjectCreator(
  state: WorldState,
  config: SimulationConfig,
  aim: Aim,
): PersonId | undefined {
  const candidates = getCandidatePersonIds(state, aim.owner)
  const roleKey = getProjectRoleForAim(aim)

  let bestId: PersonId | undefined
  let bestScore = -Infinity

  for (const pid of candidates) {
    if (!isEligibleCandidate(state, pid)) continue

    const abilityScore = getRoleScore(state, pid, roleKey) / 10
    const workload = getPersonProjectWorkload(state, config, pid)
    const workloadPenalty = workload * 0.5

    let leaderBonus = 0
    if (aim.owner.kind === 'polity') {
      const leaderId = getPolityLeader(state, aim.owner.id)
      if (leaderId && (leaderId as string) === (pid as string)) leaderBonus = 3
    } else if (aim.owner.kind === 'house') {
      // 影響力個人中心化 Phase 3a: 家の執行主体は意志決定者 (支配 share 保有者) に
      const leaderId = getHouseDecisionMaker(state, aim.owner.id)
      if (leaderId && (leaderId as string) === (pid as string)) leaderBonus = 3
    }

    let officeBonus = 0
    const officeIds = state.officeIndex.byHolderPerson[pid as string] ?? []
    for (const oaId of officeIds) {
      const oa = state.officeAssignments[oaId]
      if (!oa || !oa.active) continue
      if (
        oa.organization.kind === aim.owner.kind &&
        (oa.organization.id as string) === (aim.owner.id as string)
      ) {
        officeBonus = 2
        break
      }
    }

    const score = abilityScore + leaderBonus + officeBonus - workloadPenalty

    if (score > bestScore) {
      bestScore = score
      bestId = pid
    }
  }

  return bestId
}

function getProjectRoleForAim(aim: Aim): AppliedRoleKey {
  switch (aim.kind) {
    case 'develop_owned_holding':
      return 'stewardship'
    case 'consolidate_province_holdings':
    case 'seize_weak_remote_holdings':
      return 'warCommand'
    case 'improve_owned_contract_terms':
    case 'demand_tax_increase_from_vassal':
    case 'eliminate_overlord_contract':
    case 'eliminate_vassal_contract':
      return 'stewardship'
    case 'acquire_political_right':
    case 'steer_polity_external_expansion':
    case 'steer_polity_internal_development':
      return 'diplomacy'
    case 'patronize_artist':
    case 'commission_chronicle':
      return 'diplomacy'
    default:
      return 'governance'
  }
}

export function selectProjectSupervisor(
  state: WorldState,
  config: SimulationConfig,
  owner: DecisionSubjectRef,
  projectKind: ProjectKind,
  creatorPersonId: PersonId,
): PersonId | undefined {
  const candidates = getSupervisorCandidatePersonIds(state, owner)
  const roleKey = PROJECT_KIND_ROLE_MAP[projectKind]

  const creator = state.persons[creatorPersonId]

  // v0.45.3 性別役職適格ゲート: gated で候補ゼロの場合のみ ungated 再試行。
  // 現職 house/polity leader は isRoleEligibleBySex 側で常に免除 (女当主・女王は監督可)。
  const pick = (gate: boolean): PersonId | undefined => {
    let bestId: PersonId | undefined
    let bestScore = -Infinity

    for (const pid of candidates) {
      if (!isEligibleCandidate(state, pid)) continue
      if ((pid as string) === (creatorPersonId as string)) continue
      if (gate && !isRoleEligibleBySex(state, config, pid)) continue

      const abilityScore = getRoleScore(state, pid, roleKey) / 10
      const workload = getPersonProjectWorkload(state, config, pid)
      const workloadPenalty = workload * 0.5

      let officeBonus = 0
      const officeIds = state.officeIndex.byHolderPerson[pid as string] ?? []
      for (const oaId of officeIds) {
        const oa = state.officeAssignments[oaId]
        if (!oa || !oa.active) continue
        if (
          oa.organization.kind === owner.kind &&
          (oa.organization.id as string) === (owner.id as string)
        ) {
          officeBonus = 2
          break
        }
      }

      let creatorBias = 0
      if (creator) {
        const att = getAttitudeOrDefault(state, creator, { kind: 'person', id: pid })
        creatorBias = (att.affection * 0.6 + att.respect * 0.4) / 100
      }

      let leaderBonus = 0
      if (owner.kind === 'polity') {
        const leaderId = getPolityLeader(state, owner.id)
        if (leaderId && (leaderId as string) === (pid as string)) leaderBonus = 1
      } else if (owner.kind === 'house') {
        // 影響力個人中心化 Phase 3a: 家の執行主体は意志決定者 (支配 share 保有者) に
        const leaderId = getHouseDecisionMaker(state, owner.id)
        if (leaderId && (leaderId as string) === (pid as string)) leaderBonus = 1
      }

      const score = abilityScore + officeBonus + creatorBias + leaderBonus - workloadPenalty

      if (score > bestScore) {
        bestScore = score
        bestId = pid
      }
    }

    return bestId
  }

  const gated = pick(true)
  if (gated) return gated
  return config.allowFemaleRolesWhenNoMaleCandidate ? pick(false) : undefined
}
