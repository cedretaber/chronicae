# Chronicae プロトタイプ仕様書

最終更新: 2026-05-31（v0.36 Persistent Regiment を統合仕様へ反映: 抽象 getActorMilitaryPower を永続 Regiment entity に置換、Battle entity 導入、mobilize→損耗→recovery→demobilize ループ、RegimentRecoverySystem / RegimentMaintenanceSystem、BATTLE_OCCURRED に battleId/連隊数 counts-only enrich。§3.9b / §3.9c / §5 / §6.27b / §6.27e / §6.27f / §6.28b / §8 / §9 / §11 / §13。前回 v0.35 War Maneuver: WarProgressSystem→WarManeuverSystem、BATTLE_OCCURRED/BATTLE_AVOIDED/WAR_CAPTAIN_GENERAL_CHANGED 追加・WAR_SCORE_CHANGED 廃止、戦勝点 balance）

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
