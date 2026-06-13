import type { WorldState } from '../types/world'
import { getHousePolityIds, getPersonPrimaryPolityId } from './polityRelations'
import { getRepublicFootholdPolityIds } from './republicSelectors'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId } from '../types/ids'
import type { PersonAimKind, Goal, EntityRef } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { OfficeRole, OrganizationRef } from '../types/office'
import type { AbilityKey } from '../types/person'
import type { RngState } from '../rng/rng'
import { randomFloat } from '../rng/rng'
import { getPersonGoalFulfillment } from './personGoalSelectors'
import { hasGainfulOffice } from './houseFinanceSelectors'
import {
  resolveLandGrantDonor,
  resolveCadetBranchTransfer,
  resolveRepublicHouseFounding,
} from './petitionSelectors'

const PERSON_AIM_KINDS: readonly PersonAimKind[] = [
  'increase_house_influence',
  'obtain_office',
  'retain_office',
  'accumulate_wealth',
  'improve_ability',
  'support_organization_aim',
]

export function scorePersonAimKind(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  goal: Goal,
): { kind: PersonAimKind; score: number; target?: EntityRef }[] {
  const person = state.persons[personId]
  if (!person) return []

  const fulfillment = getPersonGoalFulfillment(state, personId)
  const fulfillmentPenalty = fulfillment > 60 ? (fulfillment - 60) * 0.3 : 0

  const results: { kind: PersonAimKind; score: number; target?: EntityRef }[] = []

  // Check current offices
  let heldPolityOffice: { organization: OrganizationRef; role: OfficeRole } | undefined
  let heldHouseOffice: { organization: OrganizationRef; role: OfficeRole } | undefined
  let hasAnyOffice = false

  const holderOfficeIds = state.officeIndex.byHolderPerson[personId as string] ?? []
  for (const oaId of holderOfficeIds) {
    const oa = state.officeAssignments[oaId]
    if (!oa || !oa.active) continue
    hasAnyOffice = true
    if (oa.organization.kind === 'polity') {
      heldPolityOffice = {
        organization: { kind: oa.organization.kind, id: oa.organization.id },
        role: oa.role,
      }
    } else {
      heldHouseOffice = {
        organization: { kind: oa.organization.kind, id: oa.organization.id },
        role: oa.role,
      }
    }
  }

  // v0.48: obtain_office の抑制判定は「実職 (収入を生む役職)」の有無で行う。
  // 給与 0 の leader 肩書き (無領地家長 / 名目 Polity の家長) は無役扱いとし、
  // 職探し aim を持てるようにする。retain_office は hasAnyOffice のまま (肩書き保持は別軸)。
  const personHasGainfulOffice = hasGainfulOffice(state, personId, config)

  for (const kind of PERSON_AIM_KINDS) {
    let score = 0
    let goalAlignment = 0
    let target: EntityRef | undefined

    // Goal alignment scoring
    switch (goal.kind) {
      case 'house_loyalty':
        if (kind === 'increase_house_influence') goalAlignment = 20
        else if (kind === 'support_organization_aim') goalAlignment = 18
        else if (kind === 'obtain_office') goalAlignment = 10
        else if (kind === 'retain_office') goalAlignment = 15
        break
      case 'public_service':
        if (kind === 'support_organization_aim') goalAlignment = 18
        else if (kind === 'retain_office') goalAlignment = 15
        else if (kind === 'obtain_office') goalAlignment = 10
        else if (kind === 'improve_ability') goalAlignment = 12
        break
      case 'personal_advancement':
        if (kind === 'obtain_office') goalAlignment = 20
        else if (kind === 'retain_office') goalAlignment = 15
        else if (kind === 'improve_ability') goalAlignment = 10
        else if (kind === 'increase_house_influence') goalAlignment = 8
        break
      case 'wealth_building':
        if (kind === 'accumulate_wealth') goalAlignment = 20
        else if (kind === 'obtain_office') goalAlignment = 10
        else if (kind === 'retain_office') goalAlignment = 10
        break
      case 'self_cultivation':
        if (kind === 'improve_ability') goalAlignment = 25
        break
      default:
        break
    }

    if (goalAlignment === 0) continue

    score += goalAlignment

    // Kind-specific scoring and target selection
    switch (kind) {
      case 'increase_house_influence':
        score += 10
        break

      case 'obtain_office':
        if (personHasGainfulOffice) {
          score -= 10
        } else {
          score += person.traits.ambition * 10
        }
        if (!person.houseId) break
        // Find a target office - pick a random available role from house or polity
        // Simple: target the person's house, pick the first non-leader role not held
        {
          const roles: Array<'administrator' | 'treasurer' | 'military' | 'advisor'> = [
            'administrator',
            'treasurer',
            'military',
            'advisor',
          ]
          for (const role of roles) {
            let alreadyHolds = false
            for (const oaId of holderOfficeIds) {
              const oa = state.officeAssignments[oaId]
              if (!oa || !oa.active) continue
              if (
                oa.organization.kind === 'house' &&
                (oa.organization.id as string) === (person.houseId as string) &&
                oa.role === role
              ) {
                alreadyHolds = true
                break
              }
            }
            if (!alreadyHolds) {
              target = {
                kind: 'office',
                organization: { kind: 'house', id: person.houseId },
                role,
              }
              break
            }
          }
          if (!target) {
            // Try polity offices
            // v0.42c: 旧実装は polity share 走査で家の関連 polity を探していた (share 全廃で dead)。
            // 家が土地で関与する polity (getHousePolityIds) を走査する。
            // v0.46 §5.3: established commonwealth 共和国は ownerHouse が無く getHousePolityIds に
            //   出ないため、本人/家が foothold を持つ共和国を追加する (normal polity は不変)。
            const polityCandidateIds = [...getHousePolityIds(state, person.houseId)]
            for (const pid of getRepublicFootholdPolityIds(state, person.id)) {
              if (!polityCandidateIds.includes(pid)) polityCandidateIds.push(pid)
            }
            for (const polityId of polityCandidateIds) {
              for (const role of roles) {
                let alreadyHolds = false
                for (const oaId of holderOfficeIds) {
                  const oa = state.officeAssignments[oaId]
                  if (!oa || !oa.active) continue
                  if (
                    oa.organization.kind === 'polity' &&
                    (oa.organization.id as string) === (polityId as string) &&
                    oa.role === role
                  ) {
                    alreadyHolds = true
                    break
                  }
                }
                if (!alreadyHolds) {
                  target = {
                    kind: 'office',
                    organization: { kind: 'polity', id: polityId },
                    role,
                  }
                  break
                }
              }
              if (target) break
            }
          }
          if (!target) continue // Skip if no available office
        }
        break

      case 'retain_office':
        if (!hasAnyOffice) continue // Skip if no office to retain
        score += 10
        // Target the held office
        if (heldPolityOffice) {
          target = {
            kind: 'office',
            organization: heldPolityOffice.organization,
            role: heldPolityOffice.role,
          }
        } else if (heldHouseOffice) {
          target = {
            kind: 'office',
            organization: heldHouseOffice.organization,
            role: heldHouseOffice.role,
          }
        }
        break

      case 'accumulate_wealth':
        score +=
          Math.max(
            0,
            (config.wealthAccumulationThreshold - person.wealth) /
              config.wealthAccumulationThreshold,
          ) * 10
        break

      case 'improve_ability': {
        // Find ability with largest gap below aptitude
        const abilityKeys: AbilityKey[] = [
          'valor',
          'command',
          'numeracy',
          'learning',
          'charisma',
          'insight',
        ]
        let bestGap = 0
        let bestAbility: AbilityKey = 'learning'
        for (const key of abilityKeys) {
          const gap = person.aptitudes[key] - person.abilities[key]
          if (gap > bestGap) {
            bestGap = gap
            bestAbility = key
          }
        }
        score += Math.min(15, bestGap / 5)
        target = { kind: 'ability', ability: bestAbility }
        break
      }

      case 'support_organization_aim': {
        // v0.47: houseless 人物は支援対象の org aim を持たない → 候補に push しない (continue)。
        //   break だと target 未設定のまま push され integrity 違反 (target 欠落) になる。
        if (!person.houseId) continue
        const orgAim = findOrganizationActiveAim(state, person.houseId, personId)
        if (!orgAim) continue
        score += 10
        target = { kind: 'aim', id: orgAim.id }
        break
      }
    }

    score -= fulfillmentPenalty

    if (score > 0) {
      if (target !== undefined) {
        results.push({ kind, score, target })
      } else {
        results.push({ kind, score })
      }
    }
  }

  // v0.47 §9.1: 分封願い (request_land_grant)。HARD gate (本人資格 + donor + 対象 holding) を満たす
  //   人物が、自立志向の goal に応じて願う。
  //   v0.47 修正: 無家役職者は public_service goal を持ちやすく (官途志向)、それが request_land_grant
  //   の hosting goal に無かったため houseless 代謝路の aim がほぼ生成されていなかった。
  //   官途人物が家を興すための分封は public_service の自然な延長として hosting goal に加える。
  if (
    goal.kind === 'personal_advancement' ||
    goal.kind === 'wealth_building' ||
    goal.kind === 'house_loyalty' ||
    goal.kind === 'public_service'
  ) {
    const donor = resolveLandGrantDonor(state, config, personId)
    if (donor) {
      const ambition = person.traits.ambition
      const base = goal.kind === 'house_loyalty' ? 14 : 22
      const landGrantScore = base + ambition * 0.2 - fulfillmentPenalty
      if (landGrantScore > 0) {
        results.push({
          kind: 'request_land_grant',
          score: landGrantScore,
          target: { kind: 'polity', id: donor.donorPolityId },
        })
      }
    }
  }

  // v0.47 §11.2: 分家願い (establish_cadet_branch)。低継承権の有家人物が宗家の Polity 譲渡を求める。
  if (goal.kind === 'personal_advancement' || goal.kind === 'wealth_building') {
    const transfer = resolveCadetBranchTransfer(state, config, personId)
    if (transfer) {
      const cadetScore = 20 + person.traits.ambition * 0.2 - fulfillmentPenalty
      if (cadetScore > 0) {
        results.push({
          kind: 'establish_cadet_branch',
          score: cadetScore,
          target: { kind: 'polity', id: transfer.targetPolityId },
        })
      }
    }
  }

  // v0.47 §13.1: 共和国 House 創設 (found_republic_house)。established commonwealth の役職を持つ
  //   無家人物が財産を基盤に家を興す。
  if (
    goal.kind === 'personal_advancement' ||
    goal.kind === 'wealth_building' ||
    goal.kind === 'self_cultivation'
  ) {
    const republic = resolveRepublicHouseFounding(state, config, personId)
    if (republic) {
      const score = 24 + person.traits.ambition * 0.2 - fulfillmentPenalty
      if (score > 0) {
        results.push({
          kind: 'found_republic_house',
          score,
          target: { kind: 'polity', id: republic.commonwealthPolityId },
        })
      }
    }
  }

  return results
}

export function pickPersonAim(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  goal: Goal,
  rng: RngState,
): { kind: PersonAimKind; target?: EntityRef; rng: RngState } | undefined {
  const candidates = scorePersonAimKind(state, config, personId, goal)
  if (candidates.length === 0) return undefined

  candidates.sort((a, b) => b.score - a.score)

  const totalScore = candidates.reduce((sum, s) => sum + Math.max(1, s.score), 0)
  const { value: roll, rng: nextRng } = randomFloat(rng)
  let cumulative = 0
  for (const c of candidates) {
    cumulative += Math.max(1, c.score) / totalScore
    if (roll < cumulative) {
      return { kind: c.kind, ...(c.target !== undefined ? { target: c.target } : {}), rng: nextRng }
    }
  }
  const first = candidates[0]
  if (!first) return undefined
  return {
    kind: first.kind,
    ...(first.target !== undefined ? { target: first.target } : {}),
    rng: nextRng,
  }
}

function findOrganizationActiveAim(
  state: WorldState,
  houseId: import('../types/ids').HouseId,
  personId: PersonId,
): import('../types/goal').Aim | undefined {
  // Try house Aim first
  const houseKey = decisionSubjectKey({ kind: 'house', id: houseId })
  const houseAimIds = state.aimIndex.byOwner[houseKey]
  if (houseAimIds) {
    for (const aid of houseAimIds) {
      const aim = state.aims[aid]
      if (aim && aim.status === 'active') return aim
    }
  }

  // Try primary polity Aim
  const polityId = getPersonPrimaryPolityId(state, personId)
  if (polityId) {
    const polityKey = decisionSubjectKey({ kind: 'polity', id: polityId })
    const polityAimIds = state.aimIndex.byOwner[polityKey]
    if (polityAimIds) {
      for (const aid of polityAimIds) {
        const aim = state.aims[aid]
        if (aim && aim.status === 'active') return aim
      }
    }
  }

  return undefined
}
