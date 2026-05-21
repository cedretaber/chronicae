# 9. SimulationConfig デフォルト値

| 項目 | デフォルト | 説明 |
|------|-----------|------|
| debug | false | デバッグモード（イベント行への ID 付記・構造化デバッグログ・非致死的 IntegrityCheck） |
| basePlotSuccess | 0.35 | 陰謀基本成功率 |
| rebellionThreshold | 90 | 反乱発動閾値 |
| plotThreshold | 65 | 陰謀発動閾値 |
| rebellionSuccessMode | 'independence' | 反乱成功時の処理 |
| **AppointmentSystem（v0.12）** | | |
| concurrentOfficePenalty | 8 | 兼任 1 役職ごとのスコアペナルティ |
| minAppointmentScore | 2 | この閾値未満なら任命しない（空席維持） |
| **Polity Appointment（v0.15 §13.4）** | | |
| polityShareAppointmentFactor | 0.25 | Polity Share 割合のスコア寄与係数 |
| houseShareAppointmentFactor | 0.08 | House Share 割合のスコア寄与係数 |
| ownerHouseAppointmentBonus | 4 | 候補者の家が polity.ownerHouseId と一致する場合の加算 |
| sameHousePolityOfficePenalty | 2 | 同 House の Polity Office 保有数 1 つにつき減算（Polity Office 独占抑制） |
| samePrimaryPolityMarriageBonus | 0.08 | 同 primary Polity 間婚姻ボーナス（v0.15、旧 0.1 から微減） |
| maxRawEvents | 10000 | 全イベント保持上限 |
| maxChronicleEvents | 1000 | Chronicle イベント保持上限 |
| **Marriage & Birth** | | |
| marriageEnabled | true | 婚姻システム有効 |
| marriageMaleMinAge | 16 | 婚姻可能最低年齢（男性） |
| marriageMaleMaxAge | 60 | 婚姻可能最高年齢（男性） |
| marriageFemaleMinAge | 15 | 婚姻可能最低年齢（女性） |
| marriageFemaleMaxAge | 45 | 婚姻可能最高年齢（女性） |
| marriageYearlyChance | 0.08 | 年間婚姻確率（基本） |
| samePrimaryPolityMarriageBonus | 0.10 | 同国婚姻の確率ボーナス |
| differentPolityMarriagePenalty | -0.05 | 異国婚姻の確率ペナルティ |
| birthEnabled | true | 出生システム有効 |
| fatherMinChildAge | 15 | 父親になれる最低年齢 |
| fatherMaxChildAge | 60 | 父親になれる最高年齢 |
| motherMinChildAge | 15 | 母親になれる最低年齢 |
| motherMaxChildAge | 45 | 母親になれる最高年齢 |
| baseBirthChancePerMalePerYear | 0.06 | 男性 1 人あたりの年間出生確率（基本） |
| spouseMotherChance | 0.90 | 配偶者が母親になる確率 |
| maleBirthChance | 0.52 | 男子出生確率（通常） |
| maleBirthChanceWhenAdultMaleShortage | 0.65 | 男子出生確率（成人男性不足時） |
| targetLivingPersons | 180 | 出生倍率 1.0 となる生存人数の目標 |
| criticalLivingPersons | 90 | 危機的人口（出生倍率 3.0 が発動する閾値） |
| lowPopulationBirthMultiplier | 1.5 | 人口不足時の出生倍率 |
| criticalPopulationBirthMultiplier | 3.0 | 危機的人口時の出生倍率 |
| adultAge | 15 | 成人年齢（継承・婚姻・出生の判定基準） |
| **Succession & House Split** | | |
| successionCrisisScoreGap | 10 | 後継者スコア差がこの値を超えると継承危機が発生 |
| minorHeadCohesionPenaltyPerMonth | 0.5 | 未成年当主の 4 週ごとの cohesion 影響係数（Attitude 経由。名称は旧 Monthly を維持） |
| minorHeadLoyaltyPenaltyPerMonth | 0.3 | 未成年当主の 4 週ごとの loyaltyToPolity 影響係数（Attitude 経由。名称は旧 Monthly を維持） |
| houseSplitEnabled | true | 家の分裂有効 |
| minProvincesForHouseSplit | 3 | 分裂に必要な最小 Province 数 |
| houseSplitCohesionThreshold | 60 | 分裂条件の cohesion 上限（getHouseCohesion が未満でないと不発） |
| baseHouseSplitChance | 0.10 | 分裂基本確率 |
| houseSplitAmbitionFactor | 0.25 | 分裂確率への野心補正係数 |
| houseSplitPrestigeFactor | 0.002 | 分裂確率への legacyPrestige 補正係数 |
| houseSplitMartialFactor | 0.02 | 分裂確率への martial 補正係数 |
| houseSplitCohesionFactor | 0.003 | 分裂確率への cohesion 減少係数 |
| houseSplitControlMin | 30 | 分裂 Province 割合の下限（%） |
| houseSplitControlMax | 80 | 分裂 Province 割合の上限（%） |
| houseSplitWealthShare | 0.25 | 分裂時に新 House が受け取る wealth 割合 |
| houseSplitUnrestGain | 5 | 分裂 Province への POP unrest 増加量（PopMutation 経由） |
| extinctionUnrestGain | 8 | 家断絶後の継承 Province への POP unrest 増加量 |
| **War** | | |
| warEnabled | true | 戦争有効 |
| warCostPerProvince | 20 | Province あたり戦費 |
| maxProvincesPerWar | 3 | 1 戦争あたり最大征服数 |
| maxWarsPerTick | 1 | 1 tick あたり最大宣戦数 |
| warCooldownWeeks | 96 | 戦争クールダウン（週、2年相当） |
| minAttackerWinChanceToDeclare | 0.45 | 宣戦布告に必要な最低勝率 |
| warWealthDamage | 8 | 戦争時の全 POP wealth 低下量 |
| warUnrestDamage | 10 | 戦争時の全 POP unrest 上昇量 |
| warPeasantSizeDamage | 0.5 | 戦争時の peasants size 減少量 |
| warTownsmanSizeDamage | 0.3 | 戦争時の townsmen size 減少量 |
| **Disaster（v0.20.3 改修: Province 単位・割合ベース・圧力連動）** | | |
| disasterEnabled | true | 災害有効 |
| famineBaseChancePerYear | 0.08 | 飢饉基礎発生率/年/Province |
| plagueBaseChancePerYear | 0.03 | 疫病基礎発生率/年/Province |
| bountifulHarvestBaseChancePerYear | 0.05 | 豊作発生率/年/Province |
| faminePressureChanceBonus | 9.2 | 人口圧力超過分あたりの飢饉発生率加算（pressure 1.0 で 100%） |
| plaguePressureChanceBonus | 2.0 | 人口圧力超過分あたりの疫病発生率加算 |
| famineWealthPenalty | 8 | 飢饉による peasants wealth 低下量 |
| famineSizeDamageRate | 0.10 | 飢饉による peasants 人口減少率（10%） |
| plagueWealthPenalty | 10 | 疫病による全 POP wealth 低下量 |
| plagueSizeDamageRate | 0.05 | 疫病による全 POP 人口減少率（5%） |
| disasterReliefCostPerProvince | 20 | 救済費用/Province（v0.20.3 で一旦オミット、将来再導入） |
| famineReliefDamageMultiplier | 0.3 | 救済成功時の POP 効果軽減係数（v0.20.3 で一旦オミット） |
| bountifulHarvestPeasantWealthGain | 10 | 豊作による peasants wealth 上昇量 |
| bountifulHarvestPeasantUnrestReduction | 5 | 豊作による peasants unrest 低下量 |
| bountifulHarvestTownsmanWealthGain | 2 | 豊作による townsmen wealth 上昇量 |
| bountifulHarvestTownsmanUnrestReduction | 1 | 豊作による townsmen unrest 低下量 |
| **Public Spending** | | |
| publicSpendingEnabled | true | 公共支出有効 |
| publicSpendingYearlyChance | 0.35 | 公共支出年間発動確率 |
| **Development** | | |
| developmentPositiveMonthlyDecay | 0.1 | 正 development の月次減衰 |
| developmentNegativeMonthlyRecovery | 0.25 | 負 development の月次回復 |
| warConqueredProvinceDevastation | 8 | 征服 Province への荒廃 |
| warBorderProvinceDevastation | 3 | 境界 Province への荒廃（戦争勝利時） |
| failedWarBorderDevastation | 3 | 境界 Province への荒廃（戦争敗北時） |
| rebellionStartedDevastation | 2 | 反乱開始時の荒廃 |
| rebellionSucceededDevastation | 3 | 反乱成功時の荒廃 |
| rebellionFailedDevastation | 5 | 反乱失敗時の荒廃 |
| famineDevastation | 5 | 飢饉による荒廃 |
| famineReliefDevelopmentRecovery | 2 | 飢饉救済による荒廃軽減 |
| plagueDevastation | 8 | 疫病による荒廃 |
| bountifulHarvestDevelopmentGain | 3 | 豊作による development 上昇 |
| polityLandDevelopmentBaseCost | 70 | Polity土地開発コスト |
| polityLandDevelopmentGain | 8 | Polity土地開発による development 上昇 |
| houseDevelopmentEnabled | true | 家の土地開発有効 |
| houseDevelopmentYearlyChance | 0.25 | 家の土地開発年間基本確率 |
| houseLandDevelopmentBaseCost | 40 | 家の土地開発コスト |
| houseLandDevelopmentGain | 6 | 家の土地開発による development 上昇（基本値） |
| houseWealthReserve | 50 | 家が開発前に確保する wealth 予備 |
| **Control System** | | |
| controlMaxDistancePenalty | 10 | 距離 1 あたりの支配力上限ペナルティ |
| controlMaxMinimum | 40 | 支配力上限の最低値 |
| controlGrowthPerMonth | 2 | 支配力 4 週ごとの増加量（名称は旧 Monthly を維持） |
| controlDecayPerMonth | 1 | 支配力 4 週ごとの減少量（上限超過時。名称は旧 Monthly を維持） |
| disconnectedControlDecayPerMonth | 5 | 接続不能 Province の 4 週ごとの減衰量（名称は旧 Monthly を維持） |
| **Land Development** | | |
| landDevelopmentHouseControlGain | 5 | 土地開発による houseControl 上昇量 |
| landDevelopmentUnrestReduction | 1 | 土地開発によるスコア評価に用いる unrest 低下量 |
| **Person Ability Effects（v0.6）** | | |
| personAbilityEffectsEnabled | true | 人物能力効果の有効/無効 |
| chancellorAdminControlGrowthEffect | 0.25 | 宰相 admin による支配力成長補正係数 |
| chancellorAdminControlMaxBonusPerAdmin | 1 | 宰相 admin 1 点あたりの支配力上限ボーナス |
| houseHeadAdminControlGrowthEffect | 0.25 | 家長 admin による家支配力成長補正係数 |
| houseHeadAdminControlMaxBonusPerAdmin | 1 | 家長 admin 1 点あたりの家支配力上限ボーナス |
| controlAbilityMinimumFloor | 35 | 能力補正後の支配力上限最低値 |
| treasurerAdminTaxEfficiencyEffect | 0.15 | 財務官 admin による税収効率補正係数 |
| treasurerCautionTaxEfficiencyEffect | 0.10 | 財務官 caution による税収効率補正係数 |
| treasurerTaxEfficiencyMin | 0.8 | 税収効率の最小値 |
| treasurerTaxEfficiencyMax | 1.2 | 税収効率の最大値 |
| treasurerAdminDevelopmentCostEffect | 0.10 | 財務官 admin による開発コスト削減係数 |
| generalMartialWarPowerEffect | 0.15 | 将軍 martial による戦闘力補正係数 |
| generalAmbitionDeclareThresholdEffect | 0.10 | 将軍 ambition による宣戦閾値変動係数 |
| generalCautionDeclareThresholdEffect | 0.10 | 将軍 caution による宣戦閾値変動係数 |
| minWarDeclareThreshold | 0.30 | 宣戦閾値の下限 |
| maxWarDeclareThreshold | 0.75 | 宣戦閾値の上限 |
| chancellorAmbitionLandDevelopmentScoreEffect | 10 | 宰相 ambition による landDevelopmentScore 補正係数（低 ambition が正に働く） |
| chancellorCautionLandDevelopmentScoreEffect | 20 | 宰相 caution による landDevelopmentScore 補正係数 |
| houseHeadAdminDevelopmentChanceEffect | 0.10 | 家長 admin による開発確率補正係数 |
| houseHeadCautionDevelopmentChanceEffect | 0.10 | 家長 caution による開発確率補正係数 |
| **Lordship Transition** | | |
| lordshipAbsorptionTargetThreshold | 50 | 吸収対象となる houseControl の上限 |
| lordshipAbsorptionSourceMinimum | 60 | 吸収源となるための最低 houseControl |
| lordshipAbsorptionRatio | 2 | 吸収源 houseControl が対象の何倍必要か |
| lordshipAbsorptionMonthlyChance | 0.05 | 月次吸収発動確率 |
| lordshipAbsorptionNewControlMin | 50 | 吸収後 houseControl の下限 |
| lordshipAbsorptionNewControlMax | 70 | 吸収後 houseControl の上限 |
| lordshipAbsorptionNewControlPenalty | 10 | 吸収後 houseControl のペナルティ |
| **Annexation** | | |
| annexedPolityControl | 35 | 併合後の Province polityControl |
| newRulerHouseControl | 35 | 征服国 rulerHouse に割当られた Province の houseControl |
| **Military（v0.9）** | | |
| houseManpowerPowerFactor | 1.0 | House manpower を軍事力へ変換する係数 |
| houseMilitaryWealthReserve | 100 | 軍事力換算から除外する House wealth 予備 |
| houseWealthMilitaryFactor | 8.0 | log1p(availableWealth) の軍事力換算係数 |
| maxMercenaryPowerRatio | 0.5 | 傭兵力の上限（levyPower の 50%） |
| houseCommanderMartialEffect | 0.25 | martial による軍事力倍率補正係数 |
| minCommanderModifier | 0.75 | 指揮官補正の下限 |
| maxCommanderModifier | 1.25 | 指揮官補正の上限 |
| polityAdminMilitaryFactor | 0.3 | Polity adminPower の軍事力寄与係数 |
| minHouseMilitaryContribution | 0.25 | 非支配家門の最低軍事寄与率 |
| **HouseRebellion（v0.9）** | | |
| houseRebellionNobleUnrestFactor | 0.15 | nobles unrest の反乱傾向加算係数 |
| houseRebellionProvinceUnrestFactor | 0.05 | Province 全体 unrest の反乱傾向加算係数 |
| houseRebellionLowControlFactor | 0.10 | 低 polityControl による反乱傾向加算係数 |
| rebellionTreasuryPowerDivisor | 50 | 国庫を鎮圧戦力へ換算する除数 |
| **ProvinceRevolt（v0.9）** | | |
| provinceRevoltThreshold | 90 | Province 反乱発動の傾向閾値 |
| provinceRevoltChanceDivisor | 300 | 傾向値を月次確率へ変換する除数 |
| provinceRevoltMaxChance | 0.35 | 月次発生確率の上限 |
| provinceRevoltUnrestFactor | 1.2 | unrest の傾向加算係数（v0.20.3 で 0.8→1.2 に変更） |
| provinceRevoltLowHouseControlFactor | 0.2 | 低 houseControl の傾向加算係数 |
| provinceRevoltLowPolityControlFactor | 0.2 | 低 polityControl の傾向加算係数 |
| provinceRevoltStabilitySuppressionFactor | 0.2 | stability による傾向抑制係数 |
| peasantRevoltPovertyFactor | 0.5 | peasants 貧困補正係数 |
| peasantRevoltPressureFactor | 10 | peasants 人口圧補正係数 |
| townsmenRevoltProductionFactor | 0.02 | townsmen 生産量補正係数 |
| townsmenRevoltExtractionFactor | 5 | townsmen 搾取補正値 |
| nobleRevoltHouseDisloyaltyFactor | 0.2 | nobles 低忠誠度補正係数 |
| nobleRevoltLowLegitimacyFactor | 0.2 | nobles 低正統性補正係数 |
| popRevoltPowerFactorByClass | {peasants:0.02, townsmen:0.015, nobles:0.08} | class 別反乱戦力係数 |
| provinceRevoltHouseSuppressionFactor | 1.0 | House manpower の鎮圧力換算係数 |
| provinceRevoltPolitySuppressionFactor | 0.8 | Polity manpower の鎮圧力換算係数 |
| provinceRevoltTreasurySuppressionFactor | 2.0 | log1p(treasury) の鎮圧力換算係数 |
| provinceRevoltHouseWealthSuppressionFactor | 2.0 | log1p(houseWealth) の鎮圧力換算係数 |
| provinceRevoltConcessionPolityControlLoss | 10 | 譲歩時の polityControl 低下量 |
| provinceRevoltConcessionHouseControlLoss | 15 | 譲歩時の houseControl 低下量 |
| provinceRevoltConcessionUnrestReduction | 20 | 譲歩時の反乱 POP unrest 低下量 |
| provinceRevoltConcessionLegitimacyLoss | 3 | 譲歩時の legitimacy 低下量 |
| provinceRevoltConcessionHouseWealthLoss | 20 | 譲歩時の House wealth 低下量 |
| provinceRevoltLordshipChangeSuccessMargin | 0.15 | lordship_change に必要な最低 successMargin |
| provinceRevoltLordshipChangePolityControlLoss | 10 | 領主交代後の polityControl 低下量 |
| provinceRevoltNewHouseControl | 50 | 新領主の初期 houseControl |
| provinceRevoltIndependencePolityControlMax | 10 | 独立条件: polityControl の上限 |
| provinceRevoltIndependenceHouseControlMax | 10 | 独立条件: houseControl の上限 |
| provinceRevoltIndependenceSuccessMargin | 0.20 | 独立に必要な最低 successMargin |
| provinceRevoltNewPolityControl | 40 | 独立後の新国家 polityControl |
| provinceRevoltFailedUnrestReduction | 10 | 反乱失敗時の反乱 POP unrest 低下量 |
| provinceRevoltFailedDevastation | 4 | 反乱失敗時の Province 荒廃量 |
| provinceRevoltFailedWealthPenalty | 8 | 反乱失敗時の反乱 POP wealth 低下量 |
| provinceRevoltSuppressionCollateralUnrestGain | 2 | 鎮圧時の他 class への collateral unrest |
| revoltHouseInitialLegacyPrestige | 10 | 反乱新設 House の初期 legacyPrestige（v0.11） |
| revoltHouseInitialWealth | 30 | 反乱新設 House の初期 wealth |
| revoltPolityInitialTreasury | 50 | 独立新設 Polity の初期 treasury |
| revoltPolityInitialLegacyPrestige | 20 | 独立新設 Polity の初期 legacyPrestige（v0.11） |
| **行政キャパシティ（v0.12）** | | |
| basePolityInstitutionalCapacity | 20 | 国家の基礎的行政キャパシティ |
| rulerAdminCapacityFactor | 4 | Ruler の admin stat によるキャパシティ寄与係数 |
| administratorCapacityFactor | 3 | Administrator の admin stat によるキャパシティ寄与係数 |
| treasurerCapacityFactor | 2 | Treasurer の admin stat によるキャパシティ寄与係数 |
| adminLoadPerProvince | 2 | Province 1 つあたりの行政負荷 |
| adminLoadPerPolityOffice | 1 | 役職 1 つあたりの行政負荷 |
| minAdministrativeEfficiency | 0.3 | 行政効率の下限 |
| maxAdministrativeEfficiency | 1.5 | 行政効率の上限 |
| duplicateOfficeCoordinationPenalty | 0.5 | 同役職複数担当者の協調ペナルティ係数 |
| officeHouseDiversityPenalty | 0.3 | 役職担当者が同一家に集中した場合のペナルティ係数 |
| **OfficeCompensation（v0.12）** | | |
| officeUnpaidAffectionPenalty | -3 | 未払い時の affection ペナルティ |
| officeUnpaidRespectPenalty | -2 | 未払い時の respect ペナルティ |
| officeDignityUnpaidPenaltyReduction | 0.5 | 役職の尊厳によるペナルティ軽減係数 |
| **ShareUpdate（v0.12）** | | |
| shareYearlyRetentionRate | 0.85 | 既存 Share の年次保持率（EMA 計算用） |
| polityShareBase | 10 | Polity Share 基礎値 |
| polityShareProvinceFactor | 5 | Province 数の Share 寄与係数 |
| polityShareMilitaryFactor | 0.1 | 軍事力代理値の Share 寄与係数 |
| polityShareWealthFactor | 0.05 | House wealth の Share 寄与係数 |
| politySharePrestigeFactor | 0.2 | House legacyPrestige の Share 寄与係数 |
| polityShareOfficeFactor | 3 | Polity 役職保有数の Share 寄与係数 |
| polityShareOwnerHouseBonus | 30 | 支配家への Share ボーナス |
| houseShareBase | 5 | House Share 基礎値 |
| houseShareLeaderBonus | 20 | 家長への Share ボーナス |
| houseShareOfficeBonus | 10 | House 役職保有数の Share 寄与係数 |
| houseSharePrestigeFactor | 0.3 | Person legacyPrestige の Share 寄与係数 |
| houseShareWealthFactor | 0.05 | Person wealth の Share 寄与係数 |
| houseShareStatFactor | 1 | Person (admin + martial) の Share 寄与係数 |
| rulerHouseRebellionSuppression | 30 | 支配家への反乱抑圧ボーナス（Share 計算外） |
| **POP システム（v0.8）** | | |
| popSystemEnabled | true | POP システム有効 |
| minPopSizeByClass | {peasants:5, townsmen:1, nobles:1} | POP size の下限（class 別） |
| populationCapacityPerHabitability | 10 | habitability 1 あたりの人口キャパシティ |
| minProvinceCarryingCapacity | 50 | Province の最小 carrying capacity |
| productivityByClass | {peasants:1.0, townsmen:1.5, nobles:0.6} | POP 生産性係数（class 別） |
| manpowerFactorByClass | {peasants:0.03, townsmen:0.01, nobles:0.06} | 兵力換算係数（class 別） |
| baseMonthlyGrowthByClass | {peasants:0.0010, townsmen:0.0008, nobles:0.0004} | 月次基本成長率（class 別） |
| populationPressureThreshold | 0.90 | pressure がこれを超えると wealth/unrest に影響 |
| populationPressureWealthPenalty | 0.2 | pressure 超過時の wealth 低下係数 |
| populationPressureUnrestGain | 0.3 | pressure 超過時の unrest 上昇係数 |
| povertyWealthThreshold | 25 | 貧困閾値（これ未満で unrest 上昇） |
| povertyUnrestGain | 0.02 | 貧困による unrest 上昇係数 |
| prosperityWealthThreshold | 70 | 繁栄閾値（これ超過で unrest 低下） |
| prosperityUnrestReduction | 0.01 | 繁栄による unrest 低下係数 |
| unrestNaturalDecayRate | 0.005 | unrest 月次自然減衰率（v0.20.3 追加） |
| retainedWealthGainByClass | {peasants:0.30, townsmen:0.45, nobles:0.25} | 残留富 1 に対する wealth 増加量（class 別） |
| overExtractionThreshold | 0.95 | 過剰徴収判定の回収率閾値 |
| overExtractionWealthSafeThreshold | 55 | この wealth 以上ならペナルティ回避 |
| overExtractionUnrestSafeThreshold | 45 | この unrest 以下ならペナルティ回避 |
| overExtractionWealthPenalty | 1.0 | 過剰徴収による wealth 低下係数 |
| overExtractionUnrestGain | 1.5 | 過剰徴収による unrest 上昇係数 |
| **POP 自主開発（v0.8）** | | |
| popDevelopmentEnabled | true | POP 自主開発有効 |
| popDevelopmentMonthlyChance | 0.02 | 月次発動基本確率 |
| popDevelopmentMaxMonthlyChance | 0.08 | 月次発動確率の上限 |
| popDevelopmentWealthThreshold | 65 | 発動に必要な最低 avgWealth |
| popDevelopmentUnrestMax | 35 | 発動を阻害する unrest 上限 |
| popDevelopmentWealthChanceFactor | 0.001 | wealth による確率上昇係数 |
| popDevelopmentUnrestPenaltyFactor | 0.0005 | unrest による確率低下係数 |
| popDevelopmentCost | 3 | 発動時の全 POP wealth 低下量 |
| popDevelopmentGain | 0.25 | 発動時の development 上昇量 |
| popDevelopmentMaxDevelopment | 40 | POP 自主開発の development 上限 |
| **Unaffiliated Person（v0.17、v0.20.3 改修）** | | |
| unaffiliatedPersonsPerHolding | 0.5 | holdings 数あたりの在野人物 target 比率 |
| unaffiliatedMaleRatio | 0.75 | 在野人物生成時の男性比率 |
| targetUnaffiliatedPersons | 30 | 在野人物の最低 target（holdings ベース計算の下限として使用） |
| softMaxUnaffiliatedPersons | 50 | pruning 開始の閾値（実効値は target × 1.5） |
| hardMaxUnaffiliatedPersons | 80 | 強制削減の閾値（実効値は target × 2） |
| unaffiliatedProtectionYears | 5 | 新参者の削除保護期間 |
| pruningPrestigeThreshold | 20 | この prestige 以上は削除対象外 |
| pruningWealthThreshold | 30 | この wealth 以上は削除対象外 |
| **Attitude システム（v0.11）** | | |
| attitudeMonthlyRetentionRate | 0.995 | 態度の月次保持率（1-rate が減衰率） |
| initialPolityLegacyPrestigeMin | 20 | Polity 初期 legacyPrestige の下限 |
| initialPolityLegacyPrestigeMax | 60 | Polity 初期 legacyPrestige の上限 |
| initialHouseLegacyPrestigeMin | 20 | House 初期 legacyPrestige の下限 |
| initialHouseLegacyPrestigeMax | 80 | House 初期 legacyPrestige の上限 |
| initialPersonLegacyPrestigeMin | 0 | Person 初期 legacyPrestige の下限 |
| initialPersonLegacyPrestigeMax | 20 | Person 初期 legacyPrestige の上限 |
| ownerHouseExtinctionPrestigeLoss | 10 | owner house 断絶時の旧 Polity legacyPrestige 低下量 |
| rulerExtinctionAnnexPrestigeWeight | 0.3 | 支配家断絶・併合時の legacyPrestige 継承重み |
| abilityAptitudeMean | 50 | v0.14: aptitude ガウス生成の平均 |
| abilityAptitudeStddev | 15 | v0.14: aptitude ガウス生成の標準偏差 |
| abilityHeritability | 0.5 | v0.14: 両親平均 vs populationMean のブレンド比率 |
| abilityAptitudeNoiseStddev | 8 | v0.14: 遺伝時のガウスノイズ標準偏差 |
| abilityInitialNoiseStddev | 3 | v0.14: ability 初期値サンプル時のガウスノイズ標準偏差 |
| ageCurveLifelongMaxFraction | 0.70 | v0.14: 終生成長曲線の最大到達比率 |
| ageCurveLifelongAgeConstant | 30 | v0.14: 終生成長曲線の時定数 |
| ageCurveYouthMaxFraction | 0.75 | v0.14: 若年期ピーク曲線の最大到達比率 |
| ageCurveYouthPeakAge | 30 | v0.14: 若年期ピーク曲線のピーク年齢 |
| ageCurveYouthDeclineConstant | 40 | v0.14: 若年期ピーク曲線のピーク後減衰時定数 |
| ageCurveMidLifeMaxFraction | 0.70 | v0.14: 壮年期ピーク曲線の最大到達比率 |
| ageCurveMidLifePeakAge | 45 | v0.14: 壮年期ピーク曲線のピーク年齢 |
| ageCurveMidLifeDeclineConstant | 60 | v0.14: 壮年期ピーク曲線のピーク後減衰時定数 |
| abilityGrowthChanceBase | 1.0 | v0.14: 成長判定の基礎確率（%、effectiveCeil との比率で減衰） |
| abilityDeclineChanceBase | 0.10 | v0.14: 衰退判定の基礎確率（%） |
| abilityActiveDeclineMultiplier | 0.30 | v0.14: 経験あり人物の衰退速度倍率（鈍化） |
| estateBaseRecoveryRate | 0.5 | v0.14: 家回収率の基礎値（Share=0 のとき） |
| estateShareEffectStrength | 0.6 | v0.14: 家中 Share による家回収率引き下げ強度 |
| estateRecoveryRateMin | 0.2 | v0.14: 家回収率の下限 |
| estateRecoveryRateMax | 0.9 | v0.14: 家回収率の上限 |
| estateSettledNormalWealthRatio | 0.2 | v0.14: ESTATE_SETTLED の importance を normal に昇格させる wealth/house.wealth 閾値 |

---

