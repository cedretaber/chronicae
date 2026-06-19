# 10. 人物能力効果（派生 selector ベース）

`personAbilityEffectsEnabled` が false の場合、全関数は中立値（倍率 1.0、ボーナス 0）を返す。

各効果計算は `getRoleScore(state, p.id, role)`（0..120）を入力する。効果ごとに参照する role は次のとおり。

| 効果 | 入力 |
|---|---|
| chancellor effect | `getRoleScore(state, p.id, 'governance')` |
| treasurer effect | `getRoleScore(state, p.id, 'stewardship')` |
| general effect | `getRoleScore(state, p.id, 'warCommand')` |

### 10.0 統一非線形ファクター（v0.49 — 人物中心史観）

> **v0.49 でこう拡張**: 内政成長・国庫税効率・軍戦力推定(外交評価のみ。実戦闘は§10.5 NB 参照で未強化)・代官徴税効率・`getPolityAdminPower`
> （= 征服/開発/収益ドライバ。`getEffectiveOfficeStat` 経由）・民衆反乱傾向の主要倍率を、50 中立の非線形
> ファクター `abilityOutputFactor` に統一した。**実配線は 4 経路**（内政成長 §10.3 / 国庫税効率 §10.4 /
> 軍戦力推定 §10.5 / adminPower §10.0）。**開発コストは設計のみで未実装**（selector 未作成。§10.4 / §10.6 参照）。狙いは「優秀な人物がいたから上手くいった」を観賞対象として
> 明確に見せること（KOEI 風）。旧 `1 + normalizedStat × 係数`（80↔40 で約 1.1〜1.2x）では能力差が体感できなかった。

```ts
abilityOutputFactor(roleScore, config):
  if (!personAbilityEffectsEnabled) return 1
  return (clamp(roleScore, 0, 120) / 50) ** abilityOutputExponent
// roleScore 50 → 1.0（平均は不変＝経済全体のインフレを避ける）
// roleScore 0 → 0,  80 → 2.12,  100 → 3.03,  120 → 4.06 （exponent=1.6）
```

**較正の根拠**（CLI 実測）: `abilityOutputExponent = 1.6` のとき、関連2能力のみ 80 / 40 で他能力が平均(50)の
現実的プロファイルでは合成 roleScore が 68 / 44 となり、ファクター比は **2.01x**（ユーザー目標「80 は 40 の
約2倍」に一致）。全能力が揃って高い人物では 80 vs 40 = **3.03x** とより誇張される（「やや過剰に」を満たす）。
exponent を上げるほど能力差が誇張される単一ノブ。

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

**Polity administrator（Chancellor）→ polityControl**（v0.49 で growthModifier を非線形ファクター化）:
```ts
growthModifier = abilityOutputFactor(getRoleScore(admin, 'governance'), config)  // §10.0
maxControlBonus = (admin/10 - 5) * chancellorAdminControlMaxBonusPerAdmin        // 旧式据え置き（二次的）
```

control 効果は `getFirstActiveLivingOfficeHolder` で得た最初の生存役職保持者の governance 由来スコアを使う（単一保持者。複数担当者の集約は行わない）。役職空席時は roleScore=50（factor 1.0、中立）。

**家長（house:leader）→ houseControl**:
```ts
growthModifier = abilityOutputFactor(getRoleScore(head, 'governance'), config)   // §10.0
maxControlBonus = (admin/10 - 5) * houseHeadAdminControlMaxBonusPerAdmin          // 旧式据え置き
```

支配力上限は二段階 clamp:
```ts
baseMaxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
maxControl     = clamp(baseMaxControl + maxControlBonus, controlAbilityMinimumFloor, 100)
// 首都 / 本拠地は 100 固定
```

### 10.4 LandRevenue / PolitySurplus への効果

**Polity treasurer → 国庫税収効率**（v0.49 で非線形ファクター化。clamp 帯域を [0.5, 2.0] に拡張）:
```ts
taxEfficiency = clamp(
  abilityOutputFactor(getRoleScore(treasurer, 'stewardship'), config)             // §10.0
    * (1 + normalizedTrait(caution) * treasurerCautionTaxEfficiencyEffect),
  treasurerTaxEfficiencyMin,   // 0.5 (旧 0.8)
  treasurerTaxEfficiencyMax,   // 2.0 (旧 1.2)
)
// 国庫収入 *= taxEfficiency。家収入・POP wealth への影響なし
```

**Polity treasurer → Polity土地開発コスト**（**未実装＝設計のみ**。selector `calcTreasurerDevelopmentCostModifier` は
コード上に存在しない。下記は将来配線する際の想定式であり、v0.49 では non-linear 化の対象に**含めなかった**）:
```ts
// ⚠️ 以下は設計案。現状この selector も呼び出し元も存在しない（grep 0 件、2026-06-18 監査確認）。
costModifier = clamp(2 - abilityOutputFactor(getRoleScore(treasurer, 'stewardship'), config), 0.2, 2)
effectiveCost = max(1, round(polityLandDevelopmentBaseCost * costModifier))
// 有能(factor>1)ほどコスト<1。下限 0.2 で過剰割引を防ぐ
```

### 10.5 War / Battle への効果

**Polity military（General）→ 戦力推定（外交評価のみ。v0.49 で非線形ファクター化）**:
```ts
warPowerModifier = abilityOutputFactor(getRoleScore(military, 'warCommand'), config)  // §10.0
// ⚠️ この modifier の消費先は diplomaticOfferEvaluation のみ（AI が開戦/交渉で相手・自軍の戦力を
//    推定する値）。実際の戦闘決着 (simulateBattle) や AI 戦争判断 (calcPolityMilitaryPower 比較) には
//    効かない。したがって v0.49 では「有能な将軍 → 外交で強く見える」までで、「戦闘に勝つ」は未達。
//
// 実戦闘の能力影響（未強化・将来課題）:
//   - simulateBattle の commanderQ = ±commanderAssignedRegimentEffectMax(0.15)（80 vs 40 ≈ 1.12x）
//   - calcHouseMilitaryPower の commanderModifier = 旧線形 (1 + normalizedStat × houseCommanderMartialEffect)
//   これらは「連隊戦闘バランス保留」領域（battlefield/commander/attrition/logistics が揃ってから調整）の
//   ため v0.49 では意図的に据え置き。戦争の能力2倍化は当該フェーズで commanderQ / commanderModifier を
//   非線形化して実現する（ユーザー判断 2026-06-14: 今は外交評価のみで保留）。
//
// 外交・陰謀の成功判定への能力導入も別 PR（v0.49 スコープ外）。
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

確率試行による公共支出ベースの土地開発は存在しない。Polity の土地開発は Project システム（`develop_holding`）を通じて行う。Polity treasurer の admin による開発コスト割引 (`calcTreasurerDevelopmentCostModifier`)、および Polity administrator の ambition / caution 補正 (`calcChancellorLandDevelopmentScoreBonus`) selector は**いずれも未実装**（spec 上の設計のみで selector は存在しない。2026-06-18 監査で grep 0 件を確認）。消費するはずの config キー `chancellorAmbitionLandDevelopmentScoreEffect` / `chancellorCautionLandDevelopmentScoreEffect` は defaultConfig に残るが**読み手が無い dead key**。将来配線する際にこれらを実装する。

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
| develop_real_estate / upgrade_owned_real_estate | numeracy |
| acquire_real_estate | charisma |
| respond_to_pressure | insight |

### 10.8 LifeStage と能力

LifeStage は能力成長カーブには**直接関与しない**。`ABILITY_AGE_CURVES` + `naturalFraction(k, age, config)`（lifelongGrowth / youthPeak / midLifePeak）が年齢による伸び・衰退を既に表現しており、LifeStage 別の成長率 modifier を重ねると二重適用になる（禁止）。

LifeStage が能力に加える唯一の効果は **親能力ボーナス**（§6.24 / §6.25）: childhood / adolescence の人物について、成長判定ブロック内でのみ living な父母の該当 ability 平均が子より高ければ `gainChance` に `parentalAbilityGrowthChanceBonus`（2.0pp）を加算する。`aptitudes` / `effectiveCeil` / `naturalFraction` は不変。これは「この時期は親・周囲から教育・模倣の影響を受けやすい」という社会的効果であり、能力カーブそのものの補正ではない。

---

