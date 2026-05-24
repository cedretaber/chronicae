import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { Aim, DecisionSubjectRef } from '../types/goal'
import { TERMINAL_DIPLOMATIC_PLAY_STATUSES } from '../types/diplomaticPlay'
import { nameParam, entityRef } from '../types/event'
import { clamp } from '../utils/math'

const TERMINAL_PLAY_SET = new Set<string>(TERMINAL_DIPLOMATIC_PLAY_STATUSES as readonly string[])

export function runAimOutcomeSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const [, play] of Object.entries(currentCtx.state.diplomaticPlays)) {
    if (!play) continue
    if (!TERMINAL_PLAY_SET.has(play.status)) continue
    if (!play.aimId) continue

    const aim = currentCtx.state.aims[play.aimId]
    if (!aim || aim.status !== 'active') continue

    let progressDelta = 0
    let succeeded = false

    const isProjectLinked = play.originProjectId !== undefined

    if (play.status === 'settled') {
      progressDelta = isProjectLinked ? currentCtx.config.aimProgressGainLandOrContractProject : 1
      succeeded = true
    } else if (play.status === 'resolved_by_conflict') {
      const initiatorIsOwner =
        aim.owner.kind === 'polity' &&
        play.initiator.kind === 'polity' &&
        (play.initiator.id as string) === (aim.owner.id as string)
      if (initiatorIsOwner) {
        progressDelta = isProjectLinked ? currentCtx.config.aimProgressGainLandOrContractProject : 1
        succeeded = true
      }
    }

    const updatedAim: Aim = {
      ...aim,
      progress: clamp(aim.progress + progressDelta, 0, aim.targetProgress),
      ...(isProjectLinked
        ? {
            successfulProjectCount: aim.successfulProjectCount + (succeeded ? 1 : 0),
            failedProjectCount: aim.failedProjectCount + (succeeded ? 0 : 1),
          }
        : {
            successfulIntentCount: aim.successfulIntentCount + (succeeded ? 1 : 0),
            failedIntentCount: aim.failedIntentCount + (succeeded ? 0 : 1),
          }),
    }

    const entries = Object.entries(updatedAim).filter(([k]) => k !== 'activeDiplomaticPlayId')
    const cleanedAim = Object.fromEntries(entries) as Aim

    const tolerance = currentCtx.config.aimProgressCompletionTolerance
    const aimSucceeded = cleanedAim.progress >= cleanedAim.targetProgress - tolerance
    if (aimSucceeded) {
      cleanedAim.progress = cleanedAim.targetProgress
      cleanedAim.status = 'succeeded'
    }

    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        aims: { ...currentCtx.state.aims, [aim.id]: cleanedAim },
      },
    }

    if (aimSucceeded) {
      const ownerNameKey = getOwnerNameKey(currentCtx, aim.owner)
      const { event, ctx: evCtx } = createSimEvent(currentCtx, {
        type: 'AIM_SUCCEEDED',
        importance: 'minor',
        messageKey: 'aim.succeeded',
        messageParams: {
          owner: nameParam(aim.owner.kind, ownerNameKey),
          kind: aim.kind,
        },
        entityRefs: [entityRef(aim.owner.kind, aim.owner.id, 'owner', ownerNameKey)],
      })
      currentCtx = { ...evCtx, events: [...evCtx.events, event] }
    }
  }

  return currentCtx
}

function getOwnerNameKey(ctx: TickContext, owner: DecisionSubjectRef): string {
  if (owner.kind === 'polity') {
    return ctx.state.polities[owner.id]?.nameKey ?? owner.id
  }
  if (owner.kind === 'house') {
    return ctx.state.houses[owner.id]?.nameKey ?? owner.id
  }
  return ctx.state.persons[owner.id]?.nameKey ?? owner.id
}
