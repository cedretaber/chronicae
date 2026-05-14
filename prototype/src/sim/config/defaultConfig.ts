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
  // Country land development
  countryLandDevelopmentBaseCost: number
  countryLandDevelopmentGain: number
  // House land development
  houseDevelopmentEnabled: boolean
  houseDevelopmentYearlyChance: number
  houseLandDevelopmentBaseCost: number
  houseLandDevelopmentGain: number
  houseWealthReserve: number
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
}
