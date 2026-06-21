import type { OfficeRole } from '../types/office'
import type { PolityRank } from '../types/polity'
import type { PersonBackgroundOccupation, LifeStage } from '../types/person'
import type { HoldingKind } from '../types/landContract'
import type { PopClass, PopStratum } from '../types/popGroup'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { RealEstateKind } from '../types/realEstateAsset'
import type { CrisisKind } from '../types/crisis'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { NeedTier } from '../types/needCategory'
import type { BattlefieldKind, SupplyShortageBand } from '../types/war'
import type { BattleTickUnit } from '../types/battle'
import type { RealEstateInfrastructureModifier } from './realEstateDefinitions'
import type { RealEstateProductionFacilityModifier } from './resourceEconomyDefinitions'
import { REAL_ESTATE_PRODUCTION_FACILITY_MODIFIERS } from './resourceEconomyDefinitions'
import type { LandContractConfig } from './landContractConfig'
import { defaultLandContractConfig } from './landContractConfig'

// v0.40 LifeStage 遷移年齢
type LifeStageTransitionAge = {
  minAge: number
  standardAge: number
  maxAge: number
}

export type SimulationConfig = {
  uiLocale: 'en' | 'ja'
  nameCultureId: string
  debug: boolean
  integrityPerSystem: boolean
  minLivingMembersPerHouse: number
  maxNewPersonsPerHousePerYear: number
  // v0.51 陰謀リファイン (§6): 陰謀 Project 系の config。
  conspiracyUndermineInfluenceAmount: number // 毀損 modifier の絶対値 (delta = -この値)
  conspiracyUndermineInfluenceDurationWeeks: number // 毀損の有効期間 (週)
  conspiracyAimPriorityFactor: number // 陰謀 aim 候補スコアの重み (多発抑制。低め)
  conspiracyDriveThreshold: number // covert goal/aim の発動閾値 (旧 plotThreshold から引上げ)
  conspiracyTaskEffortRequired: number // 陰謀 Task の必要努力値 (HEAVY 上限より重く)
  conspiracyTaskBaseDifficulty: number // 陰謀全般の基本難度
  conspiracyRevokeRightBaseDifficulty: number // 任命権失効 (person holder) の基本難度
  conspiracyRevokeHouseRightDifficultyBonus: number // 家保有任命権の追加難度
  conspiracyCooldownWeeks: number // 陰謀 Project terminal 後の再立案待機週数 (連発防止)
  replacementThreshold: number
  rebellionSuccessMode: 'independence' | 'ruler_change'
  maxRawEvents: number
  maxChronicleEvents: number
  // War / Conquest
  warEnabled: boolean
  warCostPerProvince: number
  maxProvincesPerWar: number
  maxWarsPerTick: number
  warCooldownWeeks: number
  minAttackerWinChanceToDeclare: number
  // v0.42: 開戦前の勝率 × 性格ゲート (warCreationSystem)。personality OFF でも flat ゲートは
  //   挙動変化なので、A/B 比較できるよう personAbilityEffectsEnabled とは別のキルスイッチにする。
  winChanceWarGateEnabled: boolean
  // Disaster
  disasterEnabled: boolean
  famineBaseChancePerYear: number
  plagueBaseChancePerYear: number
  bountifulHarvestBaseChancePerYear: number
  disasterReliefCostPerProvince: number
  // Public Spending
  publicSpendingEnabled: boolean
  publicSpendingYearlyChance: number
  // War devastation
  warConqueredProvinceDevastation: number
  warBorderProvinceDevastation: number
  failedWarBorderDevastation: number
  // Rebellion devastation
  rebellionStartedDevastation: number
  rebellionSucceededDevastation: number
  rebellionFailedDevastation: number
  // Disaster development effects
  famineDevastation: number
  famineReliefDevelopmentRecovery: number
  plagueDevastation: number
  bountifulHarvestDevelopmentGain: number
  // Control system
  controlMaxDistancePenalty: number
  controlMaxMinimum: number
  controlGrowthPerMonth: number
  controlDecayPerMonth: number
  disconnectedControlDecayPerMonth: number
  // Land development (v0.5 additions)
  landDevelopmentHouseControlGain: number
  landDevelopmentUnrestReduction: number
  // Lordship transition
  lordshipAbsorptionTargetThreshold: number
  lordshipAbsorptionSourceMinimum: number
  lordshipAbsorptionRatio: number
  lordshipAbsorptionMonthlyChance: number
  lordshipAbsorptionNewControlMin: number
  lordshipAbsorptionNewControlMax: number
  lordshipAbsorptionNewControlPenalty: number
  // Annexation
  annexedPolityControl: number
  newRulerHouseControl: number
  // v0.7 Person Ability Effects
  personAbilityEffectsEnabled: boolean
  // v0.49: 能力中心史観の統一非線形ファクター。roleScore(0-120) を 50 中立の乗数に変換する指数。
  //   factor = (clamp(score,0,120)/50)^abilityOutputExponent。exponent=1.6 で score80 ≈ 1.95x,
  //   score40 ≈ 0.66x → 80/40 ≈ 2.9x (合成 roleScore の現実分布では ~2x)。内政成長/徴税効率/
  //   開発コスト/軍 power を一括スケール。値を上げるほど能力差が誇張される (KOEI 風)。
  abilityOutputExponent: number
  // 影響力個人中心化 Phase 3b: 家 goal-kind scoring に意志決定者 (decisionMaker) の性格を反映する量。
  // ambition→expand / caution→preserve。(trait-0.5)×scale (±scale/2)。personAbilityEffectsEnabled で gate。
  houseGoalPersonalityScale: number
  // v0.49: control growth / tax efficiency / dev cost / war power の旧線形係数は abilityOutputFactor
  //   (abilityOutputExponent 単一ノブ) に置換され廃止。MaxBonus / Caution / DeclareThreshold 系は存続。
  chancellorAdminControlMaxBonusPerAdmin: number
  houseHeadAdminControlMaxBonusPerAdmin: number
  treasurerCautionTaxEfficiencyEffect: number
  treasurerTaxEfficiencyMin: number
  treasurerTaxEfficiencyMax: number
  generalAmbitionDeclareThresholdEffect: number
  generalCautionDeclareThresholdEffect: number
  minWarDeclareThreshold: number
  maxWarDeclareThreshold: number
  // v0.42: 被圧力側 (defender) の stance 境界を意思決定者の性格でシフトする量
  //   (pressureStanceSelectors。personAbilityEffectsEnabled で gate)。
  pressureStanceAmbitionShift: number
  pressureStanceCautionShift: number
  // v0.42: 交渉担当者の能力が要求条件の質をスケールする量 (taskCompromise。personAbilityEffectsEnabled で gate)。
  negotiatorTermQualityEffect: number
  chancellorAmbitionLandDevelopmentScoreEffect: number
  chancellorCautionLandDevelopmentScoreEffect: number
  controlAbilityMinimumFloor: number
  // v0.7 Marriage
  marriageEnabled: boolean
  marriageMaleMinAge: number
  marriageMaleMaxAge: number
  marriageFemaleMinAge: number
  marriageFemaleMaxAge: number
  marriageYearlyChance: number
  samePrimaryPolityMarriageBonus: number
  // v0.7 Birth
  birthEnabled: boolean
  fatherMinChildAge: number
  fatherMaxChildAge: number
  motherMinChildAge: number
  motherMaxChildAge: number
  baseBirthChancePerMalePerYear: number
  spouseMotherChance: number
  maleBirthChance: number
  maleBirthChanceWhenAdultMaleShortage: number
  // v0.45.4: 男性不足コントローラの発動閾値 (成人男性 < 総人口 × この値で
  //   maleBirthChanceWhenAdultMaleShortage を使用)。0 でコントローラ無効
  //   (女性多めプレイ用 — 0.4 のままだと低 maleBirthChance を引き戻し続ける)。
  adultMaleShortageThreshold: number
  // v0.45.1: 人口閾値は絶対値から worldgenLivingPersonsBaseline 比例の係数に変更
  //   (マップ規模 preset に閾値が追従しない欠陥の修正)
  targetLivingPersonsFactor: number // baseline × この値 未満で lowPopulationBirthMultiplier
  criticalLivingPersonsFactor: number // baseline × この値 以下で criticalPopulationBirthMultiplier
  highLivingPersonsFactor: number // baseline × この値 以上で highPopulationBirthMultiplier
  lowPopulationBirthMultiplier: number
  criticalPopulationBirthMultiplier: number
  highPopulationBirthMultiplier: number
  // v0.45.1 Mortality (4週ごと判定1回あたりの死亡率。年12回判定)
  mortalityRateInfant: number // 0-2歳
  mortalityRateChild: number // 3-14歳
  mortalityRatePrime: number // 15-39歳
  mortalityRateMiddle: number // 40-59歳
  mortalityRateSenior: number // 60-69歳
  mortalityRateElder: number // 70歳以上
  geniusMortalityMultiplier: number // geniusType 持ちの死亡率乗数 (1 で無効)
  // v0.7 Succession
  adultAge: number
  allowFemaleHouseHeadWhenNoMaleHeir: boolean
  minorHeadCohesionPenaltyPerMonth: number
  minorHeadLoyaltyPenaltyPerMonth: number
  prestigeSuccessionWeight: number
  adminSuccessionWeight: number
  martialSuccessionWeight: number
  ambitionSuccessionWeight: number
  randomSuccessionNoiseMax: number
  illegitimateSuccessionPenalty: number
  unknownBirthStatusSuccessionPenalty: number
  successionCrisisScoreGap: number
  // v0.7 House Split
  houseSplitEnabled: boolean
  minProvincesForHouseSplit: number
  houseSplitCohesionThreshold: number
  baseHouseSplitChance: number
  houseSplitAmbitionFactor: number
  houseSplitPrestigeFactor: number
  houseSplitMartialFactor: number
  houseSplitCohesionFactor: number
  houseSplitControlMultiplier: number
  houseSplitControlMin: number
  houseSplitControlMax: number
  houseSplitUnrestGain: number
  houseSplitWealthShare: number
  // v0.31 Phase D: House Split Evaluation
  houseSplitEvaluationIntervalWeeks: number
  houseSplitCooldownWeeks: number
  houseSplitMinLivingMembers: number
  houseSplitMinWealth: number
  houseSplitMinLegacyPrestige: number
  // 分家 founder から除外する継承順位上位人数（跡継ぎが分家を興すのを防ぐ）。0 で無効。
  houseSplitExcludeTopSuccessionRanks: number
  // v0.7 House Extinction
  houseExtinctionEnabled: boolean
  inheritedProvinceHouseControl: number
  extinctionUnrestGain: number
  rulerHouseExtinctionEnabled: boolean
  annexByRulerExtinctionCountryControl: number
  rulerHouseExtinctionPrestigeLoss: number
  rulerExtinctionAnnexSharedBorderWeight: number
  rulerExtinctionAnnexPowerWeight: number
  rulerExtinctionAnnexPrestigeWeight: number
  // v0.7 Role
  allowFemaleRolesWhenNoMaleCandidate: boolean
  // v0.45.3 性別役職適格ゲート: 女性のうち役職 (office/代官/指揮官/派閥首領/supervisor) に
  //   適格となる割合。personId の決定論 hash で個人ごとに一度だけ決まる。
  //   現職の house/polity leader (女当主・女王) は常に免除。
  femaleRoleEligibilityChance: number
  // v0.8 POP system
  popSystemEnabled: boolean
  minPopSizeByClass: Record<PopStratum, number>
  minProvinceCarryingCapacity: number
  // v0.55 POP 再設計: carrying capacity = 食料市場供給 / perCapitaFoodNeed。1人あたり月次食料需要の基準。
  perCapitaFoodNeed: number
  manpowerFactorByClass: Record<PopStratum, number>
  baseMonthlyGrowthByClass: Record<PopStratum, number>
  populationPressureThreshold: number
  populationPressureWealthPenalty: number
  populationPressureUnrestGain: number
  povertyWealthThreshold: number
  povertyUnrestGain: number
  prosperityWealthThreshold: number
  prosperityUnrestReduction: number
  unrestNaturalDecayRate: number
  retainedWealthGainByClass: Record<PopStratum, number>
  overExtractionThreshold: number
  overExtractionWealthSafeThreshold: number
  overExtractionUnrestSafeThreshold: number
  overExtractionWealthPenalty: number
  overExtractionUnrestGain: number
  // v0.24 Occupation capacity
  classCapacityBaseByHoldingKind: Record<HoldingKind, Record<PopClass, number>>
  // v0.33 Province terrain / features (habitability スカラーを置換)
  provinceTerrainSettlementSuitability: Record<ProvinceTerrain, number>
  provinceTerrainWeights: Record<ProvinceTerrain, number>
  stateRegionDominantTerrainInheritanceChance: number
  provinceFeatureCoastalChance: number
  provinceCoastalEdgeMarginRatio: number
  provinceFeatureMajorRiverBaseChance: number
  provinceFeatureMajorRiverTerrainDelta: Partial<Record<ProvinceTerrain, number>>
  provinceFeatureLakeBaseChance: number
  provinceFeatureLakeTerrainDelta: Partial<Record<ProvinceTerrain, number>>
  // v0.24 Occupation manpower multipliers
  employedManpowerMultiplierByClass: Record<PopClass, number>
  unemployedManpowerMultiplier: number
  // v0.24 Unemployed POP penalties
  unemployedWealthDecayByClass: Record<PopClass, number>
  unemployedUnrestGainByClass: Record<PopClass, number>
  unemployedGrowthModifierByClass: Record<PopClass, number>
  // v0.24 Initial POP generation
  initialPopFillRatioMin: number
  initialPopFillRatioMax: number
  // v0.24 POP epsilon
  popSizeEpsilon: number
  bountifulHarvestPeasantWealthGain: number
  bountifulHarvestPeasantUnrestReduction: number
  bountifulHarvestTownsmanWealthGain: number
  bountifulHarvestTownsmanUnrestReduction: number
  warWealthDamage: number
  warUnrestDamage: number
  warPeasantSizeDamage: number
  warTownsmanSizeDamage: number
  famineWealthPenalty: number
  famineSizeDamageRate: number
  famineReliefDamageMultiplier: number
  faminePressureChanceBonus: number
  plagueWealthPenalty: number
  plagueSizeDamageRate: number
  plaguePressureChanceBonus: number
  // v0.48 Crisis (災害・戦災・反乱前段の entity 化, §7.2)
  crisisEnabled: boolean
  // 発生年次ロール (drought は新規。famine/plague は既存 *BaseChancePerYear を流用)
  droughtBaseChancePerYear: number
  droughtPressureChanceBonus: number
  // 初期 severity (= 対処 Project の targetProgress)。0–100。pressureExcess に比例して加算 (clamp 100)
  crisisInitialSeverityByKind: Record<CrisisKind, number>
  crisisSeverityPressureBonus: number
  // 発生時の一回限り人口ショック (holding スコープ proportional, §4.1)
  crisisInitialShockSizeRateByKind: Record<CrisisKind, number>
  // 有効期間 (deadline までの週数)
  crisisDeadlineWeeksByKind: Record<CrisisKind, number>
  // 予算: required = min(treasury × ratio, cap[kind])
  crisisBudgetTreasuryRatio: number
  crisisBudgetCapByKind: Record<CrisisKind, number>
  // 週次デバフ (active 中, severity に比例)。校正: 旧単発効果 ÷ 平均有効週数 を目安に控えめ設定。
  //   旧 famine は peasants wealth −8 を 1 回。severity 30・有効 ~24 週で毎週 0.05×30=1.5、
  //   resolution 前提なら積算 ~10–18 で旧値と同オーダー。balance は機能完成後にまとめて調整 (CLAUDE.md §4)。
  crisisWeeklyWealthPenaltyPerSeverity: number
  crisisWeeklyUnrestPerSeverity: number
  // 放置時の attitude 低下 (担当代官 / Polity 別。owner house は対象外, §0-6/§4.4)
  crisisNeglectAffectionDropPerWeekBailiff: number
  crisisNeglectAffectionDropPerWeekPolity: number
  crisisExpiredAffectionDropBailiff: number
  crisisExpiredAffectionDropPolity: number
  // v0.48.1 設備維持管理 (§9)。condition 駆動の減衰→機能不全→修理→破壊ライフサイクル。
  facilityMaintenanceEnabled: boolean // kill-switch
  facilityConditionDecayPerCyclePerLevel: number // 維持サイクル(4週)ごとの減衰 = これ × level
  facilityDisrepairThreshold: number // これ未満で機能不全 (生産低下 + disrepair Crisis 発火)
  facilityDisrepairMinEffectiveness: number // 生産 effectiveness の下限 (condition 0 時)
  criticalInfraMinEffectiveness: number // critical infrastructure (manor_house/town_hall) の conditionEffectiveness 下限
  facilityRepairConditionRestore: number // 修理完了 / 部分崩壊後に回復する condition
  warDamageConditionDrop: number // 戦災 1 回あたりの condition 減少幅
  crisisDisrepairNeglectMultiplier: number // disrepair 放置時の neglect affection 低下の倍率 (他 Crisis より穏やかに)
  // v0.48.1: 設備による Crisis 被害軽減。kind ごとに「軽減する設備種別」と「holding の当該設備レベル
  //   あたり軽減率」を指定。spawn 時に severity と初期人口ショックを乗算で下げる (未登録 kind は軽減なし)。
  crisisMitigationByKind: Partial<
    Record<CrisisKind, { improvementKind: HoldingImprovementKind; reductionPerLevel: number }>
  >
  facilityConditionSeedJitterMin: number // worldgen seed の condition 下限 (上限 100, 第1波 desync)
  // v0.48.2 定期保守点検 (§6.6b 3 段モデル)。condition が要保守帯 (disrepairThreshold 以上
  //   maintenanceThreshold 未満) のとき、active な代官 + owner polity の財政があれば自動で回復する。
  //   不変条件: facilityDisrepairThreshold < facilityMaintenanceThreshold ≤ 100。
  facilityMaintenanceThreshold: number // これ未満 (かつ disrepairThreshold 以上) で代官が保守する
  facilityMaintenanceConditionRestore: number // 保守成功時に回復する condition
  facilityMaintenanceCostPerLevel: number // 保守 1 回あたり owner treasury から引く費用 = これ × level
  // Military v0.9
  houseManpowerPowerFactor: number
  houseMilitaryWealthReserve: number
  houseWealthMilitaryFactor: number
  maxMercenaryPowerRatio: number
  houseCommanderMartialEffect: number
  minCommanderModifier: number
  maxCommanderModifier: number
  polityAdminMilitaryFactor: number
  minHouseMilitaryContribution: number
  // HouseRebellion v0.9
  houseRebellionNobleUnrestFactor: number
  houseRebellionProvinceUnrestFactor: number
  houseRebellionLowControlFactor: number
  rebellionTreasuryPowerDivisor: number
  // ProvinceRevolt tendency
  provinceRevoltThreshold: number
  provinceRevoltChanceDivisor: number
  provinceRevoltMaxChance: number
  provinceRevoltUnrestFactor: number
  provinceRevoltLowHouseControlFactor: number
  provinceRevoltLowCountryControlFactor: number
  provinceRevoltStabilitySuppressionFactor: number
  // v0.49: 領主家長・代官の統率/学識による反感低減。governorScore = command*0.5 + learning*0.5。
  //   tendency -= (governorScore - revoltAbilityNeutralScore) * revoltAbilitySuppressionFactor。
  //   有能 (80/80) な統治者は反乱傾向を大きく下げ、無能 (20) はむしろ煽る (対称項)。
  revoltAbilitySuppressionFactor: number
  revoltAbilityNeutralScore: number
  // ProvinceRevolt class-specific tendency
  peasantRevoltPovertyFactor: number
  peasantRevoltPressureFactor: number
  townsmenRevoltProductionFactor: number
  townsmenRevoltExtractionFactor: number
  nobleRevoltHouseDisloyaltyFactor: number
  nobleRevoltLowLegitimacyFactor: number
  // ProvinceRevolt power
  popRevoltPowerFactorByClass: Record<PopStratum, number>
  provinceRevoltHouseSuppressionFactor: number
  provinceRevoltCountrySuppressionFactor: number
  provinceRevoltTreasurySuppressionFactor: number
  provinceRevoltHouseWealthSuppressionFactor: number
  // ProvinceRevolt outcomes
  provinceRevoltConcessionCountryControlLoss: number
  provinceRevoltConcessionHouseControlLoss: number
  provinceRevoltConcessionUnrestReduction: number
  provinceRevoltConcessionHouseWealthLoss: number
  provinceRevoltLordshipChangeSuccessMargin: number
  provinceRevoltLordshipChangeCountryControlLoss: number
  provinceRevoltNewHouseControl: number
  // ProvinceRevolt independence
  provinceRevoltIndependenceCountryControlMax: number
  provinceRevoltIndependenceHouseControlMax: number
  provinceRevoltIndependenceSuccessMargin: number
  provinceRevoltNewCountryControl: number
  // ProvinceRevolt failure
  provinceRevoltFailedUnrestReduction: number
  provinceRevoltFailedDevastation: number
  provinceRevoltFailedWealthPenalty: number
  provinceRevoltSuppressionCollateralUnrestGain: number
  // Legacy Prestige
  attitudeMonthlyRetentionRate: number
  initialPolityLegacyPrestigeMin: number
  initialPolityLegacyPrestigeMax: number
  initialHouseLegacyPrestigeMin: number
  initialHouseLegacyPrestigeMax: number
  initialPersonLegacyPrestigeMin: number
  initialPersonLegacyPrestigeMax: number
  // ProvinceRevolt new entities
  revoltHouseInitialLegacyPrestige: number
  revoltHouseInitialWealth: number
  revoltPolityInitialTreasury: number
  revoltPolityInitialLegacyPrestige: number
  // v0.18 Stage B: DiplomaticPlay 基盤
  diplomaticPlaySettlementThreshold: number
  diplomaticPlayEscalationThreshold: number
  diplomaticPlayBaseTensionGain: number
  // v0.18 Stage B: Revolt negotiation
  revoltNegotiationDurationWeeks: number
  revoltAcceptRebelPowerFactor: number
  revoltAcceptSuppressionFactor: number
  revoltConcessionSeverityMinor: number
  revoltConcessionSeverityMajor: number
  // v0.48: 民衆反乱の目的分岐 (代官排除 / 税率改定 / 独立)。閾値は反乱 class pop の生の
  //   affection (-100..100) で判定する。balance-defer (CLAUDE.md §4。後で CLI 観測して調整)。
  revoltIndependenceHouseAffectionThreshold: number
  revoltBailiffDismissalAffectionThreshold: number
  revoltBailiffReputationPenalty: number
  // POP→ownerHouse 悪感情の付与量 (affection delta、負値)。蓄積して branch 1 (独立) を駆動する。
  //   site①代官排除反乱の発生時 / site②代官罷免失敗時 / site③税率改定 fizzle 時。
  revoltBailiffRevoltHouseAffectionPenalty: number
  revoltBailiffDismissalFailHouseAffectionPenalty: number
  revoltTaxReliefFizzleHouseAffectionPenalty: number
  // v0.39: popular_tax_relief demand
  minPopularDemandTaxRate: number
  popularTaxReliefDemandDelta: number
  taxReliefSeverityFactor: number
  popularTaxReliefTermsProtectionWeeks: number
  // v0.39.1: revolt_negotiation task-based hybrid model
  revoltNegotiationEnvFactor: number
  revoltNegotiationSettlementPrepWeight: number
  revoltNegotiationSettlementLeverageWeight: number
  revoltNegotiationEscalationCommitmentWeight: number
  // v0.18 Stage B: Revolt settlement effects (§12.4)
  revoltSettlementMainUnrestReduction: number
  revoltSettlementOtherUnrestReduction: number
  revoltSettlementTreasuryCostMinor: number
  revoltSettlementTreasuryCostMajor: number
  // v0.18 Stage B: Revolt suppression effects (§14.6)
  revoltSuppressedMainUnrestReduction: number
  revoltSuppressedOtherUnrestReduction: number
  revoltSuppressedDevelopmentDamage: number
  revoltSuppressedWealthPenalty: number
  // v0.39: Holding-level revolt tendency factors
  taxBurdenWeight: number
  recentTaxIncreaseWeight: number
  recentTaxIncreaseDecayWeeks: number
  recentSuppressionCooldownWeeks: number
  recentSuppressionTendencyReduction: number
  // v0.39: TaxRevisionSystem
  taxRevisionSystemEnabled: boolean
  taxRevisionTreasuryThreshold: number
  taxRevisionTreasuryNeedFactor: number
  taxRevisionLowUnrestFactor: number
  taxRevisionUnrestSafeThreshold: number
  taxRevisionHighUnrestPenalty: number
  taxRevisionUnrestDangerThreshold: number
  taxRevisionHighTaxThreshold: number
  taxRevisionHighTaxPenalty: number
  taxRevisionAmbitionFactor: number
  taxRevisionCautionPenalty: number
  taxRevisionInsightPenalty: number
  taxRevisionWarBonus: number
  taxRevisionDecisionThreshold: number
  taxRevisionMinDelta: number
  taxRevisionMaxDelta: number
  taxRevisionSystemMaxRate: number
  taxRevisionCooldownWeeks: number
  taxRevisionRecentRevoltPenalty: number
  taxRevisionRecentRevoltDecayWeeks: number
  // v0.18 Stage F: land_claim acceptance (旧 land_purchase + land_transfer_demand を統合)
  //   acceptanceScore =
  //     offeredPrice * claimOfferedPriceFactor
  //     + defenderTreasuryNeed
  //     + initiatorPower * claimInitiatorPressureFactor
  //     - defenderPower * claimDefenderResistFactor
  //     - provinceValue * claimProvinceValueFactor
  //     - strategicLoss * claimStrategicLossFactor
  //     - prestigeLoss * claimPrestigeLossFactor
  claimOfferedPriceFactor: number
  claimInitiatorPressureFactor: number
  claimDefenderResistFactor: number
  claimProvinceValueFactor: number
  claimStrategicLossFactor: number
  claimPrestigeLossFactor: number
  landClaimNegotiationDurationWeeks: number
  // 初期 progress / tension (Intent kind / 購入条件成立 に応じて変動)
  landClaimInitialProgressOnConsent: number
  landClaimInitialTensionOnPressure: number
  // v0.18 contract_tax_revision
  taxRevisionIntentEnabled: boolean
  taxRevisionMinRateForReduction: number
  taxRevisionMaxRateForIncrease: number
  taxRevisionMinTreasury: number
  taxRevisionMaxIntentsPerActor: number
  taxRevisionNegotiationDurationWeeks: number
  taxRevisionMinRate: number
  taxRevisionMaxRate: number
  taxRevisionPressureFactor: number
  taxRevisionResistFactor: number
  taxRevisionProvinceValueFactor: number
  taxRevisionRateImbalanceFactor: number
  taxRevisionInitialProgressOnAdvantage: number
  taxRevisionInitialTensionOnPressure: number
  taxRevisionGracePeriodYears: number
  // v0.47.3 §6.69: land_claim 外交劇 terminal 後、対象 holding を acquire 対象から除外する年数
  //   (税制改定 taxRevisionGracePeriodYears と対称)。
  landClaimGracePeriodYears: number
  // v0.30: contract_tax_revision offer-driven
  taxRevisionInitialDemandDelta: number
  taxRevisionReservationDelta: number
  taxRevisionMaxDemandDelta: number
  taxRevisionCompensationYears: number
  // v0.30: offer evaluation / negotiation
  invalidOfferTensionDelta: number
  rejectedOfferTensionDelta: number
  validOfferProgressDelta: number
  counterOfferProgressDelta: number
  offerCompromiseProgressDelta: number
  negotiateTermsProgressDelta: number
  // v0.30: mixed holdings debug
  debugMixedProvinceHoldingsRatio: number
  // v0.18 Stage D: 汎用 conflict (§13.2)
  conflictResolutionEnabled: boolean
  maxConflictsResolvedPerTick: number
  conflictLoserTreasuryDamageFactor: number
  conflictProvinceDevastation: number
  conflictPopWealthDamage: number
  conflictPopUnrestGain: number
  // v0.34 War (§15): DiplomaticPlay escalation を複数 tick の War entity で解決する
  //   v0.35: per-tick drift 系 (warScoreProgressFactor / maxWarScoreDeltaPerTick /
  //   warMinimumEffectivePower / warScoreCollapseDelta / warScoreEventThreshold) は WarManeuver 化で撤廃。
  maxWarDurationWeeks: number
  defaultTransferLandWarScore: number
  defaultChangeContractTaxWarScore: number
  defaultPopularRevoltWarScore: number
  // v0.39: Local Levy
  localLevyPeasantFactor: number
  localLevyTownsmenFactor: number
  localLevyNobleFactor: number
  localLevyMinStrength: number
  localLevyMaxStrength: number
  localLevyBasePowerFactor: number
  localLevyOrganization: number
  localLevyMorale: number
  terminalWarRetentionWeeks: number
  // v0.35 War Maneuver (§12.1): WarManeuverSystem の総大将判断 / 回避 / 戦闘で warScore を動かす
  //   avoidance (v0.49: 回避成否は resolveEngagementContest に移行。base/warCommand 係数は廃止)
  warAvoidanceTerrainModifierByBattlefield: Record<BattlefieldKind, number>
  warAvoidanceCountPenalty: number
  maxWarAvoidanceCount: number
  warAvoidanceWarScorePenalty: number
  // v0.43 追補: side ごとの現場指揮官候補リスト保持数の上限 (warCommand 上位から)
  maxWarCommanderCandidatesPerSide: number
  //   engagement decision
  warEngagementRandomness: number
  warEngagementCautionEffect: number
  warEngagementAmbitionEffect: number
  warEngagementWarScoreUrgencyEffect: number
  //   battle
  warBattleRandomness: number
  warBattleScoreScale: number
  maxWarScoreDeltaPerBattle: number
  battleVictoryThreshold: number
  //   commander
  warCommanderWarCommandEffect: number
  minWarCommanderModifier: number
  maxWarCommanderModifier: number
  //   captain general
  captainGeneralWarScoreEffect: number
  //   battlefield 生成 (feature 特殊化確率。spec §12.1 未記載・本実装で定義)
  warBattlefieldRiverCrossingChance: number
  warBattlefieldCoastalBattleChance: number
  // v0.36 Regiment (§15): persistent Regiment の損耗 / 回復 / 初期値 / 壊滅閾値。
  //   damage / recovery / destroyedThreshold は Phase B で WarManeuver / RecoverySystem が使う。
  //   initial* は Phase A の worldgen generateInitialRegiments が使う (§8.6)。仮値・balance 調整対象。
  regimentOrganizationDamageWinnerMin: number
  regimentOrganizationDamageWinnerMax: number
  regimentOrganizationDamageLoserMin: number
  regimentOrganizationDamageLoserMax: number
  regimentOrganizationDamageInconclusiveMin: number
  regimentOrganizationDamageInconclusiveMax: number
  regimentStrengthDamageWinnerMin: number
  regimentStrengthDamageWinnerMax: number
  regimentStrengthDamageLoserMin: number
  regimentStrengthDamageLoserMax: number
  regimentStrengthDamageInconclusiveMin: number
  regimentStrengthDamageInconclusiveMax: number
  regimentOrganizationRecoveryPerWeek: number
  regimentInitialMorale: number
  regimentInitialStrength: number
  regimentInitialOrganization: number
  regimentMaxStrength: number
  regimentDestroyedStrengthThreshold: number
  // v0.36 補充・再編成: active strength の月次補充 + destroyed Regiment の reform。
  //   RegimentReinforcementSystem が使う (cadence は tick 登録の intervalWeeks=4 で固定)。仮値・balance 調整対象。
  regimentReinforcementBasePerMonth: number
  regimentReinforcementPeaceMultiplier: number
  regimentReinforcementWarMultiplier: number
  regimentReinforcementMobilizedMultiplier: number
  // popFactor の正規化基準。class 間で POP スケールが大きく異なる (worldgen 実測: 該当 holding kind で
  //   peasants ~85 / nobles ~2.5、townsmen は都市発達後) ため per-class 基準にする。
  //   sourceKind→class: levy→peasants / urban_militia→townsmen / noble_retinue→nobles。
  regimentReinforcementReferencePopByClass: Record<PopStratum, number>
  regimentReinforcementMinPopFactor: number
  regimentReinforcementMaxPopFactor: number
  regimentReinforcementCostPerStrength: number
  regimentCavalryReinforcementMultiplier: number
  regimentCavalryReinforcementCostMultiplier: number
  destroyedRegimentReformDelayWeeks: number
  destroyedRegimentReformInitialStrength: number
  destroyedRegimentReformInitialOrganization: number
  destroyedRegimentReformInitialMorale: number
  destroyedRegimentReformCost: number
  destroyedRegimentReformMinPopFactor: number
  // v0.37 Battlefront (§21) — Phase A では誰も読まない (土台)。Phase B/C で battle sim / recovery が使う。
  //   baseline / max
  regimentBaselineOrganizationDefault: number
  regimentBaselineMoraleDefault: number
  regimentMaxOrganizationDefault: number
  regimentMaxMoraleDefault: number
  regimentMaxOrganizationHardCap: number
  regimentMaxMoraleHardCap: number
  //   recovery (regimentOrganizationRecoveryPerWeek は既存)
  regimentOrganizationDecayAboveBaselinePerWeek: number
  regimentMoraleRecoveryPerWeek: number
  regimentMoraleDecayAboveBaselinePerWeek: number
  //   battle internal tick
  battleTickUnit: BattleTickUnit
  battleMaxTicks: number
  retreatOrganizationThreshold: number
  routeOrganizationThreshold: number
  minFightingStrengthThreshold: number
  //   frontage / terrain
  battlefieldFrontageByKind: Record<BattlefieldKind, number>
  battleTerrainOrganizationDamageMultiplierByKind: Record<BattlefieldKind, number>
  //   flank 地形補正 (§10.2。slot 側面攻撃ダメージに battleFlankingDamageMultiplier と乗算)
  battleFlankTerrainMultiplierByKind: Record<BattlefieldKind, number>
  //   damage
  battleBaseOrganizationDamage: number
  battleMoraleDamageRatio: number
  battleStrengthDamageRatio: number
  winnerStrengthDamageMultiplier: number
  loserStrengthDamageMultiplier: number
  routedStrengthDamageMultiplier: number
  routAdditionalMoraleDamage: number
  battleStrengthOutcomeQualityMultiplierOrderly: number
  battleStrengthOutcomeQualityMultiplierRout: number
  battleStrengthPowerDisadvantageModifierMin: number
  battleStrengthPowerDisadvantageModifierMax: number
  //   相討ち tiebreak
  battleSimOrganizationTiebreakEpsilon: number
  //   maxTicks 到達時の決着 (§8.2 補足): 残存 org 合計の相対差がこの比を超えれば優勢側勝利、以下なら inconclusive
  battleMaxTicksDecisiveMarginRatio: number
  //   morale → rout
  moraleRouteThresholdFactor: number
  //   randomness
  battleRandomFactorMin: number
  battleRandomFactorMax: number
  //   commander
  commanderAssignedRegimentEffectMax: number
  commanderAdjacentRegimentEffectRatio: number
  captainGeneralBattleOrganizationDamageEffectMax: number
  captainGeneralRoutResistanceEffectMax: number
  //   outcome
  routSideRoutedShareThreshold: number
  //   warScoreDelta magnitude (§15.3。result から符号、ここから大きさ)
  battleOrderlyVictoryScoreBase: number
  battleRoutVictoryScoreBase: number
  battleDecisivenessRoutedShareWeight: number
  battleDecisivenessSpeedWeight: number
  battleDecisivenessMin: number
  battleDecisivenessMax: number
  battlePreBattleEdgeWeight: number
  battlePreBattleModifierMin: number
  battlePreBattleModifierMax: number
  // v0.49 会戦強化 — 戦列スロット・戦術・追撃・突破・戦場ログ (docs/drafts/spec-v049-update.md §20)
  //   いずれも初期実装用の仮値 (§20.1。機能完成後にまとめて調整)。
  //   戦術三すくみ (§10.2)
  battleTacticAdvantageDamageMultiplier: number
  battleTacticInsightReadEffect: number
  //   無指揮官ペナルティと隣接支援 (§9.3)
  battleUncommandedDamagePenalty: number
  battleUncommandedRoutPenalty: number
  battleUncommandedAdjacentSupportRatio: number
  //   slot-based flanking (§7.2 / §8)
  battleFlankingDamageMultiplier: number
  battleFlankingRoutPenalty: number
  //   追撃 (§12)
  battlePursuitBaseChance: number
  battlePursuitDestroyedChance: number
  battlePursuitOrgDamageMultiplier: number
  //   突破 (§11)
  battleBreakthroughBaseChance: number
  battleBreakthroughAbilityGapThreshold: number
  battleBreakthroughOrgDamageMultiplier: number
  //   destroyed の warScore 反映 (§14.5)
  battleDestroyedWarScoreWeight: number
  // 会戦単位 reputation (§16.3。総大将の decisive victory/defeat。突出武功/大失態のみ)
  battleCaptainGeneralFeatReputationScore: number
  battleCaptainGeneralFailureReputationScore: number
  //   交戦 contest (§5.4。片側回避時に両総大将の insight+command で捕捉/離脱を判定)
  battleEngagementCaptureBaseChance: number
  battleEngagementCaptureAbilityScale: number
  //   捕捉戦での戦列幅縮小 (§5.2)
  battleCaughtFrontagePenalty: number
  battleMinimumEffectiveFrontage: number
  //   BattleLog retention (§15.6。minor は保存しないため minor retention は不要)
  battleLogNormalRetentionWeeks: number
  // v0.18 Stage D: acquire_land Intent
  acquireLandIntentEnabled: boolean
  acquireLandMinTreasury: number
  acquireLandMaxIntentsPerActor: number
  // v0.22 Goal/Aim system
  goalReviewIntervalWeeks: number
  goalMinimumDurationWeeks: number
  goalSwitchThreshold: number
  goalProgressOnAimSucceeded: number
  goalProgressOnAimFailed: number
  goalProgressOnAimAbandoned: number
  aimDefaultDeadlineWeeks: number
  projectCooldownWeeks: number
  // v0.43 Aim 並列化: 1 Goal の下に複数 active Aim を許す。並列数は国・家の規模/予算に連動。
  // aimParallelismCeiling     = 静的不変上限 (integrity が検査する hard cap)。1 にすると並列無効=旧挙動。
  // aimCapacityBase           = 規模に依らず全 actor が得る基礎枠 (小国の下限)
  // aimCapacity*PerSlot       = この量ごとに並列枠 +1 (規模/予算シグナル)。最終値は ceiling でクランプ。
  aimParallelismCeiling: number
  aimCapacityBase: number
  aimCapacityProvincesPerSlot: number
  aimCapacityTreasuryPerSlot: number
  aimCapacityMembersPerSlot: number
  aimCapacityWealthPerSlot: number
  // v0.23 Person Goal/Aim/Task
  personGoalReviewIntervalWeeks: number
  personAimReviewIntervalWeeks: number
  maxActivityLogsPerPerson: number
  wealthAccumulationThreshold: number
  personAimDeadlineObtainOffice: number
  personAimDeadlineRetainOffice: number
  personAimDeadlineDefault: number
  taskActionCostLight: number
  taskActionCostNormal: number
  taskActionCostHeavy: number
  taskEffortRequiredLight: number
  taskEffortRequiredNormal: number
  taskEffortRequiredHeavy: number
  appointmentTaskModifierValue: number
  appointmentTaskModifierDurationWeeks: number
  // v0.23 Phase D: DiplomaticPlay Task-driven
  diplomaticPlayStructuralProgressFactor: number
  diplomaticPlayStructuralPowerWeight: number
  diplomaticPlayAdvantageWeight: number
  diplomaticPlayDelegateSkillImpactMax: number
  diplomaticPlayRandomnessMax: number
  diplomaticPlayTaskLeverageGainSmall: number
  diplomaticPlayTaskLeverageGainMedium: number
  diplomaticPlayTaskCommitmentGainMedium: number
  diplomaticPlayTaskProgressGainMedium: number
  diplomaticPlayTaskTensionGainMedium: number
  diplomaticPlayTaskTensionReductionSmall: number
  diplomaticPlayTaskOpponentPressureGainMedium: number
  diplomaticPlayTaskOpponentLeverageReductionSmall: number
  diplomaticPlayTaskUndermineFailTensionGain: number
  diplomaticPlayMaxActiveTasksPerSide: number
  // v0.43 §6.3: DiplomaticPlay の side あたり supporter 上限
  maxDiplomaticSupportersPerSide: number
  // v0.43 §9.13: supporter 採用に必要な joinScore 閾値 (初期観察用・balance 最終値ではない)
  diplomaticSupportJoinScoreThreshold: number
  // v0.43 §9.1: joinScore の項別 weight (各項は 0..100 / -100..100 正規化済み)
  supportJoinScoreWeightPoliticalOpinion: number // 休眠項 (§9.2: attitude writer 不在のため 0)
  supportJoinScoreWeightProximity: number
  supportJoinScoreWeightMilitarySparePower: number
  supportJoinScoreWeightTreasury: number
  supportJoinScoreWeightThreatContainment: number
  supportJoinScoreWeightLastWarPenalty: number // penalty は負 weight で表現 (§9.1)
  // v0.47.2: 募集側 delegate (反乱軍なら首謀者) の説得力を joinScore に加点する最大スケール。
  //   bonus = (charisma×0.7 + insight×0.3)/100 × supportPersuasionScale。能力で閾値を越えさせる枠。
  supportPersuasionScale: number
  // v0.47.2: 反乱軍 (popular revolt の rebel side) が支援を募るときの非対称調整。
  //   landed な polity が農民反乱に肩入れするのは本来不自然 → joinScore に penalty。
  //   一方で同じ popular_revolt 由来の「同志の叛乱国家」には bonus を与え候補化も許す。
  supportRebelBackingPenalty: number
  supportFellowRevoltBonus: number
  goalProgressOnPersonAimSucceeded: number
  goalProgressOnPersonAimFailed: number
  // v0.23 effectivePriority
  effectivePriorityOwnerDutyBonus: number
  effectivePriorityGoalAlignmentBonus: number
  effectivePriorityUrgencyMaxBonus: number
  effectivePriorityUrgencyMediumBonus: number
  effectivePriorityUrgencySmallBonus: number
  effectivePriorityDiplomaticTaskBonus: number
  effectivePriorityOfficeDutyBonus: number
  effectivePriorityOverloadThreshold: number
  effectivePriorityOverloadPenaltyPerTask: number
  weeklyActionCapacityBase: number
  weeklyActionCapacityAmbitionBonus: number
  weeklyActionCapacityAgeReduction: number
  weeklyActionCapacityAmbitionThreshold: number
  weeklyActionCapacityAgeThreshold: number
  promotePolicyShiftCost: number
  patronizeArtistCost: number
  patronizeArtistPrestigeGain: number
  commissionChronicleCost: number
  commissionChroniclePrestigeGain: number
  policyInfluenceBonusBase: number
  policyInfluenceBonusShareFactor: number
  // v0.12 Administrative capacity
  baseCountryInstitutionalCapacity: number
  rulerAdminCapacityFactor: number
  administratorCapacityFactor: number
  treasurerCapacityFactor: number
  // v0.12 Administrative load
  adminLoadPerProvince: number
  adminLoadPerCountryOffice: number
  // v0.12 Office effectiveness
  duplicateOfficeCoordinationPenalty: number
  officeHouseDiversityPenalty: number
  // v0.12 Office salary unpaid penalties
  officeUnpaidAffectionPenalty: number
  officeUnpaidRespectPenalty: number
  officeDignityUnpaidPenaltyReduction: number
  // v0.12 Share yearly update (v0.42c: 旧 polityShare* / shareYearlyRetentionRate は
  // polity share 全廃に伴い削除。係数は polityInfluence* に引き継ぎ)
  houseShareBase: number
  houseShareLeaderBonus: number
  houseShareOfficeBonus: number
  houseSharePrestigeFactor: number
  houseShareWealthFactor: number
  houseShareStatFactor: number
  // 影響力個人中心化 Phase 1a: house-tag PersonReputation の現在値合計に掛ける係数。
  // computeHouseShareRawPower に加算する成果項 (功績で家内 Share を上げる・§9・初期値 0.5)。
  houseShareReputationFactor: number
  // v0.42 §5/§18 Polity Influence (read-model)。初期値は polityShare* 系を流用。
  //   v0.42a/b では旧 polityShare* (shareUpdateSystem 用) と並存し、v0.42c で旧系を削除する。
  polityInfluenceBase: number
  polityInfluenceProvinceFactor: number
  polityInfluenceMilitaryFactor: number // landed_power の military proxy 係数 (province 数ベース)
  polityInfluenceWealthFactor: number
  polityInfluencePrestigeFactor: number
  polityInfluenceOwnerHouseBonus: number
  // 非 ownerHouse 出身 leader の家への ruler domain 補正 (ownerHouseBonus の 25〜50% 程度 — §5.4)
  polityInfluenceLeaderHouseBonus: number
  polityInfluenceOfficeFactor: number
  // 新規 domain (小さな値から開始 — §18)
  polityInfluenceMilitaryOfficeBonus: number // military domain: polity:military office holder の家
  polityInfluenceRegimentControlFactor: number // military domain: regiment_control right (active regiment のみ)
  polityInfluenceHoldingOfficeAppointmentFactor: number // land_administration domain
  // 影響力個人中心化 Phase 2: polity_office_role 任命権 (役職任命権) 保有者の直接 influence。
  // 3 種任命権 (代官/連隊/役職) を揃える (§6-7)。office domain に加算。任命された役職者の
  // office 寄与とは別計上で両立 (任命権を握る者と着座する者が別なら両方が influence を持つ)。
  polityInfluencePolityOfficeAppointmentFactor: number
  polityInfluenceFactionFactor: number // faction domain: anchor faction leader の家
  // 影響力個人中心化 Phase 1a: reputation domain。polity-tag PersonReputation の現在値合計に掛ける係数。
  // 成果項 (功績由来の影響力)。構造項と並ぶ第二の供給源 (§9・初期値 0.5)。
  polityInfluenceReputationFactor: number
  // 影響力個人中心化 Phase 1b: 運動 Project のコスト (家 wealth から拠出) と評判換算。
  // baseScore = budget × movementReputationPerCost (40 × 0.2 = 8 = project 成功 1 回相当)。
  movementProjectBaseCost: number
  movementReputationPerCost: number
  // v0.12 Administrative efficiency
  minAdministrativeEfficiency: number
  maxAdministrativeEfficiency: number
  // v0.12 Rebellion ruler house suppression
  rulerHouseRebellionSuppression: number
  // v0.12 Appointment — concurrent office limits
  concurrentOfficePenalty: number
  minAppointmentScore: number
  // v0.15 §13.4 Polity appointment scoring
  houseShareAppointmentFactor: number
  ownerHouseAppointmentBonus: number
  // v0.42 §18: appointment スコアの influence% 項 (旧 polityShareAppointmentFactor の置換先)
  polityInfluenceAppointmentFactor: number
  // v0.42 §9.2/§18: polity_office_appointment right の候補スコア補正
  polityOfficeAppointmentRightHouseBonus: number // holder House の member 候補へ
  polityOfficeAppointmentRightPersonBonus: number // holder Person 本人へ
  polityOfficeAppointmentRightHouseAssociatedBonus: number // holder Person の家の member へ
  // §9.3: right-backed faction (最大 1 つ) の active member へ。
  // 制約: rightBackedFactionBonus < polityOfficeAppointmentRightHouseBonus
  rightBackedFactionBonus: number
  // v0.42 §13/§18: acquire_political_right project
  acquirePoliticalRightBaseCost: number // House wealth → 対象 Polity treasury への transfer (§13.4)
  acquirePoliticalRightRequiredInfluencePercent: number // Aim 生成の influence 下限ゲート (0〜100 — §13.3)
  // Aim 生成の influence 上限ゲート (生成時のみ)。これ以上掌握済みの polity では acquire aim を
  // 生成しない — right なし任命は influence ベースなので掌握済み家に権利は不要 (§13.3)
  acquirePoliticalRightMaxInfluencePercent: number
  // 影響力個人中心化 Phase 4: person 保有任命権の死亡時継承閾値 (§10)。
  //   owner 家 influence% >= seize → 国回収 (強い中央権力が取り戻す) /
  //   死亡者家 influence% < retain → 国回収 (家が弱すぎて世襲維持できず) /
  //   それ以外 → 家産化 (世襲化) / 判定を flipChance で反転 (主君の気まぐれ)。
  rightInheritanceOwnerSeizeThreshold: number
  rightInheritanceHouseRetainThreshold: number
  rightInheritanceFlipChance: number
  sameHousePolityOfficePenalty: number
  // v0.14 Ability generation / inheritance
  abilityAptitudeMean: number
  abilityAptitudeStddev: number
  abilityHeritability: number
  abilityAptitudeNoiseStddev: number
  abilityInitialNoiseStddev: number
  // v0.14 Age curves
  ageCurveLifelongMaxFraction: number
  ageCurveLifelongAgeConstant: number
  ageCurveYouthMaxFraction: number
  ageCurveYouthPeakAge: number
  ageCurveYouthDeclineConstant: number
  ageCurveMidLifeMaxFraction: number
  ageCurveMidLifePeakAge: number
  ageCurveMidLifeDeclineConstant: number
  // v0.14 Growth / Decline
  abilityGrowthChanceBase: number
  // v0.45: 成長成功時の伸び幅係数。amount = max(1, round((effectiveCeil - ability) * factor))。
  // 天井と離れているほど大きく伸びる (天才の幼少期・登用直後の上限解放が高速化する)
  abilityGrowthGapFactor: number
  abilityDeclineChanceBase: number
  abilityActiveDeclineMultiplier: number
  // v0.14 Estate Settlement
  estateBaseRecoveryRate: number
  estateShareEffectStrength: number
  estateRecoveryRateMin: number
  estateRecoveryRateMax: number
  estateSettledNormalWealthRatio: number
  // v0.17 Faction lifecycle
  factionFormationThreshold: number
  factionFounderShareRank: number
  factionDisbandThreshold: number
  factionDisbandWealthFloor: number
  minimumFactionFounderWealth: number
  initialFactionMemberMax: number
  minimumInitialFactionMembers: number
  minimumFactionMembers: number
  // 派閥拡大 WI-1: cap を patron 力 (席数) + leader 才能連動に再設計する。
  factionHardCap: number
  factionCapMeritFloor: number
  factionCapMeritDivisor: number
  factionViabilityMemberCountWeight: number
  factionViabilityOfficeHolderWeight: number
  factionViabilityWealthWeight: number
  // v0.17 Faction opportunity score
  officeOpportunityRoleWeights: Record<Exclude<OfficeRole, 'leader'>, number>
  // v0.17 Faction recruitment
  baseFactionRecruitmentCost: number
  factionRecruitmentPrestigeCostFactor: number
  factionRecruitmentAbilityCostFactor: number
  factionRecruitmentSigningBonusRate: number
  recruitmentInitialAffection: number
  recruitmentInitialRespect: number
  // 派閥拡大 WI-0: 引力勾配 (明示 merit 注入)。
  recruitmentTalentWeight: number
  recruitAttractivenessPowerWeight: number
  recruitAttractivenessMeritWeight: number
  recruitAttractivenessPrestigeWeight: number
  // 派閥拡大 WI-2: 流動 (housed 無役を待機期間連動で他家派閥募集に解禁)。
  factionCrossHouseBaseIdleYears: number
  factionCrossHouseAmbitionReduction: number
  // v0.17 Faction nomination / appointment
  factionNominationPowerThreshold: number
  factionOwnerHouseNominationBonus: number
  factionBailiffNominationWeight: number
  factionalAppointmentScoreScale: number
  // v0.17 Faction patronage
  factionDonationRate: number
  factionDonationPersonalReserve: number
  factionDonationAffectionGain: number
  factionDonationRespectGain: number
  factionDonationAffectionGainSmall: number
  factionStipendBase: number
  factionLeaderReserveWealth: number
  factionStipendAffectionGain: number
  factionStipendRespectGain: number
  factionStipendShortageAffectionPenalty: number
  factionStipendShortageRespectPenalty: number
  // v0.17.4 §13.9 Faction defection (idle メンバー離脱)
  factionDefectionGraceYears: number
  factionDefectionProbPerYear: number
  factionDefectionAttitudeAffectionPenalty: number
  factionDefectionAttitudeRespectPenalty: number
  // 派閥拡大 WI-3: 崩壊 3 機構 (集積を有限化しスノーボールを防ぐ・振動の片翼)。
  // 各機構は config フラグで個別 toggle 可能 (SR-6: 崩壊 OFF 中間計測で A/B 帰属)。
  factionCollapseSuccessionEnabled: boolean // 崩壊1: 不完全な継承 (求心力の弱い跡継ぎから高野望・高才能 member が離散)
  factionCollapseOverreachEnabled: boolean // 崩壊2: 過伸長離脱加速 (役職を配れない大派閥ほど離脱が速い)
  factionCollapseRivalEnabled: boolean // 崩壊3: rival 闘争 (measure-first・既存 OfficeTerm/acquire_right の churn で足りるか観測)
  factionSuccessionScatterThreshold: number // 崩壊1: scatterScore = ambition×(1−loyalty)×(0.5+talent) がこれを超えると離散
  factionOverreachDefectionWeight: number // 崩壊2: prob 乗数 (1 + weight×(1−placementRatio))
  factionAmbitionDefectionWeight: number // 崩壊2: prob 乗数 (1 + weight×ambition)
  // 派閥拡大 入れ子 (Phase 2-a 形成): 弱小 root 派閥が強い root 派閥の傘下に入る。
  factionNestingMinAgeYears: number // 傘下入りを検討する前の最小存続年数 (低迷期間)
  factionNestingMaxBranches: number // 1 親が直接持てる子派閥の最大数
  factionNestingMaxDepth: number // 木の最大深さ (root=0)
  factionNestingNpDiscount: number // Phase 2-b: 子孫メンバーの NP/候補寄与の深さあたり減衰率 (0..1)
  // v0.17 House surplus
  houseWealthReserveTarget: number
  houseSurplusDistributionMonthlyRate: number
  // v0.17 Office terms
  officeTermYears: {
    polity: Record<Exclude<OfficeRole, 'leader'>, number>
    house: Record<Exclude<OfficeRole, 'leader'>, number>
  }
  provinceOfficeTermYears: {
    bailiff: number
  }
  // v0.25 Bailiff system
  defaultContractedRemittanceRate: number
  defaultExpectedBailiffFeeRate: number
  minLocalExtractionRate: number
  maxLocalExtractionRate: number
  comfortableLocalExtractionRate: number
  minBailiffCollectionEfficiency: number
  baseBailiffCollectionEfficiency: number
  // v0.49: 代官の stewardship が徴税効率に与える振れ幅。((stew-60)/60 clamp[-0.5,1]) * range を
  //   base に加算。range を上げるほど有能代官と無能代官の徴収額差が開く (~2x 目標)。
  bailiffStewardshipCollectionRange: number
  placeholderBailiffCollectionEfficiency: number
  collectionFrictionFactor: number
  maxBailiffFeeRate: number
  bailiffTaskCompletedCollectionModifier: number
  bailiffTaskNoneCollectionModifier: number
  localExtractionWealthPenalty: number
  localExtractionUnrestGain: number
  bailiffBurdenAffectionPenaltyFactor: number
  bailiffProtectResidentsAffectionBonus: number
  bailiffTaskCompletedRespectGain: number
  // v0.49: 住民→代官の respect(尊敬/軽蔑) を「有能さ＋実績」で動かす(苛烈さ=affection とは独立軸)。
  //   respectDelta = clamp((governanceCompetence - bailiffRespectNeutralScore) * bailiffAbilityRespectFactor
  //                        + (task完了 ? +Completed : 0), ±bailiffRespectMaxDelta)。
  //   competence = command*0.5 + learning*0.5。有能なら尊敬↑、低能力なら軽蔑↓(負ドリフトが駆動)。
  bailiffAbilityRespectFactor: number
  bailiffRespectNeutralScore: number
  bailiffRespectMaxDelta: number
  // v0.17 Office max (Polity rank x province count)
  polityOfficeMaxByRank: Record<PolityRank, Record<Exclude<OfficeRole, 'leader'>, number>>
  // commonwealth 専用 office max。rank に依らず全 role を解放し (>=1)、席数は rank に応じる。
  // province factor は掛けない (commonwealth の役職席は領土規模ではなく政体の格 = rank で決まる)。
  // 理由: commonwealth の権力闘争は役職争奪で駆動されるが、通常テーブル + province factor では
  //   rank 5 (≈1 province) の commonwealth が宰相1席のみに潰れ、争いの余地が無くなるため。
  polityOfficeMaxByRankCommonwealth: Record<
    PolityRank,
    Record<Exclude<OfficeRole, 'leader'>, number>
  >
  polityOfficeMaxProvinceFactor: {
    small: number
    medium: number
    large: number
  }
  // v0.17 Office compatibility lookup
  compatibleOfficePenalty: number
  incompatibleOfficePenalty: number
  compatibleShareReductionMax: number
  // v0.17 Office overlap / Share
  // v0.17 Houseless persons
  houselessPersonsPerHolding: number
  houselessMaleRatio: number
  targetHouselessPersons: number
  softMaxHouselessPersons: number
  hardMaxHouselessPersons: number
  houselessProtectionYears: number
  pruningPrestigeThreshold: number
  pruningWealthThreshold: number
  pruningMinDwellYears: number
  protectionPrestigeThreshold: number
  // v0.17 Occupation抽選 weights
  occupationWeights: Record<PersonBackgroundOccupation, number>
  // v0.26 Project system
  projectDefaultTargetProgress: number
  projectAdvanceProgressSuccess: number
  projectAdvanceProgressPartial: number
  projectAdvanceProgressFailure: number
  prepareProjectPartialTargetProgressPenalty: number
  diplomaticProjectPreparationGainSuccess: number
  diplomaticProjectLeverageGainSuccess: number
  diplomaticProjectCommitmentGainSuccess: number
  diplomaticProjectPreparationGainPartial: number
  diplomaticProjectLeverageGainPartial: number
  diplomaticProjectCommitmentGainPartial: number
  aimProgressGainLandOrContractProject: number
  aimProgressGainDevelopmentProject: number
  aimProgressGainPowerProject: number
  aimProgressGainCultureProject: number
  aimProgressCompletionTolerance: number
  projectDeadlineWeeksDevelopment: number
  projectDeadlineWeeksDiplomatic: number
  // v0.55 §22: 建設資材 shortage / 追加予算を考慮した kind 別 deadline。
  projectDeadlineWeeksHoldingDevelopment: number
  projectDeadlineWeeksRealEstateDevelopment: number
  projectStageMaxAttempts: number
  pressureResponseDefaultDeadlineWeeks: number
  supervisedProjectWorkloadWeight: number
  officeWorkloadWeight: number
  activeTaskWorkloadWeight: number
  taskOutcomeSuccessMargin: number
  // v0.27 HoldingImprovement / development selector
  holdingImprovementDevelopmentScorePerLevel: Record<HoldingImprovementKind, number>
  // v0.33: ネスト反転 + Partial 化。未定義/0 = 建設不可。access は [kind]?.[holdingKind] ?? 0
  holdingImprovementMaxLevelByKind: Record<
    HoldingImprovementKind,
    Partial<Record<HoldingKind, number>>
  >
  developHoldingTargetDevelopmentThreshold: number
  developHoldingProjectBaseCostByImprovementKind: Record<HoldingImprovementKind, number>
  developHoldingProjectBaseProgressByImprovementKind: Record<HoldingImprovementKind, number>
  // v0.33: capacity 生成テーブル（§8.3-8.5）。Partial = 未定義は寄与 0 / multiplier 1.0
  holdingImprovementClassCapacityPerLevel: Record<
    HoldingImprovementKind,
    Partial<Record<PopClass, number>>
  >
  holdingImprovementTerrainCapacityMultiplier: Record<
    HoldingImprovementKind,
    Partial<Record<ProvinceTerrain, number>>
  >
  holdingImprovementFeatureCapacityMultiplier: Record<
    HoldingImprovementKind,
    Partial<Record<ProvinceFeature, number>>
  >
  improvementLevelCostMultiplier: Record<number, number>
  improvementLevelProgressMultiplier: Record<number, number>
  projectBudgetMarginMultiplier: number
  projectCompletedRespectGain: number
  // v0.31 House Founding
  houseFoundingEnabled: boolean
  houseFoundingMinWealth: number
  houseFoundingMinPrestige: number
  houseFoundingMinActivityLogs: number
  houseFoundingMonthlyChance: number
  houseFoundingMaxPerMonth: number
  houseFoundingWealthTransferRate: number
  // v0.31 Founder Family Generation
  founderFamilyGenerationEnabled: boolean
  founderSpouseChanceYoung: number
  founderSpouseChanceMid: number
  founderSpouseChanceOld: number
  founderChildBaseChance: number
  founderMaxGeneratedChildren: number
  // v0.31 Influential House / Political Engagement
  // v0.42: 旧 influentialHousePolityShareThreshold (share → influence 入力差替に伴い改名)
  influentialHousePolityInfluenceThreshold: number
  // v0.31 House Founding interval (used by tick.ts scheduled system)
  houseFoundingIntervalWeeks: number
  // v0.32 Clan Formation
  influentialHouseWealthThreshold: number
  influentialHouseLegacyPrestigeThreshold: number
  clanFormationIntervalWeeks: number
  clanFormationMinDirectCadetHouses: number
  clanFormationMinInfluentialHouses: number
  clanFormationMinTotalLivingMembers: number
  clanFormationMinTotalWealth: number
  clanFormationMinTotalLegacyPrestige: number
  // v0.40 LifeStage
  lifeStageTransitionAges: {
    adolescence: LifeStageTransitionAge
    young_adulthood: LifeStageTransitionAge
    mature_adulthood: LifeStageTransitionAge
    old_age: LifeStageTransitionAge
  }
  lifeStageTransitionChanceEarly: number
  lifeStageTransitionChanceStandard: number
  // v0.40 LifeStage influence
  lifeStageParentInfluenceRateByStage: Partial<Record<LifeStage, number>>
  lifeStageHouseLeaderInfluenceRateByStage: Partial<Record<LifeStage, number>>
  lifeStageHouseAdultInfluenceRateByStage: Partial<Record<LifeStage, number>>
  lifeStageParentFactionInfluenceRateByStage: Partial<Record<LifeStage, number>>
  maxLifeStageInfluencersPerChild: number
  maxAttitudeTargetsInheritedPerInfluencer: number
  // v0.40 parental ability bonus
  parentalAbilityGrowthChanceBonus: number
  // v0.40 old age candidate penalty（appointment=減算 / 軍事=乗算）
  oldAgeAppointmentScorePenalty: number
  oldAgeCommandScoreMultiplier: number
  // v0.44 PersonReputation decay / cleanup (§4.3-4.5)
  // personReputationMonthlyRetentionRate は 0 < rate < 1 を invariant とする (expiryWeek 計算が前提)
  personReputationMonthlyRetentionRate: number
  personReputationCleanupThreshold: number
  // v0.44 成果経験: Project terminal (§5.4)
  projectExperienceGainCompleted: number
  projectExperienceGainFailed: number
  projectExperienceGainCancelledMultiplier: number
  // v0.44 経験 → 即時成長変換 (§3.2): 経験 1 点あたりの +1 期待値 (%)
  experienceImmediateGrowthChancePerPoint: number
  // v0.44 評判 baseScore: Project (§5.5)
  personReputationProjectSuccessBase: number
  personReputationProjectFailureBase: number
  // v0.44 personal_training (§6)
  personalTrainingTargetProgress: number
  personalTrainingDeadlineWeeks: number
  // v0.44 成果経験: DiplomaticPlay terminal (§7.7)
  diplomaticPlayExperienceGainSuccess: number
  diplomaticPlayExperienceGainFailure: number
  diplomaticPlayExperienceGainStatusQuo: number
  diplomaticPlayExperienceGainCancelledMultiplier: number
  // v0.44 評判 baseScore: Diplomacy (§7.8)
  personReputationDiplomacySuccessBase: number
  personReputationDiplomacyStatusQuoBase: number
  personReputationDiplomacyStatusQuoFailureBase: number
  personReputationDiplomacyFailureBase: number
  // v0.44 成果経験: War terminal (§8.5)
  warExperienceGainVictory: number
  warExperienceGainDefeat: number
  warExperienceGainWhitePeace: number
  warExperienceGainCancelledMultiplier: number
  // v0.44 評判 baseScore: War (§8.6) + captain general 比の現場指揮官係数 (経験・評判共通)
  personReputationWarVictoryBase: number
  personReputationWarDefeatBase: number
  warCommanderAwardFactor: number
  // v0.44 評判の任用反映 (§9): raw 合算の clamp + 注入先係数 (office ±5 / war ±15)
  appointmentReputationModifierCap: number
  officeReputationScoreFactor: number
  warCommandReputationScoreFactor: number
  // v0.45 天才: 人物生成時の低確率ロールで対応能力の天賦 (min-max) と初期値を引き上げる。
  // chance 0 で無効。型比率は 3 weight の合計正規化 (任意の比率を書ける)。
  geniusAppearanceChance: number
  geniusAptitudeMin: number
  geniusAptitudeMax: number
  geniusTypeWeightCommander: number
  geniusTypeWeightChancellor: number
  geniusTypeWeightUniversal: number
  // v0.46 共和国整備: established commonwealth を共和国として初期化・運営する。
  // 初期化 (建国式) で seed する非 leader office の slot 数。すべて 1 (大規模化は将来)。
  republicInitialAdministratorSlots: number
  republicInitialTreasurerSlots: number
  republicInitialMilitarySlots: number
  republicInitialAdvisorSlots: number
  // seed した office holder に personal appointment right を grant するか。
  republicGrantInitialPersonalRights: boolean
  // 任期制 leader の任期年数 (startYear からの経過年で election を起こす)。
  republicLeaderTermYears: number
  // UI で「共和国が単一 holder に支配されている」と視覚強調する topPercent 閾値 (event 発火には使わない)。
  republicDominantHolderThreshold: number
  // 候補列挙の除外閾値: 対象 Polity への affection がこれ以下なら候補から外す / workload 上限。
  republicCandidateMinAffection: number
  republicCandidateMaxWorkload: number
  // 候補 scoring の係数 (仮値・機能完成後のバランス調整で再較正)。
  republicCandidatePrestigeFactor: number
  republicCandidateWealthFactor: number
  republicCandidateWealthCap: number
  republicCandidateAttitudeFactor: number
  republicOfficeExperienceBonus: number
  republicHouselessFounderBonus: number
  republicLandlessHouseMemberBonus: number
  republicWorkloadPenaltyFactor: number
  // obtain_office / acquire_political_right が共和国を target にするときの加点 (Phase C)。
  republicAcquireRightBaseBonus: number
  // 任期 leader election (§5.2.6) の現職補正: 在任で incumbency bonus を得るが、在任年数に
  //   比例した fatigue penalty で相殺され、いずれ挑戦者に抜かれて交代する (終身 leader 防止)。
  republicLeaderIncumbencyBonus: number
  republicLeaderFatiguePerYear: number

  // === v0.47 称号・分封・領邦再編 (spec §16) ===
  // §16.1 rank promotion (陞爵)。per-rank は対象 newRank 2〜4 のみ埋める sparse Record
  //   (noUncheckedIndexedAccess で number | undefined。undefined = 要件未定義 → gate は保守的に fail 扱い)。
  rankPromotionMinHoldingCountByRank: Partial<Record<PolityRank, number>>
  rankPromotionMinTreasuryByRank: Partial<Record<PolityRank, number>>
  rankPromotionMinPrestigeByRank: Partial<Record<PolityRank, number>>
  rankPromotionMinAdminPowerByRank: Partial<Record<PolityRank, number>>
  rankPromotionRetryCooldownWeeks: number
  rankPromotionAcceptThreshold: number
  rankPromotionApproverAttitudeWeight: number
  rankPromotionPrestigeWeight: number
  rankPromotionPowerWeight: number
  rankPromotionProjectProgressWeight: number
  // §16.2 land grant (分封)
  landGrantMinWealthForPetitioner: number
  landGrantMinReputationScore: number
  landGrantMinGrantorHoldingCount: number
  landGrantGrantorMinRemainingHoldingCount: number
  landGrantInitialTreasury: number
  landGrantInitialLegacyPrestige: number
  landGrantContractTaxRate: number
  landGrantAcceptThreshold: number
  landGrantApproverAttitudeWeight: number
  landGrantPetitionerReputationWeight: number
  landGrantProjectProgressWeight: number
  landGrantRetryCooldownWeeks: number
  // 有家分封: 筆頭 share がこの % 以下なら家の権力が分散しているとみなし、本拠(primary/=1-polity 家では
  //   sink 兼) を donor 解禁する (集中していれば本拠は割らせない)。
  landGrantCoreDonorMaxTopSharePercent: number
  // 有家分封の accept 閾値 (家 share 加重意見 + project.progress)。無家分封は landGrantAcceptThreshold。
  landGrantHouseSupportThreshold: number
  // §16.3 cadet branch (Polity 譲渡による分家)
  cadetBranchExcludeTopSuccessionRanks: number
  cadetBranchMinAmbition: number
  cadetBranchMinSupportPercent: number
  cadetBranchTitleTransferSupportThreshold: number
  cadetBranchRetryCooldownWeeks: number
  // §16.4 republic house foundation (共和国 House 創設)
  republicHouseFoundingMinWealth: number
  republicHouseFoundingRetryCooldownWeeks: number
  // §16.5 consolidation (一円支配集約)
  houseDomainConsolidationMinOwnedPolityCount: number
  houseDomainConsolidationMinBenefit: number
  houseDomainConsolidationRetryCooldownWeeks: number
  // === v0.50 騎兵連隊 (cavalryEntitlementSystem) ===
  cavalryEntitlementByRank: Partial<Record<PolityRank, number>>
  cavalryEntitlementBasePower: number
  cavalryDestroyedCooldownWeeks: number
  // === v0.50 cavalry charge ===
  battleCavalryChargeBaseChance: number
  battleCavalryChargeCommanderThreshold: number
  battleCavalryChargeMaxPerBattlePerSide: number
  battleCavalryChargeFailureOrgDamage: number
  battleCavalryChargeFailureMoraleDamage: number
  battleCavalryChargeTargetOrgThreshold: number
  battleCavalryChargeTargetMoraleThreshold: number
  battleCavalryChargeTerrainMultiplierByKind: Record<BattlefieldKind, number>
  // === v0.50 cavalry screen ===
  battleCavalryScreenBaseChance: number
  battleCavalryScreenPursuitReduction: number
  battleCavalryScreenDestroyedReduction: number
  battleCavalryScreenMoraleShockReduction: number
  battleCavalryScreenTerrainMultiplierByKind: Record<BattlefieldKind, number>
  // === v0.50 cavalry reserve pursuit ===
  battleCavalryReservePursuitBaseChance: number
  battleCavalryReservePursuitDestroyedChance: number
  // === v0.50 morale rally / shock ===
  battleMoraleRallyPerRetreat: number
  battleMoraleRallyPerRout: number
  battleMoraleRallyPerDestroyed: number
  battleMoraleShockPerRetreat: number
  battleMoraleShockPerRout: number
  battleMoraleShockPerDestroyed: number
  battleMoraleRallyCapPerTick: number
  battleMoraleShockCapPerTick: number
  battleMoraleRallyFrontlineRatio: number
  battleMoraleRallySideRatio: number
  battleMoraleShiftLogThreshold: number
  // === v0.51 兵站・補給・消耗 ===
  warSupplyEnabled: boolean
  warSupplyPressureMildThreshold: number
  warSupplyPressureModerateThreshold: number
  warSupplyPressureSevereThreshold: number
  warSupplyPressureCatastrophicThreshold: number
  warSupplyPressureDecayPerWeek: number
  warSupplyPressureGainFactor: number
  warSupplyLocalHostilityToPressureFactor: number
  warSupplyLocalHostilityDecayPerWeek: number
  warSupplyPlunderPressureDecayPerWeek: number
  warSupplyPressureToPlunderFactor: number
  warSupplyHostilityToPlunderFactor: number
  warSupplyPressureToHostilityFactor: number
  warSupplyPopUnrestToHostilityFactor: number
  warSupplyCommandDisciplineBase: number
  warSupplyAccessBase: number
  warSupplyAccessWealthFactor: number
  warSupplyAccessDevelopmentFactor: number
  warSupplyAccessControlFactor: number
  warSupplyAccessHostilityPenaltyFactor: number
  warSupplyAccessCrisisPenalty: number
  warSupplyForageBase: number
  warSupplyQuartermasterForageFactor: number
  warSupplyStrategistForageFactor: number
  warSupplyQuartermasterAccessFactor: number
  warSupplyStrategistAccessFactor: number
  warSupplyHostilityForagePenalty: number
  warSupplyOrganizationDamageByBand: Record<SupplyShortageBand, number>
  warSupplyMoraleDamageByBand: Record<SupplyShortageBand, number>
  warSupplyStrengthDamageByBand: Record<SupplyShortageBand, number>
  warSupplyCatastrophicCollapseChanceBase: number
  warSupplyCatastrophicCollapsePressureFactor: number
  wartimeRegimentRecoveryMultiplier: number
  warSupplyRecoveryMultiplierByBand: Record<SupplyShortageBand, number>
  warSupplyMaxStaffRecoveryMitigation: number
  warSupplyStaffAbsentScoreMultiplier: number
  warSupplyQuartermasterMitigationFactor: number
  warSupplyCaptainGeneralMitigationFactor: number
  warSupplyStrategistBonusFactor: number
  warSupplyCaptainGeneralForageFactor: number
  warSupplyCaptainGeneralDisciplineFactor: number
  warSupplyQuartermasterDisciplineFactor: number
  cavalrySupplyDemandMultiplier: number
  cavalryForageEfficiencyBonus: number
  cavalryPlunderEfficiencyBonus: number
  cavalrySupplyAttritionMultiplier: number
  warSupplyHarshRequisitionPressureThreshold: number
  warSupplyHarshRequisitionChanceFactor: number
  warSupplyPlunderPressureThreshold: number
  warSupplyPlunderChanceFactor: number
  warSupplyHarshRequisitionSupplyRelief: number
  warSupplyPlunderSupplyRelief: number
  warSupplyPlunderPressureRelief: number
  warSupplyHarshRequisitionHostilityGain: number
  warSupplyPlunderHostilityGain: number
  warSupplyHarshRequisitionPopWealthDamage: number
  warSupplyHarshRequisitionPopUnrestGain: number
  warSupplyPlunderPopWealthDamage: number
  warSupplyPlunderPopUnrestGain: number
  supplyForageConditionDrop: number
  supplyHarshRequisitionConditionDrop: number
  supplyPlunderConditionDrop: number
  supplySpilloverDamageMultiplier: number
  warSupplyHarshRequisitionSpilloverChance: number
  warSupplyPlunderSpilloverBaseChance: number
  warSupplyPlunderSpilloverPressureFactor: number
  warSupplyMaxSpilloverHoldings: number
  warSupplyAttritionEventStrengthThreshold: number
  // === v0.52 RealEstateAsset ===
  realEstateTerrainCapacityMultiplier: Record<
    RealEstateKind,
    Partial<Record<ProvinceTerrain, number>>
  >
  realEstateFeatureCapacityMultiplier: Record<
    RealEstateKind,
    Partial<Record<ProvinceFeature, number>>
  >
  realEstateInfrastructureModifiers: Record<RealEstateKind, RealEstateInfrastructureModifier[]>
  developRealEstateCapacityPressureThreshold: number
  minSlotOveruseModifier: number
  realEstateSlotCapacityBase: Record<HoldingKind, number>
  developRealEstateProjectBaseCost: Record<RealEstateKind, number>
  developRealEstateProjectBaseProgress: Record<RealEstateKind, number>
  realEstateSalePriceYears: number
  // === v0.54 資源経済 (spec §20) ===
  // 市場・価格
  resourceMarketSupplyEpsilon: number
  // 市場清算 rewrite (§6.3c.1): 価格幅 = basePrice × [1−swing, 1+swing] (全資源共通)。
  marketPriceSwing: number
  // fulfillmentRatio がこの閾値未満で shortage 判定 (§6.3c.1)。
  resourceShortageFulfillmentThreshold: number
  marketResourcePriceHistoryLimit: number
  marketPriceSmoothingPreviousWeight: number
  marketPriceSmoothingCurrentWeight: number
  // v0.55 §6.3: InputCategory → ResourceKind 比率配分の鋭さ (share ∝ utility^beta)。
  inputResourceChoiceBeta: number
  // v0.55 §5.4: NeedCategory → ResourceKind 比率配分の鋭さ。
  needResourceChoiceBeta: number
  // v0.55 §14.3: laborTypeFulfillmentModifier の下限 (PopType 構成が理想から外れても最低稼働率)。
  laborTypeFulfillmentFloor: number
  // v0.55 §12.4/§12.5 (抽象市場改訂): input shortage 時の output 下限。supply 0 でも
  //   inputShortageModifier = floor + (1-floor) × inputFulfillmentScale 倍は生産する (完全停止を防ぐ)。
  inputShortageOutputFloor: number
  // v0.55 §17: recipe 自動入れ替えの最小利益改善率 (月あたり最大 1 slot は system 側で atomic に保証)。
  recipeSwitchMinGainRate: number
  // v0.55: recipeSwitchSystem の実行間隔 (週)。作付け・工房設備はそう頻繁に入れ替えられないため、
  //   月次 (4) より長い四半期 (12) / 年次 (48) を選べる。tick.ts の intervalOverrides 経由。
  recipeSwitchIntervalWeeks: number
  // v0.55 §15.3: NeedTier ごとの購買力 (飽和曲線)。tierFloor=wealth0 でも買う割合、
  //   tierWealthHalf=係数が中間まで伸びる per-capita wealth。
  needTierFloor: Record<NeedTier, number>
  needTierWealthHalf: Record<NeedTier, number>
  // v0.55 §16.2: NeedTier ごとの shortage penalty (weekly wealth/unrest delta 係数)。
  needShortageWealthPenaltyByTier: Record<NeedTier, number>
  needShortageUnrestPenaltyByTier: Record<NeedTier, number>
  // recipe slot
  realEstateRecipeSlotCount: number
  // 生産
  resourceEconomyControlModifierMin: number
  realEstateProductionFacilityModifiers: Record<
    RealEstateKind,
    RealEstateProductionFacilityModifier[]
  >
  // owner income / holding due
  realEstateHoldingDueRate: number
  // v0.55: 旧 food/processed 2 軸 POP 需要・購買力・wellbeing config は NeedCategory ベース
  //   (popNeedDefinitions / needTier*) へ全面移行したため削除 (§5/§15/§16)。
  // === v0.53 押領・土地契約不履行・時効 (spec §19) ===
  realEstateSeizurePrescriptionYears: number
  landContractDefaultPrescriptionYears: number
  realEstateSeizureOpportunityThreshold: number
  landContractDefaultOpportunityThreshold: number
  seizureProjectCooldownWeeks: number
  landContractDefaultProjectCooldownWeeks: number
  enforceObligationProjectCooldownWeeks: number
  revoltOccupationNominalTaxRate: number
  violenceOpportunityMilitaryAdvantageWeight: number
  violenceOpportunityAmbitionWeight: number
  violenceOpportunityCautionWeight: number
  violenceOpportunityFiscalPressureWeight: number
  violenceOpportunityTargetWeaknessWeight: number
  violenceOpportunityBadAttitudeWeight: number
  violenceOpportunityPrizeWeight: number
  // seize の targetWeakness = max(0, seizeResistanceReference - ownerHouseResistance)。
  // 典型 resistance 上限を少し上回る基準値 (低 resistance ほど大きな weakness ボーナス)。
  seizeResistanceReference: number
  // withhold の militaryAdvantage gate: vassal は overlord 全体の military を上回れない (構造的) ため、
  // ownPolityPower > grantorPolityPower × factor で「力で踏み倒せる」を判定する (factor < 1)。
  withholdMilitaryAdvantageFactor: number
  realEstateSeizureEnforceResistanceThreshold: number
  landContractDefaultEnforcePowerThreshold: number
  terminalObligationRetentionWeeks: number
} & LandContractConfig // 調査 §5.3: LandContract 系の値も SimulationConfig に統合し --config で上書き可能に

export const defaultConfig: SimulationConfig = {
  ...defaultLandContractConfig,
  uiLocale: 'en',
  nameCultureId: 'western',
  debug: false,
  integrityPerSystem: false,
  minLivingMembersPerHouse: 4,
  maxNewPersonsPerHousePerYear: 2,
  // v0.51 陰謀リファイン (§6)。値の妥当性 (バランス) はプロトタイプ段階では defer (CLAUDE.md §4)。
  conspiracyUndermineInfluenceAmount: 30,
  conspiracyUndermineInfluenceDurationWeeks: 156,
  conspiracyAimPriorityFactor: 0.5,
  conspiracyDriveThreshold: 75,
  conspiracyTaskEffortRequired: 6,
  conspiracyTaskBaseDifficulty: 60,
  conspiracyRevokeRightBaseDifficulty: 60,
  conspiracyRevokeHouseRightDifficultyBonus: 30,
  conspiracyCooldownWeeks: 52,
  replacementThreshold: 15,
  rebellionSuccessMode: 'independence',
  maxRawEvents: 10000,
  maxChronicleEvents: 1000,
  warEnabled: true,
  warCostPerProvince: 20,
  maxProvincesPerWar: 3,
  maxWarsPerTick: 1,
  warCooldownWeeks: 96,
  minAttackerWinChanceToDeclare: 0.45,
  winChanceWarGateEnabled: true,
  disasterEnabled: true,
  famineBaseChancePerYear: 0.08,
  plagueBaseChancePerYear: 0.03,
  bountifulHarvestBaseChancePerYear: 0.05,
  disasterReliefCostPerProvince: 20,
  publicSpendingEnabled: true,
  publicSpendingYearlyChance: 0.35,
  warConqueredProvinceDevastation: 8,
  warBorderProvinceDevastation: 3,
  failedWarBorderDevastation: 3,
  rebellionStartedDevastation: 2,
  rebellionSucceededDevastation: 3,
  rebellionFailedDevastation: 5,
  famineDevastation: 5,
  famineReliefDevelopmentRecovery: 2,
  plagueDevastation: 8,
  bountifulHarvestDevelopmentGain: 3,
  // Control system
  controlMaxDistancePenalty: 10,
  controlMaxMinimum: 40,
  controlGrowthPerMonth: 2,
  controlDecayPerMonth: 1,
  disconnectedControlDecayPerMonth: 5,
  // Land development (v0.5 additions)
  landDevelopmentHouseControlGain: 5,
  landDevelopmentUnrestReduction: 1,
  // Lordship transition
  lordshipAbsorptionTargetThreshold: 50,
  lordshipAbsorptionSourceMinimum: 60,
  lordshipAbsorptionRatio: 2,
  lordshipAbsorptionMonthlyChance: 0.05,
  lordshipAbsorptionNewControlMin: 50,
  lordshipAbsorptionNewControlMax: 70,
  lordshipAbsorptionNewControlPenalty: 10,
  // Annexation
  annexedPolityControl: 35,
  newRulerHouseControl: 35,
  // v0.6 Person Ability Effects
  personAbilityEffectsEnabled: true,
  abilityOutputExponent: 1.6,
  houseGoalPersonalityScale: 10,
  chancellorAdminControlMaxBonusPerAdmin: 1,
  houseHeadAdminControlMaxBonusPerAdmin: 1,
  treasurerCautionTaxEfficiencyEffect: 0.1,
  treasurerTaxEfficiencyMin: 0.5,
  treasurerTaxEfficiencyMax: 2.0,
  generalAmbitionDeclareThresholdEffect: 0.1,
  generalCautionDeclareThresholdEffect: 0.1,
  minWarDeclareThreshold: 0.3,
  maxWarDeclareThreshold: 0.75,
  pressureStanceAmbitionShift: 0.1,
  pressureStanceCautionShift: 0.1,
  negotiatorTermQualityEffect: 0.1,
  chancellorAmbitionLandDevelopmentScoreEffect: 10,
  chancellorCautionLandDevelopmentScoreEffect: 20,
  controlAbilityMinimumFloor: 35,
  // v0.7 Marriage
  marriageEnabled: true,
  marriageMaleMinAge: 16,
  marriageMaleMaxAge: 60,
  marriageFemaleMinAge: 15,
  marriageFemaleMaxAge: 45,
  marriageYearlyChance: 0.08,
  samePrimaryPolityMarriageBonus: 0.08,
  // v0.7 Birth
  birthEnabled: true,
  fatherMinChildAge: 15,
  fatherMaxChildAge: 60,
  motherMinChildAge: 15,
  motherMaxChildAge: 45,
  // v0.33+ 家制度バランス: 家内出生を中庸に増やし「有力な大家系が栄枯盛衰しながら現れる」状態を作る
  // (0.06 では全家が平均~2人に希釈し size-7+ 家が出現しなかった。houseFounding 絞りとセット)
  baseBirthChancePerMalePerYear: 0.09,
  spouseMotherChance: 0.9,
  // v0.45.4: 男:女 ≈ 3:1 (性別役職適格ゲートで可視化された男性人材不足への人口側対応。
  //   出生は per-male なので男性多め化で出生数は減らない — 人口はダンパーが自己調整)
  maleBirthChance: 0.75,
  maleBirthChanceWhenAdultMaleShortage: 0.85,
  adultMaleShortageThreshold: 0.4,
  // v0.45.1: 旧絶対値 (target 180 / critical 90) は tiny の初期人口 ~92 の ×2 / ×1 相当
  //   だったため、係数化で tiny の挙動をほぼ維持しつつ全 preset に比例させる。
  //   high 帯 (×3 以上で出生 0.5 倍) は死亡率 U 字化 (§6.7) で純再生産率が 1 を超えたため
  //   新設した上限ダンパー。人口は baseline ×2〜×3 の帯で安定する。
  targetLivingPersonsFactor: 2.0,
  criticalLivingPersonsFactor: 1.0,
  highLivingPersonsFactor: 4.0, // v0.45.4: 3.0→4.0 人口増 (×1.0 帯拡大。平衡 ~baseline×4.5-5.5)
  lowPopulationBirthMultiplier: 1.5,
  criticalPopulationBirthMultiplier: 3.0,
  highPopulationBirthMultiplier: 0.5,
  // v0.45.1 Mortality: U字カーブ (旧実装は 0-39歳一律 0.004 = 年率4.7%で、出生→40歳の
  //   生存率が 14.6% しかなく夭折がデフォルトだった)。幼児死亡は高いまま残し、
  //   小児〜壮年を下げて「生き延びた者は壮年まで届く」分布にする。
  //   期待生存率: 出生→15歳 ≈ 73% / →40歳 ≈ 57% / →60歳 ≈ 28% / →70歳 ≈ 8%
  mortalityRateInfant: 0.004, // 0-2歳 (年率 4.7%)
  mortalityRateChild: 0.0012, // 3-14歳 (年率 1.4%)
  mortalityRatePrime: 0.0008, // 15-39歳 (年率 1.0%)
  mortalityRateMiddle: 0.003, // 40-59歳 (年率 3.5%)
  mortalityRateSenior: 0.01, // 60-69歳 (年率 11.4%)
  mortalityRateElder: 0.03, // 70歳以上 (年率 30.5%)
  geniusMortalityMultiplier: 0.5, // 天才の夭折を「稀に起こる物語」に抑える (×0.5 で出生→40歳 ≈ 76%)
  // v0.7 Succession
  adultAge: 15,
  allowFemaleHouseHeadWhenNoMaleHeir: true,
  minorHeadCohesionPenaltyPerMonth: 0.5,
  minorHeadLoyaltyPenaltyPerMonth: 0.3,
  prestigeSuccessionWeight: 1.0,
  adminSuccessionWeight: 2.0,
  martialSuccessionWeight: 1.0,
  ambitionSuccessionWeight: 10.0,
  randomSuccessionNoiseMax: 10.0,
  illegitimateSuccessionPenalty: 20,
  unknownBirthStatusSuccessionPenalty: 10,
  successionCrisisScoreGap: 10,
  // v0.7 House Split
  // v0.47 §14.1: 直接 splitHouse による landless cadet 量産を廃止 (default 無効化)。
  //   分家創設は establish_cadet_branch / request_land_grant Aim 経由 (Phase 6/7) に置換。
  //   system 自体は残し、unit test や将来の有効化に備える。
  houseSplitEnabled: false,
  minProvincesForHouseSplit: 3,
  houseSplitCohesionThreshold: 60,
  baseHouseSplitChance: 0.1,
  houseSplitAmbitionFactor: 0.25,
  houseSplitPrestigeFactor: 0.002,
  houseSplitMartialFactor: 0.02,
  houseSplitCohesionFactor: 0.003,
  houseSplitControlMultiplier: 0.7,
  houseSplitControlMin: 30,
  houseSplitControlMax: 80,
  houseSplitUnrestGain: 5,
  houseSplitWealthShare: 0.25,
  houseSplitEvaluationIntervalWeeks: 12,
  houseSplitCooldownWeeks: 48,
  houseSplitMinLivingMembers: 5,
  houseSplitMinWealth: 80,
  houseSplitMinLegacyPrestige: 30,
  houseSplitExcludeTopSuccessionRanks: 1,
  // v0.7 House Extinction
  houseExtinctionEnabled: true,
  inheritedProvinceHouseControl: 35,
  extinctionUnrestGain: 8,
  rulerHouseExtinctionEnabled: true,
  annexByRulerExtinctionCountryControl: 30,
  rulerHouseExtinctionPrestigeLoss: 10,
  rulerExtinctionAnnexSharedBorderWeight: 20,
  rulerExtinctionAnnexPowerWeight: 0.5,
  rulerExtinctionAnnexPrestigeWeight: 0.3,
  // v0.7 Role / v0.45.3: default false — 男性プールの局所払底が常態のため、true だと
  // ungated 再試行が支配経路になり「女性役職は非常に稀」が成立しない (実測)。
  allowFemaleRolesWhenNoMaleCandidate: false,
  femaleRoleEligibilityChance: 0.03,
  // v0.8 POP system
  popSystemEnabled: true,
  minPopSizeByClass: { lower: 5, middle: 1, upper: 1 },
  minProvinceCarryingCapacity: 50,
  perCapitaFoodNeed: 1.0,
  manpowerFactorByClass: { lower: 0.03, middle: 0.01, upper: 0.06 },
  baseMonthlyGrowthByClass: { lower: 0.008, middle: 0.002, upper: 0.001 },
  populationPressureThreshold: 0.9,
  populationPressureWealthPenalty: 0.2,
  populationPressureUnrestGain: 0.3,
  povertyWealthThreshold: 25,
  povertyUnrestGain: 0.02,
  prosperityWealthThreshold: 70,
  prosperityUnrestReduction: 0.01,
  unrestNaturalDecayRate: 0.05,
  retainedWealthGainByClass: { lower: 0.3, middle: 0.45, upper: 0.25 },
  overExtractionThreshold: 0.95,
  overExtractionWealthSafeThreshold: 55,
  overExtractionUnrestSafeThreshold: 45,
  overExtractionWealthPenalty: 1.0,
  overExtractionUnrestGain: 1.5,
  classCapacityBaseByHoldingKind: {
    manor: { lower: 0, middle: 0, upper: 0 },
    city: { lower: 0, middle: 0, upper: 0 },
  },
  // v0.33 Province terrain / features (habitability スカラーを置換)
  provinceTerrainSettlementSuitability: {
    plains: 100,
    hills: 80,
    forest: 65,
    wetlands: 45,
    mountains: 35,
  },
  provinceTerrainWeights: {
    plains: 35,
    forest: 25,
    hills: 20,
    mountains: 10,
    wetlands: 10,
  },
  stateRegionDominantTerrainInheritanceChance: 0.7,
  provinceFeatureCoastalChance: 0.5,
  provinceCoastalEdgeMarginRatio: 0.12,
  provinceFeatureMajorRiverBaseChance: 0.15,
  provinceFeatureMajorRiverTerrainDelta: { plains: 0.1, wetlands: 0.1, mountains: -0.1 },
  provinceFeatureLakeBaseChance: 0.06,
  provinceFeatureLakeTerrainDelta: { wetlands: 0.05, plains: 0.05 },
  employedManpowerMultiplierByClass: { lower: 1.0, middle: 0.8, upper: 1.2 },
  unemployedManpowerMultiplier: 0.5,
  // v0.24 Unemployed POP penalties
  unemployedWealthDecayByClass: { lower: 0.2, middle: 0.3, upper: 0.15 },
  unemployedUnrestGainByClass: { lower: 0.2, middle: 0.35, upper: 0.45 },
  unemployedGrowthModifierByClass: { lower: 0.6, middle: 0.5, upper: 0.7 },
  // v0.24 Initial POP generation
  initialPopFillRatioMin: 70,
  initialPopFillRatioMax: 95,
  // v0.24 POP epsilon
  popSizeEpsilon: 0.01,
  bountifulHarvestPeasantWealthGain: 10,
  bountifulHarvestPeasantUnrestReduction: 5,
  bountifulHarvestTownsmanWealthGain: 2,
  bountifulHarvestTownsmanUnrestReduction: 1,
  warWealthDamage: 8,
  warUnrestDamage: 10,
  warPeasantSizeDamage: 0.5,
  warTownsmanSizeDamage: 0.3,
  famineWealthPenalty: 8,
  famineSizeDamageRate: 0.1,
  famineReliefDamageMultiplier: 0.3,
  faminePressureChanceBonus: 9.2,
  plagueWealthPenalty: 10,
  plagueSizeDamageRate: 0.05,
  plaguePressureChanceBonus: 2.0,
  // v0.48 Crisis (§7.2)。balance は機能完成後にまとめて調整する前提の暫定値 (CLAUDE.md §4)。
  crisisEnabled: true,
  droughtBaseChancePerYear: 0.04,
  droughtPressureChanceBonus: 5.0,
  crisisInitialSeverityByKind: {
    famine: 30,
    plague: 35,
    drought: 25,
    war_damage: 25,
    unrest: 40,
    disrepair: 30, // = 修理工数 (Project targetProgress)。表示 severity は threshold−condition で毎週上書き (§4.3)
  },
  crisisSeverityPressureBonus: 20,
  crisisInitialShockSizeRateByKind: {
    famine: 0.05,
    plague: 0.04,
    drought: 0.03,
    war_damage: 0.02,
    unrest: 0,
    disrepair: 0, // disrepair は初期 pop ショック無し
  },
  crisisDeadlineWeeksByKind: {
    famine: 24,
    plague: 20,
    drought: 32,
    war_damage: 32,
    unrest: 12,
    disrepair: 999, // 型充足用。disrepair は Crisis/Project とも deadline 不使用 (§4.2/4.3)
  },
  crisisBudgetTreasuryRatio: 0.1,
  crisisBudgetCapByKind: {
    famine: 60,
    plague: 80,
    drought: 50,
    war_damage: 80,
    unrest: 40,
    disrepair: 60, // 修理予算上限
  },
  crisisWeeklyWealthPenaltyPerSeverity: 0.05,
  crisisWeeklyUnrestPerSeverity: 0.04,
  crisisNeglectAffectionDropPerWeekBailiff: -0.3,
  crisisNeglectAffectionDropPerWeekPolity: -0.15,
  crisisExpiredAffectionDropBailiff: -5,
  crisisExpiredAffectionDropPolity: -3,
  // v0.48.1 設備維持管理 (§9)。balance-defer の暫定値 (CLAUDE.md §4)。
  // 減衰: condition 100 から閾値 50 まで = 50 / (0.9 × level)。L1 で ~56 サイクル = ~4.3 年/閾値到達、
  // 閾値 50 から 0 まで同程度。維持を放置した L1 設備は ~9 年弱で全壊する目安。
  facilityMaintenanceEnabled: true,
  facilityConditionDecayPerCyclePerLevel: 0.9,
  facilityDisrepairThreshold: 50,
  facilityDisrepairMinEffectiveness: 0,
  criticalInfraMinEffectiveness: 0.5,
  facilityRepairConditionRestore: 100,
  warDamageConditionDrop: 40,
  facilityConditionSeedJitterMin: 70,
  // v0.48.2 定期保守: 80 未満で代官が保守 → 100 に回復。費用 = 3 × level。
  facilityMaintenanceThreshold: 80,
  facilityMaintenanceConditionRestore: 100,
  facilityMaintenanceCostPerLevel: 3,
  crisisDisrepairNeglectMultiplier: 0.4, // disrepair の neglect を他 Crisis の 40% に抑える (deadline 無しで長期蓄積するため)
  // 灌漑→干魃 / 貯蔵→飢饉 の被害軽減。max level 3 なので reduction 0.25/level = 最大 75% 軽減 (25% 残る)。
  crisisMitigationByKind: {
    drought: { improvementKind: 'irrigation_infrastructure', reductionPerLevel: 0.25 },
    famine: { improvementKind: 'storage_infrastructure', reductionPerLevel: 0.25 },
  },

  // Military v0.9
  houseManpowerPowerFactor: 1.0,
  houseMilitaryWealthReserve: 100,
  houseWealthMilitaryFactor: 8.0,
  maxMercenaryPowerRatio: 0.5,
  houseCommanderMartialEffect: 0.25,
  minCommanderModifier: 0.75,
  maxCommanderModifier: 1.25,
  polityAdminMilitaryFactor: 0.3,
  minHouseMilitaryContribution: 0.25,
  // HouseRebellion v0.9
  houseRebellionNobleUnrestFactor: 0.15,
  houseRebellionProvinceUnrestFactor: 0.05,
  houseRebellionLowControlFactor: 0.1,
  rebellionTreasuryPowerDivisor: 50,
  // ProvinceRevolt tendency
  provinceRevoltThreshold: 90,
  provinceRevoltChanceDivisor: 300,
  provinceRevoltMaxChance: 0.35,
  provinceRevoltUnrestFactor: 1.2,
  provinceRevoltLowHouseControlFactor: 0.2,
  provinceRevoltLowCountryControlFactor: 0.2,
  provinceRevoltStabilitySuppressionFactor: 0.2,
  revoltAbilitySuppressionFactor: 0.4,
  revoltAbilityNeutralScore: 50,
  // ProvinceRevolt class-specific tendency
  peasantRevoltPovertyFactor: 0.5,
  peasantRevoltPressureFactor: 10,
  townsmenRevoltProductionFactor: 0.02,
  townsmenRevoltExtractionFactor: 5,
  nobleRevoltHouseDisloyaltyFactor: 0.2,
  nobleRevoltLowLegitimacyFactor: 0.2,
  // ProvinceRevolt power
  popRevoltPowerFactorByClass: { lower: 0.02, middle: 0.015, upper: 0.08 },
  provinceRevoltHouseSuppressionFactor: 1.0,
  provinceRevoltCountrySuppressionFactor: 0.8,
  provinceRevoltTreasurySuppressionFactor: 2.0,
  provinceRevoltHouseWealthSuppressionFactor: 2.0,
  // ProvinceRevolt outcomes
  provinceRevoltConcessionCountryControlLoss: 10,
  provinceRevoltConcessionHouseControlLoss: 15,
  provinceRevoltConcessionUnrestReduction: 20,
  provinceRevoltConcessionHouseWealthLoss: 20,
  provinceRevoltLordshipChangeSuccessMargin: 0.15,
  provinceRevoltLordshipChangeCountryControlLoss: 10,
  provinceRevoltNewHouseControl: 50,
  // ProvinceRevolt independence
  provinceRevoltIndependenceCountryControlMax: 10,
  provinceRevoltIndependenceHouseControlMax: 10,
  provinceRevoltIndependenceSuccessMargin: 0.2,
  provinceRevoltNewCountryControl: 40,
  // ProvinceRevolt failure
  provinceRevoltFailedUnrestReduction: 10,
  provinceRevoltFailedDevastation: 4,
  provinceRevoltFailedWealthPenalty: 8,
  provinceRevoltSuppressionCollateralUnrestGain: 2,
  // Legacy Prestige
  attitudeMonthlyRetentionRate: 0.995,
  initialPolityLegacyPrestigeMin: 20,
  initialPolityLegacyPrestigeMax: 60,
  initialHouseLegacyPrestigeMin: 20,
  initialHouseLegacyPrestigeMax: 80,
  initialPersonLegacyPrestigeMin: 0,
  initialPersonLegacyPrestigeMax: 20,
  // ProvinceRevolt new entities
  revoltHouseInitialLegacyPrestige: 10,
  revoltHouseInitialWealth: 30,
  revoltPolityInitialTreasury: 50,
  revoltPolityInitialLegacyPrestige: 20,
  // v0.18 Stage B: DiplomaticPlay 基盤
  diplomaticPlaySettlementThreshold: 60,
  diplomaticPlayEscalationThreshold: 40,
  diplomaticPlayBaseTensionGain: 5,
  // v0.18 Stage B: Revolt negotiation
  revoltNegotiationDurationWeeks: 48,
  revoltAcceptRebelPowerFactor: 0.1,
  revoltAcceptSuppressionFactor: 0.05,
  revoltConcessionSeverityMinor: 10,
  revoltConcessionSeverityMajor: 25,
  // v0.48: 民衆反乱の目的分岐 (仮値、balance-defer)
  revoltIndependenceHouseAffectionThreshold: -30,
  revoltBailiffDismissalAffectionThreshold: -20,
  revoltBailiffReputationPenalty: -12,
  revoltBailiffRevoltHouseAffectionPenalty: -3,
  revoltBailiffDismissalFailHouseAffectionPenalty: -8,
  revoltTaxReliefFizzleHouseAffectionPenalty: -5,
  minPopularDemandTaxRate: 0.05,
  popularTaxReliefDemandDelta: 0.1,
  taxReliefSeverityFactor: 200,
  popularTaxReliefTermsProtectionWeeks: 192,
  // v0.39.1: revolt_negotiation task-based hybrid model
  revoltNegotiationEnvFactor: 0.08,
  revoltNegotiationSettlementPrepWeight: 0.15,
  revoltNegotiationSettlementLeverageWeight: 0.1,
  revoltNegotiationEscalationCommitmentWeight: 0.15,
  // v0.18 Stage B: Revolt settlement effects (§12.4)
  revoltSettlementMainUnrestReduction: 30,
  revoltSettlementOtherUnrestReduction: 8,
  revoltSettlementTreasuryCostMinor: 50,
  revoltSettlementTreasuryCostMajor: 150,
  // v0.18 Stage B: Revolt suppression effects (§14.6)
  revoltSuppressedMainUnrestReduction: 35,
  revoltSuppressedOtherUnrestReduction: 10,
  revoltSuppressedDevelopmentDamage: 4,
  revoltSuppressedWealthPenalty: 8,
  taxBurdenWeight: 80,
  recentTaxIncreaseWeight: 30,
  recentTaxIncreaseDecayWeeks: 96,
  recentSuppressionCooldownWeeks: 96,
  recentSuppressionTendencyReduction: 40,
  taxRevisionSystemEnabled: true,
  taxRevisionTreasuryThreshold: 300,
  taxRevisionTreasuryNeedFactor: 0.05,
  taxRevisionLowUnrestFactor: 0.5,
  taxRevisionUnrestSafeThreshold: 30,
  taxRevisionHighUnrestPenalty: 0.8,
  taxRevisionUnrestDangerThreshold: 50,
  taxRevisionHighTaxThreshold: 0.35,
  taxRevisionHighTaxPenalty: 1.0,
  taxRevisionAmbitionFactor: 15,
  taxRevisionCautionPenalty: -20,
  taxRevisionInsightPenalty: -10,
  taxRevisionWarBonus: 10,
  taxRevisionDecisionThreshold: 15,
  taxRevisionMinDelta: 0.02,
  taxRevisionMaxDelta: 0.05,
  taxRevisionSystemMaxRate: 0.6,
  taxRevisionCooldownWeeks: 96,
  taxRevisionRecentRevoltPenalty: 30,
  taxRevisionRecentRevoltDecayWeeks: 96,
  // v0.18 Stage F: land_claim acceptance (§10.3, 旧 land_purchase + land_transfer_demand 統合)
  // 注: progressLandClaim 内で融合 acceptanceScore を計算する。
  //   offered スケール係数 0.05 は旧 land_purchase の hardcoded を config 化したもの。
  //   軍事力は数百〜数千スケール、provinceValue は開発度ベース (0〜100 想定)。
  // 値の調整は Stage F 完了後の balance pass で user と一緒に見直す前提。
  claimOfferedPriceFactor: 0.05,
  claimInitiatorPressureFactor: 0.1,
  claimDefenderResistFactor: 0.12,
  claimProvinceValueFactor: 0.3,
  claimStrategicLossFactor: 0.2,
  claimPrestigeLossFactor: 0.2,
  landClaimNegotiationDurationWeeks: 72,
  landClaimInitialProgressOnConsent: 20,
  landClaimInitialTensionOnPressure: 15,
  // v0.18 contract_tax_revision
  taxRevisionIntentEnabled: true,
  taxRevisionMinRateForReduction: 0.15,
  taxRevisionMaxRateForIncrease: 0.6,
  taxRevisionMinTreasury: 200,
  taxRevisionMaxIntentsPerActor: 2,
  taxRevisionNegotiationDurationWeeks: 48,
  taxRevisionMinRate: 0.05,
  taxRevisionMaxRate: 0.8,
  taxRevisionPressureFactor: 0.08,
  taxRevisionResistFactor: 0.1,
  taxRevisionProvinceValueFactor: 0.15,
  taxRevisionRateImbalanceFactor: 50,
  taxRevisionInitialProgressOnAdvantage: 10,
  taxRevisionInitialTensionOnPressure: 10,
  taxRevisionGracePeriodYears: 5,
  landClaimGracePeriodYears: 5,
  // v0.30
  taxRevisionInitialDemandDelta: 0.1,
  taxRevisionReservationDelta: 0.05,
  taxRevisionMaxDemandDelta: 0.15,
  taxRevisionCompensationYears: 3,
  invalidOfferTensionDelta: 10,
  rejectedOfferTensionDelta: 8,
  validOfferProgressDelta: 5,
  counterOfferProgressDelta: 15,
  offerCompromiseProgressDelta: 15,
  negotiateTermsProgressDelta: 8,
  debugMixedProvinceHoldingsRatio: 0,
  // v0.18 Stage D: 汎用 conflict (§13.2)
  conflictResolutionEnabled: true,
  maxConflictsResolvedPerTick: 5,
  conflictLoserTreasuryDamageFactor: 0.4,
  conflictProvinceDevastation: 4,
  conflictPopWealthDamage: 4,
  conflictPopUnrestGain: 12,
  // v0.34 War (§15): v0.35 で per-tick drift 系 5 件は WarManeuver 化により撤廃。値は暫定。
  maxWarDurationWeeks: 520,
  // v0.35 balance: 戦争の目標 warScore。実測で「決着まで中央値 4 戦」になるよう
  //   60/50 → 12/10 に引き下げ (warBattleScoreScale 24 と対。target/scale≈0.5 が決着戦闘数を支配)。
  defaultTransferLandWarScore: 12,
  defaultChangeContractTaxWarScore: 10,
  defaultPopularRevoltWarScore: 10,
  localLevyPeasantFactor: 0.3,
  localLevyTownsmenFactor: 0.5,
  localLevyNobleFactor: 1.0,
  localLevyMinStrength: 10,
  localLevyMaxStrength: 60,
  localLevyBasePowerFactor: 0.3,
  localLevyOrganization: 30,
  localLevyMorale: 30,
  terminalWarRetentionWeeks: 48,
  // v0.35 War Maneuver (§12.2): 初期値案。バランス調整は機能完成後 (.claude/CLAUDE.md §4)。
  warAvoidanceTerrainModifierByBattlefield: {
    open_field: -0.1,
    forest_battle: 0.1,
    hill_battle: 0.05,
    mountain_pass: 0.15,
    wetland_battle: 0.15,
    river_crossing: 0.05,
    coastal_battle: 0.0,
    siege: -0.2,
  },
  warAvoidanceCountPenalty: 0.2,
  maxWarAvoidanceCount: 4,
  warAvoidanceWarScorePenalty: 1.0,
  maxWarCommanderCandidatesPerSide: 8,
  warEngagementRandomness: 0.1,
  warEngagementCautionEffect: 0.2,
  warEngagementAmbitionEffect: 0.15,
  warEngagementWarScoreUrgencyEffect: 0.3,
  warBattleRandomness: 0.1,
  // v0.35 balance: 1 戦闘あたりの warScore 振れ幅。12 → 24 (target 12/10 と対で決着まで中央値 4 戦)。
  //   scale 単独で target=60 を維持すると 1 戦 ±数十の運ゲーになるため target 引き下げと併用する。
  warBattleScoreScale: 24,
  maxWarScoreDeltaPerBattle: 12,
  battleVictoryThreshold: 1.0,
  warCommanderWarCommandEffect: 0.25,
  minWarCommanderModifier: 0.75,
  maxWarCommanderModifier: 1.25,
  captainGeneralWarScoreEffect: 0.1,
  warBattlefieldRiverCrossingChance: 0.35,
  warBattlefieldCoastalBattleChance: 0.25,
  // v0.36 Regiment (§15) — 仮値。実装後 CLI harness で再校正する。
  regimentOrganizationDamageWinnerMin: 4,
  regimentOrganizationDamageWinnerMax: 8,
  regimentOrganizationDamageLoserMin: 12,
  regimentOrganizationDamageLoserMax: 22,
  regimentOrganizationDamageInconclusiveMin: 8,
  regimentOrganizationDamageInconclusiveMax: 14,
  regimentStrengthDamageWinnerMin: 0,
  regimentStrengthDamageWinnerMax: 2,
  regimentStrengthDamageLoserMin: 2,
  regimentStrengthDamageLoserMax: 6,
  regimentStrengthDamageInconclusiveMin: 1,
  regimentStrengthDamageInconclusiveMax: 3,
  regimentOrganizationRecoveryPerWeek: 8, // v0.37 B1: provisional, co-tuned with battle damage in B2a harness
  regimentInitialMorale: 30, // v0.37 B1: = baselineMorale (was 80; start at baseline to avoid 80→30 transient)
  regimentInitialStrength: 100,
  regimentInitialOrganization: 50, // v0.37 B1: = baselineOrganization (was 100; start at baseline)
  regimentMaxStrength: 100,
  regimentDestroyedStrengthThreshold: 0,
  // v0.36 補充・再編成 — 仮値。balance 調整対象 (機能完成後にまとめて)。
  //   referencePopByClass は worldgen 実測 (manor: peasants median ~85 / nobles ~2.5、city townsmen は発達後)
  //   から median holding が factor ~1.0 になるよう仮置き。
  regimentReinforcementBasePerMonth: 4.0,
  regimentReinforcementPeaceMultiplier: 1.0,
  regimentReinforcementWarMultiplier: 0.4,
  regimentReinforcementMobilizedMultiplier: 0.25,
  regimentReinforcementReferencePopByClass: { lower: 80, middle: 15, upper: 2.5 },
  regimentReinforcementMinPopFactor: 0.1,
  regimentReinforcementMaxPopFactor: 1.5,
  regimentReinforcementCostPerStrength: 0.2,
  regimentCavalryReinforcementMultiplier: 0.75,
  regimentCavalryReinforcementCostMultiplier: 1.5,
  destroyedRegimentReformDelayWeeks: 24,
  destroyedRegimentReformInitialStrength: 20,
  destroyedRegimentReformInitialOrganization: 20,
  destroyedRegimentReformInitialMorale: 40,
  destroyedRegimentReformCost: 8,
  destroyedRegimentReformMinPopFactor: 0.25,
  // v0.37 Battlefront (§21) — すべて仮置き。Phase B の連成 harness で co-tune。
  //   baseline / max
  regimentBaselineOrganizationDefault: 50,
  regimentBaselineMoraleDefault: 30,
  regimentMaxOrganizationDefault: 100,
  regimentMaxMoraleDefault: 100,
  regimentMaxOrganizationHardCap: 120,
  regimentMaxMoraleHardCap: 100,
  //   recovery
  regimentOrganizationDecayAboveBaselinePerWeek: 1,
  regimentMoraleRecoveryPerWeek: 1,
  regimentMoraleDecayAboveBaselinePerWeek: 0.5,
  //   battle internal tick
  battleTickUnit: 'day',
  battleMaxTicks: 5,
  retreatOrganizationThreshold: 20,
  routeOrganizationThreshold: 8,
  minFightingStrengthThreshold: 10,
  //   frontage / terrain
  battlefieldFrontageByKind: {
    open_field: 5,
    coastal_battle: 4,
    hill_battle: 3,
    forest_battle: 2,
    wetland_battle: 2,
    river_crossing: 2,
    mountain_pass: 1,
    siege: 1,
  },
  battleTerrainOrganizationDamageMultiplierByKind: {
    open_field: 1.0,
    coastal_battle: 1.0,
    hill_battle: 0.9,
    forest_battle: 0.85,
    wetland_battle: 0.85,
    river_crossing: 0.8,
    mountain_pass: 0.75,
    siege: 0.75,
  },
  //   flank 地形補正 (§10.2)
  battleFlankTerrainMultiplierByKind: {
    open_field: 1.0,
    coastal_battle: 0.8,
    hill_battle: 0.8,
    forest_battle: 0.5,
    wetland_battle: 0.5,
    river_crossing: 0.4,
    mountain_pass: 0.25,
    siege: 0.2,
  },
  //   damage
  battleBaseOrganizationDamage: 5, // v0.37 B2a harness co-tune: 1 戦 org damage ≈ baseline 1/2 (24.7/50)

  battleMoraleDamageRatio: 0.25,
  battleStrengthDamageRatio: 0.08,
  winnerStrengthDamageMultiplier: 0.6,
  loserStrengthDamageMultiplier: 1.4,
  routedStrengthDamageMultiplier: 2.5,
  routAdditionalMoraleDamage: 8,
  battleStrengthOutcomeQualityMultiplierOrderly: 1.0,
  battleStrengthOutcomeQualityMultiplierRout: 1.2,
  battleStrengthPowerDisadvantageModifierMin: 1.0,
  battleStrengthPowerDisadvantageModifierMax: 1.3,
  //   相討ち tiebreak
  battleSimOrganizationTiebreakEpsilon: 0,
  //   maxTicks 到達時の決着 (§8.2 補足。残存 org 合計の相対差 10% 超で優勢側勝利)
  battleMaxTicksDecisiveMarginRatio: 0.1,
  //   morale → rout
  moraleRouteThresholdFactor: 0.25,
  //   randomness
  battleRandomFactorMin: 0.85,
  battleRandomFactorMax: 1.15,
  //   commander
  commanderAssignedRegimentEffectMax: 0.15,
  commanderAdjacentRegimentEffectRatio: 0.4,
  captainGeneralBattleOrganizationDamageEffectMax: 0.1,
  captainGeneralRoutResistanceEffectMax: 0.1,
  //   outcome
  routSideRoutedShareThreshold: 0.4,
  //   warScoreDelta magnitude
  battleOrderlyVictoryScoreBase: 6,
  battleRoutVictoryScoreBase: 10,
  battleDecisivenessRoutedShareWeight: 0.4,
  battleDecisivenessSpeedWeight: 0.2,
  battleDecisivenessMin: 0.7,
  battleDecisivenessMax: 1.4,
  battlePreBattleEdgeWeight: 0.2,
  battlePreBattleModifierMin: 0.8,
  battlePreBattleModifierMax: 1.2,
  // v0.49 会戦強化 (§20。すべて初期実装用の仮値・観察後に調整。§20.1)
  //   戦術三すくみ: 有利側 org damage 倍率 / insight 差で「相手戦術を読む」確率の感度
  battleTacticAdvantageDamageMultiplier: 1.2,
  battleTacticInsightReadEffect: 0.5,
  //   無指揮官ペナルティと隣接支援
  battleUncommandedDamagePenalty: 0.15,
  battleUncommandedRoutPenalty: 0.1,
  battleUncommandedAdjacentSupportRatio: 0.5,
  //   slot-based flanking (控えめに開始)
  battleFlankingDamageMultiplier: 1.25,
  battleFlankingRoutPenalty: 0.1,
  //   追撃 (成功時に accumulatedOrgDamage を増幅、destroyed 抽選なら致死量まで)
  battlePursuitBaseChance: 0.15,
  battlePursuitDestroyedChance: 0.35,
  battlePursuitOrgDamageMultiplier: 1.5,
  //   突破 (routed の 2.5x roleMult があるので org 増幅は控えめ)
  battleBreakthroughBaseChance: 0.08,
  battleBreakthroughAbilityGapThreshold: 15,
  battleBreakthroughOrgDamageMultiplier: 1.3,
  //   destroyed の warScore 反映 (控えめ)
  battleDestroyedWarScoreWeight: 0.15,
  //   会戦単位 reputation (§16.3。総大将の decisive victory/defeat のみ。突出武功/大失態)
  battleCaptainGeneralFeatReputationScore: 12,
  battleCaptainGeneralFailureReputationScore: 14,
  //   交戦 contest (catcher 有利で base 0.5 から ±ability。回避成否はこの contest のみで決まる)
  battleEngagementCaptureBaseChance: 0.5,
  battleEngagementCaptureAbilityScale: 0.5,
  //   捕捉戦での戦列幅縮小
  battleCaughtFrontagePenalty: 1,
  battleMinimumEffectiveFrontage: 1,
  //   BattleLog retention (normal は 10 年保持。480 週 = 48 週 × 10 年)
  battleLogNormalRetentionWeeks: 480,
  // v0.18 Stage D: acquire_land Intent
  acquireLandIntentEnabled: true,
  acquireLandMinTreasury: 200,
  acquireLandMaxIntentsPerActor: 1,
  // v0.22 Goal/Aim system
  goalReviewIntervalWeeks: 48,
  goalMinimumDurationWeeks: 144,
  goalSwitchThreshold: 20,
  goalProgressOnAimSucceeded: 25,
  goalProgressOnAimFailed: -10,
  goalProgressOnAimAbandoned: -5,
  aimDefaultDeadlineWeeks: 240,
  projectCooldownWeeks: 4,
  aimParallelismCeiling: 4,
  aimCapacityBase: 1,
  aimCapacityProvincesPerSlot: 4,
  aimCapacityTreasuryPerSlot: 300,
  aimCapacityMembersPerSlot: 6,
  aimCapacityWealthPerSlot: 150,
  promotePolicyShiftCost: 0,
  patronizeArtistCost: 25,
  patronizeArtistPrestigeGain: 3,
  commissionChronicleCost: 40,
  commissionChroniclePrestigeGain: 5,
  policyInfluenceBonusBase: 10,
  policyInfluenceBonusShareFactor: 0.5,
  // v0.23 Person Goal/Aim/Task
  personGoalReviewIntervalWeeks: 48,
  personAimReviewIntervalWeeks: 4,
  maxActivityLogsPerPerson: 30,
  wealthAccumulationThreshold: 50,
  personAimDeadlineObtainOffice: 96,
  personAimDeadlineRetainOffice: 48,
  personAimDeadlineDefault: 96,
  taskActionCostLight: 0.5,
  taskActionCostNormal: 1.0,
  taskActionCostHeavy: 1.0,
  taskEffortRequiredLight: 2,
  taskEffortRequiredNormal: 3,
  taskEffortRequiredHeavy: 4,
  appointmentTaskModifierValue: 4,
  appointmentTaskModifierDurationWeeks: 16,
  // v0.23 Phase D: DiplomaticPlay Task-driven
  diplomaticPlayStructuralProgressFactor: 0.33,
  diplomaticPlayStructuralPowerWeight: 0.7,
  diplomaticPlayAdvantageWeight: 0.3,
  diplomaticPlayDelegateSkillImpactMax: 10,
  diplomaticPlayRandomnessMax: 5,
  diplomaticPlayTaskLeverageGainSmall: 8,
  diplomaticPlayTaskLeverageGainMedium: 15,
  diplomaticPlayTaskCommitmentGainMedium: 15,
  diplomaticPlayTaskProgressGainMedium: 10,
  diplomaticPlayTaskTensionGainMedium: 10,
  diplomaticPlayTaskTensionReductionSmall: 5,
  diplomaticPlayTaskOpponentPressureGainMedium: 12,
  diplomaticPlayTaskOpponentLeverageReductionSmall: 8,
  diplomaticPlayTaskUndermineFailTensionGain: 12,
  diplomaticPlayMaxActiveTasksPerSide: 2,
  // v0.43 §6.3
  maxDiplomaticSupportersPerSide: 2,
  // v0.43 §9.13 / §9.1
  // v0.47.2: 25→40。proximity 単独 (隣接=35) では届かなくし、安易な肩入れを抑える。
  //   残り差は近接×他要因 or delegate の説得ボーナスで埋める設計。
  diplomaticSupportJoinScoreThreshold: 40,
  supportJoinScoreWeightPoliticalOpinion: 0.0,
  supportJoinScoreWeightProximity: 0.35,
  supportJoinScoreWeightMilitarySparePower: 0.25,
  supportJoinScoreWeightTreasury: 0.1,
  supportJoinScoreWeightThreatContainment: 0.3,
  supportJoinScoreWeightLastWarPenalty: -0.2,
  supportPersuasionScale: 30,
  supportRebelBackingPenalty: 40,
  supportFellowRevoltBonus: 30,
  goalProgressOnPersonAimSucceeded: 15,
  goalProgressOnPersonAimFailed: -5,
  // v0.23 effectivePriority
  effectivePriorityOwnerDutyBonus: 20,
  effectivePriorityGoalAlignmentBonus: 10,
  effectivePriorityUrgencyMaxBonus: 15,
  effectivePriorityUrgencyMediumBonus: 10,
  effectivePriorityUrgencySmallBonus: 5,
  effectivePriorityDiplomaticTaskBonus: 10,
  effectivePriorityOfficeDutyBonus: 5,
  effectivePriorityOverloadThreshold: 3,
  effectivePriorityOverloadPenaltyPerTask: 3,
  weeklyActionCapacityBase: 2.0,
  weeklyActionCapacityAmbitionBonus: 0.5,
  weeklyActionCapacityAgeReduction: 0.5,
  weeklyActionCapacityAmbitionThreshold: 0.7,
  weeklyActionCapacityAgeThreshold: 60,
  // v0.12 Administrative capacity
  baseCountryInstitutionalCapacity: 20,
  rulerAdminCapacityFactor: 4,
  administratorCapacityFactor: 3,
  treasurerCapacityFactor: 2,
  // v0.12 Administrative load
  adminLoadPerProvince: 2,
  adminLoadPerCountryOffice: 1,
  // v0.12 Office effectiveness
  duplicateOfficeCoordinationPenalty: 0.5,
  officeHouseDiversityPenalty: 0.3,
  // v0.12 Office salary unpaid penalties
  officeUnpaidAffectionPenalty: -3,
  officeUnpaidRespectPenalty: -2,
  officeDignityUnpaidPenaltyReduction: 0.5,
  // v0.12 Share yearly update
  // v0.42 Polity Influence (polityShare* 流用 + 新規 domain は小さく)
  // 影響力個人中心化 Phase 1b: 受動 soft-power (資産/一律 base/威信) を直接 influence から全廃。
  // 構造項は「役職・任命権・土地」+ owner/leader ruler bonus に純化。成果項 (評判) が
  // デフレ分を埋める。prestige の間接効果 (功績あたり評判増 等) は将来課題 (§9)。
  polityInfluenceBase: 0,
  polityInfluenceProvinceFactor: 5,
  polityInfluenceMilitaryFactor: 0.1,
  polityInfluenceWealthFactor: 0,
  polityInfluencePrestigeFactor: 0,
  polityInfluenceOwnerHouseBonus: 30,
  polityInfluenceLeaderHouseBonus: 10,
  polityInfluenceOfficeFactor: 3,
  polityInfluenceMilitaryOfficeBonus: 2,
  polityInfluenceRegimentControlFactor: 2,
  polityInfluenceHoldingOfficeAppointmentFactor: 2,
  polityInfluencePolityOfficeAppointmentFactor: 2,
  polityInfluenceFactionFactor: 2,
  polityInfluenceReputationFactor: 0.5,
  movementProjectBaseCost: 40,
  movementReputationPerCost: 0.2,
  houseShareBase: 5,
  houseShareLeaderBonus: 20,
  houseShareOfficeBonus: 10,
  houseSharePrestigeFactor: 0.3,
  houseShareWealthFactor: 0.05,
  houseShareStatFactor: 1,
  houseShareReputationFactor: 0.5,
  // v0.12 Administrative efficiency
  minAdministrativeEfficiency: 0.3,
  maxAdministrativeEfficiency: 1.5,
  // v0.12 Rebellion ruler house suppression
  rulerHouseRebellionSuppression: 30,
  // v0.12 Appointment — concurrent office limits
  concurrentOfficePenalty: 8,
  houseShareAppointmentFactor: 0.08,
  ownerHouseAppointmentBonus: 4,
  polityInfluenceAppointmentFactor: 0.25,
  // influence% 項 (×0.25 で最大 ~25 点) を上回り「制度的権利として強く推す」水準。
  // それでも能力・prestige 差で覆りうる (保証はしない — §9.2)。
  polityOfficeAppointmentRightHouseBonus: 30,
  polityOfficeAppointmentRightPersonBonus: 35,
  polityOfficeAppointmentRightHouseAssociatedBonus: 18,
  rightBackedFactionBonus: 10,
  acquirePoliticalRightBaseCost: 40,
  acquirePoliticalRightRequiredInfluencePercent: 20,
  acquirePoliticalRightMaxInfluencePercent: 70,
  rightInheritanceOwnerSeizeThreshold: 70,
  rightInheritanceHouseRetainThreshold: 20,
  rightInheritanceFlipChance: 0.15,
  sameHousePolityOfficePenalty: 2,
  minAppointmentScore: 2,
  // v0.14 Ability generation / inheritance
  abilityAptitudeMean: 50,
  abilityAptitudeStddev: 15,
  abilityHeritability: 0.5,
  abilityAptitudeNoiseStddev: 8,
  abilityInitialNoiseStddev: 3,
  // v0.14 Age curves
  ageCurveLifelongMaxFraction: 0.7,
  ageCurveLifelongAgeConstant: 30,
  ageCurveYouthMaxFraction: 0.75,
  ageCurveYouthPeakAge: 30,
  ageCurveYouthDeclineConstant: 40,
  ageCurveMidLifeMaxFraction: 0.7,
  ageCurveMidLifePeakAge: 45,
  ageCurveMidLifeDeclineConstant: 60,
  // v0.14 Growth / Decline
  abilityGrowthChanceBase: 100,
  abilityGrowthGapFactor: 0.1,
  abilityDeclineChanceBase: 5,
  abilityActiveDeclineMultiplier: 0.3,
  // v0.14 Estate Settlement
  estateBaseRecoveryRate: 0.5,
  estateShareEffectStrength: 0.6,
  estateRecoveryRateMin: 0.2,
  estateRecoveryRateMax: 0.9,
  estateSettledNormalWealthRatio: 0.2,
  // v0.17 Faction lifecycle
  factionFormationThreshold: 5.0,
  factionFounderShareRank: 3,
  factionDisbandThreshold: 1.5,
  factionDisbandWealthFloor: 10,
  minimumFactionFounderWealth: 50,
  initialFactionMemberMax: 3,
  minimumInitialFactionMembers: 1,
  minimumFactionMembers: 2,
  // 派閥拡大 WI-1: cap = clamp(minCap + floor(officeSlots) + appointmentSeats + meritSeats, minCap, hardCap)。
  // hardCap 7 はスノーボール上限 (§3 anti-snowball)。meritSeats は role-score (0-120, 典型 30-60) が
  // floor を超えた分を divisor で席化する: floor((bestRole - 30) / 15)。才能 60 で +2 席。
  factionHardCap: 7,
  factionCapMeritFloor: 30,
  factionCapMeritDivisor: 15,
  factionViabilityMemberCountWeight: 0.5,
  factionViabilityOfficeHolderWeight: 1.0,
  factionViabilityWealthWeight: 0.5,
  // v0.17 Faction opportunity score
  officeOpportunityRoleWeights: {
    administrator: 1.0,
    treasurer: 1.0,
    military: 1.0,
    advisor: 0.75,
  },
  // v0.17 Faction recruitment
  baseFactionRecruitmentCost: 30,
  factionRecruitmentPrestigeCostFactor: 0.5,
  factionRecruitmentAbilityCostFactor: 1.0,
  factionRecruitmentSigningBonusRate: 0.3,
  recruitmentInitialAffection: 20,
  recruitmentInitialRespect: 10,
  // 派閥拡大 WI-0: 引力勾配。recruitmentTalentWeight は computeRecruitmentScore の
  // bestRoleScore 比重 (旧 0.3 固定 → 1.0。attitude 1.5/1.0 を才能が swamp されないよう引上げ)。
  // attractiveness は募集順序キー: 0-1 正規化 (patronPower/10, score/100, prestige/100) 後に重み付け。
  // merit を load-bearing にするため meritWeight を最大 (M1≈0 ゆえ power 単独では才能順にならない)。
  recruitmentTalentWeight: 1.0,
  recruitAttractivenessPowerWeight: 1.0,
  recruitAttractivenessMeritWeight: 2.0,
  recruitAttractivenessPrestigeWeight: 0.5,
  // WI-2: 家持ち無役が他家派閥に流れるまでの基礎待機年数。野望でこれを短縮:
  // 閾値 = baseIdleYears × (1 − ambitionReduction × ambition)。ambition 1.0 で半減 (4年)。
  factionCrossHouseBaseIdleYears: 8,
  factionCrossHouseAmbitionReduction: 0.5,
  // v0.17 Faction nomination / appointment
  factionNominationPowerThreshold: 0.3,
  factionOwnerHouseNominationBonus: 0.3,
  factionBailiffNominationWeight: 0.4,
  factionalAppointmentScoreScale: 100,
  // v0.17 Faction patronage
  factionDonationRate: 0.1,
  factionDonationPersonalReserve: 20,
  factionDonationAffectionGain: 2,
  factionDonationRespectGain: 1,
  factionDonationAffectionGainSmall: 1,
  factionStipendBase: 5,
  factionLeaderReserveWealth: 30,
  factionStipendAffectionGain: 1,
  factionStipendRespectGain: 1,
  factionStipendShortageAffectionPenalty: 2,
  factionStipendShortageRespectPenalty: 1,
  // v0.17.4 §13.9 Faction defection
  factionDefectionGraceYears: 1,
  factionDefectionProbPerYear: 0.07,
  factionDefectionAttitudeAffectionPenalty: 2,
  factionDefectionAttitudeRespectPenalty: 1,
  // 派閥拡大 WI-3: 崩壊機構。default の決定は単独 A/B (固定分母・成人人口比) で確定:
  //   succession のみ=23% / overreach のみ=17.9%(=OFF) / 両方=34.4%(超加法的 entrenchment)。
  // succession (崩壊1・主力・SR-5「先に作る」) は default ON。overreach (崩壊2) は単独無害だが
  // succession と組むと北極星に逆行する強 entrenchment を生むため default OFF とし、accumulation が
  // 無限化する nesting (Phase 2) 後に再評価する (flag は残す)。rival (崩壊3) は measure-first で未構築。
  factionCollapseSuccessionEnabled: true,
  factionCollapseOverreachEnabled: false,
  factionCollapseRivalEnabled: false,
  factionSuccessionScatterThreshold: 0.35,
  factionOverreachDefectionWeight: 1.0,
  factionAmbitionDefectionWeight: 1.0,
  factionNestingMinAgeYears: 6,
  factionNestingMaxBranches: 3,
  factionNestingMaxDepth: 2,
  factionNestingNpDiscount: 0.5,
  // v0.17 House surplus
  houseWealthReserveTarget: 100,
  houseSurplusDistributionMonthlyRate: 0.015,
  // v0.17 Office terms
  officeTermYears: {
    polity: { administrator: 4, treasurer: 4, military: 3, advisor: 3 },
    house: { administrator: 4, treasurer: 4, military: 3, advisor: 3 },
  },
  provinceOfficeTermYears: {
    bailiff: 3,
  },
  // v0.25 Bailiff system
  defaultContractedRemittanceRate: 0.4,
  defaultExpectedBailiffFeeRate: 0.1,
  minLocalExtractionRate: 0.1,
  maxLocalExtractionRate: 0.8,
  comfortableLocalExtractionRate: 0.35,
  minBailiffCollectionEfficiency: 0.3,
  bailiffStewardshipCollectionRange: 0.8,
  baseBailiffCollectionEfficiency: 0.55,
  placeholderBailiffCollectionEfficiency: 0.4,
  collectionFrictionFactor: 0.5,
  maxBailiffFeeRate: 0.25,
  bailiffTaskCompletedCollectionModifier: 0.05,
  bailiffTaskNoneCollectionModifier: 0.0,
  localExtractionWealthPenalty: 2,
  localExtractionUnrestGain: 3,
  bailiffBurdenAffectionPenaltyFactor: 2,
  bailiffProtectResidentsAffectionBonus: 0.2,
  bailiffTaskCompletedRespectGain: 0.2,
  bailiffAbilityRespectFactor: 0.006,
  bailiffRespectNeutralScore: 50,
  bailiffRespectMaxDelta: 1.0,
  // v0.17 Office max
  // v0.17.1: rank の方向を spec §7.2 に合わせて修正。
  // rank は数値が小さいほど上位 (1=帝国, 5=所領)。大国ほど官職枠が多い。
  polityOfficeMaxByRank: {
    1: { administrator: 3, treasurer: 3, military: 5, advisor: 5 },
    2: { administrator: 2, treasurer: 2, military: 3, advisor: 3 },
    3: { administrator: 1, treasurer: 1, military: 1, advisor: 0 },
    4: { administrator: 1, treasurer: 0, military: 0, advisor: 0 },
    5: { administrator: 1, treasurer: 0, military: 0, advisor: 0 },
  },
  // commonwealth: rank に依らず全 role を解放 (>=1)、席数は rank に応じてスケール。
  // hard cap (administrator/treasurer: 3, military/advisor: 5) 内。province factor は適用しない。
  polityOfficeMaxByRankCommonwealth: {
    1: { administrator: 3, treasurer: 3, military: 5, advisor: 5 },
    2: { administrator: 2, treasurer: 2, military: 3, advisor: 3 },
    3: { administrator: 2, treasurer: 2, military: 2, advisor: 2 },
    4: { administrator: 1, treasurer: 1, military: 2, advisor: 2 },
    5: { administrator: 1, treasurer: 1, military: 1, advisor: 1 },
  },
  polityOfficeMaxProvinceFactor: {
    small: 0.4,
    medium: 0.7,
    large: 1.0,
  },
  // v0.17 Office compatibility
  compatibleOfficePenalty: 2,
  incompatibleOfficePenalty: 10,
  compatibleShareReductionMax: 0.5,
  // v0.17 Office overlap / Share
  // v0.17 Houseless persons
  houselessPersonsPerHolding: 0.5,
  houselessMaleRatio: 0.75,
  targetHouselessPersons: 30,
  softMaxHouselessPersons: 50,
  hardMaxHouselessPersons: 80,
  houselessProtectionYears: 5,
  pruningPrestigeThreshold: 20,
  pruningWealthThreshold: 30,
  pruningMinDwellYears: 3,
  protectionPrestigeThreshold: 60,
  // v0.17 Occupation抽選 weights
  occupationWeights: {
    adventurer: 1.5,
    merchant: 1.5,
    scholar: 1.0,
    mercenary: 1.5,
    scribe: 1.0,
    priest: 1.0,
    physician: 0.8,
    jurist: 0.7,
    wanderer: 1.0,
  },
  // v0.26 Project system
  projectDefaultTargetProgress: 100,
  projectAdvanceProgressSuccess: 25,
  projectAdvanceProgressPartial: 10,
  projectAdvanceProgressFailure: 0,
  prepareProjectPartialTargetProgressPenalty: 10,
  diplomaticProjectPreparationGainSuccess: 10,
  diplomaticProjectLeverageGainSuccess: 5,
  diplomaticProjectCommitmentGainSuccess: 5,
  diplomaticProjectPreparationGainPartial: 5,
  diplomaticProjectLeverageGainPartial: 2,
  diplomaticProjectCommitmentGainPartial: 2,
  aimProgressGainLandOrContractProject: 50,
  aimProgressGainDevelopmentProject: 33,
  aimProgressGainPowerProject: 33,
  aimProgressGainCultureProject: 25,
  aimProgressCompletionTolerance: 1,
  projectDeadlineWeeksDevelopment: 48,
  projectDeadlineWeeksDiplomatic: 24,
  projectDeadlineWeeksHoldingDevelopment: 72,
  projectDeadlineWeeksRealEstateDevelopment: 52,
  projectStageMaxAttempts: 3,
  pressureResponseDefaultDeadlineWeeks: 48,
  supervisedProjectWorkloadWeight: 2,
  officeWorkloadWeight: 1,
  activeTaskWorkloadWeight: 1,
  taskOutcomeSuccessMargin: 20,
  // v0.27 HoldingImprovement / development selector
  holdingImprovementDevelopmentScorePerLevel: {
    manor_house: 2,
    town_hall: 2,
    irrigation_infrastructure: 6,
    market_infrastructure: 6,
    workshop_infrastructure: 6,
    storage_infrastructure: 7,
    transport_infrastructure: 7,
  },
  holdingImprovementMaxLevelByKind: {
    manor_house: { manor: 1, city: 0 },
    town_hall: { manor: 0, city: 1 },
    irrigation_infrastructure: { manor: 3, city: 0 },
    market_infrastructure: { manor: 0, city: 3 },
    workshop_infrastructure: { manor: 0, city: 3 },
    storage_infrastructure: { manor: 3, city: 3 },
    transport_infrastructure: { manor: 3, city: 3 },
  },
  developHoldingTargetDevelopmentThreshold: 40,
  developHoldingProjectBaseCostByImprovementKind: {
    manor_house: 20,
    town_hall: 20,
    irrigation_infrastructure: 35,
    market_infrastructure: 35,
    workshop_infrastructure: 32,
    storage_infrastructure: 25,
    transport_infrastructure: 30,
  },
  developHoldingProjectBaseProgressByImprovementKind: {
    manor_house: 60,
    town_hall: 60,
    irrigation_infrastructure: 110,
    market_infrastructure: 100,
    workshop_infrastructure: 100,
    storage_infrastructure: 80,
    transport_infrastructure: 100,
  },
  holdingImprovementClassCapacityPerLevel: {
    manor_house: {},
    town_hall: {},
    irrigation_infrastructure: {},
    market_infrastructure: {},
    workshop_infrastructure: {},
    storage_infrastructure: {},
    transport_infrastructure: {},
  },
  holdingImprovementTerrainCapacityMultiplier: {
    manor_house: {},
    town_hall: {},
    irrigation_infrastructure: {},
    market_infrastructure: {},
    workshop_infrastructure: {},
    storage_infrastructure: {},
    transport_infrastructure: {},
  },
  holdingImprovementFeatureCapacityMultiplier: {
    manor_house: {},
    town_hall: {},
    irrigation_infrastructure: {},
    market_infrastructure: {},
    workshop_infrastructure: {},
    storage_infrastructure: {},
    transport_infrastructure: {},
  },
  improvementLevelCostMultiplier: { 1: 1, 2: 2, 3: 4 },
  improvementLevelProgressMultiplier: { 1: 1, 2: 2, 3: 3 },
  projectBudgetMarginMultiplier: 2,
  projectCompletedRespectGain: 5,
  // v0.31 House Founding
  // v0.47 §7.1: 通常世界の self-made House founding (wealth/prestige/office/activityLog のみで
  //   House を興す経路) を廃止 (default 無効化)。House 創設は原則 Polity 獲得を伴う
  //   (分封 = request_land_grant・Phase 6) か、共和国例外 (republic_house_foundation・Phase 8) に限る。
  houseFoundingEnabled: false,
  houseFoundingMinWealth: 120,
  houseFoundingMinPrestige: 45,
  houseFoundingMinActivityLogs: 3,
  // v0.33+ 家制度バランス: 自力設立を絞り、固定的な人口が極小家へ断片化するのを抑える
  // (在野からの設立が ~3/年と多く、平均~2人の短命家を量産していた。baseBirthChance 増とセット)
  houseFoundingMonthlyChance: 0.02,
  houseFoundingMaxPerMonth: 1,
  houseFoundingWealthTransferRate: 0.5,
  // v0.31 Founder Family Generation
  founderFamilyGenerationEnabled: true,
  founderSpouseChanceYoung: 0.2,
  founderSpouseChanceMid: 0.7,
  founderSpouseChanceOld: 0.85,
  founderChildBaseChance: 0.6,
  founderMaxGeneratedChildren: 4,
  // v0.31 Influential House / Political Engagement
  influentialHousePolityInfluenceThreshold: 0.1,
  // v0.31 House Founding interval
  houseFoundingIntervalWeeks: 4,
  // v0.32 Clan Formation
  influentialHouseWealthThreshold: 200,
  influentialHouseLegacyPrestigeThreshold: 60,
  clanFormationIntervalWeeks: 48,
  clanFormationMinDirectCadetHouses: 3,
  clanFormationMinInfluentialHouses: 2,
  clanFormationMinTotalLivingMembers: 30,
  clanFormationMinTotalWealth: 500,
  clanFormationMinTotalLegacyPrestige: 150,
  // v0.40 LifeStage
  lifeStageTransitionAges: {
    adolescence: { minAge: 8, standardAge: 11, maxAge: 12 },
    young_adulthood: { minAge: 16, standardAge: 19, maxAge: 20 },
    mature_adulthood: { minAge: 32, standardAge: 36, maxAge: 40 },
    old_age: { minAge: 55, standardAge: 60, maxAge: 65 },
  },
  lifeStageTransitionChanceEarly: 0.2,
  lifeStageTransitionChanceStandard: 0.5,
  lifeStageParentInfluenceRateByStage: {
    childhood: 0.08,
    adolescence: 0.04,
  },
  lifeStageHouseLeaderInfluenceRateByStage: {
    childhood: 0.03,
    adolescence: 0.04,
  },
  lifeStageHouseAdultInfluenceRateByStage: {
    childhood: 0.01,
    adolescence: 0.02,
  },
  lifeStageParentFactionInfluenceRateByStage: {
    childhood: 0.01,
    adolescence: 0.03,
  },
  maxLifeStageInfluencersPerChild: 5,
  maxAttitudeTargetsInheritedPerInfluencer: 3,
  parentalAbilityGrowthChanceBonus: 2.0,
  oldAgeAppointmentScorePenalty: 5,
  oldAgeCommandScoreMultiplier: 0.8,
  // v0.44 PersonReputation
  personReputationMonthlyRetentionRate: 0.985,
  personReputationCleanupThreshold: 0.25,
  projectExperienceGainCompleted: 4.0,
  projectExperienceGainFailed: 2.0,
  projectExperienceGainCancelledMultiplier: 0.5,
  experienceImmediateGrowthChancePerPoint: 12,
  personReputationProjectSuccessBase: 8,
  personReputationProjectFailureBase: -6,
  personalTrainingTargetProgress: 3,
  personalTrainingDeadlineWeeks: 48,
  diplomaticPlayExperienceGainSuccess: 4.0,
  diplomaticPlayExperienceGainFailure: 2.0,
  diplomaticPlayExperienceGainStatusQuo: 2.0,
  diplomaticPlayExperienceGainCancelledMultiplier: 0.5,
  personReputationDiplomacySuccessBase: 10,
  personReputationDiplomacyStatusQuoBase: 4,
  personReputationDiplomacyStatusQuoFailureBase: -3,
  personReputationDiplomacyFailureBase: -8,
  warExperienceGainVictory: 5.0,
  warExperienceGainDefeat: 3.0,
  warExperienceGainWhitePeace: 2.0,
  warExperienceGainCancelledMultiplier: 0.5,
  personReputationWarVictoryBase: 12,
  personReputationWarDefeatBase: -8,
  warCommanderAwardFactor: 0.6,
  appointmentReputationModifierCap: 20,
  officeReputationScoreFactor: 0.25,
  warCommandReputationScoreFactor: 0.75,
  geniusAppearanceChance: 0.01,
  geniusAptitudeMin: 80,
  geniusAptitudeMax: 120,
  geniusTypeWeightCommander: 0.4,
  geniusTypeWeightChancellor: 0.4,
  geniusTypeWeightUniversal: 0.2,
  // v0.46 共和国整備
  republicInitialAdministratorSlots: 1,
  republicInitialTreasurerSlots: 1,
  republicInitialMilitarySlots: 1,
  republicInitialAdvisorSlots: 1,
  republicGrantInitialPersonalRights: true,
  republicLeaderTermYears: 4,
  republicDominantHolderThreshold: 60,
  republicCandidateMinAffection: -50,
  republicCandidateMaxWorkload: 3,
  republicCandidatePrestigeFactor: 0.3,
  republicCandidateWealthFactor: 0.02,
  republicCandidateWealthCap: 500,
  republicCandidateAttitudeFactor: 0.1,
  republicOfficeExperienceBonus: 10,
  republicHouselessFounderBonus: 8,
  republicLandlessHouseMemberBonus: 5,
  republicWorkloadPenaltyFactor: 4,
  republicAcquireRightBaseBonus: 15,
  republicLeaderIncumbencyBonus: 15,
  republicLeaderFatiguePerYear: 3,

  // === v0.47 称号・分封・領邦再編 (spec §16) ===
  // 初期値は緩め (各 Phase の forced 検証で発火させる)。最終 balance は全 Phase 完了後に保留 (CLAUDE.md §4)。
  // §16.1 rank promotion: 対象 newRank 2〜4 のみ埋める (rank1=全世界級は到達不能・rank5=floor)。
  //   v0.47 修正: holding 閾値を世界の土地階層に合わせる (ユーザー指定: rank5=1 holding 級 /
  //   rank4=1 province 級 (=2 holdings) / rank3=1 state 級 (≈8 holdings, 3-4 provinces) /
  //   rank2=複数 state 級 (≈16))。newRank になるための保有 holdings なので {2:16,3:8,4:2}。
  //   旧値 {2:12,3:8,4:4} は土地実態に対し過大 + 副次ゲート(treasury 等)も高く canPromote が
  //   全 seed で 0 だった。土地を主因に、treasury/prestige/admin は足切り水準に下げる。
  rankPromotionMinHoldingCountByRank: { 2: 16, 3: 8, 4: 2 },
  rankPromotionMinTreasuryByRank: { 2: 600, 3: 300, 4: 100 },
  rankPromotionMinPrestigeByRank: { 2: 40, 3: 30, 4: 20 },
  rankPromotionMinAdminPowerByRank: { 2: 40, 3: 30, 4: 20 },
  rankPromotionRetryCooldownWeeks: 520,
  rankPromotionAcceptThreshold: 50,
  rankPromotionApproverAttitudeWeight: 0.4,
  rankPromotionPrestigeWeight: 0.3,
  rankPromotionPowerWeight: 0.2,
  rankPromotionProjectProgressWeight: 0.2,
  // §16.2 land grant
  landGrantMinWealthForPetitioner: 300,
  landGrantMinReputationScore: 30,
  landGrantMinGrantorHoldingCount: 3,
  landGrantGrantorMinRemainingHoldingCount: 2,
  landGrantInitialTreasury: 100,
  landGrantInitialLegacyPrestige: 10,
  landGrantContractTaxRate: 0.5,
  // v0.47 修正: acceptScore = attitude*0.4 + reputation*0.3 + progress*0.2 (attitude/opinion は
  //   -100..100, donor 領主の petitioner への態度は大半が中立 default)。閾値 50 では実測 acceptScore
  //   0〜10 に対し原理的に発火不能だった。reputation を持つ忠実な役職者が中立 donor で叙封され、
  //   donor が反感を持つ相手は弾く水準 5 に下げる (発火 rate の最終 balance は別途)。
  landGrantAcceptThreshold: 5,
  landGrantApproverAttitudeWeight: 0.4,
  landGrantPetitionerReputationWeight: 0.3,
  landGrantProjectProgressWeight: 0.2,
  landGrantRetryCooldownWeeks: 312,
  landGrantCoreDonorMaxTopSharePercent: 60,
  landGrantHouseSupportThreshold: 5,
  // §16.3 cadet branch
  cadetBranchExcludeTopSuccessionRanks: 2,
  cadetBranchMinAmbition: 60,
  cadetBranchMinSupportPercent: 30,
  // v0.47 修正: support は getWeightedOpinionFromHouseShareholders の加重平均 opinion
  //   (-100..100, 中立=0)。家族 attitude は大半が中立 default のため閾値 50 では原理的に
  //   発火不能だった (実測 supportScore は 0〜11)。「家族が概ね非反対 (やや好意)」で分家を
  //   許す水準 5 に下げる (発火 rate の最終 balance は別途)。
  cadetBranchTitleTransferSupportThreshold: 5,
  cadetBranchRetryCooldownWeeks: 312,
  // §16.4 republic house foundation
  // 実測: established commonwealth の houseless 役職者の wealth は概ね 50〜550。400 では大半が
  //   gate を通らず発火 0 だったため、実態に合わせ 100 に下げる (共和国の僭主/寡頭創発の bootstrap)。
  republicHouseFoundingMinWealth: 100,
  republicHouseFoundingRetryCooldownWeeks: 312,
  // §16.5 consolidation
  houseDomainConsolidationMinOwnedPolityCount: 2,
  houseDomainConsolidationMinBenefit: 1,
  houseDomainConsolidationRetryCooldownWeeks: 312,
  // === v0.50 騎兵連隊 ===
  cavalryEntitlementByRank: { 1: 0, 2: 2, 3: 1, 4: 0, 5: 0 },
  cavalryEntitlementBasePower: 10,
  cavalryDestroyedCooldownWeeks: 24,
  // === v0.50 cavalry charge ===
  battleCavalryChargeBaseChance: 0.12,
  battleCavalryChargeCommanderThreshold: 70,
  battleCavalryChargeMaxPerBattlePerSide: 2,
  battleCavalryChargeFailureOrgDamage: 15,
  battleCavalryChargeFailureMoraleDamage: 10,
  battleCavalryChargeTargetOrgThreshold: 40,
  battleCavalryChargeTargetMoraleThreshold: 30,
  battleCavalryChargeTerrainMultiplierByKind: {
    open_field: 1.5,
    coastal_battle: 1.0,
    hill_battle: 0.7,
    forest_battle: 0.3,
    wetland_battle: 0.3,
    mountain_pass: 0.0,
    river_crossing: 0.3,
    siege: 0.0,
  },
  // === v0.50 cavalry screen ===
  battleCavalryScreenBaseChance: 0.4,
  battleCavalryScreenPursuitReduction: 0.5,
  battleCavalryScreenDestroyedReduction: 0.5,
  battleCavalryScreenMoraleShockReduction: 0.5,
  battleCavalryScreenTerrainMultiplierByKind: {
    open_field: 1.2,
    coastal_battle: 1.0,
    hill_battle: 0.9,
    forest_battle: 0.8,
    wetland_battle: 0.7,
    mountain_pass: 0.7,
    river_crossing: 0.8,
    siege: 0.5,
  },
  // === v0.50 cavalry reserve pursuit ===
  battleCavalryReservePursuitBaseChance: 0.2,
  battleCavalryReservePursuitDestroyedChance: 0.1,
  // === v0.50 morale rally / shock ===
  battleMoraleRallyPerRetreat: 1,
  battleMoraleRallyPerRout: 3,
  battleMoraleRallyPerDestroyed: 5,
  battleMoraleShockPerRetreat: 1,
  battleMoraleShockPerRout: 3,
  battleMoraleShockPerDestroyed: 5,
  battleMoraleRallyCapPerTick: 10,
  battleMoraleShockCapPerTick: 10,
  battleMoraleRallyFrontlineRatio: 0.3,
  battleMoraleRallySideRatio: 0.1,
  battleMoraleShiftLogThreshold: 5,
  // === v0.51 兵站・補給・消耗 ===
  warSupplyEnabled: true,
  warSupplyPressureMildThreshold: 30,
  warSupplyPressureModerateThreshold: 60,
  warSupplyPressureSevereThreshold: 85,
  warSupplyPressureCatastrophicThreshold: 110,
  warSupplyPressureDecayPerWeek: 5,
  warSupplyPressureGainFactor: 8.0,
  warSupplyLocalHostilityToPressureFactor: 0.05,
  warSupplyLocalHostilityDecayPerWeek: 2,
  warSupplyPlunderPressureDecayPerWeek: 4,
  warSupplyPressureToPlunderFactor: 0.08,
  warSupplyHostilityToPlunderFactor: 0.04,
  warSupplyPressureToHostilityFactor: 0.05,
  warSupplyPopUnrestToHostilityFactor: 0.03,
  warSupplyCommandDisciplineBase: 2.0,
  warSupplyAccessBase: 30,
  warSupplyAccessWealthFactor: 0.3,
  warSupplyAccessDevelopmentFactor: 2.0,
  warSupplyAccessControlFactor: 0.2,
  warSupplyAccessHostilityPenaltyFactor: 0.15,
  warSupplyAccessCrisisPenalty: 5,
  warSupplyForageBase: 0.5,
  warSupplyQuartermasterForageFactor: 0.15,
  warSupplyStrategistForageFactor: 0.05,
  warSupplyQuartermasterAccessFactor: 10,
  warSupplyStrategistAccessFactor: 3,
  warSupplyHostilityForagePenalty: 0.15,
  warSupplyOrganizationDamageByBand: {
    none: 0,
    mild: 0,
    moderate: 2,
    severe: 5,
    catastrophic: 10,
  },
  warSupplyMoraleDamageByBand: {
    none: 0,
    mild: 0,
    moderate: 2,
    severe: 5,
    catastrophic: 10,
  },
  warSupplyStrengthDamageByBand: {
    none: 0,
    mild: 0,
    moderate: 0.5,
    severe: 2,
    catastrophic: 3,
  },
  warSupplyCatastrophicCollapseChanceBase: 0.05,
  warSupplyCatastrophicCollapsePressureFactor: 0.002,
  wartimeRegimentRecoveryMultiplier: 0.5,
  warSupplyRecoveryMultiplierByBand: {
    none: 1.0,
    mild: 0.9,
    moderate: 0.75,
    severe: 0.45,
    catastrophic: 0.15,
  },
  warSupplyMaxStaffRecoveryMitigation: 0.35,
  warSupplyStaffAbsentScoreMultiplier: 0.75,
  warSupplyQuartermasterMitigationFactor: 0.3,
  warSupplyCaptainGeneralMitigationFactor: 0.1,
  warSupplyStrategistBonusFactor: 0.15,
  warSupplyCaptainGeneralForageFactor: 0.05,
  warSupplyCaptainGeneralDisciplineFactor: 3.0,
  warSupplyQuartermasterDisciplineFactor: 2.0,
  cavalrySupplyDemandMultiplier: 1.5,
  cavalryForageEfficiencyBonus: 0.05,
  cavalryPlunderEfficiencyBonus: 0.1,
  cavalrySupplyAttritionMultiplier: 1.25,
  warSupplyHarshRequisitionPressureThreshold: 40,
  warSupplyHarshRequisitionChanceFactor: 0.01,
  warSupplyPlunderPressureThreshold: 50,
  warSupplyPlunderChanceFactor: 0.015,
  warSupplyHarshRequisitionSupplyRelief: 8,
  warSupplyPlunderSupplyRelief: 15,
  warSupplyPlunderPressureRelief: 20,
  warSupplyHarshRequisitionHostilityGain: 8,
  warSupplyPlunderHostilityGain: 15,
  warSupplyHarshRequisitionPopWealthDamage: 5,
  warSupplyHarshRequisitionPopUnrestGain: 8,
  warSupplyPlunderPopWealthDamage: 12,
  warSupplyPlunderPopUnrestGain: 15,
  supplyForageConditionDrop: 2,
  supplyHarshRequisitionConditionDrop: 8,
  supplyPlunderConditionDrop: 20,
  supplySpilloverDamageMultiplier: 0.4,
  warSupplyHarshRequisitionSpilloverChance: 0.15,
  warSupplyPlunderSpilloverBaseChance: 0.2,
  warSupplyPlunderSpilloverPressureFactor: 0.003,
  warSupplyMaxSpilloverHoldings: 2,
  warSupplyAttritionEventStrengthThreshold: 5,
  // === v0.52 RealEstateAsset ===
  realEstateTerrainCapacityMultiplier: {
    farm: { plains: 1.3, hills: 0.75, wetlands: 0.7, forest: 0.5, mountains: 0.25 },
    mountain: { mountains: 1.3, hills: 1.0, plains: 0.4, forest: 0.5, wetlands: 0.3 },
    woodland: { forest: 1.3, hills: 1.0, plains: 0.5, mountains: 0.6, wetlands: 0.4 },
    workshop: { plains: 1.0, hills: 0.9, forest: 0.85, wetlands: 0.75, mountains: 0.7 },
  },
  realEstateFeatureCapacityMultiplier: {
    farm: { major_river: 1.1, lake: 1.05 },
    mountain: {},
    woodland: { major_river: 1.05 },
    workshop: { coastal: 1.05, major_river: 1.05 },
  },
  realEstateInfrastructureModifiers: {
    farm: [
      { infraKind: 'irrigation_infrastructure', modifierPerLevel: 0.15 },
      { infraKind: 'storage_infrastructure', modifierPerLevel: 0.1 },
    ],
    mountain: [
      { infraKind: 'storage_infrastructure', modifierPerLevel: 0.1 },
      { infraKind: 'transport_infrastructure', modifierPerLevel: 0.1 },
    ],
    woodland: [
      { infraKind: 'storage_infrastructure', modifierPerLevel: 0.1 },
      { infraKind: 'transport_infrastructure', modifierPerLevel: 0.1 },
    ],
    workshop: [
      { infraKind: 'workshop_infrastructure', modifierPerLevel: 0.15 },
      { infraKind: 'market_infrastructure', modifierPerLevel: 0.1 },
    ],
  },
  developRealEstateCapacityPressureThreshold: 0.8,
  minSlotOveruseModifier: 0.5,
  realEstateSlotCapacityBase: { manor: 3, city: 4 },
  developRealEstateProjectBaseCost: {
    farm: 30,
    mountain: 32,
    woodland: 30,
    workshop: 35,
  },
  developRealEstateProjectBaseProgress: {
    farm: 100,
    mountain: 100,
    woodland: 100,
    workshop: 110,
  },
  // v0.52 不動産売買
  realEstateSalePriceYears: 20,
  // === v0.54 資源経済 (spec §20) ===
  // 初期値は調整前提。Step 2 観察ゲート (§6.1) で rawRatio ≈ 1 / price ≈ basePrice に較正する。
  resourceMarketSupplyEpsilon: 0.01,
  marketPriceSwing: 0.75,
  resourceShortageFulfillmentThreshold: 0.5,
  marketResourcePriceHistoryLimit: 120,
  marketPriceSmoothingPreviousWeight: 0.75,
  marketPriceSmoothingCurrentWeight: 0.25,
  inputResourceChoiceBeta: 2,
  needResourceChoiceBeta: 2,
  laborTypeFulfillmentFloor: 0.7,
  // §12.4/§12.5 (抽象市場改訂): supply 0 でも potential の 25% は生産する。希少 input は market price で
  //   購入扱い (高価 input × 低 output → 低利益/赤字) となり、price シグナルと recipe 転換動機が残る。
  inputShortageOutputFloor: 0.25,
  recipeSwitchMinGainRate: 0.02,
  recipeSwitchIntervalWeeks: 12,
  needTierFloor: { essential: 0.85, ordinary: 0.1, luxury: 0.0 },
  needTierWealthHalf: { essential: 20, ordinary: 60, luxury: 150 },
  needShortageWealthPenaltyByTier: { essential: 0.3, ordinary: 0.12, luxury: 0.06 },
  needShortageUnrestPenaltyByTier: { essential: 0.4, ordinary: 0.1, luxury: 0.02 },
  realEstateRecipeSlotCount: 20,
  resourceEconomyControlModifierMin: 0.5,
  realEstateProductionFacilityModifiers: REAL_ESTATE_PRODUCTION_FACILITY_MODIFIERS,
  realEstateHoldingDueRate: 0.1,
  // === v0.53 押領・土地契約不履行・時効 (spec §19) ===
  // 初期値は保守的にし、押領・上納拒否が乱発しないようにする。観察後に調整する。
  realEstateSeizurePrescriptionYears: 20,
  landContractDefaultPrescriptionYears: 20,
  realEstateSeizureOpportunityThreshold: 40,
  landContractDefaultOpportunityThreshold: 40,
  seizureProjectCooldownWeeks: 96,
  landContractDefaultProjectCooldownWeeks: 96,
  enforceObligationProjectCooldownWeeks: 96,
  // 反乱占拠中に仮発行する nominal occupation contract の名目税率。実効上納は active default で
  // 0 に落ちる (LandRevenue) ため値自体は徴収に効かないが、UI/契約上「あくまで反乱中の仮の契約」と
  // 見えるよう中庸の 50% にする (極端に低い/高い名目は不自然)。非 root tax-0 不変条件 (>0) も満たす。
  revoltOccupationNominalTaxRate: 0.5,
  violenceOpportunityMilitaryAdvantageWeight: 0.1,
  violenceOpportunityAmbitionWeight: 20,
  violenceOpportunityCautionWeight: 20,
  violenceOpportunityFiscalPressureWeight: 0.1,
  violenceOpportunityTargetWeaknessWeight: 0.2,
  violenceOpportunityBadAttitudeWeight: 0.2,
  violenceOpportunityPrizeWeight: 0.04,
  seizeResistanceReference: 150,
  withholdMilitaryAdvantageFactor: 0.6,
  realEstateSeizureEnforceResistanceThreshold: 40,
  landContractDefaultEnforcePowerThreshold: 40,
  terminalObligationRetentionWeeks: 48,
}
