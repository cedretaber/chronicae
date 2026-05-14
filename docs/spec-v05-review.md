# spec-v05-update.md レビュー

レビュー日: 2026-05-14

---

## 総評

仕様の方向性は明確で、各システムの責務は分離されている。
ただし、実装に落とす際に判断が必要な未定義箇所・矛盾・整合性の問題が複数ある。
以下に項目ごとに整理する。

---

## 1. 不足している定義

### 1.1 首都・本拠地の初期値（worldgen）

仕様に worldgen での設定方法が書かれていない。

- **Country.capitalProvinceId**: 国家所属 Province の中からどの Province を首都にするか。ランダム？支配家の本拠地に最も近い Province？
- **House.seatProvinceId**: 各 House の所有 Province の中からどれを本拠地にするか。ランダム？最初に割り当てた Province？

実装前に決める必要がある。

### 1.2 countryControl / houseControl の初期値（worldgen）

Province に `countryControl` と `houseControl` を追加するが、worldgen での初期値が未定義。

候補：
- 首都・本拠地からの距離で算出（ControlSystem と同じロジックを初期化にも適用）
- 固定値（例: `countryControl = 60, houseControl = 60`）
- ランダム

距離ベースが自然だが、worldgen 時点で BFS を走らせる必要がある。

### 1.3 本拠地の交代条件

§3.3 に「House は必ず `seatProvinceId` を持つ」とあるが、本拠地 Province を失った場合（将来の戦争・特別イベント）の処理方法が未定義。

v0.5 範囲外とするなら、IntegrityCheck で `seatProvinceId ∈ house.provinceIds` を検証するだけでよい。
ただし現状の IntegrityCheck にこのチェックは含まれていないため、追加が必要。

### 1.4 記念碑の対象 Province 選択スコア

§9.2 に対象条件（接続済み、countryControl < 100）は書かれているが、複数候補のどれを選ぶかが未定義。
- 最も countryControl が低い Province？
- スコアベースで選ぶ？
- ランダム？

土地開発（COUNTRY_LAND_DEVELOPED）には §9 に相当するスコア式があるが、記念碑にはない。

### 1.5 DevelopmentSystem の tick 順序内の位置

§13 の tick 順序案に `DevelopmentSystem`（既存、v0.4）が含まれていない。

v0.5 での推奨順序案：

```
1. advanceTime
2. DevelopmentSystem
3. ControlSystem
4. LordshipTransitionSystem
5. EconomySystem
6. DisasterSystem
...
```

`ControlSystem` より前に置くことで、その月の development 補正（§6.4）が支配力上限に反映される。

---

## 2. 曖昧な箇所

### 2.1 §6.4 開発度による家支配力上限補正の採否

```ts
houseControlMax += province.development * 2
houseControlMax = clamp(houseControlMax, 0, 100)
```

「過剰であれば見送ってよい」と書かれており、実装するかどうかが決まっていない。

効果の試算：
- `development = 50` → `houseControlMax +100`、ただし clamp で 100 止まり
- `development = -50` → `houseControlMax -100`、ただし clamp で 0 止まり

この補正はかなり強力で、development が高い Province はほぼ常に上限 100、development が低い Province は家が支配力を持てなくなる。
初期実装では見送り、基本動作確認後に追加することを推奨する。

### 2.2 §10 土地開発による development 増加量の変更

v0.4 では:
- 国家土地開発: `development += 8`
- 家土地開発: `development += 6 * (1 - max(0, development) / 100)`（effectiveGain）

v0.5 §10 では:
- `province.development +1`

これは意図的な変更か確認が必要。もし開発度増加を弱める意図なら、v0.4 の config 値（`countryLandDevelopmentGain`、`houseLandDevelopmentGain`）を変更すれば済む。新しい固定値「+1」に変更するなら config から外すことになる。

### 2.3 §11.2 隣接吸収条件「確率判定に成功する」の主体

「確率判定に成功する」とあるが、対象 Province ごとに判定するのか、(target, neighbor) ペアごとに判定するのかが不明。

隣接 Province が複数ある場合の流れ：

1. target に対して最も houseControl が高い neighbor を選ぶ（§11.5）
2. その (target, neighbor) ペアに対して確率判定する

という理解が自然だが、仕様では順序が曖昧。

### 2.4 §8.1 収入式の `provinceIncome` の定義

```ts
const countryIncome = provinceIncome * (countryControl / totalControl) * countryControl
```

この `provinceIncome` が何を指すか未定義。

v0.4 の実装では `getEffectiveProvinceTax(province)` が税収を返し、60% を house、40% を country に分配していた。v0.5 では支配力で按分するため、この固定比率はなくなる。`provinceIncome` は `getEffectiveProvinceTax(province)` をそのまま使うと理解してよいか。

また、house の取り分が `houseIncome` で、country の取り分が `countryIncome` であれば、EconomySystem の実装を全面的に書き直す必要がある。

---

## 3. 矛盾・整合性の問題

### 3.1 §12 併合処理と既存 warSystem の処理の矛盾

現在の warSystem では、Province がゼロになった国の全 House を `moveHouseToCountry` で征服国へ移動させ、全 Province の `ownerHouseId` が征服国の `rulerHouseId` に変わっている（`transferProvinceToHouse` で変更）。

v0.5 §12 では:
- 非 rulerHouse の ownerHouseId は維持する
- rolerHouse から seatProvince 以外を取り上げ、征服国 rulerHouse に割り当てる

この処理は既存の warSystem の annexation ロジックと根本的に異なるため、warSystem を大幅に書き換える必要がある。特に現行の `moveHouseToCountry` は House の countryId を変えるが、Province の ownerHouseId は変えないため、Province ごとの所有 House が古い countryId に属したままになるリスクがある。

整合性を保つため、IntegrityCheck の「Province.countryId と ownerHouse.countryId の一致」チェックが引き続き動作することを確認する必要がある。

### 3.2 §11.3 領主交代後の houseControl 設定式

```ts
target.houseControl = max(50, min(70, neighbor.houseControl - 10))
```

`neighbor.houseControl = 60`（最低条件）のとき → `max(50, min(70, 50))` = `50`
`neighbor.houseControl = 80` のとき → `max(50, min(70, 70))` = `70`
`neighbor.houseControl = 100` のとき → `max(50, min(70, 90))` = `70`

意図通りに動く。ただし、`neighbor.houseControl` が 60 ちょうどのとき（最低条件クリアの境界値）、新 houseControl が 50 になり、吸収条件の `target.houseControl < 50` をわずかに上回るだけで即時再交代リスクがある。境界値で問題が出る場合は定数調整で対処可能。

### 3.3 §9 記念碑の効果と v0.4 の効果の変更

v0.4 では記念碑建設の効果:
- `legitimacy +10`
- `rulerHouse.prestige +5`
- `treasury -= monumentBaseCost`

v0.5 §9 では:
- `countryControl +10`（対象 Province）
- `legitimacy +5`

v0.4 の `prestige +5` が消え、`legitimacy` 効果が 10 → 5 に減っている。これは意図的な変更か確認が必要。

---

## 4. 実装難度が高い箇所

### 4.1 BFS による到達可能性判定（§5, §6）

支配力の上限計算と減衰判定に、毎月全 Province に対して BFS（幅優先探索）が必要になる。

Province 数が少ない現プロトタイプでは問題ないが、設計として注意:
- `countryControl` 用: 首都から自国 Province のみを通る BFS
- `houseControl` 用: 本拠地から同国 Province を通る BFS（他 House 領も通行可）

BFS の起点（首都・本拠地）が Province に格納されているため、首都・本拠地の Province が active な Country・House に属していることを IntegrityCheck で保証する必要がある。

### 4.2 スナップショット判定（§11.6）

領主交代のスナップショット判定（月初状態で候補列挙、最後にまとめて反映）は、TickContext のイミュータブル更新パターンと相性がよい。ただし「候補列挙→確率判定→まとめて反映」の 3 フェーズを明確に分けて実装する必要がある。

---

## 5. 追加すべき IntegrityCheck 項目

v0.5 実装後に以下を IntegrityCheck に追加する:

1. `Country.capitalProvinceId` が active Country に属する Province を指している
2. `House.seatProvinceId` がその House の `provinceIds` に含まれている
3. `countryControl` と `houseControl` が 0..100 の範囲内
4. `Province.countryId` と `ownerHouse.countryId` の一致（既存、引き続き動作確認）

---

## 6. 仕様書に書いてあった方が良い補足事項

- **§2**: `countryId` と `ownerHouseId` は「名目所有」だが、`countryControl` と `houseControl` が 0 になっても名目上の所有関係は変わらない（領主交代が起きない限り）。この点を明記すると混乱が減る。
- **§7**: `controlGrowthPerMonth` と `controlDecayPerMonth` が config に入るかどうか未記載。ConfigPanel から調整できると便利。
- **§11**: 領主交代イベント名（EventType）が未定義。`LORDSHIP_TRANSFERRED` などを EventType に追加する必要がある。
- **§12**: 併合処理は warSystem 内で行うのか、新しい mutation 関数として切り出すのかが未定義。新 mutation `annexCountry` として切り出すことを推奨する。
