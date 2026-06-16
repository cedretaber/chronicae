import type {
  ProjectKind,
  ProjectStageKey,
  ProjectStageType,
  ProjectStageEntry,
} from '../types/project'
import type { Project } from '../types/project'

export const PROJECT_STAGE_SEQUENCES: Record<ProjectKind, readonly ProjectStageEntry[]> = {
  develop_holding: [
    { key: 'find_supervisor', type: 'immediate' },
    { key: 'secure_budget', type: 'immediate' },
    { key: 'execute_project', type: 'final' },
  ],

  promote_policy_shift: [{ key: 'execute_project', type: 'final' }],

  // v0.42 §13: 単一 final stage (cultural project と同型)
  acquire_political_right: [{ key: 'execute_project', type: 'final' }],

  patronize_artist: [{ key: 'arrange_patronage', type: 'final' }],

  commission_chronicle: [{ key: 'write_chronicle', type: 'final' }],

  acquire_land: [
    { key: 'prepare_claim', type: 'preparatory' },
    { key: 'open_diplomatic_play', type: 'immediate' },
    { key: 'negotiate', type: 'final' },
  ],
  sell_land: [
    { key: 'prepare_offer', type: 'preparatory' },
    { key: 'open_diplomatic_play', type: 'immediate' },
    { key: 'negotiate', type: 'final' },
  ],
  improve_contract_terms: [
    { key: 'prepare_argument', type: 'preparatory' },
    { key: 'open_diplomatic_play', type: 'immediate' },
    { key: 'negotiate', type: 'final' },
  ],
  demand_tax_increase: [
    { key: 'prepare_argument', type: 'preparatory' },
    { key: 'open_diplomatic_play', type: 'immediate' },
    { key: 'negotiate', type: 'final' },
  ],

  // v0.44 §6.5: 単一 final stage。汎用 advance_project task で進行する (§6.6)
  personal_training: [{ key: 'execute_project', type: 'final' }],

  // 影響力個人中心化 Phase 1b: 運動 = 単一 final stage (promote_policy_shift と同型)
  movement_campaign: [{ key: 'execute_project', type: 'final' }],

  respond_to_pressure: [
    { key: 'choose_stance', type: 'immediate' },
    { key: 'propose_initial_offer', type: 'immediate' },
    { key: 'prepare_response', type: 'preparatory' },
    { key: 'negotiate', type: 'final' },
  ],

  // v0.47 称号・分封・領邦再編 (spec §5.5 / §9.6 / §11.8 / §12.8 / §13.4)。
  // preparatory stage で progress 蓄積 → finalize_* immediate で resolveImmediateStage が
  // accept/reject 判定と成功 mutation を行う (§4.4)。budget stage は持たない (§4.3)。
  request_rank_promotion: [
    { key: 'prepare_petition', type: 'preparatory' },
    { key: 'build_case', type: 'preparatory' },
    { key: 'finalize_promotion', type: 'immediate' },
  ],
  request_land_grant: [
    { key: 'prepare_petition', type: 'preparatory' },
    { key: 'build_case', type: 'preparatory' },
    { key: 'finalize_land_grant', type: 'immediate' },
  ],
  request_cadet_branch_title_transfer: [
    { key: 'secure_family_support', type: 'preparatory' },
    { key: 'negotiate_title_share', type: 'preparatory' },
    { key: 'finalize_cadet_branch', type: 'immediate' },
  ],
  republic_house_foundation: [
    { key: 'prepare_foundation', type: 'preparatory' },
    { key: 'register_house', type: 'immediate' },
  ],
  consolidate_internal_contracts: [
    { key: 'review_internal_contracts', type: 'preparatory' },
    { key: 'negotiate_internal_terms', type: 'preparatory' },
    { key: 'finalize_consolidation', type: 'immediate' },
  ],

  // v0.51 陰謀リファイン: 単一 final stage (acquire_political_right と同型)。重い advance_project
  //   Task 1 本で execute する。effort/difficulty は projectTaskGenerationSystem が陰謀専用値に上書き。
  undermine_influence: [{ key: 'execute_project', type: 'final' }],
}

export function getProjectStageSequence(kind: ProjectKind): readonly ProjectStageEntry[] {
  return PROJECT_STAGE_SEQUENCES[kind]
}

export function getInitialProjectStageKey(kind: ProjectKind): ProjectStageKey {
  return PROJECT_STAGE_SEQUENCES[kind][0]!.key
}

export function getNextProjectStageKey(project: Project): ProjectStageKey | undefined {
  const seq = PROJECT_STAGE_SEQUENCES[project.kind]
  const idx = seq.findIndex((e) => e.key === project.currentStageKey)
  if (idx < 0 || idx >= seq.length - 1) return undefined
  return seq[idx + 1]!.key
}

export function isFinalProjectStage(project: Project): boolean {
  const seq = PROJECT_STAGE_SEQUENCES[project.kind]
  const entry = seq.find((e) => e.key === project.currentStageKey)
  return entry?.type === 'final'
}

export function isProjectStageValid(project: Project): boolean {
  const seq = PROJECT_STAGE_SEQUENCES[project.kind]
  return seq.some((e) => e.key === project.currentStageKey)
}

export function getProjectStageType(
  kind: ProjectKind,
  stageKey: ProjectStageKey,
): ProjectStageType | undefined {
  const seq = PROJECT_STAGE_SEQUENCES[kind]
  const entry = seq.find((e) => e.key === stageKey)
  return entry?.type
}
