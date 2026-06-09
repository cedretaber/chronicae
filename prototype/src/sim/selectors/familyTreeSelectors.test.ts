import { describe, expect, it } from 'vitest'
import { createHouseId, createPersonId } from '../types/ids'
import type { HouseId, PersonId, ProvinceId } from '../types/ids'
import type { Person } from '../types/person'
import type { House } from '../types/house'
import type { WorldState } from '../types/world'
import { makeEmptyV016State, buildLivingPersonIds } from '../testFixtures'
import { buildHouseFamilyTree } from './familyTreeSelectors'
import type { FamilyTreeNode } from './familyTreeSelectors'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makePerson(id: PersonId, houseId: HouseId, overrides: Partial<Person> = {}): Person {
  return {
    id,
    nameKey: id,
    sex: 'male',
    age: 30,
    lifeStage: 'young_adulthood',
    alive: true,
    houseId,
    childIds: [],
    birthStatus: 'legitimate',
    abilities: DEFAULT_ABILITIES,
    aptitudes: DEFAULT_ABILITIES,
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
    ...overrides,
  }
}

function makeHouse(id: HouseId, overrides: Partial<House> = {}): House {
  return {
    id,
    nameKey: id,
    active: true,
    memberIds: [],
    deceasedMemberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: 'pr-0' as ProvinceId,
    ...overrides,
  }
}

function buildState(persons: Record<PersonId, Person>, houses: Record<HouseId, House>): WorldState {
  return {
    ...makeEmptyV016State(),
    persons,
    houses,
    livingPersonIds: buildLivingPersonIds(persons),
  }
}

function nodeOf(nodes: FamilyTreeNode[], id: PersonId): FamilyTreeNode | undefined {
  return nodes.find((n) => (n.personId as string) === (id as string))
}

describe('buildHouseFamilyTree', () => {
  // 共通シナリオ: house H (h-0) の 3 世代血統 + 婚姻 in/out + 別家 B (h-1)。
  //   F(founder) = W (W は B より嫁入り)
  //   └ S = W2 (W2 は B より嫁入り)
  //       ├ G  (H に残留 = blood)
  //       └ C  (B へ婚出 = married_out)
  const H = createHouseId('h', 0)
  const B = createHouseId('h', 1)
  const F = createPersonId('pe', 0)
  const W = createPersonId('pe', 1)
  const S = createPersonId('pe', 2)
  const W2 = createPersonId('pe', 3)
  const G = createPersonId('pe', 4)
  const C = createPersonId('pe', 5)
  const WFather = createPersonId('pe', 10) // W の父 (house B)
  const W2Father = createPersonId('pe', 11) // W2 の父 (house B)

  function commonScenario(): WorldState {
    const persons: Record<PersonId, Person> = {
      [F]: makePerson(F, H, { spouseId: W, childIds: [S] }),
      [W]: makePerson(W, H, { sex: 'female', spouseId: F, fatherId: WFather, childIds: [S] }),
      [S]: makePerson(S, H, { fatherId: F, motherId: W, spouseId: W2, childIds: [G, C] }),
      [W2]: makePerson(W2, H, { sex: 'female', spouseId: S, fatherId: W2Father, childIds: [G, C] }),
      [G]: makePerson(G, H, { fatherId: S, motherId: W2 }),
      [C]: makePerson(C, B, { fatherId: S, motherId: W2 }), // 婚出: house B 所属
      [WFather]: makePerson(WFather, B),
      [W2Father]: makePerson(W2Father, B),
    }
    const houses: Record<HouseId, House> = {
      [H]: makeHouse(H, { founderId: F, memberIds: [F, W, S, W2, G] }),
      [B]: makeHouse(B, { memberIds: [WFather, W2Father, C] }),
    }
    return buildState(persons, houses)
  }

  it('blood の世代を親子リンクで正しく付与する', () => {
    const { nodes } = buildHouseFamilyTree(commonScenario(), H)
    expect(nodeOf(nodes, F)?.generation).toBe(0)
    expect(nodeOf(nodes, S)?.generation).toBe(1)
    expect(nodeOf(nodes, G)?.generation).toBe(2)
    expect(nodeOf(nodes, F)?.relation).toBe('blood')
    expect(nodeOf(nodes, S)?.relation).toBe('blood')
    expect(nodeOf(nodes, G)?.relation).toBe('blood')
  })

  it('嫁入りした配偶者を married_in + 出生家リンク付きで分類する', () => {
    const { nodes } = buildHouseFamilyTree(commonScenario(), H)
    const w = nodeOf(nodes, W)
    expect(w?.relation).toBe('married_in')
    expect(w?.otherHouseId).toBe(B)
    expect(w?.generation).toBe(0) // 配偶者 F と同世代
    const w2 = nodeOf(nodes, W2)
    expect(w2?.relation).toBe('married_in')
    expect(w2?.otherHouseId).toBe(B)
    expect(w2?.generation).toBe(1) // 配偶者 S と同世代
  })

  it('別家へ婚出した子を married_out + 現在の家リンク付きで分類する', () => {
    const { nodes } = buildHouseFamilyTree(commonScenario(), H)
    const c = nodeOf(nodes, C)
    expect(c?.relation).toBe('married_out')
    expect(c?.otherHouseId).toBe(B)
    expect(c?.generation).toBe(2) // 親 S の世代 + 1
  })

  it('家外の人物 (出生家の親など) はノードに含めない', () => {
    const { nodes } = buildHouseFamilyTree(commonScenario(), H)
    expect(nodeOf(nodes, WFather)).toBeUndefined()
    expect(nodeOf(nodes, W2Father)).toBeUndefined()
    expect(nodes).toHaveLength(6) // F, W, S, W2, G, C
  })

  it('parent_child エッジを両親分張る', () => {
    const { edges } = buildHouseFamilyTree(commonScenario(), H)
    const pc = edges.filter((e) => e.kind === 'parent_child')
    const has = (parentId: PersonId, childId: PersonId): boolean =>
      pc.some(
        (e) =>
          e.kind === 'parent_child' &&
          (e.parentId as string) === (parentId as string) &&
          (e.childId as string) === (childId as string),
      )
    expect(has(F, S)).toBe(true)
    expect(has(W, S)).toBe(true)
    expect(has(S, G)).toBe(true)
    expect(has(W2, G)).toBe(true)
    expect(has(S, C)).toBe(true)
    expect(has(W2, C)).toBe(true)
  })

  it('spouse エッジを正規化して dedupe する', () => {
    const { edges } = buildHouseFamilyTree(commonScenario(), H)
    const sp = edges.filter((e) => e.kind === 'spouse')
    expect(sp).toHaveLength(2) // F-W, S-W2 (重複なし)
    for (const e of sp) {
      if (e.kind !== 'spouse') continue
      expect((e.aId as string) < (e.bId as string)).toBe(true) // aId < bId 正規化
    }
  })

  it('故人 (deceasedMemberIds) も世代に含める', () => {
    const dead = createPersonId('pe', 20)
    const heir = createPersonId('pe', 21)
    const persons: Record<PersonId, Person> = {
      [dead]: makePerson(dead, H, { alive: false, childIds: [heir] }),
      [heir]: makePerson(heir, H, { fatherId: dead }),
    }
    const houses: Record<HouseId, House> = {
      [H]: makeHouse(H, { founderId: dead, memberIds: [heir], deceasedMemberIds: [dead] }),
    }
    const { nodes } = buildHouseFamilyTree(buildState(persons, houses), H)
    expect(nodeOf(nodes, dead)?.relation).toBe('blood')
    expect(nodeOf(nodes, dead)?.generation).toBe(0)
    expect(nodeOf(nodes, heir)?.generation).toBe(1)
  })

  it('死別で spouseId が消えた婚入配偶者も出生家から married_in と判定する', () => {
    // mother は死亡し clearSpouse 済 (spouseId なし) だが、父が別家 B にいる → married_in を保つ。
    const father = createPersonId('pe', 40) // blood (founder)
    const mother = createPersonId('pe', 41) // 婚入・故人・spouseId なし
    const child = createPersonId('pe', 42)
    const motherFather = createPersonId('pe', 43) // mother の父 (house B)
    const persons: Record<PersonId, Person> = {
      [father]: makePerson(father, H, { childIds: [child] }), // spouseId なし (死別)
      [mother]: makePerson(mother, H, {
        sex: 'female',
        alive: false,
        fatherId: motherFather,
        childIds: [child],
      }),
      [child]: makePerson(child, H, { fatherId: father, motherId: mother }),
      [motherFather]: makePerson(motherFather, B),
    }
    const houses: Record<HouseId, House> = {
      [H]: makeHouse(H, {
        founderId: father,
        memberIds: [father, child],
        deceasedMemberIds: [mother],
      }),
      [B]: makeHouse(B, { memberIds: [motherFather] }),
    }
    const { nodes } = buildHouseFamilyTree(buildState(persons, houses), H)
    const m = nodeOf(nodes, mother)
    expect(m?.relation).toBe('married_in')
    expect(m?.otherHouseId).toBe(B)
  })

  it('死別した子の無い夫婦も formerSpouseIds から spouse エッジ + married_in を保つ', () => {
    // 夫 (blood) が死亡し spouseId は clear 済だが、双方 formerSpouseIds に記録あり。
    // 子はいないが元配偶者から夫婦関係を再構成できる。
    const husband = createPersonId('pe', 50) // blood (founder)・故人
    const widow = createPersonId('pe', 51) // 婚入・子なし・夫と死別 (出生家不明)
    const persons: Record<PersonId, Person> = {
      [husband]: makePerson(husband, H, { alive: false, formerSpouseIds: [widow] }),
      [widow]: makePerson(widow, H, { sex: 'female', formerSpouseIds: [husband] }),
    }
    const houses: Record<HouseId, House> = {
      [H]: makeHouse(H, {
        founderId: husband,
        memberIds: [widow],
        deceasedMemberIds: [husband],
      }),
    }
    const { nodes, edges } = buildHouseFamilyTree(buildState(persons, houses), H)
    const sp = edges.filter((e) => e.kind === 'spouse')
    expect(sp).toHaveLength(1) // 1 本 (重複なし)
    expect(nodeOf(nodes, widow)?.relation).toBe('married_in') // 元配偶者が blood → married_in
  })

  it('親も配偶者も無い起源シードを blood にする', () => {
    const seed = createPersonId('pe', 30)
    const persons: Record<PersonId, Person> = {
      [seed]: makePerson(seed, H),
    }
    const houses: Record<HouseId, House> = {
      [H]: makeHouse(H, { memberIds: [seed] }),
    }
    const { nodes } = buildHouseFamilyTree(buildState(persons, houses), H)
    expect(nodeOf(nodes, seed)?.relation).toBe('blood')
    expect(nodeOf(nodes, seed)?.generation).toBe(0)
  })

  it('存在しない家門は空グラフを返す', () => {
    const state = buildState({}, {})
    const graph = buildHouseFamilyTree(state, createHouseId('h', 99))
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
  })
})
