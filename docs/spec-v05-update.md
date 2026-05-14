# Chronicae Prototype v0.5 仕様案：支配力・首都/本拠地・領主交代

## 1. v0.5 の目的

v0.5 では、Province の名目所有と実効支配を分離する。

これまでの構造では、Province は Country と House によって所有されているが、統治の濃淡が表現されていない。そのため、遠隔地・飛び地・征服直後の土地・弱体化した領主領などが、通常の領地と同じように収入を生む。

v0.5 では、以下を導入する。

* Country の首都
* House の本拠地
* Province ごとの国家支配力 `countryControl`
* Province ごとの家支配力 `houseControl`
* 支配力に基づく収入按分と収入ロス
* 接続していない領地の支配力減衰
* 記念碑建設の Province 指定化
* 土地開発による家支配力上昇
* 隣接する強力な領主による領主交代
* 併合時に旧支配者家以外の在地領主を保持する処理

このバージョンの主眼は、単純な領土拡大だけでなく、統治能力・在地支配・国内領主勢力の変化を発生させることである。

---

## 2. 基本概念

### 2.1 名目所有と実効支配

Province は、以下の2種類の所有情報を持つ。

* `countryId`

  * その Province が属する Country
  * 国家・王権・中央政府の名目支配

* `ownerHouseId`

  * その Province の領主 House
  * 在地領主・封臣・地方権力の名目支配

v0.5 では、これに加えて実効支配を持つ。

* `countryControl`

  * 0〜100
  * 国家による実効支配力

* `houseControl`

  * 0〜100
  * 領主 House による実効支配力

名目上の所有者であっても、支配力が低ければ収入は十分に得られない。

`countryControl` / `houseControl` が 0 になっても、名目所有は変わらない。`ownerHouseId` が変わるのは LordshipTransitionSystem などの明示的な領主交代処理のみである。

---

## 3. データ構造

### 3.1 Province

Province に以下を追加する。

```ts
countryControl: number // 0..100
houseControl: number   // 0..100
```

既存の開発度 `development` は維持する。v0.5 では、土地開発と家支配力の関係に利用する。

### 3.2 Country

Country に首都を追加する。

```ts
capitalProvinceId: ProvinceId
```

制約：

* `capitalProvinceId` は、その Country に属する Province でなければならない。
* v0.5 では首都移転は扱わない。

### 3.3 House

House に本拠地を追加する。

```ts
seatProvinceId: ProvinceId
```

制約：

* すべての House は必ず `seatProvinceId` を持つ。
* `seatProvinceId` は、その House が所有する Province でなければならない。
* 通常の領主交代では、House は本拠地 Province を失わない。
* House が最後の Province を失う処理は禁止する。
* v0.5 では本拠地移転は実装しない。本拠地 Province は通常の領主交代・隣接吸収の対象外とする。

---

## 4. worldgen での初期化

### 4.1 seatProvinceId の決定

各 House の本拠地は、その House が所有する Province のうち `development` が最も高いものとする。同値の場合は Province ID 昇順で選ぶ。

```text
seatProvinceId = argmax(house.provinceIds, p => p.development)
同値: ID 昇順で最初のもの
```

理由：

* より発展した土地が家の中心地であるという自然な前提を反映する。

### 4.2 capitalProvinceId の決定

各 Country の首都は、支配家（rulerHouse）の `seatProvinceId` とする。

```text
capitalProvinceId = rulerHouse.seatProvinceId
```

理由：

* 支配者家の本拠地が王権・国家の中心である方が自然。
* 首都と支配者家本拠地が一致するため、初期状態の接続判定が安定する。

### 4.3 countryControl / houseControl の初期値

worldgen 時点で、ControlSystem と同じ距離上限計算を使って初期化する。

```text
各 Province に対して:
  countryControl = maxControl(capitalProvinceId からの BFS 距離)
  houseControl   = maxControl(seatProvinceId からの BFS 距離)
```

接続不能な Province（飛び地など）:

```text
countryControl = 30
houseControl = 30
```

これにより、シミュレーション開始直後から支配力の地域差が反映される。

---

## 5. 首都と本拠地

### 5.1 Country の首都

Country の首都は、国家支配力の中心である。

国家支配力の上限は、首都から対象 Province までの距離によって決まる。

### 5.2 House の本拠地

House の本拠地は、家支配力の中心である。

家支配力の上限は、本拠地から対象 Province までの距離によって決まる。

### 5.3 本拠地の保持

House は常に本拠地を保持する。

隣接吸収などの通常の領主交代では、対象 Province が現 ownerHouse の `seatProvinceId` である場合、その Province は吸収対象外とする。

本拠地を失う処理は、将来の戦争・滅亡・特別イベントで扱う。

---

## 6. 接続判定

### 6.1 国家支配力の接続判定

国家支配力は、Country の首都から対象 Province まで、同じ Country に属する Province のみを通って到達できるかで判定する。

```text
首都 → 自国 Province → 自国 Province → 対象 Province
```

到達可能な場合、距離に基づく支配力上限へ近づく。

到達不能な場合、その Province の `countryControl` は毎月減衰する。

### 6.2 家支配力の接続判定

家支配力は、House の本拠地から対象 Province まで、その House が所属する Country の Province を通って到達できるかで判定する。

v0.5 では、House は単一 Country に所属する前提とする。

```text
本拠地 → 同じ Country の Province → 同じ Country の Province → 対象 Province
```

通行経路には、他 House が所有する Province を含めてよい。

理由：

* 同一国内で複数 House の領地がモザイク状に存在するのは自然である。
* 同一 Country の秩序内であれば、他家領を通って使者・代官・収税人が移動できるとみなす。

ただし、`houseControl` の更新対象は、その House が所有する Province に限る。

将来、House が複数 Country に所領を持つ場合は、`HouseCountryRelation` や通行権に基づいて接続判定を拡張する。

---

## 7. 支配力上限

### 7.1 基本式

支配力上限は、首都または本拠地からのグラフ距離に基づいて決める。

```ts
maxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
```

例（`controlMaxDistancePenalty = 10`、`controlMaxMinimum = 40`）：

```text
距離0: 100
距離1: 90
距離2: 80
距離3: 70
距離4: 60
距離5: 50
距離6以上: 40
```

### 7.2 国家支配力上限

`countryControl` の上限は、Country の首都からの距離で決める。

ただし、首都から自国 Province だけを通って到達できない場合、上限計算は行わず、減衰処理を行う。

### 7.3 家支配力上限

`houseControl` の上限は、House の本拠地からの距離で決める。

距離計算では、その House が所属する Country の Province を通行可能とする。

対象 Province 自体は、その House が所有している必要がある。

### 7.4 開発度による補正

v0.5 では、development による家支配力上限への補正は導入しない。

理由：

* `development * 2` の補正はレンジが大きすぎ、支配力を不自然に固定しやすい。
* development の主な役割は収入倍率（v0.4 既存）であり、支配力との二重関与はバランス調整を複雑にする。
* 将来的に必要と判断した場合に追加する。

---

## 8. 月次支配力更新

`ControlSystem` を追加する。

毎月、各 Province について `countryControl` と `houseControl` を更新する。

実装では Country ごとに capitalProvinceId から BFS、House ごとに seatProvinceId から BFS を行い、各 Province への距離を求めてから支配力を更新する。

### 8.1 到達可能な場合

現在値が上限より低い場合、上限へ向けて増加する。

現在値が上限より高い場合、上限へ向けて減少する。

```ts
if (control < maxControl) {
  control = Math.min(control + controlGrowthPerMonth, maxControl)
}

if (control > maxControl) {
  control = Math.max(control - controlDecayPerMonth, maxControl)
}
```

### 8.2 到達不能な場合

接続していない Province の支配力は減衰する。

国家支配力：

* 首都から自国 Province 経由で到達不能な場合、`countryControl` が毎月 `disconnectedControlDecayPerMonth` だけ減衰する（下限 0）。

家支配力：

* 本拠地から所属 Country の Province 経由で到達不能な場合、`houseControl` が毎月 `disconnectedControlDecayPerMonth` だけ減衰する（下限 0）。

---

## 9. 支配力に基づく収入計算

Province の収入は、国家支配力と家支配力に基づいて Country と House に分配する。

このとき、支配力不足による収入ロスが発生する。

v0.4 までの固定比率（house 60% / country 40%）は廃止し、支配力に基づく動的按分に置き換える。したがって EconomySystem は v0.5 で書き換え対象となる。

### 9.1 計算式

`provinceIncome` は `getEffectiveProvinceTax(province)` の返り値を使う。

```ts
const provinceIncome = getEffectiveProvinceTax(province)

const cc = province.countryControl / 100
const hc = province.houseControl / 100
const totalControl = cc + hc

if (totalControl <= 0) {
  return  // 収入なし
}

const countryIncome = provinceIncome * (cc / totalControl) * cc
const houseIncome   = provinceIncome * (hc / totalControl) * hc
```

### 9.2 例

Province 収入を 100 とする。

```text
国家100 / 家100:
  国 50、家 50、ロス 0

国家100 / 家50:
  国 66.7、家 16.7、ロス 16.6

国家50 / 家50:
  国 25、家 25、ロス 50

国家100 / 家0:
  国 100、家 0、ロス 0

国家50 / 家0:
  国 50、家 0、ロス 50
```

支配力が低い主体は、単に取り分が減るだけでなく、収入効率そのものが下がる。

---

## 10. 記念碑建設の変更

### 10.1 現状からの変更

記念碑建設は、単発の抽象イベントではなく、特定 Province を対象にする国家事業へ変更する。

記念碑は、国家権威を可視化し、その Province における国家支配力を高める。

### 10.2 対象 Province の選択

候補条件：

```text
province.countryId === countryId
首都から自国 Province 経由で到達可能
province.countryControl < 100
```

複数候補がある場合、以下のスコアが最も高い Province を選ぶ（同値の場合は ID 昇順）：

```ts
score =
  (100 - province.countryControl) * 1.0   // 支配力不足ほど優先
  + province.development * 0.5             // 開発価値の高い土地を優先
  - province.unrest * 0.5                  // 不穏な土地はやや抑制
```

### 10.3 効果

```text
費用:
  country.treasury -= monumentBaseCost

効果:
  対象 Province の countryControl += monumentCountryControlGain（clamp 0..100）
  country.legitimacy += monumentLegitimacyGain（clamp 0..100）
  rulerHouse.prestige += 2（clamp 0..100）
```

### 10.4 記念碑レベルについて

v0.5 では、記念碑を永続施設として Province に保持する仕組みは入れない。

将来案：

```ts
monumentLevel: number
```

を Province に追加し、国家支配力上限補正や継続的な legitimacy 効果を与える。

---

## 11. 土地開発の変更

Province には既に開発度の仕組みがある。

v0.5 では、v0.4 の development 増加ロジックを維持したまま、土地開発に `houseControl` 上昇と `unrest` 低下を追加する。

### 11.1 効果

```text
国家土地開発（COUNTRY_LAND_DEVELOPED）:
  province.development += countryLandDevelopmentGain（v0.4 既存、clamp -100..100）
  province.houseControl += landDevelopmentHouseControlGain（clamp 0..100）
  province.unrest -= landDevelopmentUnrestReduction（clamp 0..100）

家土地開発（HOUSE_LAND_DEVELOPED）:
  province.development += effectiveGain（v0.4 既存: houseLandDevelopmentGain * (1 - max(0, development) / 100)、clamp -100..100）
  province.houseControl += landDevelopmentHouseControlGain（clamp 0..100）
  province.unrest -= landDevelopmentUnrestReduction（clamp 0..100）
```

土地開発は、領主家による在地経営・市場整備・農地改良・検地・道路整備などを表す。

記念碑建設が国家支配力を高めるのに対し、土地開発は家支配力を高める。

---

## 12. 領主交代システム

`LordshipTransitionSystem` を追加する。

v0.5 では、再封システムは入れない。

低支配力の土地があっても、領地なし House に与える処理は行わない。

領主交代は、隣接する強力な領主による吸収のみで表現する。

### 12.1 隣接吸収

ある Province の家支配力が低く、隣接 Province を支配する別 House の家支配力が十分に高い場合、領主が交代することがある。

### 12.2 判定単位と条件

判定は **Province 単位**で行う。各 Province `target` に対して以下の手順を踏む。

1. `target` の全隣接 Province から条件を満たす `neighbor` 候補を列挙する
2. 候補が存在する場合、最も `houseControl` が高い `neighbor` を採用する（§12.5）
3. その `(target, neighbor)` ペアに対して確率判定を1回行う（§12.4）
4. 判定成功時に領主交代を適用する（§12.3）

`neighbor` 候補の条件：

```text
neighbor.countryId === target.countryId
neighbor.ownerHouseId !== target.ownerHouseId
neighbor.houseControl >= lordshipAbsorptionSourceMinimum（60）
neighbor.houseControl >= target.houseControl * lordshipAbsorptionRatio（2）
```

`target` の条件：

```text
target.houseControl < lordshipAbsorptionTargetThreshold（50）
target は現 ownerHouse の seatProvinceId ではない
```

### 12.3 効果

```text
target.ownerHouseId = neighbor.ownerHouseId
target.houseControl = max(lordshipAbsorptionNewControlMin, min(lordshipAbsorptionNewControlMax, neighbor.houseControl - lordshipAbsorptionNewControlPenalty))
```

これにより、新領主は一定の支配基盤を得るため、即座の再交代は起きにくい。

イベント：`LORDSHIP_TRANSFERRED`（importance: `normal`）

```text
houseIds: [旧 ownerHouseId, 新 ownerHouseId]
provinceIds: [target.id]
summary: "${新House.name} absorbed ${province.name} from ${旧House.name}."
```

### 12.4 確率

```ts
lordshipAbsorptionMonthlyChance = 0.05
```

閾値・確率は、実際に動かしながら調整する。

### 12.5 複数候補

複数の隣接 Province が条件を満たす場合、最も `houseControl` が高い neighbor を採用する。

同値の場合はランダムで選ぶ。

### 12.6 スナップショット判定

同一月内の連鎖吸収を防ぐため、判定は月初状態のスナップショットに基づいて行う。

処理順：

```text
1. 月初の Province 状態をスナップショットする
2. 吸収候補を列挙する（スナップショット基準）
3. 確率判定を行う
4. 最後に ownerHouseId と houseControl をまとめて更新する
```

### 12.7 クールダウンは導入しない

領主交代クールダウンは導入しない。

理由：

* 領主交代後の `houseControl` を閾値以上に設定することで、即時再交代は自然に防げる。
* 領主交代が過度に頻発する場合は、クールダウンではなく、閾値・確率・交代後 `houseControl` の調整によって制御する。
* Chronicae では、できるだけ人工的な禁止期間ではなく、状態量によって安定性を表現する。

---

## 13. 併合時の領地処理

現在の仕組みでは、国が併合されると被征服国の領地が征服国の支配者家に集中しやすい。

v0.5 では、併合時に在地領主層を維持する。

### 13.1 基本方針

```text
国が併合された場合:
  非支配者家は自分の領地を保持する。
  旧支配者家は本拠地以外の領地を失う。
  旧支配者家も本拠地だけは保持する。
```

これにより、併合後も国内の House 構造が残り、一国一家への収束を防ぐ。

### 13.2 annexCountry mutation

併合処理は warSystem 内に直接書かず、mutation 関数 `annexCountry` として切り出す。

`annexCountry(state, defeatedCountryId, winnerCountryId)` の責務：

```text
1. defeatedCountry の全 Province.countryId を winnerCountry に変更する

2. defeatedCountry の全 House.countryId を winnerCountry に変更する

3. defeatedCountry.rulerHouse は seatProvinceId 以外の Province を失う

4. 非 rulerHouse の ownerHouseId は維持する

5. rulerHouse から取り上げた Province は winnerCountry.rulerHouse に割り当てる

6. 全 Province の countryControl を低めに設定する（annexedCountryControl: 35）

7. 非 rulerHouse 領の houseControl は維持する

8. winnerCountry.rulerHouse に新規割当された Province の houseControl を低めに設定する（newRulerHouseControl: 35）
```

### 13.3 本拠地制約

併合処理でも、以下を守る。

```text
House は必ず seatProvinceId を保持する。
seatProvinceId は、その House が所有する Province でなければならない。
```

---

## 14. tick 順序

v0.5 では、支配力更新と領主交代を経済処理の前に行う。

```text
1.  advanceTime
2.  DevelopmentSystem
3.  ControlSystem
4.  LordshipTransitionSystem
5.  EconomySystem
6.  DisasterSystem
7.  MortalitySystem
8.  EmergenceSystem
9.  SuccessionSystem
10. AppointmentSystem
11. AmbitionSystem
12. PublicSpendingSystem
13. HouseDevelopmentSystem
14. PlotSystem
15. WarSystem
16. RebellionSystem
17. StabilitySystem
18. GovernanceSystem
19. IntegrityCheck
```

理由：

* DevelopmentSystem を ControlSystem より前に置くことで、その月の development 変化を後続処理に反映できる。
* ControlSystem で支配力を更新したうえで領主交代を判定する。
* LordshipTransition 後の ownerHouseId と houseControl に基づいて収入を計算する。

---

## 15. IntegrityCheck 追加項目

v0.5 実装後に以下を IntegrityCheck に追加する。

```text
既存:
  1. 死亡人物が役職を持たない
  2. 活動中の家の家長が生存している
  3. House.provinceIds と Province.ownerHouseId の双方向整合性
  4. Province.countryId と ownerHouse.countryId の一致
  5. 生存 Person.countryId と House.countryId の一致
  6. Province.development が -100..100
  7. Country.rulerHouseId が active な House を指している

v0.5 追加:
  8. Country.capitalProvinceId がその Country に属する Province を指している
  9. House.seatProvinceId がその House の provinceIds に含まれている
  10. Province.countryControl が 0..100
  11. Province.houseControl が 0..100
```

---

## 16. UI 表示

v0.5 では、最低限以下を UI に表示する。

Province 表示：

```text
- 所属 Country
- owner House
- development
- countryControl
- houseControl
- countryControl / houseControl に基づく収入見込み
```

Country 表示：

```text
- capitalProvinceId / 首都名
- legitimacy
- treasury
```

House 表示：

```text
- seatProvinceId / 本拠地名
- 所有 Province 数
- wealth
- prestige
```

Map 上で countryControl / houseControl を色や数値で確認できると望ましいが、v0.5 必須ではない。

---

## 17. 定数候補

初期実装では以下の値を使い、実際に動かしながら調整する。
ConfigPanel から調整可能にする項目に ✓ を付ける。

```ts
// 支配力上限
controlMaxDistancePenalty = 10    // ✓
controlMaxMinimum = 40            // ✓

// 支配力月次変化
controlGrowthPerMonth = 2              // ✓
controlDecayPerMonth = 1               // ✓
disconnectedControlDecayPerMonth = 5   // ✓

// 記念碑
monumentCountryControlGain = 10   // ✓
monumentLegitimacyGain = 5

// 土地開発
landDevelopmentHouseControlGain = 5   // ✓
landDevelopmentUnrestReduction = 1

// 領主交代
lordshipAbsorptionTargetThreshold = 50    // ✓
lordshipAbsorptionSourceMinimum = 60      // ✓
lordshipAbsorptionRatio = 2
lordshipAbsorptionMonthlyChance = 0.05    // ✓
lordshipAbsorptionNewControlMin = 50
lordshipAbsorptionNewControlMax = 70
lordshipAbsorptionNewControlPenalty = 10

// 併合
annexedCountryControl = 35
newRulerHouseControl = 35
```

---

## 18. イベント型追加

v0.5 で以下のイベント型を追加する。

```ts
'LORDSHIP_TRANSFERRED'
```

| EventType | importance | 説明 |
|-----------|------------|------|
| LORDSHIP_TRANSFERRED | normal | 隣接吸収による領主交代 |

---

## 19. v0.5 でやらないこと

以下は将来拡張とする。

* 首都移転
* 本拠地移転
* 複数本拠地
* House が複数 Country に所領を持つ仕組み
* House と Country の多対多関係
* 国境を越えた領主交代
* 領地なし House への再封
* 記念碑レベル
* 記念碑の破壊・略奪
* 道路・港湾・海路による距離短縮
* 文化・宗教・法制度による支配力補正
* 支配力に基づく反乱・独立
* 国王や領主個人の能力による支配力補正
* 国王崩御時の支配力低下や国家崩壊イベント
* development による houseControlMax 補正

---

## 20. 将来拡張の方向性

### 20.1 House と Country の多対多化

現時点では House は単一 Country に所属する。

将来的には、House が複数 Country に所領や封臣関係を持てるようにする。

案：

```ts
type HouseCountryRelation = {
  houseId: HouseId
  countryId: CountryId
  status: 'ruler' | 'vassal' | 'foreignLord' | 'ally' | 'enemy'
  loyalty: number
  obligations: number
}
```

### 20.2 人物能力による補正

将来的には、支配力の成長・減衰・領主交代確率に人物能力を反映する。

例：

* 国王の行政能力
* 領主の行政能力
* 領主の軍事能力
* 家の威信
* 国の正統性
* 国家安定度
* 戦争疲弊
* 財政赤字
* Province unrest

これにより、優秀な国王の時代には急拡大し、国王崩御後に支配力が維持できず崩壊する、といった歴史的現象を表現できる。

### 20.3 支配力による反乱・独立

支配力が低く、unrest が高い Province では、将来的に反乱や独立を起こせる。

v0.5 では収入と領主交代に限定し、反乱は扱わない。

---

## 21. まとめ

v0.5 では、Province の名目所有に加えて、国家と家の実効支配を導入する。

これにより、以下が表現できる。

* 首都周辺の強い国家支配
* 本拠地周辺の強い家支配
* 遠隔地や飛び地の支配力低下
* 征服直後の統治不安定
* 収入ロス
* 記念碑による国家支配力向上
* 土地開発による家支配力向上
* 弱い領主の土地が隣接有力家に吸収される現象
* 併合後も在地領主が残る国内勢力図

v0.5 の基本方針：

```text
名目所有と実効支配を分離し、
首都・本拠地・接続性・支配力によって、
国家と家の収入および領地構造を変化させる。
```
