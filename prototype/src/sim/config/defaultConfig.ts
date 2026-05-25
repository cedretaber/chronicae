import type { OfficeRole } from '../types/office'
import type { PolityRank } from '../types/polity'
import type { UnaffiliatedOccupation } from '../types/person'
import type { HoldingKind } from '../types/landContract'
import type { PopOccupation, PopClass } from '../types/popGroup'
import type { HoldingImprovementKind } from '../types/holdingImprovement'

export type SimulationConfig = {
  uiLocale: 'en' | 'ja'
  nameCultureId: string
  debug: boolean
  minLivingMembersPerHouse: number
  maxNewPersonsPerHousePerYear: number
  basePlotSuccess: number
  rebellionThreshold: number
  plotThreshold: number
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
  chancellorAdminControlGrowthEffect: number
  chancellorAdminControlMaxBonusPerAdmin: number
  houseHeadAdminControlGrowthEffect: number
  houseHeadAdminControlMaxBonusPerAdmin: number
  treasurerAdminTaxEfficiencyEffect: number
  treasurerCautionTaxEfficiencyEffect: number
  treasurerTaxEfficiencyMin: number
  treasurerTaxEfficiencyMax: number
  treasurerAdminDevelopmentCostEffect: number
  generalMartialWarPowerEffect: number
  generalAmbitionDeclareThresholdEffect: number
  generalCautionDeclareThresholdEffect: number
  minWarDeclareThreshold: number
  maxWarDeclareThreshold: number
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
  targetLivingPersons: number
  criticalLivingPersons: number
  lowPopulationBirthMultiplier: number
  criticalPopulationBirthMultiplier: number
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
  // v0.8 POP system
  popSystemEnabled: boolean
  minPopSizeByClass: Record<'peasants' | 'townsmen' | 'nobles', number>
  minProvinceCarryingCapacity: number
  productivityByClass: Record<'peasants' | 'townsmen' | 'nobles', number>
  manpowerFactorByClass: Record<'peasants' | 'townsmen' | 'nobles', number>
  baseMonthlyGrowthByClass: Record<'peasants' | 'townsmen' | 'nobles', number>
  populationPressureThreshold: number
  populationPressureWealthPenalty: number
  populationPressureUnrestGain: number
  povertyWealthThreshold: number
  povertyUnrestGain: number
  prosperityWealthThreshold: number
  prosperityUnrestReduction: number
  unrestNaturalDecayRate: number
  retainedWealthGainByClass: Record<'peasants' | 'townsmen' | 'nobles', number>
  overExtractionThreshold: number
  overExtractionWealthSafeThreshold: number
  overExtractionUnrestSafeThreshold: number
  overExtractionWealthPenalty: number
  overExtractionUnrestGain: number
  // v0.24 Occupation capacity
  occupationCapacityBaseByHoldingKind: Record<
    HoldingKind,
    Record<Exclude<PopOccupation, 'none'>, number>
  >
  // v0.24 Occupation production/manpower multipliers
  occupationProductivityMultiplier: Record<PopOccupation, number>
  occupationManpowerMultiplier: Record<PopOccupation, number>
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
  popDevelopmentEnabled: boolean
  popDevelopmentMonthlyChance: number
  popDevelopmentMaxMonthlyChance: number
  popDevelopmentWealthThreshold: number
  popDevelopmentUnrestMax: number
  popDevelopmentWealthChanceFactor: number
  popDevelopmentUnrestPenaltyFactor: number
  popDevelopmentCost: number
  popDevelopmentGain: number
  popDevelopmentMaxDevelopment: number
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
  // ProvinceRevolt class-specific tendency
  peasantRevoltPovertyFactor: number
  peasantRevoltPressureFactor: number
  townsmenRevoltProductionFactor: number
  townsmenRevoltExtractionFactor: number
  nobleRevoltHouseDisloyaltyFactor: number
  nobleRevoltLowLegitimacyFactor: number
  // ProvinceRevolt power
  popRevoltPowerFactorByClass: Record<'peasants' | 'townsmen' | 'nobles', number>
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
  taxRevisionTaxChangeAmount: number
  taxRevisionMinRate: number
  taxRevisionMaxRate: number
  taxRevisionPressureFactor: number
  taxRevisionResistFactor: number
  taxRevisionProvinceValueFactor: number
  taxRevisionRateImbalanceFactor: number
  taxRevisionInitialProgressOnAdvantage: number
  taxRevisionInitialTensionOnPressure: number
  taxRevisionGracePeriodYears: number
  // v0.18 Stage D: 汎用 conflict (§13.2)
  conflictResolutionEnabled: boolean
  maxConflictsResolvedPerTick: number
  conflictLoserTreasuryDamageFactor: number
  conflictProvinceDevastation: number
  conflictPopWealthDamage: number
  conflictPopUnrestGain: number
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
  taskTrainingExperienceGain: number
  trainingExperienceDecayRate: number
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
  expandPolityShareCost: number
  expandPolityShareRawPowerGain: number
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
  // v0.12 Share yearly update
  shareYearlyRetentionRate: number
  polityShareBase: number
  polityShareProvinceFactor: number
  polityShareMilitaryFactor: number
  polityShareWealthFactor: number
  politySharePrestigeFactor: number
  polityShareOfficeFactor: number
  polityShareOwnerHouseBonus: number
  houseShareBase: number
  houseShareLeaderBonus: number
  houseShareOfficeBonus: number
  houseSharePrestigeFactor: number
  houseShareWealthFactor: number
  houseShareStatFactor: number
  // v0.12 Administrative efficiency
  minAdministrativeEfficiency: number
  maxAdministrativeEfficiency: number
  // v0.12 Rebellion ruler house suppression
  rulerHouseRebellionSuppression: number
  // v0.12 Appointment — concurrent office limits
  concurrentOfficePenalty: number
  minAppointmentScore: number
  // v0.15 §13.4 Polity appointment scoring
  polityShareAppointmentFactor: number
  houseShareAppointmentFactor: number
  ownerHouseAppointmentBonus: number
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
  // v0.17 Office max (Polity rank x province count)
  polityOfficeMaxByRank: Record<PolityRank, Record<Exclude<OfficeRole, 'leader'>, number>>
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
  polityShareOfficeOverlapBonusMax: number
  // v0.17 Unaffiliated persons
  unaffiliatedPersonsPerHolding: number
  unaffiliatedMaleRatio: number
  targetUnaffiliatedPersons: number
  softMaxUnaffiliatedPersons: number
  hardMaxUnaffiliatedPersons: number
  unaffiliatedProtectionYears: number
  pruningPrestigeThreshold: number
  pruningWealthThreshold: number
  pruningMinDwellYears: number
  protectionPrestigeThreshold: number
  // v0.17 Occupation抽選 weights
  occupationWeights: Record<UnaffiliatedOccupation, number>
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
  supervisedProjectWorkloadWeight: number
  officeWorkloadWeight: number
  activeTaskWorkloadWeight: number
  taskOutcomeSuccessMargin: number
  // v0.27 HoldingImprovement / development selector
  holdingImprovementDevelopmentScorePerLevel: Record<HoldingImprovementKind, number>
  holdingImprovementMaxLevelByHoldingKind: Record<
    HoldingKind,
    Record<HoldingImprovementKind, number>
  >
  developHoldingTargetDevelopmentThreshold: number
  developHoldingProjectBaseCostByImprovementKind: Record<HoldingImprovementKind, number>
  developHoldingProjectBaseProgressByImprovementKind: Record<HoldingImprovementKind, number>
  improvementLevelCostMultiplier: Record<number, number>
  improvementLevelProgressMultiplier: Record<number, number>
  projectBudgetMarginMultiplier: number
  projectCompletedRespectGain: number
}

export const defaultConfig: SimulationConfig = {
  uiLocale: 'en',
  nameCultureId: 'western',
  debug: false,
  minLivingMembersPerHouse: 4,
  maxNewPersonsPerHousePerYear: 2,
  basePlotSuccess: 0.35,
  rebellionThreshold: 90,
  plotThreshold: 65,
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
  chancellorAdminControlGrowthEffect: 0.25,
  chancellorAdminControlMaxBonusPerAdmin: 1,
  houseHeadAdminControlGrowthEffect: 0.25,
  houseHeadAdminControlMaxBonusPerAdmin: 1,
  treasurerAdminTaxEfficiencyEffect: 0.15,
  treasurerCautionTaxEfficiencyEffect: 0.1,
  treasurerTaxEfficiencyMin: 0.8,
  treasurerTaxEfficiencyMax: 1.2,
  treasurerAdminDevelopmentCostEffect: 0.1,
  generalMartialWarPowerEffect: 0.15,
  generalAmbitionDeclareThresholdEffect: 0.1,
  generalCautionDeclareThresholdEffect: 0.1,
  minWarDeclareThreshold: 0.3,
  maxWarDeclareThreshold: 0.75,
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
  baseBirthChancePerMalePerYear: 0.06,
  spouseMotherChance: 0.9,
  maleBirthChance: 0.52,
  maleBirthChanceWhenAdultMaleShortage: 0.65,
  targetLivingPersons: 180,
  criticalLivingPersons: 90,
  lowPopulationBirthMultiplier: 1.5,
  criticalPopulationBirthMultiplier: 3.0,
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
  houseSplitEnabled: true,
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
  // v0.7 Role
  allowFemaleRolesWhenNoMaleCandidate: true,
  // v0.8 POP system
  popSystemEnabled: true,
  minPopSizeByClass: { peasants: 5, townsmen: 1, nobles: 1 },
  minProvinceCarryingCapacity: 50,
  productivityByClass: { peasants: 1.0, townsmen: 1.5, nobles: 0.6 },
  manpowerFactorByClass: { peasants: 0.03, townsmen: 0.01, nobles: 0.06 },
  baseMonthlyGrowthByClass: { peasants: 0.008, townsmen: 0.002, nobles: 0.001 },
  populationPressureThreshold: 0.9,
  populationPressureWealthPenalty: 0.2,
  populationPressureUnrestGain: 0.3,
  povertyWealthThreshold: 25,
  povertyUnrestGain: 0.02,
  prosperityWealthThreshold: 70,
  prosperityUnrestReduction: 0.01,
  unrestNaturalDecayRate: 0.005,
  retainedWealthGainByClass: { peasants: 0.3, townsmen: 0.45, nobles: 0.25 },
  overExtractionThreshold: 0.95,
  overExtractionWealthSafeThreshold: 55,
  overExtractionUnrestSafeThreshold: 45,
  overExtractionWealthPenalty: 1.0,
  overExtractionUnrestGain: 1.5,
  // v0.24 Occupation capacity
  occupationCapacityBaseByHoldingKind: {
    manor: { agriculture: 80, urban_labor: 8, elite_service: 3 },
    city: { agriculture: 15, urban_labor: 70, elite_service: 5 },
  },
  // v0.24 Occupation production/manpower multipliers
  occupationProductivityMultiplier: {
    agriculture: 1.0,
    urban_labor: 1.0,
    elite_service: 1.0,
    none: 0.1,
  },
  occupationManpowerMultiplier: {
    agriculture: 1.0,
    urban_labor: 0.8,
    elite_service: 1.2,
    none: 0.5,
  },
  // v0.24 Unemployed POP penalties
  unemployedWealthDecayByClass: { peasants: 0.2, townsmen: 0.3, nobles: 0.15 },
  unemployedUnrestGainByClass: { peasants: 0.2, townsmen: 0.35, nobles: 0.45 },
  unemployedGrowthModifierByClass: { peasants: 0.6, townsmen: 0.5, nobles: 0.7 },
  // v0.24 Initial POP generation
  initialPopFillRatioMin: 70,
  initialPopFillRatioMax: 95,
  // v0.24 POP epsilon
  popSizeEpsilon: 0.01,
  bountifulHarvestPeasantWealthGain: 10,
  bountifulHarvestPeasantUnrestReduction: 5,
  bountifulHarvestTownsmanWealthGain: 2,
  bountifulHarvestTownsmanUnrestReduction: 1,
  popDevelopmentEnabled: false,
  popDevelopmentMonthlyChance: 0.02,
  popDevelopmentMaxMonthlyChance: 0.08,
  popDevelopmentWealthThreshold: 65,
  popDevelopmentUnrestMax: 35,
  popDevelopmentWealthChanceFactor: 0.001,
  popDevelopmentUnrestPenaltyFactor: 0.0005,
  popDevelopmentCost: 3,
  popDevelopmentGain: 0.25,
  popDevelopmentMaxDevelopment: 40,
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
  // ProvinceRevolt class-specific tendency
  peasantRevoltPovertyFactor: 0.5,
  peasantRevoltPressureFactor: 10,
  townsmenRevoltProductionFactor: 0.02,
  townsmenRevoltExtractionFactor: 5,
  nobleRevoltHouseDisloyaltyFactor: 0.2,
  nobleRevoltLowLegitimacyFactor: 0.2,
  // ProvinceRevolt power
  popRevoltPowerFactorByClass: { peasants: 0.02, townsmen: 0.015, nobles: 0.08 },
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
  taxRevisionTaxChangeAmount: 0.05,
  taxRevisionMinRate: 0.05,
  taxRevisionMaxRate: 0.8,
  taxRevisionPressureFactor: 0.08,
  taxRevisionResistFactor: 0.1,
  taxRevisionProvinceValueFactor: 0.15,
  taxRevisionRateImbalanceFactor: 50,
  taxRevisionInitialProgressOnAdvantage: 10,
  taxRevisionInitialTensionOnPressure: 10,
  taxRevisionGracePeriodYears: 5,
  // v0.18 Stage D: 汎用 conflict (§13.2)
  conflictResolutionEnabled: true,
  maxConflictsResolvedPerTick: 5,
  conflictLoserTreasuryDamageFactor: 0.4,
  conflictProvinceDevastation: 4,
  conflictPopWealthDamage: 4,
  conflictPopUnrestGain: 12,
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
  expandPolityShareCost: 40,
  expandPolityShareRawPowerGain: 10,
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
  taskTrainingExperienceGain: 2.0,
  trainingExperienceDecayRate: 0.5,
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
  shareYearlyRetentionRate: 0.85,
  polityShareBase: 10,
  polityShareProvinceFactor: 5,
  polityShareMilitaryFactor: 0.1,
  polityShareWealthFactor: 0.05,
  politySharePrestigeFactor: 0.2,
  polityShareOfficeFactor: 3,
  polityShareOwnerHouseBonus: 30,
  houseShareBase: 5,
  houseShareLeaderBonus: 20,
  houseShareOfficeBonus: 10,
  houseSharePrestigeFactor: 0.3,
  houseShareWealthFactor: 0.05,
  houseShareStatFactor: 1,
  // v0.12 Administrative efficiency
  minAdministrativeEfficiency: 0.3,
  maxAdministrativeEfficiency: 1.5,
  // v0.12 Rebellion ruler house suppression
  rulerHouseRebellionSuppression: 30,
  // v0.12 Appointment — concurrent office limits
  concurrentOfficePenalty: 8,
  polityShareAppointmentFactor: 0.25,
  houseShareAppointmentFactor: 0.08,
  ownerHouseAppointmentBonus: 4,
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
  factionDefectionGraceYears: 8,
  factionDefectionProbPerYear: 0.07,
  factionDefectionAttitudeAffectionPenalty: 2,
  factionDefectionAttitudeRespectPenalty: 1,
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
  // v0.17 Office max
  // v0.17.1: rank の方向を spec §7.2 に合わせて修正。
  // rank は数値が小さいほど上位 (1=帝国, 5=反乱領)。大国ほど官職枠が多い。
  polityOfficeMaxByRank: {
    1: { administrator: 3, treasurer: 3, military: 5, advisor: 5 },
    2: { administrator: 2, treasurer: 2, military: 3, advisor: 3 },
    3: { administrator: 1, treasurer: 1, military: 1, advisor: 0 },
    4: { administrator: 1, treasurer: 0, military: 0, advisor: 0 },
    5: { administrator: 0, treasurer: 0, military: 0, advisor: 0 },
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
  polityShareOfficeOverlapBonusMax: 0.5,
  // v0.17 Unaffiliated persons
  unaffiliatedPersonsPerHolding: 0.5,
  unaffiliatedMaleRatio: 0.75,
  targetUnaffiliatedPersons: 30,
  softMaxUnaffiliatedPersons: 50,
  hardMaxUnaffiliatedPersons: 80,
  unaffiliatedProtectionYears: 5,
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
  supervisedProjectWorkloadWeight: 2,
  officeWorkloadWeight: 1,
  activeTaskWorkloadWeight: 1,
  taskOutcomeSuccessMargin: 20,
  // v0.27 HoldingImprovement / development selector
  holdingImprovementDevelopmentScorePerLevel: {
    agricultural_infrastructure: 8,
    urban_infrastructure: 8,
    storage_infrastructure: 5,
    transport_infrastructure: 5,
  },
  holdingImprovementMaxLevelByHoldingKind: {
    manor: {
      agricultural_infrastructure: 3,
      urban_infrastructure: 1,
      storage_infrastructure: 3,
      transport_infrastructure: 3,
    },
    city: {
      agricultural_infrastructure: 1,
      urban_infrastructure: 3,
      storage_infrastructure: 3,
      transport_infrastructure: 3,
    },
  },
  developHoldingTargetDevelopmentThreshold: 40,
  developHoldingProjectBaseCostByImprovementKind: {
    agricultural_infrastructure: 30,
    urban_infrastructure: 35,
    storage_infrastructure: 25,
    transport_infrastructure: 30,
  },
  developHoldingProjectBaseProgressByImprovementKind: {
    agricultural_infrastructure: 100,
    urban_infrastructure: 100,
    storage_infrastructure: 80,
    transport_infrastructure: 100,
  },
  improvementLevelCostMultiplier: { 1: 1, 2: 2, 3: 4 },
  improvementLevelProgressMultiplier: { 1: 1, 2: 2, 3: 3 },
  projectBudgetMarginMultiplier: 2,
  projectCompletedRespectGain: 5,
}
