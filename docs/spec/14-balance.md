# 14. ゲームバランス観察記録

プロトタイプ段階でのバランス観察結果を記録する。機能追加でバランスが変動するため、各項目にはバージョンと計測条件を付記する。

なお、CLAUDE.md §4 の方針に従い、機能追加が続く現段階ではバランス調整に時間を割かない。ここに記載するのは「観察された傾向」と「将来の調整方針」であり、即座に config を変更するものではない。

---

## 14.1 富の流れ（v0.28 時点）

計測条件: 300年 × 4 seed (1, 42, 123, 999)、standard preset

### 14.1.1 POP wealth

v0.28 で collection friction を wealth 比例化（`× pop.wealth/100`）し、`localExtractionWealthPenalty` を 4→2 に調整。

- **改善前**: POP wealth が0に収束するデススパイラル。生産が停止し Polity treasury も崩壊
- **改善後**: POP wealth は 60-70 付近で均衡。生産が安定し Polity treasury は 2000-5000 で推移

均衡点の理論値: `gain × 100 / (frictionRate × penalty)`。平均的 bailiff (ability 50, profit_seeking) で約52、優秀な bailiff で約80。

### 14.1.2 House / Person wealth の蓄積

House / Person の wealth は際限なく蓄積する傾向がある。根本原因は**支出メカニズムの不足**。

収入経路:
- Polity 余剰分配（Share 比率に応じて）
- Office 給与
- Bailiff 手数料
- 派閥パトロネージ
- 相続（死亡時の遺産）

支出経路（現状）:
- Project 予算（Polity のみ）
- 派閥資金提供

**将来の支出メカニズム候補**（優先度順）:
1. 生活維持費（身分・家格に応じた固定支出）
2. 持参金・婚資
3. 軍事費用
4. パトロネージ拡張
5. 土地購入
6. 災害救済

### 14.1.3 Polity treasury の保留

v0.28 で保留額を固定値(100)から動的(`base 50 + perHolding 50 × holdingCount`)に変更。大国ほど多くの運営資金を確保し、Project 費用・給与原資として機能する。

### 14.1.4 世界全体の生産力低下

ゲーム進行に伴い世界全体の生産力が低下していく傾向が観測されている。v0.28 の POP wealth 安定化で部分的に緩和されたが、Holding 改善の完了率が低いことと合わせ、経済が縮小再生産に陥る可能性が残る。

---

## 14.2 Project バランス（v0.28 時点）

計測条件: 300年 × 4 seed、standard preset

### 14.2.1 develop_holding の結果分布

| 指標 | v0.28 |
|------|-------|
| 完了率 | 17-33% |
| 予算不足 | 7-16% |
| 期限切れ | 38-61% |
| 監督者不在 | 1-2% |
| 中止 | 12% |

v0.28 で deadline を targetProgress に比例化（Level 1=48週, Level 2=96週, Level 3=144週）。旧来の一律48週と比べ Level 2/3 の期限切れが改善。

### 14.2.2 期限切れの構造的原因

Level 1 (target=100) でも期限切れ率が高い主因は **supervisor の actionCapacity 競合**。supervisor は bailiff として collect_holding_revenue や他の aim 系タスクも並行するため、advance_project が実行できない週が多い。

理論値:
- advance_project: actionCost=1.0, effortRequired=3, weeklyEffort=1.5 (ability 50) → 2週/タスク
- 期待進捗/タスク (ability 50): 0.6×25 + 0.2×10 + 0.2×0 = 17
- Level 1 完了に必要: ~6タスク × 3週/サイクル = 18週（理想）
- 実測では actionCapacity 競合で 30-40週

### 14.2.3 将来の改善方針

- **予算不足**: 予算補充ステージの導入（資金ショート時に「追加予算要求」交渉ステージへ遷移）
- **期限切れ**: supervisor の workload 管理・priority 調整、または advance_project の actionCost 軽減
- **成功率全般**: v0.26 時点で89-97%と報告されていたが、v0.28 の deadline 比例化で自然に下がった

### 14.2.4 sell_land プロジェクトが機能していない（v0.29 時点で確認）

`sell_land` プロジェクトの買い手候補選定で `purchaseBuyerTreasuryThreshold: 1500` が高すぎるため、treasury がこの閾値を超える Polity がほぼ存在せず、候補が常に 0 になる。結果として sell_land が実質的に発動しない。

閾値を Polity treasury の実勢値（通常 2000-5000）に対して現実的な値に下げるか、閾値の算出方式自体を見直す必要がある。

---

## 14.3 外交劇バランス（v0.26 時点）

計測条件: 100年 × 4 seed

| 指標 | 値 |
|------|-----|
| 税改定 vs 領地奪取 | 税改定がほぼ全て。領地奪取は 0-22件/100年 |
| 武力衝突率 | 88-92% |
| 交渉決着率 | 8-13% |
| 攻撃側勝率 | 49-57%（ほぼ公平） |
| Polity 数変動 | 100年でほぼ不変（9→9） |

### 課題

- 領地奪取 aim の発生条件が厳しく、税改定が支配的
- 交渉決着メカニズムが弱く escalation しやすい
- 税率変動が5%固定で CONTRACT_ELIMINATED に到達しにくい
- 結果として Polity 数が膠着し、地図の変化に乏しい

### 14.3.1 和平解決が構造的に困難な問題（v0.29 時点で確認）

外交劇の和平解決率が極めて低い（v0.26 計測で 8-13%）。これはバランスの問題ではなく、交渉システム自体の設計ギャップに起因する。

**原因: acceptanceScore が構造的に負になる**

`land_claim` の場合、`acceptanceScore` の正の項は `offeredPrice`（counterDemand 未実装のためほぼ 0）と `defenderTreasuryNeed`（通常は小さい）のみ。一方、負の項（`defenderPower × 0.12`、`provinceValue × 0.3`、`strategicLoss × 0.2`、`prestigeLoss × 0.2`）が支配的で、構造的 progress はほぼ 0 のまま推移する。

タスクベース progress（`negotiate_terms` / `offer_compromise`）で多少は蓄積できるが、同時に initiator 側の `pressure_counterparty` タスクが tension を加算し、構造的 tension 蓄積（毎週 0.33〜4.0）と合わせて escalation 閾値（40）に先に到達する。

**本質的な欠如要素**（小手先のバランス調整では解決不可）:

1. **対案・妥協点の探索** — 現状は「要求を受け入れるか拒絶するか」の二択。counterDemand（「代わりに金銭補償を」「別の土地なら」「税率を下げるなら」等）の応酬で双方の許容範囲が重なる点を見つける仕組みがない
2. **情報の非対称性と駆け引き** — `leverage` / `commitment` / `preparation` の骨格はあるが、交渉テーブル上で実際に条件を動かす仕組みに接続されていない
3. **敗北のコスト** — 武力衝突に負けても特別なペナルティがない。prestige 低下・同盟動揺・内部不満等がなければ、「素直に譲歩する」より「拒絶して戦争する」方が常に合理的

これらは戦争・叛乱システムとの兼ね合いもあり、外交劇全体の設計改修として別途検討する。

### 14.3.2 ステークホルダー共通の国同士の衝突（v0.29 時点で確認）

複数の Polity に Share を持つ House が存在するため、ステークホルダーが共通する国同士が外交劇で衝突することがある。v0.29 で delegate の同一人物重複は防止したが、「そもそも利害が一致する国同士が衝突を起こすべきか」という根本的な問題は未解決。外交劇の設計改修で同時に取り扱う。

### 14.3.3 land_claim が発生しない（v0.29 時点で確認）

`land_claim` を生む aim が事実上発動しない。原因は2つの aim 条件がいずれも初期状態で満たされないこと:

1. **`consolidate_province_holdings`** — 「同一 province 内に自分と他者の holding が混在」が条件。初期状態では各 province の holding は全て同一 polity が保持しており、混在しない。tax revision の結果は税率変更であって holding 移転ではないため、混在状態は自然には生じない
2. **`seize_weak_remote_holdings`** — 隣接 province の holding を狙えるが、`ownPower > targetPower × 1.25` の軍事力差が必要。初期の均衡状態では条件を満たす組み合わせが少ない

v0.29 で `consolidate_province_holdings` の走査バグ（隣接 province 経由ではなく自 province の直接走査に修正）は解決したが、条件自体は変えておらず根本問題は残存。

land_claim を自然に発生させるには、「他者の province の holding を直接狙う」aim 条件（例: 隣接 province の holding を claim する）の追加、または holding 所有権が移動するイベント（戦争結果・相続等）による混在状態の自然発生が必要。外交劇の設計改修と合わせて検討する。

---

## 14.4 人口動態（既知の問題）

### 14.4.1 家門の崩壊

50年で standard の active houses が 54→17 に崩壊する傾向。houseExtinctionSystem で家が消滅すると所属人員も実質的に消える。

**将来の改善方針**: 家が没落しても人員を在野（unaffiliated）に移し、再起の可能性を残す。

---

## 改訂履歴

| バージョン | 変更内容 |
|-----------|---------|
| v0.28 | 初版作成。POP wealth 安定化、Polity 保留額動的化、Project deadline 比例化の観察結果を記録 |
| v0.29 | §14.2.4 sell_land 機能不全、§14.3.1 和平解決構造的問題、§14.3.2 ステークホルダー共通衝突、§14.3.3 land_claim 不発を追記 |
