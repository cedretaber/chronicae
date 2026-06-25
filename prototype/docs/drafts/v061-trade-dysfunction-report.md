# v0.61 交易路 機能不全 診断レポート

作成: 2026-06-25 / branch `feat/v061-merchant-trade`
計測: `--years 100 --preset tiny`, seed 1 / seed 42 の `--dump-world` を probe 解析（数値は両 seed 一致を確認済み）

> **対象読者**: 設計担当との相談用。「価格差はあるか」「交易路は作られているか」「どう機能していないか」の3点に答え、根本原因と設計レバー（適用はしない・選択肢提示）をまとめる。

---

## 結論（先に要点）

商会・交易システムは**エラーなく決定的に動作している**（150/300年 integrity green）。壊れているのは**交易路の裁定（arbitrage）ループだけ**で、商会本体は商業収益（commerce revenue）で生存している。

機能不全の核は **2つの市場シグナルが別スケールで計算されており、交易計画が「間違った方」でゲートしている**こと:

| シグナル                           | 計算                                                    | 性質               | 値                                                             |
| ---------------------------------- | ------------------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| **価格差**（裁定機会の大きさ）     | `(buy−sell)/min(buy,sell)` の**比率**正規化、2:1 で飽和 | 大きい・構造的     | 19/21 資源が max/min≥1.3、中央値 ~4倍、上限 7×（クランプ飽和） |
| **注文不均衡**（交易計画が読む量） | `sell−buy` の**生の絶対量**                             | 大半の市場でほぼ 0 | targetImportDemand p50=0.12, 15本中12本で律速                  |

価格は「ここに大きな裁定機会がある」と言っているのに、交易計画は同じ市場を生の注文数で見て「輸入需要ゼロ」と判断する。**裁定が最も richな所ほど、計画上は運べる量が無い。**

---

## Q1. 市場間に価格差はあるか → **ある。大きく、構造的。**

100年時点・seed 42 の resource 別 価格幅（state 横断 max/min）:

```
resource         min     max   ratio
gems            1.75   12.25   7.00   ← クランプ飽和
fur             0.75    5.25   7.00
wine            0.88    6.13   7.00
luxury_clothes  2.25   15.75   7.00
jewelry         3.50   18.56   5.30
flax            0.35    1.57   4.56
grain           0.13    0.35   2.80
...
19/21 資源が max/min ≥ 1.3、中央値 ratio ≈ 4.0–4.6（seed 1: 3.77 / seed 42: 4.56）
```

価格モデル（`computeResourcePrice`）:

```
imbalance = (buyOrders − sellOrders) / max(min(buyOrders, sellOrders), ε)
price     = basePrice × (1 + 0.75 × clamp(imbalance, −1, 1))
# 需要ゼロ(buy≤0) → basePrice×0.25 / 供給ゼロ(sell≤0) → basePrice×1.75
```

- **7.00 は実スプレッドではなくクランプ飽和**。価格幅は `[0.25, 1.75]×basePrice`（比 7.00）に頭打ち。7資源がぴったり 7.00 なのは「ある州が供給ゼロ＝上限／別の州が需要ゼロ＝下限」の組み合わせ。**真の供給・需要の乖離はもっと大きく、価格はそれをクリップしている。**
- つまり「市場が分断していて価格差がある」という v0.61 の前提は**正しい**。州ごとに生産プロファイルが違い、自給する資源・しない資源がはっきり分かれている（tiny preset では各州がほぼ自己完結）。

---

## Q2. 交易路は作られているか → **作られている。**

|                       | seed 1          | seed 42               |
| --------------------- | --------------- | --------------------- |
| 商会 active           | 4               | 4（+dormant 1）       |
| 本店/支店             | HQ×4 / branch×? | HQ×4 active, branch×2 |
| 交易路 active         | **28**          | **15**                |
| 交易路 closed（履歴） | —               | 4                     |

worldgen の初期 route（州ごと1本）＋商会の自律的 open_trade_route Project が機能し、route 自体は増えている。level は全て L1（拡張がほぼ起きない）。資源も grain/fish/gems/fur/flax/wool など多様。**「route が生成されない」問題ではない。**

---

## Q3. どう機能していないか → **2つの独立した失敗が重なっている。**

### 失敗A: planned quantity が import-demand ゲートで枯渇

`plannedQuantity = min(throughput, sourceExportable, targetImportDemand)`（`tradePlanningSystem.ts:44`）

active route の律速項を最終 snapshot から実測（seed 42・15本）:

```
binding term:  throughput 0 本 / sourceExportable 3 本 / targetImportDemand 12 本

targetImportDemand (= target の buy−sell):  p50=0.12  p90=1.57  max=1.96   うち 5本が完全に 0
sourceExportable   (= source の sell−buy):  p50=19.50 p90=371   max=3167
throughput (L1=5):                           まったく律速しない
```

→ **target の輸入需要が圧倒的に律速**（12/15）。供給側は超過剰（max 3167）、throughput は一度も効かない。

**なぜ targetImportDemand がほぼ 0 か**: 各州の市場は毎月**内部で清算**する。価格モデルは比率正規化された imbalance（2:1 で飽和）を使うので、需要が供給を少し上回るだけ・あるいは供給ゼロの端数だけで価格は上限に張り付く。一方で**生の `buy−sell` の絶対量は小さい**（tiny preset の人口・POP 規模が小さい）。結果、価格が天井（＝強い需要を示唆）の市場でも、生の注文帳簿は均衡しており「輸入需要 ≈ 0」。

実例 — gems route `tr-150` sr-1→sr-2:

```
source sr-1 gems: sell−buy = +19.5（巨大な輸出余力）, 価格 1.75（下限）
target sr-2 gems: 価格 12.25（上限＝最大需要を示唆） だが buy−sell ≈ 0（輸入需要ほぼ無し）
→ planned = min(5, 19.5, ~0) = 0.03
```

価格差は 7倍（1.75→12.25）あるのに、運べる量は 0.03。

### 失敗B: 固定維持費が低量 route を構造的赤字にする

route profit（`merchantCompanyAccountingSystem.ts:86-91`）:

```
arbitrage   = q × max(0, targetP − sourceP) × 0.5      (spreadCaptureRate)
serviceFee  = q × avgP × 0.05
transport   = q × 0.1
maintenance = 固定 1.0/月 (L1)                          ← q に依存しない
net = arbitrage + serviceFee − transport − maintenance
```

q が小さいと arbitrage/serviceFee は q に比例して消えるが、maintenance 1.0 は残る。

`tr-150`（7倍スプレッド）でも: arbitrage = 0.03 × 10.5 × 0.5 = **0.16** ≪ maintenance **1.0** → net ≈ −0.83。
`tr-156` fur（q=0.65, スプレッド 3.0→5.25）: arbitrage 0.73 + fee 0.13 − transport 0.07 − 1.0 = **−0.20**。

→ **両 seed で profitable な active route は 0 本**。smoothedProfit の範囲は seed 1 [−1.09, 0.00] / seed 42 [−1.04, 0.00]。上限の 0.00 は黒字達成ではなく**新規 route の初期値**（smoothedProfit は 0 始まりで毎月 −maintenance へ減衰）。実質、全 route が毎月 ~−1 を垂れ流す。

### 帰結: 商会は商業収益だけで生存・treasury が遊休

route が赤字垂れ流しでも商会が潰れないのは、**commerce revenue（前月 snapshot の取引総額 × share、route とは独立）**が支えているため。

```
seed 1 商会 treasury: −50, 20276, 20404, 22974   ← 3社が ~20000 で滞留
seed 42 商会 treasury: −61, 27, 99, 12042
```

商業収益が貯まる一方、使い道（route 拡張は赤字なので Aim が伸ばさない・支店も同様）が乏しく **treasury が ~20000 で遊休**。＝商会システムは生きているが、**交易路は経済的に無意味な付属物**になっている。

---

## 根本原因（1行）

**価格モデル（比率正規化・2:1 で飽和・端数でも上限へ）と交易計画（生の絶対注文量）が imbalance を別スケールで読む**ため、価格が裁定機会を叫ぶ市場ほど計画上は運べる量がゼロになる。そこへ **q 非依存の固定維持費**が乗り、低量 route が必ず赤字になる。

---

## 設計レバー（選択肢・**今は適用しない**）

> CLAUDE.md §4: 機能完成後にまとめてバランス調整。以下は設計担当と方向性を相談するための叩き台で、config を即触ることはしない。

**方向1: 計画の数量ゲートを価格差ベースに変える（構造変更・本命候補）**
`targetImportDemand`（生の buy−sell）を律速に使うのをやめ、**価格差そのもの**（targetP − sourceP > 閾値なら運ぶ）で plannedQuantity を決める。市場が清算する都度ゼロに戻る絶対量ではなく、構造的に残る価格差を駆動力にする。throughput と sourceExportable で上限を保てば供給保存も崩れない。

- 論点: 運んだ量を target の供給に注入すれば価格差は縮む（裁定が自己消費する＝望ましい挙動）。注入が価格に効く非対称性（source=清算前 demand / target=清算ループ内 sell）は既存実装のまま使える。

**方向2: 固定維持費を量・規模に連動させる**
`tradeRouteFixedMaintenanceCostByLevel`（L1=1.0）を下げる、または維持費を「実 lastQuantity に対する従量」に寄せる。低量でも赤字にならなければ route が生き残り、量が出る所で黒字化できる。

- 論点: これ単独では失敗A（量が出ない）は解けない。方向1とセット。

**方向3: 市場規模・人口スケールの底上げ**
tiny preset の生の注文量が小さすぎて絶対量ゲートが効かない面がある。`POP_DISPLAY_SCALE` は表示専用で、内部の注文は raw 数。市場の取引量自体を増やせば絶対量ゲートも機能しうるが、preset 依存の対症療法で、方向1の構造問題は残る。

**方向4（副次・footnote）: route 配置の最適化**
自律 Aim が選ぶ source→target が真の輸入州を外すことがある（例: flax の真の輸入州は sr-1 が −13.8 だが、carrying している flax route の target は sr-2）。`estimateStateDemandPotential` の評価軸を価格差ベースに寄せれば改善するが、寄与は小さい。方向1で計画式を変えれば自然に解消する見込み。

---

## 補足（裏取り済み事実）

- market key は 4 states × 21 resources = **84 全網羅**。planned=0 は cold-start/snapshot 欠落ではなく**真の輸入需要ゼロ**。
- throughput（L1=5）は両 seed で一度も律速していない → route level を上げても量は増えない（拡張 Project が無意味な一因）。
- 数値は seed 1 / seed 42 で定性的に完全一致。preset 非依存性（small/standard で改善するか）は未計測。
