import type { DiplomaticPlayId, WarId, RegimentId, BattleId } from '../types/ids'
import type { OrganizationRef } from '../types/office'
import { politicalActorKey } from '../selectors/actorSelectors'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import { getPolityTerritorialStatus } from '../types/polity'
import type { SimulationConfig } from '../config/defaultConfig'

export function checkDiplomacyWarRegiment(
  state: WorldState,
  errors: SimError[],
  config: SimulationConfig | undefined,
): void {
  // ─── §20: DiplomaticPlay 整合性 ───

  // actor が存在する active actor を指すかチェック (Polity の active / House の active を確認)
  const isActiveActor = (actor: OrganizationRef): boolean => {
    if (actor.kind === 'polity') {
      const p = state.polities[actor.id]
      return Boolean(p && p.active)
    }
    const h = state.houses[actor.id]
    return Boolean(h && h.active)
  }

  // DiplomaticPlay integrity (§20)
  const seenPlayIds = new Set<string>()
  for (const idStr of Object.keys(state.diplomaticPlays)) {
    const play = state.diplomaticPlays[idStr as DiplomaticPlayId]
    if (!play) continue
    // id 一意性
    if (seenPlayIds.has(idStr)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} duplicate id (§20)`,
      })
    }
    seenPlayIds.add(idStr)
    // すべての entry は active or escalated (terminal は tick 末で削除される前提)
    // v0.18 Stage D: 'escalated' は ConflictResolutionSystem が同 tick 内で
    // 'resolved_by_conflict' に置換するが、maxConflictsResolvedPerTick 上限で
    // 持ち越される場合がある (非 terminal なので OK)。
    if (play.status !== 'active' && play.status !== 'escalated') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} has terminal status ${play.status} (must be cleaned up) (§20)`,
      })
      // v0.44 §12.3: terminal status は terminalOutcome 必須。terminal play は
      // cleanupTerminalDiplomacy が同 tick で削除するため年末 integrity では実質発火せず、
      // --integrity-per-system の mid-tick 検証で捕捉する。
      if (play.terminalOutcome === undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: terminal status=${play.status} without terminalOutcome (§12.3)`,
        })
      }
    } else if (play.terminalOutcome !== undefined) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr}: non-terminal play with terminalOutcome=${play.terminalOutcome} (§12.3)`,
      })
    }
    // initiator / target が active actor
    if (!isActiveActor(play.initiator)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} initiator ${play.initiator.kind}:${play.initiator.id} is not active (§20)`,
      })
    }
    if (!isActiveActor(play.target)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} target ${play.target.kind}:${play.target.id} is not active (§20)`,
      })
    }
    // v0.43 §5.2: supporter invariant。
    //   - actor は polity のみ・active (cleanupTerminalDiplomacy §15.1 sweep が回収する前提)
    //   - initiator / target が supporters に混入しない
    //   - 同 side 内・両 side 跨ぎの重複なし
    {
      const primaryKeys = new Set([
        politicalActorKey(play.initiator),
        politicalActorKey(play.target),
      ])
      const seenKeys = new Set<string>()
      const sides: Array<[string, typeof play.initiatorSupporters]> = [
        ['initiatorSupporters', play.initiatorSupporters],
        ['targetSupporters', play.targetSupporters],
      ]
      for (const [sideName, supporters] of sides) {
        for (const s of supporters) {
          const key = politicalActorKey(s.actor)
          if (s.actor.kind !== 'polity') {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `DiplomaticPlay ${idStr} ${sideName} supporter ${key} is not a polity (v0.43 §5.2)`,
            })
          } else if (!isActiveActor(s.actor)) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `DiplomaticPlay ${idStr} ${sideName} supporter ${key} is not active (v0.43 §5.2)`,
            })
          }
          if (primaryKeys.has(key)) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `DiplomaticPlay ${idStr} ${sideName} supporter ${key} is also a primary actor (v0.43 §5.2)`,
            })
          }
          if (seenKeys.has(key)) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `DiplomaticPlay ${idStr} supporter ${key} appears more than once across sides (v0.43 §5.2)`,
            })
          }
          seenKeys.add(key)
        }
      }
    }
    // progress / tension は 0..100
    if (play.progress < 0 || play.progress > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} progress=${play.progress} outside [0, 100] (§20)`,
      })
    }
    if (play.tension < 0 || play.tension > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} tension=${play.tension} outside [0, 100] (§20)`,
      })
    }
    // deadline が started より後
    if (play.deadlineWeek <= play.startedWeek) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} deadlineWeek=${play.deadlineWeek} is not after startedWeek=${play.startedWeek} (§20)`,
      })
    }
    // v0.30: issue 存在・整合性チェック
    if (play.kind !== 'revolt_negotiation') {
      if (!play.issue) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} (kind=${play.kind}) must have issue (§17)`,
        })
      } else if (play.issue.kind !== play.kind) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} issue.kind=${play.issue.kind} does not match play.kind=${play.kind} (§17)`,
        })
      }
    }
    // v0.30: issue anchor 検証
    if (play.issue?.kind === 'land_claim') {
      if (!state.holdings[play.issue.holdingId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} issue.holdingId ${play.issue.holdingId} does not exist (§17)`,
        })
      }
      if (!state.provinces[play.issue.provinceId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} issue.provinceId ${play.issue.provinceId} does not exist (§17)`,
        })
      }
    }
    if (play.issue?.kind === 'contract_tax_revision') {
      if (!state.holdings[play.issue.holdingId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} issue.holdingId ${play.issue.holdingId} does not exist (§17)`,
        })
      }
      if (!state.landContracts[play.issue.landContractId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} issue.landContractId ${play.issue.landContractId} does not exist (§17)`,
        })
      }
    }
    // v0.30: offer 整合性チェック
    if (play.currentOfferId) {
      const offer = state.diplomaticOffers[play.currentOfferId]
      if (!offer) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} currentOfferId ${play.currentOfferId as string} references missing offer (§17)`,
        })
      } else if (offer.playId !== play.id) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} currentOfferId offer.playId=${offer.playId} mismatch (§17)`,
        })
      }
    }
    for (const offerId of play.offerHistoryIds) {
      const offer = state.diplomaticOffers[offerId]
      if (!offer) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} offerHistoryIds references missing offer ${offerId as string} (§17)`,
        })
      } else if (offer.playId !== play.id) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} offerHistoryIds offer ${offerId as string} playId=${offer.playId} mismatch (§17)`,
        })
      }
    }
    if (play.lastEvaluatedOfferId) {
      const inHistory = play.offerHistoryIds.includes(play.lastEvaluatedOfferId)
      const isCurrent = play.lastEvaluatedOfferId === play.currentOfferId
      if (!inHistory && !isCurrent) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} lastEvaluatedOfferId ${play.lastEvaluatedOfferId as string} not in offerHistoryIds or currentOfferId (§17)`,
        })
      }
    }
    // accepted offer should not remain on active play (settlement should have fired)
    if (play.status === 'active' || play.status === 'escalated') {
      const allOfferIds = play.currentOfferId
        ? [...play.offerHistoryIds, play.currentOfferId]
        : play.offerHistoryIds
      for (const offerId of allOfferIds) {
        const offer = state.diplomaticOffers[offerId]
        if (offer?.status === 'accepted') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} has accepted offer ${offerId as string} but is still ${play.status} (§17)`,
          })
        }
      }
    }
    // primaryDemand: revolt_negotiation のみ存在必須、非 revolt には不要
    if (play.kind !== 'revolt_negotiation' && play.primaryDemand) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} (kind=${play.kind}) should not have primaryDemand (§17)`,
      })
    }
    if (play.kind === 'revolt_negotiation') {
      if (!play.primaryDemand) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} revolt_negotiation must have primaryDemand (§20)`,
        })
      }
    }
    // revolt_negotiation 固有チェック (§20)
    if (play.kind === 'revolt_negotiation') {
      if (play.initiator.kind !== 'polity') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} revolt_negotiation initiator must be a Polity (§20)`,
        })
      } else {
        const initPolity = state.polities[play.initiator.id]
        if (initPolity && initPolity.kind !== 'commonwealth') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} revolt_negotiation initiator Polity ${play.initiator.id} is not commonwealth (§20)`,
          })
        }
      }
      if (play.target.kind !== 'polity') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} revolt_negotiation target must be a Polity (§20)`,
        })
      }
    }

    // v0.23 Phase D: negotiation parameters range
    for (const field of [
      'initiatorPreparation',
      'initiatorLeverage',
      'initiatorCommitment',
      'targetPreparation',
      'targetLeverage',
      'targetCommitment',
    ] as const) {
      const val = play[field]
      if (val < 0 || val > 100) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} ${field}=${val} outside [0, 100] (§10)`,
        })
      }
    }

    // v0.23 Phase D: activeTaskIds must reference valid active Tasks
    for (const taskId of play.initiatorActiveTaskIds) {
      const task = state.tasks[taskId]
      if (!task) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: initiatorActiveTaskIds references missing task ${taskId as string} (§10)`,
        })
      } else if (task.status !== 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: initiatorActiveTaskIds references non-active task ${taskId as string} (status=${task.status}) (§10)`,
        })
      }
    }
    for (const taskId of play.targetActiveTaskIds) {
      const task = state.tasks[taskId]
      if (!task) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: targetActiveTaskIds references missing task ${taskId as string} (§10)`,
        })
      } else if (task.status !== 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: targetActiveTaskIds references non-active task ${taskId as string} (status=${task.status}) (§10)`,
        })
      }
    }

    // v0.23 Phase D: delegate validity
    if (play.initiatorDelegatePersonId) {
      const person = state.persons[play.initiatorDelegatePersonId]
      if (!person || !person.alive || person.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: initiatorDelegatePersonId ${play.initiatorDelegatePersonId as string} is not alive/normal (§10)`,
        })
      }
    }
    if (play.targetDelegatePersonId) {
      const person = state.persons[play.targetDelegatePersonId]
      if (!person || !person.alive || person.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: targetDelegatePersonId ${play.targetDelegatePersonId as string} is not alive/normal (§10)`,
        })
      }
    }
  }

  // v0.30 §14: terminal play の offer が cleanup 後に残っていない
  for (const [offerIdStr, offer] of Object.entries(state.diplomaticOffers)) {
    if (!offer) continue
    const play = state.diplomaticPlays[offer.playId]
    if (!play) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticOffer ${offerIdStr} references missing play ${offer.playId as string} (§14)`,
      })
      continue
    }
    const isTerminal =
      play.status === 'settled' ||
      play.status === 'failed' ||
      play.status === 'resolved_by_conflict' ||
      play.status === 'cancelled'
    if (isTerminal) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticOffer ${offerIdStr} belongs to terminal play ${offer.playId as string} (status=${play.status}) — should have been cascade-deleted (§14)`,
      })
    }
  }

  // v0.30 §14: active play の currentOffer demands が issue anchor と矛盾しない (§5.4)
  for (const [idStr, play] of Object.entries(state.diplomaticPlays)) {
    if (!play || (play.status !== 'active' && play.status !== 'escalated')) continue
    if (!play.currentOfferId || !play.issue) continue
    const offer = state.diplomaticOffers[play.currentOfferId]
    if (!offer) continue
    for (const demand of offer.demands) {
      if (play.issue.kind === 'land_claim') {
        if (demand.kind === 'change_contract_tax_rate') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} (land_claim) currentOffer contains change_contract_tax_rate demand (§5.4)`,
          })
        }
        if (demand.kind === 'transfer_land_contract' && demand.holdingId !== play.issue.holdingId) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} (land_claim) transfer_land_contract.holdingId=${demand.holdingId} !== issue.holdingId=${play.issue.holdingId} (§5.4)`,
          })
        }
      }
      if (play.issue.kind === 'contract_tax_revision') {
        if (demand.kind === 'transfer_land_contract') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} (contract_tax_revision) currentOffer contains transfer_land_contract demand (§5.4)`,
          })
        }
        if (
          demand.kind === 'change_contract_tax_rate' &&
          demand.landContractId !== play.issue.landContractId
        ) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} (contract_tax_revision) change_contract_tax_rate.landContractId=${demand.landContractId} !== issue.landContractId=${play.issue.landContractId} (§5.4)`,
          })
        }
      }
    }
  }

  // v0.23 Phase D: active Tasks targeting diplomatic_play must reference existing active/escalated Play
  for (const [taskIdStr, task] of Object.entries(state.tasks)) {
    if (!task || task.status !== 'active') continue
    if (task.targetRef.kind !== 'diplomatic_play') continue
    const play = state.diplomaticPlays[task.targetRef.id]
    if (!play) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: targets diplomatic_play ${task.targetRef.id as string} which does not exist (§10)`,
      })
    } else if (play.status !== 'active' && play.status !== 'escalated') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: targets diplomatic_play ${task.targetRef.id as string} which has terminal status ${play.status} (§10)`,
      })
    }
  }

  // ─── §14 (v0.34): War 整合性 ───
  const VALID_WAR_STATUSES = ['active', 'attacker_won', 'defender_won', 'white_peace', 'cancelled']
  const seenWarIds = new Set<string>()
  for (const idStr of Object.keys(state.wars)) {
    const war = state.wars[idStr as WarId]
    if (!war) continue

    // §14.2 基本検査
    if ((war.id as string) !== idStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr}: war.id=${war.id as string} does not match record key (§14.2)`,
      })
    }
    if (seenWarIds.has(idStr)) {
      errors.push({ code: 'INTEGRITY_VIOLATION', message: `War ${idStr} duplicate id (§14.2)` })
    }
    seenWarIds.add(idStr)
    if (!VALID_WAR_STATUSES.includes(war.status)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} has invalid status ${war.status} (§14.2)`,
      })
    }
    if (!Number.isFinite(war.startedWeek)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} startedWeek is not finite (§14.2)`,
      })
    }
    if (war.endedWeek !== undefined && war.endedWeek < war.startedWeek) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} endedWeek=${war.endedWeek} < startedWeek=${war.startedWeek} (§14.2)`,
      })
    }
    if (!Number.isFinite(war.warScore)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} warScore is not finite (§14.2)`,
      })
    } else if (war.warScore < -100 || war.warScore > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} warScore=${war.warScore} out of range -100..100 (§14.2)`,
      })
    }
    if (!(war.targetWarScore > 0) || war.targetWarScore > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} targetWarScore=${war.targetWarScore} must be in 0<x<=100 (§14.2)`,
      })
    }

    // §14.3 active / terminal 整合
    if (war.status === 'active') {
      if (war.endedWeek !== undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `War ${idStr} active but endedWeek=${war.endedWeek} is set (§14.3)`,
        })
      }
    } else if (war.endedWeek === undefined) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} terminal (${war.status}) but endedWeek is undefined (§14.3)`,
      })
    }

    // §14.4 participant 検査
    if (war.attacker.key !== 'attacker') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} attacker.key=${war.attacker.key} (§14.4)`,
      })
    }
    if (war.defender.key !== 'defender') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} defender.key=${war.defender.key} (§14.4)`,
      })
    }
    const sides: Array<[string, typeof war.attacker]> = [
      ['attacker', war.attacker],
      ['defender', war.defender],
    ]
    for (const [sideName, side] of sides) {
      // v0.43: multi-participant 化。1 件固定 → 最低 1 件 (primary) に緩和。
      if (side.participants.length < 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `War ${idStr} ${sideName} participants.length=${side.participants.length} must be >= 1 (§14.4)`,
        })
      }
      const primaryCount = side.participants.filter((p) => p.primary).length
      if (primaryCount !== 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `War ${idStr} ${sideName} has ${primaryCount} primary participants, must be 1 (§14.4)`,
        })
      }
      // v0.43 W3: participant は polity のみ (DiplomaticPlay→War の経路が polity 限定のため)。
      for (const p of side.participants) {
        if (p.actor.kind !== 'polity') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} ${sideName} participant ${politicalActorKey(p.actor)} is not a polity (v0.43 §14.4)`,
          })
        }
      }
      // v0.43 W4: 同一 side 内の actor 重複なし。
      const sideKeys = side.participants.map((p) => politicalActorKey(p.actor))
      if (new Set(sideKeys).size !== sideKeys.length) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `War ${idStr} ${sideName} has duplicate participant actors (v0.43 §14.4)`,
        })
      }
      // active War のみ actor active を要求 (terminal War は retention 中の inactive 化を許容)。
      // この検査は cancelOrphanedWarsSystem (§7.9) が active War の participant 消滅を回収する前提。
      if (war.status === 'active') {
        for (const p of side.participants) {
          if (!isActiveActor(p.actor)) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `active War ${idStr} ${sideName} actor ${politicalActorKey(p.actor)} is not active (§14.4)`,
            })
          }
        }
        // v0.35 (§14.7): WarSide の作戦状態の不変条件。active War のみ検査する。
        //   captainGeneral / commander の ID は soft reference のため存在・生存は検査しない
        //   (WarManeuver が毎週 lazy 再選出する。terminal War は retention 中の aging を許容)。
        if (!Number.isFinite(side.avoidanceCount) || side.avoidanceCount < 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `active War ${idStr} ${sideName} avoidanceCount=${side.avoidanceCount} must be finite and >= 0 (§14.7)`,
          })
        }
        if (new Set(side.commanderPersonIds).size !== side.commanderPersonIds.length) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `active War ${idStr} ${sideName} commanderPersonIds has duplicates (§14.7)`,
          })
        }
      }
    }

    // v0.43 W5: 両 side をまたいだ actor 重複なし (同一 polity が攻守両陣営にいることはない)。
    {
      const attackerKeys = new Set(war.attacker.participants.map((p) => politicalActorKey(p.actor)))
      for (const p of war.defender.participants) {
        if (attackerKeys.has(politicalActorKey(p.actor))) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} participant ${politicalActorKey(p.actor)} appears on both sides (v0.43 §14.4)`,
          })
        }
      }
    }

    // §14 WarGoal 検査 (spec §6.24 v0.34 / §6.27c PeaceSettlementSystem)
    //   参照存在 (holding/polity/landContract) は active War のみ要求する (participant 検査と対称)。
    //   terminal War は cleanup されるまで参照不問 — retention 中に別システム (税率改定外交・併合など) が
    //   参照先を消すのを許容する (WarGoal は和平適用済みの凍結履歴データのため)。
    //   active War で参照先が消えた stale ケースは PeaceSettlementSystem が white_peace で安全終結させる。
    //   range/value 検査 (税率 0..1, requiredWarScore>0, from≠to) は凍結値の不変条件なので status 無関係。
    const checkWarGoalRefs = war.status === 'active'
    for (const goal of war.warGoals) {
      if (goal.kind === 'transfer_land_contract') {
        if (checkWarGoalRefs && !state.holdings[goal.holdingId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} transfer goal references missing holding ${goal.holdingId as string} (§14.5)`,
          })
        }
        if (checkWarGoalRefs && !state.polities[goal.fromPolityId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} transfer goal references missing fromPolityId ${goal.fromPolityId as string} (§14.5)`,
          })
        }
        if (checkWarGoalRefs && !state.polities[goal.toPolityId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} transfer goal references missing toPolityId ${goal.toPolityId as string} (§14.5)`,
          })
        }
        if ((goal.fromPolityId as string) === (goal.toPolityId as string)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} transfer goal fromPolityId === toPolityId (§14.5)`,
          })
        }
        if (!(goal.requiredWarScore > 0)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} transfer goal requiredWarScore=${goal.requiredWarScore} must be > 0 (§14.5)`,
          })
        }
      } else if (goal.kind === 'change_contract_tax_rate') {
        if (checkWarGoalRefs) {
          if (!state.holdings[goal.holdingId]) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `War ${idStr} tax goal references missing holding ${goal.holdingId as string} (§14.5)`,
            })
          }
          const contract = state.landContracts[goal.landContractId]
          if (!contract) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `War ${idStr} tax goal references missing landContract ${goal.landContractId as string} (§14.5)`,
            })
          } else if ((contract.holdingId as string) !== (goal.holdingId as string)) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `War ${idStr} tax goal landContract.holdingId=${contract.holdingId as string} !== goal.holdingId=${goal.holdingId as string} (§14.5)`,
            })
          }
        }
        if (!(goal.newTaxRateToGrantor >= 0 && goal.newTaxRateToGrantor <= 1)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} tax goal newTaxRateToGrantor=${goal.newTaxRateToGrantor} out of range 0..1 (§14.5)`,
          })
        }
        // v0.34: baseTaxRateToGrantor は「開戦前の凍結 baseline」。0..1 の range のみ検査する。
        //   live 契約 rate との一致は検査しない (和平適用で乖離するのが正常挙動のため)。
        if (!(goal.baseTaxRateToGrantor >= 0 && goal.baseTaxRateToGrantor <= 1)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} tax goal baseTaxRateToGrantor=${goal.baseTaxRateToGrantor} out of range 0..1 (§14.5)`,
          })
        }
        if (!(goal.requiredWarScore > 0)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} tax goal requiredWarScore=${goal.requiredWarScore} must be > 0 (§14.5)`,
          })
        }
      } else if (goal.kind === 'popular_revolt_independence') {
        // v0.39: 叛乱独立 WarGoal の integrity 検査。
        if (checkWarGoalRefs) {
          if (!state.polities[goal.commonwealthPolityId]) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `War ${idStr} revolt goal references missing commonwealthPolityId ${goal.commonwealthPolityId as string}`,
            })
          }
          if (!state.polities[goal.originalHolderPolityId]) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `War ${idStr} revolt goal references missing originalHolderPolityId ${goal.originalHolderPolityId as string}`,
            })
          }
          for (const hid of goal.holdingIds) {
            if (!state.holdings[hid]) {
              errors.push({
                code: 'INTEGRITY_VIOLATION',
                message: `War ${idStr} revolt goal references missing holding ${hid as string}`,
              })
            }
          }
        }
        if (goal.holdingIds.length === 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} revolt goal holdingIds is empty`,
          })
        }
        if (!(goal.requiredWarScore > 0)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} revolt goal requiredWarScore=${goal.requiredWarScore} must be > 0`,
          })
        }
      }
    }
    // §14.6 originDiplomaticPlayId は weak ref のため存在検査しない。
  }

  // warIndex 双方向 (§14.7, Faction index パターン踏襲)
  // forward: byParticipant[key] の各 warId は存在し、その War に key 一致の participant がいる
  for (const [participantKey, warIds] of Object.entries(state.warIndex.byParticipant)) {
    for (const wid of warIds ?? []) {
      const war = state.wars[wid]
      if (!war) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `warIndex.byParticipant[${participantKey}] references missing War ${wid as string} (§14.7)`,
        })
        continue
      }
      const keys = [...war.attacker.participants, ...war.defender.participants].map((p) =>
        politicalActorKey(p.actor),
      )
      if (!keys.includes(participantKey)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `warIndex.byParticipant[${participantKey}] entry ${wid as string} has no matching participant (§14.7)`,
        })
      }
    }
  }
  // reverse: active War の各 participant key は byParticipant に warId を持つ
  for (const warIdStr of Object.keys(state.wars)) {
    const warId = warIdStr as WarId
    const war = state.wars[warId]
    if (!war || war.status !== 'active') continue
    for (const side of [war.attacker, war.defender]) {
      for (const p of side.participants) {
        const key = politicalActorKey(p.actor)
        const indexed = state.warIndex.byParticipant[key] ?? []
        if (!indexed.includes(warId)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `active War ${warIdStr} participant ${key} is not in warIndex.byParticipant (§14.7)`,
          })
        }
      }
    }
  }
  // byOriginDiplomaticPlay forward: 指す War が存在し originDiplomaticPlayId が一致
  for (const [playIdStr, wid] of Object.entries(state.warIndex.byOriginDiplomaticPlay)) {
    if (wid === undefined) continue
    const war = state.wars[wid]
    if (!war) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `warIndex.byOriginDiplomaticPlay[${playIdStr}] references missing War ${wid as string} (§14.7)`,
      })
      continue
    }
    if ((war.originDiplomaticPlayId as string | undefined) !== playIdStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `warIndex.byOriginDiplomaticPlay[${playIdStr}] entry ${wid as string} has originDiplomaticPlayId=${(war.originDiplomaticPlayId as string | undefined) ?? 'undefined'} (§14.7)`,
      })
    }
  }

  // ─── §18 (v0.36): Regiment / Battle 整合性 ───
  //   値域・status・index↔record の構造整合のみ検査する。
  //   soft reference (currentWarId/currentSide が live war を指す / owner active / homeHolding 存在) は
  //   hard invariant にしない (§18.4。RegimentMaintenanceSystem が lazy 処理する)。
  const VALID_REGIMENT_STATUSES = ['active', 'disbanded', 'destroyed']
  const VALID_REGIMENT_SOURCE_KINDS = [
    'levy',
    'urban_militia',
    'noble_retinue',
    'mercenary',
    'local_levy',
  ]
  const VALID_REGIMENT_TROOP_KINDS = ['infantry', 'cavalry']
  for (const idStr of Object.keys(state.regiments)) {
    const regiment = state.regiments[idStr as RegimentId]
    if (!regiment) continue
    if ((regiment.id as string) !== idStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr}: regiment.id=${regiment.id as string} does not match record key (§18)`,
      })
    }
    if (!VALID_REGIMENT_STATUSES.includes(regiment.status)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} has invalid status ${regiment.status} (§18.2)`,
      })
    }
    if (!VALID_REGIMENT_SOURCE_KINDS.includes(regiment.sourceKind)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} has invalid sourceKind ${regiment.sourceKind} (§18)`,
      })
    }
    if (!VALID_REGIMENT_TROOP_KINDS.includes(regiment.troopKind)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} has invalid troopKind ${regiment.troopKind} (§18)`,
      })
    }
    if (!(regiment.maxStrength > 0)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} maxStrength=${regiment.maxStrength} must be > 0 (§18.1)`,
      })
    } else if (
      !Number.isFinite(regiment.strength) ||
      regiment.strength < 0 ||
      regiment.strength > regiment.maxStrength
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} strength=${regiment.strength} out of range 0..maxStrength(${regiment.maxStrength}) (§18.1)`,
      })
    }
    if (
      !Number.isFinite(regiment.organization) ||
      regiment.organization < 0 ||
      regiment.organization > regiment.maxOrganization
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} organization=${regiment.organization} out of range 0..maxOrganization(${regiment.maxOrganization}) (§18.1)`,
      })
    }
    if (
      !Number.isFinite(regiment.morale) ||
      regiment.morale < 0 ||
      regiment.morale > regiment.maxMorale
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} morale=${regiment.morale} out of range 0..maxMorale(${regiment.maxMorale}) (§18.1)`,
      })
    }
    // §3 (v0.37): baseline / max の構造整合。0 <= baseline <= max <= hardCap (hardCap は config 経由・任意)。
    const orgHardCap = config?.regimentMaxOrganizationHardCap
    if (
      !Number.isFinite(regiment.baselineOrganization) ||
      !Number.isFinite(regiment.maxOrganization) ||
      regiment.baselineOrganization < 0 ||
      regiment.baselineOrganization > regiment.maxOrganization ||
      (orgHardCap !== undefined && regiment.maxOrganization > orgHardCap)
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} organization baseline/max invalid: baseline=${regiment.baselineOrganization} max=${regiment.maxOrganization} (need 0<=baseline<=max<=hardCap) (§18.1)`,
      })
    }
    const moraleHardCap = config?.regimentMaxMoraleHardCap
    if (
      !Number.isFinite(regiment.baselineMorale) ||
      !Number.isFinite(regiment.maxMorale) ||
      regiment.baselineMorale < 0 ||
      regiment.baselineMorale > regiment.maxMorale ||
      (moraleHardCap !== undefined && regiment.maxMorale > moraleHardCap)
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} morale baseline/max invalid: baseline=${regiment.baselineMorale} max=${regiment.maxMorale} (need 0<=baseline<=max<=hardCap) (§18.1)`,
      })
    }
    if (!Number.isFinite(regiment.basePower) || regiment.basePower < 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} basePower=${regiment.basePower} must be finite and >= 0 (§18.1)`,
      })
    }
    // currentWarId と currentSide は両方揃うか両方無いか (構造整合。war の liveness は検査しない)。
    if ((regiment.currentWarId === undefined) !== (regiment.currentSide === undefined)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} currentWarId/currentSide must both be set or both unset (§18)`,
      })
    }
    // v0.36 補充・再編成: destroyedWeek/lastReinforcedWeek は createdWeek..currentWeek の範囲。
    if (
      regiment.destroyedWeek !== undefined &&
      (!Number.isFinite(regiment.destroyedWeek) ||
        regiment.destroyedWeek < regiment.createdWeek ||
        regiment.destroyedWeek > state.absoluteWeek)
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} destroyedWeek=${regiment.destroyedWeek} out of range createdWeek(${regiment.createdWeek})..currentWeek(${state.absoluteWeek}) (§18.1)`,
      })
    }
    if (
      regiment.lastReinforcedWeek !== undefined &&
      (!Number.isFinite(regiment.lastReinforcedWeek) ||
        regiment.lastReinforcedWeek < regiment.createdWeek ||
        regiment.lastReinforcedWeek > state.absoluteWeek)
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} lastReinforcedWeek=${regiment.lastReinforcedWeek} out of range createdWeek(${regiment.createdWeek})..currentWeek(${state.absoluteWeek}) (§18.1)`,
      })
    }
    // destroyedWeek は status==='destroyed' のときだけ持つ (reform で消去される)。
    if (regiment.status !== 'destroyed' && regiment.destroyedWeek !== undefined) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} has destroyedWeek but status=${regiment.status} (§18.2)`,
      })
    }
    if (regiment.sourceKind === 'local_levy') {
      if (regiment.disbandAfterWar !== true) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Regiment ${idStr} local_levy must have disbandAfterWar=true (v0.39 §17.3)`,
        })
      }
      if (regiment.homeHoldingId === undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Regiment ${idStr} local_levy must have homeHoldingId (v0.39 §17.3)`,
        })
      }
    }
    // v0.47 §19.2: titular Polity は active Regiment を持たない (maintenance reassign を前提)。
    if (regiment.status === 'active' && regiment.owner.kind === 'polity') {
      const op = state.polities[regiment.owner.id]
      if (op && getPolityTerritorialStatus(op) === 'titular') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Regiment ${idStr} is active but owned by titular Polity ${regiment.owner.id} (v0.47 §19.2)`,
        })
      }
    }
  }
  // index → record 整合 (§18.3)。liveness ではなく「index entry が指す Regiment が存在し key と一致するか」。
  for (const [ownerKey, ids] of Object.entries(state.regimentIndex.byOwner)) {
    for (const rid of ids) {
      const r = state.regiments[rid]
      if (!r) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byOwner[${ownerKey}] references missing Regiment ${rid as string} (§18.3)`,
        })
      } else if (politicalActorKey(r.owner) !== ownerKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byOwner[${ownerKey}] entry ${rid as string} has owner ${politicalActorKey(r.owner)} (§18.3)`,
        })
      }
    }
  }
  for (const [warIdStr, ids] of Object.entries(state.regimentIndex.byWar)) {
    for (const rid of ids) {
      const r = state.regiments[rid]
      if (!r) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byWar[${warIdStr}] references missing Regiment ${rid as string} (§18.3)`,
        })
      } else if ((r.currentWarId as string | undefined) !== warIdStr) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byWar[${warIdStr}] entry ${rid as string} has currentWarId=${(r.currentWarId as string | undefined) ?? 'undefined'} (§18.3)`,
        })
      }
    }
  }
  for (const [holdingIdStr, ids] of Object.entries(state.regimentIndex.byHomeHolding)) {
    for (const rid of ids) {
      const r = state.regiments[rid]
      if (!r) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byHomeHolding[${holdingIdStr}] references missing Regiment ${rid as string} (§18.3)`,
        })
      } else if ((r.homeHoldingId as string | undefined) !== holdingIdStr) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byHomeHolding[${holdingIdStr}] entry ${rid as string} home mismatch (§18.3)`,
        })
      }
    }
  }
  for (const [provinceIdStr, ids] of Object.entries(state.regimentIndex.byHomeProvince)) {
    for (const rid of ids) {
      const r = state.regiments[rid]
      if (!r) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byHomeProvince[${provinceIdStr}] references missing Regiment ${rid as string} (§18.3)`,
        })
      } else if ((r.homeProvinceId as string | undefined) !== provinceIdStr) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byHomeProvince[${provinceIdStr}] entry ${rid as string} home mismatch (§18.3)`,
        })
      }
    }
  }
  // Battle: id↔key + warScore 値域 + battleIndex↔record 整合。
  for (const idStr of Object.keys(state.battles)) {
    const battle = state.battles[idStr as BattleId]
    if (!battle) continue
    if ((battle.id as string) !== idStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Battle ${idStr}: battle.id=${battle.id as string} does not match record key (§18)`,
      })
    }
    if (!Number.isFinite(battle.warScoreAfter) || !Number.isFinite(battle.warScoreDelta)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Battle ${idStr} warScore values must be finite (§18)`,
      })
    }

    // §18 (v0.37): Battle summary invariants (set されたフィールドのみ検査)。
    if (battle.frontage !== undefined && battle.frontage <= 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Battle ${idStr} frontage=${battle.frontage} must be > 0 (§18)`,
      })
    }
    if (
      battle.ticksElapsed !== undefined &&
      battle.maxTicks !== undefined &&
      battle.ticksElapsed > battle.maxTicks
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Battle ${idStr} ticksElapsed=${battle.ticksElapsed} > maxTicks=${battle.maxTicks} (§18)`,
      })
    }
    const atkSet = new Set<RegimentId>(battle.attackerRegimentIds)
    const defSet = new Set<RegimentId>(battle.defenderRegimentIds)
    const unionSet = new Set<RegimentId>([
      ...battle.attackerRegimentIds,
      ...battle.defenderRegimentIds,
    ])
    const checkSubset = (
      ids: RegimentId[] | undefined,
      allowed: Set<RegimentId>,
      label: string,
    ): void => {
      if (!ids) return
      for (const id of ids) {
        if (!allowed.has(id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Battle ${idStr} ${label} references ${id} not in side regiments (§18)`,
          })
        }
      }
    }
    checkSubset(battle.attackerInitialFrontlineIds, atkSet, 'attackerInitialFrontlineIds')
    checkSubset(battle.defenderInitialFrontlineIds, defSet, 'defenderInitialFrontlineIds')
    checkSubset(battle.attackerRoutedRegimentIds, atkSet, 'attackerRoutedRegimentIds')
    checkSubset(battle.defenderRoutedRegimentIds, defSet, 'defenderRoutedRegimentIds')
    for (const rr of battle.regimentResults) {
      if (!unionSet.has(rr.regimentId)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Battle ${idStr} regimentResult references ${rr.regimentId} not in attacker∪defender (§18)`,
        })
      }
    }
    for (const ca of [
      ...(battle.attackerCommanderAssignments ?? []),
      ...(battle.defenderCommanderAssignments ?? []),
    ]) {
      if (!unionSet.has(ca.regimentId)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Battle ${idStr} commanderAssignment references ${ca.regimentId} not in attacker∪defender (§18)`,
        })
      }
    }
  }
  for (const [warIdStr, ids] of Object.entries(state.battleIndex.byWar)) {
    for (const bid of ids) {
      const b = state.battles[bid]
      if (!b) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `battleIndex.byWar[${warIdStr}] references missing Battle ${bid as string} (§18.3)`,
        })
      } else if ((b.warId as string) !== warIdStr) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `battleIndex.byWar[${warIdStr}] entry ${bid as string} has warId=${b.warId as string} (§18.3)`,
        })
      }
    }
  }
}
