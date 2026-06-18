# 9. SimulationConfig デフォルト値

| 項目 | デフォルト | 説明 |
|------|-----------|------|
| debug | false | デバッグモード（イベント行への ID 付記・構造化デバッグログ・非致死的 IntegrityCheck） |
| rebellionSuccessMode | 'independence' | 反乱成功時の処理 |
| **陰謀システム（v0.51 陰謀リファイン §6.26）** | | |
| conspiracyUndermineInfluenceAmount | 30 | 影響力毀損 modifier の絶対値（delta = -この値）|
| conspiracyUndermineInfluenceDurationWeeks | 156 | 影響力毀損の有効期間（週・3年）|
| conspiracyAimPriorityFactor | 0.5 | 陰謀 aim 候補スコアの重み（多発抑制）|
| conspiracyDriveThreshold | 75 | covert goal/aim の発動閾値（旧 plotThreshold 65 から引上げ）|
| conspiracyTaskEffortRequired | 6 | 陰謀 Task の必要努力値（HEAVY 上限より重い）|
| conspiracyTaskBaseDifficulty | 60 | 陰謀全般の基本難度 |
| conspiracyRevokeRightBaseDifficulty | 60 | 任命権失効（person holder）の基本難度 |
| conspiracyRevokeHouseRightDifficultyBonus | 30 | 家保有任命権の追加難度（→ 実効 90）|
| conspiracyCooldownWeeks | 52 | 陰謀 Project terminal 後の再立案待機週数（連発防止）|
| **AppointmentSystem** | | |
| concurrentOfficePenalty | 8 | 兼任 1 役職ごとのスコアペナルティ |
| minAppointmentScore | 2 | この閾値未満なら任命しない（空席維持） |
| **Polity Appointment** | | |
| polityInfluenceAppointmentFactor | 0.25 | Polity Influence% のスコア寄与係数（v0.42: 旧 polityShareAppointmentFactor） |
| houseShareAppointmentFactor | 0.08 | House Share 割合のスコア寄与係数 |
| polityOfficeAppointmentRightHouseBonus | 30 | v0.42: right holder House の member 候補への補正（influence% 項の最大値を上回る制度的権利の強さ） |
| polityOfficeAppointmentRightPersonBonus | 35 | v0.42: right holder Person 本人への補正 |
| polityOfficeAppointmentRightHouseAssociatedBonus | 18 | v0.42: holder Person の家の member への補正 |
| rightBackedFactionBonus | 10 | v0.42: right-backed faction（最大 1 つ）の active member への補正（< HouseBonus） |
| acquirePoliticalRightBaseCost | 40 | v0.42: acquire_political_right の費用（House wealth → 対象 Polity treasury への transfer） |
| acquirePoliticalRightRequiredInfluencePercent | 20 | v0.42: Aim 生成の influence 下限ゲート（0〜100 スケール。全家一律 — 非 owner 家にも同水準） |
| acquirePoliticalRightMaxInfluencePercent | 70 | v0.42 拡張: Aim 生成の influence 上限ゲート（生成時のみ）。掌握済み polity の権利買い続け防止 |
| ownerHouseAppointmentBonus | 4 | 候補者の家が polity.ownerHouseId と一致する場合の加算 |
| sameHousePolityOfficePenalty | 2 | 同 House の Polity Office 保有数 1 つにつき減算（Polity Office 独占抑制） |
| **Rank ベース役職上限** | | |
| polityOfficeMaxByRank[1] | admin:3 treas:3 mil:5 adv:5 | 帝国: 全役職フル枠 |
| polityOfficeMaxByRank[2] | admin:2 treas:2 mil:3 adv:3 | 王国: 全役職（枠数制限） |
| polityOfficeMaxByRank[3] | admin:1 treas:1 mil:1 adv:0 | 公領: advisor 不可 |
| polityOfficeMaxByRank[4] | admin:1 treas:0 mil:0 adv:0 | 伯領: administrator のみ |
| polityOfficeMaxByRank[5] | admin:1 treas:0 mil:0 adv:0 | 反乱領: leader + administrator のみ |
| polityOfficeMaxProvinceFactor.small | 0.4 | 1 Province 以下の係数 |
| polityOfficeMaxProvinceFactor.medium | 0.7 | 2-3 Province の係数 |
| polityOfficeMaxProvinceFactor.large | 1.0 | 4 Province 以上の係数 |
| **commonwealth 専用役職上限** | | commonwealth は全 role 解放・province 係数なし（rank が席数を決める） |
| polityOfficeMaxByRankCommonwealth[1] | admin:3 treas:3 mil:5 adv:5 | 帝国級共和国: フル枠 |
| polityOfficeMaxByRankCommonwealth[2] | admin:2 treas:2 mil:3 adv:3 | |
| polityOfficeMaxByRankCommonwealth[3] | admin:2 treas:2 mil:2 adv:2 | |
| polityOfficeMaxByRankCommonwealth[4] | admin:1 treas:1 mil:2 adv:2 | |
| polityOfficeMaxByRankCommonwealth[5] | admin:1 treas:1 mil:1 adv:1 | 反乱領級共和国: 全 role 1 席（旧 admin 1 のみ → 全 role 解放で計 4 席）|
| samePrimaryPolityMarriageBonus | 0.08 | 同 primary Polity 間婚姻ボーナス |
| maxRawEvents | 10000 | 全イベント保持上限 |
| maxChronicleEvents | 1000 | Chronicle イベント保持上限 |
| **Marriage & Birth** | | |
| marriageEnabled | true | 婚姻システム有効 |
| marriageMaleMinAge | 16 | 婚姻可能最低年齢（男性） |
| marriageMaleMaxAge | 60 | 婚姻可能最高年齢（男性） |
| marriageFemaleMinAge | 15 | 婚姻可能最低年齢（女性） |
| marriageFemaleMaxAge | 45 | 婚姻可能最高年齢（女性） |
| marriageYearlyChance | 0.08 | 年間婚姻確率（基本） |
| birthEnabled | true | 出生システム有効 |
| fatherMinChildAge | 15 | 父親になれる最低年齢 |
| fatherMaxChildAge | 60 | 父親になれる最高年齢 |
| motherMinChildAge | 15 | 母親になれる最低年齢 |
| motherMaxChildAge | 45 | 母親になれる最高年齢 |
| baseBirthChancePerMalePerYear | 0.09 | 男性 1 人あたりの年間出生確率（基本）。家内出生を増やし有力な大家系を出現させるため高め（houseFounding 絞りとセット） |
| spouseMotherChance | 0.90 | 配偶者が母親になる確率 |
| maleBirthChance | 0.75 | 男子出生確率（通常）。v0.45.4: 0.52→0.75 = 男:女 ≈ 3:1。worldgen 初期性比も参照（§7、ただし --config 不感） |
| maleBirthChanceWhenAdultMaleShortage | 0.85 | 男子出生確率（成人男性不足時）。v0.45.4: 0.65→0.85（base より上に — 不足時に男性比を下げる逆転を解消） |
| adultMaleShortageThreshold | 0.4 | v0.45.4 新規: 男性不足コントローラの発動閾値（成人男性 < 総人口 × この値で shortage 値）。**0 でコントローラ無効**（女性多めプレイに必須 — 低 maleBirthChance を引き戻し続けるため） |
| targetLivingPersonsFactor | 2.0 | 出生倍率 1.5 の上限閾値（worldgen 初期人口 × この値。v0.45.1 で絶対値 180 から係数化） |
| criticalLivingPersonsFactor | 1.0 | 危機的人口の閾値係数（初期人口 × この値 以下で出生倍率 3.0） |
| highLivingPersonsFactor | 4.0 | 上限ダンパーの閾値係数（初期人口 × この値 以上で出生倍率 0.5。v0.45.1 新設・v0.45.4 で 3.0→4.0 人口増）。**人口を増減する主レバー（出生性比から独立）** |
| lowPopulationBirthMultiplier | 1.5 | 人口不足時の出生倍率 |
| criticalPopulationBirthMultiplier | 3.0 | 危機的人口時の出生倍率 |
| highPopulationBirthMultiplier | 0.5 | 人口過剰時の出生倍率（上限ダンパー） |
| mortalityRateInfant | 0.004 | 0-2 歳の死亡率（4 週ごと判定 1 回あたり。年率 4.7%。§6.7） |
| mortalityRateChild | 0.0012 | 3-14 歳の死亡率（年率 1.4%） |
| mortalityRatePrime | 0.0008 | 15-39 歳の死亡率（年率 1.0%） |
| mortalityRateMiddle | 0.003 | 40-59 歳の死亡率（年率 3.5%） |
| mortalityRateSenior | 0.01 | 60-69 歳の死亡率（年率 11.4%） |
| mortalityRateElder | 0.03 | 70 歳以上の死亡率（年率 30.5%） |
| geniusMortalityMultiplier | 0.5 | 天才（geniusType 持ち）の死亡率乗数。1 で無効 |
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
| houseSplitEvaluationIntervalWeeks | 12 | HouseSplitEvaluationSystem の実行間隔（週） |
| houseSplitCooldownWeeks | 48 | 分家後の再分裂防止期間（週、1年相当） |
| houseSplitMinLivingMembers | 5 | 評価パスの最小生存メンバー数 |
| houseSplitMinWealth | 80 | 評価パスの最小 wealth |
| houseSplitMinLegacyPrestige | 30 | 評価パスの最小 legacyPrestige |
| houseSplitExcludeTopSuccessionRanks | 1 | splitter から除外する継承順位上位人数（跡継ぎの分家を防ぐ。0 で無効）。§6.12 |
| extinctionUnrestGain | 8 | 家断絶後の継承 Province への POP unrest 増加量 |
| **War** | | |
| warEnabled | true | 戦争有効 |
| warCostPerProvince | 20 | Province あたり戦費 |
| maxProvincesPerWar | 3 | 1 戦争あたり最大征服数 |
| maxWarsPerTick | 1 | 1 tick あたり最大宣戦数 |
| warCooldownWeeks | 96 | 戦争クールダウン（週、2年相当） |
| minAttackerWinChanceToDeclare | 0.45 | 宣戦布告に必要な最低勝率（WarCreationSystem §6.44 開戦ゲートの基準しきい値） |
| winChanceWarGateEnabled | true | 勝率×性格による開戦ゲート（§6.44）の有効化。personAbilityEffectsEnabled とは別のキルスイッチ（flat-0.45 ゲートだけの A/B 用） |
| warWealthDamage | 8 | 戦争時の全 POP wealth 低下量 |
| warUnrestDamage | 10 | 戦争時の全 POP unrest 上昇量 |
| warPeasantSizeDamage | 0.5 | 戦争時の peasants size 減少量 |
| warTownsmanSizeDamage | 0.3 | 戦争時の townsmen size 減少量 |
| **War（War entity / WarScore / PeaceSettlement）** | | |
| maxWarDurationWeeks | 520 | timeout 終結（white_peace）の週数。約 10 年（§6.46） |
| defaultTransferLandWarScore | 12 | transfer goal の requiredWarScore（§6.44） |
| defaultChangeContractTaxWarScore | 10 | tax goal の requiredWarScore（§6.44） |
| terminalWarRetentionWeeks | 48 | terminal War 削除までの週数（§6.51） |
| **War Maneuver（§6.45）** | | |
| warAvoidanceTerrainModifierByBattlefield | Record<BattlefieldKind, number> | 戦場別の回避しやすさ補正（open_field −0.1 … mountain_pass/wetland_battle +0.15 … siege −0.2）。v0.49 で回避成否は battleEngagementCaptureBaseChance/Scale の contest に移行し、base/warCommand 係数は廃止 |
| warAvoidanceCountPenalty | 0.2 | avoidanceCount 1 回ごとの回避欲求/確率ペナルティ |
| maxWarAvoidanceCount | 4 | この回数以上は強制交戦（accept） |
| warAvoidanceWarScorePenalty | 1.0 | 片側のみ回避成功時に非回避側へ動く warScore |
| maxWarCommanderCandidatesPerSide | 8 | v0.43: side ごとの現場指揮官候補リスト保持数（warCommand 上位から） |
| warEngagementRandomness | 0.1 | 交戦判断 noise 幅 |
| warEngagementCautionEffect | 0.2 | 総大将 caution が回避欲求に与える係数 |
| warEngagementAmbitionEffect | 0.15 | 総大将 ambition が交戦欲求に与える係数 |
| warEngagementWarScoreUrgencyEffect | 0.3 | 負けている側ほど交戦を急ぐ urgency 係数 |
| warBattleRandomness | 0.1 | 未使用（resolveBattle 撤去済み）。旧 battle 実効戦力の乱数幅 |
| warBattleScoreScale | 24 | 未使用。旧 warScore 振れ幅係数（現在は §6.45 magnitude 式で算出） |
| maxWarScoreDeltaPerBattle | 12 | 1 戦闘の warScoreDelta clamp 上限 |
| battleVictoryThreshold | 1.0 | 未使用。旧 result ラベル閾値（現在は internal sim の result が決める） |
| warCommanderWarCommandEffect | 0.25 | 未使用。旧 commanderModifier 係数（現在は §6.45 battle 内補正で算出） |
| minWarCommanderModifier | 0.75 | 未使用。旧 commanderModifier 下限 |
| maxWarCommanderModifier | 1.25 | 未使用。旧 commanderModifier 上限 |
| captainGeneralWarScoreEffect | 0.1 | 勝者総大将 warCommand が warScoreDelta に与える効率係数（§6.45） |
| warBattlefieldRiverCrossingChance | 0.35 | major_river feature → river_crossing になる確率 |
| warBattlefieldCoastalBattleChance | 0.25 | coastal feature → coastal_battle になる確率 |
| **Regiment / Battle 損耗（simulateBattle に置換され未使用）** | | |
| regimentOrganizationDamage{Winner/Loser/Inconclusive}Min/Max | — | 未使用。旧 side 一律 org 損耗レンジ（現在は per-regiment internal tick で算出） |
| regimentStrengthDamage{Winner/Loser/Inconclusive}Min/Max | — | 未使用。旧 side 一律 strength 損耗レンジ |
| regimentOrganizationRecoveryPerWeek | 8 | organization 週次回復の基礎値（baseline-aware: baseline 未満時 × (0.5 + morale/100)。provisional） |
| regimentInitialMorale | 30 | worldgen 初期 morale（= baselineMorale） |
| regimentInitialStrength | 100 | worldgen 初期 strength |
| regimentInitialOrganization | 50 | worldgen 初期 organization（= baselineOrganization） |
| regimentMaxStrength | 100 | strength 上限 |
| regimentDestroyedStrengthThreshold | 0 | clamp 後 strength がこの値以下で Regiment destroyed |
| **Regiment baseline / max（§3.9b）** | | |
| regimentBaselineOrganizationDefault / regimentBaselineMoraleDefault | 50 / 30 | 平時に向かう statistics（recovery 収束先） |
| regimentMaxOrganizationDefault / regimentMaxMoraleDefault | 100 / 100 | org / morale 上限 |
| regimentMaxOrganizationHardCap / regimentMaxMoraleHardCap | 120 / 100 | integrity 用 hard cap |
| regimentOrganizationDecayAboveBaselinePerWeek | 1 | org が baseline 超のとき週次減衰 |
| regimentMoraleRecoveryPerWeek / regimentMoraleDecayAboveBaselinePerWeek | 1 / 0.5 | morale の baseline 未満回復 / 超過減衰 |
| **Battle internal tick（§6.45。仮値、balance 保留）** | | |
| battleTickUnit / battleMaxTicks | 'day' / 5 | 内部 tick 単位 / 最大 tick 数 |
| retreatOrganizationThreshold / routeOrganizationThreshold | 20 / 8 | frontline 離脱 / rout の org 閾値 |
| minFightingStrengthThreshold | 10 | deployment 候補の最小 strength |
| moraleRouteThresholdFactor | 0.25 | morale 低下が effRoute 閾値を上げる係数 |
| battleBaseOrganizationDamage | 5 | 1 方向の基礎 org damage（B2a co-tune: 8→5、1 戦 ≈ baseline 1/2） |
| battleMoraleDamageRatio / battleStrengthDamageRatio | 0.25 / 0.08 | org damage に比例する morale / strength damage 係数 |
| winner/loser/routedStrengthDamageMultiplier | 0.6 / 1.4 / 2.5 | strength damage の role 係数 |
| routAdditionalMoraleDamage | 8 | rout 時の追加 morale damage |
| battleRandomFactorMin / Max | 0.85 / 1.15 | damage 方向ごとの乱数幅 |
| ~~flankPressureBase / maxFlankPressureMultiplier~~ | （削除 v0.49） | 旧 wing-based flank pressure。slot-based flanking（§6.45）へ統合し退役・キー削除。`battleFlankTerrainMultiplierByKind` は slot-based flanking の地形補正に転用 |
| battleMaxTicksDecisiveMarginRatio | 0.1 | maxTicks 到達時に決着とみなす残存 org 合計の相対差 |
| battleSimOrganizationTiebreakEpsilon | 0 | 相討ち org 合計 tiebreak の epsilon |
| routSideRoutedShareThreshold | 0.4 | 敗者 routed share がこの値以上で outcomeQuality=rout |
| battleStrengthOutcomeQualityMultiplier{Orderly/Rout} | 1.0 / 1.2 | strength damage の outcomeQuality 係数 |
| battleStrengthPowerDisadvantageModifierMin / Max | 1.0 / 1.3 | 敗者 side の戦力劣勢 strength damage 係数 |
| battleTerrainOrganizationDamageMultiplierByKind / battleFlankTerrainMultiplierByKind | (地形別 table) | org damage / flank の地形補正 |
| **指揮官 / 総大将 battle 効果（§6.45）** | | |
| commanderAssignedRegimentEffectMax / commanderAdjacentRegimentEffectRatio | 0.15 / 0.4 | 割当連隊 q 上限 / 隣接連隊への伝播率 |
| captainGeneralBattleOrganizationDamageEffectMax / captainGeneralRoutResistanceEffectMax | 0.1 / 0.1 | 総大将 side-level の被 damage 軽減 / rout 耐性（benefit 方向のみ） |
| **warScoreDelta magnitude（§6.45）** | | |
| battleOrderlyVictoryScoreBase / battleRoutVictoryScoreBase | 6 / 10 | outcomeQuality 別の base magnitude |
| battleDecisivenessRoutedShareWeight / SpeedWeight | 0.4 / 0.2 | decisiveness の routed share / 早期決着重み |
| battleDecisivenessMin / Max | 0.7 / 1.4 | decisiveness clamp |
| battlePreBattleEdgeWeight | 0.2 | 勝者 preBattle edge の反映係数 |
| battlePreBattleModifierMin / Max | 0.8 / 1.2 | preBattleModifier clamp |
| **v0.49 戦列スロットモデル（§6.45。係数は初期仮値。バランスは戦場/指揮官/消耗/兵站が揃ってから）** | | |
| battleEngagementCaptureBaseChance / battleEngagementCaptureAbilityScale | 0.5 / 0.5 | 片側回避時の捕捉 contest（両総大将 insight+command）の基礎確率 / 能力差スケール |
| battleCaughtFrontagePenalty / battleMinimumEffectiveFrontage | 1 / 1 | 捕捉戦で effectiveFrontage を縮める幅 / 下限 |
| battleTacticAdvantageDamageMultiplier / battleTacticInsightReadEffect | 1.2 / 0.5 | 三すくみ有利側の damage 倍率 / 高 insight が有利戦術を選ぶ度合い |
| battleUncommandedDamagePenalty / battleUncommandedRoutPenalty | 0.15 / 0.1 | 無指揮官連隊の damage / rout penalty |
| battleUncommandedAdjacentSupportRatio | 0.5 | 隣接 slot に指揮官がいる場合の penalty 軽減率 |
| battleFlankingDamageMultiplier / battleFlankingRoutPenalty | 1.25 / 0.1 | slot-based 側面攻撃の damage 倍率 / rout penalty |
| battleBreakthroughBaseChance / battleBreakthroughAbilityGapThreshold | 0.08 / 15 | 突破の基礎確率 / eligible にする指揮官能力差閾値 |
| battleBreakthroughOrgDamageMultiplier | 1.3 | 突破成功時の対象 accumulatedOrgDamage 倍率（combat damage と別ステップ） |
| battlePursuitBaseChance / battlePursuitDestroyedChance | 0.15 / 0.35 | 追撃の基礎確率 / 追撃成功時の destroyed 抽選確率 |
| battlePursuitOrgDamageMultiplier | 1.5 | 追撃成功時の org 増幅 |
| battleDestroyedWarScoreWeight | 0.15 | warScore decisiveness への敗者 destroyed share 上乗せ重み（routed share と別軸の小 weight） |
| battleCaptainGeneralFeatReputationScore / battleCaptainGeneralFailureReputationScore | 12 / 14 | 会戦単位 reputation: winner CG 突出武功 +score / loser CG 大失態 −score（決定的勝敗のみ。§6.45） |
| battleLogNormalRetentionWeeks | 480 | 恒久 BattleLog の `normal` 保持週数（`major` は恒久・`minor` は非生成。§6.51b） |
| **Regiment 補充・再編成（仮値。CLI harness で balance 調整予定。§6.50）** | | |
| regimentReinforcementBasePerMonth | 4.0 | active strength の月次補充基礎値（cadence は tick 登録 interval=4 で固定） |
| regimentReinforcementPeaceMultiplier | 1.0 | 平時の補充速度係数 |
| regimentReinforcementWarMultiplier | 0.4 | owner が active War 参加中の補充速度係数 |
| regimentReinforcementMobilizedMultiplier | 0.25 | 動員中 Regiment に追加で掛かる係数（warMultiplier と乗算） |
| regimentReinforcementReferencePopByClass | { peasants: 80, townsmen: 15, nobles: 2.5 } | popFactor 正規化基準（per-class。worldgen 実測より median holding が factor ~1.0） |
| regimentReinforcementMinPopFactor / MaxPopFactor | 0.1 / 1.5 | popFactor の clamp 範囲 |
| regimentReinforcementCostPerStrength | 0.2 | strength 1 補充あたり owner treasury から支払う費用 |
| regimentCavalryReinforcementMultiplier | 0.75 | cavalry の補充速度係数（infantry=1.0） |
| regimentCavalryReinforcementCostMultiplier | 1.5 | cavalry の補充費用係数（infantry=1.0） |
| destroyedRegimentReformDelayWeeks | 24 | destroyed → reform 可能になるまでの最短週数 |
| destroyedRegimentReformInitialStrength / Organization / Morale | 20 / 20 / 40 | reform 直後の初期値 |
| destroyedRegimentReformCost | 8 | reform 1 件あたり owner treasury から支払う費用 |
| destroyedRegimentReformMinPopFactor | 0.25 | reform に必要な popFactor 下限 |
| **兵站・補給システム（v0.51 WarSupplySystem §6.43a）** | | |
| warSupplyEnabled | true | 兵站システム有効（kill-switch） |
| warSupplyPressureMildThreshold | 30 | supplyPressure → mild band 閾値 |
| warSupplyPressureModerateThreshold | 60 | supplyPressure → moderate band 閾値 |
| warSupplyPressureSevereThreshold | 85 | supplyPressure → severe band 閾値 |
| warSupplyPressureCatastrophicThreshold | 110 | supplyPressure → catastrophic band 閾値 |
| warSupplyPressureDecayPerWeek | 5 | supplyPressure 週次自然減衰 |
| warSupplyPressureGainFactor | 8.0 | supplyPressure 蓄積係数 |
| warSupplyLocalHostilityToPressureFactor | 0.05 | localHostility → supplyPressure 寄与 |
| warSupplyLocalHostilityDecayPerWeek | 2 | localHostility 週次自然減衰 |
| warSupplyPlunderPressureDecayPerWeek | 4 | plunderPressure 週次自然減衰 |
| warSupplyPressureToPlunderFactor | 0.08 | supplyPressure → plunderPressure 蓄積 |
| warSupplyHostilityToPlunderFactor | 0.04 | localHostility → plunderPressure 蓄積 |
| warSupplyPressureToHostilityFactor | 0.05 | supplyPressure → localHostility 蓄積 |
| warSupplyPopUnrestToHostilityFactor | 0.03 | POP unrest → localHostility 蓄積 |
| warSupplyCommandDisciplineBase | 2.0 | 指揮官不在時の基礎規律値 |
| warSupplyAccessBase | 30 | 補給アクセス基礎値 |
| warSupplyAccessWealthFactor | 0.3 | POP wealth → supplyAccess |
| warSupplyAccessDevelopmentFactor | 2.0 | development → supplyAccess |
| warSupplyAccessControlFactor | 0.2 | polityControl → supplyAccess |
| warSupplyAccessHostilityPenaltyFactor | 0.15 | localHostility → supplyAccess 減少 |
| warSupplyAccessCrisisPenalty | 5 | Crisis 数 → supplyAccess 減算 |
| warSupplyForageBase | 0.5 | 採餌効率基礎値 |
| warSupplyQuartermasterForageFactor | 0.15 | 補給官 → forage |
| warSupplyStrategistForageFactor | 0.05 | 参謀 → forage |
| warSupplyQuartermasterAccessFactor | 10 | 補給官 → supplyAccess |
| warSupplyStrategistAccessFactor | 3 | 参謀 → supplyAccess |
| warSupplyHostilityForagePenalty | 0.15 | localHostility → forage 減少 |
| warSupplyCaptainGeneralForageFactor | 0.05 | 総大将 → forage |
| warSupplyCaptainGeneralDisciplineFactor | 3.0 | 総大将の規律寄与（hostility/plunder 抑制） |
| warSupplyQuartermasterDisciplineFactor | 2.0 | 補給官の規律寄与 |
| warSupplyOrganizationDamageByBand | none:0 mild:0 moderate:2 severe:5 catastrophic:10 | band 別 org 週次ダメージ |
| warSupplyMoraleDamageByBand | none:0 mild:0 moderate:2 severe:5 catastrophic:10 | band 別 morale 週次ダメージ |
| warSupplyStrengthDamageByBand | none:0 mild:0 moderate:0.5 severe:2 catastrophic:3 | band 別 strength 週次ダメージ |
| warSupplyCatastrophicCollapseChanceBase | 0.05 | catastrophic band での Regiment 壊滅基礎確率 |
| warSupplyCatastrophicCollapsePressureFactor | 0.002 | supplyPressure による壊滅確率加算 |
| wartimeRegimentRecoveryMultiplier | 0.5 | 戦時 recovery 速度倍率 |
| warSupplyRecoveryMultiplierByBand | none:1.0 mild:0.9 moderate:0.75 severe:0.45 catastrophic:0.15 | band 別 recovery 倍率 |
| warSupplyMaxStaffRecoveryMitigation | 0.35 | staff recovery 軽減上限 |
| warSupplyStaffAbsentScoreMultiplier | 0.75 | staff 不在時のスコア倍率 |
| warSupplyQuartermasterMitigationFactor | 0.3 | 補給官の attrition 軽減 |
| warSupplyCaptainGeneralMitigationFactor | 0.1 | 総大将の attrition 軽減 |
| warSupplyStrategistBonusFactor | 0.15 | 参謀ボーナス係数 |
| cavalrySupplyDemandMultiplier | 1.5 | 騎兵の補給需要倍率 |
| cavalryForageEfficiencyBonus | 0.05 | 騎兵比率の採餌ボーナス |
| cavalryPlunderEfficiencyBonus | 0.1 | 騎兵比率の略奪効率ボーナス |
| cavalrySupplyAttritionMultiplier | 1.25 | 騎兵の補給消耗倍率 |
| warSupplyHarshRequisitionPressureThreshold | 40 | 強制徴発の supplyPressure 閾値 |
| warSupplyHarshRequisitionChanceFactor | 0.01 | 強制徴発の確率係数 |
| warSupplyPlunderPressureThreshold | 50 | 略奪の plunderPressure 閾値 |
| warSupplyPlunderChanceFactor | 0.015 | 略奪の確率係数 |
| warSupplyHarshRequisitionSupplyRelief | 8 | 強制徴発の supplyPressure 軽減 |
| warSupplyPlunderSupplyRelief | 15 | 略奪の supplyPressure 軽減 |
| warSupplyPlunderPressureRelief | 20 | 略奪の plunderPressure 軽減 |
| warSupplyHarshRequisitionHostilityGain | 8 | 強制徴発の localHostility 増加 |
| warSupplyPlunderHostilityGain | 15 | 略奪の localHostility 増加 |
| warSupplyHarshRequisitionPopWealthDamage | 5 | 強制徴発の POP wealth 低下 |
| warSupplyHarshRequisitionPopUnrestGain | 8 | 強制徴発の POP unrest 上昇 |
| warSupplyPlunderPopWealthDamage | 12 | 略奪の POP wealth 低下 |
| warSupplyPlunderPopUnrestGain | 15 | 略奪の POP unrest 上昇 |
| supplyForageConditionDrop | 2 | 採餌の condition 低下基礎値 |
| supplyHarshRequisitionConditionDrop | 8 | 強制徴発の condition 低下 |
| supplyPlunderConditionDrop | 20 | 略奪の condition 低下 |
| supplySpilloverDamageMultiplier | 0.4 | 隣接波及の damage 倍率 |
| warSupplyHarshRequisitionSpilloverChance | 0.15 | 強制徴発の隣接波及確率 |
| warSupplyPlunderSpilloverBaseChance | 0.2 | 略奪の隣接波及基礎確率 |
| warSupplyPlunderSpilloverPressureFactor | 0.003 | 略奪波及の pressure 加算 |
| warSupplyMaxSpilloverHoldings | 2 | 1回の波及最大 Holding 数 |
| warSupplyAttritionEventStrengthThreshold | 5 | SUPPLY_ATTRITION 発火の最小 strength 損耗 |
| **Disaster / Harvest（発生率・豊作）** | | |
| disasterEnabled | true | 災害・豊作有効（CrisisSystem の年次発生ロール + HarvestSystem の kill-switch） |
| famineBaseChancePerYear | 0.08 | 飢饉基礎発生率/年/Province（CrisisSystem が使用） |
| plagueBaseChancePerYear | 0.03 | 疫病基礎発生率/年/Province（同上） |
| bountifulHarvestBaseChancePerYear | 0.05 | 豊作発生率/年/Province（HarvestSystem） |
| faminePressureChanceBonus | 9.2 | 人口圧力超過分あたりの飢饉発生率加算（pressure 1.0 で 100%） |
| plaguePressureChanceBonus | 2.0 | 人口圧力超過分あたりの疫病発生率加算 |
| ~~famineWealthPenalty~~ | 8 | **v0.48 で未使用**（旧 DisasterSystem の単発効果。被害は Crisis severity 駆動に置換） |
| ~~famineSizeDamageRate~~ | 0.10 | **v0.48 で未使用**（初期ショックは `crisisInitialShockSizeRateByKind`） |
| ~~plagueWealthPenalty~~ | 10 | **v0.48 で未使用** |
| ~~plagueSizeDamageRate~~ | 0.05 | **v0.48 で未使用** |
| disasterReliefCostPerProvince | 20 | 救済費用/Province（現在は一旦オミット、将来再導入） |
| famineReliefDamageMultiplier | 0.3 | 救済成功時の POP 効果軽減係数（現在は一旦オミット） |
| bountifulHarvestPeasantWealthGain | 10 | 豊作による peasants wealth 上昇量 |
| bountifulHarvestPeasantUnrestReduction | 5 | 豊作による peasants unrest 低下量 |
| bountifulHarvestTownsmanWealthGain | 2 | 豊作による townsmen wealth 上昇量 |
| bountifulHarvestTownsmanUnrestReduction | 1 | 豊作による townsmen unrest 低下量 |
| **Crisis（v0.48・暫定値。balance は機能完成後にまとめて調整, CLAUDE.md §4）** | | |
| crisisEnabled | true | Crisis システム有効（週次処理 + 各経路の spawn） |
| droughtBaseChancePerYear | 0.04 | 干魃基礎発生率/年/Province |
| droughtPressureChanceBonus | 5.0 | 人口圧力超過分あたりの干魃発生率加算 |
| crisisInitialSeverityByKind | famine 30 / plague 35 / drought 25 / war_damage 25 / unrest 40 / disrepair 30 | kind 別 初期 severity（disrepair は修理工数 = Project targetProgress） |
| crisisSeverityPressureBonus | 20 | 人口圧力超過分あたりの初期 severity 加算（famine/plague/drought のみ） |
| crisisInitialShockSizeRateByKind | famine 0.05 / plague 0.04 / drought 0.03 / war_damage 0.02 / unrest 0 / disrepair 0 | 発生時の一回限り人口減率 |
| crisisDeadlineWeeksByKind | famine 24 / plague 20 / drought 32 / war_damage 32 / unrest 12 / disrepair 999 | kind 別 有効期限（週）。disrepair は型充足用で Crisis/Project とも deadline 不使用 |
| crisisBudgetTreasuryRatio | 0.1 | 対処予算 = floor(treasury × 本値) と cap の小さい方 |
| crisisBudgetCapByKind | famine 60 / plague 80 / drought 50 / war_damage 80 / unrest 40 / disrepair 60 | kind 別 予算上限 |
| crisisWeeklyWealthPenaltyPerSeverity | 0.05 | severity 1 あたりの週次 POP wealth 低下（disrepair は適用しない） |
| crisisWeeklyUnrestPerSeverity | 0.04 | severity 1 あたりの週次 POP unrest 上昇（disrepair は適用しない） |
| crisisNeglectAffectionDropPerWeekBailiff | -0.3 | 放置中の週次 代官 affection 低下 |
| crisisNeglectAffectionDropPerWeekPolity | -0.15 | 放置中の週次 Polity affection 低下 |
| crisisExpiredAffectionDropBailiff | -5 | 期限切れ時の追加 代官 affection 低下 |
| crisisExpiredAffectionDropPolity | -3 | 期限切れ時の追加 Polity affection 低下 |
| **設備維持管理 FacilityMaintenance（v0.48.1・暫定値。balance は機能完成後に調整, CLAUDE.md §4）** | | |
| facilityMaintenanceEnabled | true | kill-switch（§6.6b） |
| facilityConditionDecayPerCyclePerLevel | 0.9 | 維持サイクル(4週)ごとの condition 減衰 = 本値 × level。減衰: 100→閾値50 で約 56 サイクル ≈ 4.3 年/閾値到達（L1）。放置 L1 設備は ~9 年弱で全壊 |
| facilityDisrepairThreshold | 50 | これ未満で機能不全（生産 effectiveness 低下 + disrepair Crisis 発火） |
| facilityDisrepairMinEffectiveness | 0 | 生産 effectiveness の下限（condition 0 時）。`conditionEffectiveness` の minFloor |
| facilityRepairConditionRestore | 100 | 修理完了 / 部分崩壊後に回復する condition |
| warDamageConditionDrop | 40 | 戦災 1 回あたりの全 improvement condition 減少幅（§6.6b 戦争連動） |
| facilityConditionSeedJitterMin | 70 | worldgen seed の condition 下限（上限 100、第1波 desync。improvement id 由来の決定論 jitter） |
| crisisDisrepairNeglectMultiplier | 0.4 | disrepair 放置時の neglect affection 低下の倍率（他 Crisis の 40%。deadline 無しで長期蓄積するため穏やかに） |
| crisisMitigationByKind | drought→irrigation_infrastructure 0.25/lv / famine→storage_infrastructure 0.25/lv | 設備による Crisis 被害軽減。kind 別に「軽減設備種別＋レベルあたり軽減率」。spawn 時に severity と初期ショックを factor=max(0,1−rate×level) で乗算（max level 3 で最大 75% 軽減）。未登録 kind は軽減なし |
| facilityMaintenanceThreshold | 80 | 定期保守の上限閾値（§6.6b v0.48.2）。disrepairThreshold 以上 本値 未満が要保守帯。不変条件: disrepairThreshold < 本値 ≤ 100 |
| facilityMaintenanceConditionRestore | 100 | 定期保守成功時に回復する condition |
| facilityMaintenanceCostPerLevel | 3 | 定期保守 1 回あたり owner treasury から引く費用 = 本値 × level |
| **Public Spending** | | |
| publicSpendingEnabled | true | 公共支出有効 |
| publicSpendingYearlyChance | 0.35 | 公共支出年間発動確率 |
| **Development** | | |
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
| **Control System** | | |
| controlMaxDistancePenalty | 10 | 距離 1 あたりの支配力上限ペナルティ |
| controlMaxMinimum | 40 | 支配力上限の最低値 |
| controlGrowthPerMonth | 2 | 支配力 4 週ごとの増加量（名称は旧 Monthly を維持） |
| controlDecayPerMonth | 1 | 支配力 4 週ごとの減少量（上限超過時。名称は旧 Monthly を維持） |
| disconnectedControlDecayPerMonth | 5 | 接続不能 Province の 4 週ごとの減衰量（名称は旧 Monthly を維持） |
| **Land Development** | | |
| landDevelopmentHouseControlGain | 5 | 土地開発による houseControl 上昇量 |
| landDevelopmentUnrestReduction | 1 | 土地開発によるスコア評価に用いる unrest 低下量 |
| **Person Ability Effects** | | |
| personAbilityEffectsEnabled | true | 人物能力効果の有効/無効 |
| abilityOutputExponent | 1.6 | v0.49: 統一非線形ファクター指数（§10.0）。`(roleScore/50)^exp`。内政成長/税効率/開発コスト/軍戦力推定(外交評価のみ)/adminPower を一括スケール。80↔40 の成果比を約2x（現実プロファイル）〜3x（万能型）に。上げるほど能力差が誇張 |
| chancellorAdminControlMaxBonusPerAdmin | 1 | 宰相 admin 1 点あたりの支配力上限ボーナス |
| houseHeadAdminControlMaxBonusPerAdmin | 1 | 家長 admin 1 点あたりの家支配力上限ボーナス |
| controlAbilityMinimumFloor | 35 | 能力補正後の支配力上限最低値 |
| treasurerCautionTaxEfficiencyEffect | 0.10 | 財務官 caution による税収効率補正係数 |
| treasurerTaxEfficiencyMin | 0.5 | 税収効率の最小値（v0.49 で 0.8→0.5、非線形化に伴い帯域拡張） |
| treasurerTaxEfficiencyMax | 2.0 | 税収効率の最大値（v0.49 で 1.2→2.0） |
| generalAmbitionDeclareThresholdEffect | 0.10 | 将軍 ambition による宣戦閾値変動係数 |
| (廃止 v0.49) chancellor/houseHead AdminControlGrowthEffect, treasurerAdminTaxEfficiencyEffect, treasurerAdminDevelopmentCostEffect, generalMartialWarPowerEffect | — | 旧線形係数。abilityOutputFactor (abilityOutputExponent 単一ノブ) に統合し削除 |
| generalCautionDeclareThresholdEffect | 0.10 | 将軍 caution による宣戦閾値変動係数 |
| minWarDeclareThreshold | 0.30 | 宣戦閾値の下限 |
| maxWarDeclareThreshold | 0.75 | 宣戦閾値の上限 |
| pressureStanceAmbitionShift | 0.10 | 被圧力側 stance 境界の ambition シフト量（§6.38 choose_stance。大胆ほど拒否寄り） |
| pressureStanceCautionShift | 0.10 | 被圧力側 stance 境界の caution シフト量（§6.38 choose_stance。慎重ほど譲歩寄り） |
| negotiatorTermQualityEffect | 0.10 | 交渉担当者の charisma/insight による妥協幅スケール量（§6.55 offer_compromise） |
| chancellorAmbitionLandDevelopmentScoreEffect | 10 | 宰相 ambition による landDevelopmentScore 補正係数（低 ambition が正に働く） |
| chancellorCautionLandDevelopmentScoreEffect | 20 | 宰相 caution による landDevelopmentScore 補正係数 |
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
| **Military** | | |
| houseManpowerPowerFactor | 1.0 | House manpower を軍事力へ変換する係数 |
| houseMilitaryWealthReserve | 100 | 軍事力換算から除外する House wealth 予備 |
| houseWealthMilitaryFactor | 8.0 | log1p(availableWealth) の軍事力換算係数 |
| maxMercenaryPowerRatio | 0.5 | 傭兵力の上限（levyPower の 50%） |
| houseCommanderMartialEffect | 0.25 | martial による軍事力倍率補正係数 |
| minCommanderModifier | 0.75 | 指揮官補正の下限 |
| maxCommanderModifier | 1.25 | 指揮官補正の上限 |
| polityAdminMilitaryFactor | 0.3 | Polity adminPower の軍事力寄与係数 |
| minHouseMilitaryContribution | 0.25 | 非支配家門の最低軍事寄与率 |
| **HouseRebellion** | | |
| houseRebellionNobleUnrestFactor | 0.15 | nobles unrest の反乱傾向加算係数 |
| houseRebellionProvinceUnrestFactor | 0.05 | Province 全体 unrest の反乱傾向加算係数 |
| houseRebellionLowControlFactor | 0.10 | 低 polityControl による反乱傾向加算係数 |
| rebellionTreasuryPowerDivisor | 50 | 国庫を鎮圧戦力へ換算する除数 |
| **ProvinceRevolt** | | |
| provinceRevoltThreshold | 90 | Province 反乱発動の傾向閾値 |
| provinceRevoltChanceDivisor | 300 | 傾向値を月次確率へ変換する除数 |
| provinceRevoltMaxChance | 0.35 | 月次発生確率の上限 |
| provinceRevoltUnrestFactor | 1.2 | unrest の傾向加算係数 |
| provinceRevoltLowHouseControlFactor | 0.2 | 低 houseControl の傾向加算係数 |
| provinceRevoltLowCountryControlFactor | 0.2 | 低 polityControl の傾向加算係数 |
| provinceRevoltStabilitySuppressionFactor | 0.2 | stability による傾向抑制係数 |
| revoltAbilitySuppressionFactor | 0.4 | v0.49: 統治者(代官>領主家長)の統率/学識による反乱傾向の対称補正係数（§6 反乱・§10.0） |
| revoltAbilityNeutralScore | 50 | v0.49: governorScore(command*0.5+learning*0.5) の中立点。これを超えると鎮静・下回ると煽る |
| peasantRevoltPovertyFactor | 0.5 | peasants 貧困補正係数 |
| peasantRevoltPressureFactor | 10 | peasants 人口圧補正係数 |
| townsmenRevoltProductionFactor | 0.02 | townsmen 生産量補正係数 |
| townsmenRevoltExtractionFactor | 5 | townsmen 搾取補正値 |
| nobleRevoltHouseDisloyaltyFactor | 0.2 | nobles 低忠誠度補正係数 |
| nobleRevoltLowLegitimacyFactor | 0.2 | nobles 低正統性補正係数 |
| popRevoltPowerFactorByClass | {peasants:0.02, townsmen:0.015, nobles:0.08} | class 別反乱戦力係数 |
| provinceRevoltHouseSuppressionFactor | 1.0 | House manpower の鎮圧力換算係数 |
| provinceRevoltCountrySuppressionFactor | 0.8 | Polity manpower の鎮圧力換算係数 |
| provinceRevoltTreasurySuppressionFactor | 2.0 | log1p(treasury) の鎮圧力換算係数 |
| provinceRevoltHouseWealthSuppressionFactor | 2.0 | log1p(houseWealth) の鎮圧力換算係数 |
| provinceRevoltConcessionCountryControlLoss | 10 | 譲歩時の polityControl 低下量 |
| provinceRevoltConcessionHouseControlLoss | 15 | 譲歩時の houseControl 低下量 |
| provinceRevoltConcessionUnrestReduction | 20 | 譲歩時の反乱 POP unrest 低下量 |
| provinceRevoltConcessionHouseWealthLoss | 20 | 譲歩時の House wealth 低下量 |
| provinceRevoltLordshipChangeSuccessMargin | 0.15 | lordship_change に必要な最低 successMargin |
| provinceRevoltLordshipChangeCountryControlLoss | 10 | 領主交代後の polityControl 低下量 |
| provinceRevoltNewHouseControl | 50 | 新領主の初期 houseControl |
| provinceRevoltIndependenceCountryControlMax | 10 | 独立条件: polityControl の上限 |
| provinceRevoltIndependenceHouseControlMax | 10 | 独立条件: houseControl の上限 |
| provinceRevoltIndependenceSuccessMargin | 0.20 | 独立に必要な最低 successMargin |
| provinceRevoltNewCountryControl | 40 | 独立後の新国家 polityControl |
| provinceRevoltFailedUnrestReduction | 10 | 反乱失敗時の反乱 POP unrest 低下量 |
| provinceRevoltFailedDevastation | 4 | 反乱失敗時の Province 荒廃量 |
| provinceRevoltFailedWealthPenalty | 8 | 反乱失敗時の反乱 POP wealth 低下量 |
| provinceRevoltSuppressionCollateralUnrestGain | 2 | 鎮圧時の他 class への collateral unrest |
| revoltHouseInitialLegacyPrestige | 10 | 反乱新設 House の初期 legacyPrestige |
| revoltHouseInitialWealth | 30 | 反乱新設 House の初期 wealth |
| revoltPolityInitialTreasury | 50 | 独立新設 Polity の初期 treasury |
| revoltPolityInitialLegacyPrestige | 20 | 独立新設 Polity の初期 legacyPrestige |
| **行政キャパシティ** | | |
| baseCountryInstitutionalCapacity | 20 | 国家の基礎的行政キャパシティ |
| rulerAdminCapacityFactor | 4 | Ruler の admin stat によるキャパシティ寄与係数 |
| administratorCapacityFactor | 3 | Administrator の admin stat によるキャパシティ寄与係数 |
| treasurerCapacityFactor | 2 | Treasurer の admin stat によるキャパシティ寄与係数 |
| adminLoadPerProvince | 2 | Province 1 つあたりの行政負荷 |
| adminLoadPerCountryOffice | 1 | 役職 1 つあたりの行政負荷 |
| minAdministrativeEfficiency | 0.3 | 行政効率の下限 |
| maxAdministrativeEfficiency | 1.5 | 行政効率の上限 |
| duplicateOfficeCoordinationPenalty | 0.5 | 同役職複数担当者の協調ペナルティ係数 |
| officeHouseDiversityPenalty | 0.3 | 役職担当者が同一家に集中した場合のペナルティ係数 |
| **OfficeCompensation** | | |
| officeUnpaidAffectionPenalty | -3 | 未払い時の affection ペナルティ |
| officeUnpaidRespectPenalty | -2 | 未払い時の respect ペナルティ |
| officeDignityUnpaidPenaltyReduction | 0.5 | 役職の尊厳によるペナルティ軽減係数 |
| **HouseShareUpdate / Polity Influence (v0.42)** | | |
| polityInfluenceBase | 0 | influence base domain。**影響力個人中心化で 0（受動 soft-power 全廃・旧 10）** §6.64a-(1) |
| polityInfluenceProvinceFactor | 5 | landed_power: Province 数係数（旧 polityShareProvinceFactor） |
| polityInfluenceMilitaryFactor | 0.1 | landed_power: 軍事 proxy 係数（旧 polityShareMilitaryFactor） |
| polityInfluenceWealthFactor | 0 | wealth domain 係数。**影響力個人中心化で 0（受動 soft-power 全廃・旧 0.05。wealth は運動 Project の燃料に降格）** §6.64a-(1) |
| polityInfluencePrestigeFactor | 0 | prestige domain 係数。**影響力個人中心化で 0（受動 soft-power 全廃・旧 0.2）** §6.64a-(1) |
| polityInfluenceReputationFactor | 0.5 | **影響力個人中心化: reputation domain（成果項）。polity-tag PersonReputation 現在値合計の係数** §6.64a-(2) |
| polityInfluenceOwnerHouseBonus | 30 | ruler domain: ownerHouse ボーナス（旧 polityShareOwnerHouseBonus） |
| polityInfluenceLeaderHouseBonus | 10 | ruler domain: 非 ownerHouse 出身 leader の家への補正（ownerHouseBonus の 1/3。leader∈ownerHouse なら加算しない） |
| polityInfluenceOfficeFactor | 3 | office domain: non-leader 役職 1 つの係数。**影響力個人中心化で保有者個人の entry に計上** §6.64a-(4) |
| polityInfluencePolityOfficeAppointmentFactor | 2 | **影響力個人中心化: office domain。polity_office_role 任命権 保有者の直接 influence（3 種任命権を揃える）** §6.64a-(4) |
| polityInfluenceMilitaryOfficeBonus | 2 | military domain: polity:military 役職保有（影響力個人中心化で個人帰属） |
| polityInfluenceRegimentControlFactor | 2 | military domain: regiment_control right 1 件（active regiment のみ。新規・小） |
| polityInfluenceHoldingOfficeAppointmentFactor | 2 | land_administration domain: holding right / 現職 bailiff（影響力個人中心化で個人帰属） |
| polityInfluenceFactionFactor | 2 | faction domain: anchor Faction leader の家（新規・小） |
| ※ 旧 polityShare* 7 種 + shareYearlyRetentionRate は v0.42c で削除（polity share 全廃） | | |
| houseShareBase | 5 | House Share 基礎値 |
| houseShareLeaderBonus | 20 | 家長への Share ボーナス |
| houseShareOfficeBonus | 10 | House 役職保有数の Share 寄与係数 |
| houseSharePrestigeFactor | 0.3 | Person legacyPrestige の Share 寄与係数 |
| houseShareWealthFactor | 0.05 | Person wealth の Share 寄与係数 |
| houseShareStatFactor | 1 | Person (admin + martial) の Share 寄与係数 |
| houseShareReputationFactor | 0.5 | **影響力個人中心化: house-tag PersonReputation 現在値合計の Share 寄与係数（0 床）** §6.64a-(5) |
| rulerHouseRebellionSuppression | 30 | 支配家への反乱抑圧ボーナス（Share 計算外） |
| **影響力個人中心化（Individual-Agency Redesign）** | | |
| houseGoalPersonalityScale | 10 | 家 goal-kind scoring に意志決定者の性格を反映する量（ambition→expand / caution→preserve・personAbilityEffectsEnabled gate） §6.64a-(6) |
| movementProjectBaseCost | 40 | 運動 Project のコスト（家 wealth から消費＝wealth sink） §6.64a-(7) |
| movementReputationPerCost | 0.2 | 運動完遂の評判 baseScore = budget × 本係数（40×0.2=8） §6.64a-(7) |
| rightInheritanceOwnerSeizeThreshold | 70 | person 保有任命権の死亡時継承: owner家 influence% ≥ 本値 → 国回収 §6.64a-(8) |
| rightInheritanceHouseRetainThreshold | 20 | 死亡者家 influence% < 本値 → 国回収（家が弱く世襲維持不能） §6.64a-(8) |
| rightInheritanceFlipChance | 0.15 | 継承判定の反転確率（主君の気まぐれ・houseless/owner家同一は skip） §6.64a-(8) |
| **POP システム** | | |
| popSystemEnabled | true | POP システム有効 |
| minPopSizeByClass | {peasants:5, townsmen:1, nobles:1} | POP size の下限（class 別、occupation:none 以外） |
| minProvinceCarryingCapacity | 50 | Province の最小 carrying capacity |
| productivityByClass | {peasants:1.0, townsmen:1.5, nobles:0.6} | POP 生産性係数（class 別） |
| manpowerFactorByClass | {peasants:0.03, townsmen:0.01, nobles:0.06} | 兵力換算係数（class 別） |
| baseMonthlyGrowthByClass | {peasants:0.008, townsmen:0.002, nobles:0.001} | 4週基本成長率（class 別） |
| populationPressureThreshold | 0.90 | pressure がこれを超えると wealth/unrest に影響 |
| populationPressureWealthPenalty | 0.2 | pressure 超過時の wealth 低下係数 |
| populationPressureUnrestGain | 0.3 | pressure 超過時の unrest 上昇係数 |
| povertyWealthThreshold | 25 | 貧困閾値（これ未満で unrest 上昇） |
| povertyUnrestGain | 0.02 | 貧困による unrest 上昇係数 |
| prosperityWealthThreshold | 70 | 繁栄閾値（これ超過で unrest 低下） |
| prosperityUnrestReduction | 0.01 | 繁栄による unrest 低下係数 |
| unrestNaturalDecayRate | 0.005 | unrest 月次自然減衰率 |
| retainedWealthGainByClass | {peasants:0.30, townsmen:0.45, nobles:0.25} | 残留富 1 に対する wealth 増加量（class 別） |
| overExtractionThreshold | 0.95 | 過剰徴収判定の回収率閾値 |
| overExtractionWealthSafeThreshold | 55 | この wealth 以上ならペナルティ回避 |
| overExtractionUnrestSafeThreshold | 45 | この unrest 以下ならペナルティ回避 |
| overExtractionWealthPenalty | 1.0 | 過剰徴収による wealth 低下係数 |
| overExtractionUnrestGain | 1.5 | 過剰徴収による unrest 上昇係数 |
| **Occupation capacity** | | |
| occupationCapacityBaseByHoldingKind | manor:{agri:80,urban:8,elite:3}, city:{agri:15,urban:70,elite:5} | Holding 種別ごとの occupation 基礎容量 |
| occupationProductivityMultiplier | {agri:1.0,urban:1.0,elite:1.0,none:0.1} | occupation 別の生産性倍率 |
| occupationManpowerMultiplier | {agri:1.0,urban:0.8,elite:1.2,none:0.5} | occupation 別の兵力倍率 |
| unemployedWealthDecayByClass | {peasants:0.20,townsmen:0.30,nobles:0.15} | none POP の 4 週あたり wealth 減衰量 |
| unemployedUnrestGainByClass | {peasants:0.20,townsmen:0.35,nobles:0.45} | none POP の 4 週あたり unrest 上昇量 |
| unemployedGrowthModifierByClass | {peasants:0.6,townsmen:0.5,nobles:0.7} | none POP の成長率倍率 |
| initialPopFillRatioMin | 70 | 初期 POP 充填率の下限（%） |
| initialPopFillRatioMax | 95 | 初期 POP 充填率の上限（%） |
| popSizeEpsilon | 0.01 | none POP がこのサイズ以下で削除 |
| **Houseless Person** | | |
| houselessPersonsPerHolding | 0.5 | holdings 数あたりの無家人物 target 比率 |
| houselessMaleRatio | 0.75 | 無家人物生成時の男性比率 |
| targetHouselessPersons | 30 | 無家人物の最低 target（holdings ベース計算の下限として使用） |
| softMaxHouselessPersons | 50 | pruning 開始の閾値（実効値は target × 1.5） |
| hardMaxHouselessPersons | 80 | 強制削減の閾値（実効値は target × 2） |
| houselessProtectionYears | 5 | 新参者の削除保護期間 |
| pruningPrestigeThreshold | 20 | この prestige 以上は削除対象外 |
| pruningWealthThreshold | 30 | この wealth 以上は削除対象外 |
| **Attitude システム** | | |
| attitudeMonthlyRetentionRate | 0.995 | 態度の月次保持率（1-rate が減衰率） |
| initialPolityLegacyPrestigeMin | 20 | Polity 初期 legacyPrestige の下限 |
| initialPolityLegacyPrestigeMax | 60 | Polity 初期 legacyPrestige の上限 |
| initialHouseLegacyPrestigeMin | 20 | House 初期 legacyPrestige の下限 |
| initialHouseLegacyPrestigeMax | 80 | House 初期 legacyPrestige の上限 |
| initialPersonLegacyPrestigeMin | 0 | Person 初期 legacyPrestige の下限 |
| initialPersonLegacyPrestigeMax | 20 | Person 初期 legacyPrestige の上限 |
| rulerHouseExtinctionPrestigeLoss | 10 | owner house 断絶時の旧 Polity legacyPrestige 低下量 |
| rulerExtinctionAnnexPrestigeWeight | 0.3 | 支配家断絶・併合時の legacyPrestige 継承重み |
| abilityAptitudeMean | 50 | aptitude ガウス生成の平均 |
| abilityAptitudeStddev | 15 | aptitude ガウス生成の標準偏差 |
| abilityHeritability | 0.5 | 両親平均 vs populationMean のブレンド比率 |
| abilityAptitudeNoiseStddev | 8 | 遺伝時のガウスノイズ標準偏差 |
| abilityInitialNoiseStddev | 3 | ability 初期値サンプル時のガウスノイズ標準偏差 |
| ageCurveLifelongMaxFraction | 0.70 | 終生成長曲線の最大到達比率 |
| ageCurveLifelongAgeConstant | 30 | 終生成長曲線の時定数 |
| ageCurveYouthMaxFraction | 0.75 | 若年期ピーク曲線の最大到達比率 |
| ageCurveYouthPeakAge | 30 | 若年期ピーク曲線のピーク年齢 |
| ageCurveYouthDeclineConstant | 40 | 若年期ピーク曲線のピーク後減衰時定数 |
| ageCurveMidLifeMaxFraction | 0.70 | 壮年期ピーク曲線の最大到達比率 |
| ageCurveMidLifePeakAge | 45 | 壮年期ピーク曲線のピーク年齢 |
| ageCurveMidLifeDeclineConstant | 60 | 壮年期ピーク曲線のピーク後減衰時定数 |
| abilityGrowthChanceBase | 100 | 成長判定の基礎確率（%、effectiveCeil との比率で減衰） |
| abilityGrowthGapFactor | 0.1 | v0.45 成長成功時の伸び幅係数 (ギャップ比例・最低 +1) |
| abilityDeclineChanceBase | 5 | 衰退判定の基礎確率（%） |
| abilityActiveDeclineMultiplier | 0.30 | 経験あり人物の衰退速度倍率（鈍化） |
| estateBaseRecoveryRate | 0.5 | 家回収率の基礎値（Share=0 のとき） |
| estateShareEffectStrength | 0.6 | 家中 Share による家回収率引き下げ強度 |
| estateRecoveryRateMin | 0.2 | 家回収率の下限 |
| estateRecoveryRateMax | 0.9 | 家回収率の上限 |
| estateSettledNormalWealthRatio | 0.2 | ESTATE_SETTLED の importance を normal に昇格させる wealth/house.wealth 閾値 |
| **Goal / Aim システム** | | |
| goalReviewIntervalWeeks | 48 | Goal レビュー間隔（週） |
| goalMinimumDurationWeeks | 144 | Goal 最低維持期間（週、3年相当） |
| goalSwitchThreshold | 20 | Goal 差し替えに必要な候補スコア差 |
| goalProgressOnAimSucceeded | 25 | Aim 成功時の Goal progress 増分 |
| goalProgressOnAimFailed | -10 | Aim 失敗時の Goal progress 変化 |
| goalProgressOnAimAbandoned | -5 | Aim 放棄時の Goal progress 変化 |
| aimDefaultDeadlineWeeks | 240 | Aim のデフォルト期限（週、5年相当） |
| aimParallelismCeiling | 4 | 1 Goal が持てる active Aim 数の静的上限（integrity invariant）。1 で並列無効=旧挙動（§6.57） |
| aimCapacityBase | 1 | 規模に依らず全 actor が得る並列 Aim 枠の基礎値 |
| aimCapacityProvincesPerSlot | 4 | terminal province がこの数ごとに Polity の並列枠 +1 |
| aimCapacityTreasuryPerSlot | 300 | treasury がこの量ごとに Polity の並列枠 +1（消費はしない・capacity 入力シグナル） |
| aimCapacityMembersPerSlot | 6 | member がこの数ごとに House の並列枠 +1 |
| aimCapacityWealthPerSlot | 150 | wealth がこの量ごとに House の並列枠 +1（消費はしない・capacity 入力シグナル） |
| promotePolicyShiftCost | 0 | promote_policy_shift のコスト（cooldown で乱発防止） |
| patronizeArtistCost | 25 | patronize_artist の House wealth コスト |
| patronizeArtistPrestigeGain | 3 | patronize_artist の legacyPrestige 上昇量 |
| commissionChronicleCost | 40 | commission_chronicle の House wealth コスト |
| commissionChroniclePrestigeGain | 5 | commission_chronicle の legacyPrestige 上昇量 |
| policyInfluenceBonusBase | 10 | steer_polity_* Aim の基礎補正量 |
| policyInfluenceBonusShareFactor | 0.5 | Share 割合ごとの追加補正係数 |
| **Task / effectivePriority システム** | | |
| effectivePriorityOwnerDutyBonus | 20 | 役職義務一致時の ownerDutyBonus |
| effectivePriorityGoalAlignmentBonus | 10 | Person Goal 一致時の goalAlignmentBonus |
| effectivePriorityUrgencyMaxBonus | 15 | deadline 超過時の urgencyBonus |
| effectivePriorityUrgencyMediumBonus | 10 | 残り 4 週以内の urgencyBonus |
| effectivePriorityUrgencySmallBonus | 5 | 残り 12 週以内の urgencyBonus |
| effectivePriorityDiplomaticTaskBonus | 10 | 外交系 Task の taskKindPriorityBonus |
| effectivePriorityOfficeDutyBonus | 5 | perform_office_duties の taskKindPriorityBonus |
| effectivePriorityOverloadThreshold | 3 | overloadPenalty 発動の active Task 数閾値 |
| effectivePriorityOverloadPenaltyPerTask | 3 | 超過 1 件あたりの overloadPenalty |
| **DiplomaticPlay Task** | | |
| diplomaticPlayStructuralProgressFactor | 0.33 | 構造的進行の弱化係数 |
| diplomaticPlayMaxActiveTasksPerSide | 2 | 各 side の同時 active Task 数上限 |
| **DiplomaticPlay supporter（v0.43）** | | |
| maxDiplomaticSupportersPerSide | 2 | DiplomaticPlay の side あたり supporter 上限 |
| diplomaticSupportJoinScoreThreshold | 40 | supporter 採用に必要な joinScore（v0.47.2 で 25→40。proximity 単独=35 では届かなくし安易な肩入れを抑制） |
| supportJoinScoreWeightPoliticalOpinion | 0.0 | joinScore: influence 加重 attitude（休眠項 — foreign polity attitude writer 不在のため） |
| supportJoinScoreWeightProximity | 0.35 | joinScore: 争点 Province への近接（隣接 terminal=100 / 同 State=50） |
| supportJoinScoreWeightMilitarySparePower | 0.25 | joinScore: 動員可能戦力の敵 primary 比（同等=50） |
| supportJoinScoreWeightTreasury | 0.1 | joinScore: treasury 正規化（1000 で満点） |
| supportJoinScoreWeightThreatContainment | 0.3 | joinScore: 敵 primary の強大さ × 近接 |
| supportJoinScoreWeightLastWarPenalty | -0.2 | joinScore: 終戦からの経過（96 週線形減衰）。penalty は負 weight |
| supportPersuasionScale | 30 | joinScore persuasion 項の最大値（v0.47.2。募集側 delegate の (charisma×0.7 + insight×0.3)/100 × scale） |
| supportRebelBackingPenalty | 40 | joinScore rebelBacking（v0.47.2。叛乱 rebel side 募集時、landed candidate への penalty。農民反乱への肩入れ忌避） |
| supportFellowRevoltBonus | 30 | joinScore rebelBacking（v0.47.2。叛乱 rebel side 募集時、popular_revolt 由来の同志叛乱国家への bonus） |
| **Appointment modifier** | | |
| appointmentTaskModifierValue | 4 | Aim/ActivityLog ベースの任官補正値 |
| appointmentTaskModifierDurationWeeks | 16 | ActivityLog 参照期間（週） |
| **PersonActivityLog** | | |
| maxActivityLogsPerPerson | 30 | person ごとの ActivityLog 保持上限 |
| **成果成長・評判（v0.44 §6.66）** | | |
| projectExperienceGainCompleted | 4.0 | Project completed の経験 |
| projectExperienceGainFailed | 2.0 | Project failed の経験 |
| projectExperienceGainCancelledMultiplier | 0.5 | cancelled = completed × progressRatio × 本係数 |
| diplomaticPlayExperienceGainSuccess | 4.0 | Play 成功側の経験 |
| diplomaticPlayExperienceGainFailure | 2.0 | Play 失敗側の経験 |
| diplomaticPlayExperienceGainStatusQuo | 2.0 | 小成功 / 小失敗の経験 |
| diplomaticPlayExperienceGainCancelledMultiplier | 0.5 | voided = failure × 本係数 |
| warExperienceGainVictory | 5.0 | War 勝者側の経験 |
| warExperienceGainDefeat | 3.0 | War 敗者側の経験 |
| warExperienceGainWhitePeace | 2.0 | 白紙和平の経験（両者） |
| warExperienceGainCancelledMultiplier | 0.5 | cancelled = defeat × 本係数（両者固定小経験） |
| experienceImmediateGrowthChancePerPoint | 12 | 経験 1 点あたりの +1 期待値（%）。floor+fractional roll |
| personReputationProjectSuccessBase | 8 | Project 正評判 baseScore |
| personReputationProjectFailureBase | -6 | Project 負評判 baseScore（本人帰責 failed のみ） |
| personReputationDiplomacySuccessBase | 10 | Play 成功評判 |
| personReputationDiplomacyStatusQuoBase | 4 | Play 小成功評判 |
| personReputationDiplomacyStatusQuoFailureBase | -3 | Play 小失敗評判（abs を負号化して使用） |
| personReputationDiplomacyFailureBase | -8 | Play 失敗評判 |
| personReputationWarVictoryBase | 12 | War 勝利評判 |
| personReputationWarDefeatBase | -8 | War 敗北評判 |
| warCommanderAwardFactor | 0.6 | captain general 比の現場指揮官係数（経験・評判共通） |
| personReputationMonthlyRetentionRate | 0.985 | 月次減衰率（0 < rate < 1 invariant） |
| personReputationCleanupThreshold | 0.25 | 現在値がこれ未満で expiry。abs(baseScore) <= threshold は作成しない |
| appointmentReputationModifierCap | 20 | raw 合算の clamp（±） |
| officeReputationScoreFactor | 0.25 | office 任用スコアへの係数（実効 ±5） |
| warCommandReputationScoreFactor | 0.75 | 指揮官選定スコアへの係数（実効 ±15） |
| personalTrainingTargetProgress | 3 | personal_training の targetProgress |
| personalTrainingDeadlineWeeks | 48 | personal_training の deadline |
| **天才 (v0.45 §6.67)** | | |
| geniusAppearanceChance | 0.01 | 人物生成 1 人あたりの天才出現率。0 で無効 |
| geniusAptitudeMin | 80 | 対応能力の天賦ロール下限 |
| geniusAptitudeMax | 120 | 対応能力の天賦ロール上限（= ABILITY_HARD_CAP） |
| geniusTypeWeightCommander | 0.4 | 名将の出現比重（3 値合計で正規化） |
| geniusTypeWeightChancellor | 0.4 | 名宰相の出現比重 |
| geniusTypeWeightUniversal | 0.2 | 万能の出現比重 |
| **代官システム** | | |
| defaultContractedRemittanceRate | 0.40 | HoldingOfficeAssignment 作成時の送金率デフォルト |
| defaultExpectedBailiffFeeRate | 0.10 | HoldingOfficeAssignment 作成時の代官取り分率デフォルト |
| minLocalExtractionRate | 0.10 | 現地徴収率の下限 |
| maxLocalExtractionRate | 0.80 | 現地徴収率の上限 |
| comfortableLocalExtractionRate | 0.35 | この totalBurdenRate 以下なら POP ペナルティなし |
| minBailiffCollectionEfficiency | 0.30 | 徴税効率の下限 |
| baseBailiffCollectionEfficiency | 0.55 | 徴税効率の基礎値 |
| bailiffStewardshipCollectionRange | 0.8 | v0.49: 代官 stewardship が徴税効率に与える振れ幅。`clamp((stew-60)/60,-0.5,1) * range` を base に加算。能力80↔40 の徴収額差を ~1.8x に |
| placeholderBailiffCollectionEfficiency | 0.40 | placeholder 代官の徴税効率 |
| collectionFrictionFactor | 0.50 | 徴税摩擦係数（未徴収分の社会的損耗率） |
| maxBailiffFeeRate | 0.25 | 代官取り分率の上限 |
| bailiffTaskCompletedCollectionModifier | 0.05 | Task completed 時の徴税効率ボーナス |
| bailiffTaskNoneCollectionModifier | 0.00 | Task none 時の徴税効率ペナルティ |
| localExtractionWealthPenalty | 2 | collectionFrictionBurdenRate × この値 × (pop.wealth/100) で POP wealth 損耗（wealth 比例） |
| localExtractionUnrestGain | 3 | burdenOverComfort × この値で POP unrest 上昇 |
| bailiffBurdenAffectionPenaltyFactor | 2 | burdenOverComfort × この値で POP→代官 affection 低下 |
| bailiffProtectResidentsAffectionBonus | 0.2 | protect_residents 時の POP→代官 affection ボーナス |
| bailiffTaskCompletedRespectGain | 0.2 | Task completed 時の POP→代官 respect ボーナス |
| bailiffAbilityRespectFactor | 0.006 | v0.49: 代官 competence(command*0.5+learning*0.5) と中立点の差 × この値で POP→代官 respect が増減（有能↑/低能力↓ = 軽蔑） |
| bailiffRespectNeutralScore | 50 | v0.49: respect 能力ドリフトの中立点（competence がこれ未満で軽蔑方向） |
| bailiffRespectMaxDelta | 1.0 | v0.49: 1回の徴税サイクルでの respectDelta clamp 幅（±） |
| **Project システム** | | |
| projectDefaultTargetProgress | 100 | Project の標準 targetProgress |
| projectAdvanceProgressSuccess | 25 | advance_project 成功時の progress 加算量 |
| projectAdvanceProgressPartial | 10 | advance_project 部分成功時の progress 加算量 |
| projectAdvanceProgressFailure | 0 | advance_project 失敗時の progress 加算量 |
| diplomaticProjectPreparationGainSuccess | 10 | 外交系 Project の preparation 加算（成功） |
| diplomaticProjectLeverageGainSuccess | 5 | 外交系 Project の leverage 加算（成功） |
| diplomaticProjectCommitmentGainSuccess | 5 | 外交系 Project の commitment 加算（成功） |
| diplomaticProjectPreparationGainPartial | 5 | 外交系 Project の preparation 加算（部分成功） |
| diplomaticProjectLeverageGainPartial | 2 | 外交系 Project の leverage 加算（部分成功） |
| diplomaticProjectCommitmentGainPartial | 2 | 外交系 Project の commitment 加算（部分成功） |
| supervisedProjectWorkloadWeight | 2 | supervisor workload 計算時の Project 重み |
| officeWorkloadWeight | 1 | supervisor workload 計算時の Office 重み |
| activeTaskWorkloadWeight | 1 | supervisor workload 計算時の active Task 重み |
| aimProgressGainLandOrContractProject | 50 | 外交系 Project 成功時の Aim progress 加算量 |
| aimProgressGainDevelopmentProject | 33 | 土地開発系 Project 完了時の Aim progress 加算量 |
| aimProgressGainPowerProject | 33 | Share/Policy 系 Project 完了時の Aim progress 加算量 |
| aimProgressGainCultureProject | 25 | 文化系 Project 完了時の Aim progress 加算量 |
| aimProgressCompletionTolerance | 1 | Aim progress が targetProgress に到達する際の許容誤差 |
| projectDeadlineWeeksDevelopment | 48 | develop_holding の base deadline（週）。実際の deadline = base × (targetProgress / 100)。Level 1=48, Level 2=96, Level 3=144 |
| projectDeadlineWeeksDiplomatic | 24 | 外交系 Project のデフォルト deadline（週） |
| prepareProjectPartialTargetProgressPenalty | 10 | prepare_project 部分成功時の targetProgress ペナルティ |
| projectCooldownWeeks | 4 | Project 着手のクールダウン（週） |
| **Task 成否判定** | | |
| taskOutcomeSuccessMargin | 20 | outcome 判定の success/partial 境界マージン |
| **HoldingImprovement / ProjectBudget** | | |
| holdingImprovementDevelopmentScorePerLevel | {field_system:4, pastoral:4, irrigation:6, market:6, workshop:6, storage:7, transport:7} | ImprovementKind ごとの level あたり development 寄与（7 種） |
| holdingImprovementMaxLevelByKind | field/pastoral/irrigation:{manor:3,city:0}, market/workshop:{manor:0,city:3}, storage/transport:{manor:3,city:3} | `Record<ImprovementKind, Partial<Record<HoldingKind, number>>>`。0/undefined = 建設不可 |
| developHoldingProjectBaseCostByImprovementKind | {field:30, pastoral:28, irrigation:35, market:35, workshop:32, storage:25, transport:30} | ImprovementKind ごとの基礎コスト（7 種） |
| developHoldingProjectBaseProgressByImprovementKind | {field:100, pastoral:100, irrigation:110, market:100, workshop:100, storage:80, transport:100} | ImprovementKind ごとの基礎 targetProgress（7 種） |
| holdingImprovementOccupationCapacityPerLevel | field:{agri:60}, pastoral:{agri:45}, irrigation:{agri:25}, market:{urban:55,elite:5}, workshop:{urban:65}, storage:{}, transport:{} | capacity 設備が level あたり生む occupation 枠。`Partial<Record<PopOccupation, number>>` |
| holdingImprovementTerrainCapacityMultiplier | kind × terrain の乗数（未定義 → 1.0、clamp なし）。例: field={plains:1.3,wetlands:0.7,hills:0.75,forest:0.5,mountains:0.25} | terrain 傾向。storage/transport は空 |
| holdingImprovementFeatureCapacityMultiplier | kind × feature の乗数（積を clamp 0.75–1.50）。例: irrigation={major_river:1.3,lake:1.2}, market={coastal:1.15,major_river:1.15,lake:1.1} | feature ボーナス。storage/transport/pastoral は空 |
| improvementLevelCostMultiplier | {1:1, 2:2, 3:4} | level ごとのコスト倍率 |
| improvementLevelProgressMultiplier | {1:1, 2:2, 3:3} | level ごとの targetProgress 倍率 |
| projectBudgetMarginMultiplier | 2 | 予算見積もり時のマージン倍率 |
| projectCompletedRespectGain | 5 | Project 完了時の supervisor への respect 上昇量 |
| developHoldingTargetDevelopmentThreshold | 40 | goalSelectors の develop_holding 候補判定閾値 |
| **Province terrain / features** | | |
| provinceTerrainSettlementSuitability | {plains:100, hills:80, forest:65, wetlands:45, mountains:35} | House seat 選定の terrain 居住適性重み（旧 habitability 最大を置換、§7.4） |
| provinceTerrainWeights | {plains:35, forest:25, hills:20, mountains:10, wetlands:10} | terrain 抽選の重み（worldgen、§7.1） |
| stateRegionDominantTerrainInheritanceChance | 0.70 | Province が StateRegion の dominantTerrain を継承する確率 |
| provinceFeatureCoastalChance | 0.50 | 外周マージン内 Province が coastal を持つ確率 |
| provinceCoastalEdgeMarginRatio | 0.12 | 外周マージン比（mapConfig.worldMapWidth/Height に乗算）。内陸では coastal draw を消費しない |
| provinceFeatureMajorRiverBaseChance | 0.15 | major_river の基礎確率（terrain delta 加算後 clamp01 して draw） |
| provinceFeatureMajorRiverTerrainDelta | {plains:0.10, wetlands:0.10, mountains:-0.10} | major_river の terrain 補正（`Partial<Record<ProvinceTerrain, number>>`） |
| provinceFeatureLakeBaseChance | 0.06 | lake の基礎確率 |
| provinceFeatureLakeTerrainDelta | {wetlands:0.05, plains:0.05} | lake の terrain 補正 |
| **ProjectStage / Pressure** | | |
| projectStageMaxAttempts | 3 | preparatory stage の failure 連続上限。超過で Project failed |
| pressureResponseDefaultDeadlineWeeks | 48 | respond_to_pressure Project の DiplomaticPlay 不在時 fallback deadline（1年 = 48週） |
| **Offer-driven Negotiation** | | |
| taxRevisionInitialDemandDelta | 0.10 | 税率改定の初期要求 delta（旧 `taxRevisionTaxChangeAmount` を置換） |
| taxRevisionReservationDelta | 0.05 | 税率改定の reservation delta |
| taxRevisionMaxDemandDelta | 0.15 | 税率改定の最大要求 delta |
| taxRevisionCompensationYears | 3 | 税率改定補償金の算出年数 |
| invalidOfferTensionDelta | 10 | invalid offer 時の tension 上昇量 |
| rejectedOfferTensionDelta | 8 | rejected offer 時の tension 上昇量 |
| validOfferProgressDelta | 5 | valid offer 提出時の progress 増分 |
| counterOfferProgressDelta | 15 | counterOffer（propose_initial_offer stage）の progress 増分 |
| offerCompromiseProgressDelta | 15 | offer_compromise Task 成功時の progress 増分（旧 progressGainMedium を置換） |
| negotiateTermsProgressDelta | 8 | negotiate_terms Task 成功時の progress 増分（旧 progressGainMedium を置換） |
| debugMixedProvinceHoldingsRatio | 0 | worldgen 後に mixed holdings を生成する Province の割合（0 = disabled） |
| **House Founding** | | |
| houseFoundingEnabled | true | House 創設システム有効 |
| houseFoundingIntervalWeeks | 4 | HouseFoundingSystem の実行間隔（週） |
| houseFoundingMinWealth | 120 | 創設候補の最小 wealth |
| houseFoundingMinPrestige | 45 | 創設候補の最小 legacyPrestige |
| houseFoundingMinActivityLogs | 3 | 創設候補の最小 ActivityLog 数 |
| houseFoundingMonthlyChance | 0.02 | 創設確率（月あたり）。自力設立を絞り極小家の量産を抑制（baseBirthChance 増とセット） |
| houseFoundingMaxPerMonth | 1 | 月あたりの最大創設数（同上） |
| houseFoundingWealthTransferRate | 0.5 | founder → House への wealth 移転率 |
| **Founder Family Generation** | | |
| founderFamilyGenerationEnabled | true | 創設時の家族後付け生成有効 |
| founderSpouseChanceYoung | 0.2 | 若年 founder の配偶者生成確率 |
| founderSpouseChanceMid | 0.7 | 中年 founder の配偶者生成確率 |
| founderSpouseChanceOld | 0.85 | 高齢 founder の配偶者生成確率 |
| founderChildBaseChance | 0.6 | 子供生成の基礎確率 |
| founderMaxGeneratedChildren | 4 | 最大生成子供数 |
| **Influential House** | | |
| influentialHousePolityInfluenceThreshold | 0.10 | 有力家門判定の Influence 比率閾値（v0.42: 旧 influentialHousePolityShareThreshold — 入力を share% から influence% に差替） |
| influentialHouseWealthThreshold | 200 | 汎用有力家門判定の wealth 閾値 |
| influentialHouseLegacyPrestigeThreshold | 60 | 汎用有力家門判定の legacyPrestige 閾値 |
| **Clan Formation** | | |
| clanFormationIntervalWeeks | 48 | ClanFormationSystem の実行間隔（週、年 1 回） |
| clanFormationMinDirectCadetHouses | 3 | Clan 成立に必要な active direct cadet 数 |
| clanFormationMinInfluentialHouses | 2 | Clan 成立に必要な有力家門数（影響力条件） |
| clanFormationMinTotalLivingMembers | 30 | 量的条件: formation group の最小生存メンバー数 |
| clanFormationMinTotalWealth | 500 | 量的条件: formation group の最小 wealth 合計 |
| clanFormationMinTotalLegacyPrestige | 150 | 量的条件: formation group の最小 legacyPrestige 合計 |
| **LifeStage** | | |
| lifeStageTransitionAges | （下記） | 遷移先ごとの `{ minAge, standardAge, maxAge }`。adolescence `{8,11,12}` / young_adulthood `{16,19,20}` / mature_adulthood `{32,36,40}` / old_age `{55,60,65}` |
| lifeStageTransitionChanceEarly | 0.20 | `minAge <= age < standardAge` 区間の遷移確率 |
| lifeStageTransitionChanceStandard | 0.50 | `standardAge <= age < maxAge` 区間の遷移確率（`age >= maxAge` は必ず遷移） |
| lifeStageParentInfluenceRateByStage | childhood:0.08, adolescence:0.04 | 親からの Attitude 継承率（LifeStage 別） |
| lifeStageHouseLeaderInfluenceRateByStage | childhood:0.03, adolescence:0.04 | 家 leader からの継承率 |
| lifeStageHouseAdultInfluenceRateByStage | childhood:0.01, adolescence:0.02 | 同家成人からの継承率 |
| lifeStageParentFactionInfluenceRateByStage | childhood:0.01, adolescence:0.03 | 親 faction member からの継承率 |
| maxLifeStageInfluencersPerChild | 5 | 子 1 人あたりの influencer 合計上限（種別個別上限は持たない。father/mother 優先） |
| maxAttitudeTargetsInheritedPerInfluencer | 3 | influencer ごとに継承する target 上限（person/house のみ。polity は継承しない） |
| parentalAbilityGrowthChanceBonus | 2.0 | childhood/adolescence で living 親能力が子より高い時、成長 `gainChance` への加算（percentage point） |
| oldAgeAppointmentScorePenalty | 5 | old_age の appointment / delegate 候補スコアへの固定減算（負スコア対策で乗算でなく減算） |
| oldAgeCommandScoreMultiplier | 0.8 | old_age の commander / captain general 選定スコアへの乗算（候補除外はしない。0 不可） |

| **bootstrap / 共通** | | |
| uiLocale | en | UI 表示ロケール |
| nameCultureId | western | 人物名生成の文化 ID |
| integrityPerSystem | false | system ごとに IntegrityCheck を走らせるデバッグフラグ |
| minLivingMembersPerHouse | 4 | House が維持すべき最小生存メンバー数 |
| maxNewPersonsPerHousePerYear | 2 | House あたりの年間新規人物生成上限 |
| replacementThreshold | 15 | 欠員補充の判定閾値 |
| allowFemaleHouseHeadWhenNoMaleHeir | true | 男性後継者不在時に女性当主を許可 |
| allowFemaleRolesWhenNoMaleCandidate | false | 適格候補不在時の ungated 再試行（女性許可）。v0.7 宣言・v0.45.3 初配線、default true→false（true だと fallback が支配経路になり「非常に稀」が成立しない） |
| femaleRoleEligibilityChance | 0.03 | v0.45.3 性別役職適格ゲート: 女性のうち役職（office/代官/指揮官/派閥首領/supervisor）適格となる割合。personId 決定論 hash（§6.19） |
| occupationWeights | {adventurer:1.5,merchant:1.5,scholar:1,mercenary:1.5,scribe:1,priest:1,physician:0.8,jurist:0.7,wanderer:1} | 在野人物 background occupation の抽選重み |
| **Succession weights** | | |
| prestigeSuccessionWeight | 1 | 継承スコア: legacyPrestige の重み |
| adminSuccessionWeight | 2 | 継承スコア: admin の重み |
| martialSuccessionWeight | 1 | 継承スコア: martial の重み |
| ambitionSuccessionWeight | 10 | 継承スコア: ambition の重み |
| randomSuccessionNoiseMax | 10 | 継承スコアに加えるランダムノイズの最大値 |
| illegitimateSuccessionPenalty | 20 | 庶出への継承スコアペナルティ |
| unknownBirthStatusSuccessionPenalty | 10 | 出自不明への継承スコアペナルティ |
| **House Split / Extinction（補遺）** | | |
| houseSplitControlMultiplier | 0.7 | 分裂時の houseControl 乗数 |
| houseExtinctionEnabled | true | 家断絶システム有効 |
| inheritedProvinceHouseControl | 35 | 断絶継承された Province の初期 houseControl |
| rulerHouseExtinctionEnabled | true | 支配家断絶処理の有効/無効 |
| annexByRulerExtinctionCountryControl | 30 | 支配家断絶併合後の Province polityControl |
| rulerExtinctionAnnexSharedBorderWeight | 20 | 支配家断絶併合先選定: 共有国境の重み |
| rulerExtinctionAnnexPowerWeight | 0.5 | 支配家断絶併合先選定: 軍事力の重み |
| **DiplomaticPlay 基盤 / Task** | | |
| diplomaticPlaySettlementThreshold | 60 | DiplomaticPlay 解決閾値（tension） |
| diplomaticPlayEscalationThreshold | 40 | DiplomaticPlay エスカレーション閾値（tension） |
| diplomaticPlayBaseTensionGain | 5 | DiplomaticPlay 基礎 tension 増加量 |
| diplomaticPlayStructuralPowerWeight | 0.7 | 構造的パワーの重み |
| diplomaticPlayAdvantageWeight | 0.3 | 優勢度の重み |
| diplomaticPlayDelegateSkillImpactMax | 10 | delegate スキルが進行に与える最大影響 |
| diplomaticPlayRandomnessMax | 5 | DiplomaticPlay Task の noise 上限 |
| diplomaticPlayTaskLeverageGainSmall | 8 | Task: leverage 小幅増分 |
| diplomaticPlayTaskLeverageGainMedium | 15 | Task: leverage 中幅増分 |
| diplomaticPlayTaskCommitmentGainMedium | 15 | Task: commitment 中幅増分 |
| diplomaticPlayTaskProgressGainMedium | 10 | Task: progress 中幅増分 |
| diplomaticPlayTaskTensionGainMedium | 10 | Task: tension 中幅増加 |
| diplomaticPlayTaskTensionReductionSmall | 5 | Task: tension 小幅低減 |
| diplomaticPlayTaskOpponentPressureGainMedium | 12 | Task: 相手 pressure 中幅増加 |
| diplomaticPlayTaskOpponentLeverageReductionSmall | 8 | Task: 相手 leverage 小幅低減 |
| diplomaticPlayTaskUndermineFailTensionGain | 12 | undermine 失敗時の tension 増加 |
| **Revolt negotiation / settlement** | | |
| revoltNegotiationDurationWeeks | 48 | revolt_negotiation の交渉期間（週） |
| revoltAcceptRebelPowerFactor | 0.1 | 反乱側 power の受諾判定係数 |
| revoltAcceptSuppressionFactor | 0.05 | 鎮圧力の受諾判定係数 |
| revoltConcessionSeverityMinor | 10 | 小規模譲歩の severity |
| revoltConcessionSeverityMajor | 25 | 大規模譲歩の severity |
| revoltNegotiationEnvFactor | 0.08 | revolt_negotiation 環境補正係数 |
| revoltNegotiationSettlementPrepWeight | 0.15 | settlement: preparation の重み |
| revoltNegotiationSettlementLeverageWeight | 0.1 | settlement: leverage の重み |
| revoltNegotiationEscalationCommitmentWeight | 0.15 | escalation: commitment の重み |
| revoltSettlementMainUnrestReduction | 30 | 和解: 主導 Province の unrest 低下量 |
| revoltSettlementOtherUnrestReduction | 8 | 和解: その他 Province の unrest 低下量 |
| revoltSettlementTreasuryCostMinor | 50 | 小規模和解の treasury コスト |
| revoltSettlementTreasuryCostMajor | 150 | 大規模和解の treasury コスト |
| revoltSuppressedMainUnrestReduction | 35 | 鎮圧: 主導 Province の unrest 低下量 |
| revoltSuppressedOtherUnrestReduction | 10 | 鎮圧: その他 Province の unrest 低下量 |
| revoltSuppressedDevelopmentDamage | 4 | 鎮圧: Province 荒廃量 |
| revoltSuppressedWealthPenalty | 8 | 鎮圧: 反乱 POP wealth 低下量 |
| **popular_tax_relief / Holding 反乱傾向** | | |
| minPopularDemandTaxRate | 0.05 | popular_tax_relief 要求発生の最小税率 |
| popularTaxReliefDemandDelta | 0.1 | popular_tax_relief の要求 delta |
| taxReliefSeverityFactor | 200 | popular_tax_relief の severity 係数 |
| popularTaxReliefTermsProtectionWeeks | 192 | 減税合意後の再要求保護期間（週） |
| taxBurdenWeight | 80 | 徴税負担の反乱傾向加算重み |
| recentTaxIncreaseWeight | 30 | 直近増税の反乱傾向加算重み |
| recentTaxIncreaseDecayWeeks | 96 | 直近増税傾向の減衰期間（週） |
| recentSuppressionCooldownWeeks | 96 | 直近鎮圧の傾向抑制期間（週） |
| recentSuppressionTendencyReduction | 40 | 直近鎮圧による反乱傾向低減量 |
| **TaxRevisionSystem** | | |
| taxRevisionSystemEnabled | true | TaxRevisionSystem 有効 |
| taxRevisionTreasuryThreshold | 300 | 改定判断: treasury 不足閾値 |
| taxRevisionTreasuryNeedFactor | 0.05 | 改定判断: treasury 需要係数 |
| taxRevisionLowUnrestFactor | 0.5 | 改定判断: 低 unrest 係数 |
| taxRevisionUnrestSafeThreshold | 30 | 改定判断: 安全 unrest 閾値 |
| taxRevisionHighUnrestPenalty | 0.8 | 改定判断: 高 unrest ペナルティ |
| taxRevisionUnrestDangerThreshold | 50 | 改定判断: 危険 unrest 閾値 |
| taxRevisionHighTaxThreshold | 0.35 | 改定判断: 高税率閾値 |
| taxRevisionHighTaxPenalty | 1 | 改定判断: 高税率ペナルティ |
| taxRevisionAmbitionFactor | 15 | 改定判断: ambition 係数 |
| taxRevisionCautionPenalty | -20 | 改定判断: caution ペナルティ |
| taxRevisionInsightPenalty | -10 | 改定判断: insight ペナルティ |
| taxRevisionWarBonus | 10 | 改定判断: 戦時ボーナス |
| taxRevisionDecisionThreshold | 15 | 改定発動の決定閾値 |
| taxRevisionMinDelta | 0.02 | 改定の最小 delta |
| taxRevisionMaxDelta | 0.05 | 改定の最大 delta（system 自律改定） |
| taxRevisionSystemMaxRate | 0.6 | system 自律改定の上限税率 |
| taxRevisionCooldownWeeks | 96 | 改定クールダウン（週） |
| taxRevisionRecentRevoltPenalty | 30 | 直近反乱による改定抑制ペナルティ |
| taxRevisionRecentRevoltDecayWeeks | 96 | 直近反乱抑制の減衰期間（週） |
| **contract_tax_revision Intent** | | |
| taxRevisionIntentEnabled | true | contract_tax_revision Intent 有効 |
| taxRevisionMinRateForReduction | 0.15 | 減税要求の最小現行税率 |
| taxRevisionMaxRateForIncrease | 0.6 | 増税要求の最大現行税率 |
| taxRevisionMinTreasury | 200 | contract_tax_revision の最小 treasury |
| taxRevisionMaxIntentsPerActor | 2 | actor あたりの最大同時 Intent 数 |
| taxRevisionNegotiationDurationWeeks | 48 | contract_tax_revision の交渉期間（週） |
| taxRevisionMinRate | 0.05 | 改定後税率の下限 |
| taxRevisionMaxRate | 0.8 | 改定後税率の上限 |
| taxRevisionPressureFactor | 0.08 | 受諾判定: pressure 係数 |
| taxRevisionResistFactor | 0.1 | 受諾判定: resist 係数 |
| taxRevisionProvinceValueFactor | 0.15 | 受諾判定: Province 価値係数 |
| taxRevisionRateImbalanceFactor | 50 | 受諾判定: 税率不均衡係数 |
| taxRevisionInitialProgressOnAdvantage | 10 | 優勢時の初期 progress |
| taxRevisionInitialTensionOnPressure | 10 | 圧力時の初期 tension |
| taxRevisionGracePeriodYears | 5 | 改定後の再改定猶予年数 |
| **land_claim / acquire_land Intent** | | |
| claimOfferedPriceFactor | 0.05 | land_claim 受諾: 提示価格係数 |
| claimInitiatorPressureFactor | 0.1 | land_claim 受諾: initiator power 係数 |
| claimDefenderResistFactor | 0.12 | land_claim 受諾: defender power 抵抗係数 |
| claimProvinceValueFactor | 0.3 | land_claim 受諾: Province 価値係数 |
| claimStrategicLossFactor | 0.2 | land_claim 受諾: 戦略的損失係数 |
| claimPrestigeLossFactor | 0.2 | land_claim 受諾: prestige 損失係数 |
| landClaimNegotiationDurationWeeks | 72 | land_claim の交渉期間（週） |
| landClaimInitialProgressOnConsent | 20 | 購入条件成立時の初期 progress |
| landClaimInitialTensionOnPressure | 15 | 圧力 Intent 時の初期 tension |
| acquireLandIntentEnabled | true | acquire_land Intent 有効 |
| acquireLandMinTreasury | 200 | acquire_land の最小 treasury |
| acquireLandMaxIntentsPerActor | 1 | actor あたりの最大同時 acquire_land Intent 数 |
| **汎用 conflict** | | |
| conflictResolutionEnabled | true | 汎用 conflict 解決有効 |
| maxConflictsResolvedPerTick | 5 | 1 tick あたりの conflict 解決上限 |
| conflictLoserTreasuryDamageFactor | 0.4 | 敗者 treasury 損失係数 |
| conflictProvinceDevastation | 4 | conflict による Province 荒廃量 |
| conflictPopWealthDamage | 4 | conflict による POP wealth 低下量 |
| conflictPopUnrestGain | 12 | conflict による POP unrest 上昇量 |
| defaultPopularRevoltWarScore | 10 | popular_revolt goal の requiredWarScore |
| **Local Levy / Battlefield frontage** | | |
| localLevyPeasantFactor | 0.3 | 現地徴兵: peasants 係数 |
| localLevyTownsmenFactor | 0.5 | 現地徴兵: townsmen 係数 |
| localLevyNobleFactor | 1 | 現地徴兵: nobles 係数 |
| localLevyMinStrength | 10 | 現地徴兵 Regiment の最小 strength |
| localLevyMaxStrength | 60 | 現地徴兵 Regiment の最大 strength |
| localLevyBasePowerFactor | 0.3 | 現地徴兵の basePower 係数 |
| localLevyOrganization | 30 | 現地徴兵 Regiment の初期 organization |
| localLevyMorale | 30 | 現地徴兵 Regiment の初期 morale |
| battlefieldFrontageByKind | {open_field:5,coastal_battle:4,hill_battle:3,forest_battle:2,wetland_battle:2,river_crossing:2,mountain_pass:1,siege:1} | BattlefieldKind ごとの frontage（同時交戦できる連隊数） |
| **weeklyActionCapacity** | | |
| weeklyActionCapacityBase | 2 | 週次行動キャパシティの基礎値 |
| weeklyActionCapacityAmbitionBonus | 0.5 | 高 ambition のキャパシティ加算 |
| weeklyActionCapacityAgeReduction | 0.5 | 高齢のキャパシティ減算 |
| weeklyActionCapacityAmbitionThreshold | 0.7 | ambition ボーナス発動閾値 |
| weeklyActionCapacityAgeThreshold | 60 | 年齢ペナルティ発動閾値 |
| **Task action economy** | | |
| taskActionCostLight | 0.5 | light Task の action コスト |
| taskActionCostNormal | 1 | normal Task の action コスト |
| taskActionCostHeavy | 1 | heavy Task の action コスト |
| taskEffortRequiredLight | 2 | light Task の所要 effort |
| taskEffortRequiredNormal | 3 | normal Task の所要 effort |
| taskEffortRequiredHeavy | 4 | heavy Task の所要 effort |
| **Person Goal / Aim cadence** | | |
| personGoalReviewIntervalWeeks | 48 | Person Goal レビュー間隔（週） |
| personAimReviewIntervalWeeks | 4 | Person Aim レビュー間隔（週） |
| personAimDeadlineObtainOffice | 96 | obtain_office Aim の期限（週） |
| personAimDeadlineRetainOffice | 48 | retain_office Aim の期限（週） |
| personAimDeadlineDefault | 96 | Aim のデフォルト期限（週） |
| wealthAccumulationThreshold | 50 | wealth 蓄積 Aim の判定閾値 |
| goalProgressOnPersonAimSucceeded | 15 | Person Aim 成功時の Goal progress 増分 |
| goalProgressOnPersonAimFailed | -5 | Person Aim 失敗時の Goal progress 変化 |
| **Faction lifecycle / patronage** | | |
| factionFormationThreshold | 5 | Faction 結成の viability 閾値 |
| factionFounderShareRank | 3 | founder に必要な Share ランク |
| factionDisbandThreshold | 1.5 | Faction 解散の viability 閾値 |
| factionDisbandWealthFloor | 10 | 解散判定の wealth 下限 |
| minimumFactionFounderWealth | 50 | founder の最小 wealth |
| initialFactionMemberMax | 3 | 結成時の初期メンバー上限 |
| minimumInitialFactionMembers | 1 | 結成に必要な初期メンバー数 |
| minimumFactionMembers | 2 | Faction 維持に必要な最小メンバー数（cap 下限も兼ねる） |
| factionHardCap | 7 | member cap の上限（WI-1・スノーボール上限） |
| factionCapMeritFloor | 30 | cap meritSeats 算入の role-score 下限（これ未満は 0 席） |
| factionCapMeritDivisor | 15 | cap meritSeats: (bestRole − floor) を割る席化係数 |
| factionViabilityMemberCountWeight | 0.5 | viability: メンバー数の重み |
| factionViabilityOfficeHolderWeight | 1 | viability: 役職保有者の重み |
| factionViabilityWealthWeight | 0.5 | viability: wealth の重み |
| officeOpportunityRoleWeights | {administrator:1,treasurer:1,military:1,advisor:0.75} | OfficeRole ごとの opportunity score 重み |
| baseFactionRecruitmentCost | 30 | 勧誘の基礎コスト |
| factionRecruitmentPrestigeCostFactor | 0.5 | 勧誘コスト: prestige 係数 |
| factionRecruitmentAbilityCostFactor | 1 | 勧誘コスト: 能力係数 |
| factionRecruitmentSigningBonusRate | 0.3 | 勧誘時の signing bonus 率 |
| recruitmentInitialAffection | 20 | 勧誘成立時の初期 affection |
| recruitmentInitialRespect | 10 | 勧誘成立時の初期 respect |
| recruitmentTalentWeight | 1.0 | WI-0(a): 募集スコアの bestRoleScore 比重（旧 0.3 固定） |
| recruitAttractivenessPowerWeight | 1.0 | WI-0(b): 募集順序 attractiveness の patronPower 重み |
| recruitAttractivenessMeritWeight | 2.0 | WI-0(b): 同 leader 才能の重み（merit を load-bearing にする主役） |
| recruitAttractivenessPrestigeWeight | 0.5 | WI-0(b): 同 leader prestige の重み |
| factionCrossHouseBaseIdleYears | 8 | WI-2: housed 無役が他家派閥募集に解禁されるまでの基礎待機年数 |
| factionCrossHouseAmbitionReduction | 0.5 | WI-2: 待機閾値の野望短縮係数（threshold = base × (1 − reduction × ambition)） |
| factionCollapseSuccessionEnabled | true | WI-3 崩壊1: 不完全な継承（跡継ぎへの低忠誠 member 離散）の toggle |
| factionCollapseOverreachEnabled | false | WI-3 崩壊2: 過伸長離脱加速の toggle（succession と組むと entrenchment するため既定 OFF・nesting 後再評価） |
| factionCollapseRivalEnabled | false | WI-3 崩壊3: rival 闘争の toggle（measure-first・未構築のフラグ予約） |
| factionSuccessionScatterThreshold | 0.35 | WI-3 崩壊1: scatterScore = ambition×(1−loyalty)×(0.5+talent) がこれ超で離散 |
| factionOverreachDefectionWeight | 1.0 | WI-3 崩壊2: 離脱確率乗数 (1 + weight×(1−placementRatio)) |
| factionAmbitionDefectionWeight | 1.0 | WI-3 崩壊2: 離脱確率乗数 (1 + weight×ambition) |
| factionNestingMinAgeYears | 6 | 入れ子形成: 傘下入りを検討する前の最小存続年数 |
| factionNestingMaxBranches | 3 | 入れ子形成: 1 親が直接持てる子派閥の最大数 |
| factionNestingMaxDepth | 2 | 入れ子形成: 木の最大深さ (root=0) |
| factionNestingNpDiscount | 0.5 | 入れ子消費 (Phase 2-b): 子孫メンバーの NP/候補寄与の深さあたり減衰率 |
| factionNominationPowerThreshold | 0.3 | 推挙に必要な power 閾値 |
| factionOwnerHouseNominationBonus | 0.3 | 支配家メンバー推挙ボーナス |
| factionBailiffNominationWeight | 0.4 | bailiff 推挙の重み |
| factionalAppointmentScoreScale | 100 | 派閥的任命スコアのスケール |
| factionDonationRate | 0.1 | メンバー → Faction の寄付率 |
| factionDonationPersonalReserve | 20 | 寄付時に手元へ残す reserve |
| factionDonationAffectionGain | 2 | 寄付による affection 上昇 |
| factionDonationRespectGain | 1 | 寄付による respect 上昇 |
| factionDonationAffectionGainSmall | 1 | 小額寄付による affection 上昇 |
| factionStipendBase | 5 | メンバーへの stipend 基礎額 |
| factionLeaderReserveWealth | 30 | leader が stipend 支給時に残す reserve |
| factionStipendAffectionGain | 1 | stipend 支給による affection 上昇 |
| factionStipendRespectGain | 1 | stipend 支給による respect 上昇 |
| factionStipendShortageAffectionPenalty | 2 | stipend 不足時の affection ペナルティ |
| factionStipendShortageRespectPenalty | 1 | stipend 不足時の respect ペナルティ |
| factionDefectionGraceYears | 8 | idle メンバー離脱の猶予年数 |
| factionDefectionProbPerYear | 0.07 | idle メンバーの年次離脱確率 |
| factionDefectionAttitudeAffectionPenalty | 2 | 離脱時の affection ペナルティ |
| factionDefectionAttitudeRespectPenalty | 1 | 離脱時の respect ペナルティ |
| **House surplus / Office terms / 兼任互換** | | |
| houseWealthReserveTarget | 100 | House 余剰分配の reserve 目標 |
| houseSurplusDistributionMonthlyRate | 0.015 | House 余剰の月次分配率 |
| officeTermYears | {polity:{administrator:4,treasurer:4,military:3,advisor:3},house:{administrator:4,treasurer:4,military:3,advisor:3}} | Polity / House 役職の任期（OfficeRole 別、年） |
| provinceOfficeTermYears | {bailiff:3} | Province 役職（bailiff）の任期（年） |
| compatibleOfficePenalty | 2 | 互換役職兼任のペナルティ |
| incompatibleOfficePenalty | 10 | 非互換役職兼任のペナルティ |
| compatibleShareReductionMax | 0.5 | 互換役職兼任時の Share ペナルティ軽減上限 |
| pruningMinDwellYears | 3 | pruning 対象外となる最小在籍年数 |
| protectionPrestigeThreshold | 60 | pruning 保護となる prestige 閾値 |
| **LandContract / Bailiff economy** | | |
| politySurplusDistributionRate | 0.15 | 余剰分配率（OfficeCompensation 控除後） |
| polityTreasuryReserveBase | 50 | Polity treasury リザーブ基礎値 |
| polityTreasuryReservePerHolding | 50 | Holding あたりのリザーブ加算 |
| bailiffAppointmentInterval | 6 | BailiffAppointment 起動間隔（ScheduledSystem 月数） |
| bailiffMinAge | 16 | bailiff 候補の最小年齢 |
| rebelLeaderAgeRange | [20,50] | 反乱 leader の年齢範囲 [min, max] |
| institutionalPowerFloorByRank | {1:0,2:0,3:10,4:20,5:15} | rank 別 institutionalPower 下限（rank ≥ 4 が消滅しない） |
| taxFlowEfficiency | 1 | chain 上納（LandRevenue）の徴税効率倍率 |
| purchaseBuyerTreasuryThreshold | 1500 | 買い手 Polity の購入提案 treasury 閾値 |
| purchaseSellerTreasuryThreshold | 800 | 売り手 Polity の売却受諾 treasury 閾値 |
| purchasePriceBase | 500 | 1 Province の購入価格基礎値 |
| purchasePriceDevelopmentFactor | 30 | 購入価格の development 係数 |
| purchaseAttemptChance | 0.1 | 買い手 Polity の年次購入試行確率 |
| **共和国整備（v0.46 §6.68）** | | |
| republicInitialAdministratorSlots | 1 | 建国式（RepublicInit）で seed する administrator slot 数 |
| republicInitialTreasurerSlots | 1 | 同 treasurer slot 数 |
| republicInitialMilitarySlots | 1 | 同 military slot 数 |
| republicInitialAdvisorSlots | 1 | 同 advisor slot 数（大規模化は将来） |
| republicGrantInitialPersonalRights | true | seed した非 leader holder に personal `polity_office_role` right を grant するか |
| republicLeaderTermYears | 4 | 任期制 leader の任期年数（OfficeAssignment.startYear からの経過年で election） |
| republicDominantHolderThreshold | 60 | UI で top holder を「支配的」と視覚強調する topPercent 閾値（event 発火には使わない） |
| republicCandidateMinAffection | -50 | 候補列挙の除外閾値: 対象 Polity への affection がこれ以下なら候補から外す |
| republicCandidateMaxWorkload | 3 | 候補列挙の workload 上限（getPersonProjectWorkload） |
| republicCandidatePrestigeFactor | 0.3 | scoring: legacyPrestige 係数（仮値・バランス調整で再較正） |
| republicCandidateWealthFactor | 0.02 | scoring: wealth 係数（wealthCap で頭打ち後に乗算） |
| republicCandidateWealthCap | 500 | scoring: wealth の頭打ち値 |
| republicCandidateAttitudeFactor | 0.1 | scoring: 対象 Polity への affection 係数 |
| republicOfficeExperienceBonus | 10 | scoring: 当該 polity の office を 1 つでも持つ候補への加点 |
| republicHouselessFounderBonus | 8 | scoring: 無家人材への加点（寡頭化前夜の功臣プール） |
| republicLandlessHouseMemberBonus | 5 | scoring: landless House member への加点 |
| republicWorkloadPenaltyFactor | 4 | scoring: workload 1 あたりの減点 |
| republicAcquireRightBaseBonus | 15 | obtain_office / acquire_political_right が共和国を target にするときの加点（Phase C 競争 pull） |
| republicLeaderIncumbencyBonus | 15 | 任期 election の現職加点（incumbency） |
| republicLeaderFatiguePerYear | 3 | 現職の在任年数 × この値を incumbency から減算（終身 leader 防止） |

---

## プレイスタイル別 config レシピ

### 女性多め + 女性の役職制限なし（v0.45.4）

デフォルトとは逆に、女性が多数派で女性も自由に役職に就く世界。runtime override（`--config`）で指定する:

```json
{
  "maleBirthChance": 0.3,
  "adultMaleShortageThreshold": 0,
  "houselessMaleRatio": 0.5,
  "femaleRoleEligibilityChance": 1,
  "allowFemaleRolesWhenNoMaleCandidate": true
}
```

- `adultMaleShortageThreshold: 0` が必須 — 残すと男性不足コントローラが `maleBirthChance` を引き戻す（§6.10）
- `femaleRoleEligibilityChance: 1` で全女性が役職適格、性別役職適格ゲート（§6.19）が実質無効化
- worldgen 初期世界は defaultConfig（男性多め）のままなので、女性多数派へは runtime 出生で徐々に drift する（150 年程度で成人女性 > 男性に到達）
- 当主・君主の男子優先は別レバー `allowFemaleHouseHeadWhenNoMaleHeir`（既存）。継承法（サリカ法 等）の本格対応は将来構想（§13）

