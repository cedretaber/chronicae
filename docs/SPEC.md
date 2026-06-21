# Chronicae プロトタイプ仕様書

最終更新: 2026-06-22 (v0.55 商品経済への大規模再編 — v0.54 の 3 資源を **21 ResourceKind** へ拡張。**NeedCategory / InputCategory** 導入（POP 需要・recipe 投入をカテゴリ化、カテゴリ内の resource 選択は utilityPerMoney 比率配分で加工品死蔵を回避）。**RealEstateKind を farm/mountain/woodland/workshop** へ再編（一次産業=manor・工房=city）。**ProductionRecipe を 23 種**に細分化（複数 output・複数 input・規模の経済）。**PopType（12 職能）/ PopStratum（旧 PopClass の値移行 lower/middle/upper）** 導入、merge key に popType 追加、RealEstateAsset は複数 stratum を雇用可。需要を PopType 別 `PopNeedProfile` ＋ NeedTier 購買力曲線で定義。**market 清算を DAG 依存順 1-pass** へ一般化（resource level 静的計算・cycle は integrity error・複数 input は Liebig 最小律 + floor 付き inputShortageModifier §6.3c.2）。**laborTypeFulfillmentModifier**（PopType 理想構成への soft modifier、floor 0.70）。**RecipeSwitchSystem (§6.3d)**（四半期・best-improvement・smoothedPrice で recipeSlots 自動入れ替え）。**建設・修繕 Project の建築資材需要**（timber/stone/tools を市場注入、budget を週次・価格ベースで消費）。飢饉=物理 pressure 駆動の急性餓死・干魃=食料生産被害へ整合 (§6.27 / draft §C)。**未実装(deferred)**: 追加予算 top-up・動的 deadline 延長・ProjectMaterialPurchaseSnapshot・一部 integrity 静的検査・市場 digest カテゴリ集約 UI (draft §20–§25)。詳細は draft `spec-v055-update.md`)

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
