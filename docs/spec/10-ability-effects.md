# 10. 人物能力効果（派生 selector ベース）

`personAbilityEffectsEnabled` が false の場合、全関数は中立値（倍率 1.0、ボーナス 0）を返す。

各効果計算は `getRoleScore(state, p.id, role) / 10` を `0..10` スケールに正規化して入力する。効果ごとに参照する role は次のとおり。

| 効果 | 入力 |
|---|---|
| chancellor effect | `getRoleScore(state, p.id, 'governance') / 10` |
| treasurer effect | `getRoleScore(state, p.id, 'stewardship') / 10` |
| general effect | `getRoleScore(state, p.id, 'warCommand') / 10` |

### 10.1 正規化関数

```ts
normalizedStat(value: number): number   // (value - 5) / 5  → -1.0 (=0) .. 0 (=5) .. +1.0 (=10)
                                        // 入力は getRoleScore(state, id, role) / 10
normalizedTrait(value: number): number  // value - 0.5      → -0.5 (trait=0.0) .. 0 (trait=0.5) .. +0.5 (trait=1.0)
```

### 10.2 Trait の解釈（価値中立な軸）

| Trait | 低値（0.0側） | 高値（1.0側） |
|---|---|---|
| ambition | 忠実・現状維持 | 野心的・栄光志向 |
| caution | 大胆・即断 | 慎重・堅実 |

どちらの極も状況によって有利・不利が生じる。

### 10.3 ControlSystem への効果

**Polity administrator（Chancellor）→ polityControl**:
```ts
growthModifier = 1 + normalizedStat(admin) * chancellorAdminControlGrowthEffect
maxControlBonus = (admin - 5) * chancellorAdminControlMaxBonusPerAdmin
```

control 効果は `getFirstActiveLivingOfficeHolder` で得た最初の生存役職保持者の governance 由来スコアを使う（単一保持者。複数担当者の集約は行わない）。

**家長（house:leader）→ houseControl**:
```ts
growthModifier = 1 + normalizedStat(admin) * houseHeadAdminControlGrowthEffect
maxControlBonus = (admin - 5) * houseHeadAdminControlMaxBonusPerAdmin
```

支配力上限は二段階 clamp:
```ts
baseMaxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
maxControl     = clamp(baseMaxControl + maxControlBonus, controlAbilityMinimumFloor, 100)
// 首都 / 本拠地は 100 固定
```

### 10.4 LandRevenue / PolitySurplus への効果

**Polity treasurer → 国庫税収効率**:
```ts
taxEfficiency = clamp(
  1 + normalizedStat(admin) * treasurerAdminTaxEfficiencyEffect
    + normalizedTrait(caution) * treasurerCautionTaxEfficiencyEffect,
  treasurerTaxEfficiencyMin,
  treasurerTaxEfficiencyMax,
)
// 国庫収入 *= taxEfficiency。家収入・POP wealth への影響なし
```

**Polity treasurer → Polity土地開発コスト**（`calcTreasurerDevelopmentCostModifier`、現状未参照（将来の活用余地として保持））:
```ts
costModifier = 1 - normalizedStat(admin) * treasurerAdminDevelopmentCostEffect
effectiveCost = max(1, round(polityLandDevelopmentBaseCost * costModifier))
```

### 10.5 War / Battle への効果

**Polity military（General）→ 戦闘力**:
```ts
warPowerModifier = 1 + normalizedStat(martial) * generalMartialWarPowerEffect
// 攻撃側・防衛側それぞれ独立して適用
```

**Polity military → 宣戦閾値**（`calcGeneralDeclareThreshold`。v0.42 で WarCreationSystem §6.44 の開戦ゲートに配線。攻撃側 polity の military 官の性格で勝率しきい値を調整する）:
```ts
// ambition 高（野心的）→ 閾値を下げる（積極的に開戦）
// caution 高（慎重）→ 閾値を上げる（消極的）
effectiveThreshold = clamp(
  minAttackerWinChanceToDeclare
    - normalizedTrait(ambition) * generalAmbitionDeclareThresholdEffect
    + normalizedTrait(caution)  * generalCautionDeclareThresholdEffect,
  minWarDeclareThreshold,
  maxWarDeclareThreshold,
)
// WarCreationSystem は estimateAttackerWinChance < effectiveThreshold なら開戦を見送る（WAR_AVERTED）。
// personAbilityEffectsEnabled OFF 時は flat minAttackerWinChanceToDeclare。
```

### 10.6 Polity 土地開発への効果

確率試行による公共支出ベースの土地開発は存在しない。Polity の土地開発は Project システム（`develop_holding`）を通じて行う。Polity treasurer の admin による開発コスト割引 (`calcTreasurerDevelopmentCostModifier`)、および Polity administrator の ambition / caution 補正 (`calcChancellorLandDevelopmentScoreBonus`) selector はいずれも定義済みだが現状未参照（将来の活用余地として保持）。

### 10.7 Task outcome 判定への能力効果

Task 完了時の outcome 判定は `determineTaskOutcome` で行う。各 Task は `relevantAbility: AbilityKey` を持ち、assignee の該当能力スコアが判定に使われる。

**判定式**:
```ts
effectiveScore = person.abilities[task.relevantAbility] + roll * 100  // 0〜220
threshold = task.difficulty * 2                                        // 0〜200
successMargin = config.taskOutcomeSuccessMargin                        // default 20

effectiveScore >= threshold + successMargin → success
effectiveScore >= threshold                 → partial
effectiveScore < threshold                  → failure
```

**TaskKind → relevantAbility マッピング**（outcome 判定用。effort 計算用の `getTaskRelevantAbility` とは perform_office_duties / defend_office_position / gather_claim_evidence / negotiate_terms で値が異なる。v0.44: 旧鍛錬 4 TaskKind は削除）:

| TaskKind | difficulty | relevantAbility |
|---|---|---|
| support_organization_plan | 25 | insight |
| promote_house_influence | 30 | charisma |
| perform_office_duties | 20 | numeracy |
| seek_office_support | 40 | charisma |
| display_competence | 30 | insight |
| defend_office_position | 35 | charisma |
| manage_accounts | 20 | numeracy |
| seek_profitable_assignment | 30 | insight |
| secure_internal_support | 30 | charisma |
| arrange_patronage | 25 | charisma |
| commission_chronicle_work | 25 | learning |
| prepare_project / advance_project | 30 / 35 | ProjectKind に応じて変動（§4.9 参照） |
| collect_holding_revenue | 20 | numeracy |
| 外交劇系 (6 種) | 35〜50 | learning / insight / charisma / command |

**ProjectKind → relevantAbility マッピング**（prepare_project / advance_project で使用）:

| ProjectKind | relevantAbility |
|---|---|
| develop_holding | numeracy |
| acquire_political_right / promote_policy_shift / patronize_artist | charisma |
| commission_chronicle | learning |
| acquire_land | command |
| sell_land / improve_contract_terms / demand_tax_increase | numeracy |
| respond_to_pressure | insight |

### 10.8 LifeStage と能力

LifeStage は能力成長カーブには**直接関与しない**。`ABILITY_AGE_CURVES` + `naturalFraction(k, age, config)`（lifelongGrowth / youthPeak / midLifePeak）が年齢による伸び・衰退を既に表現しており、LifeStage 別の成長率 modifier を重ねると二重適用になる（禁止）。

LifeStage が能力に加える唯一の効果は **親能力ボーナス**（§6.24 / §6.25）: childhood / adolescence の人物について、成長判定ブロック内でのみ living な父母の該当 ability 平均が子より高ければ `gainChance` に `parentalAbilityGrowthChanceBonus`（2.0pp）を加算する。`aptitudes` / `effectiveCeil` / `naturalFraction` は不変。これは「この時期は親・周囲から教育・模倣の影響を受けやすい」という社会的効果であり、能力カーブそのものの補正ではない。

---

