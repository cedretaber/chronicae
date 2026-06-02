import type { TickContext } from './context'
import type { PersonId, HouseId } from '../types/ids'
import type { Person, LifeStage } from '../types/person'
import { isLifeStageAtLeast } from '../types/person'
import type { AttitudeMap, AttitudeKey } from '../types/attitude'
import type { SimulationConfig } from '../config/defaultConfig'
import { getHouseLeader } from '../selectors/officeSelectors'
import {
  getActiveFactionMembership,
  getFactionActiveMemberIds,
} from '../selectors/factionSelectors'
import { lerpAttitude } from '../helpers/attitudeHelpers'

// 影響元の種別（影響率テーブルの選択に使う）。
type InfluencerKind = 'parent' | 'houseLeader' | 'houseAdult' | 'parentFaction'

type Influencer = { id: PersonId; kind: InfluencerKind }

// 種別 × LifeStage の影響率を引く（config のテーブルから。未定義は 0）。
function influenceRate(config: SimulationConfig, kind: InfluencerKind, stage: LifeStage): number {
  switch (kind) {
    case 'parent':
      return config.lifeStageParentInfluenceRateByStage[stage] ?? 0
    case 'houseLeader':
      return config.lifeStageHouseLeaderInfluenceRateByStage[stage] ?? 0
    case 'houseAdult':
      return config.lifeStageHouseAdultInfluenceRateByStage[stage] ?? 0
    case 'parentFaction':
      return config.lifeStageParentFactionInfluenceRateByStage[stage] ?? 0
  }
}

// person/house を指す attitude key のみ対象にする（§7.5: polity target は継承しない）。
function isInheritableTargetKey(key: AttitudeKey): boolean {
  return key.startsWith('person:') || key.startsWith('house:')
}

// §7.5: 継承対象は「現存するエンティティ」のみ（v0.40 拡張）。
//   person: → 生存している人物 / house: → active な家。
//   故人・消滅した家への感情は引き継がない（噂でだけ知る対象は現段階では非対象）。
function isLiveTargetKey(state: TickContext['state'], key: AttitudeKey): boolean {
  if (key.startsWith('person:')) {
    const id = key.slice('person:'.length) as PersonId
    const p = state.persons[id]
    return Boolean(p && p.alive)
  }
  if (key.startsWith('house:')) {
    const id = key.slice('house:'.length) as HouseId
    const h = state.houses[id]
    return Boolean(h && h.active)
  }
  return false
}

// 有効な influencer（実在・生存・非 placeholder・child 自身でない）か。
function isValidInfluencer(state: TickContext['state'], id: PersonId, childId: PersonId): boolean {
  if (id === childId) return false
  const p = state.persons[id]
  return Boolean(p && p.alive && p.kind !== 'placeholder')
}

// §7.4 / §7.7: 影響元を deterministic 順（父→母→house leader→同家成人→親 faction）で収集し、
//   重複排除のうえ合計上限 maxLifeStageInfluencersPerChild まで取る（father/mother 優先）。
function collectInfluencers(
  state: TickContext['state'],
  config: SimulationConfig,
  child: Person,
): Influencer[] {
  const result: Influencer[] = []
  const seen = new Set<PersonId>()
  const limit = config.maxLifeStageInfluencersPerChild

  const push = (id: PersonId, kind: InfluencerKind): boolean => {
    if (result.length >= limit) return false
    if (seen.has(id)) return true
    if (!isValidInfluencer(state, id, child.id)) return true
    seen.add(id)
    result.push({ id, kind })
    return true
  }

  // 1) 父母（最優先）
  if (child.fatherId) push(child.fatherId, 'parent')
  if (child.motherId) push(child.motherId, 'parent')

  // 2) 同 House の leader / 3) 同家成人
  if (child.houseId && result.length < limit) {
    const leaderId = getHouseLeader(state, child.houseId)
    if (leaderId) push(leaderId, 'houseLeader')

    const house = state.houses[child.houseId]
    if (house) {
      const adults = house.memberIds
        .filter((mid) => {
          const m = state.persons[mid]
          return Boolean(
            m &&
            m.alive &&
            m.kind !== 'placeholder' &&
            isLifeStageAtLeast(m.lifeStage, 'young_adulthood'),
          )
        })
        .sort()
      for (const mid of adults) {
        if (result.length >= limit) break
        push(mid, 'houseAdult')
      }
    }
  }

  // 4) 親が所属する active faction の active member
  if (result.length < limit) {
    for (const parentId of [child.fatherId, child.motherId]) {
      if (result.length >= limit) break
      if (!parentId) continue
      const membership = getActiveFactionMembership(state, parentId)
      if (!membership) continue
      const members = getFactionActiveMemberIds(state, membership.factionId) // 既に PersonId 昇順
      for (const mid of members) {
        if (result.length >= limit) break
        push(mid, 'parentFaction')
      }
    }
  }

  return result
}

// §7.5: influencer の attitudes から person/house target を抽出し、
//   abs(affection)+abs(respect) 降順・key 昇順で上位 maxAttitudeTargetsInheritedPerInfluencer 件を返す。
//   child 自身を指す target、および現存しない対象（故人・消滅家）は top-N 選択前に除外する。
function selectTopTargets(
  state: TickContext['state'],
  attitudes: AttitudeMap,
  limit: number,
  childKey: AttitudeKey,
): AttitudeKey[] {
  const keys = Object.keys(attitudes).filter(
    (k) => isInheritableTargetKey(k) && k !== childKey && isLiveTargetKey(state, k),
  )
  keys.sort((a, b) => {
    const av = attitudes[a]
    const bv = attitudes[b]
    const am = av ? Math.abs(av.affection) + Math.abs(av.respect) : 0
    const bm = bv ? Math.abs(bv.affection) + Math.abs(bv.respect) : 0
    if (bm !== am) return bm - am
    return a.localeCompare(b)
  })
  return keys.slice(0, limit)
}

/**
 * v0.40 §7: 幼年期 / 思春期の人物が、親・家 leader・同家成人・親 faction member の
 * Attitude を少しずつ継承する（社会的「思想」形成の最初の実装）。
 * RNG 不使用の決定的処理。LifeStageProgressionSystem の直前に走る（§5.3 / §7.3）。
 */
export function runLifeStageInfluenceSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const updated: Record<PersonId, AttitudeMap> = {}

  for (const childId of ctx.state.livingPersonIds) {
    const child = ctx.state.persons[childId]
    if (!child || !child.alive) continue
    if (child.kind === 'placeholder') continue
    if (child.lifeStage !== 'childhood' && child.lifeStage !== 'adolescence') continue

    const influencers = collectInfluencers(ctx.state, config, child)
    if (influencers.length === 0) continue

    const childKey: AttitudeKey = `person:${childId}`
    let attitudes: AttitudeMap | undefined

    for (const influencer of influencers) {
      const rate = influenceRate(config, influencer.kind, child.lifeStage)
      if (rate <= 0) continue
      const source = ctx.state.persons[influencer.id]
      if (!source) continue

      const targetKeys = selectTopTargets(
        ctx.state,
        source.attitudes,
        config.maxAttitudeTargetsInheritedPerInfluencer,
        childKey,
      )
      for (const key of targetKeys) {
        const targetAttitude = source.attitudes[key]
        if (!targetAttitude) continue
        const base = attitudes ?? child.attitudes
        attitudes = {
          ...base,
          [key]: lerpAttitude(base[key], targetAttitude, rate),
        }
      }
    }

    if (attitudes) updated[childId] = attitudes
  }

  if (Object.keys(updated).length === 0) return ctx

  const newPersons = { ...ctx.state.persons }
  for (const [id, attitudes] of Object.entries(updated)) {
    const pid = id as PersonId
    const p = newPersons[pid]
    if (p) newPersons[pid] = { ...p, attitudes }
  }

  return { ...ctx, state: { ...ctx.state, persons: newPersons } }
}
