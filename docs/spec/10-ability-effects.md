# 10. 人物能力効果（v0.6 / v0.14 で派生 selector ベースに刷新）

`personAbilityEffectsEnabled` が false の場合、全関数は中立値（倍率 1.0、ボーナス 0）を返す。

**v0.14 での変更**: `stats.admin` / `stats.martial`（0..10）は廃止。各効果計算は `getRoleScore(state, p.id, role) / 10` を `0..10` スケールに正規化して、旧 admin/martial 相当に揃えて入力する。

| 旧 stats 参照 | v0.14 派生 selector 経由 |
|---|---|
| `stats.admin` (chancellor effect) | `getRoleScore(state, p.id, 'governance') / 10` |
| `stats.admin` (treasurer effect) | `getRoleScore(state, p.id, 'stewardship') / 10` |
| `stats.martial` (general effect) | `getRoleScore(state, p.id, 'warCommand') / 10` |

### 10.1 正規化関数

```ts
normalizedStat(value: number): number   // (value - 5) / 5  → -1.0 (=0) .. 0 (=5) .. +1.0 (=10)
                                        // v0.14: 入力は getRoleScore(state, id, role) / 10
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
maxControlBonus = normalizedStat(admin) * chancellorAdminControlMaxBonusPerAdmin * 10
```

v0.12 では `getEffectiveOfficeStat(state, config, polityRef, 'administrator', 'admin')` で複数担当者を集約した実効値が使われる。

**家長（house:leader）→ houseControl**:
```ts
growthModifier = 1 + normalizedStat(admin) * houseHeadAdminControlGrowthEffect
maxControlBonus = normalizedStat(admin) * houseHeadAdminControlMaxBonusPerAdmin * 10
```

支配力上限は二段階 clamp:
```ts
baseMaxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
maxControl     = clamp(baseMaxControl + maxControlBonus, controlAbilityMinimumFloor, 100)
// 首都 / 本拠地は 100 固定
```

### 10.4 EconomySystem への効果

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

**Polity treasurer → Polity土地開発コスト**:
```ts
costModifier = 1 - normalizedStat(admin) * treasurerAdminDevelopmentCostEffect
effectiveCost = max(1, round(polityLandDevelopmentBaseCost * costModifier))
```

### 10.5 WarSystem への効果

**Polity military（General）→ 戦闘力**:
```ts
warPowerModifier = 1 + normalizedStat(martial) * generalMartialWarPowerEffect
// 攻撃側・防衛側それぞれ独立して適用
```

**Polity military → 宣戦閾値**:
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
```

### 10.6 PublicSpendingSystem への効果

v0.16 後の整理で記念碑建設機能が削除されたため、`monumentScore` / `landDevelopmentScore` の二択構造そのものが廃止された。現在は `publicSpendingYearlyChance` の確率試行成功時に Polity 土地開発を実行するのみ。Polity treasurer の admin による開発コスト割引 (`calcTreasurerDevelopmentCostModifier`) のみが残っており、Polity administrator の ambition / caution 補正は `calcChancellorLandDevelopmentScoreBonus` selector として残置されているが現状未参照（将来の活用余地として保持）。

### 10.7 Task outcome 判定への能力効果（v0.26.1）

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

**TaskKind → relevantAbility マッピング**（outcome 判定用。effort 計算用の `getTaskRelevantAbility` とは 8 TaskKind で値が異なる）:

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
| study_law | 35 | learning |
| study_accounts | 35 | learning |
| practice_arms | 35 | command |
| courtly_training | 35 | learning |
| prepare_project / advance_project | 30 / 35 | ProjectKind に応じて変動（§4.9 参照） |
| collect_holding_revenue | 20 | numeracy |
| 外交劇系 (6 種) | 35〜50 | learning / insight / charisma / command |

**ProjectKind → relevantAbility マッピング**（prepare_project / advance_project で使用）:

| ProjectKind | relevantAbility |
|---|---|
| develop_holding | numeracy |
| expand_polity_share / promote_policy_shift / patronize_artist | charisma |
| commission_chronicle | learning |
| acquire_land | command |
| sell_land / improve_contract_terms / demand_tax_increase | numeracy |

### 10.8 LifeStage と能力（v0.40）

LifeStage は能力成長カーブには**直接関与しない**。v0.14 の `ABILITY_AGE_CURVES` + `naturalFraction(k, age, config)`（lifelongGrowth / youthPeak / midLifePeak）が年齢による伸び・衰退を既に表現しており、LifeStage 別の成長率 modifier を重ねると二重適用になる（禁止）。

v0.40 が能力に加える唯一の効果は **親能力ボーナス**（§6.24 / §6.25）: childhood / adolescence の人物について、成長判定ブロック内でのみ living な父母の該当 ability 平均が子より高ければ `gainChance` に `parentalAbilityGrowthChanceBonus`（2.0pp）を加算する。`aptitudes` / `effectiveCeil` / `naturalFraction` は不変。これは「この時期は親・周囲から教育・模倣の影響を受けやすい」という社会的効果であり、能力カーブそのものの補正ではない。

---

