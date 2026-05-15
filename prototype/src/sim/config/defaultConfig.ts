export type SimulationConfig = {
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
  warCooldownMonths: number
  minAttackerWinChanceToDeclare: number
  // Disaster
  disasterEnabled: boolean
  famineBaseChancePerYear: number
  plagueBaseChancePerYear: number
  bountifulHarvestBaseChancePerYear: number
  disasterReliefCostPerProvince: number
  // Public Spending
  publicSpendingEnabled: boolean
  monumentBaseCost: number
  publicSpendingYearlyChance: number
  // Development decay/recovery
  developmentPositiveMonthlyDecay: number
  developmentNegativeMonthlyRecovery: number
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
  // Monument (v0.5 changes)
  monumentCountryControlGain: number
  monumentLegitimacyGain: number
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
  annexedCountryControl: number
  newRulerHouseControl: number
  // Country land development
  countryLandDevelopmentBaseCost: number
  countryLandDevelopmentGain: number
  // House land development
  houseDevelopmentEnabled: boolean
  houseDevelopmentYearlyChance: number
  houseLandDevelopmentBaseCost: number
  houseLandDevelopmentGain: number
  houseWealthReserve: number
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
  chancellorAmbitionMonumentScoreEffect: number
  chancellorCautionMonumentScoreEffect: number
  chancellorAmbitionLandDevelopmentScoreEffect: number
  chancellorCautionLandDevelopmentScoreEffect: number
  houseHeadAdminDevelopmentChanceEffect: number
  houseHeadCautionDevelopmentChanceEffect: number
  controlAbilityMinimumFloor: number
  // v0.7 Marriage
  marriageEnabled: boolean
  marriageMaleMinAge: number
  marriageMaleMaxAge: number
  marriageFemaleMinAge: number
  marriageFemaleMaxAge: number
  marriageYearlyChance: number
  sameCountryMarriageBonus: number
  differentCountryMarriagePenalty: number
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
  rulerHouseExtinctionLegitimacyLoss: number
  rulerHouseExtinctionStabilityLoss: number
  annexByRulerExtinctionCountryControl: number
  rulerExtinctionAnnexSharedBorderWeight: number
  rulerExtinctionAnnexPowerWeight: number
  rulerExtinctionAnnexLegitimacyWeight: number
  rulerExtinctionAnnexStabilityWeight: number
  // v0.7 Role
  allowFemaleRolesWhenNoMaleCandidate: boolean
  // v0.8 POP system
  popSystemEnabled: boolean
  minPopSizeByClass: Record<'peasants' | 'townsmen' | 'nobles', number>
  populationCapacityPerHabitability: number
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
  retainedWealthGainByClass: Record<'peasants' | 'townsmen' | 'nobles', number>
  overExtractionThreshold: number
  overExtractionWealthSafeThreshold: number
  overExtractionUnrestSafeThreshold: number
  overExtractionWealthPenalty: number
  overExtractionUnrestGain: number
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
  famineSizeDamage: number
  famineReliefDamageMultiplier: number
  plagueWealthPenalty: number
  plagueSizeDamage: number
}

export const defaultConfig: SimulationConfig = {
  debug: false,
  minLivingMembersPerHouse: 4,
  maxNewPersonsPerHousePerYear: 2,
  basePlotSuccess: 0.35,
  rebellionThreshold: 70,
  plotThreshold: 65,
  replacementThreshold: 15,
  rebellionSuccessMode: 'independence',
  maxRawEvents: 10000,
  maxChronicleEvents: 1000,
  warEnabled: true,
  warCostPerProvince: 20,
  maxProvincesPerWar: 3,
  maxWarsPerTick: 1,
  warCooldownMonths: 24,
  minAttackerWinChanceToDeclare: 0.45,
  disasterEnabled: true,
  famineBaseChancePerYear: 0.08,
  plagueBaseChancePerYear: 0.03,
  bountifulHarvestBaseChancePerYear: 0.05,
  disasterReliefCostPerProvince: 20,
  publicSpendingEnabled: true,
  monumentBaseCost: 120,
  publicSpendingYearlyChance: 0.35,
  developmentPositiveMonthlyDecay: 0.1,
  developmentNegativeMonthlyRecovery: 0.25,
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
  countryLandDevelopmentBaseCost: 70,
  countryLandDevelopmentGain: 8,
  houseDevelopmentEnabled: true,
  houseDevelopmentYearlyChance: 0.25,
  houseLandDevelopmentBaseCost: 40,
  houseLandDevelopmentGain: 6,
  houseWealthReserve: 50,
  // Control system
  controlMaxDistancePenalty: 10,
  controlMaxMinimum: 40,
  controlGrowthPerMonth: 2,
  controlDecayPerMonth: 1,
  disconnectedControlDecayPerMonth: 5,
  // Monument (v0.5 changes)
  monumentCountryControlGain: 10,
  monumentLegitimacyGain: 5,
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
  annexedCountryControl: 35,
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
  chancellorAmbitionMonumentScoreEffect: 20,
  chancellorCautionMonumentScoreEffect: 10,
  chancellorAmbitionLandDevelopmentScoreEffect: 10,
  chancellorCautionLandDevelopmentScoreEffect: 20,
  houseHeadAdminDevelopmentChanceEffect: 0.1,
  houseHeadCautionDevelopmentChanceEffect: 0.1,
  controlAbilityMinimumFloor: 35,
  // v0.7 Marriage
  marriageEnabled: true,
  marriageMaleMinAge: 16,
  marriageMaleMaxAge: 60,
  marriageFemaleMinAge: 15,
  marriageFemaleMaxAge: 45,
  marriageYearlyChance: 0.08,
  sameCountryMarriageBonus: 0.1,
  differentCountryMarriagePenalty: 0.05,
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
  rulerHouseExtinctionLegitimacyLoss: 15,
  rulerHouseExtinctionStabilityLoss: 10,
  annexByRulerExtinctionCountryControl: 30,
  rulerExtinctionAnnexSharedBorderWeight: 20,
  rulerExtinctionAnnexPowerWeight: 0.5,
  rulerExtinctionAnnexLegitimacyWeight: 0.2,
  rulerExtinctionAnnexStabilityWeight: 0.2,
  // v0.7 Role
  allowFemaleRolesWhenNoMaleCandidate: true,
  // v0.8 POP system
  popSystemEnabled: true,
  minPopSizeByClass: { peasants: 5, townsmen: 1, nobles: 1 },
  populationCapacityPerHabitability: 10,
  minProvinceCarryingCapacity: 50,
  productivityByClass: { peasants: 1.0, townsmen: 1.5, nobles: 0.6 },
  manpowerFactorByClass: { peasants: 0.03, townsmen: 0.01, nobles: 0.06 },
  baseMonthlyGrowthByClass: { peasants: 0.001, townsmen: 0.0008, nobles: 0.0004 },
  populationPressureThreshold: 0.9,
  populationPressureWealthPenalty: 0.2,
  populationPressureUnrestGain: 0.3,
  povertyWealthThreshold: 25,
  povertyUnrestGain: 0.02,
  prosperityWealthThreshold: 70,
  prosperityUnrestReduction: 0.01,
  retainedWealthGainByClass: { peasants: 0.3, townsmen: 0.45, nobles: 0.25 },
  overExtractionThreshold: 0.95,
  overExtractionWealthSafeThreshold: 55,
  overExtractionUnrestSafeThreshold: 45,
  overExtractionWealthPenalty: 1.0,
  overExtractionUnrestGain: 1.5,
  bountifulHarvestPeasantWealthGain: 10,
  bountifulHarvestPeasantUnrestReduction: 5,
  bountifulHarvestTownsmanWealthGain: 2,
  bountifulHarvestTownsmanUnrestReduction: 1,
  popDevelopmentEnabled: true,
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
  famineWealthPenalty: 15,
  famineSizeDamage: 2,
  famineReliefDamageMultiplier: 0.3,
  plagueWealthPenalty: 10,
  plagueSizeDamage: 3,
}
