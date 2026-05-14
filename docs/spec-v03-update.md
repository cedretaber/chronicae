# Chronicae 技術検証プロトタイプ v0.3 アップデート案

## 1. 目的

v0.2 では、個人・家・国家が自律的に相互作用する基盤が成立し、死亡・継承・任命・陰謀・反乱・国家分裂などが動作することを確認できた。

一方で、長期実行時に以下の課題が見えた。

> 富が蓄積されていく一方で、世界の動きがやや少ない。

v0.3 では、この課題に対し、富を単なる蓄積値ではなく、歴史を動かすための余力・資源・誘惑として扱う。

主な追加テーマは以下である。

1. 戦争・征服による富の消費と国境変動
2. 災害による富の強制的消費と社会不安
3. 記念碑・祝祭・施しなどの公共支出
4. 国家にとっての最適解ではなく、人物・家・役職者の利害に基づく意思決定

v0.3 の目的は、本格的な戦争ゲームや経済ゲームを作ることではない。

> 富が歴史的変化を生み出す媒介として機能するかを検証する。

---

## 2. 設計方針

### 2.1 歴史鑑賞シミュレーションとしての前提

Chronicae は、プレイヤーが国家を直接操作して最適解を探すゲームではない。

プレイヤーは基本的に観察者であり、世界内の国家・家・人物が、自分たちの視野・性格・利害に基づいて行動する様子を鑑賞する。

したがって、v0.3 で追加する富の消費行動は、プレイヤー向けの操作ボタンではなく、ゲーム内エンティティの自律的意思決定として発生する。

重要なのは、以下である。

> 国家にとって明らかに最適な行動があっても、実際にそれを選ぶとは限らない。

人物個人、所属家、支配家、国家、民衆、有力家、役職者の利害は一致しない。

そのため、国家全体には悪影響でも、支配者個人や支配家には利益がある行動が取られることがある。

これは歴史鑑賞シミュレーションにおいて重要なダイナミズムである。

---

## 3. v0.3 の中心テーマ

v0.3 では、富の消費を以下の4系統に分ける。

```text
戦争
  富を領土・威信・危険に変換する。

災害
  富を強制的に消費させ、足りなければ不安定化する。

記念碑・儀礼・祝祭
  富を正統性・支配家威信・個人名声に変換する。
  ただし、浪費として反発を招く場合がある。

施し・救済・公共支出
  富を安定度・低 unrest に変換する。
  ただし、財政的には消耗であり、有力家や財務担当者の反発を招く場合がある。
```

これにより、treasury と wealth は単なる増加する数値ではなく、国家や家が危機を乗り切るための余力になる。

---

## 4. 戦争・征服システム

### 4.1 基本方針

v0.3 では、まだ本格的な War エンティティは導入しない。

国家間の戦争は、まず即時解決型の征服・国境紛争として実装する。

```text
宣戦
→ 戦力比較
→ 勝敗判定
→ プロヴィンス移転
→ treasury / wealth / stability / legitimacy 変動
→ イベント発行
```

この段階では、補給、戦線、軍隊ユニット、包囲、講和交渉は扱わない。

将来的に本格的な War エンティティへ移行できるよう、処理は `warSystem.ts` または `conquestSystem.ts` に分離する。

### 4.2 位置づけ

このシステムは、厳密には「本格戦争システム」ではなく、以下に近い。

```text
ConquestSystem / BorderConflictSystem
```

目的は、国境変動、富の消費、正統性・安定度への衝撃を発生させることである。

### 4.3 戦争発生条件

戦争発生は、国家そのものの抽象的な拡張欲ではなく、人物・役職者・支配家の性格に寄せる。

主な要因例：

```text
- general の martial が高い
- ruler または rulerHouse の prestige が高い
- ruler の ambition が高い
- 隣接国が弱い
- attacker の treasury に余裕がある
- attacker の legitimacy が高い
- 直近で戦争していない
```

推奨方針：

> 好戦的な将軍、有力な支配家、野心的な ruler が戦争を起こす。

### 4.4 戦争頻度制御

世界がすぐに一国化することを避けるため、頻度制御を入れる。

SimulationConfig に追加候補：

```ts
type SimulationConfig = {
  warEnabled: boolean
  warCostPerProvince: number
  maxProvincesPerWar: number
  maxWarsPerTick: number
  warCooldownMonths: number
  minAttackerWinChanceToDeclare: number
}
```

初期値案：

```ts
warEnabled: true
warCostPerProvince: 20
maxProvincesPerWar: 3
maxWarsPerTick: 1
warCooldownMonths: 24
minAttackerWinChanceToDeclare: 0.45
```

### 4.5 軍事力計算

反乱システムと共通化する。

```text
countryMilitaryPower =
  sum(houseMilitaryPower(activeHouse))
  + country.adminPower * 0.3
```

```text
houseMilitaryPower =
  sum(ownedProvince.manpower)
  + house.wealth / 20
  + bestMartialInHouse * 2
  + assignedGeneralBonus
```

`rebellionSystem` と `warSystem` の両方から使える selector に切り出す。

候補：

```text
src/sim/selectors/militarySelectors.ts
```

### 4.6 戦争解決

```text
attackerPower = countryMilitaryPower(attacker)
defenderPower = countryMilitaryPower(defender)

attackerWinChance = attackerPower / (attackerPower + defenderPower)
attackerWins = randomFloat() < attackerWinChance
```

乱数処理は必ず seed 付き RNG を使う。

### 4.7 戦費

宣戦時に攻撃側は treasury を消費する。

```text
warCost = defenderBorderProvinceCount * warCostPerProvince
```

また、防衛側も敗戦時に損害を受ける。

```text
敗戦側:
  treasury 減少
  stability 低下
  legitimacy 低下

勝利側:
  treasury 軽度減少
  legitimacy または rulerHouse.prestige 上昇
```

### 4.8 征服結果

攻撃側勝利時：

```text
- 防衛側の国境プロヴィンスを 1〜maxProvincesPerWar 枚取得
- 取得プロヴィンスは攻撃側 rulerHouse に移転
- transferProvinceToHouse を使用する
- 防衛側の treasury / stability / legitimacy 低下
- 攻撃側 rulerHouse の prestige 上昇
```

攻撃側敗北時：

```text
- 攻撃側 treasury / stability / legitimacy 低下
- 防衛側 legitimacy 上昇
- 防衛側 rulerHouse prestige 上昇
```

### 4.9 国家消滅

防衛側の active province が 0 になった場合、国家は消滅する。

プロトタイプ段階では Country を records から物理削除しない。

`Country.active` フラグを追加する。

```ts
type Country = {
  id: CountryId
  name: string
  active: boolean
  // ...
}
```

消滅時：

```text
- country.active = false
- 残存 House を勝利国へ移籍させる
- moveHouseToCountry を使用する
- COUNTRY_ANNEXED イベントを発行する
```

通常 selector / UI では inactive country を非表示にしてよい。

イベント履歴や過去参照では表示可能にする。

---

## 5. 災害システム

### 5.1 目的

災害は、富を強制的に消費させる歴史イベントである。

災害そのものよりも重要なのは、災害に対して国家がどの程度対応できるかである。

```text
裕福な国家:
  救済支出により被害を軽減できる。

貧しい国家:
  救済できず、unrest / instability / legitimacy loss が拡大する。
```

### 5.2 災害種別

v0.3 では、まず以下の最小構成でよい。

```ts
type DisasterType =
  | "famine"
  | "plague"
  | "bad_harvest"
```

既存イベント候補：

```text
FAMINE
PLAGUE
BOUNTIFUL_HARVEST
```

追加候補：

```text
DISASTER_RELIEF_FUNDED
DISASTER_RELIEF_FAILED
```

### 5.3 凶作・飢饉

基本効果：

```text
- 対象 province の税収低下
- province.unrest 上昇
- country.stability 低下
```

救済支出が行われた場合：

```text
- country.treasury 減少
- unrest 上昇を軽減
- stability 低下を軽減
- country.legitimacy 微増
```

救済できなかった場合：

```text
- unrest 大幅上昇
- stability 低下
- legitimacy 低下
- 反乱傾向上昇
```

### 5.4 疫病

基本効果：

```text
- 人物死亡率の一時上昇
- province.unrest 上昇
- country.stability 低下
- economy income 低下
```

v0.3 では、人口モデルがないため、死亡率・税収・安定度への抽象的影響に留める。

### 5.5 豊作

豊作は富の消費ではないが、災害と対になるイベントとして有用である。

```text
- country.treasury 増加
- house.wealth 増加
- province.unrest 低下
- stability 微増
```

ただし、豊作が続くと富の蓄積を助長するため、発生頻度は控えめにする。

---

## 6. 公共支出システム

### 6.1 基本方針

公共支出は、国家が treasury を消費して、正統性・安定度・支配家威信・人物 prestige などを変動させる仕組みである。

ただし、これは国家最適化 AI ではない。

支出は、ruler、rulerHouse、chancellor、treasurer、general などの利害と性格に基づいて発生する。

### 6.2 PublicActionType

```ts
type PublicActionType =
  | "build_monument"
  | "distribute_alms"
  | "hold_festival"
  | "fund_disaster_relief"
  | "raise_extraordinary_tax"
```

v0.3 最小実装では、以下を優先する。

```text
1. build_monument
2. distribute_alms
3. fund_disaster_relief
```

`hold_festival` と `raise_extraordinary_tax` は余裕があれば追加する。

---

## 7. 記念碑建造

### 7.1 目的

記念碑は、富を正統性・支配家威信・支配者個人の名声へ変換する行動である。

### 7.2 効果

基本効果：

```text
country.treasury 減少
country.legitimacy 上昇
rulerHouse.prestige 上昇
ruler.prestige 上昇
```

状況によっては副作用：

```text
treasury が不足気味:
  province.unrest 上昇
  country.stability 低下
  treasurer または有力家が不満

stability が低い:
  民衆に浪費と見なされる可能性
```

### 7.3 意思決定

記念碑建造は、国家にとって合理的かどうかだけでなく、ruler と rulerHouse にとって魅力的かどうかで判断する。

例：

```text
monumentDesire =
  (100 - country.legitimacy) * 0.3
  + ruler.traits.ambition * 30
  + rulerHouse.prestige * 0.1
  + treasurySurplusBonus
  - ruler.traits.caution * 25
  - lowTreasuryPenalty
```

野心的な ruler は、財政的に苦しくても記念碑建造を押し切る場合がある。

### 7.4 イベント

```text
MONUMENT_BUILT
```

イベント reason 例：

```text
- 支配家の威信が高い
- 支配者の野心が高い
- 国家の正統性が低い
- 国庫に余裕があった
- 財務担当者の慎重さを押し切った
```

---

## 8. 民への施し

### 8.1 目的

施しは、富を安定度と低 unrest に変換する行動である。

短期的な社会安定に効くが、長期的な統治力や正統性を大きく改善するものではない。

### 8.2 効果

```text
country.treasury 減少
country.stability 上昇
province.unrest 低下
ruler.prestige 微増
country.legitimacy 微増
```

### 8.3 副作用

```text
treasury が少ない:
  treasurer が反対しやすい
  後続の災害・戦争に弱くなる

有力家の loyalty が低い:
  民衆迎合と見なされる可能性
```

### 8.4 意思決定

```text
almsDesire =
  (100 - country.stability) * 0.4
  + averageProvinceUnrest * 0.5
  + ruler.traits.loyaltyToCountry * 20
  + ruler.traits.caution * 10
  - treasuryShortagePenalty
```

慎重で国家忠誠が高い ruler は、安定維持のために施しを選びやすい。

### 8.5 イベント

```text
ALMS_DISTRIBUTED
```

イベント reason 例：

```text
- 国家の安定度が低かった
- 各地の不穏が高まっていた
- 支配者の国家忠誠が高かった
- 支配者が慎重だった
```

---

## 9. 災害救済

### 9.1 目的

災害救済は、災害による悪化を富で軽減する行動である。

これは平時の任意支出ではなく、災害発生時の対応として処理する。

### 9.2 効果

救済成功：

```text
country.treasury 減少
province.unrest 上昇を軽減
country.stability 低下を軽減
country.legitimacy 微増
ruler.prestige 微増
```

救済失敗：

```text
country.legitimacy 低下
country.stability 低下
province.unrest 上昇
反乱傾向上昇
```

### 9.3 意思決定

```text
reliefDesire =
  disasterSeverity * 0.8
  + ruler.traits.loyaltyToCountry * 20
  + chancellorAdminBonus
  - treasurerFiscalResistance
  - treasuryShortagePenalty
```

災害救済は、災害の深刻度が高ければ基本的に実施されやすい。

ただし、国庫不足や treasurer の強い反対で不十分になることがある。

### 9.4 イベント

```text
DISASTER_RELIEF_FUNDED
DISASTER_RELIEF_FAILED
```

---

## 10. 祝祭

### 10.1 目的

祝祭は、富を短期的な安定と人気に変換する行動である。

### 10.2 効果

```text
country.treasury 減少
country.stability 上昇
ruler.prestige 微増
province.unrest 微減
```

### 10.3 記念碑との差別化

```text
記念碑:
  legitimacy と rulerHouse.prestige に効く。
  高コスト。
  長期的な象徴。

祝祭:
  stability と unrest に効く。
  中コスト。
  短期的な人気取り。
```

v0.3 では優先度は低め。

---

## 11. 臨時徴税

### 11.1 目的

臨時徴税は、富を得る代わりに安定度や unrest を悪化させる行動である。

戦争・記念碑・災害対応のために、国家が無理に資金を集める表現として使える。

### 11.2 効果

```text
country.treasury 増加
province.unrest 上昇
country.stability 低下
country.legitimacy 低下の可能性
```

### 11.3 意思決定

```text
extraTaxDesire =
  urgentNeedForMoney
  + ruler.traits.ambition * 15
  - ruler.traits.caution * 20
  - averageUnrestPenalty
```

高野心・低慎重な ruler は、無理な徴税に踏み切りやすい。

v0.3 では優先度は低めだが、戦争・記念碑・災害救済と連鎖させると非常に面白い。

---

## 12. 役職者の影響

v0.2 には以下の役職が存在する。

```text
chancellor
general
treasurer
```

v0.3 では、公共支出や戦争判断に役職者の影響を加える。

### 12.1 Chancellor

重視するもの：

```text
legitimacy
stability
adminPower
```

影響しやすい行動：

```text
記念碑
施し
災害救済
```

### 12.2 General

重視するもの：

```text
戦争
威信
領土拡大
軍事力
```

影響しやすい行動：

```text
戦争
征服
軍事的威信イベント
```

### 12.3 Treasurer

重視するもの：

```text
treasury
財政余力
浪費回避
```

影響しやすい行動：

```text
記念碑への反対
施しへの反対
災害救済の規模抑制
臨時徴税の提案
```

### 12.4 政権の性格

役職者の組み合わせにより、国家の行動傾向が変化する。

例：

```text
野心的 ruler + 高 martial general
  → 戦争に傾く

慎重な ruler + 高 admin treasurer
  → 支出抑制・安定運営に傾く

正統性の低い ruler + 高 admin chancellor
  → 記念碑・儀礼・施しで正統化を図る
```

---

## 13. 実装候補システム

### 13.1 War / Conquest

候補ファイル：

```text
src/sim/systems/warSystem.ts
src/sim/selectors/militarySelectors.ts
```

### 13.2 DisasterSystem

候補ファイル：

```text
src/sim/systems/disasterSystem.ts
```

役割：

```text
- 凶作・疫病・豊作の発生
- 対象 province / country の選定
- 基本被害の適用
- 災害救済判断の呼び出し
```

### 13.3 PublicSpendingSystem

候補ファイル：

```text
src/sim/systems/publicSpendingSystem.ts
```

役割：

```text
- 記念碑建造判定
- 施し判定
- 祝祭判定
- 臨時徴税判定
```

### 13.4 Fiscal / Wealth Pressure

v0.3 では独立システムにせず、まず EconomySystem 拡張でもよい。

候補：

```text
src/sim/systems/economySystem.ts
```

追加候補：

```text
- 役職者コスト
- 家の維持費
- 陰謀コスト
- 反乱コスト
```

ただし、維持費系はバランス影響が大きいため、戦争・災害・公共支出を先に実装してから導入判断する。

---

## 14. tick 順序案

v0.3 の暫定 tick 順序：

```text
1. 時間を進める
2. 経済処理
3. 災害処理
4. 死亡処理
5. 人物補充処理
6. 継承処理
7. 任命処理
8. 個人の欲求・不満・野心評価
9. 公共支出処理
10. 陰謀処理
11. 戦争・征服処理
12. 反乱処理
13. 安定度・正統性・忠誠の変化
14. 統治力更新
15. 整合性チェック
16. イベント返却
```

検討点：

```text
- 災害処理を公共支出より前に置き、同 tick で救済できるようにするか。
- 戦争を反乱より前に置き、外征の失敗が内部反乱を誘発する形にするか。
- 公共支出を年次処理に限定するか、毎月低確率で判定するか。
```

推奨：

```text
公共支出は毎年1月、または重大イベント発生時のみ判定。
災害救済は災害発生 tick で即時判定。
戦争は毎月判定してよいが maxWarsPerTick と cooldown で制御。
```

---

## 15. SimulationConfig 追加候補

```ts
type SimulationConfig = {
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
  almsBaseCost: number
  festivalBaseCost: number
  publicSpendingYearlyChance: number

  // Optional fiscal pressure
  officerCostPerRole: number
  maintenanceCostPerProvince: number
  basePlotCost: number
  rebellionCostRatio: number
}
```

初期値案：

```ts
warEnabled: true
warCostPerProvince: 20
maxProvincesPerWar: 3
maxWarsPerTick: 1
warCooldownMonths: 24
minAttackerWinChanceToDeclare: 0.45

disasterEnabled: true
famineBaseChancePerYear: 0.08
plagueBaseChancePerYear: 0.03
bountifulHarvestBaseChancePerYear: 0.05
disasterReliefCostPerProvince: 20

publicSpendingEnabled: true
monumentBaseCost: 120
almsBaseCost: 50
festivalBaseCost: 60
publicSpendingYearlyChance: 0.35

officerCostPerRole: 5
maintenanceCostPerProvince: 0.5
basePlotCost: 30
rebellionCostRatio: 0.3
```

注意：

維持費系は v0.3 初期実装では無効または低めから始める。

---

## 16. 新規イベントタイプ候補

### 16.1 戦争・征服

```ts
type EventType =
  | "WAR_DECLARED"
  | "WAR_WON"
  | "WAR_LOST"
  | "PROVINCE_CONQUERED"
  | "COUNTRY_ANNEXED"
```

### 16.2 災害

既存候補：

```ts
type EventType =
  | "FAMINE"
  | "PLAGUE"
  | "BOUNTIFUL_HARVEST"
```

追加候補：

```ts
type EventType =
  | "DISASTER_RELIEF_FUNDED"
  | "DISASTER_RELIEF_FAILED"
```

### 16.3 公共支出

```ts
type EventType =
  | "MONUMENT_BUILT"
  | "ALMS_DISTRIBUTED"
  | "FESTIVAL_HELD"
  | "EXTRAORDINARY_TAX_LEVIED"
```

### 16.4 財政破綻

```ts
type EventType =
  | "HOUSE_BANKRUPT"
  | "COUNTRY_BANKRUPT"
```

---

## 17. イベント reason / effects 方針

v0.3 追加イベントも、v0.2 と同様に reason / effects を持つ。

### 17.1 記念碑イベント例

```json
{
  "type": "MONUMENT_BUILT",
  "importance": "major",
  "summary": "エルディア王国で大記念碑の建造が始まった。",
  "reasons": [
    { "label": "王国の正統性が低下していた", "value": 42, "contribution": 18 },
    { "label": "支配者の野心が高い", "value": 0.82, "contribution": 24 },
    { "label": "支配家が威信を求めていた", "value": 71, "contribution": 12 }
  ],
  "effects": [
    { "label": "国庫が大きく減少", "value": -120 },
    { "label": "王国の正統性が上昇", "value": 8 },
    { "label": "支配家の威信が上昇", "value": 10 }
  ]
}
```

### 17.2 施しイベント例

```json
{
  "type": "ALMS_DISTRIBUTED",
  "importance": "normal",
  "summary": "王国は不穏な地域に施しを行った。",
  "reasons": [
    { "label": "国家の安定度が低かった", "value": 38, "contribution": 20 },
    { "label": "民衆の不穏が高まっていた", "value": 64, "contribution": 18 },
    { "label": "支配者が慎重だった", "value": 0.74, "contribution": 8 }
  ],
  "effects": [
    { "label": "国庫が減少", "value": -50 },
    { "label": "国家の安定度が上昇", "value": 7 },
    { "label": "対象地域の不穏が低下", "value": -10 }
  ]
}
```

---

## 18. 実装ステップ案

### Step 1: Country.active 追加

目的：

```text
国家消滅を安全に扱う。
records から物理削除せず、参照切れを防ぐ。
```

作業：

```text
- Country 型に active を追加
- worldgen で active: true を設定
- selector / UI で inactive country を扱えるようにする
- integritySystem に active country 関連チェックを追加
```

### Step 2: 軍事力 selector 共通化

目的：

```text
rebellionSystem と warSystem で軍事力計算を共通化する。
```

作業：

```text
- militarySelectors.ts 追加
- calculateHouseMilitaryPower
- calculateCountryMilitaryPower
- rebellionSystem を selector 利用に変更
```

### Step 3: 戦争・征服システム最小実装

目的：

```text
国境変動と戦費支出を発生させる。
```

作業：

```text
- warSystem.ts 追加
- 隣接国判定
- 宣戦判定
- 勝敗判定
- プロヴィンス移転
- WAR_DECLARED / WAR_WON / WAR_LOST / PROVINCE_CONQUERED イベント
```

### Step 4: 国家消滅処理

目的：

```text
征服による国家吸収を扱う。
```

作業：

```text
- country.active = false
- moveHouseToCountry による吸収
- COUNTRY_ANNEXED イベント
- UI 表示調整
```

### Step 5: 災害システム

目的：

```text
富を強制的に消費させる危機を作る。
```

作業：

```text
- disasterSystem.ts 追加
- famine / plague / bountiful harvest
- disaster relief 判定
- FAMINE / PLAGUE / BOUNTIFUL_HARVEST / DISASTER_RELIEF_* イベント
```

### Step 6: 公共支出システム

目的：

```text
富を正統性・安定度・威信に変換する自律的行動を作る。
```

作業：

```text
- publicSpendingSystem.ts 追加
- build_monument
- distribute_alms
- 意思決定スコア
- MONUMENT_BUILT / ALMS_DISTRIBUTED イベント
```

### Step 7: コスト系の追加判断

目的：

```text
戦争・災害・公共支出だけで富の蓄積問題が改善しない場合、維持費を追加する。
```

候補：

```text
- officerCostPerRole
- maintenanceCostPerProvince
- basePlotCost
- rebellionCostRatio
```

---

## 19. 未確定論点

以下はコーディングエージェントと相談して固める。

### 19.1 War 型を導入しない方針でよいか

v0.3 では即時解決型にする方針。

ただし、将来 War エンティティへ移行しやすいよう、`warSystem` の境界を明確にする。

### 19.2 戦争頻度

初期値案：

```text
maxWarsPerTick = 1
warCooldownMonths = 24
```

これで足りるか要検証。

### 19.3 国家消滅時の House 吸収

防衛側国家が消滅した場合：

```text
全 House を勝利国へ移すか
一部 House を断絶・亡命扱いにするか
```

v0.3 では全 House 吸収でよい可能性が高い。

### 19.4 公共支出の判定頻度

候補：

```text
毎年1月のみ
重大イベント後のみ
毎月低確率
```

推奨：

```text
毎年1月 + 災害発生時のみ即時救済
```

### 19.5 維持費を v0.3 初期に入れるか

維持費は富の蓄積対策として強力だが、バランスを大きく変える。

推奨：

```text
まず戦争・災害・公共支出を実装。
それでも富が余る場合に維持費を追加。
```

### 19.6 公共支出が強すぎる場合の扱い

プレイヤー操作ゲームではないため、単純な最適化対策よりも、意思決定者の利害分裂を重視する。

```text
国家にとって悪手でも、ruler や rulerHouse にとって得なら実行されうる。
```

この方向で調整する。

---

## 20. v0.3 の成功条件

### 最低成功

```text
- 戦争・征服により国境が変動する
- 戦争により treasury / wealth が消費される
- 国家消滅が安全に処理される
- 災害が発生し、富や安定度に影響する
- 記念碑または施しが自律的に発生する
- それらのイベントに reasons / effects が表示される
- seed 固定で同じ展開が再現できる
```

### 十分成功

```text
- 富裕国が危機対応によって安定する一方、貧しい国は崩れやすい
- 支配者や役職者の性格によって国家の行動傾向が変わる
- 戦争・災害・公共支出が反乱や陰謀と連鎖する
- イベントログを読むと「なぜこの国が動いたか」が分かる
```

### 大成功

```text
- 国家にとって非合理な行動が、人物や家の利害から見ると理解できる
- 富が単なる蓄積値ではなく、歴史を動かす資源として機能する
- 100〜200年の観戦で、繁栄・浪費・災害・戦争・崩壊の流れが見える
```

---

## 21. コーディングエージェントレビュー反映

コーディングエージェントからのレビューでは、v0.3 方針は概ね妥当と評価された。

特に以下の点は採用方針とする。

```text
- War エンティティは導入せず、v0.3 では即時解決型 conquest として実装する。
- warSystem.ts を境界として分離し、将来の War エンティティ化に備える。
- Country.active を追加し、国家は物理削除しない。
- militarySelectors.ts に軍事力計算を切り出す。
- disasterSystem.ts と publicSpendingSystem.ts は economySystem に統合せず、独立ファイルとする。
- 維持費系は初期実装から外し、戦争・災害・公共支出の効果を観測してから導入判断する。
- inactive country は通常 UI / selector では非表示にし、イベント履歴では参照可能にする。
```

---

## 22. disasterSystem と publicSpendingSystem の責務分離

レビューにより、災害救済の扱いについて以下の方針を採用する。

### 22.1 disasterSystem の責務

`disasterSystem.ts` は、災害発生と災害救済判断を一括して担当する。

```text
disasterSystem:
  - famine / plague / bad_harvest / bountiful_harvest の発生判定
  - 対象 country / province の選定
  - 災害の基本被害の適用
  - fund_disaster_relief の即時判断
  - DISASTER_RELIEF_FUNDED / DISASTER_RELIEF_FAILED の発行
```

これにより、災害救済は災害発生 tick 内で完結する。

### 22.2 publicSpendingSystem の責務

`publicSpendingSystem.ts` は、平時または年次の公共支出を担当する。

```text
publicSpendingSystem:
  - build_monument
  - distribute_alms
  - hold_festival
  - raise_extraordinary_tax
```

ただし、v0.3 初期実装では以下を優先する。

```text
1. build_monument
2. distribute_alms
```

`fund_disaster_relief` は PublicActionType の一種として概念上は残せるが、実装上は disasterSystem 内で処理する。

---

## 23. tick 順序の修正版

災害救済を disasterSystem 内で完結させるため、tick 順序は以下で進める。

```text
1. 時間を進める
2. 経済処理
3. 災害処理
   - 災害発生
   - 災害被害
   - 災害救済判断
4. 死亡処理
5. 人物補充処理
6. 継承処理
7. 任命処理
8. 個人の欲求・不満・野心評価
9. 公共支出処理
   - 記念碑
   - 施し
   - 祝祭
   - 臨時徴税
10. 陰謀処理
11. 戦争・征服処理
12. 反乱処理
13. 安定度・正統性・忠誠の変化
14. 統治力更新
15. 整合性チェック
16. イベント返却
```

補足：

```text
- 災害救済は publicSpendingSystem ではなく disasterSystem 内で即時処理する。
- publicSpendingSystem は年次処理を基本とする。
- 戦争は毎月判定してよいが、maxWarsPerTick と cooldown で制御する。
```

---

## 24. 国家消滅時の House 吸収

v0.3 では、国家消滅時の処理は単純化する。

採用方針：

```text
防衛側国家が消滅した場合、残存 House はすべて勝利国に移籍する。
```

理由：

```text
- 実装が単純
- moveHouseToCountry を既存のまま活用できる
- v0.3 の技術検証には十分
- 亡命・断絶・抵抗勢力化は v0.4 以降で扱えばよい
```

処理：

```text
1. defeatedCountry.active = false
2. defeatedCountry.houseIds を走査
3. 各 House に moveHouseToCountry(state, houseId, victorCountryId) を適用
4. defeatedCountry.houseIds = []
5. COUNTRY_ANNEXED イベントを発行
```

注意：

```text
- defeatedCountry の record は残す。
- イベント履歴から消滅国家名を参照できるようにする。
- 通常の active country selector では除外する。
```

---

## 25. warCooldownMonths の管理方法

v0.3 では、戦争 cooldown は Country に保持する。

採用方針：

```ts
type Country = {
  id: CountryId
  name: string
  active: boolean
  lastWarMonth?: number
  // ...
}
```

`lastWarMonth` は、年月そのものではなく、シミュレーション開始からの通算月を表す。

```text
absoluteMonth = currentYear * 12 + currentMonth
```

フィールド名を `lastWarTurn` ではなく `lastWarMonth` とする理由：

```text
- 仕様上の単位が warCooldownMonths である。
- tick 設計では 1 tick = 1か月 だが、Turn という用語はまだ導入していない。
- Month の方が既存の currentYear / currentMonth と整合する。
- 実装者が「ターン」という別概念を想定しにくい。
```

判定例：

```text
currentAbsoluteMonth = state.currentYear * 12 + state.currentMonth
monthsSinceLastWar = currentAbsoluteMonth - country.lastWarMonth
canDeclareWar = monthsSinceLastWar >= config.warCooldownMonths
```

未戦争国家の場合：

```text
lastWarMonth が undefined なら宣戦可能。
```

戦争発生時：

```text
attacker.lastWarMonth = currentAbsoluteMonth
defender.lastWarMonth = currentAbsoluteMonth
```

攻撃側だけでなく防衛側にも cooldown を付けることで、同じ国家が連続して戦争に巻き込まれ続けることを抑制する。

---

## 26. v0.3 開発前に確定すべき事項

現時点で、実装前に残る主要論点は以下である。

```text
1. Country に active と lastWarMonth を追加する方針で確定するか。
2. 国家消滅時は全 House 吸収で確定するか。
3. disaster relief は disasterSystem 内処理で確定するか。
4. PublicSpendingSystem の初期対象を monument / alms のみに絞るか。
5. WarSystem の名称を warSystem.ts にするか conquestSystem.ts にするか。
```

現時点の推奨：

```text
1. 確定: Country.active と Country.lastWarMonth を追加
2. 確定: 国家消滅時は全 House 吸収
3. 確定: 災害救済は disasterSystem 内で即時処理
4. 確定: 初期公共支出は monument / alms のみ
5. warSystem.ts として実装。ただし仕様上は即時解決型 conquest と明記する
```

---

## 27. v0.3 シミュレーション層実装完了後の UI 対応

シミュレーション層（warSystem / disasterSystem / publicSpendingSystem）の実装完了に伴い、フロントエンドに以下の対応が必要である。

### 27.1 現状の UI コード確認結果

`prototype/src/app/` 配下の各コンポーネントを確認した結果、以下の未対応箇所が判明した。

| ファイル | 問題 |
|---|---|
| `Sidebar.tsx` Countries タブ | `country.active` フィルタなし。滅亡国家が一覧に表示され続ける |
| `ConfigPanel.tsx` | v0.3 追加の config フィールドが操作 UI に存在しない |
| `DetailPanel.tsx` CountryDetail | `country.active` を表示しない。滅亡国家を選択しても状態が分からない |

`EventLog.tsx` は `importance` ベースの色分けで動作し、新しいイベントタイプを追加しても表示上の問題はない（機能的には十分）。

### 27.2 Sidebar — inactive country の非表示

Countries タブで `active: false` の国家を一覧から除外する。

```typescript
// 変更前
const sortedCountries: Country[] = countries
  ? Object.values(countries).sort((a, b) => b.legitimacy - a.legitimacy)
  : []

// 変更後
const sortedCountries: Country[] = countries
  ? Object.values(countries)
      .filter((c) => c.active)
      .sort((a, b) => b.legitimacy - a.legitimacy)
  : []
```

イベント履歴からは滅亡国家名を参照できるため、一覧からの除外のみでよい。

### 27.3 ConfigPanel — v0.3 config フィールドの追加

以下の ON/OFF トグルとスライダーを ConfigPanel に追加する。

```text
[ON/OFF トグル]
- War Enabled        (config.warEnabled)
- Disaster Enabled   (config.disasterEnabled)
- Public Spending Enabled  (config.publicSpendingEnabled)

[スライダー]
- War Cooldown       (config.warCooldownMonths, 範囲: 6〜60, step: 6)
- Max Wars/Tick      (config.maxWarsPerTick, 範囲: 1〜5, step: 1)
- Famine Chance/Year (config.famineBaseChancePerYear, 範囲: 0〜0.3, step: 0.01)
- Monument Cost      (config.monumentBaseCost, 範囲: 50〜300, step: 10)
- Alms Cost          (config.almsBaseCost, 範囲: 20〜150, step: 5)
```

ON/OFF トグルは checkbox または styled button で実装する。ConfigPanel は既存の `ConfigRow` コンポーネントパターンに沿って実装する。

### 27.4 DetailPanel — CountryDetail の active 状態表示

CountryDetail に `active` フィールドを表示し、滅亡国家であることを視覚的に示す。

```text
- active: false の場合、国家名の横に「[滅亡]」または「[Annexed]」ラベルを表示する
- active: false の場合、ステータス数値の背景をグレーアウトするなど、無効状態を示す
```

実装例：

```tsx
<div className="flex items-center justify-between">
  <span className="text-lg font-bold">{country.name}</span>
  {!country.active && (
    <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-400">Annexed</span>
  )}
  <WatchButton ... />
</div>
```

### 27.5 実装優先度

```text
優先度 高:
  1. Sidebar — inactive country フィルタ（必須: 滅亡国が一覧に残ると混乱を招く）
  2. ConfigPanel — warEnabled / disasterEnabled / publicSpendingEnabled トグル
     （必須: v0.3 の機能を ON/OFF できないと観戦検証ができない）

優先度 中:
  3. DetailPanel — CountryDetail の active 表示
     （推奨: 滅亡国を選択したとき状態が分かるとよい）
  4. ConfigPanel — warCooldownMonths / famineBaseChancePerYear 等のスライダー
     （推奨: 検証効率が上がる）

優先度 低:
  5. EventLog — WAR / DISASTER / PUBLIC_SPENDING カテゴリ別の色分け
     （任意: importance ベースで十分機能するが、可読性は上がる）
```
