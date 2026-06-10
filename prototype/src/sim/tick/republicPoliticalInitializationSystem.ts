// v0.46 §5.1 RepublicPoliticalInitializationSystem (建国式)
//
// established commonwealth (共和国) を検出し、非 leader office (administrator/treasurer/
// military/advisor) を功臣で seed して最低限の政治構造を初期化する。established 化経路は
// 複数サイトに分散しているため、特定 mutation に hook せず idempotent な scheduled system
// として処理する。republicInitializedWeek marker で once-guard し (§5.1.4)、AppointmentSystem
// が non-leader slot を埋めるより前に建国式を行うため tick 上は AppointmentSystem の直前に置く。

import type { TickContext } from './context'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import type { PersonId, PolityId } from '../types/ids'
import type { OfficeRole } from '../types/office'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import {
  getActiveOfficeHolders,
  getOfficeAssignments,
  getEffectiveOfficeMaxHolders,
} from '../selectors/officeSelectors'
import { isRoleEligibleBySex } from '../selectors/roleEligibilitySelectors'
import { getPolityTerminalProvinceIds } from '../selectors/landContractSelectors'
import { getPolityNameRefForEmit } from '../selectors/nameRefSelectors'
import {
  isEstablishedCommonwealthRepublic,
  getRepublicPoliticalCandidatePersons,
  scoreRepublicOfficeCandidate,
} from '../selectors/republicSelectors'

// seed 対象の非 leader role と、それぞれの初期 slot 数を引く config キー。
const SEED_ROLES: { role: OfficeRole; slotsKey: keyof SimulationConfig }[] = [
  { role: 'administrator', slotsKey: 'republicInitialAdministratorSlots' },
  { role: 'treasurer', slotsKey: 'republicInitialTreasurerSlots' },
  { role: 'military', slotsKey: 'republicInitialMilitarySlots' },
  { role: 'advisor', slotsKey: 'republicInitialAdvisorSlots' },
]

// 候補集合に性別ゲートを gated-first 適用する。適格者が払底し
// allowFemaleRolesWhenNoMaleCandidate が true の場合のみ ungated に戻す (§5.1.5 step 5)。
function applySexGate(
  state: WorldState,
  config: SimulationConfig,
  candidates: PersonId[],
): PersonId[] {
  const gated = candidates.filter((id) => isRoleEligibleBySex(state, config, id))
  if (gated.length > 0) return gated
  if (config.allowFemaleRolesWhenNoMaleCandidate) return candidates
  return gated
}

// score 降順 + PersonId 昇順で最良候補を選ぶ (決定的)。
function pickBestCandidate(
  state: WorldState,
  config: SimulationConfig,
  candidates: PersonId[],
  polityId: PolityId,
  role: OfficeRole,
): PersonId | undefined {
  let best: { id: PersonId; score: number } | undefined
  for (const id of candidates) {
    const score = scoreRepublicOfficeCandidate(state, config, id, polityId, role)
    if (
      !best ||
      score > best.score ||
      (score === best.score && (id as string).localeCompare(best.id) < 0)
    ) {
      best = { id, score }
    }
  }
  return best?.id
}

function initializeRepublic(
  ctx: TickContext,
  polityId: PolityId,
): { ctx: TickContext; seededCount: number } {
  let state = ctx.state
  const org = { kind: 'polity' as const, id: polityId }

  // leader は読むだけ (建国式では作らない・置換しない)。不在なら建国式を保留し retry。
  const leaderId = getActiveOfficeHolders(state, org, 'leader')[0]
  if (!leaderId) return { ctx, seededCount: 0 }

  const candidates = getRepublicPoliticalCandidatePersons(state, ctx.config, polityId)

  // この polity の active office を 1 つでも持つ人物 (兼任防止)。seed のたびに更新する。
  const seatedPersons = new Set<string>()
  for (const office of getOfficeAssignments(state, org)) {
    if (office.active) seatedPersons.add(office.holderPersonId)
  }

  let seededCount = 0

  for (const { role, slotsKey } of SEED_ROLES) {
    const configSlots = ctx.config[slotsKey] as number
    const effectiveMax = getEffectiveOfficeMaxHolders(state, ctx.config, org, role)
    const target = Math.min(configSlots, effectiveMax)

    const activeHolders = getActiveOfficeHolders(state, org, role)
    let slotsToFill = target - activeHolders.length
    if (slotsToFill <= 0) continue

    while (slotsToFill > 0) {
      // 未着任・非兼任・leader 以外の候補に絞る。
      const pool = candidates.filter((id) => id !== leaderId && !seatedPersons.has(id as string))
      const gated = applySexGate(state, ctx.config, pool)
      const best = pickBestCandidate(state, ctx.config, gated, polityId, role)
      if (!best) break

      // 空き最若 slot を採番する (right grant と一致させるため明示計算)。
      const used = new Set<number>()
      for (const office of getOfficeAssignments(state, org)) {
        if (office.active && office.role === role) used.add(office.slotIndex)
      }
      let slotIndex = 0
      while (used.has(slotIndex)) slotIndex++

      state = createOfficeAssignment(state, org, role, best, slotIndex)
      seatedPersons.add(best)
      seededCount++
      slotsToFill--

      // personal appointment right を grant する (§5.1.5 step 6)。
      if (ctx.config.republicGrantInitialPersonalRights) {
        const rightResult = createPoliticalRight(state, {
          polityId,
          holder: { kind: 'person', id: best },
          target: { kind: 'polity_office_role', polityId, role, slotIndex },
          grantedWeek: state.absoluteWeek,
        })
        if (rightResult.ok) state = rightResult.value.state
      }
    }
  }

  let nextCtx: TickContext = { ...ctx, state }

  // ≥1 功臣を seed できた場合にのみ marker set + REPUBLIC_FOUNDED emit (§5.1.4 / §5.1.7)。
  if (seededCount >= 1) {
    const polity = state.polities[polityId]
    if (polity) {
      state = {
        ...state,
        polities: {
          ...state.polities,
          [polityId]: { ...polity, republicInitializedWeek: state.absoluteWeek },
        },
      }
      nextCtx = { ...nextCtx, state }

      const polityRef = getPolityNameRefForEmit(state, polityId)
      const leaderPerson = state.persons[leaderId]
      const capitalProvince = state.provinces[polity.capitalProvinceId]
      const { event, ctx: eventCtx } = createSimEvent(nextCtx, {
        type: 'REPUBLIC_FOUNDED',
        importance: 'major',
        messageKey: 'republic.founded',
        messageParams: {
          polity: nameParam(polityRef.category, polityRef.nameKey),
          leader: nameParam('person', leaderPerson?.nameKey ?? ''),
          province: nameParam('province', capitalProvince?.nameKey ?? ''),
        },
        entityRefs: [
          entityRef('polity', polityId, 'polity', polityRef.nameKey),
          entityRef('person', leaderId, 'leader', leaderPerson?.nameKey),
        ],
      })
      nextCtx = { ...eventCtx, state, events: [...eventCtx.events, event] }
    }
  }

  return { ctx: nextCtx, seededCount }
}

export function runRepublicPoliticalInitializationSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  for (const polityId of Object.keys(currentCtx.state.polities) as PolityId[]) {
    const polity = currentCtx.state.polities[polityId]
    if (!polity) continue
    if (!isEstablishedCommonwealthRepublic(currentCtx.state, polityId)) continue
    if (polity.republicInitializedWeek !== undefined) continue
    // landless established commonwealth は建国式の対象外 (土地が戻れば次 interval で対象化)。
    if (getPolityTerminalProvinceIds(currentCtx.state, polityId).length === 0) continue

    const result = initializeRepublic(currentCtx, polityId)
    currentCtx = result.ctx
  }
  return currentCtx
}
