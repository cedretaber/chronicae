export type SimulationConfig = {
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
  // v0.6 Person Ability Effects
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
}

export const defaultConfig: SimulationConfig = {
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
}
