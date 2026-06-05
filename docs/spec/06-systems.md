# 6. 各システムの仕様

### 6.1 ControlSystem（4週ごと）

Polity ごとに首都から BFS、House ごとに本拠地から BFS を行い、各 Province の支配力を更新する。

**支配力上限（二段階 clamp）**:

```ts
// 距離ベースの上限
baseMaxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
// 能力補正後の上限（能力最低床を別途設定）
maxControl = clamp(baseMaxControl + maxControlBonus, controlAbilityMinimumFloor, 100)
// 首都 / 本拠地は常に上限 100
```

`maxControlBonus` は Polity administrator（polityControl）の admin stat から算出される（§10 参照）。

**到達可能な Province**:

```ts
if (control < maxControl) control = Math.min(control + effectiveGrowth, maxControl)
if (control > maxControl) control = Math.max(control - controlDecayPerMonth, maxControl)
```

`effectiveGrowth = controlGrowthPerMonth * growthModifier`（Polity administrator の admin stat による）。

**到達不能な Province**（飛び地など）:

```ts
control = Math.max(0, control - disconnectedControlDecayPerMonth)
```

BFS 通行条件:
- polityControl: 首都 (`capitalProvinceId`) から全 Province を通行可

polityControl は Province ではなく **Holding 単位**で更新する。BFS は Province graph 上を走査し、到達した Province 内の各 Holding の `polityControl` を距離に応じて更新する。Province レベルの polityControl は selector (`getProvincePolityControlFromHoldings`) で Holding の weight 加重平均から算出する。

### 6.2 PopSystem（4週ごと）

POP の自然変化を処理する。Province の carrying capacity に基づいた人口圧制御、occupation overflow、wealth/unrest の自然変化を担当する。

**6.2.1 人口成長**

成長抑制式は `1 - pressure²`（二次関数）を使用する。`occupation:none` POP は成長が鈍化する。

```ts
const pressure = getProvincePopulationPressure(state, config, province.id)
const growthFactor = clamp(1 - pressure * pressure, -0.5, 1.0)
const baseGrowth = config.baseMonthlyGrowthByClass[pop.class]
const wealthFactor = clamp(0.5 + pop.wealth / 100, 0.5, 1.5)
const unrestFactor = clamp(1 - pop.unrest / 150, 0.3, 1)
const occupationGrowthModifier =
  pop.occupation === 'none' ? config.unemployedGrowthModifierByClass[pop.class] : 1
const delta = pop.size * baseGrowth * growthFactor * wealthFactor * unrestFactor * occupationGrowthModifier
```

**6.2.1b 人口増加時の overflow**

人口増加分はまず元 POP に追加する。ただし `occupation !== 'none'` の POP で occupation capacity を超える場合、超過分は同 Holding / 同 class の `occupation:none` POP に移す。`none` POP の増加はそのまま none POP に留まる。

```ts
if (pop.occupation !== 'none') {
  const capacity = getHoldingOccupationCapacity(state, config, pop.holdingId, pop.class, pop.occupation)
  const current = getHoldingPopSizeByClassAndOccupation(state, pop.holdingId, pop.class, pop.occupation)
  const room = Math.max(0, capacity - current)
  const toOriginal = Math.min(delta, room)
  const overflow = delta - toOriginal
  pop.size += toOriginal
  if (overflow > 0) {
    addToOrCreatePopGroup(state, { holdingId: pop.holdingId, class: pop.class, occupation: 'none', size: overflow, inheritFrom: pop })
  }
}
```

実装注意: PopSystem は mutable draft パターンを使用し、ループ開始前に POP リストの snapshot を取る。overflow で生成された新 POP が同 tick 内で二重処理されないようにする。

**6.2.2 population pressure の影響**

pressure が閾値を超えると土地不足・過密に相当する影響が発生する：

```ts
if (pressure > config.populationPressureThreshold) {
  const excess = pressure - config.populationPressureThreshold
  pop.wealth -= excess * config.populationPressureWealthPenalty
  pop.unrest += excess * config.populationPressureUnrestGain
}
```

**6.2.3 poverty / prosperity 効果**

```ts
if (pop.wealth < config.povertyWealthThreshold) {
  pop.unrest += (config.povertyWealthThreshold - pop.wealth) * config.povertyUnrestGain
}
if (pop.wealth > config.prosperityWealthThreshold) {
  pop.unrest -= (pop.wealth - config.prosperityWealthThreshold) * config.prosperityUnrestReduction
}
```

**6.2.4 unrest 自然減衰**

```ts
pop.unrest *= 1 - config.unrestNaturalDecayRate
```

**6.2.4b none POP ペナルティ**

```ts
if (pop.occupation === 'none') {
  pop.wealth -= config.unemployedWealthDecayByClass[pop.class]
  pop.unrest += config.unemployedUnrestGainByClass[pop.class]
}
```

**6.2.5 clamp**

`occupation !== 'none'` の POP は `minPopSizeByClass` で下限保証。`none` POP は 0 まで減少可能。

```ts
const minSize = pop.occupation !== 'none' ? config.minPopSizeByClass[pop.class] : 0
pop.size = Math.max(minSize, newSize)
pop.wealth = clamp(pop.wealth, 0, 100)
pop.unrest = clamp(pop.unrest, 0, 100)
```

**normalizePopSizes**（IntegrityCheck 直前）: `occupation !== 'none'` の POP は `minPopSizeByClass` で下限保証。`occupation === 'none'` の POP は size が `popSizeEpsilon` 以下で削除する。

### 6.3 EmploymentRebalanceSystem（4週ごと）

PopSystem 直後、LandRevenueSystem 直前に実行。Holding × PopClass ごとに capacity 超過の強制失業化と、none POP の再就業を処理する。

**処理順**:
1. 各 Holding / class / occupation で capacity 超過を検査。超過分を none POP に移す
2. none POP を確認。class に対応する primary occupation に空きがあれば再就業

```ts
for (const holding of Object.values(state.holdings)) {
  for (const popClass of POP_CLASSES) {
    // Phase 1: 強制失業化
    const primaryOccupation = getPrimaryOccupationForClass(popClass)
    const capacity = getHoldingOccupationCapacity(state, config, holding.id, popClass, primaryOccupation)
    const employed = getHoldingPopSizeByClassAndOccupation(state, holding.id, popClass, primaryOccupation)
    if (employed > capacity) {
      const excess = employed - capacity
      movePopSizeToOccupation(state, { sourcePopId, targetOccupation: 'none', size: excess })
    }

    // Phase 2: 再就業
    const room = getHoldingOccupationRemainingCapacity(state, config, holding.id, popClass, primaryOccupation)
    if (room > 0) {
      const nonePops = getHoldingPopsByClassAndOccupation(state, holding.id, popClass, 'none')
      for (const nonePop of nonePops) {
        movePopSizeToOccupation(state, { sourcePopId: nonePop.id, targetOccupation: primaryOccupation, size: moved })
      }
    }
  }
}
```

再就業時の wealth / unrest / attitudes は移動元と移動先の人口加重平均で統合される。

### 6.4 LandRevenueSystem（4週ごと）

Province の生産を **Holding 単位で分配**し、代官による現地徴収を挟んだ上で、各 Holding の LandContract chain に沿って上納する。

**6.4.1 生産量算出**

各 POP の生産量は `pop.size * productivityByClass * occupationProductivityMultiplier * (wealth/100) * holdingDevMod * holdingControlMod` で算出する（occupation productivity multiplier と holding.polityControl/100 がともに per-pop 式に含まれる）。`none` POP の生産性は 0.1（最低限の日雇い・自給を表す）。

**6.4.2 per-Holding 収入と代官徴収（extraction model）**

各 Holding の `grossHoldingRevenue` は、当該 Holding 内 POP の生産（getPopProduction）を単純合計した `getHoldingProduction` である。Province 生産を Holding の weight / landQuality / kindMultiplier で按分する処理は存在しない（per-pop bottom-up モデルそのもの）。polityControl は per-pop 式に既に含まれている。

```ts
grossHoldingRevenue = getHoldingProduction(state, config, holding.id)
// = sum(getPopProduction(pop) for each POP in holding)
```

各 Holding の代官による現地徴収を挟む。

```ts
const localExtractionRate = getBailiffLocalExtractionRate(state, config, assignment.id)
const collectionEfficiency = getBailiffCollectionEfficiency(state, config, assignment.id, recentTaskStatus)
const collected = grossHoldingRevenue * localExtractionRate * collectionEfficiency
const bailiffFeeRate = getBailiffFeeRate(state, config, assignment.id)
const bailiffFee = collected * bailiffFeeRate
const remittanceToTerminal = collected - bailiffFee
```

通常人物代官には `bailiffFee` を `person.wealth` に加算する。placeholder 代官には加算しない。

**6.4.2b chain 上納**

各 Holding について、`remittanceToTerminal` を chain に流す。chain 配分時には treasurer の taxEfficiency を掛けず、生の `remittanceToTerminal` で開始する。

```ts
let remaining = remittanceToTerminal
for (const contract of chain.slice().reverse()) {
  const tax = remaining * contract.terms.taxRateToGrantor
  treasuryDeltas[granteePolityId] += (remaining - tax)
  remaining = tax
}
```

`root contract` の `taxRateToGrantor` は 0 固定なので、world に流出する分は無い。

**6.4.3 Polity treasurer の taxEfficiency**

taxEfficiency は chain 配分の後、各 grantor polity 単位で集計した収入デルタに対して適用される。多段 chain では各 overlord polity が自分の treasurer の効率を自分の取り分に個別適用する。あわせて `config.taxFlowEfficiency`（既定 1.0）を同時に乗算する。

```ts
treasury += treasuryDeltas[polityId] * calcTreasurerTaxEfficiency(polityId) * config.taxFlowEfficiency
```

treasurer の能力補正については §10 参照。`collectionEfficiency`（代官の現地徴収能力）とは別概念。

**6.4.4 Holding 単位の徴税負担処理**

Holding 単位の `totalBurdenRate` ベースで POP の wealth / unrest と代官への attitude を処理する。

```ts
const { collectionFrictionBurdenRate, totalBurdenRate } =
  computeBailiffBurdenComponents(localExtractionRate, collectionEfficiency, config.collectionFrictionFactor)

// POP wealth: 徴税摩擦による追加損耗（wealth 比例）
pop.wealth -= collectionFrictionBurdenRate * config.localExtractionWealthPenalty * (pop.wealth / 100)

// POP unrest: totalBurdenRate が comfort を超えた分で上昇
const burdenOverComfort = Math.max(0, totalBurdenRate - config.comfortableLocalExtractionRate)
pop.unrest += burdenOverComfort * config.localExtractionUnrestGain

// POP → Bailiff Attitude（通常人物代官のみ）
affectionDelta -= burdenOverComfort * config.bailiffBurdenAffectionPenaltyFactor
if (policy === 'protect_residents') affectionDelta += config.bailiffProtectResidentsAffectionBonus
if (recentTaskStatus === 'completed') respectDelta += config.bailiffTaskCompletedRespectGain
// clamp: affection [-1.0, 0.5], respect [-0.5, 0.5]
```

**6.4.5 retained wealth の POP 反映**

`retainedToPop` を `provinceCollected`（各 Holding で実際に徴収された額の合計）ベースで計算する。

```ts
const provinceCollected = sum(collected for each Holding)
const retainedToPop = Math.max(0, provinceProduction - provinceCollected)
```

POP は生産の過半（標準で約 65%）を保持する。`retainedWealthGainByClass` による class 別 POP wealth 回復は維持。

**6.4.6 debug log**

`config.debug === true` 時に `[BAILIFF]` ログを stderr に出力する。holdingId / collected / bailiffFee / remittance / rates / burden 等。

### 6.5 PolitySurplusDistributionSystem（4週ごと）

各 Polity treasury から **Polity Influence（§6.64）に比例して House に分配**する（v0.42: 旧 Polity share 比例から変更）。給与・維持費 (OfficeCompensationSystem §6.20) は別 system で支払う。

```ts
// reserveTarget を所領規模に応じて動的に計算
const holdingCount = /* polity の terminal province 全体の holding 数 */
const reserveTarget = config.polityTreasuryReserveBase
  + config.polityTreasuryReservePerHolding * holdingCount

const distributable = Math.max(
  0,
  polity.treasury - reserveTarget
) * config.politySurplusDistributionRate

// influence breakdown の House entry に entry.percent / 100 で分配
const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
for (const entry of breakdown.entries) {
  if (entry.holder.kind !== 'house') continue  // Person entry (commonwealth leader 等) には分配しない
  house.wealth += distributable * (entry.percent / 100)
}
polity.treasury -= distributedTotal
```

`reserveTarget` は `polityTreasuryReserveBase`（暫定 50）+ `polityTreasuryReservePerHolding`（暫定 50）× holding 数で動的に算出される。大国ほど多くの運営資金を確保し、プロジェクト費用や給与の支払いに備える。後続の OfficeCompensationSystem の給与原資となる。

1 サイクルの `distributable = max(0, treasury - reserveTarget) × distributionRate` の計算は `getPolityDistributablePerCycle`（landContractSelectors）に集約され、本 system と House の投影年間収入 `getHouseProjectedAnnualIncome`（§6.19 支払能力ゲート）の両方から呼ぶ単一の正本となっている（式の二重定義による drift 防止）。

**commonwealth の扱い (v0.42)**: House entry が存在しない（leader Person entry のみの）commonwealth では surplus は treasury に残る。旧 person-holder share への分配は廃止。

### 6.6 DisasterSystem（48週ごと = 毎年）

Province 単位で判定する。救済システムは一旦オミット（将来 Holding 単位 POP で再導入予定）。人口ダメージは割合ベース。人口圧力により発生率が増加する。

Province ごとに独立して判定。同一 Province に複数の災害が同時発生し得る。

**発生率の計算**:

```ts
const pressure = getProvincePopulationPressure(state, config, provinceId)
const pressureExcess = Math.max(0, pressure - config.populationPressureThreshold)
const famineChance = config.famineBaseChancePerYear + config.faminePressureChanceBonus * pressureExcess
const plagueChance = config.plagueBaseChancePerYear + config.plaguePressureChanceBonus * pressureExcess
```

pressure 1.0 で飢饉確率 100%（`faminePressureChanceBonus: 9.2`）。人口が carrying capacity を超過すると確実に飢饉が発生する。

| 災害 | 基礎確率 | 圧力ボーナス | 効果 |
|------|------|------|------|
| Famine（飢饉） | 8% | +9.2/excess | peasants wealth -8・population -10% |
| Plague（疫病） | 3% | +2.0/excess | 全 POP wealth -10・population -5% |
| BountifulHarvest（豊作） | 5% | なし | peasants/townsmen wealth 上昇・unrest 低下 |

**Famine の詳細**:
- peasants wealth -= `famineWealthPenalty`（default: 8）
- peasants size *= `(1 - famineSizeDamageRate)`（default: -10%）

**Plague の詳細**:
- 全 POP wealth -= `plagueWealthPenalty`
- 全 POP size *= `(1 - plagueSizeDamageRate)`（default: -5%）

**BountifulHarvest の詳細**:
- treasury への直接加算なし。翌週以降の LandRevenueSystem で POP production 上昇により国庫が増加する
- `adjustProvincePopWealthByClass(state, pid, 'peasants', +bountifulHarvestPeasantWealthGain)`
- `adjustProvincePopUnrestByClass(state, pid, 'peasants', -bountifulHarvestPeasantUnrestReduction)`
- `adjustProvincePopWealthByClass(state, pid, 'townsmen', +bountifulHarvestTownsmanWealthGain)`
- `adjustProvincePopUnrestByClass(state, pid, 'townsmen', -bountifulHarvestTownsmanUnrestReduction)`

### 6.7 MortalitySystem（4週ごと）

人物の自然死亡を処理。死亡が確定した Person について `markPersonDead` mutation を呼び、以下を一括で処理する：

1. `person.alive = false`
2. `clearSpouse` で配偶者側の `spouseId` も解除
3. `revokeOfficesByHolder` で当人が保有する全 OfficeAssignment を inactive 化
4. 所属 House の `memberIds` から除外し `deceasedMemberIds` に移動

家長（house:leader）が死亡した場合の後継選出は SuccessionSystem（§6.11）が担当する。

死亡者の `wealth` 分配は直後の EstateSettlementSystem（§6.8）が処理する。MortalitySystem は死者を `TickContext.deathsThisTick` に追記し、`wasHouseLeader` / `wasPolityLeader` の役職情報を `TickContext.deathRolesThisTick` に保存して estate 処理に引き継ぐ（mortalitySystem 内で role を取得しないと markPersonDead が office を revoke するため後段では復元できない）。

### 6.8 EstateSettlementSystem（4週ごと）

`MortalitySystem` 直後・`SuccessionSystem` 前に実行。`deathsThisTick` に含まれる死亡者で `wealth > 0` の者について、家中 Share に応じた家回収率で家・相続人に wealth を分配する。

**家回収率**:
```
share = getPersonHouseSharePercent(state, houseId, personId) / 100
houseRecoveryRate = clamp(
  estateBaseRecoveryRate - estateShareEffectStrength * share,
  estateRecoveryRateMin,
  estateRecoveryRateMax,
)
toHouse = floor(wealth * houseRecoveryRate)
toHeirsPool = wealth - toHouse
```

* 家中 Share が高い人物ほど家回収率が下がる（子に多く残せる）
* 家に所属していない人物は houseRecoveryRate = 0 で全額相続人へ

**相続人決定（`findHeirs`）**: 最初にマッチした集合で確定:
1. 嫡出子のうち alive な者 全員
2. 配偶者（alive）
3. 同 fatherId の兄弟姉妹（alive / 同 house、嫡出非嫡出を問わない）
4. 家長（自分自身が家長だった場合は除外）
5. なし → wealth は全額家に回収（家もなければ消滅）

相続人は age 降順 + id 昇順 でソート（決定論性保持）。端数は最年長相続人 `heirs[0]` に寄せる。

**Mutation API**: `addPersonWealth`, `clearPersonWealth`, `addHouseWealth`（§12.2 参照）。

**イベント**:
* `ESTATE_SETTLED` は対象人物ごとに必ず発火
* 加えて、嫡出子 2 人以上または兄弟相続で 2 人以上の場合は `ESTATE_DISPUTED` を ESTATE_SETTLED と並んで追加発火（記録のみ、後続処理なし）
* importance: 故人が polity leader だった場合 `major`、家長または `wealth ≥ house.wealth * estateSettledNormalWealthRatio` の場合 `normal`、それ以外 `minor`

`deathsThisTick` と `deathRolesThisTick` は次 tick の `advanceTime` で空にリセットされる。

### 6.9 MarriageSystem（4週ごと）

`marriageEnabled` が true のとき動作。未婚の男性候補を一覧し、それぞれに対して婚姻判定を行う。

- **候補条件（男性）**: 生存・未婚・対象年齢（`marriageMaleMinAge`〜`marriageMaleMaxAge`）・normal（placeholder 除外）。houseId がある場合は所属家が active であること。houseId がなくても候補に含める
- **候補条件（女性）**: 生存・未婚・対象年齢（`marriageFemaleMinAge`〜`marriageFemaleMaxAge`）・normal（placeholder 除外）。houseId がある場合は所属家が active であること。houseId がなくても候補に含める。**所属 House の house:leader である女性は候補から除外する**（家を出て他家に移ると当主不在になるため）
- **禁止組み合わせ**: 同一家・近親関係（`isForbiddenMarriagePair` によるチェック）。**無家×無家は婚姻不可**
- **同 Polity 婚ボーナス**: `getPersonPrimaryPolityId` で primary Polity を取得し、男女で一致なら `samePrimaryPolityMarriageBonus`（+0.08）を加算

婚姻成立時の処理：
- 男女とも House 所属: 女性が男性の家に `movePersonToHouse` で移動（既存ルール）
- 片方が無家: 無家側が有家側の House に `movePersonToHouse` で移動
- `spouseId` を双方向に設定（`setSpouse`）
- `house.memberIds` に移動者を追加

イベント: `MARRIAGE_FORMED`（importance: `normal`）

### 6.10 BirthSystem（4週ごと）

`birthEnabled` が true のとき動作。対象年齢（`fatherMinChildAge`〜`fatherMaxChildAge`）の生存男性を走査し、出生判定を行う。**`houseId` がない人物は出生対象外**。家を持たない在野人物が子を残すには、まず家系を創設する必要がある。

**出生確率補正**:
```
livingCount <= criticalLivingPersons → birthMultiplier = criticalPopulationBirthMultiplier (3.0)
livingCount < targetLivingPersons   → birthMultiplier = lowPopulationBirthMultiplier (1.5)
それ以外                              → birthMultiplier = 1.0
birthChance = baseBirthChancePerMalePerYear * birthMultiplier
```

**母親の決定**:
- 配偶者が対象年齢（`motherMinChildAge`〜`motherMaxChildAge`）の場合、`spouseMotherChance`（0.9）で嫡出子
- それ以外は非嫡出子（`illegitimate`）として処理

**性別の決定**:
- 成人男性が全人口の 40% 未満の場合: `maleBirthChanceWhenAdultMaleShortage`（0.65）
- それ以外: `maleBirthChance`（0.52）

誕生した子：
- `houseId` は父親と同じ
- `fatherId` / `motherId` を設定（嫡出の場合）
- 父・母の `childIds` に追加
- `house.memberIds` に追加

イベント: `CHILD_BORN`（importance: `minor`）

### 6.11 SuccessionSystem（4週ごと）

家長（house:leader の OfficeAssignment ホルダー）が死亡または存在しない場合、生存メンバーから新家長を選出。

**後継者選出（成人候補あり）**:
- `getAdultSuccessionCandidates` で成人（age >= `adultAge`）かつ生存の家メンバーを列挙
- スコアが最高の候補を後継者に選ぶ
- スコア 1 位と 2 位の差が `successionCrisisScoreGap` 以下（接戦）の場合、`SUCCESSION_CRISIS` イベントを発火
- 継承後に `maybeSplitHouseAfterSuccession` を呼び出す（§6.12 参照）

**後継者選出（未成年のみ）**:
- 最年長の未成年を仮の家長に任命
- 未成年当主ペナルティ（§6.14 参照）が以後 4 週ごとに適用される

**後継者なし**: `extinctHouseAfterFailedSuccession`（§6.15 参照）を呼び出す。

家長交代は `house:leader` の OfficeAssignment を新設し、旧ホルダーの assignment を inactive にすることで記録する。`HOUSE_LEADER_CHANGED` イベントを発火する。新家長が active な代官（HoldingOfficeAssignment）を保持していた場合、自動的に vacate して placeholder に置換する。

**Polity ruler succession**: 同 system 内で active Polity に polity:leader Office が無い場合、`getPolityHouseIds` のうち ownerHouse もしくは primaryPolity 一致の active House を候補とし、controlled Province 数が最大の House の leader を polity:leader に立てる（ownerHouse は常に候補に含まれるが、必ずしも ownerHouse leader が立つわけではない）。`polity.kind === 'commonwealth'` の場合は skip し、rebel founder 死亡後も leader 空席のまま polity を存続させる（commonwealth は rebel founder 個人を象徴とする一代政体として扱う）。

**年末 re-pass**: 本 system は週次スケジュール上では他の多くの system より前 (mortalitySystem の直後) に走るが、後続の death-causing system（plotSystem 等）が year-end tick で house:leader を殺すと、その tick では succession が走り終えており House が leaderless のまま年末 integrity check（§6.35 ルール 17）に到達してしまう。通常は翌年 week 1 の succession で自己修復する一過性状態だが、leaderless detector がこれを違反として throw する。これを防ぐため、**`tick.ts` は year-end (week = WEEKS_PER_YEAR) の integrity check 直前に `runSuccessionSystem` を再実行する**。leaderless な House/Polity が無い通常時は no-op（RNG 消費なし）であり、これにより「active 通常 House は年末時点で必ず house:leader を持つ」invariant が構造的に保証される。再実行は通常の succession と同じく、後継者がいれば新家長を任命し、**後継者不在なら `extinctHouseAfterFailedSuccession` で House を断絶させる**（leaderless のまま年末に残さない）。

### 6.12 HouseSplitSystem（SuccessionSystem から呼び出し）

継承が発生した際に、分裂条件を満たせば家の分裂を実行する。実体の状態書き換えは `splitHouse` mutation（`worldStructureMutations.ts`）に集約されている。

**分裂条件（AND）**:
1. `houseSplitEnabled: true`
2. `getHouseControlledProvinceIds(state, houseId).length >= minProvincesForHouseSplit`（デフォルト 3）
3. `splitCandidates.length >= 1`（後継者以外の成人候補が存在する）
4. `getHouseCohesion(house) < houseSplitCohesionThreshold`（デフォルト 60）

**splitter（分家 founder）候補の制約**:
- 当主（succession path では新当主 successor）を候補から除外する。
- さらに **継承順位上位 `houseSplitExcludeTopSuccessionRanks` 人（default 1）を除外**する。跡継ぎ（次期当主の最有力候補）が自ら分家を興すのは不自然なため。`getAdultSuccessionCandidates` の血統スコアは「house 内の死亡メンバー」基準で算出されるため、当主が生存している evaluation path（§6.13）では継承順位順にならない。そこで現当主（succession path では新当主）を基準に `getTopHeirIds(candidates, head, count, …)` で継承順位を再計算し、上位 `count` 人を除外する（候補プールは `getAdultSuccessionCandidates` と同一に保ち、sex gate の不一致で「除外したい跡継ぎが splitter プールに居ない」ズレを防ぐ）。
- evaluation path（§6.13）では加えて splitter を `young_adulthood` 以降に限る（§6.25）。

**分裂確率**:
```
currentCohesion = getHouseCohesion(house)   // Attitude から動的計算（§4.5 参照）
splitChance = baseHouseSplitChance
            + splitter.ambition        * houseSplitAmbitionFactor
            + splitter.legacyPrestige  * houseSplitPrestigeFactor
            + (getRoleScore(state, splitter.id, 'warCommand') / 10) * houseSplitMartialFactor
            - currentCohesion          * houseSplitCohesionFactor
```

分裂実行時の処理：
- 新 House を生成（`id: h-{parentId}-{year}`）
- 分裂者・その配偶者・子を新 House の `memberIds` に設定
- Province の一部（`houseSplitControlMin`〜`houseSplitControlMax` の割合）を新 House に移管
- 元 House の `cadetHouseIds` に追加、新 House の `parentHouseId` を設定
- 国の `houseIds` に新 House を追加

イベント: `HOUSE_SPLIT`（importance: `major`）+ `CADET_HOUSE_FOUNDED`（importance: `major`）+ `SUCCESSION_CRISIS`（importance: `major`、`fromSuccession` 時のみ）

**Share / cooldown 処理**:
- 分家に `creationKind: 'cadet_branch'` と `creationReason` (`'succession'` or `'house_split'`) を設定
- `initializeHouseShares` で新 House の HouseShare を即時初期化
- 移動元 House の古い Share を `removePersonSharesInHouse` で整理
- 両 House に `lastSplitWeek = absoluteWeek` を設定（cooldown 用）
- `houseSplitCooldownWeeks`（default 48）以内の再分裂を防止

### 6.13 HouseSplitEvaluationSystem（config 依存の周期）

巨大 House を定期評価して分家を生む scheduled system。`houseSplitEvaluationIntervalWeeks`（default 12）ごとに実行。

**条件**:
1. `houseSplitEnabled: true`
2. `house.kind !== 'system'`
3. cooldown 中でないこと（`lastSplitWeek + houseSplitCooldownWeeks > absoluteWeek` なら skip）
4. `livingMemberCount >= houseSplitMinLivingMembers`
5. `house.wealth >= houseSplitMinWealth`
6. `house.legacyPrestige >= houseSplitMinLegacyPrestige`
7. `getHouseControlledProvinceIds >= minProvincesForHouseSplit`
8. `getHouseCohesion < houseSplitCohesionThreshold`

候補選出は `getAdultSuccessionCandidates` → leader 除外 → 継承順位上位除外 + `young_adulthood` ゲート（§6.12「splitter 候補の制約」参照）→ `chooseSplitter`。

**succession path との違い**: evaluation path では `SUCCESSION_CRISIS` event を発火しない。`creationReason` は `'house_split'`

**cohesion（結束度）について**:
- `house.cohesion` フィールドは存在しない。`getHouseCohesion` セレクターで動的計算（§4.5 参照）
- 結束度は家メンバーの家長への attitude から計算されるため、態度変化イベントにより自然に変動する

### 6.14 未成年当主ペナルティ（SuccessionSystem 内）

当主が未成年（age < `adultAge`）の間、4 週ごとに適用。格納フィールドの直接変更ではなく、Attitude の調整を通じて cohesion・loyaltyToPolity に間接影響を与える（実装上は `minorHeadCohesionPenaltyPerMonth` / `minorHeadLoyaltyPenaltyPerMonth` の config 値が参照される）。

**配線**: ロジックは `successionSystem.ts` の `applyMinorHeadPenalties` に存在し、`successionSystem` の直後に専用 system `minorHeadPenaltySystem`（`intervalWeeks: 4`）として配線される。年末 succession re-pass（§6.11）は `runSuccessionSystem` のみを再実行するため、ペナルティを `runSuccessionSystem` 内に置かず独立 system にすることで week 48 での二重適用を回避している。

### 6.15 HouseExtinctionSystem（SuccessionSystem から呼び出し）

後継者が存在しない家（生存メンバーが 0 または全員未成年かつ成人後継者なし）に対して断絶処理を行う。実体の状態書き換えは `extinctHouse` mutation（`worldStructureMutations.ts`）に集約されている。

**House active 判定**: House active は memberIds（血統）ベースで判定され、土地を完全に失っても active=true のまま「無領家」として存続する（`house.provinceIds.length === 0` では断絶しない）。お家再興 / 復古試行は将来の Faction 段階で動的に発生する想定で、現状はデータ上の存続のみ許す。

**affectedPolityIds スナップショット**:

```ts
type HouseExtinctionInput = {
  houseId: HouseId
  affectedPolityIds: PolityId[]  // 喪失前の getHousePolityIds スナップショット
}
```

呼び出し側で所領喪失前の Polity 集合を取得しておき、メンバー移住先選定のスコープとして使う。

**継承先 House の選定**:

選定アルゴリズム `chooseReceiverHouse(state, extinctHouseId, scopePolityIds, excludeHouseIds?)`。
**Polity 単位**で呼び出す（後述の分割継承）。`excludeHouseIds` に含まれる House は
全 stage からハード除外する。

1. `scopePolityIds` 内で最大 controlled Province 数を持つ active 通常 House (system house 除外)
2. `scopePolityIds` 内で最大 Polity Share を持つ active 通常 House
3. 旧 `seatProvinceId` に隣接する Province の effective ownerHouse
4. 世界全体で最大 controlled Province 数を持つ active 通常 House (system house 除外)。
   count=0 の tie-break が House の挿入順に依存しないよう houseId 昇順で安定走査する
5. 見つからない場合、メンバーは inactive のまま House 解散

**Polity 継承（分割継承、two-phase decide → apply）**:

断絶家が ownerHouse である Polity は **Polity 単位で個別に**継承先を選ぶ。これにより、
「領土数が最大の House が空いた Polity 群を丸ごと総取りする」rich-get-richer ラチェット
（複数世代で全 Polity が単一 House に集中する退化）を防ぐ。

- **Phase 1 (decide)**: 断絶**前**の凍結 state に対し、断絶家が ownerHouse である各 Polity の継承先を
  独立に選ぶ。
  - **分家優先継承**: 断絶家に active な分家（`cadetHouseIds`）があれば、それを最優先で継承先にする。
    分家が無ければ active な親家（`parentHouseId`）。kin（分家群、無ければ親家）リストは凍結 state から
    1 回だけ算出し、各 Polity を `i % kin.length` の巡回で割り当てる:
    - 分家が 1 家 → 全 Polity をその分家が継ぐ（王朝が唯一の分家として存続）
    - 分家が複数 → 巡回で複数分家に分散（下記 rich-get-richer 防止と両立）
    kin 経路は同一王朝内での集約であり、「無関係な House のグローバル rich-get-richer」とは別物。
  - **kin が居ない場合**は従来どおり `chooseReceiverHouse` で選定し、各選定で `usedReceivers`
    （この断絶で既に他 Polity を割り当てた House 集合）をハード除外して別々の House へ分配する。
    除外で候補が尽きた場合のみ緩和して重複継承を許容する。
  - 逐次に owner を書き換えながら選定すると、先に継いだ House が controlled Province 最大になり
    stage 4 で残りも総取りするため、評価は必ず凍結 state に対して行う。
- **Phase 2 (apply)**: 各 Polity を Phase 1 の割当先へ継承させる（王朝交代）:
  - `Polity.ownerHouseId = receiver.id`
  - `polityIndex.byOwnerHouse` 同期更新
  - `polity:leader` Office を receiver House の leader に差し替え
  - `POLITY_OWNER_CHANGED` event を Polity ごとに発火
- LandContracts は変更しない（Polity と Province の関係は不変、王朝のみ交代）
- 生存メンバーは `moveLivingMembersToHouse` で **主継承先**（先頭 Polity の継承先。Polity を持たない
  断絶は従来スコープ `affectedPolityIds` で 1 House を選定）へ移動する（narrative のみ。土地は Polity
  単位で個別に動く）
- **財産（wealth）継承**: 断絶家の `wealth` を Polity 継承先へ按分する。継承先（`polityReceivers`）を
  normative source とし、受領 Polity 数で比例配分する（端数は主継承先へ）。分家優先で分家が receiver に
  なっていれば wealth も自動的に分家へ流れる。Polity を持たない没落（`polityReceivers` 空で継承先が
  定まらない）は据え置き（断絶家に残る）。
- 断絶家を `active: false`、`memberIds: []` に設定（wealth を継承した場合は `wealth: 0`）

**Polity の inactive 化は HouseExtinctionSystem で行わない**:
Polity の active 制御は §6.31 PolityOwnerConsistencySystem に一本化する。
これにより HouseExtinction → 所領消失 → 当月内に PolityOwnerConsistency が owner 補充または `POLITY_EXTINCT` 発火、という分離した責務になる。

イベント: `HOUSE_EXTINCT`（importance: `major`）

### 6.16 HouseFoundingSystem（config 依存の周期）

無家人物が条件を満たすと新 House を創設する system。`houseFoundingIntervalWeeks`（default 4）ごとに実行。

**候補条件**: alive / normal / `houseId === undefined` で、以下のいずれかを満たす:
- `wealth >= houseFoundingMinWealth` → reason: `'wealth'`
- `legacyPrestige >= houseFoundingMinPrestige` → reason: `'prestige'`
- active な OfficeAssignment または HoldingOfficeAssignment を保持 → reason: `'office'`
- `personActivityLogIndex` のログ数が `houseFoundingMinActivityLogs` 以上 → reason: `'prestige'`

**処理フロー**:
1. 候補を収集し、shuffle（RNG 順序保証）
2. 候補ごとに `houseFoundingMonthlyChance` で確率ロール
3. `seatProvinceId` を決定（優先順: HoldingOffice の Province → Polity Office の capitalProvince → ランダム Province）
4. 新 House を生成（`creationKind: 'self_made_foundation'`、`creationReason` は判定条件由来）
5. founder の wealth の `houseFoundingWealthTransferRate`（default 0.5）を新 House に移転
6. `legacyPrestige` を `floor(founder.legacyPrestige * 0.5)` で設定
7. founder を `house:leader` Office に任命
8. `founderFamilyGenerationEnabled` が true なら家族を後付け生成（配偶者・子供、年齢に応じた確率）
9. `initializeHouseShares` で HouseShare を即時初期化
10. `HOUSE_FOUNDED` event を発火

**1 月あたり最大** `houseFoundingMaxPerMonth` 家まで創設。

イベント: `HOUSE_FOUNDED`（importance: `major`）

### 6.17 ClanFormationSystem（config 依存の周期）

年 1 回（`clanFormationIntervalWeeks`, default 48）。2 つの処理を行う。

**Part 1: 新規 Clan 成立判定**

active / normal / clanId undefined の各 House を root candidate として以下を評価:

1. **分家数条件**: active direct cadet 数 >= `clanFormationMinDirectCadetHouses`
2. **影響力条件**: formation group に ruling house が含まれる、または `isInfluentialHouse` が `clanFormationMinInfluentialHouses` 以上
3. **量的条件**: formation group の total living members / wealth / legacyPrestige のいずれかが閾値以上

3 条件すべてを満たすと Clan を成立させる。所属範囲は formation group（direct cadet のみ）ではなく、rootHouseId から下方向の全 descendant House。すでに別の clanId を持つ descendant とその下位はスキップする。**inactive（断絶）House は Clan メンバーに含めない**：`collectMemberHouseIds` は active な House のみを memberHouseIds に積む（clanId 付与・カウント汚染を防ぐ）。ただし inactive な中間 House の配下に active な子孫がある場合に到達できるよう、traversal 自体は inactive House も貫通する。

イベント: `CLAN_FOUNDED`（importance: `major`）

**Part 2: 既存 Clan の年次保守**

- member House の cadet に clanId 未設定の normal House があれば同 Clan に追加（防御的フォールバック）
- `syncClanActive`: memberHouseIds のうち active normal House が 0 になれば `clan.active = false`

House 絶滅時の即時 `syncClanActive` は `handleNormalHouseExtinction`（`worldStructureMutations.ts`）の末尾で実行される。

### 6.18 HouselessPersonGenerationSystem（4週ごと）

無家人物を生成・維持する。config key は `houseless*`（`houselessPersonsPerHolding` / `houselessMaleRatio` / `targetHouselessPersons` / `softMaxHouselessPersons` / `hardMaxHouselessPersons` / `houselessProtectionYears`）。

無家人物は `houseId === undefined` の normal Person として `state.persons` に直接追加される。House の `memberIds` には含まれない。

### 6.19 AppointmentSystem（12週ごと = 3ヶ月ごと）

Polity と House それぞれの役職（leader 以外の 4 種）に対して、空席を最適候補で補充する。

**対象役職**:
- Polity: administrator / treasurer / military / advisor
- House: administrator / treasurer / military / advisor
- leader は AppointmentSystem が直接補充しない（SuccessionSystem が担当）

**候補スコア（Polity 役職）**:
```ts
score = relevantStat(role) * 1.0          // military → warCommand、他 → governance（派生 selector）
      + (prestige / 100) * 8              // getPersonPrestige
      + leaderRespect * 4                 // polity leader の attitude.respect（0..1 正規化）
      + polityAffection * 3               // 候補者の対 Polity attitude.affection
      + houseInfluencePct * polityInfluenceAppointmentFactor  // 候補者の家の Polity Influence%（§6.64、既定 0.25。v0.42: 旧 share%）
      + personSharePct * houseShareAppointmentFactor  // 候補者個人の House Share 割合（既定 0.08）
      + ownerHouseBonus                   // 候補者の家が polity.ownerHouseId なら ownerHouseAppointmentBonus（既定 4）
      + appointmentRightBonus             // v0.42: 対象 role に polity_office_appointment right がある場合の補正（下記）
      - getOfficeCompatibilityPenalty(...)  // 兼任互換ペナルティ。compatible-pair の軽減入力も influence%（v0.42）
      - sameHousePolityOfficePenalty * (1 - houseInfluencePct / 100) * sameHousePolityOfficeCount  // 同 House の Polity Office 数を influence 重みで減点
      - oldAgeAppointmentScorePenalty      // old_age なら固定減算（§6.25）
```

**候補者条件**: alive かつ `young_adulthood` 以降 / active House 所属 / 同 role を未保有 / 以下のいずれか:
1. その House が対象 Polity 内に Province を所有する
2. その House が対象 Polity の `ownerHouseId` である（owner が一時的に Province を失っていても候補に残す）

また、active な HoldingOffice (Bailiff) を保有する人物は Polity / House / factional の各候補プールから除外する。候補収集は 'traditional' 候補に加え faction が推す 'factional' 候補も含む。

**polity_office_appointment right の接続 (v0.42)**: 充足対象 slot（下記「任命判定」）に active な `polity_office_appointment` right（§6.64 — v0.42 slot 化で right は (polity, role, slot) 単位）がある場合:
- **unrelated factional path は使わない**（任命権は制度的権利として派閥推薦より優先）
- right holder の候補を pool に追加する（traditional pool 外の House member / Person 本人も対象）
- スコア補正: holder House の member に `polityOfficeAppointmentRightHouseBonus`（既定 30 — influence% 項の最大値を上回る水準。それでも能力差で覆りうる）、holder Person 本人に `polityOfficeAppointmentRightPersonBonus`（35）、その家の member に同 AssociatedBonus（18）
- **right-backed faction（最大 1 つ）**: right holder と最も関係の強い anchor Faction を 5 段階（holder Person の所属 → holder House leader の所属 → member 最多 → faction leader が holder House 所属 → factionId 昇順）で 1 つ選定し、その active member に `rightBackedFactionBonus`（10 < HouseBonus）を加算

**House factional path の廃止 (v0.42)**: House office 任命への factional path は廃止（Faction は Polity 内政治装置 — §6.31 anchor 参照）。House office は traditional スコアリングのみ。また faction opportunity（member cap 原資）から House office slot を除外し、polity slot の share% 参照は influence% に置換。

**候補スコア（House 役職）**:
```ts
score = relevantStat(role) * 1.0
      + (prestige / 100) * 10
      + leaderRespect * 5                // 家長の attitude.respect
      + houseAffection * 3              // 候補者の対 House attitude.affection
      + personSharePct * 0.1            // 候補者の House Share 割合
      - getOfficeCompatibilityPenalty(...)  // 兼任互換ペナルティ（§14.5）
      - oldAgeAppointmentScorePenalty      // old_age なら固定減算（§6.25）
```

**任命判定**:
- 最高スコア候補が `minAppointmentScore` 未満の場合は任命しない（空席を維持）
- **Polity 役職は slot ベースの空席判定（v0.42 slot 化）**: `getEffectiveOfficeMaxHolders` で動的
  slot 数を算出し、slot 0..effectiveMax-1 のうち**未着座の最若 slot 1 つ**を 1 回の実行で充足する
  （人数 count ベースではない — 縮小直後に「後ろの slot に着座者が残り count == max だが前の slot
  が空き」というケースがあり、count 判定だと前の空き slot が永久に埋まらない）。right の参照・
  `createOfficeAssignment` への slot 明示渡しもこの充足対象 slot に対して行う
  - Polity 役職: `polityOfficeMaxByRank[rank][role]` × province 数係数で決定。`rankCap = 0` の場合はその役職を設置不可（例: rank 4 伯領は administrator のみ）
  - House 役職: leader 以外は一律 maxHolders = 1（slot は常に 0）
- 死亡者の役職は自動的に revoke される

**House 役職の支払能力ゲート**: House 役職（有給 = administrator/treasurer/military/advisor）は、家が定常的に得る年間収入で既存役職＋新規役職の年間給与を賄えない場合は任命しない（leader は `baseSalary=0` なので常に対象外。Polity 役職は財庫から支払われ実測上ほぼ未払いにならないため不問）。
- 投影年間収入 `getHouseProjectedAnnualIncome` = 家が定常的に得る収入の投影。定常収入は **PolitySurplusDistribution（§6.5、v0.42: influence 比例）のみ**で、estate settlement や外交移転など不定期な収入は含めない。`Σ_polity（家の influence% × getPolityDistributablePerCycle）× 12`（走査対象は家が土地で関与する polity。office/right のみの取り分は投影に含めず過小評価側に倒す）。
- 任命可否: `getHouseAnnualOfficeSalary（既存 active house 役職の baseSalary 合計）+ 新役職 baseSalary ≤ 投影年間収入` のときのみ任命。
- 動機: 収入の無い landless 小家系が役職を抱え、`OFFICE_SALARY_UNPAID` を量産する不自然さを解消（実測で家由来の未払いイベントが 100 年あたり 22〜27 万件 → 0 に）。有力 landed 大家系は投影収入が十分で全役職を維持する（landless→有給役職 0、landed→従来どおり、という二分が観測される）。
- UI: House DetailPanel に「想定年収 / 役職給与 / 役職収支」を表示（`getHouseProjectedAnnualBalance`）。
- 既存役職は本ゲートの対象外。`OfficeTermSystem`の任期満了 revoke を経て自然に再任命ゲートを通るため、収入を失った家の役職は数年のラグで減衰する。
- 将来: 形骸化した帝国/王国の Polity 役職を「名誉職」として残す仕組みは今後の課題。現状は単純に収入ベースの役職数とする。

**Task 補正**: `getAppointmentTaskModifier(state, personId, organization, role)` による Person Aim / Task 効果の補正を候補スコアに加算。obtain_office / retain_office Aim が active、または seek_office_support / display_competence の直近 ActivityLog がある候補は +appointmentTaskModifierValue（デフォルト 4）の補正を受ける。

**イベント**: `OFFICE_ASSIGNED`（importance: `normal`）

### 6.20 OfficeCompensationSystem（4週ごと）

アクティブな OfficeAssignment に対して、`baseSalary`（§3.7 参照）に基づく給与を支払う。

- 支払元: Polity 役職 → `polity.treasury`、House 役職 → `house.wealth`
- 支払先: `person.wealth += paid`
- 資金不足時は部分支払いまたは未払い
- 未払い・部分支払い時: `office.unpaidCount` を増加し、Person の Attitude（対 Polity / 対 House の affection・respect）にペナルティを付与
  - ペナルティは `officeDignityUnpaidPenaltyReduction` × dignity 値で軽減
- `unpaidCount` が 0 の完全支払い時にはリセット

bailiff（HoldingOfficeAssignment）の給与支払いは本 system では行わない。代官の収入は LandRevenueSystem 内の `bailiffFee`（§6.4.2）に一本化されている。

House 役職の `OFFICE_SALARY_UNPAID` は AppointmentSystem の支払能力ゲート（§6.19）で発生源を抑止する（収入で賄えない家にはそもそも有給役職を任命しない）。本 system 自体の支払いロジックには影響しない。

**イベント**: `OFFICE_SALARY_UNPAID`（importance: `minor`）/ `OFFICE_SALARY_PARTIALLY_PAID`（importance: `minor`）

### 6.21 BailiffRevenueTaskSystem（4週ごと）

代官の月次徴税業務 Task を管理する。

**責務**:
1. 前回の未完了 `collect_holding_revenue` Task を期限切れ処理する
2. 今月分の `collect_holding_revenue` Task を生成する
3. placeholder 代官は除外する

**生成条件**:
- `assignment.role === 'bailiff'` / `assignment.active === true`
- `holderPersonId` が通常人物（`kind !== 'placeholder'`）かつ `alive`

**期限切れ処理**: 同じ `holding_office_assignment` を target に持つ active `collect_holding_revenue` Task が残っている場合、`failTaskAsExpired` で締め、`PersonActivityLog`（`kind: 'task_expired'`, `outcome: 'failure'`）を作成する。

**Task パラメータ**:
```ts
kind: 'collect_holding_revenue'
targetRef: { kind: 'holding_office_assignment', id: assignment.id }
priority: 1
actionCost: config.taskActionCostLight
effortRequired: Math.ceil(config.taskEffortRequiredLight * 1.5)
deadlineWeek: absoluteWeek + 4
```

Task の実際の処理（effort 消費 → 完了）は既存 TaskSystem に任せる。`collect_holding_revenue` は既存 Task と `weeklyActionCapacity` を共有する。

### 6.22 BailiffAppointmentSystem（12週ごと = 季節ごと）

terminal Polity ごとに HoldingOfficeAssignment (Bailiff) を走査し、placeholder Person で空席化している **Holding** を通常人物で埋める。逆に、通常人物の Bailiff が死亡・離反などで不在化した場合は placeholder Person に戻す。

**任期判定**: `absoluteWeek - office.startWeek >= termYears * WEEKS_PER_YEAR`。

**候補者選定（v0.42: Tier 制）**:
- **Tier 0**: 当該 Holding に `holding_office_appointment` right（§6.64）があれば、right holder（House なら free adult member / Person なら本人）を最優先
- **Tier 1**: factional 候補（NP ≥ threshold の faction の active member。v0.42: faction の任命介入は **anchor Polity が terminal の Holding に限定** — NP が非 anchor polity に対して 0 を返すことで実現）
- **Tier 2**: ownerHouse の free adult member（numeracy + insight 降順）
- 適任者が居なければ placeholder のまま

**fall-through の設計意図 (v0.42)**: right があっても Tier 0 が候補を出せない場合は Tier 1 / 2 へ落ちる。
これは polity office（right がある role では unrelated factional path を skip）と**意図的に異なる**扱いで、
形式上の不統一ではなく役職の性質の違いによる — bailiff は Holding の徴税・管理を実務的に担う現場職であり、
空席・placeholder が長く続くと土地収益や develop_holding 周辺に悪影響が出るため、行政実務を止めない。
（polity office は空席のままでも国は回る。）

**commonwealth の扱い**: `ownerHouseId` を持たない commonwealth / rebel polity は本 system の対象外（現行スキップ）。
そのため holding right があってもこれらの Polity では v0.42 時点で行使されない（統治機構整理は future）。

**イベント**:
- `BAILIFF_APPOINTED`（importance: `minor`）: placeholder → 通常人物に交代
- `BAILIFF_VACATED`（importance: `normal`）: 通常人物が不在化
- `BAILIFF_PLACEHOLDER_INSTALLED`（importance: `minor`）: terminal Polity 変更時に placeholder を新規設置

commonwealth (`ownerHouseId === undefined`) Polity の Bailiff 候補者選定は Faction 段階まで持ち越し。

### 6.23 HouseShareUpdateSystem（48週ごと = 毎年）

House の Share 分布を毎年更新する（v0.42: 旧 ShareUpdateSystem。Polity share は全廃され、
Polity の権力分布は Polity Influence read-model（§6.64）で導出される。Polity share 更新枝・
shareYearlyRetentionRate・person-holder polity share はすべて削除）。

**House Share 更新（Person ホルダーの Share を計算）**:
```ts
newRawPower = houseShareBase
            + (isLeader ? houseShareLeaderBonus : 0)
            + houseOfficeCount * houseShareOfficeBonus
            + person.legacyPrestige * houseSharePrestigeFactor
            + person.wealth * houseShareWealthFactor
            + (governance + warCommand) * houseShareStatFactor   // getRoleScore(governance + warCommand) / 10
```

**イベント**: `SHARE_SHIFTED`（importance: `minor`）— Share 分布に有意な変化があった場合

### 6.24 PersonGrowthSystem（48週ごと = 毎年）

`OfficeCompensationSystem` の直後・`AmbitionSystem` の前に実行。48 週ごと（ScheduledSystem で制御）。

毎年 1 月に全 alive Person の 6 基礎能力それぞれについて、**成長判定** と **衰退判定** を行う。

**成長判定**:
```ts
const naturalCeil    = aptitude[k] * naturalFraction(k, age, config)
const effectiveCeil  = hadRelevantExperience(state, personId, k) ? aptitude[k] : naturalCeil
if (ability[k] < effectiveCeil) {
  const gainChance = abilityGrowthChanceBase * (1 - ability[k] / effectiveCeil)
  if (rng < gainChance / 100) ability[k] = min(ability[k] + 1, ABILITY_HARD_CAP)
}
```

* **経験あり** → `effectiveCeil = aptitude[k]`（能力は aptitude を目指して伸びる）
* **経験なし** → `effectiveCeil = naturalCeil`（年齢曲線の自然到達水準で頭打ち）

**訓練経験**: `personTrainingExperience` がある場合、成長判定の `gainChance` に bonus を加算する。年次処理後、使用した ability の experience を `trainingExperienceDecayRate`（0.5）倍に減衰させる（50% 残留）。値が 0.1 未満になった場合は削除。

**衰退判定**: `youthPeak` / `midLifePeak` 曲線の能力で、`ability > naturalCeil` の場合に発火。経験あり人物は `abilityActiveDeclineMultiplier`（0.3）で衰退速度が鈍化する。`lifelongGrowth`（numeracy / learning）は衰退しない。

**経験イベント対応表（hadRelevantExperience）**:

| 経験 | 成長対象 |
|---|---|
| Polity leader 在任 | command, charisma, insight, learning |
| House leader 在任 | command, charisma, insight |
| Polity administrator (chancellor) 在任 | numeracy, learning, charisma |
| Polity/House treasurer 在任 | numeracy, learning |
| Polity military (general) 在任 | command, learning |
| House military (marshal) 在任 | command, valor |
| 戦争 active 期間中（48 週以内に lastWarWeek）の在国 | valor, command |
| PlotSystem の active リーダー | insight |
| improve_ability Task の personTrainingExperience | 対象 ability |

### 6.25 LifeStage システム群（48週ごと = 毎年）

人物に人生段階（`LifeStage`）を導入し、年次で一方向に進める。社会活動資格・登用優先度・幼少期の社会的影響（Attitude / 能力成長補助）を LifeStage で表現する。

**重要原則（二重適用の禁止）**: 能力成長カーブ（`ABILITY_AGE_CURVES` + `naturalFraction`）は **LifeStage で補正しない**。age-curve が伸び/衰退を既に表現しており、LifeStage 乗算を重ねるとバランスが崩れる。LifeStage が能力に関与するのは「親能力ボーナス」のみ（下記）。

#### LifeStageInfluenceSystem（DisasterSystem 直後・LifeStageProgressionSystem 直前）

幼年期 / 思春期の人物が、親・家 leader・同家成人・親 faction member の Attitude を少しずつ継承する（「思想」形成の最初の実装）。**RNG 不使用の決定的処理**。

- 対象: alive / normal / `lifeStage === 'childhood' || 'adolescence'`（placeholder 除外）。
- 影響元収集順（deterministic）: 父 → 母 → 同 House leader → 同家成人（`young_adulthood` 以降、PersonId 昇順）→ 親 active faction の active member（PersonId 昇順）。重複排除のうえ合計上限 `maxLifeStageInfluencersPerChild`（5）。father/mother を最優先。
- 継承 target: influencer の attitudes のうち **person / house を指すもののみ**（polity は継承しない）。さらに **現存するエンティティのみ**（`person:` は生存している人物 `alive`、`house:` は active な家）。故人・消滅した家への感情は継承しない（噂でだけ知る対象は現段階では非対象。将来拡張候補は §13）。`abs(affection)+abs(respect)` 降順・key 昇順で上位 `maxAttitudeTargetsInheritedPerInfluencer`（3）を、この**現存フィルタ適用後**に選ぶ。child 自身を指す target は除外。
- 適用: `lerpAttitude(current, target, rate)` で child の attitude を influencer の attitude へ rate だけ近づける（clamp ±100）。rate は影響元種別 × LifeStage のテーブル（§9 config）。
- 既存 `attitudeDecaySystem` とは独立に毎年作用する。

#### LifeStageProgressionSystem（LifeStageInfluenceSystem 直後）

`advanceTime` で age が上がった後に走り、age が遷移範囲に達した人物を確率的に次段階へ進める。

- 対象: alive / normal / `lifeStage !== 'old_age'`（placeholder 除外）。`livingPersonIds` を iterate。
- 遷移先ごとに `config.lifeStageTransitionAges[next]` の `{minAge, standardAge, maxAge}` を参照。`age < minAge` は遷移しない / `minAge <= age < standardAge` は early 確率 / `standardAge <= age < maxAge` は standard 確率 / `age >= maxAge` は必ず遷移。
- RNG は既存の関数型パターン（`randomFloat` で thread）。逆行は writer 側で構造的に防ぐ（IntegrityCheck は逆行検査をせず、緩い age-lifeStage envelope のみ。§6.35 / §13）。
- **life event emit**: `adolescence→young_adulthood` で `PERSON_CAME_OF_AGE`、`mature_adulthood→old_age` で `PERSON_ENTERED_OLD_AGE`（他の遷移は emit しない）。
  - **notable 判定（安価な index ベースに限定）**: house leader / polity leader / active office holder のいずれかなら notable。`calcPersonImportanceScore` は全人物の年次遷移ごとに呼ぶには高コストのため**使わない**。war 時の field commander / captain general は O(1) index がなく（war side の soft reference のみ）、コスト優先で notable 判定からは**省略**する。
  - importance: notable=`normal` / 一般=`minor`。entityRefs を出し分け（一般=`[person]` → byPerson のみ / 主要=`[person, house, polity]` → byPerson+byHouse+byPolity）。Chronicle allowlist は `{ category: 'life' }`（`retainRefKinds` 無指定。§6.62）。
  - 全人物の成人・老年入りが個人 Chronicle（byPerson）に残り、主要人物のみ House/Polity Chronicle とメイン EventLog に載る（§11）。

#### 親能力ボーナス（PersonGrowthSystem §6.24 内）

childhood / adolescence の人物について、`personGrowthSystem` の**成長ブロック内**（`ability < effectiveCeil && effectiveCeil > 0`）でのみ、living な父母の該当 ability 平均が子より高ければ `gainChance` に `parentalAbilityGrowthChanceBonus`（2.0pp）を加算する。死亡済み親は含めない。`aptitudes` / `effectiveCeil` / `naturalFraction` は不変（age-curve には触れない）。新生児は `effectiveCeil = 0` で成長ブロックに入らずボーナスも効かない。

#### 社会活動資格の `young_adulthood` 化

`age >= config.adultAge`（15）で見ていた**社会活動・政治活動の資格**を `isLifeStageAtLeast(lifeStage, 'young_adulthood')`（標準 19 歳相当）へ置換する。置換対象: Appointment 候補 / Faction 成立・参加・recruitment / PersonGoal・PersonAim 生成 / Plot 参加 / Project actor・Bailiff candidate / House founding（founder 本人）/ House split（splitter＝cadet house の founder）。

**据え置き（age config のまま）**: Succession（`adultAge`=15。minor-heir ペナルティ経路と結合するため）/ Marriage / Birth / BailiffMinAge / WeeklyActionCapacity / Worldgen 初期 leader。House split は succession 用 `getAdultSuccessionCandidates`（age 15）を変えず、splitter にのみ `young_adulthood` フィルタを追加する。

#### old_age 登用ペナルティ

old_age の人物は新規登用・指揮官選定で優先度が下がる（引退・除外ではない）。

- **Appointment / delegate（固定減算）**: `computePolityScoreV017` / `computeHouseScoreV017` の候補スコアに `- oldAgeAppointmentScorePenalty`（5）。これらのスコアは `compatibilityPenalty` 等で負値になりうるため、乗算でなく**固定減算**で単調に不利化する。delegate は office 優先順（advisor→administrator→leader）で選ばれスコアを持たないため、old_age 反映は上流の appointment スコアで実現する（delegate 専用の減算 path は無い）。
- **commander / captain general（乗算）**: `warManeuverSelectors` の選定スコア（`warCommand` role score ベース＝常に非負）に `* oldAgeCommandScoreMultiplier`（0.8）。候補からの**除外はしない**（指揮官不在を避ける）。選定（候補ソート順）にのみ適用し、battle 内部の `fieldCommandScore`（戦闘効果）には適用しない。

### 6.26 AmbitionSystem（4週ごと）

人物・家ごとに野心スコアを計算し、将来の陰謀・反乱の素地を作る。

### 6.27 PlotSystem（4週ごと）

`plotTendency` が `plotThreshold` 以上の家当主が陰謀を起こす。plot type は prepare_rebellion / seize_office / replace_house_leader。成功率は `basePlotSuccess` を基点に、首謀者の governance / warCommand role score、plot の power / secrecy、対象の防御力・risk から算出し 0.05〜0.95 にクランプする。

**解決済み plot の扱い**: 期限到達で解決した plot は、PLOT_SUCCEEDED / PLOT_FAILED イベントを emit した上で `activePlots` から削除する。plot の全 reader（PlotSystem の active 判定、`hadRelevantExperience` の insight 経験）は `status === 'active'` で filter するため、解決済み record を残しても読まれず dead weight として累積するだけだった。これを防ぐため解決時に削除する（挙動は変わらない）。

### 6.28 TaxRevisionSystem（48週ごと）

土地保有者 Polity が LandContract の税率を引き上げる。provinceRevoltSystem より前に実行し、税率↑ → unrest↑ → 叛乱の循環を形成する。

対象: active Polity の terminal holding（commonwealth・revolt_seizure 契約・cooldown 中・active revolt_negotiation 対象を除外）。

判断: increaseScore（treasury 不足・低 unrest・leader ambition・戦争中）vs avoidScore（高 unrest・recent revolt・高税率・leader caution/insight）で判定。上昇幅 +0.02〜0.05、`taxRevisionSystemMaxRate` でキャップ。`taxIncreaseCooldownUntilWeek` で連続増税を防止。

### 6.29 ProvinceRevoltSystem（12週ごと）

Holding 単位で判定する。交渉用 commonwealth（landless）を生成し `revolt_negotiation` DiplomaticPlay を開始する。

**Holding 単位 revoltTendency**:

```
revoltTendency =
  pop.unrest * unrestFactor
  + (100 - polityControl) * (provinceRevoltLowHouseControlFactor + provinceRevoltLowCountryControlFactor)  // 既定 0.2 + 0.2 = 0.4
  - stability * stabilityFactor
  + [class 別補正]
  + taxBurden * taxBurdenWeight
  + recentTaxIncrease * weight * decay
  - recentSuppression * reduction * decay
```

低 polityControl 項は `provinceRevoltLowHouseControlFactor`（0.2）と `provinceRevoltLowCountryControlFactor`（0.2）の 2 つの factor を同じ `(100 - polityControl)` に乗じて加算する（合計係数 0.4）。

taxBurden = `max(0, currentTaxRate - defaultTaxRateByRank(rank))`。

**発生時の処理** (`resolveHoldingRevolt`):
1. `createNegotiatingCommonwealth` で交渉用 commonwealth 生成（landless、rank 5、treasury 0）
2. Leader 選出: 在野人物優先（charisma+command+insight+ambition スコア）→ 不在時新規生成
3. `popular_tax_relief` demand 付き `revolt_negotiation` DiplomaticPlay 生成
4. `REVOLT_POLITY_FOUNDED` + `REVOLT_NEGOTIATION_STARTED` event

**交渉結果**（diplomaticPlaySystem 内）:
- settlement: 税率引き下げ、`termsProtectedUntilWeek` 設定、commonwealth 解散（leader は在野へ）、`REVOLT_SETTLED`
- escalation (rank 2-4): `revolt_seizure` 子契約追加 → Local Levy 生成 → **奪取 holding の既存常設連隊（worldgen 由来 levy/noble_retinue 等）の owner を commonwealth へ即同期** → `escalated` → warCreationSystem が War 化
  - 奪取で holding の terminal Polity は commonwealth に変わるが、owner 付け替えを担う RegimentMaintenanceSystem（§6.49）は warManeuverSystem の**後**に走るため、奪取→即開戦の叛乱には間に合わない（放置すると当該常設連隊が領主=defender 側として動員され、叛乱側は Local Levy 1 個のみで戦う）。そこで escalation 時点で当該 holding の Regiment 群（`regimentIndex.byHomeHolding[holdingId]`）に `syncRegimentOwnerToHomeTerminalMut`（§6.49 と同一ヘルパー＝同一ルール）を eager 適用し、開戦前に叛乱側へ移管する。直前に生成した Local Levy（owner=commonwealth）は no-op、動員済の連隊は owner だけ移り当該 War では `currentWarId` 判定でスキップされる。叛乱敗北で holding が領主へ revert すれば §6.49 が owner を領主へ戻す（active 連隊プールは枯渇しない）。
- escalation (rank 5): internal revolt 即時解決（§6.30）

### 6.30 Rank 5 Internal Popular Revolt

rank 5 Polity 内の叛乱は War 化せず、diplomaticPlaySystem 内で即時解決する。

力の比較: rebelPower（POP size × unrest + leader charisma/command/ambition）vs defenderPower（polityControl + leader command/caution）。

成功時: 既存 Polity を commonwealth に変換（`origin: regime_changed_by_popular_revolt`、`revoltState: established`）。旧 leader revoke、rebel leader 任命、Share 差替、税率引下、POP attitude ブースト、旧 ownerHouse attitude ペナルティ。`REVOLT_REGIME_CHANGED` event。

失敗時: commonwealth 解散（leader executed/pardoned）、unrest 低下、`lastRevoltSuppressedWeek` 記録。`REVOLT_SUPPRESSED` event。

**commonwealth 解散の cascade**（`dissolveNegotiatingCommonwealth` — settlement / 鎮圧 / revolt War 敗北の `suppressRevolt` で共通）: polity を inactive 化する際、§6.31 Step 1 の Polity 消滅と同等の cascade を実行する — 全 office revoke + `removeRightsByPolity`（R2）+ anchor Faction の即時解散（F8、`FACTION_DISSOLVED` reason=anchor_polity_dissolved）。Faction cascade は §6.31 と共有の `dissolveFactionsAnchoredToPolity` ヘルパーに集約されており、polity を inactive 化する経路は必ずこれを経由する（FactionLifecycle の anchor_polity_dissolved 判定は年次実行のため安全網にしかならず、cascade 欠落は年末 integrity F8 違反として顕在化する）。

### 6.31 PolityOwnerConsistencySystem（4週ごと）

War / Rebellion / ProvinceRevolt 等の所領変動 system の直後に走り、`Polity.ownerHouseId` の整合性を補正する。

active Polity を id 昇順に走査し、以下のステップを順に行う（疑似コード）:

```
for each polity in active polities:
  provinceIds = getPolityProvinceIds(state, polity.id)

  // Step 1: provinceIds = 0 なら Polity 自体を消滅させる
  // ただし negotiating/established commonwealth (kind === 'commonwealth' && revoltState != null) は除外する
  if provinceIds.length === 0 and not (polity.kind === 'commonwealth' and polity.revoltState != null):
    emit POLITY_LANDLESS   // importance: major。deactivate 前に発火
    deactivate polity
    revokeOfficesByOrganization({ kind: 'polity', id: polity.id })
    removeRightsByPolity(polity.id)        // v0.42: PoliticalRight の即時 cascade (§6.64)
    dissolveAnchoredFactions(polity.id)    // v0.42: anchor Faction の即時解散 (F8 を年末 integrity 前に守る。
                                           //   FactionLifecycle は年次 weekOfYear 1 実行のため安全網にしかならない)
    emit POLITY_EXTINCT (+ FACTION_DISSOLVED)
    continue

  eligibleHouseIds = getPolityHouseIds(state, polity.id)

  // established commonwealth の緊急 leader 補充:
  // kind === 'commonwealth' && revoltState?.kind === 'established' で polity:leader が居ない場合、
  // selectOrCreateCommonwealthLeader で leader を選定/生成し、leader Office を作成して continue
  // （commonwealth を headless にしない）。
  // v0.42c: 旧「100% person-direct share」は polity share 全廃に伴い作成しない。
  // commonwealth leader の影響力は Polity Influence の ruler domain（§6.64）で表現される。
  if polity.kind === 'commonwealth' and polity.revoltState?.kind === 'established' and no polity:leader:
    selectOrCreateCommonwealthLeader(...)  // leader Office のみ
    continue

  // Step 2: ownerHouseId 未設定なら新規補充
  if polity.ownerHouseId === undefined:
    if polity.kind === 'commonwealth': continue  // commonwealth は undefined を恒常的に許容
    newOwner = chooseOwner(eligibleHouseIds)  // eligibleHouseIds が空なら findFallbackOwnerHouse
    polity.ownerHouseId = newOwner
    polity.capitalProvinceId = getHouseSeatProvinceInPolity(newOwner, polity.id)
    replace polity:leader Office (revoke + assign new owner-house leader)
    emit POLITY_OWNER_CHANGED

  // Step 3: ownerHouse が inactive または Polity 内に Province なしなら交代
  if ownerHouse is invalid:
    if polity.kind === 'commonwealth': continue  // defensive skip
    newOwner = chooseOwner(eligibleHouseIds)  // eligibleHouseIds が空なら findFallbackOwnerHouse
    polity.ownerHouseId = newOwner
    polity.capitalProvinceId = getHouseSeatProvinceInPolity(newOwner, polity.id)
    replace polity:leader Office
    emit POLITY_OWNER_CHANGED
```

**chooseOwner（§10.2 選定順）**:

1. 対象 Polity 内に保有する Holding 数が最大（`holdingCount` = 当該 Polity 内の house 所有 Province の `holdingIds.length` 合計）
2. 同数なら local military proxy（Polity 内 Province の `getProvinceDevelopmentFromHoldings` 合計を proxy として使用）が最大
3. 同値なら `house.legacyPrestige` が最大
4. 同値なら HouseId 昇順

**findFallbackOwnerHouse（global fallback）**: `eligibleHouseIds` が空の場合は Polity を消滅させず、`findFallbackOwnerHouse` が世界全体から legacyPrestige 最大の active normal House を選んで owner に据える（その House が当該 Polity 内に Province を持たなくてもよい）。これは chain 長 1 で eligible house が居なくなり LandContract grantee が dangling 化するのを防ぐための救済。

**事後条件**:
- 全 active Polity について `ownerHouseId` が存在する。通常は ownerHouse が active かつ Polity 内に Province を持つが、global fallback で選ばれた owner は当該 Polity 内に Province を持たないことがある
- 全 Polity の `capitalProvinceId` はその Polity 内の Province を指す
- owner 交代と同月内に `polity:leader` Office が補充されている

イベント: `POLITY_LANDLESS`（importance: `major`）/ `POLITY_OWNER_CHANGED`（importance: `major`）/ `POLITY_EXTINCT`（importance: `major`）

### 6.32 OrganizationConsistencySystem（4週ごと）

PolityOwnerConsistencySystem の直後に走り、Polity Office の保持資格を監査する。
（v0.42c: 旧 Step 1「不適格 Polity share 削除」は polity share 全廃に伴い削除。）

```
for each polity in active polities:
  eligibleHouseIds = getPolityHouseIds(state, polity.id)

  // Step 2: 不適格 Polity Office revoke
  for each active office where organization is { kind: 'polity', id: polity.id }:
    person = state.persons[office.holderPersonId]
    if not person.alive: continue  // 別系統の不整合（IntegrityCheck で検知）
    if polity.kind === 'commonwealth': continue
      // commonwealth holder は houseId 不問で eligible (person-direct モデル)

    // v0.42: Right 由来任命の例外（狭い判定）。着座 slot に active な
    // polity_office_appointment right (§6.64) があり、holder が House なら同 House の
    // holder を、Person なら本人のみを eligible 扱いする。
    // この例外が無いと right による任命が最大 4 週で黙って revoke され right system が機能しない。
    // right が失効・移転した後の holder は保護を失い通常 revoke の対象に戻る（許容挙動）。
    // v0.42 slot 化: 保護は着座 slot (office.slotIndex) の right に限る。
    // 同 role の別 slot の right では保護されない（slot 照合）。
    right = getPolityOfficeAppointmentRight(state, polity.id, office.role, office.slotIndex)
    if right and ((right.holder is House and person.houseId === right.holder.id)
               or (right.holder is Person and office.holderPersonId === right.holder.id)):
      continue

    if not person.houseId:
      // 非 commonwealth の houseless holder は revoke
      revokeOfficeAssignment(office.id)
      emit OFFICE_REVOKED
      continue
    house = state.houses[person.houseId]
    houseEligible = house and house.active and house.id in eligibleHouseIds
    // active な派閥に所属する人物は eligible 扱い（派閥経由の任命を維持するため）
    isFactionMember = getActiveFactionMembership(state, office.holderPersonId) !== undefined
    if houseEligible or isFactionMember: continue
    revokeOfficeAssignment(office.id)
    emit OFFICE_REVOKED

  // Step 3: rank ベースの定員超過 revoke
  // polity の rank / province 数に対して getEffectiveOfficeMaxHolders を超える役職者を解任する。
  // v0.42 slot 化: slotIndex の大きい（列の後ろの）着座者から順に解任（旧: startYear 降順）。
  // 先頭スロットほど縮小時に生き残る = 先頭 slot の right の価値が高い、の over-max 側の実装。
  for each role in [administrator, treasurer, military, advisor]:
    effectiveMax = getEffectiveOfficeMaxHolders(state, config, polityRef, role)
    holderIds = getActiveOfficeHolders(state, polityRef, role)
    if holderIds.length <= effectiveMax: continue
    // slotIndex desc でソートし、超過分（列の後ろから）を revoke
    excess = assignments sorted by slotIndex desc, take (count - effectiveMax)
    for each excess assignment:
      revokeOfficeAssignment(assignment.id)
      emit OFFICE_REVOKED
```

これにより:
- Polity Office holder は常に以下のいずれかに限定される:
  - 対象 Polity 内に Province を持つ active House の人物
  - commonwealth Polity の houseless rebel founder（`polity.kind === 'commonwealth' && !person.houseId`）
  - active な派閥に所属する人物（派閥が解散すれば次回チェックで revoke される）
  - polity_office_appointment right による任命者（v0.42 — right が active な間のみ）
- Step 3 により、Polity の rank 降格時に定員超過の役職者が自動的に整理される
- rebel founder が死亡したら `markPersonDead → revokeOfficesByHolder` 経路で Office が revoke される

### 6.33 AttitudeDecaySystem（4週ごと）

全 Person および全 PopGroup の `attitudes` を 4 週ごとに `attitudeMonthlyRetentionRate`（0.995）倍に減衰させる。`affection` / `respect` どちらも同率で 0 に近づく。エントリを持たない（未設定の）態度への影響なし。

### 6.34 GovernanceSystem（48週ごと = 毎年）

`getPolityAdminPower`（§4.5）で `adminPower` を再計算し、`polity.adminPower` にキャッシュとして書き込む。

```ts
adminPower = clamp100(
    (rulerContrib + adminContrib + treasurerContrib) * adminEfficiency * 0.5
  + stability * 0.2
  + legacyPrestige * 0.15
  + treasuryScore * 0.15
)
// rulerContrib      = getEffectiveOfficeStat(...,'leader')        * rulerAdminCapacityFactor
// adminContrib      = getEffectiveOfficeStat(...,'administrator') * administratorCapacityFactor
// treasurerContrib  = getEffectiveOfficeStat(...,'treasurer')     * treasurerCapacityFactor
// adminEfficiency   = getAdministrativeEfficiency(...)
// stability         = getPolityStability(...)
// legacyPrestige    = country.legacyPrestige
// treasuryScore     = clamp(log1p(treasury)*10, 0, 100)
```

`getEffectiveOfficeStat` は役職担当者の能力・複数担当者の協調ペナルティを考慮した実効能力値を返す。leader / administrator / treasurer の 3 役職の寄与に administrative efficiency を乗じ、stability・legacyPrestige・treasuryScore を加重する。Stability は `getPolityStability` セレクターで毎回計算する。

### 6.35 IntegrityCheck（3モード制・年末実行）

各種不変条件を検証し、違反があれば例外を投げる。フル integrity check と直前の flush は `currentWeekOfYear === WEEKS_PER_YEAR`（年末）のときのみ走る。integrity invariants は設計上「年末（cleanup 後 + flush 後）」にのみ成立する契約のため、週次では走らせない。

**3 モード**:

1. **非 debug・年末**: 違反を検知したら throw（プロセス停止）
2. **debug・年末**: 違反を catch してログ出力（停止しない）
3. **`--integrity-per-system`（opt-in debug）**: 各 system 実行直後に per-system で integrity を走らせ、違反を catch してログ出力（原因 system 特定用）

各項目は error throw / 型レベル保証 / コードレビューのいずれかで担保される。詳細は `integritySystem.ts` 冒頭コメント参照。

**IntegrityCheck 項目（要旨）**:

LandContract / chain 整合性:
1. chain は root contract を 1 つだけ持つ
2. root contract の `taxRateToGrantor` は 0
3. chain の granteePolityId は active Polity
4. chain は循環しない
5. terminal contract のみ Bailiff が紐付く
6. chain 内の各段で granteePolityId は重複しない
7. (削除) 旧 landContractIndex.byProvince の chain 順検証は byProvince 撤去に伴い廃止。chain 整合は #9 (byGranteePolity) / #10 (byParent) と holdingTerminalPolityCache 検証が担保
8. grantor rank < grantee rank
9. landContractIndex.byGranteePolity の整合
10. landContractIndex.byParent (parent → child) の整合
11. provinceTerminalPolityCache が getProvinceTerminalPolityId と一致

Polity / House:
12. Polity.ownerHouseId が有効な House を指す (undefined は許容)
13. Polity.capitalProvinceId が存在する Province
14. polityIndex.byOwnerHouse の整合
15. landless Polity (terminal Province 0) は active=false
16. active Polity は active `polity:leader` Office を持つ (placeholder leader を許容)
17. active 通常 House は active `house:leader` Office を持つ

Holding / Polity 命名（v0.41）:
- H7: 全 Holding が非空 `nameKey` を持つ
- H8: 各 Province の `holdingIds` 内で `Holding.nameKey` が一意（Province.nameKey との衝突・異 Province 間の重複は検査しない＝許容）
- P-name: `Polity.nameSource` の妥当性。`kind==='pool'` → `nameKey` 非空 / `kind==='holding'` → `holdingId` が実在 Holding を指す。switch は exhaustive

ProvinceOffice / Bailiff:
18. 全 Province が ProvinceOfficeAssignment (Bailiff) を持つ
19. provinceOfficeIndex の 3 方向整合 (byProvince / byHolderPerson / byAppointingPolity)
20. Bailiff の appointingPolityId が当該 Province の terminal Polity と一致

AnonymousHouse / placeholder:
21. AnonymousHouse (`h-anon`, kind: 'system') が 1 つだけ存在する
22. AnonymousHouse の memberIds はすべて placeholder Person
23. 通常 House の memberIds に placeholder Person が混入していない
24. placeholder Person の houseId は AnonymousHouse を指す
25. placeholder Person は marriage / spouse / childIds を持たない

Person / House の不変条件:
26. 死亡人物が役職を持たない
27. Person.sex が `'male' | 'female'`
28. 生存 Person の spouseId が双方向かつ有効、死亡者を指さない
29. 親子関係の双方向整合 (fatherId / motherId / childIds)
30. House の cadet 関係の双方向整合 (parentHouseId / cadetHouseIds)
31. House.memberIds に重複がない
32. Province.development / polityControl / PopGroup.size/wealth/unrest が範囲内
33. ability ≤ aptitude かつ両者が `[0, ABILITY_HARD_CAP=120]` の範囲内、死亡者の wealth が 0

PopGroup / Polity 数値範囲:
- Polity.legacyPrestige / House.legacyPrestige が 0..100 (型レベル + 範囲チェック)
- PopGroup.holdingId が有効な Holding を指す
- PopGroup.occupation / class が有効な値
- 同一 merge key (holdingId + class + occupation) の POP が複数存在しない
- popIndex.byHolding の整合性（POP の holdingId と index が一致）
- OrganizationRef.kind は `'polity' | 'house'` のみ (型レベル)
- AttitudeTarget / attitude key に `country:` が残っていない (型レベル)

Project:
- 全 Project の id が key と一致
- terminal Project が state に残っていない
- creator / supervisor Person が存在する
- active Project の supervisor は alive
- origin.kind === 'aim' の場合、Aim が存在する
- projectIndex の 6 方向整合（byOwner / byAim / byParentProject / byCreatorPerson / bySupervisorPerson / byRelatedEntity）

Task:
- active Task の difficulty が 0〜100 の範囲内
- active Task の relevantAbility が有効な AbilityKey

DiplomaticOffer:
- terminal play の offer が cleanup 後に残っていない（残留 offer 検査）
- active/escalated play の currentOffer がある場合、issue-demand 整合性を検証:
  - land_claim: offer に `change_contract_tax_rate` が含まれない、`transfer_land_contract.holdingId === issue.holdingId`
  - contract_tax_revision: offer に `transfer_land_contract` が含まれない、`change_contract_tax_rate.landContractId === issue.landContractId`

DiplomaticPlay:
- land_claim / contract_tax_revision の active play は issue を持つ
- issue.kind と play.kind が一致する
- currentOfferId がある場合、対応する DiplomaticOffer が存在し offer.playId === play.id
- offerHistoryIds の全 offer が存在し全 offer.playId === play.id
- 非 revolt play に primaryDemand が存在しない

DiplomaticPlay status / 参加者:
- すべての entry の status ∈ {'active', 'escalated'} (terminal status は tick 末で削除される前提)
- initiator / target が存在する
- progress / tension は 0..100
- primaryDemand が有効な対象を指す（revolt_negotiation のみ）

Revolt:
- revolt_negotiation の initiator は commonwealth Polity
- revolt_negotiation の target は normal Polity

Commonwealth Polity:
- kind === 'commonwealth' なら ownerHouseId === undefined を許容
- commonwealth の active DiplomaticPlay の initiator になるのは revolt_negotiation のみ

HoldingOfficeAssignment:
- active HoldingOfficeAssignment の holderPersonId が alive または placeholder
- `contractedRemittanceRate` が 0..1
- `expectedFeeRate` が 0..1
- `contractedRemittanceRate + expectedFeeRate` <= `maxLocalExtractionRate * 1.1`
- 同一 Holding に active bailiff assignment が複数存在しない
- 同一通常人物が active bailiff assignment を複数持たない

collect_holding_revenue Task:
- targetRef.kind は `'holding_office_assignment'`
- targetRef.id が存在する active HoldingOfficeAssignment を指す
- placeholder 代官を holder とする collect_holding_revenue Task が存在しない
- 同一 assignment を target とする active collect_holding_revenue Task が複数存在しない

HoldingImprovement:
- id prefix が `hi-`
- holdingId が存在する
- kind が有効な HoldingImprovementKind
- level >= 1、level <= max level for Holding kind
- condition が 0..100
- 同一 holdingId + kind が複数存在しない
- `holdingImprovementIndex.byHolding` と実体が一致

ProjectStage（develop_holding のみ）:
- currentStageKey が有効な ProjectStageKey
- execute_project stage: progress / targetProgress は BaseProject の不変量に準ずる

ProjectBudget（develop_holding のみ）:
- budget.required / allocated / remaining / spent が >= 0
- active Project: `budget.allocated = budget.remaining + budget.spent`
- secure_budget 未完了なら allocated / remaining / spent は 0

develop_holding Project:
- holdingId が存在する
- improvementKind が有効
- targetImprovementLevel が max level 以下
- 同一 holdingId に active develop_holding Project が複数ない

Selector range（debug モードのみ。`if (debug && config)` でゲート）:
- `localExtractionRate` が `[minLocalExtractionRate, maxLocalExtractionRate]`
- `collectionEfficiency` が `[minBailiffCollectionEfficiency, 1.0]`
- `bailiffFeeRate` が `[0, maxBailiffFeeRate]`
- `totalBurdenRate` が `[0, maxLocalExtractionRate]`

Province:
- terrain が有効な ProvinceTerrain
- features が配列で、各値が有効な ProvinceFeature、重複なし

HoldingImprovement（max-level access 反転）:
- valid kind は `VALID_HOLDING_IMPROVEMENT_KINDS = new Set(Object.keys(IMPROVEMENT_DEFINITIONS))` で判定（二重管理解消）
- max-level access を `holdingImprovementMaxLevelByKind[kind][holdingKind] ?? 0` に反転。`0`（未定義含む）= 建設不可なので `level > maxLevel` で違反（improvement entity / develop_holding project の 2 箇所）
- canBuild の terrain / feature ゲートは terrain 不変＋ improvement 生成が常に canBuild 経由のため構造的に保証（専用 runtime ループは設けない）

Config / Definition（const を回すのみ）:
- `IMPROVEMENT_DEFINITIONS` と config の各数値 Record が全 HoldingImprovementKind を持つ（コンパイル時保証の二重の保険）
- `allowedHoldingKinds` に含まれる holdingKind は maxLevel >= 1、含まれない holdingKind は maxLevel が undefined または 0、負値は不正
- `capacityRole === 'capacity'` の kind は targetOccupations の `occupationCapacityPerLevel` が正値で存在
- terrain / feature multiplier の invalid キーはコンパイル時担保（runtime チェック省略）

Capacity:
- 全 holding × occupation で `getHoldingOccupationCapacity` が NaN / Infinity / 負を返さない
- `occupation === 'none'` の capacity は 0

War（`integritySystem.ts` §14 セクションに実装）:

War 基本:
- `war.id` が record key と一致・重複なし、`status` が有効な WarStatus、`startedWeek` が finite
- `endedWeek` がある場合 `endedWeek >= startedWeek`
- `warScore` が finite かつ `-100..100`、`targetWarScore` が `0 < x <= 100`

active / terminal 整合:
- `status === 'active'` → `endedWeek` は undefined
- `status !== 'active'` → `endedWeek` は defined

participant:
- `attacker.key === 'attacker'` / `defender.key === 'defender'`、各 side `participants.length === 1`、primary participant は各 side 1 人
- **active War のみ** participant actor が active であること（`isActiveActor`）を要求。terminal War（cancelled / attacker_won / defender_won / white_peace）は retention 中の inactive 化を許容。この検査が成立するのは `cancelOrphanedWarsSystem`（§6.47）が participant 消滅 active War を integrity より前に cancelled 化するため

WarGoal（**参照存在は active War のみ要求。participant 検査と対称**）:
- transfer_land_contract: holding / fromPolityId / toPolityId が存在、`fromPolityId !== toPolityId`、`requiredWarScore > 0`
- change_contract_tax_rate: holding / landContract が存在、`landContract.holdingId === goal.holdingId`、`newTaxRateToGrantor` が `0..1`、`requiredWarScore > 0`
- **存在検査（holding / polity / landContract）は `status === 'active'` の War のみに適用する。** terminal War（attacker_won / defender_won / white_peace / cancelled）の WarGoal は和平適用済みの**凍結履歴データ**であり、`terminalWarRetentionWeeks` の retention 中に別システム（税率改定外交の contract 排除・併合など）が参照先を消しても違反としない（cleanup までの dangling を許容）。active War で参照先が stale になったケースは PeaceSettlementSystem（§6.46）が `white_peace` で安全終結させるため、active で残る dangling は無い。
- range / value 検査（`requiredWarScore > 0`、`fromPolityId !== toPolityId`、税率 `0..1`）は凍結値の不変条件なので status に関わらず常に検査する。

originDiplomaticPlayId は weak ref のため存在検査しない（cleanup 済みを許容。§3.9a）。

warIndex（双方向。Faction index パターン踏襲）:
- `byParticipant[key]` の各 warId が存在し、その War に key 一致の participant がいる（forward）
- active War の各 participant key が `byParticipant` に warId を持つ（reverse）
- `byOriginDiplomaticPlay[playId]` の指す War が存在し `originDiplomaticPlayId` が一致（forward）

Chronicle（index↔entry の内部整合のみ）:

chronicleIndex ↔ chronicleEntries（§3.14）:
- forward: `byPerson` / `byHouse` / `byPolity` / `byProvince` / `byHolding` の各 index に載る entry id が `chronicleEntries` に実在し、その entry の entityRefs に対応する `(kind, key)` を含む
- reverse: 各 entry の 5 index 対象 kind（person / house / polity / province / holding）の ref が、対応 index に entry id として登録済み（faction / clan 等 index 非対象 kind の ref は検査しない）
- **entityRefs の参照先が現在 state に存在するか（active か / 死亡人物か / 断絶家か / 終了 War か）は検査しない。** ChronicleEntry は過去の記録であり、消えた entity への soft reference を保持するのが正しい（warIndex の `originDiplomaticPlayId` 同様、存在検査を意図的に省く）。これは「Chronicle を simulation logic に使わない」原則（§3.14）の integrity 表現であり、存在検査へ「修正」してはならない（長期実行で誤検知を生む）。

### 6.36 ProjectPreparationSystem（4週ごと）

active Aim を走査し、必要に応じて `prepare_project` Task を生成する。走査対象は `aim.origin === 'goal_driven'` かつ `aim.owner.kind !== 'person'`（Polity / House Aim のみ）。本 system は **prepare_project Task の生成のみ**を行い、Project 本体は生成しない（Project は prepare_project Task 完了時に `buildProjectFieldsForAim` 経由で作成される。§6.55 / taskProjectCompletion）。stage の即時解決（find_supervisor / secure_budget）は ProjectStageSystem（§6.38）が担当する。

**抑制条件**: `projectIndex.byAim[aim.id]` に active Project が存在する / `aim.activeTaskId` が設定中 / `aim.activeDiplomaticPlayId` が設定中 / `nextProjectAllowedWeek` 未到達。

AimKind → ProjectKind マッピング（`aimKindToProjectKind`）:
- Polity: `consolidate_province_holdings` / `seize_weak_remote_holdings` → `acquire_land`、`develop_owned_holding` → `develop_holding`、`improve_owned_contract_terms` / `eliminate_overlord_contract` → `improve_contract_terms`、`demand_tax_increase_from_vassal` / `eliminate_vassal_contract` → `demand_tax_increase`
- House: `acquire_political_right` → 同名（v0.42 — 旧 `increase_polity_share` → `expand_polity_share` は廃止）、`steer_polity_*` → `promote_policy_shift`、`patronize_artist` / `commission_chronicle` → 同名

`selectProjectCreator` で起案者を選定（候補なしなら待機）。prepare_project Task の assignee は creator。生成後に `aim.activeTaskId` / `nextProjectAllowedWeek` を設定する。

### 6.37 SellLandProjectGenerationSystem（48週ごと）

Polity の財政難から直接 sell_land Project を生成する（prepare_project Task を経由しない）。`origin: { kind: 'system', reasonKey: 'fiscal_pressure' }`。

### 6.38 ProjectStageSystem（毎週）

active Project の immediate stage を即時解決する。毎 tick 実行（intervalWeeks: 1）。

**immediate stage handler**:
- `find_supervisor` (develop_holding): Bailiff を supervisor に採用。4段階カスケードで候補探索
- `secure_budget` (develop_holding): owner treasury から budget 確保
- `open_diplomatic_play` (acquire_land / sell_land / improve_contract_terms / demand_tax_increase): DiplomaticPlay を作成し、Pressure を生成。preparation / leverage / commitment を DiplomaticPlay に転写。重複チェックあり（duplicate → Project failed）。play 作成と同時に initiator の初期 DiplomaticOffer を生成
- `choose_stance` (respond_to_pressure): 軍事力比較で stance 決定（target < source×0.5 → concede、target ≥ source×1.2 → resist、else → negotiate）。この式は `selectors/pressureStanceSelectors.ts` の `predictPressureResponseStance`（閾値 `PRESSURE_CONCEDE_POWER_RATIO`=0.5 / `PRESSURE_RESIST_POWER_RATIO`=1.2）として外出しされ、外交劇の開始可否ゲート（減税系 aim 選定 §6.57、税改定 play 生成 §6.42）と**同一の式を共有**する。「開始時に予測する相手の応答」と「実際の応答」が必ず一致する単一の真実。**性格シフト（`personAbilityEffectsEnabled`、default ON）**: nominal power はそのままに、concede/resist の両境界を被圧力側（target）の意思決定者（polity=指導者 / house=当主）の性格で同量シフトする。「大胆さ」軸 `shift = ambition×pressureStanceAmbitionShift − caution×pressureStanceCautionShift`（各 0.1、`normalizedTrait` で中点 0.5 基準）を両境界から引く＝大胆な宗主は不利でも拒否しやすく譲歩しにくい / 慎重な宗主は早く譲歩する。両境界を同量動かすので concede < resist の順序は保たれる。OFF 時は厳密に従来挙動。開戦ゲート（§6.44）は regiment 勝率で別軸に判定するため、ここに regiment 戦力は持ち込まない（aim/play ゲートへ 0 動員エッジを波及させないため、勝率精度は開戦判断に閉じ込める意図的な非対称）。
- `propose_initial_offer` (respond_to_pressure): target 側が stance に基づく counter-offer を生成。concede → initiator の offer demands をコピー、negotiate → 中間案（land_claim: pay_wealth ×1.3、contract_tax_revision: halfway rate）、resist → status_quo。counter-offer 作成時に progress += counterOfferProgressDelta

**runtime fallback**: invalid な currentStageKey を持つ active Project に initial stage を補正する（防御的補正）。

### 6.39 ProjectTaskGenerationSystem（毎週）

active Project の currentStageKey に応じて Task を生成する。immediate stage はスキップ。

**(kind, stageKey) → TaskKind マッピング**:
- final stage → `advance_project` (develop_holding, acquire_political_right, etc.)
- preparatory stage → 専用 TaskKind (prepare_claim → gather_claim_evidence, prepare_offer / prepare_argument / prepare_response → prepare_argument)
- negotiate stage → `selectDiplomaticTaskKind()` で DiplomaticPlay の状態に基づき決定。respond_to_pressure の場合は stance に応じた優先度調整

**negotiate stage の共通フロー** (§12.5):
1. project.diplomaticPlayId から DiplomaticPlay を取得（terminal なら Project cancelled）
2. project.owner と play.initiator/target を比較して side 判定
3. activeTaskIds の上限チェック
4. selectDiplomaticTaskKind で TaskKind 決定（stance 反映）
5. Task を生成（targetRef = diplomatic_play、assignee = delegate）
6. play の activeTaskIds に追加

**revolt_negotiation タスク生成**: Project ループの後に、active revolt_negotiation play に対して直接タスクを生成。Project を経由しないが、共通フローの手順 3-6 と同様のロジックで両陣営（initiator = commonwealth leader、target = polity delegate）にタスクを割り当てる。initiatorDelegatePersonId は play 生成時に commonwealth leader に設定される。

### 6.40 ProjectMaintenanceSystem（4週ごと）

active Project の状態更新。owner inactive → cancelled、origin Aim が non-active → cancelled、supervisor 死亡 → 再選定（失敗なら failed）、deadline 超過 → failed、progress >= targetProgress → completed。

**develop_holding 追加処理**:
- find_supervisor / secure_budget の immediate stage の解決は ProjectStageSystem（§6.38、毎週）が担当する（本 system では retry しない）
- deadline は execute_project stage のみに適用（準備段階では treasury 回復・人材確保を待機可能）。deadline は `projectDeadlineWeeksDevelopment × (targetProgress / projectDefaultTargetProgress)` で算出。Level 2 (×2) / Level 3 (×3) の大規模工事に比例した期間を確保
- budget.remaining が消費額未満の場合は Project を failed にする（追加予算は future）

### 6.41 ProjectOutcomeSystem（4週ごと）

terminal Project の効果解決・ログ出力・cleanup を担当。

- 非外交系 Project: treasury/wealth/prestige 等の直接効果を適用し、Aim progress を加算
  - **文化系 Project の afford 前提**: `patronize_artist` / `commission_chronicle` / `acquire_political_right` は完了時に `house.wealth >= cost` を要求する。これらの Project は**作成時**に afford 判定する（§6.55 `buildProjectFieldsForAim`）。作成時に払えなければ Project を生成せず Aim を待機させ、wealth 回復後に再試行する。これにより doomed Project が生成されず、完了時に資金不足で効果を何も適用しない silent no-op を防ぐ。
- 外交系 Project: DiplomaticPlay 生成は ProjectStageSystem の open_diplomatic_play handler に移管。ProjectOutcomeSystem は外交系 completed 時に追加効果を適用しない（交渉への影響は各 Task outcome で DiplomaticPlay に反映済み）
- respond_to_pressure completed: Pressure.status を 'responded' に遷移
- Project を state.projects / projectIndex から削除

**develop_holding completed 時の追加処理**:
1. HoldingImprovement を作成（新規）または level up（既存）
2. `budget.remaining` → `supervisor.wealth`（成功報酬・節約分の取り分）
3. `project_completed` PersonActivityLog を supervisor に追加（params に improvementKind / targetLevel / holdingId）
4. creator → supervisor / owner leader → supervisor の respect を小幅上昇（`projectCompletedRespectGain`）

**develop_holding failed 時の追加処理**:
1. `budget.remaining` → owner に返金
2. `project_failed` PersonActivityLog を supervisor に追加

### 6.42 DiplomaticPlaySystem（4週ごと）

active な DiplomaticPlay を進行させる。

- structuralProgress は `structuralProgressFactor`（0.33）で弱化する。delegate 選定・交渉パラメータ更新を行う。
- Task 生成責務は ProjectTaskGenerationSystem にある。DiplomaticPlaySystem は原則として Task を生成しない（delegate 生存確認・再任、progress/tension 管理、settlement/escalation/failed/cancelled 判定を担当）。
- revolt_negotiation もタスク駆動。Project は持たないが、ProjectTaskGenerationSystem が active revolt_negotiation play に対して直接タスクを生成する（両陣営）。ハイブリッドモデル: タスク効果が主（preparation/leverage/commitment → 閾値調整）、環境因子（POP unrest/鎮圧力）が副（小幅構造的増分）。delegate の能力が交渉結果に影響する。
- settlement は accepted offer によってのみ成立する（offer-driven ハイブリッドモデル）。progress は settlement 判定に使わず UI 表示値として維持する。

**メインループ（land_claim / contract_tax_revision）**:

```txt
for each active play:
  1. orphan check (issue-based, cancelOrphanedPlays)
  2. structural update: tension += baseTensionGain * structuralFactor
  3. offer evaluation check:
     if currentOfferId exists AND currentOfferId !== lastEvaluatedOfferId:
       a. validateOffer
       b. if invalid → reject, set lastEvaluatedOfferId
       c. if valid → progress += validOfferProgressDelta, evaluateOffer
       d. if accepted → applySettledOffer, play.status = 'settled'
       e. if rejected → tension += evaluation.tensionDelta, set lastEvaluatedOfferId
  4. escalation check: tension >= escalationThreshold → escalated
  5. deadline check: deadline 到達 → 常に escalated（failed なし）。
     offer は step 3 で必ず評価済みのため、deadline 時点で未評価 pending offer は存在しない。
```

`revolt_negotiation` は offer-driven 化の対象外で、タスク駆動ハイブリッドモデルで進行する（下記参照）。

**evaluator の決定**: `currentOffer.proposedBy` が initiator なら evaluator は target、逆も同様。

**applySettledOffer**: accepted offer の demands を `applyDemand(ctx, play, demand, allDemands)` で順に適用する。`allDemands` 引数により `transfer_land_contract` の reason を導出（`pay_wealth` あり → 'purchase' / なし → 'cession'）。

**evaluateOffer**: PlayKind 別に offer.demands からパラメータを抽出し score を計算。score >= 0 → accepted、score < 0 → rejected。評価時点の preparation / leverage / commitment が score に反映される。

Play kind 別の処理:
- `land_claim`: demands から `transfer_land_contract` / `pay_wealth` / `status_quo` を抽出し evaluateLandClaimOffer で score 計算。settlement 時は `applySettledOffer` で demands を適用。rank ベースの契約選択 (3-a/3-b/3-c) と操作 (5-a/5-b/5-c) は維持。
- `contract_tax_revision`: demands から `change_contract_tax_rate` / `pay_wealth` / `status_quo` を抽出し evaluateContractTaxRevisionOffer で score 計算。`taxRevisionInitialDemandDelta` (0.10) を初期要求幅とする。下限 5% / 上限 80% 超で契約破棄。Play 決着時（成否問わず）に `termsProtectedUntilWeek` を設定。`applyChangeContractTaxRate` で `newRate <= taxRevisionMinRate` または `newRate >= taxRevisionMaxRate` の場合、率変更の代わりに `eliminateContractFromChain` で契約取消しを実行する（settlement / conflict 両経路共通）。status_quo 和平時は CONTRACT_TAX_REVISED を emit しない。
- `revolt_negotiation`: `popular_tax_relief` demand ベースのタスク駆動ハイブリッドモデル。タスク効果（negotiate_terms/pressure_counterparty 等）が preparation/leverage/commitment を更新し、決着閾値を調整（initiator preparation/leverage が高いほど妥結しやすく、target commitment が高いほど激化しやすい）。環境因子（acceptanceScore: POP unrest/鎮圧力/税率負担）は小幅構造的増分として副次的に作用。settlement → 税率引下+commonwealth 解散。escalation → rank 2-4 は revolt_seizure+Local Levy+War、rank 5 は internal revolt 即時解決（§6.30）。

**契約取消し aim**: `eliminate_overlord_contract`（`taxRateToGrantor <= taxRevisionMinRateForReduction` で発火）/ `eliminate_vassal_contract`（`taxRateToGrantor >= taxRevisionMaxRateForIncrease` で発火）。既存の `improve_contract_terms` / `demand_tax_increase` project に mapping し、desiredRate が min/max 境界にクランプされる。escalation → conflict で勝利した場合に CONTRACT_ELIMINATED が発生する。両 Goal（external_expansion / internal_development）から候補に入る。

**税改定 play の受諾見込みゲート（`createContractRevisionPlayFromProjectMut`）**: play 生成時に `predictPressureResponseStance(initiator, target) === 'resist'`（target が initiator の 1.2 倍以上強い）なら `{ kind: 'infeasible' }` を返し play を生成しない。呼出側（ProjectStageSystem）は project を `failed` にして actor を別行動へ解放する（`invalid_inputs` の毎 tick retry と異なり再試行ループにならない）。これは減税系 aim 選定の受諾見込みゲート（§6.57）と同一 predicate を共有する**二重の安全網**で、主因の抑止は aim 選定側が担い、本ゲートは aim 生成後に戦力比が変化した稀ケースを最終的に弾く（通常運用では発火 0）。これを欠くと「resist 確実な相手への外交劇が generate→status_quo 妥結を繰り返し、何も変わらない play が連発される」。`canTransferLandContract` の rank ゲート（§6.44）と同じ「1 式・複数ゲート」構成。

### 6.43 ConflictResolutionSystem（no-op）

revolt_negotiation の escalation は warCreationSystem 経由で War 化されるため、本 system は完全 no-op。関数名 `runConflictResolutionSystem` は後方互換のため維持するが、本体は `return ctx` のみ。

### 6.44 WarCreationSystem（4週ごと）

`status === 'escalated'` の DiplomaticPlay を即時解決せず War entity に変換する。

**対象（すべて満たす play のみ War 化）**:
- `play.kind === 'land_claim'` / `'contract_tax_revision'` / `'revolt_negotiation'`（kind-gate）
- `initiator.kind === 'polity'` かつ `target.kind === 'polity'`（polity 同士のみ。House を含むものは War 化しない）

**変換**: initiator → attacker primary participant、target → defender primary participant（各 side 1 件・primary=true）。WarGoal は `play.issue` のみから 1 件構築する（offer / currentOfferId は見ない）。
- transfer_land_contract: `holdingId = issue.holdingId`、`toPolityId = initiator.id`、`fromPolityId` = 対象 holding の land contract chain 上の現 terminal grantee（原則 target.id）
- change_contract_tax_rate: `newTaxRateToGrantor = issue.desiredTaxRateToGrantor`、`landContractId` / `holdingId` は issue 由来
- popular_revolt_independence: revolt_negotiation の escalation を War 化する。`requiredWarScore = defaultPopularRevoltWarScore`。War 作成後、commonwealth polity の `revoltState.warId` を back-fill する
- `requiredWarScore` は kind 別 config（`defaultTransferLandWarScore` / `defaultChangeContractTaxWarScore` / `defaultPopularRevoltWarScore`）から設定し、`targetWarScore = max(warGoals.requiredWarScore)`

**War 化しない（cancelled に倒す）条件**: initiator / target が missing / inactive、対象 holding / contract が無い、WarGoal へ変換不能、同一 `originDiplomaticPlayId` から作成済み、**同一 issue（holdingId / landContractId）を対象とする active War が既存**（重複抑止）。escalated のまま残すと cleanupTerminalDiplomacy が terminal しか消さず無限蓄積するため、War 化できなかった escalated play は cancelled に倒す。

**transfer_land_contract goal の rank 適用可否ゲート（`isWarGoalApplicable`）**: holding / fromPolity / toPolity の存在・active・`from !== to` に加え、**`canTransferLandContract(state, holdingId, fromPolityId, toPolityId)` が true であること**を要求する。これは `applyLandContractTransferGoal` が実行時に使う `planLandContractTransfer`（feudal chain の rank invariant を検証し適用プランを決定する純粋関数。両者は `landContractMutations.ts` 内の単一の真実）と**同一ロジック**で、開戦前に適用可否を判定する。これを欠くと「warScore で勝っても rank invariant 上 land contract を移管できず PeaceSettlement が `white_peace` に倒れ、同じ seize 戦争を永久に再宣戦する（winning→white_peace ループ）」事故が起きる（例: rank 2 polity が rank 3 grantor 配下の holding を seize しようとするケース）。`seize_weak_remote_holdings` aim は軍事力比較のみで対象を選ぶため rank 非互換 holding を頻繁に狙うので、本ゲートが load-bearing。同一 predicate を play 生成（DiplomaticPlaySystem §6.42 経由の `createLandClaimPlayFromProjectMut`）でも事前適用し、適用不能な seize の play / `DIPLOMATIC_PLAY_STARTED` spam も抑止する。

**勝率 × 指導者性格による開戦ゲート（`winChanceWarGateEnabled`、default ON）**: WarGoal が適用可能（上記 rank ゲート通過）でも、War 化の直前に「攻撃側が勝てるか」を判定し、勝てないなら開戦を見送る。対象は `land_claim` / `contract_tax_revision` のみ（`revolt_negotiation` は除外＝叛乱は計算的開戦ではなく、cancel すると `revoltState.warId` 配線が宙に浮く）。
- 勝率推定 `estimateAttackerWinChance`（`selectors/warEstimateSelectors.ts`）= `atk / (atk + def)`。`estimateWarSidePower` は**実戦闘と同じ戦力源**で算出する: actor の `regimentIndex.byOwner` から**動員可能な常設連隊**（`status==='active'` かつ `currentWarId===undefined`＝`mobilizeRegimentsForWar` と同一条件）の `getRegimentEffectivePower` 合計。連隊記録ゼロのときのみ nominal power（`getActorMilitaryPower`）にフォールバックし、記録はあるが動員可能ゼロ（全員別戦争 / 全滅）は **0**。これにより「推定では勝てるが実戦では動員ゼロで全滅」（過去の attacker=0 全滅バグ）を構造的に塞ぐ。
- しきい値 `calcGeneralDeclareThreshold(attackerPolityId)`（`selectors/personAbilityEffects.ts`）= `minAttackerWinChanceToDeclare`（=0.45）を攻撃側の軍事官（`military` office holder）の性格で調整: ambition 高で下げ（不利でも挑む）、caution 高で上げ（慎重）、`[minWarDeclareThreshold, maxWarDeclareThreshold]`=`[0.3, 0.75]` に clamp。`personAbilityEffectsEnabled` OFF 時は flat 0.45。
- `winChance < threshold` なら War を作らず play を `cancelled`（既存 terminal 経路を再利用）にし、`WAR_AVERTED`（minor、winChance/threshold を百分率で記録）を発行する。決定論（RNG 不使用）。「一か八か」は per-decision の乱数でなく指導者ごとの性格分散で表現する。
- `winChanceWarGateEnabled` は `personAbilityEffectsEnabled` とは別のキルスイッチ（personality OFF でも flat-0.45 ゲートは挙動変化なので A/B 比較できるよう分離）。

**War 作成後**: 元 play を `resolved_by_conflict`（terminal）にする。**`DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT` event は発行しない**（即時解決を含意するため）。戦争開始 event は `WAR_DECLARED`（major）のみ。

### 6.45 WarManeuverSystem（毎週）

active War ごとに「誰が指揮し・どの戦場で・戦うか回避するか」を毎週解決し、battle 結果で warScore を更新する。終結判定はしない（PeaceSettlementSystem の責務）。**乱数を使う**。selector は `warManeuverSelectors.ts`、battle/回避の数式は `warManeuverSystem.ts` のローカル関数。

各 active War に対し以下を順に実行（attacker→defender の固定順で RNG を消費）:

1. **lastWarWeek 更新**: polity actor 両陣営の `lastWarWeek = absoluteWeek`（valor/command の「直近戦争参加」ability 判定を温存）。dead-participant guard より後・early-continue より前に行う。
2. **dead-participant guard**: primary participant が missing/inactive な War は skip（消滅 actor は cancelOrphanedWarsSystem が cancelled 化）。
3. **warScore 凍結**: `|warScore| >= targetWarScore` の War は warScore を動かさず skip（PeaceSettlement 待ち。下記 cadence）。
4. **総大将 lazy refresh**（polity actor のみ。house actor war は no-op）: 現 `captainGeneralPersonId` が eligible（`isEligibleWarPerson`）なら据置、不適格/不在なら `selectCaptainGeneralForWarSide`（warCommand スコア順）で再選出。変化時 `WAR_CAPTAIN_GENERAL_CHANGED`（喪失=major / 交代=normal）。初回任命（旧 undefined）は event なし。
5. **指揮官候補 lazy refresh**: `buildWarSideCommanderCandidates` で再構築（変化時のみ state 更新・event なし）。先頭が当該週の戦闘指揮官。
6. **戦場生成**: WarGoal 対象 Province から `generateCandidateBattlefield`。major_river feature は確率 `warBattlefieldRiverCrossingChance` で `river_crossing`、coastal feature は `warBattlefieldCoastalBattleChance` で `coastal_battle`、それ以外は `TERRAIN_TO_BATTLEFIELD[terrain]`（terrain 5 種 → open_field/forest_battle/hill_battle/mountain_pass/wetland_battle の 1:1）。対象 Province 未解決なら以降 skip。
7. **回避判断**（両陣営 `decideEngagement`）: `avoidDesire = 戦力劣勢 + caution・地形回避性 − urgency(負けている側ほど高) − ambition − avoidanceCount ペナルティ + noise`。`avoidanceCount >= maxWarAvoidanceCount` は強制 accept。総大将不在は中立 traits(0.5) で計算。
8. **戦闘 or 回避の解決**:
   - **両者回避** → warScore 不変、両 `avoidanceCount +1`、`BATTLE_AVOIDED`(minor, avoidingSide='both')。
   - **片側のみ回避成功** → 回避側 `avoidanceCount +1`、warScore は非回避側へ `warAvoidanceWarScorePenalty`(=1.0) 分だけ動く、`BATTLE_AVOIDED`(回避 side)。
   - **両者交戦 / 回避失敗** → `simulateBattle`（内部 tick）で result を出し warScore 更新、`BATTLE_OCCURRED`(normal)。**戦闘後に両側の `avoidanceCount` を 0 にリセット**。

**battle 解決（`simulateBattle` 内部 tick simulation）**:

battle 解決は純粋 helper `simulateBattle`（`src/sim/helpers/simulateBattle.ts`、WorldState 非依存）で行う。WarManeuver は動員 active Regiment の snapshot（effectivePower は `getRegimentEffectivePower` で**戦闘前 1 回 frozen**）と指揮官 pool・総大将 warCommand・地形 frontage を入力し、helper が deployment → 内部 tick loop → result / 損耗 / summary を返す。

- **deployment**: candidate = `strength > minFightingStrengthThreshold && org > retreatOrganizationThreshold`。infantry を effectivePower 降順で frontline（地形 `battlefieldFrontageByKind` 幅）、残り frontage を cavalry で埋め、余りは reserve。draw 無し。
- **内部 tick loop（最大 `battleMaxTicks`）**: 各 tick で frontline matchup ごとに**双方向 organization damage**を与える（`battleBaseOrganizationDamage × pairPowerFactor(frozen 比 clamp) × terrain × flank × randomFactor`、damage 方向ごとに 1 draw）。org に比例した morale damage（`battleMoraleDamageRatio`）。org が morale 感応の effRoute（`routeOrganizationThreshold + max(0, baselineMorale−morale) × moraleRouteThresholdFactor`）以下で **rout**（flag + 追加 morale damage）、retreat 閾値以下は frontline 離脱。欠員は reserve から補充。
- **result 決定**: 片側の fighting 連隊が尽きれば相手勝利。相討ちは残存 org 合計 tiebreak。**maxTicks 到達（双方残存）は残存 org 合計の相対差が `battleMaxTicksDecisiveMarginRatio`(=0.1) 超で優勢側勝利、以下なら inconclusive**（通常規模は 1 戦で全滅させられず常に inconclusive になるのを防ぐ）。
- **strength damage**: loop 後に累積 org damage × role（winner/loser/routed）× outcomeQuality × powerDisadvantage で 1 回算出（損耗方針: strength は大きく削れない＝destroyed は core では希少）。
- **指揮官効果**: helper は deployment 後に commander pool（fieldCommandScore 降順、cavalry は breakthroughScore 優先、center-out infantry）を割当て `BattleCommanderAssignment[]` を出力。割当連隊は与 org damage `×(1+q)` / 被 org damage `×(1−q)` / rout 耐性（`q = clamp((fieldCommandScore−50)/50, −1, 1) × commanderAssignedRegimentEffectMax`、隣接は `× commanderAdjacentRegimentEffectRatio`）。
- **総大将効果**: side-level で被 org damage 軽減（≤`captainGeneralBattleOrganizationDamageEffectMax`=10%）と rout 耐性（≤`captainGeneralRoutResistanceEffectMax`=10%）。benefit 方向のみ（warCommand<50 でも penalty にしない）。
- 指揮官割当・効果・CG は **draw を消費しない**（modifier は draw 後に乗算）ので RNG 順序は不変。

**warScoreDelta（result から符号 + bounded magnitude）**: `computeWarScoreDelta` が internal sim の `result` から符号を決め（attacker_victory=+ / defender_victory=− / inconclusive=0）、magnitude を `base(outcomeQuality: rout は `battleRoutVictoryScoreBase`、orderly は `battleOrderlyVictoryScoreBase`) × decisiveness(敗者 routed share + 早期決着) × preBattleModifier(勝者の preBattle edge のみ、控えめ) × 勝者側 captainGeneralEfficiency` で組み、`clamp(0, maxWarScoreDeltaPerBattle)`。`warScoreDelta = sign × magnitude`。post-battle power 比は使わない（rout / org collapse で 0/1 に寄り delta が暴走するため）。符号は result 由来・magnitude≥0 なので **常に result と整合**。Battle entity には **rawDelta** を保存（warScore saturation で applied delta が 0 化しても符号が崩れないように）、`warScoreAfter = clamp(before + rawDelta, −100, 100)`。

**warScore 変化の表現**:
- per-tick drift は行わない。warScore 変化は `BATTLE_OCCURRED` の `warScoreDelta` / `warScoreAfter` で表現する。
- 指揮官補正は `commanderModifier` / `captainGeneralEfficiency`（`getRoleScore(person, 'warCommand')`）で反映する。
- 総大将 / 指揮官候補 / avoidanceCount は **soft reference**。lazy 選出で不在を許容し、IntegrityCheck では検査しない（person 消滅で War を壊さないため。house actor war では総大将管理を行わない）。

**cadence（毎週 maneuver × 4週 settlement）**: WarManeuver は毎週・PeaceSettlement は 4 週ごと。warScore が ±targetWarScore に到達しても settlement が走るまで最大 3 週ある。その間 step 3 が warScore を凍結し、到達済み War が余分な battle で行き過ぎるのを防ぐ。

**バランス**: warScoreDelta は magnitude 式（outcomeQuality base × decisiveness × preBattle × cgEff、clamp `maxWarScoreDeltaPerBattle`=12）で決まり、決着戦闘数は base/target 比に依存する。戦闘は残存 org 合計で決まり**数的優位が支配的**、決着まで中央値 ~7 戦、destroyed は実質発生せず（strength 損耗は小）、rout は実戦で稀。戦闘系のバランス（avgStrength・CG fairness・median 等）は戦場/指揮官/消耗/兵站がひと通り入った後にまとめて調整する（現状は機能の bounded 動作を優先し config 非調整）。

**Regiment 接続（損耗ループ）**: battle の入力は永続 Regiment（§3.9b）。WarManeuverSystem は warScore 凍結判定（step 3）の後・総大将 refresh の前に **per-war mobilize prologue** を挟む（`mobilizeRegimentsForWar`。各 side の polity participant が所有する active かつ未動員 Regiment を当該 War/side へ動員する。決定的・乱数非消費・冪等）。battle が成立したら（mutual_engagement / 回避失敗）`simulateBattle` を実行し損耗を適用する:

- **損耗は per-regiment**。`simulateBattle` が連隊ごとに organization / morale / strength の after 値を返し、`updateRegimentMut` で反映する。organization は内部 tick で主に削れ（§6.45 battle 解決）、morale も削れる。strength は損耗方針で大きくは削れない。
- clamp 後 `strength <= regimentDestroyedStrengthThreshold`（既定 0）になった Regiment は `destroyed` 化（byWar から除去・status 遷移。byOwner には残す。§3.9b case(c)）。core では deployment 閾値（strength>10）により全滅前に配置外となり **destroyed は実質発生しない**。
- 1 戦闘につき `Battle` entity（§3.9c）を 1 件記録する（`createBattle`）。summary（outcomeQuality / ticksElapsed / frontage / *InitialFrontlineIds / *RoutedRegimentIds / breakthroughSide / *CommanderAssignments / pursuitOccurred / regimentResults の morale 込み）を保存する。`BATTLE_OCCURRED` event には battleId・連隊数に加え summary（outcomeQuality / ticksElapsed / frontline・routed counts / pursuitOccurred 等）を additive に載せる（§8 event 一覧）。
- strength の回復は RegimentReinforcementSystem（§6.50 月次）、organization / morale の回復は RegimentRecoverySystem（§6.48 baseline-aware）、destroyed の reform も §6.50。
- 総大将 / 指揮官は **warScore 経路**（勝者側 `captainGeneralEfficiency`）と **battle 内経路**（指揮官 org/rout 補正 + 総大将 side-level 補正）の両方に効く。`commanderModifier`（power 乗算）は使わず、battle 内 org/rout 補正で表現する。

### 6.46 PeaceSettlementSystem（4週ごと）

active War の warScore が閾値に達したら終結させ、WarGoal を state に反映する。冒頭に WarManeuver と同じ **dead-participant guard**。

- **revolt War の leader 死亡 guard**: revolt War（WarGoal が `popular_revolt_independence`）で `leaderPersonId` が死亡 / 不在の場合、warScore / timeout に関わらず即座に `defender_won`（後述の suppressRevolt を伴う）で終結させる。
- `warScore >= targetWarScore` → `attacker_won`。WarGoal を実行（attacker 側の目標として扱う）。`popular_revolt_independence` の場合は `establishCommonwealth` を呼ぶ。
- `warScore <= -targetWarScore` → `defender_won`。通常 WarGoal は実行せず status quo（defender counter-goal なし）。ただし `popular_revolt_independence` の revolt War では `suppressRevolt` を呼ぶ（純粋な status quo ではない）。
- `absoluteWeek - startedWeek >= maxWarDurationWeeks` かつ未決着 → `white_peace`（timeout 終結）。拮抗 War の無限累積を防ぐ終結保証。
- WarGoal 適用が stale（対象 holding / contract / fromPolity が現状と不一致で底層 mutation が失敗）な場合は `white_peace` で安全終結し、simulation を落とさず IntegrityCheck 違反にもしない。warScore が target に到達していても WarGoal が適用不能なら**能動的に white_peace 化**する（毎週 maneuver で warScore が target に達したまま放置されると、WarGoal が指す landContract を他システムが先に消した時に dangling 参照で crash しうるため）。`establishCommonwealth` / `suppressRevolt` の失敗時も `white_peace` にフォールバックする。

**底層 mutation 呼び出し**（シグネチャが異なる）:
- transfer: `applyLandContractTransferGoal(ctx, {...reason:'war'})` → `CtxResult<void>` を unwrap。`err` 時は white_peace 安全終結。
- tax: `adjustLandContractTaxRate(state, contractId, newRate)` / `eliminateContractFromChain(state, contractId, inheritedTaxRate?)` → いずれも `WorldState` を返す（ctx は取らない）。elimination 判定条件は既存 `applyChangeContractTaxRate` / 旧 ConflictResolutionSystem を踏襲。

**event 責務（経路別）**:
- transfer: `applyLandContractTransferGoal` が `LAND_CONTRACT_*`（CONQUERED 等）を内部発行するため、PeaceSettlement 側で重複発行しない。
- tax: 底層 mutation が event を出さないため、PeaceSettlement 側で `PEACE_SETTLEMENT_APPLIED`（major）を発行する。
- 勝敗時に `WAR_WON` / `WAR_LOST`（major）、white_peace / cancelled 等の終結時に `WAR_ENDED`（major）。

戦争被害（treasury / unrest / 荒廃 / 厭戦）は適用しない（将来再設計）。

### 6.47 cancelOrphanedWarsSystem（毎週）

active War の primary participant（attacker / defender いずれか）が missing / inactive になった場合、`cancelled` 終結（`endedWeek` 設定 + `WAR_ENDED` 発行、WarGoal 不実行）にする。戦争は数年続くため、その間に participant polity / house が別要因（属州独立・併合・revolt など）で消滅しうる。IntegrityCheck（§6.35）が active War の participant を active 必須とするため、放置すると long-run で必ず throw する（`cancelOrphanedPlays` が DiplomaticPlay に対して存在するのと同じ理由）。安全側で `cancelled` に統一する（勝敗意味論は将来）。

**配置**: PolityOwnerConsistencySystem / OrganizationConsistencySystem の**後ろ**・cleanupWarSystem の前に独立 system として置き、**intervalWeeks=1**。理由は §5.6 / §6.35 を参照（PeaceSettlement 起因で同 tick に extinct 化した polity を参照する active War を、年末 IntegrityCheck より前に回収するため）。warScore 計算の安全は WarManeuver / PeaceSettlement 冒頭の dead-participant guard が担保するので、本 system を Maneuver / Settlement より後ろに置いても問題ない。

### 6.48 RegimentRecoverySystem（毎週、baseline-aware）

active Regiment の organization と morale を週次で **baseline へ向けて回復 / 減衰**させる（`runRegimentRecoverySystem`）。WarManeuverSystem の直後（PeaceSettlement の前）に interval 1 で走り、battle で削れた統制・士気を平時に立て直す。

- 対象は `status === 'active'`。各連隊で **org recovery は tick 開始時の morale を参照**するため `moraleAtTickStart = morale` を先に退避する。
- **organization**: `< baselineOrganization` なら `+ regimentOrganizationRecoveryPerWeek × (0.5 + moraleAtTickStart/100)`、`> baselineOrganization` なら `− regimentOrganizationDecayAboveBaselinePerWeek`。最後に `clamp(0, maxOrganization)`。baseline で静止中は変化なし。
- **morale**（org と独立）: `< baselineMorale` なら `+ regimentMoraleRecoveryPerWeek`、`> baselineMorale` なら `− regimentMoraleDecayAboveBaselinePerWeek`。`clamp(0, maxMorale)`。
- **strength は触らない**（回復は §6.50 RegimentReinforcementSystem）。
- `nextOrg === organization && nextMorale === morale`（baseline 静止）なら連隊単位で skip。全連隊変化なしなら draft を clone せず素通し（perf。lazy clone-once）。
- worldgen は initial = baseline（org 50 / morale 30）で生成するので、平時連隊は静止し recovery rate に依存しない（reform 連隊や battle 後の連隊のみ rate で baseline へ戻る）。

organization / morale はともに §3.9b の baseline/max を使う双方向収束で回復・減衰する。

### 6.49 RegimentMaintenanceSystem（毎週）

active Regiment の owner / home / war 参照を lazy に整理する（`runRegimentMaintenanceSystem`）。soft reference（currentWarId / owner active / homeHolding 存在）は IntegrityCheck の hard invariant にしない方針（§3.9b / §6.35）なので、本 system が遅延処理で整合を回復する。consistency 系の後・cleanupWarSystem の前に interval 1 で走る（cancelOrphanedWarsSystem の直後）。

active Regiment ごとに**順序を厳守**して処理する:

1. `homeHoldingId` が set で `holdings` に存在しない → **disband**（home 消失）。
2. `homeHoldingId` が set で holding 在り、`holdingTerminalPolityCache[homeHoldingId]` が現 owner（polity）と異なる → **owner 付け替え**（terminal Polity へ。basePower / strength / organization / 動員状態は維持。土地移転で Regiment 数が単調減少しないための要）。ただし `disbandAfterWar === true` の Regiment は付け替えず **disband** する。この「owner を home terminal に同期する」判定・付け替え／disband 分岐は `regimentMutations.ts` の `syncRegimentOwnerToHomeTerminalMut`（純粋判定は `regimentOwnerSyncTarget`）に集約され、**この付け替えルールの唯一の真実**である。本 system は lazy-clone gate の事前判定にのみ `regimentOwnerSyncTarget` を使い、実体は同ヘルパーを呼ぶ。`reassignRegimentOwnerMut` を直接呼ぶのは同ヘルパー内の 1 箇所のみ（叛乱奪取の eager 同期（§6.29）と共有し、二重実装による drift を防ぐ）。
3. 付け替え後の owner を再 read し `!isActorActive(owner)` → **disband**（owner 消滅）。
4. `currentWarId` が live(active) war を指していない（war 無し or terminal）→ **demobilize**（PeaceSettlement / cancel で終結した War に動員が残るのを遅延解除）。さらに `disbandAfterWar === true` の Regiment は demobilize 後に **disband** する。

`disbandAfterWar`（regiment.ts のフラグ）は revolt 用の一時連隊（local_levy）を戦争終結後に退役させる仕組み（§6.44 / §6.46 revolt levies）。disband は war 参照解除を兼ねるため demobilize と二重処理しない。多くの週は土地移転 / 滅亡 / 終戦が無く no-op で素通りする（lazy clone-once）。

### 6.50 RegimentReinforcementSystem（月次・補充・再編成）

`organization` は §6.48 が週次回復する一方、`strength` は戦闘以外では回復しない。これを補完して active regiment プールが減る一方にならないよう、**プールを自己修復**させる（`runRegimentReinforcementSystem`）。RegimentMaintenanceSystem の**直後**に interval 4（月次）で走る。maintenance が active regiment の owner を terminal に揃え・home 消失/owner 失効を disband 済なので、整合した owner/home を前提にできる。

owner が Polity でない / `homeHoldingId` 無しは skip（worldgen は Polity owner のみ生成）。`sourceKind === 'local_levy'`（revolt 用の一時連隊。戦争終結後に disband する）は補充・再編成いずれの対象にもせず skip する。`treasury` は Polity 共有なので **RegimentId 昇順**（worldgen と同じ文字列比較）で決定的に処理する。rng は消費しない（deterministic だが strength が battle power にフィードバックするため **bit-identical ではない**）。

各 Regiment を 2 系統で処理する:

**A. active かつ `strength < maxStrength` → strength を silent 補充**（organization recovery と同じくイベント無し）。
- `homeControlFactor` = `holdingTerminalPolityCache[homeHoldingId] === owner.id ? 1 : 0`（二値。holding 消失・terminal 不明・owner 不一致は 0 = 補充不可）。0 なら skip。占領・封臣・段階的支配の反映は future。
- `popFactor` = `getRegimentHomeRecruitmentFactor`：homeHolding の該当 class POP（sourceKind→class: levy→peasants / urban_militia→townsmen / noble_retinue→nobles）を per-class reference で正規化し `[minPopFactor, maxPopFactor]` に clamp。POP は減らさない（源の厚みとして読むだけ）。
- `warStateFactor`：mobilized（`currentWarId` 在り）→ `warMultiplier × mobilizedMultiplier` / owner が active War 参加中 → `warMultiplier` / それ以外 → `peaceMultiplier`。
- `troopFactor` = cavalry なら `cavalryReinforcementMultiplier` else 1。
- `desiredGain = min(basePerMonth × popFactor × homeControl × warState × troopFactor, maxStrength − strength)`。
- **treasury は乗数でなく cap**：`costPerStrength = reinforcementCostPerStrength × (cavalry ? cavalryReinforcementCostMultiplier : 1)`、`affordable = treasury / costPerStrength`、`gain = min(desiredGain, affordable)`。`gain` 分 strength を増やし `treasury -= gain × costPerStrength`、`lastReinforcedWeek` を更新。

**B. destroyed かつ `destroyedWeek` 在り → reform（active に再編成）**。
- 条件：`currentWeek − destroyedWeek >= destroyedRegimentReformDelayWeeks` かつ homeControl=1 かつ owner active かつ `popFactor >= destroyedRegimentReformMinPopFactor` かつ `treasury >= destroyedRegimentReformCost`。
- 満たせば status を active に戻し strength/organization/morale を `destroyedRegimentReformInitial*` にリセット、`destroyedWeek` を消去、`lastReinforcedWeek` を更新、`treasury -= destroyedRegimentReformCost`、`REGIMENT_REFORMED`（minor）を emit。byOwner/byHomeHolding には destroy 後も残っているため **index 操作は不要**（byWar には居ない）。
- `disbanded` は再編成対象外（恒久解散）。

この補完により active regiment プールは戦間期に自己修復する。ただし reform には ≥`reformDelayWeeks` の平時が要り、開戦 AI は連隊在庫を見ないため、「全滅直後の Polity が攻撃側で開戦」transient は完全には解消しない（開戦 AI gate は future）。

### 6.51 cleanupWarSystem（毎週）

terminal War（active 以外）が `endedWeek` から `terminalWarRetentionWeeks` 経過したら `state.wars` および `warIndex`（byParticipant / byOriginDiplomaticPlay）から削除する。履歴は Event ログに残るため長期保持は不要。同じ削除ループで当該 War の `Battle` entity（§3.9c）も piggyback cleanup する（`battleIndex.byWar[warId]` の各 battle を `battles` から削除し、index entry も除去）。Battle は短期 entity なので、対応する War の retention 削除と同時に消える。

### 6.52 CleanupTerminalDiplomacy（毎週）

terminal status の DiplomaticPlay と関連 Pressure / DiplomaticOffer を state から削除する GC。IntegrityCheck の直前に置く。intervalWeeks は 1。

**offer cascade delete**:
- terminal Play の `offerHistoryIds` をたどり、関連 DiplomaticOffer をすべて `state.diplomaticOffers` から削除
- `currentOfferId` が `offerHistoryIds` に含まれていない場合、それも削除
- **削除順序: offer 先、play 後**。play を先に削除すると `offerHistoryIds` が失われるため

**Pressure 同期**:
- terminal DiplomaticPlay に紐付く Pressure を `pressureIndex.byDiplomaticPlay` で取得
- 関連 active な initiator Project（Pressure.relatedProjectId）を cancelled に
- 関連 active な respond_to_pressure Project（Pressure.responseProjectId）を cancelled に
- PRESSURE_RESOLVED / PRESSURE_CANCELLED Event を発火した後、Pressure を削除
- Project cancel 対象の判定は Pressure.status によらない（responded 状態でも関連 active Project は cancel する）

### 6.53 PersonGoalMaintenanceSystem（48週ごと）

Person Goal（人生目標）の生成と管理。成人時または初期生成時に 1 つの PersonGoalKind を選択。Person Goal は原則として固定であり、GoalMaintenanceSystem のレビュー・差し替え対象にはならない。

**生成対象**: alive / normal / `isLifeStageAtLeast(lifeStage, 'young_adulthood')` / active House 所属の Person。placeholder は除外。

**PersonGoalKind スコアリング**: trait (ambition/caution)、ability、attitude、office 保有、組織コンテキストから score を計算し、最高スコアの kind を選択。

**fulfillment**: Goal.progress を baseFulfillment として使用。`getPersonGoalFulfillment` selector で baseFulfillment + 現在状況由来の modifier を算出（0..100 に clamp）。

イベント: `PERSON_GOAL_CREATED`

### 6.54 PersonAimMaintenanceSystem（4週ごと）

Person Aim の生成・deadline 判定・waiting 再評価を管理。

**4w で実行する処理**: deadline 到達 Aim を failed に。target 無効 Aim を failed/abandoned に。waiting Aim の再評価（nextReviewWeek 到達時）。active Aim がない Person に Aim を生成。

**PersonAimKind 選択**: Goal Kind と状況に基づいてスコアリング。`support_organization_aim` を含む全 PersonAimKind が選択対象（スコアリング・target 解決・failure handling すべて実装済み）。

**Aim → Task 接続**: Aim 作成時に initial Task を生成し、activeTaskId を設定。

イベント: `PERSON_AIM_CREATED` / `PERSON_AIM_SUCCEEDED` / `PERSON_AIM_FAILED`

### 6.55 TaskSystem（毎週）

Task の生成・処理・outcome・ActivityLog・cleanup を同一 tick 内で完結する一体型 system。

**処理フロー**:
1. active Task の自動キャンセル判定（assignee 死亡/placeholder、owner inactive、target 消滅/terminal）
2. active Task を assigneePersonId ごとに集める
3. effectivePriority を計算（ownerDutyBonus + goalAlignmentBonus + urgencyBonus + taskKindPriorityBonus - overloadPenalty）
4. actionCapacity が許す限り Task を処理（base 2.0、ambition ≥ 0.7 で +0.5、age ≥ 60 で -0.5）
5. effortDone を加算（weeklyEffort = 1.0 × (1 + relevantAbility / 100)）
6. 完了した Task の outcome を判定（`determineTaskOutcome`）
7. ActivityLog を作成
8. target entity に結果を反映（outcome に応じた分岐処理）
9. 完了・失敗・キャンセルされた Task を state から削除

**outcome 判定** (`determineTaskOutcome`):
- `effectiveScore = abilityScore + roll * 100` (0〜220 の範囲)
- `threshold = difficulty * 2` (0〜200 の範囲)
- `effectiveScore >= threshold + successMargin` → success
- `effectiveScore >= threshold` → partial
- `effectiveScore < threshold` → failure

**prepare_project outcome 分岐**:
- success: Project を作成（creator を prepare_project の assignee、supervisor を selectProjectSupervisor で選定）
- partial: Project を作成するが targetProgress にペナルティ加算
- failure: Project を作成しない

**advance_project outcome 分岐**:
- success: progress += 25
- partial: progress += 10
- failure: progress += 0

**preparatory stage outcome 分岐** (targetRef.kind === 'project' かつ preparatory stage):
- success: preparation/leverage/commitment に full gain 加算（respond_to_pressure は gain 不適用）、stageAttemptCount リセット、次 stage へ遷移
- partial: partial gain 加算、同 stage に留まる（attempt 消費なし）
- failure: gain なし、stageAttemptCount increment、上限超過で Project failed

**target-side progress bridge**: DiplomaticPlay の target-side task 完了時に、`pressureIndex.byDiplomaticPlay` 経由で response Project を検索し、progress を加算する

**develop_holding budget 消費**: advance_project outcome 解決時に ProjectBudget を消費する。消費額 = `budget.required / (expectedTasks × projectBudgetMarginMultiplier)`。outcome に関わらず一律消費（費用はタスク内容に、進捗は結果に由来するため）。将来的に担当者能力による消費乗数を導入予定。

**Aim 系 Task outcome 分岐**:
- success: 通常処理（Aim progress +1、次 Task 生成等）
- partial / failure: progress を加算せず、aim は active のまま維持（次の personAimMaintenanceSystem サイクルで新 Task が生成される）

**DiplomaticPlay Task**: delegate に割り当て。side (initiator/target) で Task 種類の base score が異なる。delegate 能力が効果量に倍率（0.5 + ability/100）で影響。

**offer_compromise**: Task 成功時に新 DiplomaticOffer を作成する。
1. progress += offerCompromiseProgressDelta (15)（既存 progressGainMedium は使わない）
2. tension -= tensionReductionSmall (5)（既存通り）
3. lastRejectedOfferId を基に妥協方向へ調整した demands で新 offer を生成（基準幅 ±30%＝`COMPROMISE_ADJUSTMENT`、initiator / target で対称）。**交渉担当者の能力スケール（`personAbilityEffectsEnabled`、default ON）**: 提案側（proposer）の delegate（`initiator/targetDelegatePersonId`）の charisma/insight 平均を 0..120 中点 60 基準で `[-1,1]` に正規化し、`adjustment = 0.3 × (1 − skillNorm × negotiatorTermQualityEffect)`（=0.1 で ±10%）で妥協幅を縮める＝巧い交渉者ほど譲歩幅が小さく理想に近い額を要求する（呑まれれば好条件）。これは受諾スコア（`evaluateOffer`）には触れない**条件生成側**の効果なので、能力が task 成功→prep/leverage/commitment→`getEvaluatorNegotiationBonus` 経由で受諾側に効く間接経路との**二重計上にならない**。OFF / delegate 不在時は基準 0.3。`contract_tax_revision` の妥協 demand 生成は side 非依存のため、未使用だった `_side` パラメータは除去済み
4. play.currentOfferId を新 offer に更新、play.offerHistoryIds に追加
5. offer_compromise による progress は offerCompromiseProgressDelta に一本化（counterOfferProgressDelta との二重加算なし）

**negotiate_terms**: progress += negotiateTermsProgressDelta (8)。

イベント: `TASK_COMPLETED` / `TASK_FAILED` / `TASK_CANCELLED`

### 6.56 GoalMaintenanceSystem（4週ごと）

Goal の生成・レビュー・abandon を管理する。tick 登録は 4w だが、生成・レビューは内部 48w ゲートで制御。

**4w で実行する処理**: inactive になった Polity / House の Goal を abandoned にする。
**48w ゲートで実行する処理**: active Goal がない主体に Goal を生成。review timing の Goal を評価し、steer_polity_* House Aim から policyInfluenceBonus を加算して差し替え判断。

`owner.kind === 'person'` の Goal はスキップ（PersonGoalMaintenanceSystem で個別管理）。

GoalKind のスコアリングは `goalSelectors.ts` の `scorePolityGoalKind` / `scoreHouseGoalKind` で実装。system House は除外。

差し替え判断の keepScore は `progress*0.5 + (active Aim が 1 つでもあれば 10) + clamp(goalAge年, 0, 10)*5`。「進行中の Aim があるか」のボーナスは並列 Aim 数（§6.57）で増やさない（`Math.min(activeAims.length, 1)` でクランプ）。多数の並列 Aim が keepScore を吊り上げて Goal が永久固定されるのを防ぐため。

イベント: `GOAL_CREATED` / `GOAL_REVIEWED` / `GOAL_ABANDONED`

### 6.57 AimMaintenanceSystem（4週ごと）

Aim の生成・deadline 判定・target 無効化を管理する。tick 登録は 4w だが、Aim 新規生成は内部 48w ゲートで制御。

**4w で実行する処理**: deadline 到達 Aim を failed に。target 無効 Aim を failed/abandoned に。parent Goal が terminal の Aim を abandoned に。
**48w ゲートで実行する処理**: active Goal ごとに、並列上限 (cap) に達するまで active Aim を生成する。

**Aim 並列化（1 Goal = 複数 active Aim）**: 1 つの Goal の下に複数の active Aim を同時に持てる。これにより大国は複数の外交劇を、富裕な家は複数の開発を同時並行できる。

- **動的 cap（生成スロットル）**: `computeAimCapacityForGoal(state, config, owner)` が owner の規模/予算に応じて算出する。Polity = `aimCapacityBase + floor(terminalProvince数 / aimCapacityProvincesPerSlot) + floor(treasury / aimCapacityTreasuryPerSlot)`、House = `aimCapacityBase + floor(member数 / aimCapacityMembersPerSlot) + floor(wealth / aimCapacityWealthPerSlot)`。結果は `[1, aimParallelismCeiling]` にクランプ。treasury / wealth は **capacity の入力シグナル**であり消費はしない（経済メカニズムは別途）。
- **静的 ceiling（invariant）**: integrity（§6.24）が検査するのは動的 cap ではなく固定上限 `aimParallelismCeiling` のみ。動的 cap で検査すると国の縮小で capacity が下がった瞬間、合法に作った既存 Aim が偽の違反になるため。`aimParallelismCeiling = 1` にすると並列は無効化され旧挙動（1 Goal = 1 Aim）に戻る。
- **同一スロット重複禁止**: `aimSlotKey(kind, target?)`（target ありは `kind|targetRefKey`、なしは `kind`）が同一の Aim を二重に持つことを防ぐ。生成側（`pickAimForGoal` の候補除外 `excludedSlots`）と integrity の重複検査が **同一のキー**を共有する。target を持たない kind（`patronize_artist` 等）は同種を 2 つ並列に持てない。
- 候補が枯渇（除外後に候補なし）した時点で生成を打ち切る。

Aim target 選定は `goalSelectors.ts` の `pickAimForGoal` で実装。

- `improve_owned_contract_terms` / `demand_tax_increase_from_vassal` は `external_expansion` / `internal_development` 両方の goal で候補に入る（税率交渉は対外・内政どちらの文脈でも合理的なため）
- 対象契約の `termsProtectedUntilWeek` が現在週を超えている場合はスキップ
- **減税系 aim の受諾見込みゲート**: `improve_owned_contract_terms` / `eliminate_overlord_contract`（いずれも vassal → grantor への減税要求）は、対象契約の grantor（宗主）が polity でありかつ `predictPressureResponseStance(self, grantor) === 'resist'`（grantor が自分の `PRESSURE_RESIST_POWER_RATIO`=1.2 倍以上強い）の場合、候補に入れない。feudal chain 上、宗主はほぼ常に臣下より強く resist 確実なので、これを欠くと弱い臣下が「勝ち目のない減税要求」を量産し、外交劇は起こすが全て status_quo に終わる（「外交劇は起こすが何も変わらない」連発）。`predictPressureResponseStance`（`selectors/pressureStanceSelectors.ts`）は `choose_stance` の実 stance 決定（§6.57 / 後述）と play 開始ゲート（§6.42）で共有する単一の式で、将来 `getActorMilitaryPower` の算出が変われば予測と実応答の両方へ自動反映される。
- **political_right_target の無効化（v0.42 acquire 開放に伴う枝刈り）**: target validity 判定に
  political_right_target ケースを持つ。非 owner 開放で複数家が同一 target を狙うレースが
  起きるため、(a) 既に right が存在し holder が aim owner 自身でない（レース負け）、
  (b) target の polity が inactive、(c) office target の slot ≥ effectiveMax（縮小で取得不能化）、
  (d) holding 消滅 / regiment disbanded（destroyed は valid — right は destroyed を生き残る）の
  いずれかで aim を failed にする。holder が自家の right は valid のまま（project 成功後も
  progress 100 まで aim を回す既存 lifecycle に触れない）。失効条件は §6.65 の right 失効条件と平行。

イベント: `AIM_CREATED` / `AIM_FAILED` / `AIM_ABANDONED`

### 6.58 PressureSystem（毎週）

active Pressure に対して respond_to_pressure Project を自動生成する。

**処理**: active かつ responseProjectId がない Pressure を走査し、target Polity の leader を取得。leader が alive / normal なら respond_to_pressure Project を作成。supervisor は `selectProjectSupervisor` で能力・workload ベースで選出（fallback: leader）。

**Project 初期値**: owner = pressure.target、origin = { kind: 'system', reasonKey: 'pressure_response' }、currentStageKey = 'choose_stance'、deadlineWeek = DiplomaticPlay.deadlineWeek or absoluteWeek + pressureResponseDefaultDeadlineWeeks。

**重複防止**: Pressure.responseProjectId が設定済みなら再生成しない。response Project が failed/cancelled でも responseProjectId を維持する（ループ防止）。

イベント: `PROJECT_STARTED`

### 6.59 AimOutcomeSystem（4週ごと）

terminal DiplomaticPlay の aimId を確認し、Play の結果に応じて Aim progress を更新する。settled / resolved_by_conflict（勝利）→ progress += `aimProgressGainLandOrContractProject` (50), successfulProjectCount +1。failed / resolved_by_conflict（敗北）→ failedProjectCount +1。activeDiplomaticPlayId をクリア。`progress >= targetProgress - aimProgressCompletionTolerance` で progress を targetProgress に丸め、Aim succeeded。

progress 加算値は targetProgress=100 ベース。非外交系 Project の Aim progress は ProjectOutcomeSystem が加算する（二重加算防止）。

イベント: `AIM_SUCCEEDED`

### 6.60 GoalOutcomeSystem（4週ごと）

terminal Aim の goalId を確認し、Aim 結果に応じて Goal progress を更新する。succeeded → +25、failed → -10、abandoned → -5（config 経由）。progress を 0..targetProgress にクランプ。progress >= targetProgress で Goal succeeded。

`owner.kind === 'person'` の Goal は progress を 0..100 にクランプし、succeeded にはしない（Person Goal は人生目標であり達成判定を行わない）。

**冪等ガード**: 本 system は毎 tick（4週）に terminal Aim を全走査する。外交系 Project が Aim を保持して CleanupTerminalDecisions が削除できない間（§6.61 retention）、同じ terminal Aim の progressDelta が Goal に再加算されないよう、Aim に `goalProgressApplied` フラグを設け、一度加算した Aim はスキップする（加算時に true をセット）。

イベント: `GOAL_SUCCEEDED`

### 6.61 CleanupTerminalDecisions（4週ごと）

terminal Goal / Aim を WorldState から削除。orphan DecisionReason を削除。goalIndex / aimIndex を更新。CleanupTerminalDiplomacy の後に配置。

**retention（削除しない条件）**: terminal でも以下に参照される間は削除しない。

- Aim: active な Project（`origin.aimId`）または DiplomaticPlay（`aimId`）が参照する Aim は保持（Project は origin Aim の存在を要求するため）。
- Goal: active な DiplomaticPlay（`goalId`）が参照する Goal は保持。
- **Goal（Aim 依存チェーン保持）**: 上記で生存する Aim が `goalId` で参照する Goal も保持し、`active Project → origin Aim → Goal` の依存チェーンを完結させる。これを欠くと、terminal Goal が「active Project に保持された terminal Aim」より先に削除され、Aim の `goalId` が dangling 化して年末 IntegrityCheck（`Aim X: goalId Y does not exist`）で throw する。Project 完了で Aim が解放されると、次回 cleanup で Aim → Goal の順に削除され収束する。

---

### 6.62 ChronicleProjectionSystem（毎週）

歴史閲覧 read-model（`ChronicleEntry`、§3.14）を生成する system。`scheduledSystems` の**末尾**（全 system / cleanup 系の後、`flushTerminalEntities` / IntegrityCheck の前）に配置する。この tick の `ctx.events` のうち curated allowlist `CHRONICLE_EVENT_TYPE_DEFINITIONS` に載る EventType だけを `ChronicleEntry` に projection し、新たな `SimEvent` は emit しない。各 system からの dual-write にせず projection 一本にすることで Event と履歴の divergence を防ぐ。cleanup 後に走るため同 tick の event が全量揃い、IntegrityCheck の前なので生成分も同 tick で index↔entry 整合検査される（§6.35）。

**allowlist の方針**: importance 閾値ではなく curated allowlist で対象を決める（`BATTLE_OCCURRED` は normal だが含めたい／`PERSON_AIM_SUCCEEDED` は major だが noise になりやすい）。各 EventType に `{ category, retainRefKinds?, templateKey? }` を割り当てる。

- **category**（§3.14 の 11 種）— war: `WAR_DECLARED` / `WAR_WON` / `WAR_LOST` / `WAR_ENDED` / `PEACE_SETTLEMENT_APPLIED`。battle: `BATTLE_OCCURRED`。land: `LAND_CONTRACT_TRANSFERRED` / `CONTRACT_TAX_REVISED`。house: `HOUSE_FOUNDED` / `CADET_HOUSE_FOUNDED` / `HOUSE_SPLIT` / `HOUSE_EXTINCT` / `HOUSE_LEADER_CHANGED`。governance: `POLITY_OWNER_CHANGED` / `POLITICAL_RIGHT_GRANTED` / `POLITICAL_RIGHT_REVOKED` / `POLITICAL_RIGHT_TRANSFERRED`（v0.42）。revolt: `REVOLT_POLITY_FOUNDED` / `REVOLT_NEGOTIATION_STARTED` / `REVOLT_ESCALATED` / `REVOLT_SUPPRESSED` / `REVOLT_SETTLED` / `REVOLT_POLITY_ESTABLISHED` / `REVOLT_REGIME_CHANGED`。disaster: `FAMINE` / `PLAGUE`。development: `COUNTRY_LAND_DEVELOPED`。office: `OFFICE_ASSIGNED` / `OFFICE_TERM_ENDED` / `BAILIFF_APPOINTED` / `BAILIFF_VACATED`。faction: `FACTION_FOUNDED` / `PERSON_RECRUITED_TO_FACTION` / `FACTION_MEMBER_ABANDONED` / `FACTION_LEADER_CHANGED` / `FACTION_DISSOLVED`。life: `IMPORTANT_PERSON_DIED` / `PERSON_CAME_OF_AGE` / `PERSON_ENTERED_OLD_AGE`。
- **retainRefKinds**（projection 時に entityRefs をこの kind に絞る）— `OFFICE_ASSIGNED` / `OFFICE_TERM_ENDED` は `['person']`。役職任命は高頻度なので Person の「経歴」として byPerson だけに載せ、house / polity ref を落として国史・家史が行政ログで埋もれるのを防ぐ（役職名・Polity 名は params にあり、UI は entityRefs から link を描かないので表示は不変）。`BAILIFF_*` は person+province 無制限（人物経歴 + 地方統治史の両方に載せる）。faction 系は entityRefs が person（＋ index 非対象の faction kind）のみのため retainRefKinds 不要で自然に byPerson だけに載る（「誰と組んだか」を人物経歴に残す）。`PERSON_CAME_OF_AGE` / `PERSON_ENTERED_OLD_AGE` は retainRefKinds を指定せず、ref-kind の出し分け（一般人物 = byPerson のみ / 主要人物 = byPerson+byHouse+byPolity）は emit 時に entityRefs を変えて行う（§6.25）。
- **templateKey**: 通常は `event.messageKey` を流用。`BATTLE_OCCURRED` のみ関数 `selectBattleTemplate(event)` が messageParams の派生フラグから rich template を選ぶ（数的不利勝利 / 大勝 / 辛勝 / 通常、§8 / §11）。

**emit 整備（projection の前提となる source 側の emit）**:

- `mortalitySystem`: notable death（house / polity leader 相当）を `PERSON_DIED` から `IMPORTANT_PERSON_DIED`（major）へ type 昇格して emit する（単一イベント・重複なし・RNG 中立）。notability は office 剥奪前にしか正確に取れないため source で捕捉する。これで life カテゴリが成立する。
- `COUNTRY_LAND_DEVELOPED`: holding ref を 1 件 additive 追加し、施設開発を Holding 史（byHolding）にも載せる。

実 volume: ~41-43 件/年。office が ~62% を占めるが byPerson 限定のため中核 panel（国史 / 家史 / 地方史）には出ない。

---

### 6.63 OfficeTermSystem（48週ごと = 毎年）

毎年 1 回、任期が満了した leader 以外の Office を inactive 化する（`runOfficeTermSystem`）。`officeAssignments` を OfficeAssignmentId 昇順で走査し、各 active Office について以下を判定する:

- `office.role === 'leader'` は対象外（leader は OfficeTermSystem では失効させない。SuccessionSystem が管理する）。
- `isOfficeTermExpired(state, config, office)` が true（`officeTermYears` 経過）の Office を `expireOfficeTermAssignment` で inactive 化し、`OFFICE_TERM_ENDED`（importance: normal）を発火する。

Bailiff（HoldingOffice）にも任期があり、`provinceOfficeTermYears.bailiff` で管理する。任期満了で役職が空くと、AppointmentSystem（§6.19）の支払能力ゲートにより、収入を失った家の役職は再任命を通らず数年のラグで自然に減衰する。

イベント: `OFFICE_TERM_ENDED`（importance: `normal`）— `entityRefs` に holder Person・所属 House・（polity 役職なら）Polity を載せる。


---

### 6.64 PoliticalRight / Polity Influence（v0.42）

v0.42 で Polity の内部権力構造を「抽象的な Polity share」から「具体的な政治権利 **PoliticalRight** と、
それらから導出される **Polity Influence**（read-model）」に置き換えた。Polity share は全廃され、
House 内部の Share（HouseShare、§3.7）のみが一次データとして残る。

**PoliticalRight**（entity — §3 参照）:
- target は 3 種: `polity_office_role`（polity の non-leader role の**特定スロット**への任命権 —
  v0.42 slot 化）/ `holding_office_role`（Holding の bailiff 任命権）/ `regiment`（連隊の管理権）
- **slot 単位（v0.42 slot 化）**: polity office right は役職全体ではなくスロット 1 席
  （`slotIndex`、0-based）を支配する。maxHolders 3〜5 の役職で 1 right が全席を支配して
  権力が偏る問題と、同一役職内の家同士の対立を表現できない問題への対処。
  effectiveMax 縮小時は**列の後ろ（slotIndex 大）から失効**する（§6.65）ため、
  先頭スロットほど確保する価値が高い。失効した right は領土回復で slot が戻っても
  復活しない（hard-delete 原則。再取得が必要）。slotIndex は生成時に
  0 ≤ slot < 静的 maxHolders を検査（動的 effectiveMax の縮小は §6.65 が毎週回収）
- kind・tenure フィールドは持たない（target.kind / holder.kind から導出。保存すると drift の余地だけが生まれる）
- holder は person | house。**person 死亡 / house 絶家で失効**（即時 cascade: markPersonDead / worldStructureExtinction）
- **1 target 1 active right**（byTarget index の各 entry length ≤ 1）。hard-delete（active=false 残置なし）
- leader role は right の対象にしない（leader の地位は Succession / PolityOwnerConsistency が管理）
- **residual authority**: right が無い target の権限は entity として保存せず、「現行ロジックそのもの」が残余権限の実装
  （polity office = 通常スコアリング / bailiff = ownerHouse プール / regiment = owner Polity 管理）
- **regiment right の失効規則**: destroyed では失効しない（制度的単位・編制枠への権利と解釈。同一 RegimentId で
  reform されれば継続。destroyed 中は influence 寄与のみ 0）。disbanded（制度的解散）で即時失効
  （disbandRegimentMut 内 cascade）。owner Polity が right.polityId と一致しなくなったら RightConsistencySystem
  （§6.65）が失効させる
- 失効 cascade は mutation 層では silent（office の死亡時 revoke と同じ扱い）。POLITICAL_RIGHT_REVOKED は
  RightConsistencySystem の drift 回収時のみ発行
- **生成経路**: worldgen では生成しない（all residual で開始）。通常の生成経路は `acquire_political_right`
  Project（§6.41 / 下記）のみで、holder は owner House の household right。personal right（holder=person）は
  型・mutation・integrity 基盤のみ存在し v0.42 では通常生成されない（unit test が唯一の検証。将来拡張の余地）

**Polity Influence**（read-model — selector `getPolityInfluenceBreakdown`）:
- entity ではなく随時計算。entry 母集合 = 土地ベース House（getPolityHouseIds）∪ office holder の House ∪
  right holder ∪ anchor Faction leader の House ∪（ownerHouseId 未定義の polity の）leader Person
- 9 domain: base（House entry 一律）/ ruler（ownerHouse bonus。**非 ownerHouse 出身 leader の家には
  polityInfluenceLeaderHouseBonus** — ownerHouseBonus の 1/3 程度。leader∈ownerHouse なら二重計上しない。
  commonwealth は leader Person entry に ownerHouseBonus 相当）/ office（non-leader holder。overlap bonus は
  office 寄与への乗算相当を加算）/ military（military office holder + active regiment への regiment_control right）/
  land_administration（holding right + 現職 bailiff の House）/ landed_power（**対象 Polity 内限定**の province 数 +
  military proxy）/ wealth / prestige / faction（anchor Faction leader の House のみ — member 加算は future）
- percent は **0〜100**（既存 share 系と同スケール。比率が必要な箇所は /100）
- perf: 候補者ループ内で呼ばない。polity ごとに 1 回前計算して `getActorInfluenceFromBreakdown` で引く

**acquire_political_right Aim / Project**（旧 increase_polity_share / expand_polity_share の置換）:
- Influence は read-model なので「直接増やす」対象ではない。上げたければ具体的な権利・役職・土地を取る
- **対象 polity（非 owner 開放 — v0.42 拡張）**: 当初は自家所有 polity（`polityIndex.byOwnerHouse`）
  限定だったが、「家が influence を持ちうる polity」全体に拡大した。狙いは「王権が弱った国で
  臣下・廷臣の家が任命権を取り合う」状況の発生。候補集合は selector
  `collectAcquireRightCandidatePolityIds` が influence breakdown（上記）の entry 導入 source と
  1:1 対応で列挙する: 自家所有 polity / その**宗主チェーン全段**（land contract の
  parentContractId を上に辿る — 直接宗主のみだと多段封建で取りこぼす）/ 生存 member が
  polity office・bailiff を務める polity / 生存 member が leader の active Faction の anchor
  polity / 既保有 right の polity。過剰包含は influence ゲートが落とすので無害、過少包含は
  「influence があるのに aim が出ない家」の silent miss になる（この被覆が正しさの条件）
- Aim 生成条件（ゲート — 全家一律、owner / 非 owner で差を付けない）:
  `acquirePoliticalRightRequiredInfluencePercent` ≤ 対象 Polity への influence% <
  `acquirePoliticalRightMaxInfluencePercent`。**上限ゲート（v0.42 拡張）**は「既に掌握済みの
  polity の権利を買い続ける」不自然の排除 — right の無い役職の任命は influence ベース
  （§6.19 のスコアリング）なので、掌握済みの家にとって right は実質不要。上限判定は
  **Aim 生成時のみ**（保持中に influence が上限を超えても aim は invalidate しない）
- target 選定: kind 優先度 polity_office（military > administrator > treasurer > advisor、
  各 role 内は slot 0..effectiveMax-1 の若い順 — v0.42 slot 化。先頭 slot ほど縮小に強い安全資産）
  > holding（House 関与 province の Holding 優先・id 昇順 = 近接優先の決定的簡略化）
  > regiment（active のみ・House 関与 home 優先）。
  いずれも right 未設定のもの。`aimSlotKey` に politicalRightTargetKey（slot を含む）が含まれ
  同一 (target, slot) への重複 aim を防ぐ
- 成功条件は createPoliticalRight の検査（target 実在 / polityId 整合 / 既存 right なし / holder House active）に
  集約。**コストは House wealth から対象 Polity treasury への transfer**（wealth sink ではない —
  旧 expand_polity_share の sink 消滅による経済変化を緩和し、「国庫に納めて権利を授かる」物語になる）
- 既存 right holder から奪う処理は v0.42 では行わない（争奪・剥奪・派閥闘争は future）

**イベント**: `POLITICAL_RIGHT_GRANTED` / `POLITICAL_RIGHT_REVOKED` / `POLITICAL_RIGHT_TRANSFERRED`
（importance: normal、chronicle category: governance）。messageParams は nameKey / enum のみ
（rightKind / revokeReason は events ns の enum.* ラベルに解決）。TRANSFERRED は v0.42 に通常発火経路が無く
（transferPoliticalRight は将来の PeaceSettlement / regime change 用）、unit test が唯一の検証。

実測（300 年 × 4 seed）: GRANTED 118〜141 件 / REVOKED は regime change の drift 回収として有機的に発火。

### 6.65 RightConsistencySystem（毎週）

PoliticalRight の drift を定期回収する安全網。**regimentMaintenanceSystem の直後・cleanup 系の前**に配置する
（regimentMaintenance が Regiment owner を terminal Polity に同期した後でないと、owner 変化による
regiment_control right の失効を回収できない）。

**interval は 1（weekly）必須**: 年末 integrity は absoluteWeek ≡ 47 (mod 48) の tick 末尾で走るが、
interval 4 / offset 0 の system は weekOfYear 1, 5, …, 45 にしか走らず**年末 tick に走らない**。
weekly の regimentMaintenance が weekOfYear 46〜48 に owner を付け替えると、4 週間隔では drift が
未回収のまま年末 integrity に到達して throw する。cancelOrphanedWarsSystem（§6.47）と同じ weekly パターン。
年末 invariant を守る cleanup は (a) weekly か (b) drift 源と co-locate（atomic）のどちらかでなければならない
（Faction 解散 / right 削除 cascade を PolityOwnerConsistency の deactivate 経路に co-locate しているのは (b)）。

**検査内容**（不整合なら hard-delete + POLITICAL_RIGHT_REVOKED 発行。revokeReason enum:
holder_lost / polity_dissolved / target_lost / regime_change）:
- holder が存在し有効（person: alive・normal / house: active）
- right.polityId が active Polity
- target が存在する（regiment は status !== 'disbanded'。destroyed は許容）
- target と polityId が整合する（office target.polityId / regiment owner / holding terminal polity）
- **office right の slot 失効（v0.42 slot 化）**: `slotIndex >= getEffectiveOfficeMaxHolders(...)`
  なら target_lost。effectiveMax は rank / 領土数で動的に変わり **0 にもなり得る**
  （rank cap 0 の role では slot 0 の right も失効）。「列の後ろから失効」の実装はここ
  （findRightInconsistency は config を引数に取る）

即時 cascade（一次手段）との分担: person 死亡・house 絶家・regiment disband・polity inactive は mutation 層で
即時削除（silent）。本 system は「mutation では追わない」regiment owner 付替・holding terminal 変化などを回収する。

**IntegrityCheck 追加項目（v0.42）**:
- R1: holder は存在し有効（person: alive かつ normal / house: active）
- R2: polityId は active Polity
- R3: target は存在する（regiment は disbanded のみ違反、destroyed 許容。leader role target も違反）
- R4: target と polityId が整合する
- R5: byPolity / byHolder / byTarget index と politicalRights の双方向一致
- R6: 1 target 1 active right（byTarget の各 entry length ≤ 1）
- F8: active Faction の polityId は active Polity（+ factionIndex.byPolity の双方向一致）
- HouseShare: polity share は**存在自体が違反**（型レベルでも HouseShare に縮小済み — §3.7）
