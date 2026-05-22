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
| 2 | DevelopmentSystem | 4 | 旧毎月 |
| 3 | ControlSystem | 4 | 旧毎月 |
| 4 | PopSystem | 4 | 旧毎月 |
| 5 | LandRevenueSystem | 4 | 旧毎月 |
| 6 | PolitySurplusDistributionSystem | 4 | 旧毎月 |
| 6b | HouseSurplusDistributionSystem | 4 | 旧毎月 |
| 7 | DisasterSystem | 48 | 旧毎年 |
| 8 | MortalitySystem | 4 | 旧毎月 |
| 8b | EstateSettlementSystem | 4 | Mortality 直後 |
| 9 | SuccessionSystem | 4 | 旧毎月 |
| 10 | MarriageSystem | 48 | 旧毎年 |
| 11 | BirthSystem | 48 | 旧毎年 |
| 11b | UnaffiliatedPersonSystem | 48 | 旧毎年 |
| 11c | OfficeTermSystem | 48 | 旧毎年 |
| 12 | ShareUpdateSystem | 48 | 旧毎年 |
| 13 | AppointmentSystem | 48 | 旧毎年 |
| 13b | BailiffAppointmentSystem | 24 | 旧6ヶ月ごと |
| 14 | OfficeCompensationSystem | 48 | 旧毎年 |
| 14b | FactionPatronageSystem | 48 | 旧毎年 |
| 14c | FactionDefectionSystem | 48 | 旧毎年 |
| 14d | FactionMaintenanceSystem | 4 | v0.19 で分割: leader 死亡時継承・死亡 member 整理 |
| 14e | FactionLifecycleSystem | 48 | v0.19 で分割: 解散判定・新規結成 (年次のみ) |
| 14f | FactionRecruitmentSystem | 48 | 旧毎年 |
| 14g | PersonGrowthSystem | 48 | 旧毎年 |
| 15 | AmbitionSystem | 4 | 旧毎月 |
| 16 | PublicSpendingSystem | 48 | 旧毎年 |
| 17 | ~~HouseDevelopmentSystem~~ | — | **v0.22 で廃止**（§6.17）。土地開発は Polity develop_holding に一本化 |
| 18 | PopDevelopmentSystem | 4 | 旧毎月 |
| 19 | PlotSystem | 4 | 旧毎月 |
| 20 | GoalMaintenanceSystem | 4 | v0.22。生成・レビューは内部 48w ゲート |
| 20b | AimMaintenanceSystem | 4 | v0.22。生成は内部 48w ゲート |
| 20c | IntentGenerationSystem | 48 | 旧毎年。v0.22 で sell_land 専用に縮小 |
| 20d | AimToIntentGenerationSystem | 4 | v0.22 |
| 20e | IntentToDiplomaticPlaySystem | 4 | 旧毎月。v0.22 で goalId/aimId 継承 |
| 20f | IntentActionSystem | 4 | v0.22。Action 系 Intent の即時処理 |
| 21 | ProvinceRevoltSystem | 48 | 旧毎年 |
| 21b | DiplomaticPlaySystem | 4 | 旧毎月 |
| 21c | ConflictResolutionSystem | 4 | 旧毎月 |
| 21d | AimOutcomeSystem | 4 | v0.22。DiplomaticPlay 結果 → Aim progress |
| 21e | GoalOutcomeSystem | 4 | v0.22。Aim 結果 → Goal progress |
| 22b | PolityOwnerConsistencySystem | 4 | 旧毎月 |
| 22c | OrganizationConsistencySystem | 4 | 旧毎月 |
| 23 | AttitudeDecaySystem | 4 | 旧毎月 |
| 24 | GovernanceSystem | 48 | 旧毎年 |
| 25 | normalizePopSizes | 4 | 旧毎月 |
| 25b | CleanupTerminalDiplomacy | 4 | 旧毎月 |
| 25c | CleanupTerminalDecisions | 4 | v0.22。terminal Goal/Aim/orphan DecisionReason 削除 |
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

### 5.7 順序の理由

PopSystem を LandRevenueSystem より前に置くことで、当 tick の POP 状態変化を反映して生産量を計算する。LandRevenueSystem の直後に PolitySurplusDistributionSystem を置くことで、上納後の余剰を即座に Share holder に分配する。ShareUpdateSystem を BirthSystem の後・AppointmentSystem の前に置くことで、最新の人口・家構成を反映した Share 計算結果に基づいて役職候補評価が行われる。AttitudeDecaySystem を反乱・revolt の後に置くことで、各システムが当 tick に書き込んだ態度変化が減衰前に反映される。GovernanceSystem（adminPower キャッシュ計算）は年次実行され、次の 1 年間の各システムで使われる。

---

