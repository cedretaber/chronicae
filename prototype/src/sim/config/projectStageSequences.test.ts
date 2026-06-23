import { describe, expect, it } from 'vitest'
import {
  PROJECT_STAGE_SEQUENCES,
  getProjectStageType,
  isProjectStageValid,
} from './projectStageSequences'
import type { Project } from '../types/project'

describe('v0.60 raise_funds stage', () => {
  const FUNDED_KINDS = [
    'develop_holding',
    'develop_real_estate',
    'acquire_real_estate',
    'upgrade_owned_real_estate',
    'handle_crisis',
  ] as const

  it('5 budget kinds に raise_funds(immediate) が含まれる', () => {
    for (const kind of FUNDED_KINDS) {
      expect(getProjectStageType(kind, 'raise_funds')).toBe('immediate')
    }
  })

  it('raise_funds は execute_project/mitigate の後ろに位置する', () => {
    for (const kind of FUNDED_KINDS) {
      const seq = PROJECT_STAGE_SEQUENCES[kind]
      const finalIdx = seq.findIndex((e) => e.type === 'final')
      const fundIdx = seq.findIndex((e) => e.key === 'raise_funds')
      expect(fundIdx).toBeGreaterThan(finalIdx)
    }
  })

  it('isProjectStageValid が raise_funds を受理する', () => {
    const p = { kind: 'develop_holding', currentStageKey: 'raise_funds' } as unknown as Project
    expect(isProjectStageValid(p)).toBe(true)
  })
})
