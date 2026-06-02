# Chronicae プロトタイプ仕様書

最終更新: 2026-06-02（v0.39.1 revolt_negotiation タスク駆動化: ProjectTaskGenerationSystem が revolt_negotiation play に直接タスクを生成（Project 不要）。ハイブリッドモデル（タスク効果が主＝preparation/leverage/commitment で決着閾値を調整、環境因子が副＝POP unrest/鎮圧力の小幅構造的増分）。delegate の能力が交渉結果に影響。§6.25c/§6.27。前回 v0.39 民衆叛乱システム再設計を統合仕様へ反映: ProvinceRevoltSystem を Holding 単位判定に全面改修。TaxRevisionSystem 新設（税率↑→unrest↑→叛乱の上流要因。§6.21b/§5.4）。交渉用 commonwealth（landless rank 5）生成→`popular_tax_relief` demand の revolt_negotiation→settlement/escalation。旧 `revolt_concession` demand・`createRebelPolity`/`disbandRebelPolity`・ConflictResolutionSystem revolt 経路を削除（§6.28 no-op 化）。rank 2-4 escalation: `revolt_seizure` 子契約+Local Levy+War 化（`PopularRevoltIndependenceWarGoal`）。rank 5 internal revolt: 即時解決・regime change。leader death→叛乱崩壊。established commonwealth の emergency leader 補充。attitude 効果（成功時 POP→commonwealth affection/respect、pardoned leader prestige ペナルティ）。新 event: `REVOLT_ESCALATED`・`REVOLT_REGIME_CHANGED`（§8）。前回 v0.38 Chronicle System を統合仕様へ反映: 永続・対象別の歴史閲覧 read-model `ChronicleEntry`（curated allowlist で SimEvent を tick 終端 projection した append-only 履歴 + byPerson/House/Polity/Province/Holding の 5 軸 index。§3.14）。ChronicleProjectionSystem を scheduledSystems 末尾＝flush/IntegrityCheck の前に追加（§5.4 / §6.31）。allowlist は 11 カテゴリ（war/battle/land/house/office/faction/revolt/life/development/governance/disaster）。office は `retainRefKinds:['person']` で byPerson 限定（中核 panel を行政ログで埋めない）。BATTLE_OCCURRED に `outnumberedVictory`/`decisiveVictory` を additive enrich し `selectBattleTemplate` で数的不利/大勝/辛勝の narrative 出し分け（§8）。IntegrityCheck に chronicleIndex↔entry の内部整合検査を追加（soft-ref。参照先の存在は検査しない＝Chronicle を simulation logic に使わない原則の integrity 表現。§6.24）。Chronicle selector（§4.11）・各 detail panel の Chronicle section（国史/家の記録/履歴/地方史/土地の歴史/戦争の記録。§11）。emit 整備: `IMPORTANT_PERSON_DIED`（notable death 昇格で life カテゴリ成立）・`COUNTRY_LAND_DEVELOPED` に holding ref。cap/purge/外部化・視点相対レンダリング・ログ重複整理は将来課題（§13）。前回 v0.37 Battlefront: `simulateBattle` 内部 tick simulation で battle 解決（§6.27b）。）

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
