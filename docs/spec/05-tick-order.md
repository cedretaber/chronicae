# 5. Tick システム順序

### 5.1 ScheduledSystem

時間単位は **週次 tick (1 tick = 1 週)**。1 年 = 48 週 = 12 擬似月 × 4 週。

各 system の実行周期は **ScheduledSystem** として tick scheduler 側で管理する。各 system 内部に月次ガードは持たない。

```ts
type ScheduledSystem = {
  name: string
  intervalWeeks: number
  phaseOffsetWeeks: number
  run: (ctx: TickContext) => TickContext
}

function shouldRun(system: ScheduledSystem, absoluteWeek: number): boolean {
  return (absoluteWeek - system.phaseOffsetWeeks) % system.intervalWeeks === 0
}
```

### 5.2 WorldState の時間表現

```ts
type WorldState = {
  absoluteWeek: number        // 0-based 通算週 — 一次情報源
  currentYear: number         // 表示・利便用キャッシュ (absoluteWeek から導出)
  currentWeekOfYear: number   // 1..48 — 表示・利便用キャッシュ
  ...
}
```

`absoluteWeek` が一次情報源。`currentYear` / `currentWeekOfYear` は `advanceTime` が同期更新する。IntegrityCheck で 3 値の整合性を検証する。

### 5.3 時間定数

```ts
const WEEKS_PER_YEAR = 48
const WEEKS_PER_PSEUDO_MONTH = 4
const WEEKS_PER_SEASON = 12
```

### 5.4 システム実行順序

`advanceTime` は毎 tick 直接実行（ScheduledSystem 対象外）。以下の ScheduledSystem 配列が `shouldRun` で判定される：

| 順序 | システム | intervalWeeks | 備考 |
|------|----------|---:|------|
| 1 | advanceTime | 毎tick | schedule 対象外。毎 tick 実行 |
| 3 | ControlSystem | 4 | |
| 4 | PopSystem | 4 | |
| 4b | EmploymentRebalanceSystem | 4 | capacity 超過→失業、none→再就業 |
| 5 | LandRevenueSystem | 4 | |
| 6 | PolitySurplusDistributionSystem | 4 | |
| 6b | HouseSurplusDistributionSystem | 4 | |
| 7 | DisasterSystem | 48 | |
| 7b | LifeStageInfluenceSystem | 48 | 幼年期/思春期が親・家・親 faction の Attitude を年次継承（§6）。RNG 不使用 |
| 7c | LifeStageProgressionSystem | 48 | LifeStage を年次で一方向に進める（§6）。Influence の直後（influence→progression）。lifeStage を参照する appointment/faction/plot/project/personGoal より前 |
| 8 | MortalitySystem | 4 | |
| 8a | DeadPersonLogPurgeSystem | 4 | Mortality 直後・死亡者 personActivityLog を収集後に purge。v0.44: 死亡者 PersonReputation purge を piggyback |
| 8a2 | PersonReputationCleanupSystem | 48 | v0.44: expiryWeek 超過 + 死亡者残骸の PersonReputation を削除（§6.66） |
| 8b | EstateSettlementSystem | 4 | Mortality 直後 |
| 9 | SuccessionSystem | 4 | |
| 9a | MinorHeadPenaltySystem | 4 | Succession 直後。未成年当主の家メンバー respect / 当主 affection を減衰（§6.12）。独立 system 化で年末 re-pass 二重適用回避 |
| 10 | MarriageSystem | 4 | |
| 11 | BirthSystem | 4 | |
| 11a | HouseFoundingSystem | config | config `houseFoundingIntervalWeeks` (default 4) |
| 11a2 | HouseSplitEvaluationSystem | config | config `houseSplitEvaluationIntervalWeeks` (default 12) |
| 11a3 | ClanFormationSystem | config | config `clanFormationIntervalWeeks` (default 48)。Clan 成立判定 + 年次保守 |
| 11b | HouselessPersonGenerationSystem | 4 | |
| 11c | OfficeTermSystem | 48 | |
| 12 | HouseShareUpdateSystem | 48 | v0.42c: 旧 ShareUpdateSystem。polity 枝は削除され house 専用 |
| 12a | RepublicLeadershipSystem | 48 | v0.46: 共和国（established commonwealth）の任期 leader 交代（§6.68）。AppointmentSystem の前 — 交代後、同年の appointment が新 leader を踏まえて動く |
| 12b | RepublicPoliticalInitializationSystem | 4 | v0.46: 共和国建国式（§6.68）。AppointmentSystem **直前** — 12週発火週は必ず 4週発火週でもあるため、housed 候補で non-leader slot が埋まる前に功臣 seed を成立させる（race 排除） |
| 13 | AppointmentSystem | 12 | 3ヶ月ごと |
| 13a | BailiffRevenueTaskSystem | 4 | 代官月次 collect_holding_revenue Task 生成・期限切れ処理 |
| 13b | TaskSystem | 1 | 毎週。Task 生成・処理・outcome・cleanup 一体 |
| 13c | BailiffAppointmentSystem | 12 | |
| 14 | OfficeCompensationSystem | 4 | |
| 14b | FactionPatronageSystem | 48 | |
| 14c | FactionDefectionSystem | 48 | WI-3 崩壊2: 過伸長離脱加速 (flag-gated・既定 OFF) |
| 14d | FactionMaintenanceSystem | 4 | leader 死亡時継承・死亡 member 整理。WI-3 崩壊1: 継承後の scatter |
| 14e | FactionLifecycleSystem | 48 | 解散判定・新規結成・入れ子形成 (年次のみ) |
| 14f | FactionRecruitmentSystem | 12 | WI-2: 無役待機トラッカー (idleSinceWeek) を全走査で更新しつつ募集 |
| 14g | PersonGrowthSystem | 48 | |
| ~~15~~ | ~~AmbitionSystem~~ | — | v0.51 廃止。陰謀傾向は `conspiracySelectors.computeConspiracyDrive` (selector) に移植 |
| ~~16~~ | ~~PublicSpendingSystem~~ | — | 廃止（実装に存在しない） |
| ~~19~~ | ~~PlotSystem~~ | — | v0.51 廃止。陰謀は Project 化（§6.26。covert goal → 3 陰謀 Project）|
| 19b | PersonGoalMaintenanceSystem | 48 | Person Goal 生成・fulfillment 管理 |
| 19c | PersonAimMaintenanceSystem | 4 | Person Aim 生成・deadline/waiting 管理 |
| 20 | GoalMaintenanceSystem | 4 | 生成・レビューは内部 48w ゲート。owner.kind === 'person' はスキップ |
| 20b | AimMaintenanceSystem | 4 | 生成は内部 48w ゲート |
| 20c | ProjectPreparationSystem | 4 | Aim から prepare_project Task を生成 |
| 20d | SellLandProjectGenerationSystem | 48 | 財政難 Polity の sell_land Project 直接生成 |
| 20e | ProjectStageSystem | 1 | immediate stage 即時解決（open_diplomatic_play, choose_stance, find_supervisor, secure_budget） |
| 20f | ProjectTaskGenerationSystem | 1 | active Project の stage に応じて Task を生成（preparatory / final / negotiate） |
| 20g | ProjectMaintenanceSystem | 4 | Project 完了/失敗判定、supervisor 再選定 |
| 20h | ProjectOutcomeSystem | 4 | Project 効果解決、cleanup。respond_to_pressure completed → Pressure responded |
| 20i | PressureSystem | 1 | active Pressure → respond_to_pressure Project 生成 |
| 20j | TaxRevisionSystem | 48 | 税率引上 → unrest↑ → 叛乱の上流要因。provinceRevoltSystem より前 |
| 21 | ProvinceRevoltSystem | 12 | Holding 単位判定 |
| 21a | cancelOrphanedPlays | 1 | orphaned DiplomaticPlay のキャンセル |
| 21b | DiplomaticPlaySystem | 4 | Task 生成責務は ProjectTaskGenerationSystem が担う |
| 21b2 | WarCreationSystem | 4 | escalated land_claim / contract_tax_revision / revolt_negotiation を War 化 |
| 21c | ConflictResolutionSystem | 4 | no-op（revolt_negotiation の escalation は warCreationSystem 経由で War 化） |
| 21c2 | WarManeuverSystem | 1 | interval 1（毎週）。総大将/指揮官 lazy 選出 → 戦場生成 → 回避判断 → battle 解決で warScore 更新（冒頭 dead-participant guard）。per-war mobilize prologue + battle power=Regiment + 損耗/Battle 記録 |
| 21c2b | RegimentRecoverySystem | 1 | WarManeuver 直後。active Regiment の organization を週次回復（strength / morale は不変） |
| 21c3 | PeaceSettlementSystem | 4 | warScore 閾値到達で終結・WarGoal 実行（冒頭 dead-participant guard） |
| 21d | AimOutcomeSystem | 4 | DiplomaticPlay 結果 → Aim progress |
| 21e | GoalOutcomeSystem | 4 | Aim 結果 → Goal progress |
| 22b | PolityOwnerConsistencySystem | 4 | |
| 22c | OrganizationConsistencySystem | 4 | |
| 22d | cancelOrphanedWarsSystem | 1 | **consistency 系の後ろ**。participant 消滅 active War を cancelled 化（理由は下記） |
| 22d2 | RegimentMaintenanceSystem | 1 | orphan 回収の後。Regiment の home 消失→disband / terminal 変化→owner 付け替え / owner 消滅→disband / stale war→demobilize（順序厳守。§6.49） |
| 22d2b | RightConsistencySystem | 1 | v0.42。regimentMaintenance の owner 同期の**直後**。PoliticalRight の drift（owner 付替 / terminal 変化）を回収し POLITICAL_RIGHT_REVOKED を発行。年末 invariant のため weekly 必須（§6.65） |
| 22d2c | InfluenceModifierConsistencySystem | 1 | v0.51。InfluenceModifier の期限切れ・target 消滅・polity inactive を回収。年末 integrity が liveness を検査するため weekly 必須（rightConsistency と同型・§6.26）|
| 22d3 | RegimentReinforcementSystem | 4 | 補充・再編成。maintenance 直後。active strength の silent 月次補充（平時/戦時/動員中係数・home POP・treasury cap）+ destroyed reform（§6.50） |
| 23 | AttitudeDecaySystem | 4 | |
| 24 | GovernanceSystem | 48 | |
| 25 | normalizePopSizes | 4 | |
| 25a | mergeCompatiblePops | 48 | 年末安全弁として同一 merge key の POP を統合 |
| 25b | CleanupTerminalDiplomacy | 1 | Pressure 同期削除 + 関連 Project cancel |
| 25b2 | cleanupWarSystem | 1 | terminal War を `terminalWarRetentionWeeks` 経過後に records / warIndex から削除 |
| 25c | CleanupTerminalDecisions | 4 | terminal Goal/Aim/orphan DecisionReason 削除 |
| 25e | ChronicleProjectionSystem | 1 | **scheduledSystems 末尾**（全 cleanup の後・flush/IntegrityCheck の前）。この tick の event を curated allowlist で `ChronicleEntry` に projection（§6.62）。生成分も同 tick の年末 IntegrityCheck で index↔entry 検査される |
| 25f | SuccessionSystem (year-end re-pass) | week48 | scheduledSystems 後・flush/IntegrityCheck 前。leaderless House を年末 invariant 成立のため再修復。通常 no-op で bit-identical |
| 26 | IntegrityCheck | ※2モード | debug=week48(try-catch), 通常=week48(throw)。flush も同タイミング |

全 system の `phaseOffsetWeeks = 0`。

### 5.5 IntegrityCheck の 2 モード

IntegrityCheck は ScheduledSystem 配列に含めず、tick 末尾で直接制御する。年末 tick（`currentWeekOfYear === 48`）では、まず SuccessionSystem の year-end re-pass を走らせて「active House は leader を持つ」invariant を確実に成立させ（通常 no-op で bit-identical）、続いて `flushTerminalEntities`（terminal Project の削除）を走らせ、その直後に IntegrityCheck を実行する：

- **通常モード**: `currentWeekOfYear === 48`（年末）のみ実行。違反は throw して即時停止
- **debug モード**: 同じく年末のみ実行。違反は try-catch で stderr に出力して継続（観察継続のため非 fatal）

> **設計契約: 整合性は「年末（cleanup 後 + flush 後）」にのみ成立する。**
> 多くの system が複数週間隔（CleanupTerminalDecisions=4 週 / BailiffAppointment=12 週 / OfficeTerm=年次）で走り、その間は意図的な中間状態（未 flush の terminal Project / `Task → project` dangling / 死亡 office holder 等）を持つ。よって per-tick で IntegrityCheck を回すと必ず誤検知する。
>
> IntegrityCheck は debug / 非 debug いずれも年末のみ走る（debug の flush cadence が通常と一致し determinism も整合）。**mid-year の原因 system 特定は `--integrity-per-system`**（各 system 後に try-catch で違反を log。最初に持続する違反を読む。`run` ヘルパー内で制御、本検査とは独立）が担う。

### 5.6 Consistency 系と War 系の配置

Consistency 系 2 つは所領変動 system の直後に走り、所領異動の結果生じた Polity の owner / capital / Office / PoliticalRight / anchor Faction の整合性を即座に補正する（§6.31 / §6.32 参照）。

**War 系の配置**: `WarCreationSystem` は `ConflictResolutionSystem` の前に入り、`ConflictResolutionSystem` 自身は revolt_negotiation 専用に縮退して直後に残る。二重処理防止は順序依存ではなく kind-gate で保証する（§6.44 / §6.43）。`cancelOrphanedWarsSystem` は **consistency 系 2 つの後ろ・intervalWeeks=1** に配置する。理由: PeaceSettlement の holding 移転で landless 化した polity を同 tick 後段の PolityOwnerConsistencySystem が extinct 化する。その polity が別の active War の participant だと、active War は active participant を要求する年末 IntegrityCheck（§6.35）で throw するため、consistency の後ろで orphaned War を cancelled 化して回収する。warScore 計算の安全は WarManeuver / PeaceSettlement 冒頭の dead-participant guard が担保する。年末検査が必ず本 system 通過後になるよう 1w で走らせる。

### 5.7 順序の理由

PopSystem を LandRevenueSystem より前に置くことで、当 tick の POP 状態変化を反映して生産量を計算する。EmploymentRebalanceSystem を PopSystem と LandRevenueSystem の間に置くことで、人口増加 → 失業/再就業 → 当 tick の就業状態で生産量計算の自然な順序を実現する。LandRevenueSystem の直後に PolitySurplusDistributionSystem を置くことで、上納後の余剰を即座に Share holder に分配する。ShareUpdateSystem を BirthSystem の後・AppointmentSystem の前に置くことで、最新の人口・家構成を反映した Share 計算結果に基づいて役職候補評価が行われる。AppointmentSystem を TaskSystem より前に置くことで、同一週に完了した Task が即座に任官に反映されない（前週までの結果のみが材料になる）自然な順序を実現する。PersonGoalMaintenanceSystem / PersonAimMaintenanceSystem は AppointmentSystem の後だが、TaskSystem が毎週実行されるため前週までの Task 結果は常に利用可能。TaskSystem → ProjectStageSystem → ProjectTaskGenerationSystem の順序が重要。TaskSystem が preparatory Task を完了し stage を進め、ProjectStageSystem が immediate stage (open_diplomatic_play 等) を即時解決し、ProjectTaskGenerationSystem が次 stage の Task を生成する。この連鎖が同一 tick 内で実現される。PressureSystem は ProjectOutcomeSystem の後に配置し、Pressure 作成後に response Project を生成できるようにする。AttitudeDecaySystem を反乱・revolt の後に置くことで、各システムが当 tick に書き込んだ態度変化が減衰前に反映される。GovernanceSystem（adminPower キャッシュ計算）は年次実行され、次の 1 年間の各システムで使われる。

---

