# Chronicae v0.4 仕様書

## Province Development / House Investment

最終更新: 2026-05-14

---

## 1. 概要

v0.4 では、POP 本体の導入前段階として、プロヴィンス単位の生産力・荒廃・発展を扱う。

本来導入したい POP システムは、人民を社会階層・文化・言語・思想・宗教などの属性ごとに抽象化して管理する大規模な仕組みである。しかし、現段階のプロトタイプに本格 POP を組み込むと変更範囲が大きくなりすぎる。

そのため v0.4 では、まず Province に「発展・荒廃」の状態値を追加し、戦争・反乱・災害・公共支出・家の投資が土地の出力に影響することを検証する。

---

## 2. v0.4 の目的

v0.4 の目的は以下である。

* 土地が戦争・反乱・災害によって荒廃することを表現する
* 荒廃した土地が時間経過で回復することを表現する
* 発展した土地が税収・兵力で高い出力を持つことを表現する
* 国家が treasury を使って土地開発を行う
* 家が wealth を使って自領を開発する
* House.wealth に軍事力以外の用途を与える
* 戦争・災害・反乱の痕跡を Province に残す
* 将来の POP・施設・記念碑・帰属意識システムへの接続点を作る

v0.4 は完成品の経済システムではない。あくまで「土地状態がシミュレーションに意味を持つか」を検証するためのプロトタイプ拡張である。

---

## 3. スコープ

### 3.1 v0.4 に含めるもの

* Province.development の追加
* development による税収補正
* development による兵力補正
* development の自然回復・自然減衰
* 戦争による荒廃
* 反乱による荒廃
* 災害による荒廃・発展
* 「民への施し」の「土地開発」への置き換え
* 国家による土地開発
* 家による自領開発
* 国家の土地開発対象選択における支配家領バイアス
* development 関連 selector の追加
* UI 上での development 表示
* 関連イベントタイプの追加または改修
* テスト追加

### 3.2 v0.4 に含めないもの

以下は重要だが、v0.4 では扱わない。

* 本格 POP

  * 社会階層
  * 文化
  * 言語
  * 思想
  * 宗教
  * 支持対象
  * 所得階層
* 記念碑エンティティ化

  * どこに建てるか
  * 継続効果
  * 破壊・略奪
  * 複数種類の記念碑
* House legitimacy

  * 家の正統性
  * 王位請求権
  * 家門の権威
* 個人の帰属意識

  * 国家重視
  * 家重視
  * 自己利益重視
* 恒久的施設システム

  * 城塞
  * 道路
  * 港
  * 市場
  * 神殿・教会
* 詳細な地形・気候・産物システム

---

## 4. 基本方針

### 4.1 Province development

Province に `development` を追加する。

```ts
type Province = {
  id: ProvinceId
  name: string

  x: number
  y: number
  neighbors: ProvinceId[]

  ownerHouseId: HouseId
  countryId: CountryId

  baseTax: number
  manpower: number
  unrest: number

  development: number // -100 .. 100
}
```

`development` は土地の荒廃・発展を同じ尺度で表す。

```text
-100 = 完全に荒廃
   0 = 通常状態
+100 = 高度に発展
```

値は必ず `-100 .. 100` に clamp する。

### 4.1.1 worldgen 初期値

worldgen では、各 Province の `development` 初期値を軽微なランダム値にする。

```ts
development: randomInt(rng, -10, 10)
```

理由:

* 初期世界にも軽微な地域差を持たせる
* 出力倍率は 90% .. 110% 程度に収まり、序盤バランスへの影響が小さい
* `randomInt(-20, 20)` 以上の大きな初期差は、開始直後の税収・軍事力バランスに影響しやすいため避ける

### 4.2 development 出力倍率

`development` は税収・兵力に対する出力倍率として使う。

```ts
function getProvinceDevelopmentMultiplier(province: Province): number {
  return clamp(1 + province.development / 100, 0, 2)
}
```

対応関係:

```text
development = -100 → 出力 0%
development =  -50 → 出力 50%
development =    0 → 出力 100%
development =  +50 → 出力 150%
development = +100 → 出力 200%
```

---

## 5. 追加 selector

以下の selector を追加する。

```ts
function getProvinceDevelopmentMultiplier(province: Province): number

function getEffectiveProvinceTax(province: Province): number

function getEffectiveProvinceManpower(province: Province): number
```

### 5.1 税収計算

税収は unrest と development の両方を反映する。

```ts
effectiveTax =
  province.baseTax
  * (1 - province.unrest / 100)
  * getProvinceDevelopmentMultiplier(province)
```

### 5.2 兵力計算

兵力は development を反映する。

v0.4 では unrest の兵力への影響は控えめにする。

```ts
effectiveManpower =
  province.manpower
  * (1 - province.unrest / 200)
  * getProvinceDevelopmentMultiplier(province)
```

理由:

* unrest を兵力に強く効かせすぎると、反乱・戦争まわりの挙動が不安定になりやすい
* 税収は unrest の影響を強く受ける
* 兵力は unrest の影響を受けるが、0 になりすぎないようにする

---

## 6. DevelopmentSystem

### 6.1 目的

DevelopmentSystem は、Province.development を時間経過で 0 に近付ける。

荒廃は徐々に復興する。
発展は維持管理なしでは徐々に通常状態へ戻る。

### 6.2 処理タイミング

毎月実行する。

推奨 tick 順序:

```text
1.  advanceTime
2.  runDevelopmentSystem
3.  runEconomySystem
4.  runDisasterSystem
5.  runMortalitySystem
6.  runEmergenceSystem
7.  runSuccessionSystem
8.  runAppointmentSystem
9.  runAmbitionSystem
10. runPublicSpendingSystem
11. runHouseDevelopmentSystem
12. runPlotSystem
13. runWarSystem
14. runRebellionSystem
15. runStabilitySystem
16. runGovernanceSystem
17. runIntegritySystem
```

DevelopmentSystem を EconomySystem より前に実行することで、その月の自然回復・自然減衰を反映した税収が得られる。

### 6.3 自然回復・自然減衰

発展と荒廃は非対称に扱う。

初期値:

```ts
developmentPositiveMonthlyDecay = 0.1

developmentNegativeMonthlyRecovery = 0.25
```

処理:

```ts
if (province.development > 0) {
  province.development = Math.max(0, province.development - developmentPositiveMonthlyDecay)
}

if (province.development < 0) {
  province.development = Math.min(0, province.development + developmentNegativeMonthlyRecovery)
}
```

理由:

* 荒廃が長く残りすぎると世界全体が沈み込みやすい
* 発展が永久に残ると富裕地域が自己強化しすぎる
* どちらも永続値ではなく、時間とともに通常状態へ戻る状態値として扱う

補足:

`developmentPositiveMonthlyDecay = 0.1` は意図的に遅めの値である。
`development = +100` から 0 に戻るまで約 1000 か月、すなわち約 83 年かかる。
これは、土地開発の成果を数十年単位で観察できるようにするためである。

ただし、50年 / 100年 / 200年テストで発展が飽和しやすい場合は、この値を大きくして調整する。

---

## 7. EconomySystem の変更

現状:

```text
effectiveTax = baseTax × (1 - unrest / 100)
house.wealth += effectiveTax × 0.6
country.treasury += effectiveTax × 0.4
```

v0.4:

```text
effectiveTax = baseTax × (1 - unrest / 100) × developmentMultiplier
house.wealth += effectiveTax × 0.6
country.treasury += effectiveTax × 0.4
```

`baseTax` は引き続き固定値である。
`development` が短中期的な土地状態を表す。

---

## 8. MilitarySelectors の変更

現状:

```text
houseMilitaryPower =
  sum(province.manpower)
  + bestMartialInHouse × 2
  + house.wealth / 20
```

v0.4:

```text
houseMilitaryPower =
  sum(effectiveProvinceManpower)
  + bestMartialInHouse × 2
  + house.wealth / 20
```

`effectiveProvinceManpower` は development と unrest を反映する。

```text
effectiveProvinceManpower = manpower × (1 - unrest / 200) × developmentMultiplier
```

---

## 9. 戦争による荒廃

WarSystem は、戦争結果に応じて Province.development を下げる。

### 9.1 攻撃側勝利時

征服された Province に荒廃を与える。

```text
PROVINCE_CONQUERED 対象 Province:
  development -= warConqueredProvinceDevastation
```

初期値:

```ts
warConqueredProvinceDevastation = 8
```

防衛側の国境地域にも軽微な荒廃を与える。
ただし、対象は「征服されなかった防衛側国境 Province」に限定する。

現在の WarSystem では、以下を区別する。

```text
borderProvinceIds = 防衛側のうち攻撃側と隣接している全 Province
provincesToTake = borderProvinceIds のうち実際に征服される Province
remainingBorderProvinceIds = borderProvinceIds - provincesToTake
```

荒廃適用は以下のように分ける。

```text
provincesToTake:
  development -= warConqueredProvinceDevastation

remainingBorderProvinceIds:
  development -= warBorderProvinceDevastation
```

征服 Province に `warConqueredProvinceDevastation` と `warBorderProvinceDevastation` を二重適用しない。

初期値:

```ts
warBorderProvinceDevastation = 3
```

### 9.2 攻撃側敗北時

攻撃側の国境地域に軽微な荒廃を与える。

```text
攻撃側の隣接国境 Province:
  development -= failedWarBorderDevastation
```

初期値:

```ts
failedWarBorderDevastation = 3
```

### 9.3 注意

v0.4 では War エンティティを導入しない。
戦争は引き続き即時解決であり、荒廃効果も解決時に即時適用する。

---

## 10. 反乱による荒廃

RebellionSystem は、反乱結果に応じて Province.development を下げる。

荒廃対象は、反乱開始時点でスナップショットする。

```ts
const rebelProvinceIds = [...rebelHouse.provinceIds]
```

以後、反乱成功・失敗によって House / Province / Country の帰属が変化しても、荒廃処理にはこの `rebelProvinceIds` を使う。
これにより、`createCountryFromHouse` や `changeRulerHouse` の実行順に依存せず、「反乱が発生した地域」に一貫して荒廃を適用できる。

### 10.1 反乱開始時

反乱家の領地に軽微な荒廃を与える。

`REBELLION_STARTED` イベント生成直後、勝敗判定前に適用する。

```text
rebelProvinceIds:
  development -= rebellionStartedDevastation
```

初期値:

```ts
rebellionStartedDevastation = 2
```

### 10.2 反乱成功時

反乱家の領地に追加の荒廃を与える。

対象は反乱開始時点で確定した `rebelProvinceIds` とする。

```text
rebelProvinceIds:
  development -= rebellionSucceededDevastation
```

初期値:

```ts
rebellionSucceededDevastation = 3
```

### 10.3 反乱失敗時

反乱家の領地にやや大きな荒廃を与える。

対象は反乱開始時点で確定した `rebelProvinceIds` とする。

```text
rebelProvinceIds:
  development -= rebellionFailedDevastation
```

初期値:

```ts
rebellionFailedDevastation = 5
```

理由:

* 反乱失敗時は鎮圧・処罰・没収・混乱を表現する
* 成功時よりも失敗時の方が領地に傷跡が残りやすい

---

## 11. 災害による development 変化

DisasterSystem は unrest や stability だけでなく、development にも影響する。

### 11.1 凶作 FAMINE

対象国の全 Province:

```text
unrest += 10
development -= famineDevastation
```

初期値:

```ts
famineDevastation = 5
```

救済成功時:

```text
unrest -= 5
development += famineReliefDevelopmentRecovery
```

初期値:

```ts
famineReliefDevelopmentRecovery = 2
```

実装上は、既存の DisasterSystem と同様に、救済成否を先に判定したうえで最終差分を直接適用してもよい。

例:

```text
救済なし:
  unrest += 10
  development -= 5

救済成功:
  unrest += 5
  development -= 3
```

イベントとしては `FAMINE` と `DISASTER_RELIEF_FUNDED` / `DISASTER_RELIEF_FAILED` を引き続き発生させる。

### 11.2 疫病 PLAGUE

対象国の全 Province:

```text
development -= plagueDevastation
```

初期値:

```ts
plagueDevastation = 8
```

疫病は人物死亡と国家安定度低下に加えて、土地の活動停滞・労働力喪失を development 低下として表現する。

### 11.3 豊作 BOUNTIFUL_HARVEST

対象国の全 Province:

```text
unrest -= 5
development += bountifulHarvestDevelopmentGain
```

初期値:

```ts
bountifulHarvestDevelopmentGain = 3
```

豊作による development 上昇は小さめにする。
これは永続的な開発ではなく、短期的な土地状態の改善である。

---

## 12. PublicSpendingSystem の変更

### 12.1 現状

v0.3 では、国家が毎年1月に記念碑建設または施しを選ぶ。

* 記念碑建設: legitimacy 上昇、rulerHouse.prestige 上昇
* 施し: stability 上昇、各 Province の unrest 低下

### 12.2 v0.4 方針

「施し」を「土地開発」に置き換える。

```text
ALMS_DISTRIBUTED
↓
COUNTRY_LAND_DEVELOPED
```

国家は引き続き以下を比較する。

```text
記念碑建設 vs 土地開発
```

この変更に伴い、既存実装内の名称も置き換える。

```text
almsScore
↓
landDevelopmentScore

almsBaseCost
↓
countryLandDevelopmentBaseCost

ALMS_DISTRIBUTED
↓
COUNTRY_LAND_DEVELOPED
```

`almsBaseCost` の参照が残ると config 参照漏れになるため、スコア計算・費用判定・イベント生成・UI 表示の名称をまとめて更新する。

### 12.3 記念碑建設

v0.4 では記念碑建設の基本仕様は維持する。

```text
treasury -= monumentBaseCost
country.legitimacy += 10
rulerHouse.prestige += 5
```

発生イベント:

```text
MONUMENT_BUILT
```

記念碑は v0.4 ではエンティティ化しない。

将来的には以下の拡張候補がある。

* どの Province に建てるか
* 存在することで継続効果を持つ
* 戦争・反乱・災害で破壊される
* 略奪される
* 種類を持つ
* 支配家・宗教・文化・国家理念と結びつく

ただし、v0.4 では非スコープとする。

### 12.4 国家の土地開発

国家が treasury を使って Province を開発する。

```text
treasury -= countryLandDevelopmentBaseCost
targetProvince.development += countryLandDevelopmentGain
```

初期値:

```ts
countryLandDevelopmentBaseCost = 70
countryLandDevelopmentGain = 8
```

発生イベント:

```text
COUNTRY_LAND_DEVELOPED
```

### 12.5 土地開発対象選択

国家の土地開発は名目上は国家事業である。
ただし、意思決定は支配家および役職者によって行われるため、対象 Province の選択には支配家領への偏りを持たせる。

これは、国家の利益と支配家の利益が完全には一致しないことを表現するためである。

対象 Province スコア例:

```text
countryLandDevelopmentTargetScore =
  recoveryBonus
  + highValueBonus
  + rulerHouseProvinceBonus
  - unrestPenalty
```

詳細:

```text
recoveryBonus = max(0, -development) × 1.0
highValueBonus = baseTax × 4 + manpower × 2
rulerHouseProvinceBonus = ownerHouseId === country.rulerHouseId ? 15 : 0
unrestPenalty = unrest × 0.4
```

このスコアにより、国家は以下を優先しやすい。

* 荒廃した重要地の復興
* 税収の高い土地
* 兵力の高い土地
* 支配家領

一方、unrest が高すぎる土地はやや避ける。

### 12.6 将来拡張用の関数シグネチャ

将来的に Person に帰属意識を導入することを見据え、土地開発対象選択関数は decisionMakerId を受け取れる形にしてもよい。

```ts
function selectCountryLandDevelopmentTarget(
  state: WorldState,
  countryId: CountryId,
  decisionMakerId?: PersonId,
): ProvinceId | null
```

v0.4 では `decisionMakerId` を使わず、固定スコアでよい。

---

## 13. HouseDevelopmentSystem

### 13.1 目的

HouseDevelopmentSystem は、家が自分の wealth を使って自領 Province を開発する仕組みである。

現状、House.wealth は主に軍事力計算にしか使われていない。
v0.4 では wealth に「領地経営・投資」の意味を追加する。

### 13.2 基本方針

家は土地開発のみを行う。
記念碑建設は行わない。

理由:

* 現状、legitimacy は Country にしか存在しない
* House に正当性がないため、家の記念碑建設はゲーム上の効果が曖昧
* v0.4 では House legitimacy / dynastic legitimacy は導入しない

将来的に家の正当性を導入した場合、家の記念碑・霊廟・祖先顕彰・城館整備などを追加できる。

### 13.3 実行タイミング

毎年1月に実行する。

条件:

```ts
house.active === true
house.provinceIds.length > 0
house.wealth >= houseLandDevelopmentBaseCost + houseWealthReserve
```

初期値:

```ts
houseLandDevelopmentBaseCost = 40
houseLandDevelopmentGain = 6
houseWealthReserve = 50
houseDevelopmentYearlyChance = 0.25
```

### 13.4 実行確率

家ごとに年次で確率判定を行う。

基本形:

```text
chance = houseDevelopmentYearlyChance
```

wealth が豊富な家ほど実行しやすくする場合:

```text
chance =
  houseDevelopmentYearlyChance
  + clamp((house.wealth - houseLandDevelopmentBaseCost - houseWealthReserve) / 300, 0, 0.25)
```

v0.4 ではまずこの程度の簡易式でよい。

### 13.5 投資対象選択

家は自領 Province のみを対象にする。

```ts
function selectHouseLandDevelopmentTarget(
  state: WorldState,
  houseId: HouseId,
): ProvinceId | null
```

対象 Province スコア例:

```text
houseLandDevelopmentTargetScore =
  recoveryBonus
  + developmentPotentialBonus
  + highValueBonus
  - unrestPenalty
```

詳細:

```text
recoveryBonus = max(0, -development) × 1.0
developmentPotentialBonus = (100 - max(0, development)) × 0.3
highValueBonus = baseTax × 4 + manpower × 2
unrestPenalty = unrest × 0.4
```

このスコアにより、家は以下を優先しやすい。

* 荒廃した自領の復興
* 税収の高い自領
* 兵力の高い自領
* まだ発展余地のある自領

### 13.6 効果

```text
house.wealth -= houseLandDevelopmentBaseCost
targetProvince.development += houseLandDevelopmentGain
```

ただし、development が高いほど効果を下げる。

```ts
effectiveGain =
  houseLandDevelopmentGain
  * (1 - Math.max(0, targetProvince.development) / 100)
```

荒廃地への投資は効果が落ちない。
発展済みの土地への追加投資は効果が小さくなる。

発生イベント:

```text
HOUSE_LAND_DEVELOPED
```

importance:

```text
normal
```

ただし、development が大きくマイナスの Province を復興した場合や、非常に有力な House が投資した場合は `major` にしてもよい。

---

## 14. EventType 追加・変更

### 14.1 追加候補

```ts
type EventType =
  | 'COUNTRY_LAND_DEVELOPED'
  | 'HOUSE_LAND_DEVELOPED'
```

### 14.2 既存イベントの扱い

v0.3 の `ALMS_DISTRIBUTED` は v0.4 では廃止または非推奨にする。

推奨:

```text
ALMS_DISTRIBUTED を削除し、COUNTRY_LAND_DEVELOPED に置き換える
```

ただし、互換性を重視するなら残してもよい。
プロトタイプ段階では破壊的変更を許容するため、削除でよい。

### 14.3 イベント例: COUNTRY_LAND_DEVELOPED

```json
{
  "type": "COUNTRY_LAND_DEVELOPED",
  "importance": "normal",
  "summary": "エルディア王国は北ヴァルケン州の土地開発を行った。",
  "countryIds": ["country_eldia"],
  "houseIds": ["house_ruler"],
  "provinceIds": ["province_north_valken"],
  "reasons": [
    { "label": "荒廃した重要地の復興", "value": -32, "contribution": 32 },
    { "label": "税収価値が高い", "value": 9, "contribution": 36 },
    { "label": "支配家領", "contribution": 15 }
  ],
  "effects": [
    { "label": "国庫を消費", "value": -70 },
    { "label": "発展度が上昇", "value": 8 }
  ]
}
```

### 14.4 イベント例: HOUSE_LAND_DEVELOPED

```json
{
  "type": "HOUSE_LAND_DEVELOPED",
  "importance": "normal",
  "summary": "ヴァルケン家は自領の北ヴァルケン州を開発した。",
  "houseIds": ["house_valken"],
  "countryIds": ["country_eldia"],
  "provinceIds": ["province_north_valken"],
  "reasons": [
    { "label": "自領の荒廃復興", "value": -18, "contribution": 18 },
    { "label": "高い税収価値", "value": 8, "contribution": 32 }
  ],
  "effects": [
    { "label": "家の wealth を消費", "value": -40 },
    { "label": "発展度が上昇", "value": 6 }
  ]
}
```

---

## 15. SimulationConfig 追加項目

以下を SimulationConfig に追加する。

```ts
type SimulationConfig = {
  // development
  developmentPositiveMonthlyDecay: number
  developmentNegativeMonthlyRecovery: number

  // development effect
  minDevelopmentMultiplier: number
  maxDevelopmentMultiplier: number

  // war devastation
  warConqueredProvinceDevastation: number
  warBorderProvinceDevastation: number
  failedWarBorderDevastation: number

  // rebellion devastation
  rebellionStartedDevastation: number
  rebellionSucceededDevastation: number
  rebellionFailedDevastation: number

  // disaster development effects
  famineDevastation: number
  famineReliefDevelopmentRecovery: number
  plagueDevastation: number
  bountifulHarvestDevelopmentGain: number

  // country land development
  countryLandDevelopmentBaseCost: number
  countryLandDevelopmentGain: number

  // house land development
  houseDevelopmentEnabled: boolean
  houseDevelopmentYearlyChance: number
  houseLandDevelopmentBaseCost: number
  houseLandDevelopmentGain: number
  houseWealthReserve: number
}
```

初期値:

```ts
const defaultConfig = {
  developmentPositiveMonthlyDecay: 0.1,
  developmentNegativeMonthlyRecovery: 0.25,

  minDevelopmentMultiplier: 0,
  maxDevelopmentMultiplier: 2,

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
```

既存の `almsBaseCost` は削除または `countryLandDevelopmentBaseCost` に置き換える。

---

## 16. UI 変更

### 16.1 Province 詳細

Province 詳細に以下を追加する。

* development
* development 状態ラベル
* 税収倍率
* 兵力倍率
* effectiveTax
* effectiveManpower

状態ラベル例:

```text
-100 .. -50: 荒廃
 -49 .. -10: 衰退
  -9 ..  +9: 通常
 +10 .. +49: 発展
 +50 ..+100: 繁栄
```

### 16.2 Map 表示

Map 上で development を視覚化する。

候補:

* Province ノードに development ラベルを表示
* 荒廃地にアイコンを表示
* 発展地にアイコンを表示
* tooltip に development / effectiveTax / effectiveManpower を表示

v0.4 では最低限、Province 詳細に表示できればよい。
Map での色分けは余裕があれば実装する。

### 16.3 House 詳細

House 詳細に以下を追加する。

* 平均 development
* 最も荒廃した自領
* 最も発展した自領
* 最近の HOUSE_LAND_DEVELOPED イベント

### 16.4 Country 詳細

Country 詳細に以下を追加する。

* 平均 development
* 荒廃 Province 数
* 発展 Province 数
* 最近の COUNTRY_LAND_DEVELOPED イベント

---

## 17. IntegritySystem 変更

IntegritySystem に以下を追加する。

* Province.development が `-100 .. 100` に収まっている
* effectiveTax が 0 未満にならない
* effectiveManpower が 0 未満にならない
* active House が存在しない Province を development 対象にしていない
* inactive House が HouseDevelopmentSystem で開発を行わない
* inactive Country が PublicSpendingSystem で開発を行わない

---

## 18. テスト方針

### 18.1 selector テスト

* development = -100 のとき multiplier = 0
* development = 0 のとき multiplier = 1
* development = 100 のとき multiplier = 2
* unrest と development を反映した effectiveTax が正しく計算される
* unrest と development を反映した effectiveManpower が正しく計算される

### 18.2 DevelopmentSystem テスト

* 正の development が毎月 0 に近付く
* 負の development が毎月 0 に近付く
* 0 を跨いで反対側に行かない
* clamp 範囲を超えない

### 18.3 EconomySystem テスト

* development により税収が増減する
* development = -100 で税収が 0 になる
* development = 100 で税収が 2 倍になる

### 18.4 MilitarySelectors テスト

* development により houseMilitaryPower が増減する
* development = -100 の Province は manpower 出力を持たない
* unrest が manpower に過剰に効きすぎない

### 18.5 War / Rebellion / Disaster テスト

* 戦争勝利時に征服 Province が荒廃する
* 反乱開始・成功・失敗で対象 Province が荒廃する
* 凶作・疫病で development が下がる
* 豊作で development が上がる

### 18.6 PublicSpending / HouseDevelopment テスト

* 国家が土地開発を行うと treasury が減り Province.development が上がる
* 家が土地開発を行うと wealth が減り Province.development が上がる
* 家は自領以外を開発しない
* wealth reserve を下回る場合は家が開発しない
* inactive House は開発しない
* inactive Country は開発しない

### 18.7 決定性テスト

* 同一 seed で同一 tick 数を進めた場合、development の変化とイベント列が一致する
* HouseDevelopmentSystem の対象選択順は ID ソートにより安定する
* `Math.random()` は使用しない

---

## 19. 実装順序

推奨実装順序:

```text
1. Province.development を追加
2. worldgen で development 初期値 randomInt(-10, 10) を設定
3. clamp / selector を追加し、selector テストも同時に追加
   - getProvinceDevelopmentMultiplier
   - getEffectiveProvinceTax
   - getEffectiveProvinceManpower
4. EconomySystem を development 対応
5. militarySelectors を development 対応
6. DevelopmentSystem を追加
7. tick 順序に DevelopmentSystem を追加
8. WarSystem に荒廃効果を追加
9. RebellionSystem に荒廃効果を追加
10. DisasterSystem に development 効果を追加
11. PublicSpendingSystem の ALMS を COUNTRY_LAND_DEVELOPED に置き換え
12. HouseDevelopmentSystem を追加
13. SimulationConfig を拡張
14. EventType を拡張
15. UI に development 表示を追加
16. IntegritySystem を拡張
17. system / UI / integration テストを追加
18. 50年 / 100年 / 200年実行でバランス確認
```

---

## 20. バランス上の注意点

### 20.1 自己強化ループ

wealth の高い家が土地開発を行い、税収が増え、さらに wealth が増える自己強化ループが発生する。

これは歴史シミュレーションとして自然だが、強すぎると有力家が雪だるま式に強くなりすぎる。

対策:

* development が高いほど開発効果を減衰させる
* houseWealthReserve を設ける
* houseDevelopmentYearlyChance を低めにする
* 開発費用を調整可能にする

### 20.2 荒廃の累積

戦争・反乱・災害が頻発すると、世界全体が荒廃しすぎる可能性がある。

対策:

* negative recovery を positive decay より大きくする
* 災害救済で development を少し回復させる
* 荒廃値の下限 clamp を厳守する
* 戦争・反乱の荒廃値を控えめにする

### 20.3 イベントログ増加

家ごとの土地開発イベントが多すぎる可能性がある。

対策:

* HouseDevelopmentSystem は年次処理にする
* yearlyChance を設ける
* HOUSE_LAND_DEVELOPED は normal 以下にする
* Chronicle には高 importance のみ載せる

---

## 21. 将来拡張メモ

### 21.1 POP への接続

将来的に POP を導入した場合、development は Province 全体の抽象的状態値から、POP・施設・産業・都市化などの派生値へ移行する可能性がある。

例:

```text
Province.development
↓
Province の都市化、農地整備、人口密度、インフラ、治安、施設などから導出
```

v0.4 では保存値として持つ。

### 21.2 記念碑システム

将来的には記念碑をエンティティ化できる。

候補:

```ts
type Monument = {
  id: MonumentId
  provinceId: ProvinceId
  countryId: CountryId
  builderHouseId: HouseId
  type: MonumentType
  prestigeEffect: number
  legitimacyEffect: number
  damaged: boolean
}
```

v0.4 では非スコープ。

### 21.3 家の正統性

将来的に House に正統性・請求権・家門権威を持たせる場合、家による記念碑建設が意味を持つ。

候補:

```ts
type House = {
  dynasticLegitimacy: number
  claimStrength: number
  localAuthority: number
}
```

v0.4 では非スコープ。

### 21.4 個人の帰属意識

将来的に Person に帰属意識を持たせる。

候補:

```ts
type Person = {
  identity: {
    country: number
    house: number
    self: number
  }
}
```

または合計 1.0 に正規化する。

```text
countryIdentity + houseIdentity + selfInterest = 1.0
```

これにより、国家事業・任命・戦争・陰謀・土地開発の意思決定に個性を出せる。

v0.4 では、国家の土地開発対象選択に固定の支配家バイアスを入れるだけに留める。

---

## 22. コーディングエージェント向け要約

v0.4 では、本格 POP ではなく Province の発展・荒廃システムを導入する。

主な変更:

* `Province.development: number // -100 .. 100` を追加する
* worldgen 初期値は `randomInt(-10, 10)` とする
* development は税収・兵力に 0% .. 200% の倍率として効く
* development は毎月 0 に近付く
* 戦争・反乱・災害で development が下がる
* 戦争勝利時、征服 Province と征服されなかった防衛側国境 Province を分けて荒廃させる
* 反乱では開始時点の rebelProvinceIds をスナップショットして荒廃対象にする
* 豊作・災害救済・土地開発で development が上がる
* `ALMS_DISTRIBUTED` は廃止し、国家の土地開発 `COUNTRY_LAND_DEVELOPED` に置き換える
* 国家は treasury を使って記念碑建設または土地開発を行う
* 国家の土地開発対象は支配家領にやや偏る
* 家は wealth を使って自領 Province を開発する
* 家は記念碑建設を行わない
* `HOUSE_LAND_DEVELOPED` を追加する
* `House.wealth` に軍事力以外の用途を与える
* UI に development / effectiveTax / effectiveManpower を表示する
* 本格 POP、記念碑エンティティ、House legitimacy、個人の帰属意識は v0.4 では実装しない

最重要目的:

```text
土地が傷つき、回復し、発展する。
家が自領を育てる。
戦争・災害・反乱が土地に痕跡を残す。
```

以上。
