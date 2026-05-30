# 5. Tick システム順序

### 5.1 ScheduledSystem (v0.19)

v0.19 で時間単位を月次 tick (1 tick = 1 ヶ月) から **週次 tick (1 tick = 1 週)** に移行した。1 年 = 48 週 = 12 擬似月 × 4 週。

各 system の実行周期は **ScheduledSystem** として tick scheduler 側で管理する。各 system 内部の `if (currentMonth !== 1) return ctx` ガードは廃止。

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
| ~~2~~ | ~~DevelopmentSystem~~ | — | **v0.27 で削除**。development は HoldingImprovement selector に移行 |
| 3 | ControlSystem | 4 | 旧毎月 |
| 4 | PopSystem | 4 | 旧毎月 |
| 4b | EmploymentRebalanceSystem | 4 | v0.24 追加。capacity 超過→失業、none→再就業 |
| 5 | LandRevenueSystem | 4 | 旧毎月 |
| 6 | PolitySurplusDistributionSystem | 4 | 旧毎月 |
| 6b | HouseSurplusDistributionSystem | 4 | 旧毎月 |
| 7 | DisasterSystem | 48 | 旧毎年 |
| 8 | MortalitySystem | 4 | 旧毎月 |
| 8b | EstateSettlementSystem | 4 | Mortality 直後 |
| 9 | SuccessionSystem | 4 | 旧毎月 |
| 10 | MarriageSystem | 4 | v0.31 で 48→4 に変更 |
| 11 | BirthSystem | 4 | v0.31 で 48→4 に変更 |
| 11a | HouseFoundingSystem | config | v0.31 追加。config `houseFoundingIntervalWeeks` (default 4) |
| 11a2 | HouseSplitEvaluationSystem | config | v0.31 追加。config `houseSplitEvaluationIntervalWeeks` (default 12) |
| 11a3 | ClanFormationSystem | config | v0.32 追加。config `clanFormationIntervalWeeks` (default 48)。Clan 成立判定 + 年次保守 |
| 11b | HouselessPersonGenerationSystem | 4 | 旧 UnaffiliatedPersonSystem を v0.31 で改名 |
| 11c | OfficeTermSystem | 48 | 旧毎年 |
| 12 | ShareUpdateSystem | 48 | 旧毎年 |
| 13 | AppointmentSystem | 12 | v0.23: 48→12 に変更。3ヶ月ごと |
| 13a | BailiffRevenueTaskSystem | 4 | v0.25 追加。代官月次 collect_holding_revenue Task 生成・期限切れ処理 |
| 13b | TaskSystem | 1 | v0.23 追加。毎週。Task 生成・処理・outcome・cleanup 一体 |
| 13c | BailiffAppointmentSystem | 12 | 旧6ヶ月ごと |
| 14 | OfficeCompensationSystem | 4 | 旧毎年→4週ごとに変更 |
| 14b | FactionPatronageSystem | 48 | 旧毎年 |
| 14c | FactionDefectionSystem | 48 | 旧毎年 |
| 14d | FactionMaintenanceSystem | 4 | v0.19 で分割: leader 死亡時継承・死亡 member 整理 |
| 14e | FactionLifecycleSystem | 48 | v0.19 で分割: 解散判定・新規結成 (年次のみ) |
| 14f | FactionRecruitmentSystem | 12 | v0.31 で 48→12 に変更 |
| 14g | PersonGrowthSystem | 48 | 旧毎年 |
| 15 | AmbitionSystem | 4 | 旧毎月 |
| 16 | PublicSpendingSystem | 48 | 旧毎年 |
| 17 | ~~HouseDevelopmentSystem~~ | — | **v0.22 で廃止**（§6.17）。土地開発は Polity develop_holding に一本化 |
| ~~18~~ | ~~PopDevelopmentSystem~~ | — | **v0.27 で無効化**。将来 POP 主導 Project として再導入予定 |
| 19 | PlotSystem | 4 | 旧毎月 |
| 19b | PersonGoalMaintenanceSystem | 48 | v0.23 追加。Person Goal 生成・fulfillment 管理 |
| 19c | PersonAimMaintenanceSystem | 4 | v0.23 追加。Person Aim 生成・deadline/waiting 管理 |
| 20 | GoalMaintenanceSystem | 4 | v0.22。生成・レビューは内部 48w ゲート。owner.kind === 'person' はスキップ |
| 20b | AimMaintenanceSystem | 4 | v0.22。生成は内部 48w ゲート |
| 20c | ProjectPreparationSystem | 4 | v0.26。Aim から prepare_project Task を生成 |
| 20d | SellLandProjectGenerationSystem | 48 | v0.26。財政難 Polity の sell_land Project 直接生成 |
| 20e | ProjectStageSystem | 1 | v0.29。immediate stage 即時解決（open_diplomatic_play, choose_stance, find_supervisor, secure_budget） |
| 20f | ProjectTaskGenerationSystem | 1 | v0.26 / v0.29。active Project の stage に応じて Task を生成（preparatory / final / negotiate） |
| 20g | ProjectMaintenanceSystem | 4 | v0.26。Project 完了/失敗判定、supervisor 再選定 |
| 20h | ProjectOutcomeSystem | 4 | v0.26 / v0.29。Project 効果解決、cleanup。respond_to_pressure completed → Pressure responded |
| 20i | PressureSystem | 1 | v0.29。active Pressure → respond_to_pressure Project 生成 |
| 21 | ProvinceRevoltSystem | 12 | 旧毎年 |
| 21a | cancelOrphanedPlays | 1 | v0.29。orphaned DiplomaticPlay のキャンセル |
| 21b | DiplomaticPlaySystem | 4 | 旧毎月。v0.29 で Task 生成責務を ProjectTaskGenerationSystem に移管 |
| 21b2 | WarCreationSystem | 4 | v0.34 追加。旧 ConflictResolutionSystem の位置。escalated land_claim / contract_tax_revision を War 化 |
| 21c | ConflictResolutionSystem | 4 | v0.34: revolt_negotiation 専用に kind-gate（land_claim / contract_tax_revision は WarCreationSystem へ移行。関数名は `runConflictResolutionSystem` のまま） |
| 21c2 | WarManeuverSystem | 1 | v0.35: 旧 WarProgressSystem を置換（**interval 4→1 毎週**・旧スロット位置維持）。総大将/指揮官 lazy 選出 → 戦場生成 → 回避判断 → battle 解決で warScore 更新（冒頭 dead-participant guard）。**v0.36: per-war mobilize prologue + battle power=Regiment + 損耗/Battle 記録** |
| 21c2b | RegimentRecoverySystem | 1 | v0.36 追加。WarManeuver 直後。active Regiment の organization を週次回復（strength / morale は不変） |
| 21c3 | PeaceSettlementSystem | 4 | v0.34 追加。warScore 閾値到達で終結・WarGoal 実行（冒頭 dead-participant guard） |
| 21d | AimOutcomeSystem | 4 | v0.22。DiplomaticPlay 結果 → Aim progress |
| 21e | GoalOutcomeSystem | 4 | v0.22。Aim 結果 → Goal progress |
| 22b | PolityOwnerConsistencySystem | 4 | 旧毎月 |
| 22c | OrganizationConsistencySystem | 4 | 旧毎月 |
| 22d | cancelOrphanedWarsSystem | 1 | v0.34 追加。**consistency 系の後ろ**。participant 消滅 active War を cancelled 化（理由は下記） |
| 22d2 | RegimentMaintenanceSystem | 1 | v0.36 追加。orphan 回収の後。Regiment の home 消失→disband / terminal 変化→owner 付け替え / owner 消滅→disband / stale war→demobilize（順序厳守。§6.27f） |
| 22d3 | RegimentReinforcementSystem | 4 | v0.36 補充・再編成。maintenance 直後。active strength の silent 月次補充（平時/戦時/動員中係数・home POP・treasury cap）+ destroyed reform（§6.27g） |
| 23 | AttitudeDecaySystem | 4 | 旧毎月 |
| 24 | GovernanceSystem | 48 | 旧毎年 |
| 25 | normalizePopSizes | 4 | 旧毎月 |
| 25b | CleanupTerminalDiplomacy | 1 | v0.29 で interval を 1 に変更。Pressure 同期削除 + 関連 Project cancel |
| 25b2 | cleanupWarSystem | 1 | v0.34 追加。terminal War を `terminalWarRetentionWeeks` 経過後に records / warIndex から削除 |
| 25c | CleanupTerminalDecisions | 4 | v0.22。terminal Goal/Aim/orphan DecisionReason 削除 |
| 25d | mergeCompatiblePops | 48 | v0.24 追加。年末安全弁として同一 merge key の POP を統合 |
| 26 | IntegrityCheck | ※3モード | debug=毎tick(try-catch), integrity-check=毎tick(throw), 通常=week48(throw) |

全 system の `phaseOffsetWeeks = 0`（v0.19 時点）。

### 5.5 IntegrityCheck の 3 モード

IntegrityCheck は ScheduledSystem 配列に含めず、tick 末尾で直接制御する：

- **debug モード**: 毎 tick 実行。違反は try-catch で stderr に出力して継続
- **--integrity-check モード**: 毎 tick 実行。違反は throw して即時停止
- **通常モード**: `currentWeekOfYear === 48`（年末）のみ実行。違反は throw

### 5.6 削除された System

**v0.16**: 旧 LordshipTransitionSystem / EconomySystem / RebellionSystem を廃止。**v0.18**: 旧 WarSystem / LandContractPurchaseSystem を廃止。

Consistency 系 2 つは所領変動 system の直後に走り、所領異動の結果生じた Polity の owner / capital / Share / Office の整合性を即座に補正する（§6.22b / §6.22c 参照）。

**v0.34 War 系の配置**: `WarCreationSystem` は旧 `ConflictResolutionSystem` の位置に入り、`ConflictResolutionSystem` 自身は revolt_negotiation 専用に縮退して直後に残る。二重処理防止は順序依存ではなく kind-gate で保証する（§6.27a / §6.28）。`cancelOrphanedWarsSystem` は当初案（Progress/Settlement の前）から変更し、**consistency 系 2 つの後ろ・intervalWeeks=1** に配置した。理由: PeaceSettlement の holding 移転で landless 化した polity を同 tick 後段の PolityOwnerConsistencySystem が extinct 化する。その polity が別の active War の participant だと、active War は active participant を要求する年末 IntegrityCheck（§6.24 v0.34 項目）で throw するため、consistency の後ろで orphaned War を cancelled 化して回収する。warScore 計算の安全は WarProgress / PeaceSettlement 冒頭の dead-participant guard が担保する。年末検査が必ず本 system 通過後になるよう 1w で走らせる。

### 5.7 順序の理由

PopSystem を LandRevenueSystem より前に置くことで、当 tick の POP 状態変化を反映して生産量を計算する。EmploymentRebalanceSystem を PopSystem と LandRevenueSystem の間に置くことで、人口増加 → 失業/再就業 → 当 tick の就業状態で生産量計算の自然な順序を実現する。LandRevenueSystem の直後に PolitySurplusDistributionSystem を置くことで、上納後の余剰を即座に Share holder に分配する。ShareUpdateSystem を BirthSystem の後・AppointmentSystem の前に置くことで、最新の人口・家構成を反映した Share 計算結果に基づいて役職候補評価が行われる。AppointmentSystem を TaskSystem より前に置くことで、同一週に完了した Task が即座に任官に反映されない（前週までの結果のみが材料になる）自然な順序を実現する。PersonGoalMaintenanceSystem / PersonAimMaintenanceSystem は AppointmentSystem の後だが、TaskSystem が毎週実行されるため前週までの Task 結果は常に利用可能。**v0.29**: TaskSystem → ProjectStageSystem → ProjectTaskGenerationSystem の順序が重要。TaskSystem が preparatory Task を完了し stage を進め、ProjectStageSystem が immediate stage (open_diplomatic_play 等) を即時解決し、ProjectTaskGenerationSystem が次 stage の Task を生成する。この連鎖が同一 tick 内で実現される。PressureSystem は ProjectOutcomeSystem の後に配置し、Pressure 作成後に response Project を生成できるようにする。AttitudeDecaySystem を反乱・revolt の後に置くことで、各システムが当 tick に書き込んだ態度変化が減衰前に反映される。GovernanceSystem（adminPower キャッシュ計算）は年次実行され、次の 1 年間の各システムで使われる。

---

