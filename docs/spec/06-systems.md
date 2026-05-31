# 6. 各システムの仕様

### 6.1 DevelopmentSystem（v0.27 で削除）

**v0.27 で削除。** `Holding.development` 保存値が廃止され、development は HoldingImprovement から selector で算出する（§4.1 参照）。関連 config（`developmentPositiveMonthlyDecay` / `developmentNegativeMonthlyRecovery`）も削除。

### 6.2 ControlSystem（4週ごと）

Polity ごとに首都から BFS、House ごとに本拠地から BFS を行い、各 Province の支配力を更新する。

**支配力上限（二段階 clamp）**:

```ts
// 距離ベースの上限
baseMaxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
// 能力補正後の上限（能力最低床を別途設定）
maxControl = clamp(baseMaxControl + maxControlBonus, controlAbilityMinimumFloor, 100)
// 首都 / 本拠地は常に上限 100
```

`maxControlBonus` は Polity administrator（polityControl）の admin stat から算出される（§10 参照）。v0.16 で `houseControl` は廃止された。

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
- polityControl: 首都 (`capitalProvinceId`) から全 Province を通行可（v0.20 で制限を撤廃）

**v0.20**: polityControl は Province ではなく **Holding 単位**で更新する。BFS は Province graph 上を走査し、到達した Province 内の各 Holding の `polityControl` を距離に応じて更新する。Province レベルの polityControl は selector (`getProvincePolityControlFromHoldings`) で Holding の weight 加重平均から算出する。

### 6.3 LordshipTransitionSystem（v0.16 で廃止）

旧 v0.15 までの「隣接 Province 間で houseControl が下回ると ownerHouseId を奪う」ロジックは v0.16 で廃止された。土地支配は LandContract chain に統一され、Province 単位の所有変動は WarSystem（§6.20）/ ProvinceRevoltSystem（§6.22）/ LandContractPurchaseSystem（§6.22d）に集約される。

参考までに、廃止前の動作は以下のとおりだった。

#### 旧 v0.15 仕様（参考、現在の tick からは外れている）

隣接する強力な領主による Province 吸収を処理する。スナップショットパターンで実装（連鎖防止）。

**target の条件**:
- `target.houseControl < lordshipAbsorptionTargetThreshold`
- `target.id !== ownerHouse.seatProvinceId`

**neighbor 候補の条件**:
- `neighbor.polityId === target.polityId`
- `neighbor.ownerHouseId !== target.ownerHouseId`
- `neighbor.houseControl >= lordshipAbsorptionSourceMinimum`
- `neighbor.houseControl >= target.houseControl * lordshipAbsorptionRatio`

最高 houseControl の neighbor を採用（同値はランダム）。確率 `lordshipAbsorptionMonthlyChance` で発動。

**効果**:
```
target.ownerHouseId = neighbor.ownerHouseId
target.houseControl = clamp(neighbor.houseControl - penalty, newControlMin, newControlMax)
```

イベント: `LORDSHIP_TRANSFERRED`（importance: `minor`）
```
summary: "${新House.name} absorbed ${province.name} from ${旧House.name}."
```

### 6.4 PopSystem（4週ごと、v0.24 更新）

POP の自然変化を処理する。Province の carrying capacity に基づいた人口圧制御、occupation overflow、wealth/unrest の自然変化を担当する。

**6.4.1 人口成長（v0.24 更新）**

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

**6.4.1b 人口増加時の overflow（v0.24 追加）**

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

**6.4.2 population pressure の影響**

pressure が閾値を超えると土地不足・過密に相当する影響が発生する：

```ts
if (pressure > config.populationPressureThreshold) {
  const excess = pressure - config.populationPressureThreshold
  pop.wealth -= excess * config.populationPressureWealthPenalty
  pop.unrest += excess * config.populationPressureUnrestGain
}
```

**6.4.3 poverty / prosperity 効果**

```ts
if (pop.wealth < config.povertyWealthThreshold) {
  pop.unrest += (config.povertyWealthThreshold - pop.wealth) * config.povertyUnrestGain
}
if (pop.wealth > config.prosperityWealthThreshold) {
  pop.unrest -= (pop.wealth - config.prosperityWealthThreshold) * config.prosperityUnrestReduction
}
```

**6.4.4 unrest 自然減衰**（v0.20.3 追加）

```ts
pop.unrest *= 1 - config.unrestNaturalDecayRate
```

**6.4.4b none POP ペナルティ（v0.24 追加）**

```ts
if (pop.occupation === 'none') {
  pop.wealth -= config.unemployedWealthDecayByClass[pop.class]
  pop.unrest += config.unemployedUnrestGainByClass[pop.class]
}
```

**6.4.5 clamp（v0.24 更新）**

`occupation !== 'none'` の POP は `minPopSizeByClass` で下限保証。`none` POP は 0 まで減少可能。

```ts
const minSize = pop.occupation !== 'none' ? config.minPopSizeByClass[pop.class] : 0
pop.size = Math.max(minSize, newSize)
pop.wealth = clamp(pop.wealth, 0, 100)
pop.unrest = clamp(pop.unrest, 0, 100)
```

**normalizePopSizes**（IntegrityCheck 直前、v0.24 更新）: `occupation !== 'none'` の POP は `minPopSizeByClass` で下限保証。`occupation === 'none'` の POP は size が `popSizeEpsilon` 以下で削除する。

### 6.4b EmploymentRebalanceSystem（4週ごと、v0.24 追加）

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

### 6.5 EconomySystem（v0.16 で廃止 → LandRevenue + PolitySurplusDistribution に分割）

旧 v0.15 までの EconomySystem は v0.16 で 2 つの system に分割された:

- **LandRevenueSystem** (§6.5a): Province 生産から各 Polity treasury への上納
- **PolitySurplusDistributionSystem** (§6.5b): Polity treasury から Share holder への分配

過徴税ペナルティは LandRevenueSystem 側で継続。`houseControl` 経由の二重収入経路 (`houseIncome`) は廃止された。House への富の流れは Polity Share 経由でのみ発生する（§6.5b）。

### 6.5a LandRevenueSystem（4週ごと、v0.16 / v0.20 / v0.24 / v0.25 更新）

Province の生産を **Holding 単位で分配**し、代官による現地徴収を挟んだ上で、各 Holding の LandContract chain に沿って上納する。

**6.5a.1 生産量算出（v0.24 更新）**

v0.24 で occupation productivity multiplier を追加。各 POP の生産量は `pop.size * productivityByClass * occupationProductivityMultiplier * (wealth/100) * holdingDevMod * holdingControlMod` で算出する。`none` POP の生産性は 0.1（最低限の日雇い・自給を表す）。

```ts
const production = getProvinceProduction(state, config, province.id)
```

**6.5a.2 per-Holding 分配と代官徴収（v0.20 / v0.25 extraction model）**

Province 生産を各 Holding の share weight に応じて分配する。

```ts
// §12.3: Holding の share weight
holdingShareWeight = holding.weight * holding.landQuality * kindMultiplier(holding.kind)
// kindMultiplier: manor = 1.0, city = 1.3

// Province 全体の totalShareWeight
totalShareWeight = sum(holdingShareWeight for each Holding in Province)

// per-Holding 収入
holdingShare = production * (holdingShareWeight / totalShareWeight)
grossHoldingRevenue = holdingShare * (holding.polityControl / 100)
```

**v0.25**: 各 Holding の代官による現地徴収を挟む。

```ts
const localExtractionRate = getBailiffLocalExtractionRate(state, config, assignment.id)
const collectionEfficiency = getBailiffCollectionEfficiency(state, config, assignment.id, recentTaskStatus)
const collected = grossHoldingRevenue * localExtractionRate * collectionEfficiency
const bailiffFeeRate = getBailiffFeeRate(state, config, assignment.id)
const bailiffFee = collected * bailiffFeeRate
const remittanceToTerminal = collected - bailiffFee
```

通常人物代官には `bailiffFee` を `person.wealth` に加算する。placeholder 代官には加算しない。

**6.5a.2b chain 上納（v0.25 更新）**

各 Holding について、`remittanceToTerminal`（v0.25 以前は `holdingRevenue`）を chain に流す。

```ts
let remaining = remittanceToTerminal * taxEfficiency
for (const contract of chain.slice().reverse()) {
  const tax = remaining * contract.terms.taxRateToGrantor
  granteePolity.treasury += (remaining - tax)
  remaining = tax
}
```

`root contract` の `taxRateToGrantor` は 0 固定なので、world に流出する分は無い。

**6.5a.3 Polity treasurer の taxEfficiency**

terminal Polity の treasurer に能力補正がかかる（§10 参照）。`collectionEfficiency`（代官の現地徴収能力）とは別概念。

**6.5a.4 ~~過徴税ペナルティ~~ → Holding 単位の徴税負担処理（v0.25 で置換）**

**v0.25 で旧 Province 単位の `overExtractionPenalty` を廃止**し、Holding 単位の `totalBurdenRate` ベース処理に置換した。

```ts
const { collectionFrictionBurdenRate, totalBurdenRate } =
  computeBailiffBurdenComponents(localExtractionRate, collectionEfficiency, config.collectionFrictionFactor)

// POP wealth: 徴税摩擦による追加損耗（v0.28 で wealth 比例化）
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

**6.5a.5 retained wealth の POP 反映（v0.25 更新）**

v0.25 では `retainedToPop` を `provinceCollected`（各 Holding で実際に徴収された額の合計）ベースで計算する。

```ts
const provinceCollected = sum(collected for each Holding)
const retainedToPop = Math.max(0, provinceProduction - provinceCollected)
```

POP は生産の過半（標準で約 65%）を保持する。`retainedWealthGainByClass` による class 別 POP wealth 回復は維持。

**6.5a.6 debug log（v0.25）**

`config.debug === true` 時に `[BAILIFF]` ログを stderr に出力する。holdingId / collected / bailiffFee / remittance / rates / burden 等。

### 6.5b PolitySurplusDistributionSystem（4週ごと、v0.16）

各 Polity treasury から OrganizationShare に応じて Share holder に分配する。給与・維持費 (OfficeCompensationSystem §6.14b) は別 system で支払う。

```ts
// v0.28: reserveTarget を所領規模に応じて動的に計算
const holdingCount = /* polity の terminal province 全体の holding 数 */
const reserveTarget = config.polityTreasuryReserveBase
  + config.polityTreasuryReservePerHolding * holdingCount

const distributable = Math.max(
  0,
  polity.treasury - reserveTarget
) * config.politySurplusDistributionRate

// Polity の OrganizationShare 全 holder に rawPower 比で分配
for (const share of getOrganizationShares(state, { kind: 'polity', id: polityId })) {
  const portion = distributable * (share.rawPower / totalRawPower)
  if (share.holder.kind === 'house') {
    house.wealth += portion
  } else {
    // Person holder。alive チェック必須
    if (!person.alive) continue
    person.wealth += portion
  }
}
polity.treasury -= distributedTotal
```

`reserveTarget` は `polityTreasuryReserveBase`（暫定 50）+ `polityTreasuryReservePerHolding`（暫定 50）× holding 数で動的に算出される。大国ほど多くの運営資金を確保し、プロジェクト費用や給与の支払いに備える。後続の OfficeCompensationSystem の給与原資となる（spec-v016-update.md §21）。

**v0.37**: 1 サイクルの `distributable = max(0, treasury - reserveTarget) × distributionRate` の計算を `getPolityDistributablePerCycle`（landContractSelectors）に集約し、本 system と House の投影年間収入 `getHouseProjectedAnnualIncome`（§6.14 支払能力ゲート）の両方から呼ぶ単一の正本とした（式の二重定義による drift 防止。挙動は bit-identical）。

**Person Share holder の死亡 skip**: holder Person が `!alive` の場合は分配しない（暫定挙動。家・相続人への流入は将来の課題）。

### 6.6 DisasterSystem（48週ごと = 毎年）

**v0.20.3 で大幅改修**: Province 単位の判定に変更。救済システムは一旦オミット（将来 Holding 単位 POP で再導入予定）。人口ダメージは割合ベースに変更。人口圧力による発生率増加を追加。

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
| Famine（飢饉） | 8% | +9.2/excess | ~~Province dev 低下~~（v0.27 無効化）、peasants wealth -8・population -10% |
| Plague（疫病） | 3% | +2.0/excess | ~~Province dev 低下~~（v0.27 無効化）、全 POP wealth -10・population -5% |
| BountifulHarvest（豊作） | 5% | なし | ~~Province dev 上昇~~（v0.27 無効化）、peasants/townsmen wealth 上昇・unrest 低下 |

**Famine の詳細**:
- ~~dev -= `famineDevastation`~~（v0.27 で無効化。将来 devastation/condition で再接続）
- peasants wealth -= `famineWealthPenalty`（default: 8）
- peasants size *= `(1 - famineSizeDamageRate)`（default: -10%）

**Plague の詳細**:
- ~~dev -= `plagueDevastation`~~（v0.27 で無効化）
- 全 POP wealth -= `plagueWealthPenalty`
- 全 POP size *= `(1 - plagueSizeDamageRate)`（default: -5%）

**BountifulHarvest の詳細**:
- treasury への直接加算なし。翌月以降の EconomySystem で POP production 上昇により国庫が増加する
- `adjustProvincePopWealthByClass(state, pid, 'peasants', +bountifulHarvestPeasantWealthGain)`
- `adjustProvincePopUnrestByClass(state, pid, 'peasants', -bountifulHarvestPeasantUnrestReduction)`
- `adjustProvincePopWealthByClass(state, pid, 'townsmen', +bountifulHarvestTownsmanWealthGain)`
- `adjustProvincePopUnrestByClass(state, pid, 'townsmen', -bountifulHarvestTownsmanUnrestReduction)`

### 6.7 MortalitySystem（4週ごと）

人物の自然死亡を処理。死亡が確定した Person について `markPersonDead` mutation を呼び、以下を一括で処理する（v0.13）：

1. `person.alive = false`
2. `clearSpouse` で配偶者側の `spouseId` も解除
3. `revokeOfficesByHolder` で当人が保有する全 OfficeAssignment を inactive 化
4. 所属 House の `memberIds` から除外し `deceasedMemberIds` に移動（v0.20.3）

家長（house:leader）が死亡した場合の後継選出は SuccessionSystem（§6.10）が担当する。

**v0.14**: 死亡者の `wealth` 分配は直後の EstateSettlementSystem（§6.7b）が処理する。MortalitySystem は死者を `TickContext.deathsThisTick` に追記し、`wasHouseLeader` / `wasPolityLeader` の役職情報を `TickContext.deathRolesThisTick` に保存して estate 処理に引き継ぐ（mortalitySystem 内で role を取得しないと markPersonDead が office を revoke するため後段では復元できない）。

### 6.7b EstateSettlementSystem（4週ごと、v0.14）

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
* 家に所属していない人物（v0.14 では稀）は houseRecoveryRate = 0 で全額相続人へ

**相続人決定（`findHeirs`）**: 最初にマッチした集合で確定:
1. 嫡出子のうち alive な者 全員
2. 配偶者（alive）
3. 嫡出兄弟姉妹（同 fatherId / alive / 同 house）
4. 家長（自分自身が家長だった場合は除外）
5. なし → wealth は全額家に回収（家もなければ消滅）

相続人は age 降順 + id 昇順 でソート（決定論性保持）。端数は最年長相続人 `heirs[0]` に寄せる。

**Mutation API**: `addPersonWealth`, `clearPersonWealth`, `addHouseWealth`（§12.2 参照）。

**イベント**:
* `ESTATE_SETTLED` は対象人物ごとに必ず発火
* 加えて、嫡出子 2 人以上または兄弟相続で 2 人以上の場合は `ESTATE_DISPUTED` を ESTATE_SETTLED と並んで追加発火（v0.14 では記録のみ、後続処理なし）
* importance: 故人が polity leader だった場合 `major`、家長または `wealth ≥ house.wealth * estateSettledNormalWealthRatio` の場合 `normal`、それ以外 `minor`

`deathsThisTick` と `deathRolesThisTick` は次 tick の `advanceTime` で空にリセットされる。

### 6.8 MarriageSystem（4週ごと、v0.31 で 48→4 に変更）

`marriageEnabled` が true のとき動作。未婚の男性候補を一覧し、それぞれに対して婚姻判定を行う。

- **候補条件（男性）**: 生存・未婚・対象年齢（`marriageMaleMinAge`〜`marriageMaleMaxAge`）・normal（placeholder 除外）。houseId がある場合は所属家が active であること。houseId がなくても候補に含める（v0.31）
- **候補条件（女性）**: 生存・未婚・対象年齢（`marriageFemaleMinAge`〜`marriageFemaleMaxAge`）・normal（placeholder 除外）。houseId がある場合は所属家が active であること。houseId がなくても候補に含める（v0.31）
- **禁止組み合わせ**: 同一家・近親関係（`isForbiddenMarriagePair` によるチェック）。**無家×無家は婚姻不可**（v0.31）
- **同 Polity 婚ボーナス**（v0.15）: `getPersonPrimaryPolityId` で primary Polity を取得し、男女で一致なら `samePrimaryPolityMarriageBonus`（+0.08）を加算

婚姻成立時の処理（v0.31 更新）：
- 男女とも House 所属: 女性が男性の家に `movePersonToHouse` で移動（既存ルール）
- 片方が無家: 無家側が有家側の House に `movePersonToHouse` で移動
- `spouseId` を双方向に設定（`setSpouse`）
- `house.memberIds` に移動者を追加

イベント: `MARRIAGE_FORMED`（importance: `normal`）

### 6.9 BirthSystem（4週ごと、v0.31 で 48→4 に変更）

`birthEnabled` が true のとき動作。対象年齢（`fatherMinChildAge`〜`fatherMaxChildAge`）の生存男性を走査し、出生判定を行う。**`houseId` がない人物は出生対象外**（v0.31）。家を持たない在野人物が子を残すには、まず家系を創設する必要がある。

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

### 6.10 SuccessionSystem（4週ごと）

家長（house:leader の OfficeAssignment ホルダー）が死亡または存在しない場合、生存メンバーから新家長を選出。

**後継者選出（成人候補あり）**:
- `getAdultSuccessionCandidates` で成人（age >= `adultAge`）かつ生存の家メンバーを列挙
- スコアが最高の候補を後継者に選ぶ
- スコア 2 位との差が `successionCrisisScoreGap` を超える場合、`SUCCESSION_CRISIS` イベントを発火
- 継承後に `maybeSplitHouseAfterSuccession` を呼び出す（§6.11 参照）

**後継者選出（未成年のみ）**:
- 最年長の未成年を仮の家長に任命
- 未成年当主ペナルティ（§6.12 参照）が以後 4 週ごとに適用される

**後継者なし**: `extinctHouseAfterFailedSuccession`（§6.13 参照）を呼び出す。

家長交代は `house:leader` の OfficeAssignment を新設し、旧ホルダーの assignment を inactive にすることで記録する。`HOUSE_LEADER_CHANGED` イベントを発火（v0.12）。新家長が active な代官（HoldingOfficeAssignment）を保持していた場合、自動的に vacate して placeholder に置換する（v0.24）。

**Polity ruler succession (v0.15+)**: 同 system 内で active Polity に polity:leader Office が無い場合、`getPolityHouseIds` 内から ownerHouse leader を立てる。**v0.18-pre**: `polity.kind === 'commonwealth'` の場合は skip し、rebel founder 死亡後も leader 空席のまま polity を存続させる (commonwealth は rebel founder 個人を象徴とする一代政体として扱う。後継機構は v0.18+ で別途設計)。

### 6.11 HouseSplitSystem（SuccessionSystem から呼び出し）

継承が発生した際に、分裂条件を満たせば家の分裂を実行する。実体の状態書き換えは `splitHouse` mutation（`worldStructureMutations.ts`）に集約されている（v0.13）。

**分裂条件（AND）**:
1. `houseSplitEnabled: true`
2. `getHouseControlledProvinceIds(state, houseId).length >= minProvincesForHouseSplit`（デフォルト 3、v0.16）
3. `splitCandidates.length >= 1`（後継者以外の成人候補が存在する）
4. `getHouseCohesion(house) < houseSplitCohesionThreshold`（デフォルト 60）

**分裂確率**:
```
currentCohesion = getHouseCohesion(house)   // Attitude から動的計算（§4.5 参照）
splitChance = baseHouseSplitChance
            + splitter.ambition        * houseSplitAmbitionFactor
            + splitter.legacyPrestige  * houseSplitPrestigeFactor
            + (getRoleScore(state, splitter.id, 'warCommand') / 10) * houseSplitMartialFactor   // v0.14: 旧 splitter.martial
            - currentCohesion          * houseSplitCohesionFactor
```

分裂実行時の処理：
- 新 House を生成（`id: h-{parentId}-{year}`）
- 分裂者・その配偶者・子を新 House の `memberIds` に設定
- Province の一部（`houseSplitControlMin`〜`houseSplitControlMax` の割合）を新 House に移管
- 元 House の `cadetHouseIds` に追加、新 House の `parentHouseId` を設定
- 国の `houseIds` に新 House を追加

イベント: `HOUSE_SPLIT`（importance: `major`）+ `CADET_HOUSE_FOUNDED`（importance: `major`、v0.31）+ `SUCCESSION_CRISIS`（importance: `major`、`fromSuccession` 時のみ）

**v0.31 拡張**:
- 分家に `creationKind: 'cadet_branch'` と `creationReason` (`'succession'` or `'house_split'`) を設定
- `initializeHouseShares` で新 House の OrganizationShare を即時初期化
- 移動元 House の古い Share を `removePersonSharesInHouse` で整理
- 両 House に `lastSplitWeek = absoluteWeek` を設定（cooldown 用）
- `houseSplitCooldownWeeks`（default 48）以内の再分裂を防止

### 6.11b HouseSplitEvaluationSystem（config 依存の周期、v0.31 追加）

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

候補選出は `getAdultSuccessionCandidates` → leader 除外 → `chooseSplitter`。

**succession path との違い**: evaluation path では `SUCCESSION_CRISIS` event を発火しない。`creationReason` は `'house_split'`

**cohesion（結束度）について**:
- v0.11 より `house.cohesion` フィールドは廃止。`getHouseCohesion` セレクターで動的計算（§4.5 参照）
- 結束度は家メンバーの家長への attitude から計算されるため、態度変化イベントにより自然に変動する

### 6.12 未成年当主ペナルティ（SuccessionSystem 内）

当主が未成年（age < `adultAge`）の間、4 週ごとに適用。v0.11 以降は格納フィールドの直接変更ではなく、Attitude の調整を通じて cohesion・loyaltyToPolity に間接影響を与える（実装上は `minorHeadCohesionPenaltyPerMonth` / `minorHeadLoyaltyPenaltyPerMonth` の config 値が引き続き参照される）。

### 6.13 HouseExtinctionSystem（SuccessionSystem から呼び出し）

後継者が存在しない家（生存メンバーが 0 または全員未成年かつ成人後継者なし）に対して断絶処理を行う。実体の状態書き換えは `extinctHouse` mutation（`worldStructureMutations.ts`）に集約されている（v0.13 / v0.15）。

**v0.16 House active 判定の変更**: 旧 v0.15 までの「`house.provinceIds.length === 0` で即 extinction」判定は廃止された。House active は memberIds（血統）ベースで判定され、土地を完全に失っても active=true のまま「無領家」として存続する（spec-v016-update.md §9.1）。お家再興 / 復古試行は将来の Faction 段階で動的に発生する想定で、v0.16 ではデータ上の存続のみ許す。

**v0.15 §22.3 affectedPolityIds スナップショット**:

```ts
type HouseExtinctionInput = {
  houseId: HouseId
  affectedPolityIds: PolityId[]  // 喪失前の getHousePolityIds スナップショット
}
```

呼び出し側で所領喪失前の Polity 集合を取得しておき、メンバー移住先選定のスコープとして使う。

**継承先 House の選定（v0.15 §22.3 / v0.16 / v0.36e 分割継承）**:

選定アルゴリズム `chooseReceiverHouse(state, extinctHouseId, scopePolityIds, excludeHouseIds?)`。
v0.36e 以降は **Polity 単位**で呼び出す（後述の分割継承）。`excludeHouseIds` に含まれる House は
全 stage からハード除外する。

1. `scopePolityIds` 内で最大 controlled Province 数を持つ active 通常 House (system house 除外)
2. `scopePolityIds` 内で最大 Polity Share を持つ active 通常 House
3. 旧 `seatProvinceId` に隣接する Province の effective ownerHouse
4. 世界全体で最大 controlled Province 数を持つ active 通常 House (system house 除外、v0.16)。
   count=0 の tie-break が House の挿入順に依存しないよう houseId 昇順で安定走査する（v0.36e）
5. 見つからない場合、メンバーは inactive のまま House 解散

**Polity 継承（v0.36e 分割継承、two-phase decide → apply）**:

v0.16〜v0.36 では「断絶家が ownerHouse である **すべての Polity** を単一の receiver House に継承」
させていたが、これは「領土数が最大の House が空いた Polity 群を丸ごと総取りする」rich-get-richer
ラチェットを生み、複数世代で全 Polity が単一 House に集中する退化が観測された（領土最大の House が
選ばれるため、legacyPrestige が最高でも領土を持たない House は無視される）。v0.36e で **Polity 単位の
分割継承**に変更:

- **Phase 1 (decide)**: 断絶**前**の凍結 state に対し、断絶家が ownerHouse である各 Polity の継承先を
  独立に選ぶ。各選定で `usedReceivers`（この断絶で既に他 Polity を割り当てた House 集合）をハード除外し、
  別々の House へ分配する。除外で候補が尽きた場合のみ緩和して重複継承を許容する。
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
- 断絶家を `active: false`、`memberIds: []` に設定

旧 v0.15 までの「断絶家の Province を transferProvinceToHouse で受け取り House の既存 Polity に移す」処理は v0.16 で廃止された（異 Polity 間の Province 跨ぎが不自然なため）。

**Polity の inactive 化は HouseExtinctionSystem で行わない**（v0.15）:
v0.14 では `handleRulerHouseExtinction` が ruler house extinct で Country を消滅させていたが、v0.15 ではこれを削除。Polity の active 制御は §6.22b PolityOwnerConsistencySystem に一本化する。
これにより HouseExtinction → 所領消失 → 当月内に PolityOwnerConsistency が owner 補充または `POLITY_EXTINCT` 発火、という分離した責務になる。

イベント: `HOUSE_EXTINCT`（importance: `major`）

### 6.13b HouseFoundingSystem（config 依存の周期、v0.31 追加）

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
9. `initializeHouseShares` で OrganizationShare を即時初期化
10. `HOUSE_FOUNDED` event を発火

**1 月あたり最大** `houseFoundingMaxPerMonth` 家まで創設。

イベント: `HOUSE_FOUNDED`（importance: `major`）

### 6.13d ClanFormationSystem（config 依存の周期、v0.32 追加）

年 1 回（`clanFormationIntervalWeeks`, default 48）。2 つの処理を行う。

**Part 1: 新規 Clan 成立判定**

active / normal / clanId undefined の各 House を root candidate として以下を評価:

1. **分家数条件**: active direct cadet 数 >= `clanFormationMinDirectCadetHouses`
2. **影響力条件**: formation group に ruling house が含まれる、または `isInfluentialHouse` が `clanFormationMinInfluentialHouses` 以上
3. **量的条件**: formation group の total living members / wealth / legacyPrestige のいずれかが閾値以上

3 条件すべてを満たすと Clan を成立させる。所属範囲は formation group（direct cadet のみ）ではなく、rootHouseId から下方向の全 descendant House。すでに別の clanId を持つ descendant とその下位はスキップする。

イベント: `CLAN_FOUNDED`（importance: `major`）

**Part 2: 既存 Clan の年次保守**

- member House の cadet に clanId 未設定の normal House があれば同 Clan に追加（防御的フォールバック）
- `syncClanActive`: memberHouseIds のうち active normal House が 0 になれば `clan.active = false`

House 絶滅時の即時 `syncClanActive` は `handleNormalHouseExtinction`（`worldStructureMutations.ts`）の末尾で実行される。

### 6.13c HouselessPersonGenerationSystem（4週ごと、v0.31 で改名）

旧 `UnaffiliatedPersonSystem`。無家人物を生成・維持する。config key は `unaffiliated*` から `houseless*` に改名（`houselessPersonsPerHolding` / `houselessMaleRatio` / `targetHouselessPersons` / `softMaxHouselessPersons` / `hardMaxHouselessPersons` / `houselessProtectionYears`）。

無家人物は `houseId === undefined` の normal Person として `state.persons` に直接追加される。House の `memberIds` には含まれない。

### 6.14 AppointmentSystem（12週ごと = 3ヶ月ごと、v0.23 で頻度変更）

Polity と House それぞれの役職（leader 以外の 4 種）に対して、空席を最適候補で補充する。

**対象役職**:
- Polity: administrator / treasurer / military / advisor
- House: administrator / treasurer / military / advisor
- leader は AppointmentSystem が直接補充しない（SuccessionSystem が担当）

**候補スコア（Polity 役職）**:
```ts
// v0.15 §13.4 で更新されたスコア式
score = relevantStat(role) * 1.0          // military → warCommand、他 → governance（v0.14 派生 selector）
      + (prestige / 100) * 8              // getPersonPrestige (v0.15: 10→8)
      + leaderRespect * 4                 // polity leader の attitude.respect（0..1 正規化）(v0.15: 5→4)
      + polityAffection * 3               // 候補者の対 Polity attitude.affection
      + houseSharePct * polityShareAppointmentFactor  // v0.15: 候補者の家の Polity Share 割合（既定 0.25）
      + personSharePct * houseShareAppointmentFactor  // v0.15: 候補者個人の House Share 割合（既定 0.08）
      + ownerHouseBonus                   // v0.15: 候補者の家が polity.ownerHouseId なら ownerHouseAppointmentBonus（既定 4）
      - concurrentOfficePenalty * currentOfficeCount  // 兼任ペナルティ（個人単位）
      - sameHousePolityOfficePenalty * sameHousePolityOfficeCount  // v0.15: 同 House の Polity Office 数（既定 2）
```

**v0.15 §13.2 候補者条件**: alive 成人 / active House 所属 / 同 role を未保有 / 以下のいずれか:
1. その House が対象 Polity 内に Province を所有する
2. その House が対象 Polity の `ownerHouseId` である（owner が一時的に Province を失っていても候補に残す）

**候補スコア（House 役職）**:
```ts
score = relevantStat(role) * 1.0
      + (prestige / 100) * 10
      + leaderRespect * 5                // 家長の attitude.respect
      + houseAffection * 3              // 候補者の対 House attitude.affection
      + personSharePct * 0.1            // 候補者の House Share 割合
      - concurrentOfficePenalty * currentOfficeCount
```

**任命判定**:
- 最高スコア候補が `minAppointmentScore` 未満の場合は任命しない（空席を維持）
- `getEffectiveOfficeMaxHolders(state, config, org, role)` で算出される動的上限に達していない空席を補充する（既存担当者は交代させない）
  - Polity 役職: `polityOfficeMaxByRank[rank][role]` × province 数係数で決定。`rankCap = 0` の場合はその役職を設置不可（例: rank 4 伯領は administrator のみ）
  - House 役職: leader 以外は一律 maxHolders = 1（v0.21）
- 死亡者の役職は自動的に revoke される

**v0.37 House 役職の支払能力ゲート**: House 役職（有給 = administrator/treasurer/military/advisor）は、家が定常的に得る年間収入で既存役職＋新規役職の年間給与を賄えない場合は任命しない（leader は `baseSalary=0` なので常に対象外。Polity 役職は財庫から支払われ実測上ほぼ未払いにならないため不問）。
- 投影年間収入 `getHouseProjectedAnnualIncome` = 家が定常的に得る収入の投影。定常収入は **PolitySurplusDistribution（§6.5b、share 比例）のみ**で、estate settlement や外交移転など不定期な収入は含めない。`Σ_polity（家の polity share% × getPolityDistributablePerCycle）× 12`（分配は 4 週ごと = 年 12 回）。
- 任命可否: `getHouseAnnualOfficeSalary（既存 active house 役職の baseSalary 合計）+ 新役職 baseSalary ≤ 投影年間収入` のときのみ任命。
- 動機: 収入の無い landless 小家系が役職を抱え、`OFFICE_SALARY_UNPAID` を量産する不自然さを解消（実測で家由来の未払いイベントが 100 年あたり 22〜27 万件 → 0 に）。有力 landed 大家系は投影収入が十分で全役職を維持する（landless→有給役職 0、landed→従来どおり、という二分が観測される）。
- UI: House DetailPanel に「想定年収 / 役職給与 / 役職収支」を表示（`getHouseProjectedAnnualBalance`）。
- 既存役職は本ゲートの対象外。`OfficeTermSystem`（§6.5）の任期満了 revoke を経て自然に再任命ゲートを通るため、収入を失った家の役職は数年のラグで減衰する。
- 将来: 形骸化した帝国/王国の Polity 役職を「名誉職」として残す仕組みは今後の課題。現状は単純に収入ベースの役職数とする。

**v0.23 追加**: `getAppointmentTaskModifier(state, personId, organization, role)` による Person Aim / Task 効果の補正を候補スコアに加算。obtain_office / retain_office Aim が active、または seek_office_support / display_competence の直近 ActivityLog がある候補は +appointmentTaskModifierValue（デフォルト 4）の補正を受ける。

**イベント**: `OFFICE_ASSIGNED`（importance: `normal`）

### 6.14b OfficeCompensationSystem（4週ごと、v0.23 で頻度変更 / v0.25 bailiff 給与廃止）

アクティブな OfficeAssignment に対して、`baseSalary`（§3.7 参照）に基づく給与を支払う。

- 支払元: Polity 役職 → `polity.treasury`、House 役職 → `house.wealth`
- 支払先: `person.wealth += paid`
- 資金不足時は部分支払いまたは未払い
- 未払い・部分支払い時: `office.unpaidCount` を増加し、Person の Attitude（対 Polity / 対 House の affection・respect）にペナルティを付与
  - ペナルティは `officeDignityUnpaidPenaltyReduction` × dignity 値で軽減
- `unpaidCount` が 0 の完全支払い時にはリセット

**v0.25**: bailiff（HoldingOfficeAssignment）の給与支払い処理を廃止。代官の収入は LandRevenueSystem 内の `bailiffFee`（§6.5a.2）に一本化。旧 `giveSingleHoldingBailiffSalary()` および `config.bailiffRevenueShare` も廃止。

**v0.37**: House 役職の `OFFICE_SALARY_UNPAID` は AppointmentSystem の支払能力ゲート（§6.14）で発生源を抑止する（収入で賄えない家にはそもそも有給役職を任命しない）。本 system 自体の支払いロジックは不変。

**イベント**: `OFFICE_SALARY_UNPAID`（importance: `minor`）/ `OFFICE_SALARY_PARTIALLY_PAID`（importance: `minor`）

### 6.14a2 BailiffRevenueTaskSystem（4週ごと、v0.25）

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

### 6.14e BailiffAppointmentSystem（12週ごと = 季節ごと、v0.16 / v0.20）

terminal Polity ごとに HoldingOfficeAssignment (Bailiff) を走査し、placeholder Person で空席化している **Holding** を通常人物で埋める。逆に、通常人物の Bailiff が死亡・離反などで不在化した場合は placeholder Person に戻す。

**任期判定（v0.20）**: `absoluteWeek - office.startWeek >= termYears * WEEKS_PER_YEAR`。`startYear` は廃止。

**候補者選定**:
- ownerHouse の member を優先（成人 / 他 Office を持たない者）
- なければ Polity Share holder 系の House member
- stewardship / numeracy / learning などのスコアでソート
- 適任者が居なければ placeholder のまま

**イベント**:
- `BAILIFF_APPOINTED`（importance: `minor`）: placeholder → 通常人物に交代
- `BAILIFF_VACATED`（importance: `normal`）: 通常人物が不在化
- `BAILIFF_PLACEHOLDER_INSTALLED`（importance: `minor`）: terminal Polity 変更時に placeholder を新規設置

commonwealth (`ownerHouseId === undefined`) Polity の Bailiff 候補者選定は Faction 段階まで持ち越し。

### 6.14c ShareUpdateSystem（48週ごと = 毎年）

Polity・House それぞれの Share 分布を毎年更新する。

**Polity Share 更新（House ホルダーの Share を計算）**:
```ts
// v0.15 §12.3: 計算は対象 Polity 内の local power に限定する。
// 別 Polity の所領で当該 Polity の Share が膨らむことを防ぐ。
newRawPower = polityShareBase
            + ownedProvinceCountInPolity * polityShareProvinceFactor     // v0.15: 対象 Polity 内に限定
            + localMilitaryProxy * polityShareMilitaryFactor             // v0.15: 対象 Polity 内 Province から算出
            + house.wealth * polityShareWealthFactor
            + house.legacyPrestige * politySharePrestigeFactor
            + polityOfficeCount * polityShareOfficeFactor
            + (isOwnerHouse ? polityShareOwnerHouseBonus : 0)             // v0.15: polity.ownerHouseId と一致なら
```

既存 Share との統合: `rawPower = oldPower * shareYearlyRetentionRate + newRawPower * (1 - shareYearlyRetentionRate)`

**v0.15 §12.2 削除責務**: ShareUpdateSystem は不適格 Share の削除を **行わない**。削除責任は §6.22c OrganizationConsistencySystem に一本化されている。

**Person holder の Polity Share (§17 commonwealth / 独裁者・僭主)**: Rebel Polity 生成時に `createRebelPolity` が rebel leader (Person) に rawPower 100 を初期値で設定する。本 system は House holder のみを年次再計算対象とし、Person holder の Polity Share には touch しない（rawPower は初期固定）。整合性管理は OrganizationConsistencySystem に委ねる。Person holder の rawPower を年次変動させる仕様は将来検討。

**House Share 更新（Person ホルダーの Share を計算）**:
```ts
newRawPower = houseShareBase
            + (isLeader ? houseShareLeaderBonus : 0)
            + houseOfficeCount * houseShareOfficeBonus
            + person.legacyPrestige * houseSharePrestigeFactor
            + person.wealth * houseShareWealthFactor
            + (governance + warCommand) * houseShareStatFactor
            // v0.14: 旧 (admin + martial) は getRoleScore(governance + warCommand) / 10 に置換
```

**イベント**: `SHARE_SHIFTED`（importance: `minor`）— Share 分布に有意な変化があった場合

### 6.14d PersonGrowthSystem（48週ごと = 毎年、v0.14）

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

**v0.23 追加**: `personTrainingExperience` がある場合、成長判定の `gainChance` に bonus を加算する。年次処理後、使用した ability の experience を `trainingExperienceDecayRate`（0.5）倍に減衰させる（50% 残留）。値が 0.1 未満になった場合は削除。

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
| improve_ability Task の personTrainingExperience (v0.23) | 対象 ability |

### 6.15 AmbitionSystem（4週ごと）

人物・家ごとに野心スコアを計算し、将来の陰謀・反乱の素地を作る。

### 6.16 PublicSpendingSystem（48週ごと = 毎年、v0.27 で development 直接加算を削除）

**v0.27**: development 直接加算ロジックを削除。土地開発は develop_holding Project に一本化。system 自体は残すが、v0.27 時点では no-op。

旧仕様（参考）: `publicSpendingYearlyChance`（35%）で発動。Polity treasury から terminal Province 1 つを選んで development += gain を行っていた。関連 config（`polityLandDevelopmentBaseCost` / `polityLandDevelopmentGain`）も削除。

**記念碑建設の廃止**:
v0.16 後の整理で `MONUMENT_BUILT` イベントは削除された。

### 6.17 HouseDevelopmentSystem（v0.22 で廃止）

House が直接 Holding / Province を開発する仕組みは、土地契約・代官任命・徴税・実効支配を Polity が担う v0.20 以降の土地統治モデルと整合しない。v0.22 で廃止し、土地開発は Polity の Aim / Intent (develop_holding) に一本化した。House は Polity Share・政策誘導（steer_polity_internal_development）を通じて関与する。

廃止に伴い、`houseDevelopmentEnabled` / `houseDevelopmentYearlyChance` / `houseLandDevelopmentBaseCost` / `houseLandDevelopmentGain` / `houseWealthReserve` config と `HOUSE_LAND_DEVELOPED` EventType を削除した。

### 6.18 PopDevelopmentSystem（v0.27 で無効化）

**v0.27 で無効化**。`popDevelopmentEnabled: false` に設定し、tick.ts の scheduled system 配列からも外した。将来 POP 主導 Project として再導入予定。ファイルは削除せず残す。

旧仕様（参考）: `popDevelopmentEnabled` が true のとき動作。地元共同体・都市民・在地有力者による小規模な土地改善を表す。

POP 自主開発は Polity / House 開発より明確に弱く、局所的・低効率に留める：

| 開発主体 | development gain | 財源 |
|----------|-----------------|------|
| POP | +0.25（微少） | Province に残った POP wealth |
| House | +6 | House wealth |
| Polity | +8 以上 | Polity treasury |

**発動条件**:
```ts
if (averageWealth < config.popDevelopmentWealthThreshold) continue
if (unrest > config.popDevelopmentUnrestMax) continue
if (province.development >= config.popDevelopmentMaxDevelopment) continue
```

**発動確率**:
```ts
chance = clamp(
  popDevelopmentMonthlyChance
    + (averageWealth - popDevelopmentWealthThreshold) * popDevelopmentWealthChanceFactor
    - unrest * popDevelopmentUnrestPenaltyFactor,
  0,
  popDevelopmentMaxMonthlyChance,
)
```

**効果**:
```ts
province.development += popDevelopmentGain  // clamp(-100, 100)
adjustProvincePopWealth(state, province.id, -popDevelopmentCost)
```

polityControl / houseControl には影響しない。

イベント: `POP_LAND_DEVELOPED`（importance: `minor`）
```
summary: "The people of ${province.name} improved their lands."
```

### 6.19 PlotSystem（4週ごと）

野心スコアが `plotThreshold` を超えた人物が陰謀を実行。成功率 `basePlotSuccess`。

### 6.20 WarSystem（v0.18 で廃止）

**v0.18 で外交劇に統合**: WarSystem の宣戦 AI は IntentGenerationSystem + IntentToDiplomaticPlaySystem に移行し、戦争は DiplomaticPlay の escalation → ConflictResolutionSystem で発生する。`config.warEnabled = false` で旧 WarSystem は無効化されている。WAR_DECLARED = 0 が確認済み。旧 `warSystem.ts` / `landContractPurchaseSystem.ts` は物理削除済み。

`warEnabled` が true のとき動作。Polity が他 Polity に宣戦布告し、勝敗後に LandContract を操作する。

- 宣戦条件: `effectiveMinWinChanceToDeclare`（Polity military の ambition/caution で変動、§10 参照）以上の勝率見込み、warCooldown 明け
- 軍事力: `calcPolityMilitaryPower` (§4.4) で算出。v0.16 では `institutionalPower` 下限 (`institutionalPowerFloorByRank`) を被せて Rebel Polity 即死を防止
- **本拠地保護**: 旧 `seatProvinceId` の保護ロジックは v0.16 では capital province として保持（landless 化後も capital は残る）

**v0.16 §13 / §16.1 戦争結果の LandContract 化**: 勝敗後の Province 移転は `transferProvinceByWarGoal` mutation 経由で rank 比較による case 分岐で処理する。

| case | 条件 | 動作 |
|---|---|---|
| A | 勝者 rank == 敗者 rank | 敗者が grantee の contract の granteePolityId を勝者に差し替える (`transferLandContractGrantee`) |
| B | 勝者 rank < 敗者 rank (勝者が下位) | 対象契約からチェーンを下方向に走査し、適切な位置を探す。(1) terminal に到達 → 子契約を作成、(2) 自身より下位 rank の子を発見 → 中間挿入、(3) 同 rank の子を発見 → 子の grantee を差し替え（v0.20-b2 で rank 不変条件違反を防ぐチェーン走査に改修） |
| C | 勝者 rank > 敗者 rank | terminal の差し替え不可。税率調整 (`adjustLandContractTaxRate`) で勝者の上納率を下げる…が v0.16 では no-op (将来配線、§16.1) |

annexPolity (Polity 全体消滅) は v0.16 では LandContract chain が全部 receiver に移った結果として §6.22b PolityOwnerConsistencySystem が active=false 化することで達成される。

**荒廃・POP 効果**: 旧 v0.15 と同じ係数で適用 (development 減少、unrest 上昇等)。

### 6.21 RebellionSystem（v0.16 で廃止）

旧 v0.15 までの「反乱傾向が `rebellionThreshold` を超えた House が反乱を起こす」HouseRebellionSystem は v0.16 で廃止された。Province / POP 起点の反乱に統合され、すべて §6.22 ProvinceRevoltSystem の `createRebelPolity` で処理する。

`HouseRebellionSystem` のロジック (家門の反乱傾向計算 / 戦力比較 / 成功時の独立または支配家交代) は Faction システム導入時に派閥圧力ベースで再設計される。

### 6.22 ProvinceRevoltSystem（48週ごと = 毎年）

**v0.18 で外交劇化**: 叛乱判定で即時独立を行わず、Rebel commonwealth Polity を生成し revolt_negotiation DiplomaticPlay を開始する。交渉 → 妥協 / 鎮圧 / 独立の 3 分岐で処理される。旧 PROVINCE_REVOLT_SUCCEEDED / PROVINCE_REVOLT_FAILED の即時成否判定は廃止された。

Province / POP を起点とする社会的反乱を処理する。

毎年、全 active Province に対して POP class ごとの反乱傾向を評価し、最も傾向が高い class 1 つを候補とする。スナップショットパターンで実装（連鎖防止）。

**反乱傾向**:

```ts
revoltTendency =
  pop.unrest * provinceRevoltUnrestFactor
  + (100 - polityControl) * provinceRevoltLowHouseControlFactor  // v0.16: houseControl 廃止のため polityControl で代用 (係数は流用)
  + (100 - polityControl) * provinceRevoltLowPolityControlFactor
  - polity.stability * provinceRevoltStabilitySuppressionFactor
  + [class 別補正]
```

class 別補正:

| class | 補正内容 |
|-------|----------|
| peasants | 貧困 wealth ペナルティ + 人口圧力 |
| townsmen | 低 wealth 時のみ搾取ペナルティ + 生産量補正 |
| nobles | 低忠誠度補正 + 低正統性補正 |

**発生判定**: `revoltTendency >= provinceRevoltThreshold` のとき、`clamp(tendency / chanceDivisor, 0, maxChance)` の確率で発生。

**戦力比較**:
- 反乱側: `pop.size * popRevoltPowerFactorByClass[class] * (0.5 + unrest/100)`
- 鎮圧側: Province の house/polity manpower + log1p(treasury) + log1p(houseWealth)

**成功 outcome**:

| outcome | 条件 | 効果 |
|---------|------|------|
| `concession` | 小幅成功 | 支配力低下・house wealth 低下、不満低下 |
| `lordship_change` | 中〜大成功 | 新 Person・新 House を生成し Province の領主を交代 |
| `independence` | nobles 反乱かつ両支配力が極低値かつ大差勝利 | 新 Person・新 House・新 Polity を生成し Province が独立 |

`independence` 実行時の状態書き換えは v0.16 で `createRebelPolity` mutation (`worldStructureMutations.ts`) に統合され、v0.18-pre で AnonymousHouse 方式に書き換えられた。生成内容:

1. Rebel Polity (rank = min(5, max(4, terminalRank+1)), `ownerHouseId === undefined` + `kind: 'commonwealth'`)
2. Rebel leader Person (kind='normal', age 20-50 / sex 50/50 random、`rebelLeaderAgeRange` config 経由、`houseId: ANONYMOUS_HOUSE_ID`)
3. `addPersonToAnonymousHouse` 経由で AnonymousHouse.memberIds に rebel Person を追加 (**Rebel House は生成しない**、v0.18-pre)
4. Polity:leader OfficeAssignment 任命 (rebel Person 直接、house:leader は作らない)
5. Rebel Polity の OrganizationShare を rebel leader (Person) に 100% 付与（§17 commonwealth）
6. 当該 Province の **各 Holding** の terminal LandContract granteePolityId を Rebel Polity に差し替え（v0.20-b2 で per-Holding 化。旧 Province chain terminal ではなく `byHolding` chain terminal を走査）
7. 当該 Province の Bailiff を placeholder に切り替え
8. `REVOLT_POLITY_FOUNDED` / `BAILIFF_PLACEHOLDER_INSTALLED` event を発火 (REVOLT_POLITY_FOUNDED の `houseIds: []`)

将来 「家の設立」イベント (v0.18+) によって AnonymousHouse 内の rebel founder + 一族が新規 House を立て上げ、`Polity.kind` を `'normal'` に遷移できる素地を残している。

旧 v0.13 の `foundRevoltPolity` mutation は v0.16 で `createRebelPolity` に統合され、関連ファイル (`createRevoltHouse.ts` / `createRevoltLeader.ts`) は削除された。v0.18-pre で Rebel House 生成ロジックも削除された。

### 6.22d LandContractPurchaseSystem（v0.18 で廃止）

**v0.18 で外交劇に統合**: land_claim DiplomaticPlay に統合された。売却 Intent (sell_land) と取得 Intent (acquire_land) が land_claim Play を生成する。旧 `landContractPurchaseSystem.ts` は物理削除済み。

戦争以外の平和的な LandContract 変動として、隣接する **同 rank かつ同じ直接 grantor 下** の Polity 間で Province を金銭購入する system。

**動作 (毎年 1 月)**:
1. 各 active な dynastic Polity (`ownerHouseId !== undefined`) を「買い手候補」として走査
2. `treasury > purchaseBuyerTreasuryThreshold` なら確率 `purchaseAttemptChance` で試行
3. 隣接 Province を持つ「同 rank・同 grantor・commonwealth でない・treasury 不足」の Polity を「売り手候補」とする
4. 候補から 1 つランダムに選び、terminal LandContract の granteePolityId を差し替え、treasury を移動
5. `LAND_CONTRACT_PURCHASED` event を発火

価格は `purchasePriceBase + development * purchasePriceDevelopmentFactor` (下限 `purchasePriceBase`)。支払いは Polity treasury 経由 (spec-v016-update.md §18 注記)。

commonwealth (Rebel Polity 等) は購入主体・売却主体のいずれにもならない (§11.2)。

**反乱失敗**: 反乱 POP の unrest 低下・Province 荒廃・反乱 POP wealth 低下、鎮圧側 polity.legacyPrestige +1。他 class の unrest が collateral として小幅上昇。

**イベント**:

| 状況 | イベント |
|------|---------|
| 発生 | `PROVINCE_REVOLT_STARTED` |
| concession 成功 | `PROVINCE_REVOLT_SUCCEEDED` |
| lordship_change 成功 | `LORDSHIP_USURPED` |
| independence 成功 | `REVOLT_POLITY_FOUNDED` |
| 失敗 | `PROVINCE_REVOLT_FAILED` |

**旧 ownerHouse の処置（lordship_change / independence）**: 領地がゼロになった House は即 inactive 化し、生存メンバーを rulerHouse に移動。`HOUSE_EXTINCT` イベントを発火。

### 6.22b PolityOwnerConsistencySystem（4週ごと、v0.15）

War / Rebellion / ProvinceRevolt 等の所領変動 system の直後に走り、`Polity.ownerHouseId` の整合性を補正する。

active Polity を id 昇順に走査し、以下のステップを順に行う（疑似コード, §11.3）:

```
for each polity in active polities:
  provinceIds = getPolityProvinceIds(state, polity.id)

  // Step 1: provinceIds = 0 なら Polity 自体を消滅させる (commonwealth でも適用)
  if provinceIds.length === 0:
    deactivate polity
    revokeOfficesByOrganization({ kind: 'polity', id: polity.id })
    removeSharesByOrganization({ kind: 'polity', id: polity.id })
    emit POLITY_EXTINCT
    continue

  eligibleHouseIds = getPolityHouseIds(state, polity.id)

  // Step 2: ownerHouseId 未設定なら新規補充
  if polity.ownerHouseId === undefined:
    if polity.kind === 'commonwealth': continue  // v0.18-pre: commonwealth は undefined を恒常的に許容
    newOwner = chooseOwner(eligibleHouseIds)
    polity.ownerHouseId = newOwner
    polity.capitalProvinceId = getHouseSeatProvinceInPolity(newOwner, polity.id)
    replace polity:leader Office (revoke + assign new owner-house leader)
    emit POLITY_OWNER_CHANGED

  // Step 3: ownerHouse が inactive または Polity 内に Province なしなら交代
  if ownerHouse is invalid:
    if polity.kind === 'commonwealth': continue  // v0.18-pre: defensive skip
    newOwner = chooseOwner(eligibleHouseIds)
    polity.ownerHouseId = newOwner
    polity.capitalProvinceId = getHouseSeatProvinceInPolity(newOwner, polity.id)
    replace polity:leader Office
    emit POLITY_OWNER_CHANGED
```

**chooseOwner（§10.2 選定順）**:

1. 対象 Polity 内の所有 Province 数が最大
2. 同数なら local military proxy（Polity 内 Province の development 合計を proxy として使用）が最大
3. 同値なら `house.legacyPrestige` が最大
4. 同値なら HouseId 昇順

**事後条件**:
- 全 active Polity について、`ownerHouseId` が存在し、ownerHouse は active かつ Polity 内に Province を持つ
- 全 Polity の `capitalProvinceId` はその Polity 内の Province を指す
- owner 交代と同月内に `polity:leader` Office が補充されている（IntegrityCheck §25.2 #10 を当月内成立させる）

イベント: `POLITY_OWNER_CHANGED`（importance: `major`）/ `POLITY_EXTINCT`（importance: `major`）

### 6.22c OrganizationConsistencySystem（4週ごと、v0.15）

PolityOwnerConsistencySystem の直後に走り、Polity Share / Office の保持資格を監査する。

```
for each polity in active polities:
  eligibleHouseIds = getPolityHouseIds(state, polity.id)

  // Step 1: 不適格 Share 削除
  for each share where organization is { kind: 'polity', id: polity.id }:
    if share.holder.kind === 'house':
      if share.holder.id not in eligibleHouseIds:
        removeOrganizationShare(share.id)
    else if share.holder.kind === 'person':
      // §17 commonwealth / 独裁者・僭主の Person holder Polity Share
      person = state.persons[share.holder.id]
      if person is missing or not alive or person.kind === 'placeholder':
        removeOrganizationShare(share.id)
      else:
        // v0.31: commonwealth Polity の houseless person (rebel founder) は eligible 扱い
        isCommonwealthRebelHolder = polity.kind === 'commonwealth'
        if not isCommonwealthRebelHolder:
            removeOrganizationShare(share.id)
      else:
          house = state.houses[person.houseId]
          isFactionMember = getActiveFactionMembership(state, share.holder.id) !== undefined
          if not isFactionMember:
            if house is missing or not active or house.id not in eligibleHouseIds:
              removeOrganizationShare(share.id)

  // Step 2: 不適格 Polity Office revoke
  for each active office where organization is { kind: 'polity', id: polity.id }:
    person = state.persons[office.holderPersonId]
    if not person.alive: continue  // 別系統の不整合（IntegrityCheck で検知）
    if not person.houseId:
      // v0.31: houseless holder は commonwealth rebel holder のみ eligible
      isCommonwealthRebelHolder = polity.kind === 'commonwealth'
      if not isCommonwealthRebelHolder:
        revokeOfficeAssignment(office.id)
        emit OFFICE_REVOKED
      continue
    house = state.houses[person.houseId]
    houseEligible = house and house.active and house.id in eligibleHouseIds
    // v0.21: active な派閥に所属する人物は eligible 扱い（派閥経由の任命を維持するため）
    isFactionMember = getActiveFactionMembership(state, office.holderPersonId) !== undefined
    if houseEligible or isFactionMember: continue
    revokeOfficeAssignment(office.id)
    emit OFFICE_REVOKED

  // Step 3: rank ベースの定員超過 revoke (v0.21)
  // polity の rank / province 数に対して getEffectiveOfficeMaxHolders を超える役職者を解任する。
  // 最も新しい任命（startYear が大きい）から順に解任。
  for each role in [administrator, treasurer, military, advisor]:
    effectiveMax = getEffectiveOfficeMaxHolders(state, config, polityRef, role)
    holderIds = getActiveOfficeHolders(state, polityRef, role)
    if holderIds.length <= effectiveMax: continue
    // startYear desc でソートし、超過分（最新任命から）を revoke
    excess = assignments sorted by startYear desc, take (count - effectiveMax)
    for each excess assignment:
      revokeOfficeAssignment(assignment.id)
      emit OFFICE_REVOKED
```

これにより:
- Share 削除責任は OrganizationConsistencySystem に**一本化**される（ShareUpdateSystem は削除を行わない）
- Polity Office holder は常に以下のいずれかに限定される:
  - 対象 Polity 内に Province を持つ active House の人物
  - commonwealth Polity の houseless rebel founder（v0.31: `polity.kind === 'commonwealth' && !person.houseId`）
  - active な派閥に所属する人物（派閥が解散すれば次回チェックで revoke される）
- Step 3 により、Polity の rank 降格時に定員超過の役職者が自動的に整理される
- rebel founder が死亡したら `markPersonDead → revokeOfficesByHolder` 経路で Office が revoke され、Step 1 の `!person.alive` 分岐で Share も削除される

### 6.23 AttitudeDecaySystem（4週ごと）

全 Person および全 PopGroup の `attitudes` を 4 週ごとに `attitudeMonthlyRetentionRate`（0.995）倍に減衰させる。`affection` / `respect` どちらも同率で 0 に近づく。エントリを持たない（未設定の）態度への影響なし。

### 6.23b GovernanceSystem（48週ごと = 毎年）

`getPolityAdminPower`（§4.5）で `adminPower` を再計算し、`polity.adminPower` にキャッシュとして書き込む。

```ts
adminPower = 0.30*getEffectiveOfficeStat('administrator','admin')*10
           + 0.20*getEffectiveOfficeStat('treasurer','admin')*10
           + 0.20*getPolityStability
           + 0.20*getHousePrestige(getPolityLeaderHouse)
           + 0.10*clamp(log1p(treasury)*10, 0, 100)
```

`getEffectiveOfficeStat` は役職担当者の能力・複数担当者の協調ペナルティを考慮した実効能力値を返す（v0.12）。旧 StabilitySystem は v0.11 で廃止。Stability は `getPolityStability` セレクターで毎回計算する。

### 6.24 IntegrityCheck（3モード制、v0.19 で週次化）

以下を検証し、違反があれば例外を投げる（`debug` モード時は警告のみ）。v0.16 では Stage C で全 33 項目を error throw / 型レベル保証 / コードレビューのいずれかで担保した（spec-v016-update.md §25）。

**v0.16 で削除された旧チェック**:

```
Province.polityId / Province.ownerHouseId 系               ← Province から該当フィールド削除のため
House.provinceIds と Province.ownerHouseId の双方向整合     ← House.provinceIds 削除のため
Province.houseControl が 0..100 の範囲内                    ← Province.houseControl 削除のため
House.provinceIds に重複がない                              ← 同上
ownerHouseId を持つ active Polity の owner Province 1 個保証 ← LandContract chain で表現するため
```

**v0.16 §25 IntegrityCheck 33 項目（要旨。詳細は `integritySystem.ts` 冒頭コメント参照）**:

LandContract / chain 整合性:
1. chain は root contract を 1 つだけ持つ
2. root contract の `taxRateToGrantor` は 0
3. chain の granteePolityId は active Polity
4. chain は循環しない
5. terminal contract のみ Bailiff が紐付く
6. chain 内の各段で granteePolityId は重複しない
7. landContractIndex.byProvince は chain 順 (root → terminal)
8. grantor rank < grantee rank
9. landContractIndex.byGranteePolity の整合
10. landContractIndex.byParent (parent → child) の整合
11. provinceTerminalPolityCache が getProvinceTerminalPolityId と一致

Polity / House:
12. Polity.ownerHouseId が有効な House を指す (undefined は許容、§11.2)
13. Polity.capitalProvinceId が存在する Province
14. polityIndex.byOwnerHouse の整合
15. landless Polity (terminal Province 0) は active=false
16. active Polity は active `polity:leader` Office を持つ (placeholder leader を許容)
17. active 通常 House は active `house:leader` Office を持つ

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

Person / House の不変条件（v0.15 以前から継続）:
26. 死亡人物が役職を持たない
27. Person.sex が `'male' | 'female'`
28. 生存 Person の spouseId が双方向かつ有効、死亡者を指さない
29. 親子関係の双方向整合 (fatherId / motherId / childIds)
30. House の cadet 関係の双方向整合 (parentHouseId / cadetHouseIds)
31. House.memberIds に重複がない
32. Province.development / polityControl / PopGroup.size/wealth/unrest が範囲内
33. ability ≤ aptitude かつ両者が `[0, ABILITY_HARD_CAP=120]` の範囲内、死亡者の wealth が 0

PopGroup / Polity 数値範囲 (v0.24 更新):
- Polity.legacyPrestige / House.legacyPrestige が 0..100 (型レベル + 範囲チェック)
- PopGroup.holdingId が有効な Holding を指す
- PopGroup.occupation / class が有効な値
- 同一 merge key (holdingId + class + occupation) の POP が複数存在しない
- popIndex.byHolding の整合性（POP の holdingId と index が一致）
- OrganizationRef.kind は `'polity' | 'house'` のみ (型レベル)
- AttitudeTarget / attitude key に `country:` が残っていない (型レベル)

**v0.26 追加チェック項目**:

Project:
- 全 Project の id が key と一致
- terminal Project が state に残っていない
- creator / supervisor Person が存在する
- active Project の supervisor は alive
- origin.kind === 'aim' の場合、Aim が存在する
- projectIndex の 6 方向整合（byOwner / byAim / byParentProject / byCreatorPerson / bySupervisorPerson / byRelatedEntity）

Task（v0.26.1 追加）:
- active Task の difficulty が 0〜100 の範囲内
- active Task の relevantAbility が有効な AbilityKey

Intent 廃止確認（v0.26）:
- ActorIntent チェックを全削除
- TaskTargetRef { kind: 'intent' } の Task が存在しない

**v0.30 追加チェック項目**:

DiplomaticOffer:
- terminal play の offer が cleanup 後に残っていない（残留 offer 検査）
- active/escalated play の currentOffer がある場合、issue-demand 整合性を検証:
  - land_claim: offer に `change_contract_tax_rate` が含まれない、`transfer_land_contract.holdingId === issue.holdingId`
  - contract_tax_revision: offer に `transfer_land_contract` が含まれない、`change_contract_tax_rate.landContractId === issue.landContractId`

DiplomaticPlay (v0.30 追加):
- land_claim / contract_tax_revision の active play は issue を持つ
- issue.kind と play.kind が一致する
- currentOfferId がある場合、対応する DiplomaticOffer が存在し offer.playId === play.id
- offerHistoryIds の全 offer が存在し全 offer.playId === play.id
- 非 revolt play に primaryDemand が存在しない

**v0.18 追加チェック項目（v0.26 / v0.30 更新）**:

DiplomaticPlay:
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

**v0.25 追加チェック項目**:

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

**v0.27 追加チェック項目**:

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

Holding.development 削除確認:
- 旧 `Holding.development` 範囲チェック (-100..100) を削除

Selector range（debug/integrity-check モード）:
- `localExtractionRate` が `[minLocalExtractionRate, maxLocalExtractionRate]`
- `collectionEfficiency` が `[minBailiffCollectionEfficiency, 1.0]`
- `bailiffFeeRate` が `[0, maxBailiffFeeRate]`
- `totalBurdenRate` が `[0, maxLocalExtractionRate]`

**v0.33 追加チェック項目**:

Province（§13.1）:
- terrain が有効な ProvinceTerrain
- features が配列で、各値が有効な ProvinceFeature、重複なし
- `habitability` は型から削除済み（コンパイル時担保、runtime チェック不要）

HoldingImprovement（§13.2、max-level access 反転）:
- valid kind は `VALID_HOLDING_IMPROVEMENT_KINDS = new Set(Object.keys(IMPROVEMENT_DEFINITIONS))` で判定（二重管理解消）
- max-level access を `holdingImprovementMaxLevelByKind[kind][holdingKind] ?? 0` に反転。`0`（未定義含む）= 建設不可なので `level > maxLevel` で違反（improvement entity / develop_holding project の 2 箇所）
- 削除済み kind（agricultural_infrastructure / urban_infrastructure）は型から消滅
- canBuild の terrain / feature ゲートは terrain 不変（§15 スコープ外）＋ improvement 生成が常に canBuild 経由のため構造的に保証（専用 runtime ループは設けない）

Config / Definition（§13.3、const を回すのみ）:
- `IMPROVEMENT_DEFINITIONS` と config の各数値 Record が全 HoldingImprovementKind を持つ（コンパイル時保証の二重の保険）
- `allowedHoldingKinds` に含まれる holdingKind は maxLevel >= 1、含まれない holdingKind は maxLevel が undefined または 0、負値は不正
- `capacityRole === 'capacity'` の kind は targetOccupations の `occupationCapacityPerLevel` が正値で存在
- terrain / feature multiplier の invalid キーはコンパイル時担保（runtime チェック省略）

Capacity（§13.4）:
- 全 holding × occupation で `getHoldingOccupationCapacity` が NaN / Infinity / 負を返さない
- `occupation === 'none'` の capacity は 0

**v0.34 追加チェック項目（War。`integritySystem.ts` §14 セクションに実装）**:

War 基本:
- `war.id` が record key と一致・重複なし、`status` が有効な WarStatus、`startedWeek` が finite
- `endedWeek` がある場合 `endedWeek >= startedWeek`
- `warScore` が finite かつ `-100..100`、`targetWarScore` が `0 < x <= 100`

active / terminal 整合:
- `status === 'active'` → `endedWeek` は undefined
- `status !== 'active'` → `endedWeek` は defined

participant:
- `attacker.key === 'attacker'` / `defender.key === 'defender'`、各 side `participants.length === 1`（v0.34）、primary participant は各 side 1 人
- **active War のみ** participant actor が active であること（`isActiveActor`）を要求。terminal War（cancelled / attacker_won / defender_won / white_peace）は retention 中の inactive 化を許容。この検査が成立するのは `cancelOrphanedWarsSystem`（§6.27d）が participant 消滅 active War を integrity より前に cancelled 化するため

WarGoal（**参照存在は active War のみ要求。participant 検査と対称**）:
- transfer_land_contract: holding / fromPolityId / toPolityId が存在、`fromPolityId !== toPolityId`、`requiredWarScore > 0`
- change_contract_tax_rate: holding / landContract が存在、`landContract.holdingId === goal.holdingId`、`newTaxRateToGrantor` が `0..1`、`requiredWarScore > 0`
- **存在検査（holding / polity / landContract）は `status === 'active'` の War のみに適用する。** terminal War（attacker_won / defender_won / white_peace / cancelled）の WarGoal は和平適用済みの**凍結履歴データ**であり、`terminalWarRetentionWeeks` の retention 中に別システム（税率改定外交の contract 排除・併合など）が参照先を消しても違反としない（cleanup までの dangling を許容）。active War で参照先が stale になったケースは PeaceSettlementSystem（§6.27c）が `white_peace` で安全終結させるため、active で残る dangling は無い。
- range / value 検査（`requiredWarScore > 0`、`fromPolityId !== toPolityId`、税率 `0..1`）は凍結値の不変条件なので status に関わらず常に検査する。

originDiplomaticPlayId は weak ref のため存在検査しない（cleanup 済みを許容。§3.9a）。

warIndex（双方向。Faction index パターン踏襲）:
- `byParticipant[key]` の各 warId が存在し、その War に key 一致の participant がいる（forward）
- active War の各 participant key が `byParticipant` に warId を持つ（reverse）
- `byOriginDiplomaticPlay[playId]` の指す War が存在し `originDiplomaticPlayId` が一致（forward）

### 6.25 IntentGenerationSystem（v0.26 で廃止）

**v0.26 で廃止。** sell_land の生成ロジックは SellLandProjectGenerationSystem (§6.25b) に移植。

### 6.25a ProjectPreparationSystem（4週ごと、v0.26 / v0.27 stage 対応）

active Aim を走査し、必要に応じて `prepare_project` Task を生成する。走査対象は `aim.origin === 'goal_driven'` かつ `aim.owner.kind !== 'person'`（Polity / House Aim のみ）。

**抑制条件**: `projectIndex.byAim[aim.id]` に active Project が存在する / `aim.activeTaskId` が設定中 / `aim.activeDiplomaticPlayId` が設定中 / `nextProjectAllowedWeek` 未到達。

AimKind → ProjectKind マッピング:
- Polity: `consolidate_province_holdings` / `seize_weak_remote_holdings` → `acquire_land`、`develop_owned_holding` → `develop_holding`、`improve_owned_contract_terms` → `improve_contract_terms`、`demand_tax_increase_from_vassal` → `demand_tax_increase`
- House: `increase_polity_share` → `expand_polity_share`、`steer_polity_*` → `promote_policy_shift`、`patronize_artist` / `commission_chronicle` → 同名

`selectProjectCreator` で起案者を選定（候補なしなら待機）。prepare_project Task の assignee は creator。

**v0.27 develop_holding stage 対応**: develop_holding Project 作成時に `currentStageKey = 'find_supervisor'`、`supervisorPersonId = creatorPersonId`（暫定）を設定し、作成直後に find_supervisor → secure_budget の即時解決を試みる。成功すれば `currentStageKey = 'execute_project'` で次の tick へ。同一 Holding に active develop_holding Project が既にある場合は作成しない。

**find_supervisor 即時解決**: 対象 Holding の active bailiff を確認 → いれば採用、いなければ4段階カスケード（creator 派閥 → owner house → Share 保有家 → 派閥構成員）で候補を探し任命。成功時に `termProtectedUntilWeek` を設定。

**secure_budget 即時解決**: Project owner の treasury/wealth から `budget.required` を確保。`budget.required = baseCost × levelCostMultiplier × projectBudgetMarginMultiplier`。資金不足時は secure_budget stage に留まる。

### 6.25b SellLandProjectGenerationSystem（48週ごと、v0.26）

旧 IntentGenerationSystem の sell_land ロジックを移植。Polity の財政難から直接 sell_land Project を生成する（prepare_project Task を経由しない）。`origin: { kind: 'system', reasonKey: 'fiscal_pressure' }`。

### 6.25b2 ProjectStageSystem（毎週、v0.29 / v0.30 更新）

active Project の immediate stage を即時解決する。毎 tick 実行（intervalWeeks: 1）。

**immediate stage handler**:
- `find_supervisor` (develop_holding): Bailiff を supervisor に採用。4段階カスケードで候補探索
- `secure_budget` (develop_holding): owner treasury から budget 確保
- `open_diplomatic_play` (acquire_land / sell_land / improve_contract_terms / demand_tax_increase): DiplomaticPlay を作成し、Pressure を生成。preparation / leverage / commitment を DiplomaticPlay に転写。重複チェックあり（duplicate → Project failed）。**v0.30**: play 作成と同時に initiator の初期 DiplomaticOffer を生成
- `choose_stance` (respond_to_pressure): 軍事力比較で stance 決定（target < source×0.5 → concede、target ≥ source×1.2 → resist、else → negotiate）
- `propose_initial_offer` (respond_to_pressure, v0.30): target 側が stance に基づく counter-offer を生成。concede → initiator の offer demands をコピー、negotiate → 中間案（land_claim: pay_wealth ×1.3、contract_tax_revision: halfway rate）、resist → status_quo。counter-offer 作成時に progress += counterOfferProgressDelta

**runtime fallback**: invalid な currentStageKey を持つ active Project に initial stage を補正する（防御的補正）。

### 6.25c ProjectTaskGenerationSystem（毎週、v0.26 / v0.29 stage 対応）

active Project の currentStageKey に応じて Task を生成する。immediate stage はスキップ。

**(kind, stageKey) → TaskKind マッピング**:
- final stage → `advance_project` (develop_holding, expand_polity_share, etc.)
- preparatory stage → 専用 TaskKind (prepare_claim → gather_claim_evidence, prepare_offer / prepare_argument / prepare_response → prepare_argument)
- negotiate stage → `selectDiplomaticTaskKind()` で DiplomaticPlay の状態に基づき決定。respond_to_pressure の場合は stance に応じた優先度調整

**negotiate stage の共通フロー** (§12.5):
1. project.diplomaticPlayId から DiplomaticPlay を取得（terminal なら Project cancelled）
2. project.owner と play.initiator/target を比較して side 判定
3. activeTaskIds の上限チェック
4. selectDiplomaticTaskKind で TaskKind 決定（stance 反映）
5. Task を生成（targetRef = diplomatic_play、assignee = delegate）
6. play の activeTaskIds に追加

### 6.25d ProjectMaintenanceSystem（4週ごと、v0.26 / v0.27 stage 対応）

active Project の状態更新。owner inactive → cancelled、origin Aim が non-active → cancelled、supervisor 死亡 → 再選定（失敗なら failed）、deadline 超過 → failed、progress >= targetProgress → completed。

**v0.27 develop_holding 追加処理**:
- find_supervisor / secure_budget stage に留まっている Project に対して即時解決を再試行
- deadline は execute_project stage のみに適用（準備段階では treasury 回復・人材確保を待機可能）。**v0.28**: deadline を `projectDeadlineWeeksDevelopment × (targetProgress / projectDefaultTargetProgress)` で算出。Level 2 (×2) / Level 3 (×3) の大規模工事に比例した期間を確保
- budget.remaining が消費額未満の場合は Project を failed にする（追加予算は future）

### 6.25e ProjectOutcomeSystem（4週ごと、v0.26 / v0.29 更新）

terminal Project の効果解決・ログ出力・cleanup を担当。

- 非外交系 Project: treasury/wealth/prestige 等の直接効果を適用し、Aim progress を加算
- 外交系 Project (v0.29): DiplomaticPlay 生成は ProjectStageSystem の open_diplomatic_play handler に移管。ProjectOutcomeSystem は外交系 completed 時に追加効果を適用しない（交渉への影響は各 Task outcome で DiplomaticPlay に反映済み）
- respond_to_pressure completed: Pressure.status を 'responded' に遷移
- Project を state.projects / projectIndex から削除

**v0.27 develop_holding completed 時の追加処理**:
1. HoldingImprovement を作成（新規）または level up（既存）
2. `budget.remaining` → `supervisor.wealth`（成功報酬・節約分の取り分）
3. `project_completed` PersonActivityLog を supervisor に追加（params に improvementKind / targetLevel / holdingId）
4. creator → supervisor / owner leader → supervisor の respect を小幅上昇（`projectCompletedRespectGain`）

**v0.27 develop_holding failed 時の追加処理**:
1. `budget.remaining` → owner に返金
2. `project_failed` PersonActivityLog を supervisor に追加

### 6.26 IntentToDiplomaticPlaySystem（v0.26 で廃止）

**v0.26 で廃止。** v0.29 では DiplomaticPlay の生成は ProjectStageSystem の open_diplomatic_play handler (§6.25b2) が担当。

### 6.27 DiplomaticPlaySystem（4週ごと、v0.18 / v0.23 / v0.29 / v0.30 更新）

active な DiplomaticPlay を進行させる。

**v0.23**: structuralProgress を `structuralProgressFactor`（0.33）で弱化。delegate 選定・交渉パラメータ更新を追加。
**v0.29**: Task 生成責務を ProjectTaskGenerationSystem に移管。DiplomaticPlaySystem は原則として Task を生成しない（delegate 生存確認・再任、progress/tension 管理、settlement/escalation/failed/cancelled 判定を担当）。revolt_negotiation は Project を持たないため、Task なしで deadline まで進行し多くの場合 escalation → conflict に至る。
**v0.30**: offer-driven ハイブリッドモデルに移行。settlement は accepted offer によってのみ成立する。progress は settlement 判定に使わず UI 表示値として維持。旧 `progress > tension → settle` 分岐を廃止。

**v0.30 メインループ（land_claim / contract_tax_revision）**:

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
  5. deadline check (v0.30 分岐):
     - 未評価 pending offer あり → 強制 evaluateOffer → accepted なら settled / rejected なら escalated
     - それ以外 → escalated
```

`revolt_negotiation` は v0.30 の offer-driven 化対象外。既存ロジックを維持する。

**evaluator の決定**: `currentOffer.proposedBy` が initiator なら evaluator は target、逆も同様。

**applySettledOffer**: accepted offer の demands を `applyDemand(ctx, play, demand, allDemands)` で順に適用する。`allDemands` 引数により `transfer_land_contract` の reason を導出（`pay_wealth` あり → 'purchase' / なし → 'cession'）。

**evaluateOffer**: PlayKind 別に offer.demands からパラメータを抽出し score を計算。score >= 0 → accepted、score < 0 → rejected。評価時点の preparation / leverage / commitment が score に反映される。

Play kind 別の処理:
- `land_claim`: demands から `transfer_land_contract` / `pay_wealth` / `status_quo` を抽出し evaluateLandClaimOffer で score 計算。settlement 時は `applySettledOffer` で demands を適用。rank ベースの契約選択 (3-a/3-b/3-c) と操作 (5-a/5-b/5-c) は維持。
- `contract_tax_revision`: demands から `change_contract_tax_rate` / `pay_wealth` / `status_quo` を抽出し evaluateContractTaxRevisionOffer で score 計算。`taxRevisionInitialDemandDelta` (0.10) で旧 `taxRevisionTaxChangeAmount` (0.05) を置換。下限 5% / 上限 80% 超で契約破棄は維持。Play 決着時（成否問わず）に `termsProtectedUntilWeek` を設定。**v0.30**: `applyChangeContractTaxRate` で `newRate <= taxRevisionMinRate` または `newRate >= taxRevisionMaxRate` の場合、率変更の代わりに `eliminateContractFromChain` で契約取消しを実行する（settlement / conflict 両経路共通）。status_quo 和平時は CONTRACT_TAX_REVISED を emit しない。
- `revolt_negotiation`: 叛乱交渉。v0.30 では既存ロジック維持（妥協 / 鎮圧 / 独立の 3 分岐）。

**v0.30 契約取消し aim**: `eliminate_overlord_contract`（`taxRateToGrantor <= taxRevisionMinRateForReduction` で発火）/ `eliminate_vassal_contract`（`taxRateToGrantor >= taxRevisionMaxRateForIncrease` で発火）。既存の `improve_contract_terms` / `demand_tax_increase` project に mapping し、desiredRate が min/max 境界にクランプされる。escalation → conflict で勝利した場合に CONTRACT_ELIMINATED が発生する。両 Goal（external_expansion / internal_development）から候補に入る。

### 6.28 ConflictResolutionSystem（4週ごと、v0.18 / v0.30 / v0.34 更新）

**v0.34: revolt_negotiation 専用に kind-gate**。land_claim / contract_tax_revision の即時解決は WarCreationSystem（§6.27a）以降の War flow へ完全移行した。本 system は冒頭で `play.kind !== 'revolt_negotiation'` を early-continue し、revolt の即時解決ロジックのみを残す。完全削除はせず、関数名も `runConflictResolutionSystem` のまま（別名化していない）。二重処理防止は順序依存ではなく kind-gate で保証する（WarCreation = land_claim / contract_tax_revision のみ、ConflictResolution = revolt_negotiation のみ）。

status='escalated' な DiplomaticPlay を武力衝突として解決する。

軍事力比較 → winChance → RNG 判定。
- initiator 勝利: demand を適用 (土地移転 / 税率変更 / 独立)
- defender 勝利: status_quo (revolt の場合は鎮圧)

**v0.30**: contract_tax_revision の攻撃勝利時、`desiredTaxRateToGrantor` が `taxRevisionMinRate` 以下または `taxRevisionMaxRate` 以上の場合、通常の税率変更ではなく `eliminateContractFromChain` で契約取消しを実行する。CONTRACT_ELIMINATED イベントを emit。root contract は elimination 対象外。

revolt_negotiation の決裂時は通常の actor military power ではなく、ProvinceRevoltSystem の既存式 (rebelPower / suppressionPower) を利用する。

WAR_WON / WAR_LOST event を発火。敗者に戦争被害 (treasury / ~~development~~ / unrest) を適用。**v0.27**: development 低下効果は無効化（`adjustProvinceDevelopment` が no-op）。将来 devastation/condition で再接続。

### 6.27a WarCreationSystem（4週ごと、v0.34）

旧 ConflictResolutionSystem の位置で、`status === 'escalated'` の DiplomaticPlay を即時解決せず War entity に変換する。詳細は `docs/drafts/spec-v034-update.md` §6 参照。

**対象（すべて満たす play のみ War 化）**:
- `play.kind === 'land_claim'` または `'contract_tax_revision'`（kind-gate。revolt_negotiation は skip → ConflictResolutionSystem へ）
- `initiator.kind === 'polity'` かつ `target.kind === 'polity'`（v0.34 は polity 同士のみ。House を含むものは War 化しない）

**変換**: initiator → attacker primary participant、target → defender primary participant（各 side 1 件・primary=true）。WarGoal は `play.issue` のみから 1 件構築する（offer / currentOfferId は見ない）。
- transfer_land_contract: `holdingId = issue.holdingId`、`toPolityId = initiator.id`、`fromPolityId` = 対象 holding の land contract chain 上の現 terminal grantee（原則 target.id）
- change_contract_tax_rate: `newTaxRateToGrantor = issue.desiredTaxRateToGrantor`、`landContractId` / `holdingId` は issue 由来
- `requiredWarScore` は kind 別 config（`defaultTransferLandWarScore` / `defaultChangeContractTaxWarScore`）から設定し、`targetWarScore = max(warGoals.requiredWarScore)`

**War 化しない（cancelled に倒す）条件**: initiator / target が missing / inactive、対象 holding / contract が無い、WarGoal へ変換不能、同一 `originDiplomaticPlayId` から作成済み、**同一 issue（holdingId / landContractId）を対象とする active War が既存**（重複抑止）。escalated のまま残すと cleanupTerminalDiplomacy が terminal しか消さず無限蓄積するため、War 化できなかった escalated play は cancelled に倒す。

**War 作成後**: 元 play を `resolved_by_conflict`（terminal）にする。**`DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT` event は発行しない**（即時解決を含意するため）。戦争開始 event は `WAR_DECLARED`（major）のみ。

### 6.27b WarManeuverSystem（毎週、v0.35。旧 WarProgressSystem を置換）

active War ごとに「誰が指揮し・どの戦場で・戦うか回避するか」を毎週解決し、battle 結果で warScore を更新する。終結判定はしない（PeaceSettlementSystem の責務）。v0.34 の決定的 drift と異なり**乱数を使う**。selector は `warManeuverSelectors.ts`、battle/回避の数式は `warManeuverSystem.ts` のローカル関数。

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
   - **両者交戦 / 回避失敗** → `simulateBattle`（v0.37 内部 tick）で result を出し warScore 更新、`BATTLE_OCCURRED`(normal)。回避失敗側は `avoidanceCount +1`。

**battle 解決（v0.37: `simulateBattle` 内部 tick simulation）**:

v0.37 で旧 `resolveBattle`（power 比 1 回判定）を撤去し、純粋 helper `simulateBattle`（`src/sim/helpers/simulateBattle.ts`、WorldState 非依存）に置換した。WarManeuver は動員 active Regiment の snapshot（effectivePower は `getRegimentEffectivePower` で**戦闘前 1 回 frozen**）と指揮官 pool・総大将 warCommand・地形 frontage を入力し、helper が deployment → 内部 tick loop → result / 損耗 / summary を返す。

- **deployment**: candidate = `strength > minFightingStrengthThreshold && org > retreatOrganizationThreshold`。infantry を effectivePower 降順で frontline（地形 `battlefieldFrontageByKind` 幅）、残り frontage を cavalry で埋め、余りは reserve。draw 無し。
- **内部 tick loop（最大 `battleMaxTicks`）**: 各 tick で frontline matchup ごとに**双方向 organization damage**を与える（`battleBaseOrganizationDamage × pairPowerFactor(frozen 比 clamp) × terrain × flank × randomFactor`、damage 方向ごとに 1 draw）。org に比例した morale damage（`battleMoraleDamageRatio`）。org が morale 感応の effRoute（`routeOrganizationThreshold + max(0, baselineMorale−morale) × moraleRouteThresholdFactor`）以下で **rout**（flag + 追加 morale damage）、retreat 閾値以下は frontline 離脱。欠員は reserve から補充。
- **result 決定**: 片側の fighting 連隊が尽きれば相手勝利。相討ちは残存 org 合計 tiebreak。**maxTicks 到達（双方残存）は残存 org 合計の相対差が `battleMaxTicksDecisiveMarginRatio`(=0.1) 超で優勢側勝利、以下なら inconclusive**（通常規模は 1 戦で全滅させられず常に inconclusive になるのを防ぐ）。
- **strength damage**: loop 後に累積 org damage × role（winner/loser/routed）× outcomeQuality × powerDisadvantage で 1 回算出（v0.37 損耗方針: strength は大きく削れない＝destroyed は v0.37 core では希少）。
- **指揮官効果（C1）**: helper は deployment 後に commander pool（fieldCommandScore 降順、cavalry は breakthroughScore 優先、center-out infantry）を割当て `BattleCommanderAssignment[]` を出力。割当連隊は与 org damage `×(1+q)` / 被 org damage `×(1−q)` / rout 耐性（`q = clamp((fieldCommandScore−50)/50, −1, 1) × commanderAssignedRegimentEffectMax`、隣接は `× commanderAdjacentRegimentEffectRatio`）。
- **総大将効果（C1）**: side-level で被 org damage 軽減（≤`captainGeneralBattleOrganizationDamageEffectMax`=10%）と rout 耐性（≤`captainGeneralRoutResistanceEffectMax`=10%）。benefit 方向のみ（warCommand<50 でも penalty にしない）。
- 指揮官割当・効果・CG は **draw を消費しない**（modifier は draw 後に乗算）ので RNG 順序は不変。

**warScoreDelta（C1。result から符号 + bounded magnitude）**: 旧 advantage×scale を撤去。`computeWarScoreDelta` が internal sim の `result` から符号を決め（attacker_victory=+ / defender_victory=− / inconclusive=0）、magnitude を `base(outcomeQuality: rout は `battleRoutVictoryScoreBase`、orderly は `battleOrderlyVictoryScoreBase`) × decisiveness(敗者 routed share + 早期決着) × preBattleModifier(勝者の preBattle edge のみ、控えめ) × 勝者側 captainGeneralEfficiency` で組み、`clamp(0, maxWarScoreDeltaPerBattle)`。`warScoreDelta = sign × magnitude`。post-battle power 比は使わない（rout / org collapse で 0/1 に寄り delta が暴走するため）。符号は result 由来・magnitude≥0 なので **常に result と整合**。Battle entity には **rawDelta** を保存（warScore saturation で applied delta が 0 化しても符号が崩れないように）、`warScoreAfter = clamp(before + rawDelta, −100, 100)`。

**v0.34 からの主な変更**:
- 旧 per-tick drift 5 config（`warScoreProgressFactor` / `maxWarScoreDeltaPerTick` / `warMinimumEffectivePower` / `warScoreCollapseDelta` / `warScoreEventThreshold`）と `WAR_SCORE_CHANGED` を**撤廃**。warScore 変化は `BATTLE_OCCURRED` の `warScoreDelta` / `warScoreAfter` で表現する。
- v0.34 で「未使用」とした指揮官補正を `commanderModifier` / `captainGeneralEfficiency` として再接続（`getRoleScore(person, 'warCommand')`）。実体は旧 future-plan の `calcGeneralWarPowerModifier` ではなくこの 2 関数。
- 総大将 / 指揮官候補 / avoidanceCount は **soft reference**。lazy 選出で不在を許容し、IntegrityCheck では検査しない（person 消滅で War を壊さないため。house actor war では総大将管理を行わない）。

**cadence（毎週 maneuver × 4週 settlement）**: WarManeuver は毎週・PeaceSettlement は 4 週ごと。warScore が ±targetWarScore に到達しても settlement が走るまで最大 3 週ある。その間 step 3 が warScore を凍結し、到達済み War が余分な battle で行き過ぎるのを防ぐ。

**バランス（v0.35 → v0.37）**: v0.35 では決着戦闘数が `targetWarScore / warBattleScoreScale` 比に支配され、中央値 4 戦になるよう調整した。**v0.37 では warScoreDelta が `warBattleScoreScale` でなく上記 magnitude 式（outcomeQuality base × decisiveness × preBattle × cgEff、clamp `maxWarScoreDeltaPerBattle`=12）で決まる**ため、決着戦闘数は base/target 比に依存する。v0.37 観察（forced-war harness）では戦闘は残存 org 合計で決まり**数的優位が支配的**、決着まで中央値 ~7 戦、destroyed は実質発生せず（strength 損耗は小）、rout は実戦で稀。v0.37 戦闘系のバランス（avgStrength・CG fairness・median 等）は戦場/指揮官/消耗/兵站がひと通り入った後にまとめて調整する（現状は機能の bounded 動作を優先し config 非調整）。

**Regiment 接続（損耗ループ、v0.36 → v0.37）**: battle の入力は永続 Regiment（§3.9b）。WarManeuverSystem は warScore 凍結判定（step 3）の後・総大将 refresh の前に **per-war mobilize prologue** を挟む（`mobilizeRegimentsForWar`。各 side の polity participant が所有する active かつ未動員 Regiment を当該 War/side へ動員する。決定的・乱数非消費・冪等）。battle が成立したら（mutual_engagement / 回避失敗）`simulateBattle` を実行し損耗を適用する:

- **v0.37: 損耗は per-regiment**（v0.36 の「side 全連隊に同量」を撤去）。`simulateBattle` が連隊ごとに organization / morale / strength の after 値を返し、`updateRegimentMut` で反映する。organization は内部 tick で主に削れ（§6.27b battle 解決）、morale も削れる。strength は v0.37 損耗方針で大きくは削れない。
- clamp 後 `strength <= regimentDestroyedStrengthThreshold`（既定 0）になった Regiment は `destroyed` 化（byWar から除去・status 遷移。byOwner には残す。§3.9b case(c)）。v0.37 core では deployment 閾値（strength>10）により全滅前に配置外となり **destroyed は実質発生しない**。
- 1 戦闘につき `Battle` entity（§3.9c）を 1 件記録する（`createBattle`）。v0.37 summary（outcomeQuality / ticksElapsed / frontage / *InitialFrontlineIds / *RoutedRegimentIds / breakthroughSide / *CommanderAssignments / regimentResults の morale 込み）を保存する。`BATTLE_OCCURRED` event には battleId・連隊数に加え v0.37 summary（outcomeQuality / ticksElapsed / frontline・routed counts 等）を additive に載せる（§8 event 一覧、C2）。
- strength の回復は RegimentReinforcementSystem（§6.27g 月次）、organization / morale の回復は RegimentRecoverySystem（§6.27e、v0.37 で baseline-aware 化）、destroyed の reform も §6.27g。
- 総大将 / 指揮官は **warScore 経路**（勝者側 `captainGeneralEfficiency`）と **battle 内経路**（C1: 指揮官 org/rout 補正 + 総大将 side-level 補正）の両方に効く。`commanderModifier`（power 乗算）は v0.37 で撤去し、battle 内 org/rout 補正に置換した。

### 6.27c PeaceSettlementSystem（4週ごと、v0.34）

active War の warScore が閾値に達したら終結させ、WarGoal を state に反映する。冒頭に WarManeuver と同じ **dead-participant guard**。

- `warScore >= targetWarScore` → `attacker_won`。WarGoal を実行（attacker 側の目標として扱う）。
- `warScore <= -targetWarScore` → `defender_won`。WarGoal は実行せず status quo（v0.34 では defender counter-goal なし）。
- `absoluteWeek - startedWeek >= maxWarDurationWeeks` かつ未決着 → `white_peace`（timeout 終結）。拮抗 War の無限累積を防ぐ終結保証で、値はバランス項目だが「上限を設けること自体」は v0.34 の必須仕様。
- WarGoal 適用が stale（対象 holding / contract / fromPolity が現状と不一致で底層 mutation が失敗）な場合は `white_peace` で安全終結し、simulation を落とさず IntegrityCheck 違反にもしない。v0.35: warScore が target に到達していても WarGoal が適用不能なら**能動的に white_peace 化**する（毎週 maneuver で warScore が target に達したまま放置されると、WarGoal が指す landContract を他システムが先に消した時に dangling 参照で crash しうるため。Phase B の年117 crash 修正）。

**底層 mutation 呼び出し**（シグネチャが異なる）:
- transfer: `applyLandContractTransferGoal(ctx, {...reason:'war'})` → `CtxResult<void>` を unwrap。`err` 時は white_peace 安全終結。
- tax: `adjustLandContractTaxRate(state, contractId, newRate)` / `eliminateContractFromChain(state, contractId, inheritedTaxRate?)` → いずれも `WorldState` を返す（ctx は取らない）。elimination 判定条件は既存 `applyChangeContractTaxRate` / 旧 ConflictResolutionSystem を踏襲。

**event 責務（経路別）**:
- transfer: `applyLandContractTransferGoal` が `LAND_CONTRACT_*`（CONQUERED 等）を内部発行するため、PeaceSettlement 側で重複発行しない。
- tax: 底層 mutation が event を出さないため、PeaceSettlement 側で `PEACE_SETTLEMENT_APPLIED`（major）を発行する。
- 勝敗時に `WAR_WON` / `WAR_LOST`（major）、white_peace / cancelled 等の終結時に `WAR_ENDED`（major）。

v0.34 では旧 ConflictResolutionSystem の `applyConflictDamage`（treasury / unrest / 荒廃 / 厭戦）は呼ばない（配管安定を優先。戦争被害は将来再設計）。

### 6.27d cancelOrphanedWarsSystem（毎週、v0.34）

active War の primary participant（attacker / defender いずれか）が missing / inactive になった場合、`cancelled` 終結（`endedWeek` 設定 + `WAR_ENDED` 発行、WarGoal 不実行）にする。戦争は数年続くため、その間に participant polity / house が別要因（属州独立・併合・revolt など）で消滅しうる。IntegrityCheck（§6.24 v0.34）が active War の participant を active 必須とするため、放置すると long-run で必ず throw する（`cancelOrphanedPlays` が DiplomaticPlay に対して存在するのと同じ理由）。v0.34 は安全側で `cancelled` に統一する（勝敗意味論は将来）。

**配置（ドラフト §10 から変更し v0.34 実装で確定）**: PolityOwnerConsistencySystem / OrganizationConsistencySystem の**後ろ**・cleanupWarSystem の前に独立 system として置き、**intervalWeeks=1**。理由は §5.6 / §6.24 v0.34 項目を参照（PeaceSettlement 起因で同 tick に extinct 化した polity を参照する active War を、年末 IntegrityCheck より前に回収するため）。warScore 計算の安全は WarProgress / PeaceSettlement 冒頭の dead-participant guard が担保するので、本 system を Progress / Settlement より後ろに置いても問題ない。

### 6.27e RegimentRecoverySystem（毎週、v0.36 → v0.37 baseline-aware）

active Regiment の organization と morale を週次で **baseline へ向けて回復 / 減衰**させる（`runRegimentRecoverySystem`）。WarManeuverSystem の直後（PeaceSettlement の前）に interval 1 で走り、battle で削れた統制・士気を平時に立て直す。

- 対象は `status === 'active'`。各連隊で **org recovery は tick 開始時の morale を参照**するため `moraleAtTickStart = morale` を先に退避する。
- **organization**: `< baselineOrganization` なら `+ regimentOrganizationRecoveryPerWeek × (0.5 + moraleAtTickStart/100)`、`> baselineOrganization` なら `− regimentOrganizationDecayAboveBaselinePerWeek`。最後に `clamp(0, maxOrganization)`。baseline で静止中は変化なし。
- **morale**（org と独立）: `< baselineMorale` なら `+ regimentMoraleRecoveryPerWeek`、`> baselineMorale` なら `− regimentMoraleDecayAboveBaselinePerWeek`。`clamp(0, maxMorale)`。
- **strength は触らない**（回復は §6.27g RegimentReinforcementSystem）。
- `nextOrg === organization && nextMorale === morale`（baseline 静止）なら連隊単位で skip。全連隊変化なしなら draft を clone せず素通し（perf。lazy clone-once）。
- worldgen は initial = baseline（org 50 / morale 30）で生成するので、平時連隊は静止し recovery rate に依存しない（reform 連隊や battle 後の連隊のみ rate で baseline へ戻る）。

v0.36 の「organization のみ・上限 100・morale は placeholder」を撤去し、§3.9b の baseline/max を使う双方向収束に置換した。

### 6.27f RegimentMaintenanceSystem（毎週、v0.36）

active Regiment の owner / home / war 参照を lazy に整理する（`runRegimentMaintenanceSystem`）。soft reference（currentWarId / owner active / homeHolding 存在）は IntegrityCheck の hard invariant にしない方針（§3.9b / §6.24）なので、本 system が遅延処理で整合を回復する。consistency 系の後・cleanupWarSystem の前に interval 1 で走る（cancelOrphanedWarsSystem の直後）。

active Regiment ごとに**順序を厳守**して処理する:

1. `homeHoldingId` が set で `holdings` に存在しない → **disband**（home 消失）。
2. `homeHoldingId` が set で holding 在り、`holdingTerminalPolityCache[homeHoldingId]` が現 owner（polity）と異なる → **owner 付け替え**（terminal Polity へ。basePower / strength / organization / 動員状態は維持。土地移転で Regiment 数が単調減少しないための要）。
3. 付け替え後の owner を再 read し `!isActorActive(owner)` → **disband**（owner 消滅）。
4. `currentWarId` が live(active) war を指していない（war 無し or terminal）→ **demobilize**（PeaceSettlement / cancel で終結した War に動員が残るのを遅延解除）。

disband は war 参照解除を兼ねるため demobilize と二重処理しない。多くの週は土地移転 / 滅亡 / 終戦が無く no-op で素通りする（lazy clone-once）。

### 6.27g RegimentReinforcementSystem（月次、v0.36 補充・再編成）

`organization` は §6.27e が週次回復する一方、`strength` は戦闘以外で回復せず、destroy も永続だった。そのため active regiment プールは構造的に非増加で、戦争を重ねると軍事力が床なしで減衰した（旧 §14.7）。本 system はこれを補完し、**プールを自己修復**させる（`runRegimentReinforcementSystem`）。RegimentMaintenanceSystem の**直後**に interval 4（月次）で走る。maintenance が active regiment の owner を terminal に揃え・home 消失/owner 失効を disband 済なので、整合した owner/home を前提にできる。

owner が Polity でない / `homeHoldingId` 無しは skip（v0.36 では worldgen が Polity owner のみ生成）。`treasury` は Polity 共有なので **RegimentId 昇順**（worldgen と同じ文字列比較）で決定的に処理する。rng は消費しない（deterministic だが strength が battle power にフィードバックするため **bit-identical ではない**）。

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

**この補完で旧 §14.7 の「プールは構造的に非増加・床なし減衰」は成立しなくなる**（プールは戦間期に自己修復する）。ただし reform には ≥`reformDelayWeeks` の平時が要り、開戦 AI は連隊在庫を見ないため、「全滅直後の Polity が攻撃側で開戦」transient は完全には解消しない（開戦 AI gate は future）。

### 6.28b cleanupWarSystem（毎週、v0.34 / v0.36）

terminal War（active 以外）が `endedWeek` から `terminalWarRetentionWeeks` 経過したら `state.wars` および `warIndex`（byParticipant / byOriginDiplomaticPlay）から削除する。履歴は Event ログに残るため長期保持は不要。**v0.36: 同じ削除ループで当該 War の `Battle` entity（§3.9c）も piggyback cleanup する**（`battleIndex.byWar[warId]` の各 battle を `battles` から削除し、index entry も除去）。Battle は短期 entity なので、対応する War の retention 削除と同時に消える。

### 6.29 CleanupTerminalDiplomacy（毎週、v0.18 / v0.29 / v0.30 更新）

terminal status の DiplomaticPlay と関連 Pressure / DiplomaticOffer を state から削除する GC。IntegrityCheck の直前に置く。v0.29 で intervalWeeks を 1 に変更。

**v0.30 offer cascade delete**:
- terminal Play の `offerHistoryIds` をたどり、関連 DiplomaticOffer をすべて `state.diplomaticOffers` から削除
- `currentOfferId` が `offerHistoryIds` に含まれていない場合、それも削除
- **削除順序: offer 先、play 後**。play を先に削除すると `offerHistoryIds` が失われるため

**v0.29 Pressure 同期**:
- terminal DiplomaticPlay に紐付く Pressure を `pressureIndex.byDiplomaticPlay` で取得
- 関連 active な initiator Project（Pressure.relatedProjectId）を cancelled に
- 関連 active な respond_to_pressure Project（Pressure.responseProjectId）を cancelled に
- PRESSURE_RESOLVED / PRESSURE_CANCELLED Event を発火した後、Pressure を削除
- Project cancel 対象の判定は Pressure.status によらない（responded 状態でも関連 active Project は cancel する）

### 6.29b PersonGoalMaintenanceSystem（48週ごと、v0.23）

Person Goal（人生目標）の生成と管理。成人時または初期生成時に 1 つの PersonGoalKind を選択。Person Goal は原則として固定であり、GoalMaintenanceSystem のレビュー・差し替え対象にはならない。

**生成対象**: alive / normal / adultAge 以上 / active House 所属の Person。placeholder は除外。

**PersonGoalKind スコアリング**: trait (ambition/caution)、ability、attitude、office 保有、組織コンテキストから score を計算し、最高スコアの kind を選択。

**fulfillment**: Goal.progress を baseFulfillment として使用。`getPersonGoalFulfillment` selector で baseFulfillment + 現在状況由来の modifier を算出（0..100 に clamp）。

イベント: `PERSON_GOAL_CREATED`

### 6.29c PersonAimMaintenanceSystem（4週ごと、v0.23）

Person Aim の生成・deadline 判定・waiting 再評価を管理。

**4w で実行する処理**: deadline 到達 Aim を failed に。target 無効 Aim を failed/abandoned に。waiting Aim の再評価（nextReviewWeek 到達時）。active Aim がない Person に Aim を生成。

**PersonAimKind 選択**: Goal Kind と状況に基づいてスコアリング。Phase A では `support_organization_aim` を除外。

**Aim → Task 接続**: Aim 作成時に initial Task を生成し、activeTaskId を設定。

イベント: `PERSON_AIM_CREATED` / `PERSON_AIM_SUCCEEDED` / `PERSON_AIM_FAILED`

### 6.29d TaskSystem（毎週、v0.23 / v0.26 更新 / v0.26.1 outcome 判定）

Task の生成・処理・outcome・ActivityLog・cleanup を同一 tick 内で完結する一体型 system。

**処理フロー**:
1. active Task の自動キャンセル判定（assignee 死亡/placeholder、owner inactive、target 消滅/terminal）
2. active Task を assigneePersonId ごとに集める
3. effectivePriority を計算（ownerDutyBonus + goalAlignmentBonus + urgencyBonus + taskKindPriorityBonus - overloadPenalty）
4. actionCapacity が許す限り Task を処理（base 2.0、ambition ≥ 0.7 で +0.5、age ≥ 60 で -0.5）
5. effortDone を加算（weeklyEffort = 1.0 × (1 + relevantAbility / 100)）
6. 完了した Task の outcome を判定（`determineTaskOutcome`、v0.26.1）
7. ActivityLog を作成
8. target entity に結果を反映（outcome に応じた分岐処理）
9. 完了・失敗・キャンセルされた Task を state から削除

**v0.26.1 outcome 判定** (`determineTaskOutcome`):
- `effectiveScore = abilityScore + roll * 100` (0〜220 の範囲)
- `threshold = difficulty * 2` (0〜200 の範囲)
- `effectiveScore >= threshold + successMargin` → success
- `effectiveScore >= threshold` → partial
- `effectiveScore < threshold` → failure

**v0.26 prepare_project outcome 分岐**:
- success: Project を作成（creator を prepare_project の assignee、supervisor を selectProjectSupervisor で選定）
- partial: Project を作成するが targetProgress にペナルティ加算
- failure: Project を作成しない

**v0.26 advance_project outcome 分岐**:
- success: progress += 25
- partial: progress += 10
- failure: progress += 0

**v0.29 preparatory stage outcome 分岐** (targetRef.kind === 'project' かつ preparatory stage):
- success: preparation/leverage/commitment に full gain 加算（respond_to_pressure は gain 不適用）、stageAttemptCount リセット、次 stage へ遷移
- partial: partial gain 加算、同 stage に留まる（attempt 消費なし）
- failure: gain なし、stageAttemptCount increment、上限超過で Project failed

**v0.29 target-side progress bridge**: DiplomaticPlay の target-side task 完了時に、`pressureIndex.byDiplomaticPlay` 経由で response Project を検索し、progress を加算する

**v0.27 develop_holding budget 消費**: advance_project outcome 解決時に ProjectBudget を消費する。消費額 = `budget.required / (expectedTasks × projectBudgetMarginMultiplier)`。outcome に関わらず一律消費（費用はタスク内容に、進捗は結果に由来するため）。将来的に担当者能力による消費乗数を導入予定。

**v0.26.1 Aim 系 Task outcome 分岐**:
- success: 通常処理（Aim progress +1、次 Task 生成等）
- partial / failure: progress を加算せず、aim は active のまま維持（次の personAimMaintenanceSystem サイクルで新 Task が生成される）

**DiplomaticPlay Task**: delegate に割り当て。side (initiator/target) で Task 種類の base score が異なる。delegate 能力が効果量に倍率（0.5 + ability/100）で影響。

**v0.30 offer_compromise 拡張**: Task 成功時に新 DiplomaticOffer を作成する。
1. progress += offerCompromiseProgressDelta (15)（既存 progressGainMedium は使わない）
2. tension -= tensionReductionSmall (5)（既存通り）
3. lastRejectedOfferId を基に ±30% 妥協方向へ調整した demands で新 offer を生成
4. play.currentOfferId を新 offer に更新、play.offerHistoryIds に追加
5. offer_compromise による progress は offerCompromiseProgressDelta に一本化（counterOfferProgressDelta との二重加算なし）

**v0.30 negotiate_terms**: progress += negotiateTermsProgressDelta (8)（既存 progressGainMedium を置換）。

イベント: `TASK_COMPLETED` / `TASK_FAILED` / `TASK_CANCELLED`

### 6.30 GoalMaintenanceSystem（4週ごと、v0.22）

Goal の生成・レビュー・abandon を管理する。tick 登録は 4w だが、生成・レビューは内部 48w ゲートで制御。

**4w で実行する処理**: inactive になった Polity / House の Goal を abandoned にする。
**48w ゲートで実行する処理**: active Goal がない主体に Goal を生成。review timing の Goal を評価し、steer_polity_* House Aim から policyInfluenceBonus を加算して差し替え判断。

**v0.23**: `owner.kind === 'person'` の Goal はスキップ（PersonGoalMaintenanceSystem で個別管理）。

GoalKind のスコアリング（§11.4 相当）は `goalSelectors.ts` の `scorePolityGoalKind` / `scoreHouseGoalKind` で実装。system House は除外。

イベント: `GOAL_CREATED` / `GOAL_REVIEWED` / `GOAL_ABANDONED`

### 6.30a AimMaintenanceSystem（4週ごと、v0.22）

Aim の生成・deadline 判定・target 無効化を管理する。tick 登録は 4w だが、Aim 新規生成は内部 48w ゲートで制御。

**4w で実行する処理**: deadline 到達 Aim を failed に。target 無効 Aim を failed/abandoned に。parent Goal が terminal の Aim を abandoned に。
**48w ゲートで実行する処理**: active Goal に対応する active Aim がなければ生成。

Aim target 選定は `goalSelectors.ts` の `pickAimForGoal` で実装。

- `improve_owned_contract_terms` / `demand_tax_increase_from_vassal` は `external_expansion` / `internal_development` 両方の goal で候補に入る（税率交渉は対外・内政どちらの文脈でも合理的なため）
- 対象契約の `termsProtectedUntilWeek` が現在週を超えている場合はスキップ

イベント: `AIM_CREATED` / `AIM_FAILED` / `AIM_ABANDONED`

### 6.30b AimToIntentGenerationSystem（v0.26 で廃止）

**v0.26 で廃止。** Aim から Project への具体化は ProjectPreparationSystem (§6.25a) が担当。

### 6.30c IntentActionSystem（v0.26 で廃止）

**v0.26 で廃止。** Action 系の効果は ProjectOutcomeSystem (§6.25e) が Project 完了時に適用。

### 6.30c2 PressureSystem（毎週、v0.29）

active Pressure に対して respond_to_pressure Project を自動生成する。

**処理**: active かつ responseProjectId がない Pressure を走査し、target Polity の leader を取得。leader が alive / normal なら respond_to_pressure Project を作成。supervisor は `selectProjectSupervisor` で能力・workload ベースで選出（fallback: leader）。

**Project 初期値**: owner = pressure.target、origin = { kind: 'system', reasonKey: 'pressure_response' }、currentStageKey = 'choose_stance'、deadlineWeek = DiplomaticPlay.deadlineWeek or absoluteWeek + pressureResponseDefaultDeadlineWeeks。

**重複防止**: Pressure.responseProjectId が設定済みなら再生成しない。response Project が failed/cancelled でも responseProjectId を維持する（ループ防止）。

イベント: `PROJECT_STARTED`

### 6.30d AimOutcomeSystem（4週ごと、v0.22 / v0.26 更新）

terminal DiplomaticPlay の aimId を確認し、Play の結果に応じて Aim progress を更新する。settled / resolved_by_conflict（勝利）→ progress += `aimProgressGainLandOrContractProject` (50), successfulProjectCount +1。failed / resolved_by_conflict（敗北）→ failedProjectCount +1。activeDiplomaticPlayId をクリア。`progress >= targetProgress - aimProgressCompletionTolerance` で progress を targetProgress に丸め、Aim succeeded。

**v0.26**: `successfulIntentCount` / `failedIntentCount` → `successfulProjectCount` / `failedProjectCount` に改名。progress 加算値を targetProgress=100 ベースに変更。非外交系 Project の Aim progress は ProjectOutcomeSystem が加算する（二重加算防止）。

イベント: `AIM_SUCCEEDED`

### 6.30e GoalOutcomeSystem（4週ごと、v0.22 / v0.23 拡張）

terminal Aim の goalId を確認し、Aim 結果に応じて Goal progress を更新する。succeeded → +25、failed → -10、abandoned → -5（config 経由）。progress を 0..targetProgress にクランプ。progress >= targetProgress で Goal succeeded。

**v0.23**: `owner.kind === 'person'` の Goal は progress を 0..100 にクランプし、succeeded にはしない（Person Goal は人生目標であり達成判定を行わない）。

イベント: `GOAL_SUCCEEDED`

### 6.30f CleanupTerminalDecisions（4週ごと、v0.22 / v0.36 retention 修正）

terminal Goal / Aim を WorldState から削除。orphan DecisionReason を削除。goalIndex / aimIndex を更新。CleanupTerminalDiplomacy の後に配置。

**retention（削除しない条件）**: terminal でも以下に参照される間は削除しない。

- Aim: active な Project（`origin.aimId`）または DiplomaticPlay（`aimId`）が参照する Aim は保持（Project は origin Aim の存在を要求するため）。
- Goal: active な DiplomaticPlay（`goalId`）が参照する Goal は保持。
- **Goal（v0.36 追加）**: 上記で生存する Aim が `goalId` で参照する Goal も保持し、`active Project → origin Aim → Goal` の依存チェーンを完結させる。これを欠くと、terminal Goal が「active Project に保持された terminal Aim」より先に削除され、Aim の `goalId` が dangling 化して年末 IntegrityCheck（`Aim X: goalId Y does not exist`）で throw する（特定 seed の RNG で long-run 顕在化。v0.22 から存在した既存バグの修正で、v0.36e 分割継承とは独立）。Project 完了で Aim が解放されると、次回 cleanup で Aim → Goal の順に削除され収束する。

---

