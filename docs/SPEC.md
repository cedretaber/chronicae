# Chronicae プロトタイプ仕様書

最終更新: 2026-06-21 (v0.54 資源経済導入 — POP 直接 production を廃止し ResourceEconomySystem (§6.3c) を追加。RealEstateAsset+POP 労働→資源 (food/raw_materials/processed_goods) 生産→StateRegion 市場で売却→money revenue。recipeSlots / ProductionRecipe / MarketResourcePriceState / 月次 HoldingResourceRevenueSnapshot。LandRevenueSystem は資源 snapshot を source に owner income/holding due 分割 (realEstateHoldingDueRate)・bailiff・chain 分配へ再構成。食料/加工品の充足率・価格を POP wealth/unrest に反映。obligation accrual を月額化)

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
