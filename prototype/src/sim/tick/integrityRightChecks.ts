// v0.42 PoliticalRight の integrity checks (spec v0.42 §8 R1-R6)。
//
// R1-R4 は年末契約 (中間 tick の transient は即時 cascade + rightConsistencySystem が回収)。
// R5/R6 は常時成立すべき構造的 invariant (index は mutation 層でのみ更新されるため)。

import type { PoliticalRightId } from '../types/ids'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import { politicalRightTargetKey, politicalRightHolderKey } from '../types/politicalRight'
import { getOfficeDefinition } from '../config/officeDefinitions'
import { getPolityTerritorialStatus } from '../types/polity'

export function checkPoliticalRights(state: WorldState, errors: SimError[]): void {
  for (const rightIdStr of Object.keys(state.politicalRights)) {
    const rightId = rightIdStr as PoliticalRightId
    const right = state.politicalRights[rightId]
    if (!right) continue

    // R1: holder は存在し有効 (person: alive かつ normal / house: active)
    if (right.holder.kind === 'person') {
      const person = state.persons[right.holder.id]
      if (!person || !person.alive || person.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `PoliticalRight ${rightId} person holder ${right.holder.id} is not alive / normal (v0.42 R1)`,
        })
      }
    } else {
      const house = state.houses[right.holder.id]
      if (!house || !house.active) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `PoliticalRight ${rightId} house holder ${right.holder.id} is not active (v0.42 R1)`,
        })
      }
    }

    // R2: polityId は active Polity
    const polity = state.polities[right.polityId]
    if (!polity || !polity.active) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PoliticalRight ${rightId} polity ${right.polityId} is not active (v0.42 R2)`,
      })
    }
    // v0.47 §19.2: titular Polity は active PoliticalRight を持たない
    if (polity && getPolityTerritorialStatus(polity) === 'titular') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PoliticalRight ${rightId} on titular Polity ${right.polityId} (v0.47 §19.2)`,
      })
    }

    // R3: target 実在 / R4: target と polityId の整合
    switch (right.target.kind) {
      case 'polity_office_role': {
        if (right.target.role === 'leader') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `PoliticalRight ${rightId} targets leader role (v0.42 R3 / §9.1)`,
          })
        }
        // slot 単位 (v0.42 slot 化): slotIndex は 0 <= slot < 静的 maxHolders。
        // 動的 effectiveMax の縮小は rightConsistencySystem が回収するため、ここでは
        // 静的上限のみ課す (縮小〜回収間の transient を violation にしない)。
        const def = getOfficeDefinition('polity', right.target.role)
        const staticMax = def ? def.maxHolders : 1
        if (
          !Number.isInteger(right.target.slotIndex) ||
          right.target.slotIndex < 0 ||
          right.target.slotIndex >= staticMax
        ) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `PoliticalRight ${rightId} office target slotIndex ${right.target.slotIndex} out of range [0, ${staticMax}) (v0.42 R3)`,
          })
        }
        if (right.target.polityId !== right.polityId) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `PoliticalRight ${rightId} office target polity ${right.target.polityId} !== right.polityId ${right.polityId} (v0.42 R4)`,
          })
        }
        break
      }
      case 'holding_office_role': {
        const holding = state.holdings[right.target.holdingId]
        if (!holding) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `PoliticalRight ${rightId} holding target ${right.target.holdingId} not found (v0.42 R3)`,
          })
          break
        }
        const terminal = state.holdingTerminalPolityCache[right.target.holdingId]
        if (terminal !== right.polityId) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `PoliticalRight ${rightId} holding ${right.target.holdingId} terminal polity ${String(terminal)} !== right.polityId ${right.polityId} (v0.42 R4)`,
          })
        }
        break
      }
      case 'regiment': {
        const regiment = state.regiments[right.target.regimentId]
        if (!regiment || regiment.status === 'disbanded') {
          // destroyed は許容 (§11: 制度的単位として right は存続、influence 寄与のみ 0)
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `PoliticalRight ${rightId} regiment target ${right.target.regimentId} is missing or disbanded (v0.42 R3)`,
          })
          break
        }
        if (regiment.owner.kind !== 'polity' || regiment.owner.id !== right.polityId) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `PoliticalRight ${rightId} regiment ${right.target.regimentId} owner ${regiment.owner.kind}:${regiment.owner.id} !== polity:${right.polityId} (v0.42 R4)`,
          })
        }
        break
      }
    }

    // R5 (rights → index 方向): 3 index すべてに登録されていること
    const targetKey = politicalRightTargetKey(right.target)
    const holderKey = politicalRightHolderKey(right.holder)
    if (!(state.politicalRightIndex.byPolity[right.polityId] ?? []).includes(rightId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PoliticalRight ${rightId} missing from politicalRightIndex.byPolity[${right.polityId}] (v0.42 R5)`,
      })
    }
    if (!(state.politicalRightIndex.byHolder[holderKey] ?? []).includes(rightId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PoliticalRight ${rightId} missing from politicalRightIndex.byHolder[${holderKey}] (v0.42 R5)`,
      })
    }
    if (!(state.politicalRightIndex.byTarget[targetKey] ?? []).includes(rightId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PoliticalRight ${rightId} missing from politicalRightIndex.byTarget[${targetKey}] (v0.42 R5)`,
      })
    }
  }

  // R5 (index → rights 方向): index の全 entry が実在の right を指し、キーが一致すること
  for (const [polityKey, ids] of Object.entries(state.politicalRightIndex.byPolity)) {
    for (const id of ids ?? []) {
      const right = state.politicalRights[id]
      if (!right) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `politicalRightIndex.byPolity[${polityKey}] references missing right ${id} (v0.42 R5)`,
        })
      } else if ((right.polityId as string) !== polityKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `politicalRightIndex.byPolity[${polityKey}] entry ${id} has polityId=${right.polityId} (v0.42 R5)`,
        })
      }
    }
  }
  for (const [holderKey, ids] of Object.entries(state.politicalRightIndex.byHolder)) {
    for (const id of ids ?? []) {
      const right = state.politicalRights[id]
      if (!right) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `politicalRightIndex.byHolder[${holderKey}] references missing right ${id} (v0.42 R5)`,
        })
      } else if (politicalRightHolderKey(right.holder) !== holderKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `politicalRightIndex.byHolder[${holderKey}] entry ${id} has holder=${politicalRightHolderKey(right.holder)} (v0.42 R5)`,
        })
      }
    }
  }
  for (const [targetKey, ids] of Object.entries(state.politicalRightIndex.byTarget)) {
    for (const id of ids ?? []) {
      const right = state.politicalRights[id]
      if (!right) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `politicalRightIndex.byTarget[${targetKey}] references missing right ${id} (v0.42 R5)`,
        })
      } else if (politicalRightTargetKey(right.target) !== targetKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `politicalRightIndex.byTarget[${targetKey}] entry ${id} has target=${politicalRightTargetKey(right.target)} (v0.42 R5)`,
        })
      }
    }
    // R6: 1 target 1 active right
    if ((ids ?? []).length > 1) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `politicalRightIndex.byTarget[${targetKey}] has ${(ids ?? []).length} rights, expected <= 1 (v0.42 R6)`,
      })
    }
  }
}
