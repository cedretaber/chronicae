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
    // v0.60: budget 枯渇時に projectMaintenanceSystem が遷移させる back-edge ステージ。
    // resolver が手動で execute_project へ戻すため getNextProjectStageKey の対象にしない。
    { key: 'raise_funds', type: 'immediate' },
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
  revoke_political_right: [{ key: 'execute_project', type: 'final' }],
  replace_house_leader: [{ key: 'execute_project', type: 'final' }],

  // v0.52 不動産開発: develop_holding と同型 (find_supervisor → secure_budget → execute_project)
  develop_real_estate: [
    { key: 'find_supervisor', type: 'immediate' },
    { key: 'secure_budget', type: 'immediate' },
    { key: 'execute_project', type: 'final' },
    // v0.60: budget 枯渇時の back-edge ステージ (resolver が手動遷移)。
    { key: 'raise_funds', type: 'immediate' },
  ],

  // v0.52 不動産取得: develop_real_estate と同型
  acquire_real_estate: [
    { key: 'find_supervisor', type: 'immediate' },
    { key: 'secure_budget', type: 'immediate' },
    { key: 'execute_project', type: 'final' },
    // v0.60: budget 枯渇時の back-edge ステージ (resolver が手動遷移)。
    { key: 'raise_funds', type: 'immediate' },
  ],

  // v0.52 所有不動産増築: develop_real_estate と同型
  upgrade_owned_real_estate: [
    { key: 'find_supervisor', type: 'immediate' },
    { key: 'secure_budget', type: 'immediate' },
    { key: 'execute_project', type: 'final' },
    // v0.60: budget 枯渇時の back-edge ステージ (resolver が手動遷移)。
    { key: 'raise_funds', type: 'immediate' },
  ],

  // v0.48 Crisis: develop_holding に倣う。find_supervisor → secure_budget (treasury 前借り) →
  //   mitigate (final, advance_project task 駆動で progress を積み severity を削る, §3.4)。
  handle_crisis: [
    { key: 'find_supervisor', type: 'immediate' },
    { key: 'secure_budget', type: 'immediate' },
    { key: 'mitigate', type: 'final' },
    // v0.60: budget 枯渇時の back-edge ステージ (resolver が手動遷移)。
    { key: 'raise_funds', type: 'immediate' },
  ],

  // v0.53 押領・上納拒否・義務強制: prepare_argument → execute_project の 2 段 (C2)。
  //   find_supervisor / budget は持たず supervisor は作成時に選定。budget 無しで回る
  //   self-executed political project (Phase 1-2)。Phase 4 で enforce のみ外交接続に差し替える。
  seize_real_estate_income: [
    { key: 'prepare_argument', type: 'preparatory' },
    { key: 'execute_project', type: 'final' },
  ],
  withhold_land_contract_tax: [
    { key: 'prepare_argument', type: 'preparatory' },
    { key: 'execute_project', type: 'final' },
  ],
  enforce_obligation: [
    { key: 'prepare_argument', type: 'preparatory' },
    { key: 'execute_project', type: 'final' },
  ],
  // v0.53 Phase 4: LandContractDefault 強制は外交 (improve_contract_terms と同型)。
  enforce_land_contract_default: [
    { key: 'prepare_argument', type: 'preparatory' },
    { key: 'open_diplomatic_play', type: 'immediate' },
    { key: 'negotiate', type: 'final' },
  ],

  // v0.61 商会 Project: develop_real_estate と同型 (find_supervisor → secure_budget →
  //   execute_project + raise_funds back-edge)。§17.5。
  upgrade_company_headquarters: [
    { key: 'find_supervisor', type: 'immediate' },
    { key: 'secure_budget', type: 'immediate' },
    { key: 'execute_project', type: 'final' },
    { key: 'raise_funds', type: 'immediate' },
  ],
  build_company_branch: [
    { key: 'find_supervisor', type: 'immediate' },
    { key: 'secure_budget', type: 'immediate' },
    { key: 'execute_project', type: 'final' },
    { key: 'raise_funds', type: 'immediate' },
  ],
  open_trade_route: [
    { key: 'find_supervisor', type: 'immediate' },
    { key: 'secure_budget', type: 'immediate' },
    { key: 'execute_project', type: 'final' },
    { key: 'raise_funds', type: 'immediate' },
  ],
  upgrade_trade_route: [
    { key: 'find_supervisor', type: 'immediate' },
    { key: 'secure_budget', type: 'immediate' },
    { key: 'execute_project', type: 'final' },
    { key: 'raise_funds', type: 'immediate' },
  ],
}

export function getInitialProjectStageKey(kind: ProjectKind): ProjectStageKey {
  return PROJECT_STAGE_SEQUENCES[kind][0]!.key
}

export function getNextProjectStageKey(project: Project): ProjectStageKey | undefined {
  const seq = PROJECT_STAGE_SEQUENCES[project.kind]
  const idx = seq.findIndex((e) => e.key === project.currentStageKey)
  if (idx < 0 || idx >= seq.length - 1) return undefined
  const next = seq[idx + 1]!
  // v0.60: raise_funds は final stage の後ろに置く back-edge 専用ステージ。linear 遷移
  //   (例: execute_project の「次」) には絶対に出さない。遷移は resolver/maintenance が手動で行う。
  //   これにより final stage の linear next は従来どおり undefined のまま (caller 全体の不変条件を維持)。
  if (next.key === 'raise_funds') return undefined
  return next.key
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
