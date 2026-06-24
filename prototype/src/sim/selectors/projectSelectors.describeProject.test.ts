import { describe, it, expect } from 'vitest'
import { describeProject } from './projectSelectors'
import type { Project, ProjectKind, BaseProject } from '../types/project'
import type {
  ProjectId,
  PolityId,
  HouseId,
  PersonId,
  HoldingId,
  PressureId,
  CrisisId,
  RealEstateAssetId,
  LandContractId,
  RealEstateSeizureId,
  LandContractDefaultId,
  MerchantCompanyId,
  TradeRouteId,
  StateRegionId,
} from '../types/ids'

// describeProject は純粋関数 (state を引かない) なので、各 kind の最小 fixture で網羅する。
// 目的: 全 22 kind が throw せず descriptor を返し、primary が fields[0] と一致すること
// (app に render テストが無いぶんの保険。kind 追加漏れは never default + この網羅で二重に検出)。

const base: BaseProject = {
  id: 'proj1' as ProjectId,
  owner: { kind: 'house', id: 'h1' as HouseId },
  origin: { kind: 'system', reasonKey: 'test' },
  kind: 'develop_holding',
  creatorPersonId: 'pc' as PersonId,
  supervisorPersonId: 'ps' as PersonId,
  status: 'active',
  progress: 10,
  targetProgress: 100,
  currentStageKey: 'execute_project',
  createdWeek: 0,
  reasonIds: [],
}

const polityTarget = {
  kind: 'polity_office_role' as const,
  polityId: 'pol1' as PolityId,
  role: 'treasurer' as const,
  slotIndex: 0,
}

const samples: Record<ProjectKind, Project> = {
  develop_holding: {
    ...base,
    kind: 'develop_holding',
    holdingId: 'hd1' as HoldingId,
    improvementKind: 'irrigation_infrastructure',
    targetImprovementLevel: 3,
    budget: { required: 100, allocated: 50, remaining: 50, spent: 50, source: { kind: 'owner' } },
  },
  promote_policy_shift: {
    ...base,
    kind: 'promote_policy_shift',
    polityId: 'pol1' as PolityId,
    houseId: 'h1' as HouseId,
  },
  acquire_political_right: {
    ...base,
    kind: 'acquire_political_right',
    polityId: 'pol1' as PolityId,
    target: polityTarget,
    budget: 200,
    spentBudget: 40,
  },
  patronize_artist: {
    ...base,
    kind: 'patronize_artist',
    houseId: 'h1' as HouseId,
    budget: 80,
    spentBudget: 10,
    artistPersonId: 'pa' as PersonId,
  },
  commission_chronicle: {
    ...base,
    kind: 'commission_chronicle',
    houseId: 'h1' as HouseId,
    budget: 60,
    spentBudget: 0,
  },
  acquire_land: {
    ...base,
    kind: 'acquire_land',
    holdingId: 'hd1' as HoldingId,
    counterpartyPolityId: 'pol2' as PolityId,
    preparation: 3,
    leverage: 2,
    commitment: 1,
  },
  sell_land: {
    ...base,
    kind: 'sell_land',
    holdingId: 'hd1' as HoldingId,
    preparation: 1,
    leverage: 1,
    commitment: 1,
  },
  improve_contract_terms: {
    ...base,
    kind: 'improve_contract_terms',
    holdingId: 'hd1' as HoldingId,
    desiredTaxRateToGrantor: 0.3,
    preparation: 1,
    leverage: 1,
    commitment: 1,
  },
  demand_tax_increase: {
    ...base,
    kind: 'demand_tax_increase',
    holdingId: 'hd1' as HoldingId,
    counterpartyPolityId: 'pol2' as PolityId,
    preparation: 1,
    leverage: 1,
    commitment: 1,
  },
  respond_to_pressure: {
    ...base,
    kind: 'respond_to_pressure',
    pressureId: 'pr1' as PressureId,
    stance: 'negotiate',
  },
  personal_training: {
    ...base,
    kind: 'personal_training',
    owner: { kind: 'person', id: 'pt' as PersonId },
    traineePersonId: 'pt' as PersonId,
    trainingAbilityKey: 'valor',
  },
  movement_campaign: {
    ...base,
    kind: 'movement_campaign',
    owner: { kind: 'house', id: 'h1' as HouseId },
    targetPolityId: 'pol1' as PolityId,
    sponsoredPersonId: 'sp' as PersonId,
    budget: 50,
    spentBudget: 5,
  },
  request_rank_promotion: {
    ...base,
    kind: 'request_rank_promotion',
    owner: { kind: 'polity', id: 'pol1' as PolityId },
    polityId: 'pol1' as PolityId,
    newRank: 2,
  },
  request_land_grant: {
    ...base,
    kind: 'request_land_grant',
    owner: { kind: 'person', id: 'pp' as PersonId },
    petitionerPersonId: 'pp' as PersonId,
    donorPolityId: 'pol1' as PolityId,
    targetHoldingId: 'hd1' as HoldingId,
  },
  request_cadet_branch_title_transfer: {
    ...base,
    kind: 'request_cadet_branch_title_transfer',
    owner: { kind: 'person', id: 'pp' as PersonId },
    petitionerPersonId: 'pp' as PersonId,
    parentHouseId: 'h1' as HouseId,
    targetPolityId: 'pol1' as PolityId,
  },
  republic_house_foundation: {
    ...base,
    kind: 'republic_house_foundation',
    owner: { kind: 'person', id: 'pp' as PersonId },
    petitionerPersonId: 'pp' as PersonId,
    commonwealthPolityId: 'pol1' as PolityId,
  },
  consolidate_internal_contracts: {
    ...base,
    kind: 'consolidate_internal_contracts',
    owner: { kind: 'house', id: 'h1' as HouseId },
    houseId: 'h1' as HouseId,
    sinkPolityId: 'pol1' as PolityId,
  },
  undermine_influence: {
    ...base,
    kind: 'undermine_influence',
    owner: { kind: 'house', id: 'h1' as HouseId },
    polityId: 'pol1' as PolityId,
    target: { kind: 'house', id: 'h2' as HouseId },
  },
  revoke_political_right: {
    ...base,
    kind: 'revoke_political_right',
    owner: { kind: 'house', id: 'h1' as HouseId },
    polityId: 'pol1' as PolityId,
    target: polityTarget,
  },
  replace_house_leader: {
    ...base,
    kind: 'replace_house_leader',
    owner: { kind: 'house', id: 'h1' as HouseId },
    targetHouseId: 'h2' as HouseId,
  },
  handle_crisis: {
    ...base,
    kind: 'handle_crisis',
    crisisId: 'cr1' as CrisisId,
    holdingId: 'hd1' as HoldingId,
    budget: { required: 100, allocated: 50, remaining: 50, spent: 50, source: { kind: 'owner' } },
  },
  develop_real_estate: {
    ...base,
    kind: 'develop_real_estate',
    holdingId: 'hd1' as HoldingId,
    realEstateKind: 'farm',
    targetRealEstateLevel: 2,
    budget: { required: 100, allocated: 50, remaining: 50, spent: 50, source: { kind: 'owner' } },
  },
  acquire_real_estate: {
    ...base,
    kind: 'acquire_real_estate',
    owner: { kind: 'house', id: 'h-1' as HouseId },
    holdingId: 'hld-1' as HoldingId,
    targetRealEstateAssetId: 're-1' as RealEstateAssetId,
    salePrice: 100,
    budget: { required: 100, allocated: 100, remaining: 100, spent: 0, source: { kind: 'owner' } },
  },
  upgrade_owned_real_estate: {
    ...base,
    kind: 'upgrade_owned_real_estate',
    holdingId: 'hld-1' as HoldingId,
    targetRealEstateAssetId: 're-1' as RealEstateAssetId,
    realEstateKind: 'farm',
    targetRealEstateLevel: 2,
    budget: { required: 100, allocated: 50, remaining: 50, spent: 50, source: { kind: 'owner' } },
  },
  seize_real_estate_income: {
    ...base,
    kind: 'seize_real_estate_income',
    owner: { kind: 'polity', id: 'pol1' as PolityId },
    holdingId: 'hld-1' as HoldingId,
    targetRealEstateAssetId: 're-1' as RealEstateAssetId,
  },
  withhold_land_contract_tax: {
    ...base,
    kind: 'withhold_land_contract_tax',
    owner: { kind: 'polity', id: 'pol1' as PolityId },
    holdingId: 'hld-1' as HoldingId,
    targetLandContractId: 'lc-1' as LandContractId,
  },
  enforce_obligation: {
    ...base,
    kind: 'enforce_obligation',
    target: { kind: 'real_estate_seizure', id: 'rs-1' as RealEstateSeizureId },
  },
  enforce_land_contract_default: {
    ...base,
    kind: 'enforce_land_contract_default',
    owner: { kind: 'polity', id: 'pol1' as PolityId },
    targetLandContractDefaultId: 'lcd-1' as LandContractDefaultId,
    holdingId: 'hld-1' as HoldingId,
    landContractId: 'lc-1' as LandContractId,
    counterpartyPolityId: 'pol2' as PolityId,
    desiredTaxRateToGrantor: 0.2,
    preparation: 0,
    leverage: 0,
    commitment: 0,
  },
  upgrade_company_headquarters: {
    ...base,
    kind: 'upgrade_company_headquarters',
    owner: { kind: 'merchant_company', id: 'mc-1' as MerchantCompanyId },
    companyId: 'mc-1' as MerchantCompanyId,
    budget: { required: 100, allocated: 50, remaining: 50, spent: 50, source: { kind: 'owner' } },
  },
  build_company_branch: {
    ...base,
    kind: 'build_company_branch',
    owner: { kind: 'merchant_company', id: 'mc-1' as MerchantCompanyId },
    companyId: 'mc-1' as MerchantCompanyId,
    targetHoldingId: 'hld-1' as HoldingId,
    budget: { required: 100, allocated: 50, remaining: 50, spent: 50, source: { kind: 'owner' } },
  },
  open_trade_route: {
    ...base,
    kind: 'open_trade_route',
    owner: { kind: 'merchant_company', id: 'mc-1' as MerchantCompanyId },
    companyId: 'mc-1' as MerchantCompanyId,
    sourceStateId: 'sr-0' as StateRegionId,
    targetStateId: 'sr-1' as StateRegionId,
    resource: 'grain',
    budget: { required: 100, allocated: 50, remaining: 50, spent: 50, source: { kind: 'owner' } },
  },
  upgrade_trade_route: {
    ...base,
    kind: 'upgrade_trade_route',
    owner: { kind: 'merchant_company', id: 'mc-1' as MerchantCompanyId },
    companyId: 'mc-1' as MerchantCompanyId,
    targetTradeRouteId: 'tr-1' as TradeRouteId,
    budget: { required: 100, allocated: 50, remaining: 50, spent: 50, source: { kind: 'owner' } },
  },
}

describe('describeProject', () => {
  const kinds = Object.keys(samples) as ProjectKind[]

  it('covers all 32 project kinds', () => {
    expect(kinds.length).toBe(32)
  })

  // v0.61: merchant_company / trade_route は EntityRef に無いため、これらの商会 Project は
  //   P1 では空 descriptor (会社/路線リンクは EntityRef 拡張時=P5/P8 で付与)。≥1 field 検査の例外。
  const EMPTY_DESCRIPTOR_KINDS: ReadonlySet<ProjectKind> = new Set([
    'upgrade_company_headquarters',
    'open_trade_route',
    'upgrade_trade_route',
  ])

  it.each(kinds)('returns a descriptor for kind=%s without throwing', (kind) => {
    const project = samples[kind]
    const descriptor = describeProject(project)
    expect(Array.isArray(descriptor.fields)).toBe(true)
    // primary は (存在すれば) 必ず fields[0] と同一参照。
    if (descriptor.primary) {
      expect(descriptor.primary).toBe(descriptor.fields[0])
    }
    // この fixture 群は (上記例外を除き) 全 kind が最低 1 フィールドを持つよう構成している。
    if (!EMPTY_DESCRIPTOR_KINDS.has(kind)) {
      expect(descriptor.fields.length).toBeGreaterThan(0)
    }
  })

  it('resolves develop_holding primary to its target holding + budget', () => {
    const d = describeProject(samples.develop_holding)
    expect(d.primary).toEqual({
      kind: 'entity',
      role: 'targetHolding',
      ref: { kind: 'holding', id: 'hd1' },
    })
    expect(d.budget).toEqual({ required: 100, allocated: 50, remaining: 50, spent: 50 })
  })

  it('normalizes numeric budget kinds to {required, spent}', () => {
    const d = describeProject(samples.acquire_political_right)
    expect(d.budget).toEqual({ required: 200, spent: 40 })
  })
})
