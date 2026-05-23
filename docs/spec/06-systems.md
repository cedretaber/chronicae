# 6. 各システムの仕様

### 6.1 DevelopmentSystem（4週ごと）

全 Province に対して自然減衰・回復を適用：

```
development > 0 → development = max(0, development - developmentPositiveMonthlyDecay)
development < 0 → development = min(0, development + developmentNegativeMonthlyRecovery)
結果を clamp(-100, 100)
```

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

### 6.5a LandRevenueSystem（4週ごと、v0.16 / v0.20 / v0.24 更新）

Province の生産を **Holding 単位で分配**し、各 Holding の LandContract chain に沿って上納する。

**6.5a.1 生産量算出（v0.24 更新）**

v0.24 で occupation productivity multiplier を追加。各 POP の生産量は `pop.size * productivityByClass * occupationProductivityMultiplier * (wealth/100) * holdingDevMod * holdingControlMod` で算出する。`none` POP の生産性は 0.1（最低限の日雇い・自給を表す）。

```ts
const production = getProvinceProduction(state, config, province.id)
```

**6.5a.2 per-Holding 分配と chain 上納（v0.20）**

Province 生産を各 Holding の share weight に応じて分配する。

```ts
// §12.3: Holding の share weight
holdingShareWeight = holding.weight * holding.landQuality * kindMultiplier(holding.kind)
// kindMultiplier: manor = 1.0, city = 1.3

// Province 全体の totalShareWeight
totalShareWeight = sum(holdingShareWeight for each Holding in Province)

// per-Holding 収入
holdingShare = production * (holdingShareWeight / totalShareWeight)
holdingRevenue = holdingShare * (holding.polityControl / 100)
```

各 Holding について、その byHolding chain を terminal → root の順に走査し上納する。

```ts
let remaining = holdingRevenue * taxEfficiency
for (const contract of chain.slice().reverse()) {
  const tax = remaining * contract.terms.taxRateToGrantor
  granteePolity.treasury += (remaining - tax)
  remaining = tax
}
```

`root contract` の `taxRateToGrantor` は 0 固定なので、world に流出する分は無い。

**6.5a.3 Polity treasurer の taxEfficiency**

terminal Polity の treasurer に能力補正がかかる（§10 参照）。

**6.5a.4 過徴税ペナルティ**

`extractionRatio` の入力は `polityControl` 単独になる。判定式は旧 EconomySystem と同じ。

```ts
if (
  extractionRatio > config.overExtractionThreshold &&
  (averageWealth < config.overExtractionWealthSafeThreshold ||
   provinceUnrest > config.overExtractionUnrestSafeThreshold)
) {
  const over = extractionRatio - config.overExtractionThreshold
  adjustProvincePopWealth(state, province.id, -over * config.overExtractionWealthPenalty)
  adjustProvincePopUnrest(state, province.id, over * config.overExtractionUnrestGain)
}
```

**6.5a.5 retained wealth の POP 反映**

回収されなかった富は POP wealth に反映される（旧 EconomySystem と同じ式、`polityControl` 単独入力）。

### 6.5b PolitySurplusDistributionSystem（4週ごと、v0.16）

各 Polity treasury から OrganizationShare に応じて Share holder に分配する。給与・維持費 (OfficeCompensationSystem §6.14b) は別 system で支払う。

```ts
const distributable = Math.max(
  0,
  polity.treasury - config.polityTreasuryReserveTarget
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

`reserveTarget` (`polityTreasuryReserveTarget`、暫定 100) は予備として残り、後続の OfficeCompensationSystem の給与原資となる（spec-v016-update.md §21）。

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
| Famine（飢饉） | 8% | +9.2/excess | Province dev 低下、peasants wealth -8・population -10% |
| Plague（疫病） | 3% | +2.0/excess | Province dev 低下、全 POP wealth -10・population -5% |
| BountifulHarvest（豊作） | 5% | なし | Province dev 上昇、peasants/townsmen wealth 上昇・unrest 低下 |

**Famine の詳細**:
- dev -= `famineDevastation`
- peasants wealth -= `famineWealthPenalty`（default: 8）
- peasants size *= `(1 - famineSizeDamageRate)`（default: -10%）

**Plague の詳細**:
- dev -= `plagueDevastation`
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

### 6.8 MarriageSystem（48週ごと = 毎年）

`marriageEnabled` が true のとき動作。未婚の男性候補を一覧し、それぞれに対して婚姻判定を行う。

- **候補条件（男性）**: 生存・未婚・対象年齢（`marriageMaleMinAge`〜`marriageMaleMaxAge`）・所属家が active
- **候補条件（女性）**: 生存・未婚・対象年齢（`marriageFemaleMinAge`〜`marriageFemaleMaxAge`）・所属家が active
- **禁止組み合わせ**: 同一家・近親関係（`isForbiddenMarriagePair` によるチェック）
- **同 Polity 婚ボーナス**（v0.15）: `getPersonPrimaryPolityId` で primary Polity を取得し、男女で一致なら `samePrimaryPolityMarriageBonus`（+0.08）を加算
- **異 Polity 婚ペナルティ**（v0.15 で廃止）: 「単一 Polity 所属を強要しない」設計のためペナルティは加えない

婚姻成立時の処理：
- 女性が男性の家に `movePersonToHouse` で移動
- `spouseId` を双方向に設定（`setSpouse`）
- `house.memberIds` に女性を追加

イベント: `MARRIAGE_FORMED`（importance: `normal`）

### 6.9 BirthSystem（48週ごと = 毎年）

`birthEnabled` が true のとき動作。対象年齢（`fatherMinChildAge`〜`fatherMaxChildAge`）の生存男性を走査し、出生判定を行う。AnonymousHouse 所属者は出産対象外（v0.20.3）。家を持たない在野人物が子を残すには、まず家系を創設する必要がある。

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

家長交代は `house:leader` の OfficeAssignment を新設し、旧ホルダーの assignment を inactive にすることで記録する。`HOUSE_LEADER_CHANGED` イベントを発火（v0.12）。

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

イベント: `HOUSE_SPLIT`（importance: `major`）+ `SUCCESSION_CRISIS`（importance: `major`）

**cohesion（結束度）について**:
- v0.11 より `house.cohesion` フィールドは廃止。`getHouseCohesion` セレクターで動的計算（§4.5 参照）
- 結束度は家メンバーの家長への attitude から計算されるため、態度変化イベントにより自然に変動する

### 6.12 未成年当主ペナルティ（SuccessionSystem 内）

当主が未成年（age < `adultAge`）の間、4 週ごとに適用。v0.11 以降は格納フィールドの直接変更ではなく、Attitude の調整を通じて cohesion・loyaltyToPolity に間接影響を与える（実装上は `minorHeadCohesionPenaltyPerMonth` / `minorHeadLoyaltyPenaltyPerMonth` の config 値が引き続き参照される）。

### 6.13 HouseExtinctionSystem（SuccessionSystem から呼び出し）

後継者が存在しない家（生存メンバーが 0 または全員未成年かつ成人後継者なし）に対して断絶処理を行う。実体の状態書き換えは `extinctHouse` mutation（`worldStructureMutations.ts`）に集約されている（v0.13 / v0.15）。

**v0.16 House active 判定の変更**: 旧 v0.15 までの「`house.provinceIds.length === 0` で即 extinction」判定は廃止された。House active は memberIds（血統）ベースで判定され、土地を完全に失っても active=true のまま「亡命家」として存続する（spec-v016-update.md §9.1）。お家再興 / 復古試行は将来の Faction 段階で動的に発生する想定で、v0.16 ではデータ上の存続のみ許す。

**v0.15 §22.3 affectedPolityIds スナップショット**:

```ts
type HouseExtinctionInput = {
  houseId: HouseId
  affectedPolityIds: PolityId[]  // 喪失前の getHousePolityIds スナップショット
}
```

呼び出し側で所領喪失前の Polity 集合を取得しておき、メンバー移住先選定のスコープとして使う。

**移住先 House の選定（v0.15 §22.3 / v0.16）**:

1. `affectedPolityIds` 内で最大 controlled Province 数を持つ active 通常 House (system house 除外)
2. `affectedPolityIds` 内で最大 Polity Share を持つ active 通常 House
3. 旧 `seatProvinceId` に隣接する Province の effective ownerHouse
4. 世界全体で最大 controlled Province 数を持つ active 通常 House (system house 除外、v0.16)
5. 見つからない場合、メンバーは inactive のまま House 解散

選定後の処理（v0.16 §22.3）:
- 断絶家が ownerHouse である **すべての Polity** を receiver House に継承（王朝交代）
  - `Polity.ownerHouseId = receiver.id`
  - `polityIndex.byOwnerHouse` 同期更新
  - `polity:leader` Office を receiver House の leader に差し替え
  - `POLITY_OWNER_CHANGED` event を Polity ごとに発火
- LandContracts は変更しない（Polity と Province の関係は不変、王朝のみ交代）
- `moveLivingMembersToHouse` で生存メンバーを継承先に移動
- 断絶家を `active: false`、`memberIds: []` に設定

旧 v0.15 までの「断絶家の Province を transferProvinceToHouse で受け取り House の既存 Polity に移す」処理は v0.16 で廃止された（異 Polity 間の Province 跨ぎが不自然なため）。

**Polity の inactive 化は HouseExtinctionSystem で行わない**（v0.15）:
v0.14 では `handleRulerHouseExtinction` が ruler house extinct で Country を消滅させていたが、v0.15 ではこれを削除。Polity の active 制御は §6.22b PolityOwnerConsistencySystem に一本化する。
これにより HouseExtinction → 所領消失 → 当月内に PolityOwnerConsistency が owner 補充または `POLITY_EXTINCT` 発火、という分離した責務になる。

イベント: `HOUSE_EXTINCT`（importance: `major`）

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

**v0.23 追加**: `getAppointmentTaskModifier(state, personId, organization, role)` による Person Aim / Task 効果の補正を候補スコアに加算。obtain_office / retain_office Aim が active、または seek_office_support / display_competence の直近 ActivityLog がある候補は +appointmentTaskModifierValue（デフォルト 4）の補正を受ける。

**イベント**: `OFFICE_ASSIGNED`（importance: `normal`）

### 6.14b OfficeCompensationSystem（4週ごと、v0.23 で頻度変更）

アクティブな OfficeAssignment に対して、`baseSalary`（§3.7 参照）に基づく給与を支払う。

- 支払元: Polity 役職 → `polity.treasury`、House 役職 → `house.wealth`
- 支払先: `person.wealth += paid`
- 資金不足時は部分支払いまたは未払い
- 未払い・部分支払い時: `office.unpaidCount` を増加し、Person の Attitude（対 Polity / 対 House の affection・respect）にペナルティを付与
  - ペナルティは `officeDignityUnpaidPenaltyReduction` × dignity 値で軽減
- `unpaidCount` が 0 の完全支払い時にはリセット

**イベント**: `OFFICE_SALARY_UNPAID`（importance: `minor`）/ `OFFICE_SALARY_PARTIALLY_PAID`（importance: `minor`）

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

### 6.16 PublicSpendingSystem（48週ごと = 毎年）

`publicSpendingYearlyChance`（35%）で発動。Polity treasury から terminal Province 1 つを選んで土地開発する。

**Polity土地開発（POP_LAND_DEVELOPED）**:
- 条件: treasury >= effectiveCost（Polity treasurer の admin による割引あり）
- 対象 Province: 当該 Polity が terminal な Province の中から、ruler House の所領 (`getProvinceEffectiveOwnerHouseId === rulerHouseId`) と recovery score (負の development の絶対値) で最高スコアを選ぶ
- 効果: development += gain（clamp）、treasury -= effectiveCost
- v0.16: `houseControl` 廃止に伴い旧来の `landDevelopmentHouseControlGain` 加算は無効化された (config は残置するが未使用)

**記念碑建設の廃止**:
v0.16 後の整理で `MONUMENT_BUILT` イベントは削除された（ログを埋めるだけで観賞価値が薄く、polityControl 補強の代替経路として独立した存在意義に乏しいため）。これに伴い `monumentScore` vs `landDevelopmentScore` の二択分岐構造、関連 config (`monumentBaseCost` / `monumentPolityControlGain` / `chancellorAmbition,CautionMonumentScoreEffect`)、selector (`calcChancellorMonumentScoreBonus`) もすべて削除された。

### 6.17 HouseDevelopmentSystem（v0.22 で廃止）

House が直接 Holding / Province を開発する仕組みは、土地契約・代官任命・徴税・実効支配を Polity が担う v0.20 以降の土地統治モデルと整合しない。v0.22 で廃止し、土地開発は Polity の Aim / Intent (develop_holding) に一本化した。House は Polity Share・政策誘導（steer_polity_internal_development）を通じて関与する。

廃止に伴い、`houseDevelopmentEnabled` / `houseDevelopmentYearlyChance` / `houseLandDevelopmentBaseCost` / `houseLandDevelopmentGain` / `houseWealthReserve` config と `HOUSE_LAND_DEVELOPED` EventType を削除した。

### 6.18 PopDevelopmentSystem（4週ごと）

`popDevelopmentEnabled` が true のとき動作。地元共同体・都市民・在地有力者による小規模な土地改善を表す。

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
        // v0.18-pre: commonwealth の rebel founder (AnonymousHouse 所属) は eligible 扱い
        isCommonwealthRebelHolder = polity.kind === 'commonwealth' && person.houseId === ANONYMOUS_HOUSE_ID
        if not isCommonwealthRebelHolder:
          house = state.houses[person.houseId]
          if house is missing or not active or house.id not in eligibleHouseIds:
            removeOrganizationShare(share.id)

  // Step 2: 不適格 Polity Office revoke
  for each active office where organization is { kind: 'polity', id: polity.id }:
    person = state.persons[office.holderPersonId]
    if not person.alive: continue  // 別系統の不整合（IntegrityCheck で検知）
    house = state.houses[person.houseId]
    houseEligible = house and house.active and house.id in eligibleHouseIds
    // v0.18-pre: commonwealth の rebel founder (AnonymousHouse 所属) は eligible 扱い
    isCommonwealthRebelHolder = polity.kind === 'commonwealth' && person.houseId === ANONYMOUS_HOUSE_ID
    // v0.21: active な派閥に所属する人物は eligible 扱い（派閥経由の任命を維持するため）
    isFactionMember = getActiveFactionMembership(state, office.holderPersonId) !== undefined
    if houseEligible or isCommonwealthRebelHolder or isFactionMember: continue
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
  - commonwealth Polity の AnonymousHouse 所属 rebel founder
  - active な派閥に所属する人物（派閥が解散すれば次回チェックで revoke される）
- Step 3 により、Polity の rank 降格時に定員超過の役職者が自動的に整理される
- rebel founder が死亡したら `markPersonDead → revokeOfficesByHolder` 経路で Office が revoke され、Step 1 の `!person.alive` 分岐で Share も削除される (commonwealth Polity は leader 死後も active=true で存続するが、Office / Share holder は不在になる)

v0.18-pre 時点では `polity.kind === 'commonwealth' && houseId === ANONYMOUS_HOUSE_ID` という ad-hoc な分岐になっており、将来的には `AppointmentPolicy` 抽象化 (Polity ごとの任命方針) として一般化する予定。詳細は `docs/drafts/spec-v018-pre-update.md` §5 参照。

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

**v0.18 追加チェック項目**:

ActorIntent:
- すべての entry の status === 'active' (terminal status は tick 末で削除される前提)
- actor が存在する active actor を指す
- targetProvinceId が存在する場合、Province が存在する

DiplomaticPlay:
- すべての entry の status ∈ {'active', 'escalated'} (terminal status は tick 末で削除される前提)
- initiator / target が存在する
- progress / tension は 0..100
- primaryDemand が有効な対象を指す

Revolt:
- revolt_negotiation の initiator は commonwealth Polity
- revolt_negotiation の target は normal Polity

Commonwealth Polity:
- kind === 'commonwealth' なら ownerHouseId === undefined を許容
- commonwealth の active DiplomaticPlay の initiator になるのは revolt_negotiation のみ

### 6.25 IntentGenerationSystem（48週ごと = 毎年、v0.18 / v0.22 縮小）

**v0.22 で sell_land 専用に縮小。** `acquire_land` / `improve_contract_terms` / `demand_tax_increase` は Goal/Aim 系（AimToIntentGenerationSystem §6.30b）が生成するため除外。

生成対象:
- `sell_land`: 財政難の Polity が辺境 Province を売却したい意図

`sell_land` は本来 Pressure: `financial_strain` に対する Response Aim に属する行動だが、v0.22 では Pressure を本格実装しないため旧経路で暫定維持。将来 Pressure-response Aim に移行後、本 system を完全廃止する。

旧 IntentGenerationSystem が生成する Intent は `goalId` / `aimId` を持たない（許容）。

### 6.26 IntentToDiplomaticPlaySystem（4週ごと、v0.18）

active な ActorIntent を DiplomaticPlay に変換する。

変換マッピング:
- `sell_land` / `acquire_land` → `land_claim`
- `improve_contract_terms` / `demand_tax_increase` → `contract_tax_revision`

Province 単位 dedup: 同一 Province に対して同時進行できる外交劇は高々 1 つ。全 DiplomaticPlayKind 横断で適用。

**v0.20**: Play 生成時に `selectTargetHoldingInProvince` で対象 Holding を選定し、DiplomaticDemand の `holdingId` に設定する。dedup は引き続き Province 単位。

### 6.27 DiplomaticPlaySystem（4週ごと、v0.18 / v0.23 Task-driven 化）

active な DiplomaticPlay を進行させる。

**v0.23**: structuralProgress を `structuralProgressFactor`（0.33）で弱化。delegate 選定・Task 生成・交渉パラメータ更新を追加。

各 Play kind の acceptanceScore を計算し、progress / tension を更新（v0.23 では ×0.33 の弱化係数を適用）。
- progress >= settlementThreshold (60) → settlement
- tension >= escalationThreshold (40) → escalation (status='escalated')
- deadline 到達 → progress > tension なら settlement、それ以外 escalation

Play kind 別の処理:
- `land_claim`: 土地契約の移転。rank ベースの契約選択 (3-a/3-b/3-c) と操作 (5-a/5-b/5-c)。settlement 時の分岐: counterDemand (pay_wealth) あり → reason='purchase' (LAND_CONTRACT_PURCHASED)、なし → reason='cession' (LAND_CONTRACT_CEDED)。
- `contract_tax_revision`: 税率 ±5% 変更。下限 5% / 上限 80% 超で契約破棄 (`eliminateContractFromChain` mutation による chain 再接続)。Play 決着時（成否問わず）に対象契約に `termsProtectedUntilWeek` を設定し、`taxRevisionGracePeriodYears`（default 5年）間は同一契約への再交渉を禁止する。
- `revolt_negotiation`: 叛乱交渉。妥協 / 鎮圧 / 独立の 3 分岐。

### 6.28 ConflictResolutionSystem（4週ごと、v0.18）

status='escalated' な DiplomaticPlay を武力衝突として解決する。

軍事力比較 → winChance → RNG 判定。
- initiator 勝利: demand を適用 (土地移転 / 税率変更 / 独立)
- defender 勝利: status_quo (revolt の場合は鎮圧)

revolt_negotiation の決裂時は通常の actor military power ではなく、ProvinceRevoltSystem の既存式 (rebelPower / suppressionPower) を利用する。

WAR_WON / WAR_LOST event を発火。敗者に戦争被害 (treasury / development / unrest) を適用。

### 6.29 CleanupTerminalDiplomacy（4週ごと、v0.18）

terminal status の ActorIntent / DiplomaticPlay を state から削除する GC。IntegrityCheck の直前に置く。v0.17.3 で inactive OfficeAssignment / FactionMembership の累積が perf 問題を引き起こした経験を踏まえ、最初から完全削除設計。

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

### 6.29d TaskSystem（毎週、v0.23）

Task の生成・処理・outcome・ActivityLog・cleanup を同一 tick 内で完結する一体型 system。

**処理フロー**:
1. active Task の自動キャンセル判定（assignee 死亡/placeholder、owner inactive、target 消滅/terminal）
2. active Task を assigneePersonId ごとに集める
3. effectivePriority を計算（ownerDutyBonus + goalAlignmentBonus + urgencyBonus + taskKindPriorityBonus - overloadPenalty）
4. actionCapacity が許す限り Task を処理（base 2.0、ambition ≥ 0.7 で +0.5、age ≥ 60 で -0.5）
5. effortDone を加算（weeklyEffort = 1.0 × (1 + relevantAbility / 100)）
6. 完了した Task の outcome を解決（effortDone >= effortRequired で完了）
7. ActivityLog を作成
8. target entity に結果を反映（Aim progress 更新、次 Task 生成、waiting/blocked 状態管理）
9. 完了・失敗・キャンセルされた Task を state から削除

**DiplomaticPlay Task**: delegate に割り当て。side (initiator/target) で Task 種類の base score が異なる。delegate 能力が効果量に倍率（0.5 + ability/100）で影響。

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

### 6.30b AimToIntentGenerationSystem（4週ごと、v0.22）

active Aim から ActorIntent を生成する。Aim.activeIntentId / activeDiplomaticPlayId が設定済みならスキップ。cooldown（nextIntentAllowedWeek）チェック。**v0.23**: `owner.kind === 'person'` の Aim はスキップ（Person Aim は Intent を生成せず Task で直接進行）。

外交劇系: acquire_land / improve_contract_terms / demand_tax_increase。
Action 系: develop_holding / expand_polity_share / promote_policy_shift / patronize_artist / commission_chronicle。

### 6.30c IntentActionSystem（4週ごと、v0.22）

Action 系 Intent を即時処理し、結果を Aim progress に直接反映する。

| Intent kind | Actor | 効果 |
|---|---|---|
| develop_holding | Polity | treasury -= 30, Holding development += 5, COUNTRY_LAND_DEVELOPED |
| expand_polity_share | House | wealth -= 40, OrganizationShare rawPower += 10, HOUSE_POLITY_SHARE_EXPANDED |
| promote_policy_shift | House | Aim progress +1, HOUSE_POLICY_INFLUENCE |
| patronize_artist | House | wealth -= 25, legacyPrestige += 3, HOUSE_PATRONIZED_ARTIST |
| commission_chronicle | House | wealth -= 40, legacyPrestige += 5, HOUSE_COMMISSIONED_CHRONICLE |

処理済み Intent は terminal status にして cleanup 対象。

### 6.30d AimOutcomeSystem（4週ごと、v0.22）

terminal DiplomaticPlay の aimId を確認し、Play の結果に応じて Aim progress を更新する。settled / resolved_by_conflict（勝利）→ progress +1, successfulIntentCount +1。failed / resolved_by_conflict（敗北）→ failedIntentCount +1。activeDiplomaticPlayId をクリア。progress >= targetProgress で Aim succeeded。

イベント: `AIM_SUCCEEDED`

### 6.30e GoalOutcomeSystem（4週ごと、v0.22 / v0.23 拡張）

terminal Aim の goalId を確認し、Aim 結果に応じて Goal progress を更新する。succeeded → +25、failed → -10、abandoned → -5（config 経由）。progress を 0..targetProgress にクランプ。progress >= targetProgress で Goal succeeded。

**v0.23**: `owner.kind === 'person'` の Goal は progress を 0..100 にクランプし、succeeded にはしない（Person Goal は人生目標であり達成判定を行わない）。

イベント: `GOAL_SUCCEEDED`

### 6.30f CleanupTerminalDecisions（4週ごと、v0.22）

terminal Goal / Aim を WorldState から削除。orphan DecisionReason を削除。goalIndex / aimIndex を更新。CleanupTerminalDiplomacy の後に配置。

---

