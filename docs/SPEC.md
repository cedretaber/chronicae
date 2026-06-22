# Chronicae プロトタイプ仕様書

最終更新: 2026-06-23 (v0.58 POP 貨幣経済 — POP の財産を 0..100 `wealth` 指数から具体的な **`money` 残高(stock)** へ移行。source/sink モデル（賃金=mint・消費=burn、抽象市場は非保存のまま流用）。**賃金 mint**: resourceEconomySystem 最終 pass で `wageShare = max(0,netRevenue)×wageShareOfNetRevenue`(0.3) を雇用 PopType へ役割重み付き配分（`computeAssetPopTypeShares × wageRoleWeightByRole`、carve==mint）。LandRevenue は `positiveNet = max(0,netRevenue−wageShare)` で控除。**予算制約消費**: start-of-tick money を essential→ordinary→luxury の tier 優先で充当（full desired×afford、`purchasingPowerFactor` 撤去）。**needSatisfaction**(0..100 intensive) = `Σ tier重み×(afford×marketFill)` 平滑化で unrest/成長/mobility を駆動（0..100 `wealth` 退役）。money は extensive で人口移動/merge は per-capita 保存（移動=比例・merge=sum・死亡=比例burn・出生=据置）。mobility gate は `computePopTypeMoneyQuantiles`（per-capita money）。詳細は §6.3c.5。**v0.58 balance 校正**: 初版（wageRate 0.3・essentialScale 1.0）は賃金が essential 消費の ~15% しか賄えず全 POP が貧困床（needSatisfaction 中央値 ~5）に貼り付く過少消費だった。**essential desire 半減（`popEssentialNeedScale` 0.5）＋ 賃金率 0.3→0.5** で needSatisfaction 中央値 ~5→~45・人口/雇用回復・不穏度 calm（150年×4seed green・determinism 維持）。残課題: 蓄財/富格差は依然 modest・noble POP の現金収入はゼロ（balance-defer、§6.3c.5）。)

v0.57 (v0.57 POP 雇用の職能細分化 ＋ v0.57.1 移動の Class 統一 — 雇用枠を **PopStratum 単位から施設駆動の PopType 単位ハード枠**へ再設計（`RealEstateEmploymentSlot` / `ImprovementEmploymentSlot` を PopType キー化、熟練職の同数上限 `maxRatioTo`、EmploymentRebalance を PopType 単位化、`computeHoldingPopTypeDemand` の desired は施設駆動容量に）。職能効果: 親方/自作農 `directOutputPower 1.5`・書記 `throughputBonus 0.5`（生産）、治安〔兵士・家士〕で unrest 低減・維持〔労働者〕で施設 condition 減衰緩和（管理職能は循環回避のため将来送り、§6.x.v0.57）。**v0.57.1**: POP の移動（転職・移住・昇格・降格）の判断を **Class（PopType）単位に統一**（wealth 相対 gate の母集団を同職能へ・idealShare/currentShare を holding 全体正規化・`classifyMobilityKind` をエッジ所属判定へ・`computeStratumWealthQuantiles`→`computePopTypeWealthQuantiles`）、worldgen 初期 POP を施設駆動 PopType 枠に比例 seed（固定職能分布 `WORLDGEN_POP_TYPE_DISTRIBUTION` を廃止し初期の構造的失業を解消）。詳細は §6.x.v0.57 / §6.3b)

v0.56 (POP 転職・移住システム — v0.55 の PopType / PopStratum / 資源経済 / recipe 労働需要を前提に、POP の自律的な **転職**（同一 holding 内の職種/階層変更 = lateral/promotion/demotion）と **移住**（同一 StateRegion 内の holding 間移動）を追加。EmploymentRebalance → **PopJobChange → PopMigration → PopEmploymentNormalize** → ResourceEconomy の月次連鎖（§6.3b）。共通 mutation `movePopSizeToKeyMut`（size 移送・人口加重 merge・人口保存）、read-model `computeHoldingPopTypeDemand`（施設駆動の PopType 雇用容量 → shortage/surplus、idealShare は holding 全体正規化〔v0.57.1〕）、`computePopTypeWealthQuantiles`（StateRegion × PopType・size 加重の wealth 分位〔v0.57.1: 旧 `computeStratumWealthQuantiles` を職能単位へ〕）。**転職**は候補優先度ループ・holding 人口比 cap（C2）・**promotion/demotion は相対 wealth 分位 gate**（C3。絶対閾値は wealth≈0 で不発）・lateral の capacity gate は employed 増の move のみ（C1）。**移住**は migration pressure 閾値・opportunity score（vacancy/構成ミスマッチ B2/wealth/unrest − cross-polity penalty）・人口比 outflow/inflow cap。RNG 不使用で dump-world bit-identical 維持。read-model `WorldState.monthlyPopMobility`（latest 毎月上書き、UI は Holding=移住 / POP=階層移動・転職 に drill-down、topMovements は store-all 相当）。EmploymentRebalance の再就業は v0.57 で PopType 単位ハード枠へ再設計され、v0.56 の「stratum 跨ぎ shortage 優先」demand-aware Phase2 を置換した（§6.x.v0.57）。詳細は draft `spec-v056-update.md`(r2) / §6.3b)

v0.55 (商品経済への大規模再編 — v0.54 の 3 資源を **21 ResourceKind** へ拡張。**NeedCategory / InputCategory** 導入（POP 需要・recipe 投入をカテゴリ化、カテゴリ内の resource 選択は utilityPerMoney 比率配分で加工品死蔵を回避）。**RealEstateKind を farm/mountain/woodland/workshop** へ再編（一次産業=manor・工房=city）。**ProductionRecipe を 23 種**に細分化（複数 output・複数 input・規模の経済）。**PopType（12 職能）/ PopStratum（旧 PopClass の値移行 lower/middle/upper）** 導入、merge key に popType 追加、RealEstateAsset は複数 stratum を雇用可。需要を PopType 別 `PopNeedProfile` ＋ NeedTier 購買力曲線で定義。**market 清算を DAG 依存順 1-pass** へ一般化（resource level 静的計算・cycle は integrity error・複数 input は Liebig 最小律 + floor 付き inputShortageModifier §6.3c.2）。**laborTypeFulfillmentModifier**（PopType 理想構成への soft modifier、floor 0.70）。**RecipeSwitchSystem (§6.3d)**（四半期・best-improvement・smoothedPrice で recipeSlots 自動入れ替え）。**建設・修繕 Project の建築資材需要**（timber/stone/tools を市場注入、budget を週次・価格ベースで消費）。飢饉=物理 pressure 駆動の急性餓死・干魃=食料生産被害へ整合 (§6.27 / draft §C)。**未実装(deferred)**: 追加予算 top-up・動的 deadline 延長・ProjectMaterialPurchaseSnapshot・一部 integrity 静的検査・市場 digest カテゴリ集約 UI (draft §20–§25)。詳細は draft `spec-v055-update.md`)

v0.54 (資源経済導入 — POP 直接 production を廃止し ResourceEconomySystem (§6.3c) を追加。RealEstateAsset+POP 労働→資源 (food/raw_materials/processed_goods) 生産→StateRegion 市場で売却→money revenue。recipeSlots / ProductionRecipe / MarketResourcePriceState / 月次 HoldingResourceRevenueSnapshot。LandRevenueSystem は資源 snapshot を source に owner income/holding due 分割 (realEstateHoldingDueRate)・bailiff・chain 分配へ再構成。食料/加工品の充足率・価格を POP wealth/unrest に反映。obligation accrual を月額化。**market-clearing rewrite (§6.3c.1): Victoria 3 型の抽象市場へ — sell orders 全量 revenue 化・buy orders 全量 cost 評価・imbalance ベース価格 (marketPriceSwing、資源別 min/max/elasticity 廃止)・fulfillmentRatio / shortage / shortageSeverity による penalty。供給過多は安値で全量売却、供給不足は高価格+shortage penalty。marketValueDelta は市場抽象化で非保存だが LandRevenue 分配の保存則は不変**)

v0.53 (押領・土地契約不履行・時効 — RealEstateSeizure / LandContractDefault 導入、seize/withhold/enforce Project、Pressure 経由の対応、20年時効による既成事実化 (spliceOutClaimantContract)、revolt_seizure 廃止→nominal occupation contract + revolt_independence default、非 root tax-0 invariant、obligationConsistency/Accrual/prescription/cleanupTerminalObligations system 追加)

---

## 目次

| # | 章 | ファイル |
|---|---|---|
| 1 | [概要](spec/01-overview.md) | `spec/01-overview.md` |
| 2 | [技術構成](spec/02-tech-stack.md) | `spec/02-tech-stack.md` |
| 3 | [エンティティ型](spec/03-entities.md) | `spec/03-entities.md` |
| 4 | [セレクター](spec/04-selectors.md) | `spec/04-selectors.md` |
| 5 | [Tick システム順序](spec/05-tick-order.md) | `spec/05-tick-order.md` |
| 6 | [各システムの仕様](spec/06-systems.md) | `spec/06-systems.md` |
| 7 | [Worldgen 初期化](spec/07-worldgen.md) | `spec/07-worldgen.md` |
| 8 | [イベント型一覧](spec/08-event-types.md) | `spec/08-event-types.md` |
| 9 | [SimulationConfig デフォルト値](spec/09-config.md) | `spec/09-config.md` |
| 10 | [人物能力効果](spec/10-ability-effects.md) | `spec/10-ability-effects.md` |
| 11 | [UI 構成](spec/11-ui.md) | `spec/11-ui.md` |
| 12 | [アーキテクチャ原則](spec/12-architecture.md) | `spec/12-architecture.md` |
| 13 | [今後の課題（未実装）](spec/13-future.md) | `spec/13-future.md` |
| 14 | [ゲームバランス観察記録](spec/14-balance.md) | `spec/14-balance.md` |
