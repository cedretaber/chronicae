# Chronicae プロトタイプ仕様書

最終更新: 2026-06-18 (v0.49 会戦スロットモデル — slot 配置 / 三すくみ戦術 / 現場指揮官割当 / 突破・追撃・強制壊滅 / 交戦 contest / 戦列幅縮小 / 恒久 BattleLog を §6.45・§3.9d・§6.51b・§4・§5・§9 へ同期。人物中心の非線形 ability（abilityOutputFactor）は §10.0 に反映。会戦再生 UI は app 層。あわせて v0.48.2 設備の定期保守点検〔condition 3 段モデル / 代官による自動保守〕も §6.6 / §6.6b / §9 に反映済み)

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
