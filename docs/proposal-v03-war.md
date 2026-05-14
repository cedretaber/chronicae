# v0.3 拡張提案：戦争・征服・富の消費

## 1. 提案の目的

v0.2 で確認できた「個人・家・国家の相互作用」を基盤として、以下を追加する。

1. **国家間の戦争と征服** — プロヴィンスを奪い合い、国境が動く
2. **富の消費機会** — treasury・wealth に意味のある支出先を設ける
3. **国家の消滅と吸収** — 征服によって国が滅びる

これにより「歴史が動く」体験の密度が上がり、観戦対象としての面白さが増す。

---

## 2. 設計方針

### 2.1 War 型は導入しない（即時解決型）

v0.2 SPEC §24 の方針「`War` 型は導入せず、反乱は即時解決する」を戦争にも適用する。

- 宣戦→戦闘→講和を **1 tick 内で解決** する
- 「戦争中」状態を WorldState に持たせない
- 複数 tick にわたる戦争状態管理・補給・戦線は **今回は対象外**

この方針により、既存の tick パイプラインと整合性を保ちながら最小限の実装で征服を実現できる。

### 2.2 既存資産の活用

以下は既存実装をそのまま活用する。

| 既存資産 | 用途 |
|---|---|
| `Province.manpower` | 軍事力の計算基盤 |
| `transferProvinceToHouse` | 征服後のプロヴィンス移転 |
| `moveHouseToCountry` | 属国化・吸収時の家移動 |
| `Country.treasury` | 戦費支出 |
| `House.wealth` | 軍役負担 |
| `rebellionSystem` の軍事力計算 | 参考にして統一する |

---

## 3. 戦争システム概要

### 3.1 戦争の発生条件

**国家が他国に宣戦する**トリガーは以下のどちらかで検討する。

**案A：国家レベルの野心スコアで自動発生**
- 国家が持つ「拡張欲」スコアを計算し、閾値を超えたら宣戦
- スコア要因：treasury の余裕、隣接する弱小国の存在、legitimacy の高さ
- 反乱システムと対称的な構造になり、設計がシンプル

**案B：支配家（rulerHouse）の将軍（general）の martial 値で駆動**
- general の martial が高く、隣接する弱国があれば宣戦を検討
- 人物の個性が戦争に影響し、「好戦的な将軍が戦争を起こす」物語が生まれる

→ **案B を推奨**。「人物が歴史を動かす」というコンセプトに合致する。

### 3.2 軍事力の計算

```
countryMilitaryPower =
  Σ(所属する全 active House の houseMilitaryPower)
  + country.adminPower * 0.3

houseMilitaryPower =
  Σ(所有 Province の manpower)
  + house.wealth / 20
  + 家の general の martial * 3 （いれば）
```

`rebellionSystem` の `houseMilitaryPower` と統一し、共通 selector に切り出す。

### 3.3 戦争の解決

```
attackerPower = 攻撃側の countryMilitaryPower
defenderPower = 防衛側の countryMilitaryPower

roll = randomFloat()
attackerWinChance = attackerPower / (attackerPower + defenderPower)
attackerWins = roll < attackerWinChance
```

### 3.4 戦費

宣戦時に treasury を消費する。treasury が不足している国は宣戦できない。

```
warCost = 隣接する相手国のプロヴィンス数 * warCostPerProvince
```

`warCostPerProvince` は SimulationConfig に追加する（初期値案: 20）。

敗北側も treasury を消費する（敗戦の損害）。

### 3.5 勝敗の結果

**攻撃側が勝利した場合：**

- 防衛側の国境に隣接するプロヴィンスを1〜3枚取得（ランダム）
- 取得したプロヴィンスは攻撃側 rulerHouse に移転（`transferProvinceToHouse` を使用）
- 防衛側の treasury・stability・legitimacy が低下

**攻撃側が敗北した場合：**

- 攻撃側の treasury・stability・legitimacy が低下
- 防衛側の legitimacy が上昇

### 3.6 国家の消滅

防衛側のプロヴィンスが 0 になった場合、その国は消滅する。

- 消滅国の全 House を攻撃側に吸収（`moveHouseToCountry`）
- 消滅国の Country は records から除去するか、`active: false` フラグで管理する
- `COUNTRY_ANNEXED` イベントを発行する

> **設計メモ**：Country に `active` フラグを追加するか、records から除去するかは要検討。除去する場合、参照整合性の管理コストが増える。フラグ管理が安全。

---

## 4. 富の消費システム（戦争以外）

戦争のみでは treasury・wealth の消費が不十分な可能性がある。補完的な消費機会を追加する。

### 4.1 家の支出：忠誠維持費・維持費

毎月、active House は以下のコストを負担する。

```
maintenanceCost = house.provinceIds.length * maintenanceCostPerProvince
```

`maintenanceCostPerProvince` は SimulationConfig に追加（初期値案: 0.5/月）。

wealth < maintenanceCost の場合：
- 差額分だけ cohesion が低下（維持できない → 家の結束が崩れる）
- loyaltyToCountry も低下

### 4.2 国庫の維持費：役人コスト

毎月、役職を持つ人物の数に応じて treasury を消費する。

```
officerCost = roleCount * officerCostPerRole
```

`officerCostPerRole` は SimulationConfig に追加（初期値案: 5/月）。

treasury が低下することで、governanceSystem の adminPower ボーナスが下がり、統治力の低下が連鎖する。

### 4.3 陰謀コスト（plotSystem への追加）

現在、陰謀（plot）は発動コストがない。以下を追加する。

- 陰謀を発動する家は wealth を消費する
- wealth が不足すると plotTendency が高くても実行できない

```
plotCost = basePlotCost * (1 - house.caution平均)
```

`basePlotCost` は SimulationConfig に追加（初期値案: 30）。

### 4.4 反乱コスト（rebellionSystem への追加）

現在、反乱も発動コストがない。以下を追加する。

- 反乱を起こす家は wealth を消費する（軍の動員費）
- 反乱に失敗した場合の wealth ペナルティを追加する

```
rebellionCost = rebelHouse.wealth * 0.3
```

---

## 5. 新規イベントタイプ

| イベント種別 | importance | 説明 |
|---|---|---|
| `WAR_DECLARED` | critical | 宣戦布告 |
| `WAR_WON` | critical | 攻撃側勝利・プロヴィンス獲得 |
| `WAR_LOST` | critical | 攻撃側敗北 |
| `PROVINCE_CONQUERED` | major | 個別プロヴィンスの征服 |
| `COUNTRY_ANNEXED` | critical | 国家の消滅・吸収 |
| `HOUSE_BANKRUPT` | major | 家の資金破綻（wealth が 0 以下） |
| `COUNTRY_BANKRUPT` | major | 国庫破綻（treasury が 0 以下） |

---

## 6. SimulationConfig への追加項目

```ts
// 戦争
warCostPerProvince: number        // 宣戦コスト（初期値: 20）
warEnabled: boolean               // 戦争システムの有効/無効（初期値: true）
maxProvincesPerWar: number        // 1回の戦争で取れる最大プロヴィンス数（初期値: 3）

// 維持費
maintenanceCostPerProvince: number // 家の維持費/月（初期値: 0.5）
officerCostPerRole: number         // 役職コスト/月（初期値: 5）

// 陰謀・反乱コスト
basePlotCost: number               // 陰謀の発動コスト（初期値: 30）
rebellionCostRatio: number         // 反乱コスト比率（初期値: 0.3）
```

---

## 7. tick 順序への影響

現在の tick 順序に `runWarSystem` を追加する。反乱の前に戦争を解決するのが自然。

```
1. 時間を進める
2. 経済処理
3. 死亡処理
4. 人物補充処理
5. 継承処理
6. 任命処理
7. 個人の欲求・野心評価
8. 陰謀処理
9. 戦争処理         ← NEW
10. 反乱処理
11. 安定度・正統性・忠誠の変化
12. 統治力更新
13. 整合性チェック
14. イベント返却
```

---

## 8. 実装ステップ案

複数の変更を含むため、段階的に実装する。

| Step | 内容 | 依存 |
|---|---|---|
| 1 | 軍事力 selector の共通化（rebellionSystem と統一） | なし |
| 2 | 維持費・国庫コストの追加（EconomySystem 拡張） | なし |
| 3 | 陰謀・反乱コストの追加 | Step 2 |
| 4 | WARシステムの実装（warSystem.ts 新規） | Step 1 |
| 5 | 国家消滅処理（Country.active フラグ or records 除去） | Step 4 |
| 6 | UI 更新（消滅国の表示、征服イベントの表示） | Step 4, 5 |

---

## 9. 未解決の設計課題

以下は仕様を固める前にユーザーと合意が必要な点。

1. **戦争の発生頻度** — 頻繁すぎると世界がすぐ1国になる。抑制パラメータが必要か。
2. **Country.active フラグ vs records 除去** — 消滅国をどう扱うか。
3. **家の wealth 下限** — 0 未満になれるか、0 でクランプするか（現在は `Math.max(0, ...)`）。
4. **同一 tick 内の複数戦争** — 複数国家が同時に宣戦した場合の処理順序。
5. **戦争と反乱の相互作用** — 戦争中に内部反乱が起きた場合の扱い（現設計では自然に両方が独立して処理される）。
6. **将来の詳細戦争との互換性** — 即時解決型から War エンティティ型へ将来移行する場合の設計境界をどこに置くか。
