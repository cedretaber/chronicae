# v0.4 仕様レビュー

最終更新: 2026-05-14

---

## 1. 実装上の問題・注意点

### 1.1 WarSystem — 国境Province特定ロジックとの整合性（要注意）

仕様§9「攻撃側勝利時: 征服されたProvinceに荒廃、防衛側の隣接国境Provinceにも軽微な荒廃」とあるが、現在の`warSystem.ts`では以下の2つが別物になっている。

```
borderProvinceIds = 防衛側のうち攻撃側と隣接している全Province
provincesToTake   = そのうち実際に征服するもの（slice(0, numToTake)）
```

「防衛側の隣接国境Province: `development -= warBorderProvinceDevastation`」を征服されなかった国境Provinceに適用するなら、`borderProvinces.filter(p => !provincesToTake.includes(p))` という形になる。征服Province自体にも別途 `-warConqueredProvinceDevastation` を適用する二段構えが必要。

**仕様を明確化すべき点**: 「防衛側の国境Province荒廃」の対象は以下のどちらか？

- (A) 征服されなかった国境Province（残存国境地帯）
- (B) 国境に隣接する全Province（征服Province含む）

推奨は (A)。征服Province自体は `warConqueredProvinceDevastation`、残存国境は `warBorderProvinceDevastation` と使い分ける設計が自然。

---

### 1.2 RebellionSystem — 反乱Province荒廃のタイミング

仕様§10「`rebelHouse.provinceIds` にdevelopmentを下げる」とあるが、現在の`rebellionSystem.ts`では `house.provinceIds` を荒廃適用に使っていない（`house.provinceIds.length > 0` チェックのみ）。

追加自体はシンプルだが、荒廃をどのタイミングで適用するかに注意が必要。

- 反乱成功（`independence`）後は `createCountryFromHouse` が呼ばれ、Province帰属が変わる
- 反乱成功（`ruler_change`）後は `changeRulerHouse` が呼ばれ、Houseの立場が変わる

**推奨**: 荒廃は REBELLION_STARTED イベント直後・勝敗判定前に適用する。これにより「反乱勃発の混乱」として一貫した表現になり、Province帰属変化の影響を受けない。

---

### 1.3 DisasterSystem — FAMINEのunrest適用パターンとdevelopment追加の整合

仕様§11.1では以下の2ステップ設計になっている。

```
FAMINE発生: unrest += 10, development -= famineDevastation
救済成功時: unrest -= 5, development += famineReliefDevelopmentRecovery
```

現在の`disasterSystem.ts`の実装は「救済できれば最初から `unrest += 5` にする」という1ステップ設計（最終値は同じ）。2つのイベント（FAMINE → DISASTER_RELIEF_FUNDED）と辻褄が合っているため問題はない。

development追加時も同じパターンを踏襲すればよい。

---

### 1.4 PublicSpendingSystem — スコア計算のconfig参照漏れリスク

現在の`publicSpendingSystem.ts`の almsScore 計算内で以下を使っている。

```typescript
const treasuryShortage = Math.max(0, ctx.config.almsBaseCost - country.treasury)
```

v0.4では `almsBaseCost` → `countryLandDevelopmentBaseCost` に置き換えるため、スコア計算もあわせて更新が必要。almsScoreの名称も `landDevelopmentScore` 等に変更するとよい。

また、ALMS版（全Province unrest -5）から土地開発版（対象Province1つを選んでdevelopment上昇）への変更は、**対象Province選択ロジックが新規追加**されるため実装量が増える。

---

### 1.5 `development` の初期値が未定義

仕様§19の実装順序2に「worldgenでdevelopment初期値を設定」とあるが、具体的な初期値が仕様に書かれていない。

選択肢：

| 初期値 | 特徴 |
|---|---|
| `0` | 全Province通常状態からスタート。シンプル。 |
| `randomInt(-10, 10)` | ごく軽微なばらつき。見た目の変化は小さい。 |
| `randomInt(-20, 20)` | 初期から多少の差がある。最初から地域差が生まれる。 |

推奨は `0` または `randomInt(-10, 10)` 程度。大きなばらつきは開始直後のバランスに影響しやすい。

---

### 1.6 `developmentPositiveMonthlyDecay = 0.1` の速度感

月次 -0.1 では、development が +100 に達しても **1000ヶ月（83年）かけてゼロに戻る**計算になる。

HouseDevelopmentSystem（年1回・最大25%確率・+6 × effectiveGain）と組み合わせると、積極的な家は development をほぼ維持できる。「発展は維持しやすく、荒廃は比較的早く回復」という設計であれば問題ない。

参考:

```
development = +100 → decay 0.1/月 → ゼロ到達まで 1000ヶ月（83年）
development = -100 → recovery 0.25/月 → ゼロ到達まで 400ヶ月（33年）
```

仕様通りだが、バランス確認時（§19 手順18 の50年/100年/200年実行）で調整を要する可能性がある。

---

## 2. 実装リスクまとめ

| # | 問題 | 重要度 | 対処方針 |
|---|------|--------|---------|
| 1 | 戦争の「国境Province荒廃」対象の定義が曖昧 | 高 | 仕様を明確化（征服Provinceとは別に適用） |
| 2 | 反乱Province荒廃のタイミング（結果前 or 後） | 中 | REBELLION_STARTED直後に適用と仕様明記 |
| 3 | FAMINEのunrest適用パターンとdevelopment追加の整合 | 低 | 既存の2イベントパターン踏襲でOK |
| 4 | `almsBaseCost` → `countryLandDevelopmentBaseCost` 置き換え漏れリスク | 中 | スコア計算・変数名も同時に更新 |
| 5 | `development` worldgen初期値が未定義 | 中 | `0` か小範囲ランダムか決定して仕様に明記 |
| 6 | decay=0.1の速度感が想定と合うか | 低 | 長期シミュレーション実行で確認・調整 |

---

## 3. UI提案

### 3.1 必須（仕様§16の実装）

**ProvinceDetail**に以下を追加：

- `development` 数値
- 状態ラベル（荒廃/衰退/通常/発展/繁栄）
- `effectiveTax`（unrest + development 両方反映後）
- `effectiveManpower`（同上）

状態ラベルの区分（仕様§16.1より）：

```
-100 .. -50: 荒廃
 -49 .. -10: 衰退
  -9 ..  +9: 通常
 +10 .. +49: 発展
 +50 ..+100: 繁栄
```

### 3.2 推奨

**Mapノードの色グラデーション**

現在は国家色のみで Province ノードを塗っている。`development` を輝度または彩度に重ねると荒廃地域が一目でわかる。

実装例（`ProvinceMap.tsx` の `style.background` で `HSL` を使う場合）：

```typescript
// development -100..100 を lightness 20%..60% にマッピング
const lightness = 20 + ((province.development + 100) / 200) * 40
background: `hsl(${baseHue}, 60%, ${lightness}%)`
```

ただし既存の `buildCountryColorMap` は hex 形式のため、HSL化には変換または書き直しが必要。

**HouseDetail の Province リスト**

各Province行に development を小さく表示する：

```
North Valken  (-32)   ← 赤っぽい色
South Valken  (+18)   ← 緑っぽい色
```

**EventLog のProvince リンク**

`COUNTRY_LAND_DEVELOPED` / `HOUSE_LAND_DEVELOPED` には `provinceIds` が入る。現在の actorIds/houseIds と同様に、Province名クリックでProvinceDetailへ遷移できると便利。既存のリンクコンポーネント (`HouseLink`, `CountryLink`) と同じパターンで `ProvinceLink` を追加するとよい。

### 3.3 ConfigPanel（v0.3対応と同時）

v0.3 対応（`warEnabled`/`disasterEnabled`/`publicSpendingEnabled` トグル）に加え、v0.4 config 項目を追加：

```
--- Development ---
ToggleRow: House Development Enabled (config.houseDevelopmentEnabled)
ConfigRow: Positive Decay/month (config.developmentPositiveMonthlyDecay, 0〜1, step 0.05)
ConfigRow: Negative Recovery/month (config.developmentNegativeMonthlyRecovery, 0〜1, step 0.05)
ConfigRow: Country Dev Cost (config.countryLandDevelopmentBaseCost, 30〜200, step 10)
ConfigRow: House Dev Cost (config.houseLandDevelopmentBaseCost, 20〜150, step 5)
```

---

## 4. 仕様書へのフィードバック

1. **§9「防衛側の国境Province荒廃」の対象を明確化**: 「征服されなかった国境Province」か「国境Province全体（征服Province含む）」かを仕様に明記する
2. **§19 テストの位置**: 現在の実装順序ではテスト追加が手順17（最後）になっているが、selectorテスト（手順3のgetProvinceDevelopmentMultiplier等）は実装と同時に書く方が安全
3. **worldgenのdevelopment初期値を§4か§19に明記する**
4. **§13.3 `house.active === true` の確認**: `House`型に`active`フィールドが既にある（問題なし）
