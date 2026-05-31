# Chronicae プロトタイプ仕様書

最終更新: 2026-05-31（v0.37 Battlefront Simulation を統合仕様へ反映: 旧 resolveBattle（power 比 1 回判定）を純粋 helper `simulateBattle` の内部 tick simulation に置換。frontline/reserve deployment → 双方向 organization 主損耗 → morale 感応 rout → reserve 補充 → maxTicks org-margin 決着（§6.27b）。warScoreDelta は internal sim の result から符号 + bounded magnitude（outcomeQuality × decisiveness × preBattle × 勝者 captainGeneralEfficiency。§6.27b）。RegimentRecoverySystem を baseline-aware 化（org/morale を baseline へ収束、§6.27e）。Regiment に baseline/max org/morale、Battle に outcomeQuality/frontage/ticksElapsed/*FrontlineIds/*RoutedIds/breakthroughSide/CommanderAssignments（§3.9b/§3.9c）。指揮官（Battle 単位割当 + 与/被 org damage・rout 補正）・総大将（side-level 被 damage 軽減・rout 耐性、各 ≤10%）の battle 内効果を実値化（C1。§6.27b）。BATTLE_OCCURRED に v0.37 summary を additive enrich（C2。§8 event 一覧）。config 大量追加・旧 damage/commanderModifier 系は未使用化（§9）。前回 v0.36 補充・再編成: RegimentReinforcementSystem（§6.27g 月次）で active プール自己修復）

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
