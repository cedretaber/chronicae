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

  expand_polity_share: [{ key: 'execute_project', type: 'final' }],

  promote_policy_shift: [{ key: 'execute_project', type: 'final' }],

  patronize_artist: [{ key: 'arrange_patronage', type: 'final' }],

  commission_chronicle: [{ key: 'write_chronicle', type: 'final' }],

  // Phase A: transitional single-stage. Phase B replaces with spec §4 full sequence.
  acquire_land: [{ key: 'execute_project', type: 'final' }],
  sell_land: [{ key: 'execute_project', type: 'final' }],
  improve_contract_terms: [{ key: 'execute_project', type: 'final' }],
  demand_tax_increase: [{ key: 'execute_project', type: 'final' }],

  respond_to_pressure: [
    { key: 'choose_stance', type: 'immediate' },
    { key: 'prepare_response', type: 'preparatory' },
    { key: 'negotiate', type: 'final' },
  ],
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
