// v0.60 回帰: acquire_real_estate 完成時、seller への支払いは budget.allocated (実際に集めた額)
//   であり salePrice ではない。under-funded 完了でも貨幣創造にならない (保存則)。
import { describe, expect, it } from 'vitest'
import {
  makeEmptyV016State,
  withHouse,
  withPolity,
  withPerson,
  withProvince,
  withHolding,
} from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext } from './context'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import type { WorldState } from '../types/world'
import type { AcquireRealEstateProject } from '../types/project'
import type { RealEstateAsset } from '../types/realEstateAsset'
import {
  createPolityId,
  createHouseId,
  createHoldingId,
  createProvinceId,
  createPersonId,
  createRealEstateAssetId,
} from '../types/ids'
import type { ProjectId } from '../types/ids'

const SELLER = createPolityId('c', 0)
const BUYER_HOUSE = createHouseId('h', 0)
const PROV = createProvinceId('p', 0)
const HOLD = createHoldingId(0)
const CREATOR = createPersonId('pe', 1)
const ASSET = createRealEstateAssetId(0)

function makeState(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, PROV)
  s = withHolding(s, HOLD, PROV)
  s = withHouse(s, BUYER_HOUSE, { wealth: 0 })
  s = withPolity(s, SELLER, { treasury: 0 })
  s = withPerson(s, CREATOR, { houseId: BUYER_HOUSE })
  // seller を terminal polity に。getHoldingTerminalPolityId は cache を直接読む。
  s = { ...s, holdingTerminalPolityCache: { ...s.holdingTerminalPolityCache, [HOLD]: SELLER } }
  // 取得対象の無主 RealEstateAsset。
  const asset: RealEstateAsset = {
    id: ASSET,
    holdingId: HOLD,
    realEstateKind: 'workshop',
    level: 1,
    createdWeek: 0,
    recipeSlots: {},
  }
  s = {
    ...s,
    realEstateAssets: { ...s.realEstateAssets, [ASSET]: asset },
    realEstateAssetIndex: {
      ...s.realEstateAssetIndex,
      byHolding: { ...s.realEstateAssetIndex.byHolding, [HOLD]: [ASSET] },
    },
  }
  return s
}

function makeCompletedProject(allocated: number): AcquireRealEstateProject {
  return {
    id: 'proj-acq' as ProjectId,
    owner: { kind: 'house', id: BUYER_HOUSE },
    origin: { kind: 'system', reasonKey: 'test' },
    kind: 'acquire_real_estate',
    creatorPersonId: CREATOR,
    supervisorPersonId: CREATOR,
    status: 'completed',
    terminalReason: 'completed',
    progress: 100,
    targetProgress: 100,
    currentStageKey: 'execute_project',
    createdWeek: 0,
    reasonIds: [],
    holdingId: HOLD,
    targetRealEstateAssetId: ASSET,
    salePrice: 1000,
    // under-funded: 集めた総額 = allocated。remaining/spent は分けて持たせ、seller 支払いが
    //   allocated に依拠する（remaining でも salePrice でもない）ことを pin する。allocated==remaining+spent。
    budget: {
      required: 1000,
      allocated,
      remaining: Math.round(allocated * 0.4),
      spent: allocated - Math.round(allocated * 0.4),
      source: { kind: 'owner' },
    },
  }
}

describe('v0.60 acquire_real_estate seller 決済の保存則', () => {
  it('seller は budget.allocated だけ受け取る (salePrice ではない・under-funded)', () => {
    const s = makeState()
    const project = makeCompletedProject(600)
    s.projects[project.id] = project
    addProjectToIndexMut(s, project)
    const ctx = createTickContext({ state: s, rng: createRng('acq'), config: defaultConfig })
    const out = runProjectOutcomeSystem(ctx)
    // seller treasury は allocated(600) 増。salePrice(1000) ではない。
    expect(out.state.polities[SELLER]?.treasury).toBe(600)
    // asset は buyer House に移る。
    expect(out.state.realEstateAssets[ASSET]?.owner).toEqual({ kind: 'house', id: BUYER_HOUSE })
  })

  it('満額 funded (allocated==salePrice) なら従来どおり salePrice 相当を受け取る', () => {
    const s = makeState()
    const project = makeCompletedProject(1000)
    s.projects[project.id] = project
    addProjectToIndexMut(s, project)
    const ctx = createTickContext({ state: s, rng: createRng('acq2'), config: defaultConfig })
    const out = runProjectOutcomeSystem(ctx)
    expect(out.state.polities[SELLER]?.treasury).toBe(1000)
  })
})
