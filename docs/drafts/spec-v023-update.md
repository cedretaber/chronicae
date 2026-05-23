# Chronicae v0.23 仕様書

## Person Goal / Aim and Task-driven Decision System

作成日: 2026-05-23
改訂日: 2026-05-23 (実装完了後の仕様追従更新)
対象: `prototype/`
前提バージョン: v0.22

---

## 1. v0.23 の目的

v0.23 では、Chronicae に以下の 2 つの基盤を導入する。

```text
1. Person Goal / Aim
   人物が人生目標・価値観を持ち、それに基づいて中期的な狙いを持つ。

2. Task-driven Decision System
   Goal / Aim / Intent / DiplomaticPlay などの進行を、
   抽象的な tick 自動進行ではなく、具体的な人物に割り当てられた Task の完了によって進める。
```

v0.22 では Polity / House に Goal → Aim → Intent の階層的目標システムが導入され、GoalMaintenance / AimMaintenance / AimToIntentGeneration / IntentAction / AimOutcome / GoalOutcome などが追加された。
v0.23 では、この仕組みを Person に拡張しつつ、進行処理を Task-driven に移行する。

v0.23 の設計テーマは以下。

```text
人物は人生目標に基づいて Aim を持ち、
Aim / Intent / DiplomaticPlay は Task に変換され、
具体的な人物が週単位で Task を処理することで歴史が進行する。
```

これにより、Person は単なる能力値付きの人的資源ではなく、
「何を望み、何のために働き、何を成し、何を失敗したか」を持つ歴史上の登場人物になる。

---

## 2. v0.23 の実装範囲

### 2.1 Phase 分割方針

v0.23 は設計変更の規模が大きいため、Phase 分割で段階的に実装する。
各 Phase 後に CLI 300 年 × 4 seed の整合性確認を行う。

```text
Phase A: Person Goal + Person Aim + Task entity + TaskSystem（Person Task のみ）
Phase B: Polity / House Aim の Task-driven 化
Phase C: Intent の Task-driven 化
Phase D: DiplomaticPlay の Task-driven 化
Phase E: UI / i18n / IntegrityCheck
```

### 2.2 必須実装（全 Phase 合計）

```text
- Person Goal
- Person Aim
- Task entity
- TaskSystem
- Task-driven Aim 進行
- Task-driven Intent 進行
- Task-driven DiplomaticPlay 進行
- Task 完了時の軽量 ActivityLog
- AppointmentSystem への Person Aim / Task 効果接続
- UI 表示
- i18n 追加
- IntegrityCheck 拡張
```

### 2.3 可能な限り Task-driven 化する対象

以下は、コード全体の全面書き換え級の工数にならない限り、v0.23 で Task-driven 化する。

```text
- Person Aim
- Polity Aim
- House Aim
- ActorIntent
- DiplomaticPlay
```

v0.22 では Action 系 Intent が即時処理され、Aim progress に直接反映されていた。
v0.23 では、この即時処理を可能な限り Task 経由に置き換える。

### 2.4 v0.23 では将来課題に留めるもの

以下は v0.23 では本格実装しない。

```text
- War entity
- Project entity
- Archive 永続化
- ActivityLog からの年表生成
- ActivityLog からの伝記生成
- 結婚 Aim / 相続 Aim / 派閥 Aim の本格実装
- 第三者外交 participant の高度な介入ロジック
- 複数 Task 分岐シナリオの高度化
- Faction と Person Goal / Aim / Task の直接連携
- DiplomaticPlay の participants 配列化（第三者介入用）
```

ただし、Task-driven entity の設計は、将来の War / Project / Archive に拡張できるようにする。

---

## 3. 既存 v0.22 からの変更方針

### 3.1 旧進行モデル

v0.22 では以下の流れだった。

```text
Goal
  ↓
Aim
  ↓
Intent
  ↓
DiplomaticPlay または Action 系 Intent 即時処理
  ↓
AimOutcome / GoalOutcome
```

v0.22 の Aim は `activeIntentId` / `activeDiplomaticPlayId` を持ち、Intent や DiplomaticPlay と接続されていた。

### 3.2 v0.23 の新進行モデル

v0.23 では、進行中の意思決定 entity は原則として Task によって進む。

```text
Person Aim の場合:
  Goal → Aim → Task → Aim progress → Aim outcome → Goal fulfillment

Polity / House Aim の場合（既存経路を維持）:
  Goal → Aim → Intent → DiplomaticPlay → Task → outcome 反映

Person Aim は Intent / DiplomaticPlay を直接生成しない。
Polity / House Aim は既存 Intent / DiplomaticPlay 経路を維持する。
```

つまり、以下の原則を導入する。

```text
Aim / Intent / DiplomaticPlay の progress は、
原則として tick 経過だけでは増加しない。

progress は、関連 Task の完了・失敗・中断によって更新される。

ただし DiplomaticPlay の構造的進行は弱めて残す（§10.5 参照）。
```

### 3.3 tick が担当すること

tick は引き続き毎週進む。
ただし、tick が直接 Aim / DiplomaticPlay を自動 progress させるのではなく、Task 処理を行う。

```text
tick で行うこと:
- Goal / Aim の生成・失効・waiting 再評価
- Task の生成
- Task の優先度評価
- Person の actionCapacity 内で Task を処理
- Task 完了時の outcome 反映
- deadline 超過判定
- terminal entity cleanup
- active Task の自動キャンセル判定

tick で原則行わないこと:
- Aim.progress の単純な時間加算

tick で弱めて残すこと:
- DiplomaticPlay.progress / tension の構造的進行
  （現行 acceptanceScore ベースの進行量を弱めて維持）
```

---

## 4. 用語定義

### 4.1 Goal

Goal は長期目標である。

ただし、Person Goal と Polity / House Goal は性質が異なる。

```text
Polity / House Goal:
  組織が情勢に応じて選ぶ長期戦略。
  達成・失敗・放棄・差し替えがある。

Person Goal:
  人物の人生目標・価値観・生き方の軸。
  原則として成人時または初期生成時に決まり、通常は変更されない。
  成功・失敗する対象ではなく、fulfillment を持つ。
```

### 4.2 Aim

Aim は、Goal を現在の状況でどう実現するかを表す中期方針である。

```text
Goal = なぜそれを望むか
Aim  = 何を達成しようとしているか
Task = 今週何をするか
```

### 4.3 Intent

Intent は、Aim を制度的・外交的・政治的アクションへ移す中間 entity である。

v0.23 では Intent を残す。
ただし、Intent 自体も Task-driven entity として扱う。

```text
Intent の必要性は将来再評価する。
現時点では Aim から DiplomaticPlay / direct action / 将来 Project / War へ移行する中間状態として維持する。

Person Aim は v0.23 では Intent を直接生成しない。
Intent は Polity / House Aim 専用の中間 entity として維持する。
```

### 4.4 Task

Task は、特定の人物が週単位で処理する具体的な仕事である。

```text
Task:
  誰が
  何のために
  何を
  どれだけの行動力を使って
  どの進行 entity に対して行うか
```

Task は ephemeral である。active Task のみ state に保持し、完了・失敗・キャンセルされた Task は ActivityLog を作成した上で state から削除する。

### 4.5 Task-driven Entity

Task によって進行する entity の総称。

v0.23 で対象とするもの。

```text
- Aim
- Intent
- DiplomaticPlay
```

将来拡張候補。

```text
- Project
- War
- Plot
- FactionConflict
```

---

## 5. Person Goal

### 5.1 Person Goal の性格

Person Goal は、人物の人生目標・価値観である。

```text
Person Goal は基本的に変更されない。
Person Goal は fulfillment を持つ。
fulfillment は、その人物が人生目標をどの程度満たしているかを表す。
```

v0.23 では、成人 normal Person は原則 1 つの active Person Goal を持つ。

### 5.2 PersonGoalKind

```ts
type PersonGoalKind =
  | 'house_loyalty'
  | 'public_service'
  | 'personal_advancement'
  | 'wealth_building'
  | 'self_cultivation'
```

表示名。

```text
house_loyalty        = 家門への献身
public_service       = 公への奉仕
personal_advancement = 立身出世
wealth_building      = 富の蓄積
self_cultivation     = 自己研鑽
```

### 5.3 各 Goal の意味

#### house_loyalty

家門の繁栄・家の影響力・家長や同族への奉仕を重視する。

発生しやすい人物。

```text
- House への affection / respect が高い
- 家長への respect が高い
- House 内 Share が高い
- House office holder
- ambition が低〜中
```

#### public_service

Polity や公的秩序への奉仕を重視する。

発生しやすい人物。

```text
- Polity への affection / respect が高い
- Polity leader への respect が高い
- Polity office holder
- learning / insight / charisma が高い
- ambition が低〜中
```

#### personal_advancement

自分の地位・役職・名声を高めることを重視する。

発生しやすい人物。

```text
- ambition が高い
- 能力が高い
- 役職を持たない、または低位役職のみ
- legacyPrestige が低〜中
- caution が低いほど高リスクな出世 Aim を選びやすい
```

#### wealth_building

財産形成・収入機会・高給職を重視する。

発生しやすい人物。

```text
- wealth が低い
- ambition が高い
- numeracy が高い
- treasurer / bailiff など財務系機会がある
```

#### self_cultivation

能力向上・学問・武芸・実務能力の成長を重視する。

発生しやすい人物。

```text
- 若い
- ability が aptitude より低い
- 役職や Task 負荷が少ない
- ambition が中〜高
- caution が高い人物も安全な自己研鑽を選びやすい
```

### 5.4 Person Goal fulfillment

Person Goal は `fulfillment` を持つ。

fulfillment は `baseFulfillment`（Goal.progress に格納）と `currentFulfillment`（selector で算出）に分かれる。

```ts
// baseFulfillment: Aim 完了・重大イベントで変化する蓄積値
// Goal.progress に格納。0..100。
baseFulfillment = goal.progress

// currentFulfillment: baseFulfillment + 現在状況由来の modifier
// selector で算出。表示・判定に使う。
function getPersonGoalFulfillment(state: WorldState, personId: PersonId): number
```

currentFulfillment の加算要素例。

```text
house_loyalty:
  + House office を持っている
  + 家長への respect が高い
  + House Share が高い

public_service:
  + Polity office を持っている
  + Polity への affection が高い

personal_advancement:
  + 高位の office を持っている
  + legacyPrestige が高い

wealth_building:
  + wealth が高い

self_cultivation:
  + ability が aptitude に近い / 超えている
```

baseFulfillment（Goal.progress）は以下で更新される。

```text
- Person Aim succeeded / failed
- 役職任命・解任（goalOutcomeSystem 経由、または個別イベント時）
```

段階。

```text
0〜24   frustrated  満たされていない
25〜59  seeking     追求中
60〜89  satisfied   かなり満たされている
90〜100 fulfilled   達成感がある
```

### 5.5 fulfillment の効果

```text
fulfillment が低い:
  - 対応 Aim の生成スコアが上がる
  - 関連 Task の priority が上がる
  - ambition が高い人物はより焦る

fulfillment が高い:
  - 新しい個人 Aim を作りにくくなる
  - ambition が低い人物は満足・無気力化しやすい
  - caution が高い人物は保守化しやすい
```

ただし、fulfillment が高いことによる無気力化は v0.23 では軽く扱う。

```text
v0.23 では actionCapacity を大きく下げない。
個人 Aim 生成スコアの低下を主な表現とする。
```

---

## 6. Person Aim

### 6.1 PersonAimKind

```ts
type PersonAimKind =
  | 'support_organization_aim'
  | 'increase_house_influence'
  | 'obtain_office'
  | 'retain_office'
  | 'accumulate_wealth'
  | 'improve_ability'
```

### 6.2 Aim の意味

#### support_organization_aim

House / Polity の Aim を支援する。

```text
主な Goal:
- house_loyalty
- public_service
```

target は支援対象 Aim。

```ts
target: { kind: 'aim'; id: AimId }
```

支援方式: Person が組織 Task の assignee として優先的に引き受けることで支援する。
Person の Aim progress は、組織 Task を処理した件数で進む。

Phase A では `support_organization_aim` は生成しない（§6.5 参照）。
Phase B で Polity / House Aim の Task-driven 化後に有効化する。

#### increase_house_influence

House の影響力を増やす。

```text
主な Goal:
- house_loyalty
- personal_advancement
```

対象例。

```text
- House の Polity Share
- House の役職占有
- House legacyPrestige
```

#### obtain_office

役職を得る。

```text
主な Goal:
- personal_advancement
- house_loyalty
- public_service
- wealth_building
```

target は役職。

```ts
target: {
  kind: 'office'
  organization: DecisionSubjectRef // house or polity
  role: OfficeRole
}
```

#### retain_office

現在の役職を維持する。

```text
主な Goal:
- personal_advancement
- public_service
- wealth_building
- house_loyalty
```

成功条件: 次回の任官サイクルまで対象 office を維持していること。
失敗条件: 解任された、または任期終了時に再任されなかった。

#### accumulate_wealth

個人資産を増やす。

```text
主な Goal:
- wealth_building
```

成功条件: Aim 作成時の wealth + wealthAccumulationThreshold（config 値）に到達。

#### improve_ability

能力を伸ばす。

```text
主な Goal:
- self_cultivation
- personal_advancement
- public_service
```

target は能力。

```ts
target: {
  kind: 'ability'
  ability: AbilityKey
}
```

### 6.3 Goal と Aim の対応

```text
house_loyalty:
  - support_organization_aim
  - increase_house_influence
  - obtain_office
  - retain_office

public_service:
  - support_organization_aim
  - retain_office
  - improve_ability

personal_advancement:
  - obtain_office
  - retain_office
  - improve_ability
  - increase_house_influence

wealth_building:
  - accumulate_wealth
  - obtain_office
  - retain_office

self_cultivation:
  - improve_ability
```

### 6.4 active Aim 数

v0.23 では単純化のため、Person は原則として active Aim を 1 つだけ持つ。

```text
Person active Goal: 原則 1
Person active Aim: 原則 1
Task: 複数可
```

Task は国・家・外交・役職からも割り当てられるため、Aim が 1 つでも人物の行動競合は発生する。

### 6.5 Phase A で有効な PersonAimKind

Phase A では `support_organization_aim` は生成対象から除外する。
この Aim は、Phase B で Polity / House Aim の Task-driven 化が入った後に有効化する。

```text
Phase A で生成する PersonAimKind:
  - increase_house_influence
  - obtain_office
  - retain_office
  - accumulate_wealth
  - improve_ability

Phase B で追加:
  - support_organization_aim
```

Phase A では `house_loyalty` / `public_service` Goal の人物も、既存の個人 Aim に写像する。

```text
house_loyalty（Phase A）:
  increase_house_influence
  obtain_office（家の利益になる役職）
  retain_office（家の利益になる現職維持）

public_service（Phase A）:
  retain_office
  obtain_office（公務に適した役職）
  improve_ability
```

### 6.6 PersonAimKind → TaskKind 対応表

```text
support_organization_aim:
  Phase A では生成しない。

  Phase B 以降:
    Person が組織 Task の assignee になり、処理件数で progress。
    targetProgress: 3
    success: targetProgress 到達、または対象組織 Aim succeeded
    failure: 対象組織 Aim failed / abandoned

increase_house_influence:
  initial Task: promote_house_influence
  repeat: promote_house_influence
  targetProgress: 3
  success: targetProgress 到達
  failure: deadline 超過
  effect: House の Polity Share rawPower / legacyPrestige に小幅加算

obtain_office:
  initial Task: display_competence
  next Task: seek_office_support
  targetProgress: 2
  success: 対象 office に任官された
  failure: deadlineWeek 超過、対象 office 消滅、対象組織から外れた
  任官待ち:
    seek_office_support 完了後、Aim は activeTaskId をクリアし、
    waitingReasonKey = 'waiting.appointment_cycle' を設定。
    nextReviewWeek = currentWeek + 12 を設定。
    Task 成功効果は Appointment modifier として currentWeek + 16 週有効。
  再試行:
    nextReviewWeek 到達時にまだ任官していない場合、
    deadlineWeek 未満なら次 Task（seek_office_support）を再生成して再試行。
    deadlineWeek 超過なら Aim failed。

retain_office:
  initial Task: perform_office_duties
  repeat: perform_office_duties または defend_office_position
  targetProgress: 2
  success: targetProgress 到達（v0.23 では Task 進行ベースで判定。将来、任官サイクルとの連動を追加予定）
  failure: deadline 超過、または解任された

accumulate_wealth:
  initial Task: seek_profitable_assignment
  next Task: manage_accounts（以降交互に繰り返す）
  targetProgress: 3
  success: targetProgress 到達
  failure: deadline 超過

improve_ability:
  initial Task: ability target に応じて以下のいずれか
    valor / command → practice_arms
    numeracy → study_accounts
    learning → study_law
    charisma / insight → courtly_training
  repeat: 同種 Task
  targetProgress: 3
  success: targetProgress 到達
  failure: deadline 超過
  effect: Task は直接 ability を上げず、abilityExperience を蓄積する。
          personGrowthSystem が年次成長判定時に experience bonus として参照する。
```

### 6.7 Person Aim の deadlineWeek

Person Aim は作成時に deadlineWeek を設定する。

```text
obtain_office:         createdWeek + 96（2年。複数回の Appointment cycle に挑戦できる）
retain_office:         createdWeek + 48（1年。任期維持・再任確認の単位）
increase_house_influence: createdWeek + 96（2年。中期的な影響力工作）
accumulate_wealth:     createdWeek + 96（2年。短すぎると不自然）
improve_ability:       createdWeek + 96（2年。年次 personGrowthSystem を跨ぐ）
support_organization_aim: Phase B 以降。対象 organization Aim の deadlineWeek を上限にする
```

### 6.8 Person Aim は Intent / DiplomaticPlay を生成しない

```text
Person Aim は v0.23 では Intent / DiplomaticPlay を直接生成しない。
Person Aim は Task のみで進行する。

aimToIntentGenerationSystem は Polity / House Aim 専用とし、
Person Aim は対象外とする。
```

ただし、Person Aim が組織 Aim / DiplomaticPlay を間接的に支援することはある。

```text
support_organization_aim:
  Person が組織 Task を優先的に引き受けることで支援。

obtain_office:
  AppointmentSystem への補正として間接作用。

increase_house_influence:
  House の Share / prestige 系処理へ間接接続。
```

---

## 7. Task

### 7.1 Task の役割

Task は、Person が週単位で処理する具体作業である。

Task は以下の entity を進行させる。

```text
- Aim
- Intent
- DiplomaticPlay
- 将来 Project
- 将来 War
```

### 7.2 TaskTargetRef

```ts
type TaskTargetRef =
  | { kind: 'aim'; id: AimId }
  | { kind: 'intent'; id: ActorIntentId }
  | { kind: 'diplomatic_play'; id: DiplomaticPlayId }
```

将来拡張用の `project` / `war` は、実装時に追加する。
v0.23 では上記 3 種のみ。

### 7.3 TaskStatus

```ts
type TaskStatus =
  | 'active'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
```

### 7.4 Task 型

```ts
type TaskId = string & { readonly __brand: 'TaskId' }

type Task = {
  id: TaskId

  owner: DecisionSubjectRef
  assigneePersonId: PersonId

  kind: TaskKind
  targetRef: TaskTargetRef

  priority: number
  actionCost: number

  effortRequired: number
  effortDone: number

  createdWeek: number
  deadlineWeek?: number

  status: TaskStatus

  reasonIds: DecisionReasonId[]
}
```

Task は ephemeral である。active Task のみ `state.tasks` に保持する。
完了・失敗・キャンセルされた Task は ActivityLog を作成した上で `state.tasks` から削除する。

ID は再利用しない（`nextTaskId` は単調増加）。

### 7.5 owner と assignee

```text
owner:
  Task を発生させた主体。
  person / house / polity のいずれか。

assigneePersonId:
  実際に Task を処理する人物。
```

例。

```text
Person Aim 由来 Task:
  owner = { kind: 'person', id: personId }
  assigneePersonId = 本人

House Aim 由来 Task:
  owner = { kind: 'house', id: houseId }
  assigneePersonId = 家長または House office holder

Polity Aim 由来 Task:
  owner = { kind: 'polity', id: polityId }
  assigneePersonId = Polity office holder

DiplomaticPlay Task:
  owner = initiator / target の PoliticalActorRef を DecisionSubjectRef に変換
  assigneePersonId = delegatePersonId
```

assignee 選定時、placeholder Person は選ばない。
通常 Person がいない場合は Task を生成せず、Aim は blocked（blockedReasonKey = 'no_assignee'）になる。

### 7.6 actionCost と actionCapacity

Task は `actionCost` を持つ。
Person は週ごとの `weeklyActionCapacity` を持つ。

```text
1週間の間に、Person は actionCapacity が許す限り Task を処理する。
```

v0.23 では `weeklyActionCapacity` は Person に直接保存せず、selector で算出する。

```ts
function getPersonWeeklyActionCapacity(state: WorldState, personId: PersonId): number
```

初期仕様。

```text
normal adult Person:
  base 2.0

placeholder Person:
  0

高齢（60 歳以上）:
  -0.5

ambition 0.7 以上:
  +0.5

重病・疲労など:
  v0.23 では未実装
```

actionCost / effortRequired のデフォルト値。

```text
軽い Task（study_*, courtly_training, manage_accounts）:
  actionCost: 0.5
  effortRequired: 2

通常 Task（promote_house_influence, perform_office_duties, display_competence,
           seek_office_support, defend_office_position, seek_profitable_assignment,
           support_organization_plan, prepare_intent, secure_internal_support）:
  actionCost: 1.0
  effortRequired: 3

重い Task（prepare_argument, gather_claim_evidence, negotiate_terms,
           pressure_counterparty, offer_compromise, undermine_counterparty_position）:
  actionCost: 1.0
  effortRequired: 4
```

各 TaskKind の actionCost / effortRequired は config で定義し、実行時に参照する。

### 7.7 actionCapacity と成果量は分ける

```text
actionCapacity:
  何件・どれだけの Task に取り組めるか。

task progress:
  取り組んだ Task がどれだけ進むか。
```

つまり、精力的だが無能な人物は多くの Task に手を出すが成果は小さい。
寡黙だが有能な人物は処理数は少なくても成果が大きい。

### 7.8 TaskKind

v0.23 で使用する TaskKind（統一型）。

```ts
type TaskKind =
  // Aim / organization support
  | 'support_organization_plan'
  | 'promote_house_influence'
  | 'perform_office_duties'

  // office
  | 'seek_office_support'
  | 'display_competence'
  | 'defend_office_position'

  // wealth
  | 'manage_accounts'
  | 'seek_profitable_assignment'

  // self-improvement
  | 'study_law'
  | 'study_accounts'
  | 'practice_arms'
  | 'courtly_training'

  // intent preparation
  | 'prepare_intent'
  | 'secure_internal_support'

  // intent action（旧 IntentActionSystem 即時処理の Task 化）
  | 'secure_development_budget'
  | 'supervise_holding_development'
  | 'arrange_patronage'
  | 'commission_chronicle_work'

  // diplomatic play
  | 'prepare_argument'
  | 'gather_claim_evidence'
  | 'negotiate_terms'
  | 'pressure_counterparty'
  | 'offer_compromise'
  | 'undermine_counterparty_position'
```

`DiplomaticPlayTaskKind` は作らない。全て `TaskKind` に統合する。

### 7.9 Task 持ち越し

```text
active Task は actionCapacity 不足で処理されなかった場合、翌週に持ち越す。
翌週、effectivePriority を再計算する。

同一 assigneePersonId / targetRef / kind の active Task が既にある場合、
重複する Task は新規生成しない。
```

### 7.10 Task キャンセル条件

TaskSystem は毎週の処理冒頭で、以下の条件に該当する active Task を自動キャンセルする。

```text
Task を cancel する条件:
- assigneePersonId が存在しない / dead / placeholder
- owner が inactive（Polity 消滅、House 断絶、Person 死亡）
- targetRef の参照先 entity が存在しない
- targetRef の参照先 entity が terminal status
- obtain_office の対象 office が無効化された
- DiplomaticPlay が terminal status
```

キャンセル時の target 側処理。

```text
Person Aim 由来 Task:
  Aim の activeTaskId をクリア。
  再割当可能なら次回 TaskSystem で再生成。
  再割当不能なら Aim に blockedReasonKey を設定。

Organization Aim 由来 Task:
  assignee 再選定を試みる。
  再選定不能なら activeTaskId をクリアし、次回 TaskSystem で再試行。

DiplomaticPlay Task:
  delegate 再選定を試みる。
  再選定不能なら Task なしで structuralPower のみ進行。
```

---

## 8. Task 生成と Aim 進行

### 8.1 基本ルール

```text
1つの active Aim は、原則として最大 1 つの active Task を持つ。
Aim 作成時に initial Task を生成する。
Task 完了時に Aim progress が進む。
Aim がまだ完了していなければ、次の Task を生成する。
Task を生成できない場合、Aim は waiting（waitingFor あり）または blocked（blockedReasonKey あり）になる。
```

### 8.2 Aim に追加するフィールド

既存 Aim に以下を追加する。

```ts
type Aim = {
  ...existing fields...

  // v0.23 追加
  activeTaskId?: TaskId

  waitingFor?: TaskTargetRef
  waitingReasonKey?: string
  blockedReasonKey?: string

  nextReviewWeek?: number
}
```

AimStatus は v0.23 では拡張しない。既存のまま維持する。

```ts
type AimStatus =
  | 'active'
  | 'succeeded'
  | 'failed'
  | 'abandoned'
```

waiting / blocked は `status` ではなく補助フィールドで表現する。

```text
status === 'active' かつ waitingFor / waitingReasonKey / blockedReasonKey いずれもなし:
  通常 active（Task 処理中）

status === 'active' かつ waitingFor あり:
  active だが、参照可能な entity（Intent / DiplomaticPlay / 他 Aim）の解決を待っている

status === 'active' かつ waitingReasonKey あり:
  active だが、entity ではない機会を待っている（appointment cycle 待ち等）
  nextReviewWeek に到達したら再評価する

status === 'active' かつ blockedReasonKey あり:
  active だが Task 生成不能（assignee 不在、target 無効等）
```

使い分け。

```text
waitingFor:
  active Intent / DiplomaticPlay / 他 Aim など、参照可能な entity を待つ場合

waitingReasonKey:
  appointment cycle 待ち、機会待ち、定期再評価待ちなど、entity 参照では表せない待機理由

blockedReasonKey:
  assignee 不在、target 無効、条件不成立など、現時点で進行不能な理由
```

これにより、既存の terminal 判定（`TERMINAL_AIM_STATUS`）を壊さずに
waiting / blocked の意味を持たせられる。

### 8.3 Aim progress フィールドの共存ルール

Aim は以下の進行先フィールドのうち、同時に最大 1 つのみをセットする。

```ts
type Aim = {
  activeTaskId?: TaskId          // Task 直接進行
  activeIntentId?: ActorIntentId // Intent 経由進行
  activeDiplomaticPlayId?: DiplomaticPlayId // DiplomaticPlay 経由進行
}
```

制約。

```text
activeTaskId / activeIntentId / activeDiplomaticPlayId は同時に 2 つ以上セットしない。
```

使い分け。

```text
Person Aim:
  原則 activeTaskId のみ。
  Intent / DiplomaticPlay は生成しない。

Polity / House Aim（Action 系: develop_owned_holding, patronize_artist 等）:
  activeIntentId → Intent 側の activeTaskId で Task に進む。

Polity / House Aim（Diplomatic 系: consolidate_province_holdings 等）:
  activeIntentId → activeDiplomaticPlayId に進む。
  DiplomaticPlay 側で Task を管理する。
```

### 8.4 Aim progress

既存 Aim の `progress` / `targetProgress` を使う。

v0.23 では以下の意味に寄せる。

```text
progress:
  完了済み Task 段階数、または Task outcome による進行値。

targetProgress:
  Aim 完了に必要な進行値。
```

例（§6.5 の対応表を参照）。

```text
improve_ability:
  targetProgress = 3
  study_law Task 完了ごとに progress +1

obtain_office:
  targetProgress = 2
  display_competence + seek_office_support で progress
  最終的な Appointment 成功で Aim succeeded
```

### 8.5 Task 完了時処理

TaskSystem 内で一体処理する。

疑似コード。

```ts
function onTaskCompleted(state: WorldState, task: Task): void {
  const outcome = resolveTaskOutcome(state, task)

  applyTaskOutcomeToTarget(state, task, outcome)
  createPersonActivityLog(state, task, outcome)

  // 完了した Task を state.tasks から削除
  removeTask(state, task.id)

  const nextTask = createNextTaskForTarget(state, task.targetRef, task, outcome)

  if (nextTask) {
    addTask(state, nextTask)
    setActiveTaskRef(state, task.targetRef, nextTask.id)
    return
  }

  resolveTargetIfComplete(state, task.targetRef, outcome)
}
```

### 8.6 waiting / blocked

Aim が Task を作れない場合、waitingFor または blockedReasonKey を設定する。

```text
waitingFor あり（機会待ち）:
  時間経過や他 entity 解決で再開可能。

blockedReasonKey あり（阻害）:
  担当者不在、対象消滅、条件不成立など。
```

```text
waitingFor:
  Intent / DiplomaticPlay / Aim など entity を待つ場合に使う。

waitingReasonKey:
  AppointmentSystem のような system tick や機会待ちに使う。
  waitingFor と waitingReasonKey は同時に使わない。

nextReviewWeek:
  waitingReasonKey 設定時に、再確認する週を指定する。
  この週に到達したら、待機条件を再評価する。
```

例。

```text
obtain_office:
  seek_office_support 完了後:
    activeTaskId をクリア
    waitingReasonKey = 'waiting.appointment_cycle'
    nextReviewWeek = currentWeek + 12
  次回 AppointmentSystem で任官:
    Aim succeeded
  nextReviewWeek 到達時にまだ任官していない:
    deadlineWeek 未満なら次 Task を生成して再試行
    deadlineWeek 以上なら Aim failed

support_organization_aim（Phase B 以降）:
  支援対象 Aim が terminal → Aim を failed / abandoned に遷移

increase_house_influence:
  有効な Polity がない → blockedReasonKey = 'no_valid_polity'
```

---

## 9. Intent の Task-driven 化

### 9.1 Intent の役割

v0.23 では Intent を残す。

Intent は Polity / House Aim から、より具体的な制度的・外交的・政治的アクションへ移るための中間状態である。

Person Aim は Intent を経由しない（§6.6 参照）。

### 9.2 Intent に追加するフィールド

```ts
type ActorIntent = {
  ...existing fields...
  activeTaskId?: TaskId
  waitingReasonKey?: string
  progress?: number
  targetProgress?: number
}
```

実装負荷が大きい場合、Intent の progress は省略し、Task 完了時に即変換してもよい。

### 9.3 Intent の Task 化

v0.22 の Action 系 Intent は、可能な限り即時処理をやめる。

対象。

```text
develop_holding
expand_polity_share
promote_policy_shift
patronize_artist
commission_chronicle
```

v0.23 の変換例。

```text
develop_holding:
  Intent 作成
  → Task: secure_development_budget（assignee: Polity office holder）
  → Task: supervise_holding_development
  → Holding development 増加

expand_polity_share:
  Intent 作成
  → Task: promote_house_influence（assignee: House head）
  → OrganizationShare rawPower 増加

patronize_artist:
  Intent 作成
  → Task: arrange_patronage（assignee: House head）
  → House wealth 減少、legacyPrestige 増加
```

ただし、実装負荷が大きい場合は一部の Action 系 Intent の旧処理を残してよい。
その場合、当該処理は将来 Task-driven 化対象として TODO に明記する。

### 9.4 IntentGenerationSystem と AimToIntentGenerationSystem の役割分担

```text
intentGenerationSystem:
  旧 pressure-driven / sell_land 系の Intent 生成を担当。
  v0.23 では可能なら縮小維持。

aimToIntentGenerationSystem:
  Polity / House Aim から Intent を生成する。
  Person Aim は対象外。

PersonAimMaintenanceSystem:
  Person Aim を生成し、直接 Task を生成する。
```

---

## 10. DiplomaticPlay の Task-driven 化

### 10.1 基本方針

DiplomaticPlay は Task-driven entity とする。

DiplomaticPlay は Task に置き換えない。
相手方・要求・緊張度・妥協・決裂を持つ独立概念として維持する。

ただし、DiplomaticPlay の進行に Task による影響を追加する。

### 10.2 DiplomaticPlay の構造（v0.23）

v0.23 では participants 配列化しない。
現行の initiator / target flat 構造を維持し、delegate と交渉パラメータを追加する。

```ts
type DiplomaticPlay = {
  ...existing fields...

  // 既存フィールド維持
  initiator: PoliticalActorRef
  target: PoliticalActorRef

  // v0.23 追加: delegate
  initiatorDelegatePersonId?: PersonId
  targetDelegatePersonId?: PersonId

  // v0.23 追加: 交渉パラメータ（initiator 側）
  initiatorPreparation: number   // 0..100
  initiatorLeverage: number      // 0..100
  initiatorCommitment: number    // 0..100

  // v0.23 追加: 交渉パラメータ（target 側）
  targetPreparation: number
  targetLeverage: number
  targetCommitment: number

  // v0.23 追加: active Task
  initiatorActiveTaskIds: TaskId[]
  targetActiveTaskIds: TaskId[]
}
```

将来、第三者介入を実装する段階で participants 配列への移行を検討する。
v0.23 では initiator / target の flat 構造を維持する。

### 10.3 delegatePersonId

各 side は交渉担当者を持つ。

```text
delegatePersonId:
  交渉 Task を優先的に担当する人物。
```

選定方針。

```text
Polity:
  advisor / administrator / leader から選ぶ。
  charisma / insight が高い人物を優先。

House:
  house leader / advisor / administrator から選ぶ。
```

適任者がいない場合は leader を fallback とする。

### 10.4 DiplomaticPlay Task

DiplomaticPlay Task は delegate に割り当てる。

TaskKind（§7.8 に統合済み）。

```text
prepare_argument:
  leverage +小〜中

gather_claim_evidence:
  leverage +中

secure_internal_support:
  commitment +中

negotiate_terms:
  DiplomaticPlay progress +中

pressure_counterparty:
  相手への圧力 +中、tension +中

offer_compromise:
  progress +中、tension -小

undermine_counterparty_position:
  相手 leverage -小〜中、失敗時 tension +中
```

#### DiplomaticPlay Task の選定ロジック

v0.23 では、Task 選定はクリティカル欠陥チェック + 候補スコアリング方式で行う。

```text
1. クリティカル欠陥チェック（パラメータ < 30）:
   preparation < 30 → prepare_argument を即時選択
   leverage < 30 → gather_claim_evidence を即時選択
   commitment < 30 → secure_internal_support を即時選択

2. 候補スコアリング:
   各 TaskKind に base スコア + abilityBonus を計算し、最高スコアを選択。
   base スコアは initiator / target の role で異なる:

   initiator 側:
     pressure_counterparty: 12  （攻勢重視）
     undermine_counterparty_position: 10
     negotiate_terms: 8
     offer_compromise: 5 + urgencyBonus

   target 側:
     negotiate_terms: 12  （防衛・合意重視）
     offer_compromise: 10 + urgencyBonus
     pressure_counterparty: 6
     undermine_counterparty_position: 8

   abilityBonus = delegate の関連能力 × 0.1
```

#### delegate 能力の効果量への影響

DiplomaticPlay Task の完了時、交渉パラメータの変化量に delegate の能力に基づく倍率を適用する。

```text
effectMultiplier = 0.5 + relevantAbility / 100

relevantAbility は TaskKind ごとに異なる:
  prepare_argument: learning
  gather_claim_evidence: insight
  negotiate_terms: charisma
  pressure_counterparty: command
  offer_compromise: insight
  undermine_counterparty_position: charisma
  secure_internal_support: charisma

能力 0 → 倍率 0.5x（半分の効果）
能力 50 → 倍率 1.0x（標準）
能力 100 → 倍率 1.5x（1.5 倍の効果）
```

### 10.5 structuralPower と playAdvantage の併用

DiplomaticPlay の結果は、Task の速さだけで決めない。
現行の構造的進行計算を弱めて維持しつつ、Task で playAdvantage を蓄積する。

進行中の処理。

```text
DiplomaticPlay 進行（毎月）:
  structuralProgress = 現行 acceptanceScore ベースの進行量 × config.structuralProgressFactor
  （推奨初期値: structuralProgressFactor = 0.33）

  Task 完了時:
    TaskKind に応じて preparation / leverage / commitment を更新
```

最終判定。

```text
v0.23 実装では、解決判定は既存の progress ベース（acceptanceScore による
settlementThreshold 到達）を structuralProgressFactor で弱化して維持する。

playAdvantage（preparation / leverage / commitment の平均）は computePlayAdvantage()
として定義されているが、v0.23 では settlement 判定への直接組み込みは行わない。
交渉パラメータは Task 完了時に更新され、将来の拡張で finalScore 計算に統合可能。

delegate の能力は Task 処理の effort 量と、diplomatic task effect multiplier
（0.5 + abilityValue / 100）を通じて交渉パラメータの変化量に影響する。
```

v0.23 での実質的な効果。

```text
- structuralProgress が弱化（×0.33）されたため、解決に時間がかかる
- delegate の能力が高いほど交渉パラメータの蓄積が速い
- Task 種類の選択が initiator / target の role で異なる（§10.4 参照）
- 最終的な settlement は既存 progress ベースで判定
```

将来拡張（v0.24 以降）。

```text
finalScore =
  structuralPower × config.structuralPowerWeight
  + playAdvantage × config.playAdvantageWeight
  + delegateSkillImpact
  + randomness

推奨初期値:
  structuralPowerWeight: 0.7
  playAdvantageWeight: 0.3
```

### 10.6 解決結果

v0.23 では DiplomaticResolutionKind の導入を将来課題に留める。
既存の DiplomaticPlayStatus（settled / failed / escalated / resolved_by_conflict / cancelled）をそのまま使用する。

将来拡張で以下を導入する。

```ts
type DiplomaticResolutionKind =
  | 'initiator_success'
  | 'responder_success'
  | 'compromise'
  | 'withdrawn'
  | 'escalated_to_conflict'
  | 'stalemate'
```

既存 DiplomaticPlayStatus との対応。

```text
initiator_success / compromise:
  settled

responder_success / withdrawn / stalemate:
  failed

escalated_to_conflict:
  escalated または resolved_by_conflict
```

---

## 11. TaskSystem

### 11.1 役割

TaskSystem は毎週実行される一体型 system である。
Task 生成・処理・outcome・ActivityLog・次 Task 生成を同一 tick 内で完結する。

```text
1. active Task の自動キャンセル判定（§7.10）
2. active Task を assigneePersonId ごとに集める
3. effectivePriority を計算する
4. actionCapacity が許す限り Task を処理する
5. effortDone を加算する
6. 完了した Task の outcome を解決する
7. ActivityLog を作る
8. target entity に結果を反映する
9. 完了・失敗・キャンセルされた Task を state から削除する
```

`TaskGenerationSystem` / `TaskOutcomeSystem` は独立 system にせず、
TaskSystem 内の関数として統合する。

### 11.2 effectivePriority

v0.23 実装では以下の 5 項を計算する。attitudeBonus / reluctancePenalty はプロトタイプ段階では未実装とし、将来バージョンで追加可能な構造にしている。

```text
effectivePriority =
  task.priority
  + ownerDutyBonus
  + goalAlignmentBonus
  + urgencyBonus
  + taskKindPriorityBonus
  - overloadPenalty
```

将来追加予定（v0.24 以降）:

```text
  + attitudeBonus      — attitude → タスク優先度の対応関係が仕様未詳述のため保留
  - reluctancePenalty   — personality trait が ambition/caution の 2 つのみで計算根拠が薄いため保留
```

#### ownerDutyBonus

役職上の義務と一致する Task は上がる。

```text
Polity office holder が Polity Task を担当:
  +config.effectivePriorityOwnerDutyBonus（デフォルト +20）

House office holder が House Task を担当:
  +config.effectivePriorityOwnerDutyBonus（デフォルト +20）
```

#### goalAlignmentBonus

Person Goal と一致する Task は上がる。

```text
house_loyalty:
  House owner Task / promote_house_influence を優先

public_service:
  Polity owner Task / perform_office_duties を優先

personal_advancement:
  seek_office_support / display_competence / defend_office_position を優先

wealth_building:
  manage_accounts / seek_profitable_assignment / arrange_patronage を優先

self_cultivation:
  study_law / study_accounts / practice_arms / courtly_training を優先

一致時: +config.effectivePriorityGoalAlignmentBonus（デフォルト +10）
```

#### urgencyBonus

deadline が近い Task は上がる。

```text
残り 0 週以下（期限切れ）: +config.effectivePriorityUrgencyMaxBonus（+15）
残り 4 週以内:             +config.effectivePriorityUrgencyMediumBonus（+10）
残り 12 週以内:            +config.effectivePriorityUrgencySmallBonus（+5）
それ以上:                  0
```

#### taskKindPriorityBonus

外交系 Task と役職遂行 Task に付与する。

```text
外交系 Task（DIPLOMATIC_TASK_KINDS に該当）:
  +config.effectivePriorityDiplomaticTaskBonus（+10）

perform_office_duties:
  +config.effectivePriorityOfficeDutyBonus（+5）
```

v0.23 では War は未実装だが、将来のために以下の方針を残す。

```text
War Task は原則として高 priority。
ただし、人物の性格・忠誠・利害により例外的に他 Task が優先される余地を残す。
```

#### overloadPenalty

```text
active Task 数 > config.effectivePriorityOverloadThreshold（デフォルト 3）の場合:
  超過 1 件あたり -config.effectivePriorityOverloadPenaltyPerTask（-3）
```

### 11.3 Task progress

v0.23 実装では簡略化し、baseEffort + abilityModifier のみ計算する。

```ts
weeklyEffort = baseEffort × (1.0 + relevantAbility / 100)
```

baseEffort = 1.0。relevantAbility は TaskKind に対応する能力値（下記参照）。

将来追加予定（v0.24 以降）:

```text
  + motivationModifier
  + officeModifier
  - difficultyPenalty
```

Task ごとに関連能力を持つ。

```text
study_law:              learning
study_accounts:         numeracy
practice_arms:          valor / command
courtly_training:       charisma / insight
seek_office_support:    charisma / insight
display_competence:     対象 role に対応する ability（getRoleScore 使用）
prepare_argument:       learning / insight / charisma
pressure_counterparty:  charisma / command
negotiate_terms:        insight / charisma
promote_house_influence: charisma / insight
manage_accounts:        numeracy
```

### 11.4 Task 完了判定

```text
effortDone >= effortRequired
  → Task outcome 解決
```

outcome。

```ts
type TaskOutcomeKind =
  | 'success'
  | 'failure'
  | 'partial'
```

v0.23 では単純化して、原則 success を中心にしてもよい。
失敗処理は deadline 超過・対象消滅・低能力による判定で発生させる。

---

## 12. ActivityLog

### 12.1 基本方針

Task が完了・失敗・キャンセルされた場合、PersonActivityLog を作成する。

ただし、v0.23 では細かいログ生成は作り込まない。
将来の年表・伝記・archive へ拡張できるよう、軽量な参照ログに留める。

### 12.2 PersonActivityLog 型

```ts
type PersonActivityLogId = string & { readonly __brand: 'PersonActivityLogId' }

type PersonActivityKind =
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'

type PersonActivityLog = {
  id: PersonActivityLogId
  personId: PersonId

  week: number

  kind: PersonActivityKind
  outcome: TaskOutcomeKind

  taskKind: TaskKind      // Task 削除後も参照できるよう、kind を直接保持
  sourceRef?: TaskTargetRef

  relatedRefs: EntityRef[]

  summaryKey: string
  params?: Record<string, string | number>

  importance: number
}
```

NOTE: Task は ephemeral なので、ActivityLog は `taskId` ではなく `taskKind` を直接保持する。
将来 archive で詳細が必要な場合は、別途 archive entity を参照する。

### 12.3 保持件数制限

ActivityLog の累積を防ぐため、保持件数制限を設ける。

```text
person ごとに最新 config.maxActivityLogsPerPerson 件まで保存。
推奨初期値: 30

超過時は importance が最も低い古い log から削除する。
```

### 12.4 ログは詳細を持たない

ActivityLog は詳細スナップショットを直接保持しない。

```text
ActivityLog:
  人物の行動履歴インデックス。

詳細:
  将来 ArchivedTask / ArchivedDiplomaticPlay / ArchivedWar などから参照する。
```

v0.23 では archive は実装しない。

---

## 13. AppointmentSystem との接続

### 13.1 基本方針

v0.23 では、Person Aim / Task の結果を AppointmentSystem に反映する。

既存 AppointmentSystem は、能力、prestige、leader respect、対組織 affection、Share、owner house bonus、兼任ペナルティなどで候補者を評価している。

v0.23 では、これに以下を加える。

```text
- obtain_office Aim
- retain_office Aim
- seek_office_support Task の成功
- display_competence Task の成功
- defend_office_position Task の成功
- House / Polity Aim との一致
```

### 13.2 Appointment modifier

新規 selector を追加する。

```ts
function getAppointmentTaskModifier(
  state: WorldState,
  personId: PersonId,
  organization: DecisionSubjectRef,
  role: OfficeRole
): number
```

補正例。

```text
対象役職への obtain_office Aim が active:
  +小

seek_office_support Task の ActivityLog がある（直近 N 週以内）:
  +中

display_competence Task の ActivityLog がある（直近 N 週以内）:
  +中

retain_office Aim が active で現職:
  +中

House Aim と一致:
  +小〜中

Person Goal と役職が一致:
  +小
```

### 13.3 補正の保存

Task は ephemeral なので、Task 成功効果は Aim / ActivityLog の状態から selector で算出する。

```text
Aim 側:
  obtain_office / retain_office Aim の active 状態を参照

ActivityLog 側:
  seek_office_support / display_competence の成功ログが直近 N 週以内にあるかを参照
```

TemporaryModifier entity は v0.23 では導入しない。

---

## 14. Person Goal / Aim 生成

### 14.1 生成対象

```text
- alive
- kind === undefined または 'normal'
- adultAge 以上
- active House 所属
```

placeholder Person は対象外。

### 14.2 Person Goal 生成

Person Goal は原則として初期生成時または成人時に 1 つ作る。

既存 WorldGen では v0.22 で全 active Polity / House に初期 Goal + Aim を生成している。
v0.23 では、同様に全 adult normal Person に初期 Person Goal を生成する。

### 14.3 Person Goal は原則固定・succeeded にならない

```text
通常の GoalMaintenance では Person Goal を差し替えない。
死亡・invalid 化以外では active のまま維持する。
```

既存 GoalMaintenanceSystem は Polity / House Goal の review / 差し替えを行うが、
Person Goal はスキップする。

Person Goal は人生目標・価値観であり、Polity / House Goal と異なり succeeded / failed にならない。
goalOutcomeSystem は `owner.kind === 'person'` の Goal を成功判定対象から除外する。

```text
goalOutcomeSystem:
  owner.kind === 'person' の場合:
    progress（baseFulfillment）を Aim outcome に応じて更新する。
    ただし progress >= targetProgress になっても status を succeeded にしない。
    progress は 0..100 に clamp する。

  owner.kind === 'polity' / 'house' の場合:
    既存動作を維持（progress >= targetProgress で succeeded）。
```

将来、大事件で変化する余地は残す。

```text
- 家門断絶
- 失脚
- 改宗
- 主君の裏切り
- 老年
- 隠遁
```

v0.23 では未実装。

### 14.4 Goal score

```text
score =
  baseWeight
  + traitModifier
  + abilityOpportunity
  + attitudeModifier
  + currentPositionModifier
  + organizationContextModifier
```

### 14.5 Person Aim 生成

Person Aim は年次または必要時に生成する。

```text
Person active Aim がない場合:
  Goal / 状況 / attitude / ability / office / organization Aim から Aim を選ぶ。

既存 active Aim が invalid:
  abandoned / failed にして新 Aim を検討する。
```

### 14.6 Aim score

```text
score =
  baseWeight
  + goalAlignment
  + opportunityScore
  + abilityFit
  + attitudeFit
  + urgency
  - riskPenalty
  - overloadPenalty
  - fulfillmentSatisfactionPenalty
```

fulfillment が高い場合、同 Goal に基づく新 Aim は作られにくくする。

---

## 15. Tick 順序

### 15.1 問題点

v0.22 の tick 順序では、AppointmentSystem は GoalMaintenance / AimMaintenance より前に配置されている。
しかし v0.23 では Person Aim / Task の結果が AppointmentSystem に影響するため、順序調整が必要である。

### 15.2 実装された順序

v0.23 では、既存 ScheduledSystem の大規模な順序変更は行わず、以下の配置とした。

```text
（経済・人口系）
developmentSystem, controlSystem, popSystem, landRevenueSystem,
politySurplusDistributionSystem, houseSurplusDistributionSystem

（人物ライフサイクル系）
disasterSystem, mortalitySystem, estateSettlementSystem, successionSystem,
marriageSystem, birthSystem, unaffiliatedPersonSystem

（役職・Share 系）
officeTermSystem, shareUpdateSystem, appointmentSystem

（Task 系 — 毎週実行）
taskSystem

（役職報酬・派閥系）
bailiffAppointmentSystem, officeCompensationSystem,
factionPatronageSystem, factionDefectionSystem, factionMaintenanceSystem,
factionLifecycleSystem, factionRecruitmentSystem

（成長・支出系）
personGrowthSystem, publicSpendingSystem, popDevelopmentSystem, plotSystem

（Person Goal / Aim 生成）
personGoalMaintenanceSystem, personAimMaintenanceSystem

（組織 Goal / Aim 系）
goalMaintenanceSystem, aimMaintenanceSystem

（Intent / DiplomaticPlay / outcome / cleanup 系）
intentGenerationSystem, aimToIntentGenerationSystem,
intentToDiplomaticPlaySystem, intentActionSystem,
diplomaticPlaySystem, conflictResolutionSystem,
aimOutcomeSystem, goalOutcomeSystem,
cleanupTerminalDiplomacy, cleanupTerminalDecisions

（整合性検査）
integrityCheck
```

NOTE: AppointmentSystem が TaskSystem より前に実行される。これは意図的な配置であり、「今週完了したタスクが同じ週の任官に即座に反映される」のは不自然なため、前週までのタスク結果のみが任官判定の材料になるのが望ましい。

### 15.3 実行頻度

```text
PersonGoalMaintenanceSystem:
  48週ごと
  ただし初期生成・成人時は即時

PersonAimMaintenanceSystem:
  4週ごと
  active Aim がない場合や invalid の場合に生成
  年次ゲートを使う場合でも、invalid 処理は即時

TaskSystem:
  毎週

DiplomaticPlay 構造的進行:
  4週ごと（既存頻度を維持）
```

---

## 16. WorldState 追加

### 16.1 Task

```ts
type WorldState = {
  ...
  tasks: Record<TaskId, Task>           // active Task のみ
  taskIndex: {
    byAssignee: Record<PersonId, TaskId[]>
    byOwner: Record<string, TaskId[]>   // decisionSubjectKey 形式
    byTarget: Record<string, TaskId[]>  // targetRefKey 形式
  }
  waitingAimIds: WaitingAimIndex        // waitingReasonKey + nextReviewWeek 持ちの Aim を高速検索
  nextTaskId: number
}
```

`waitingAimIds` は PersonAimMaintenanceSystem での waiting Aim 再評価を効率化するための補助 index。
全 Aim を毎週走査する代わりに、waiting 状態の Aim のみを対象に再評価する。

### 16.2 ActivityLog

```ts
type WorldState = {
  ...
  personActivityLogs: Record<PersonActivityLogId, PersonActivityLog>
  personActivityLogIndex: {
    byPerson: Record<PersonId, PersonActivityLogId[]>
  }
  nextPersonActivityLogId: number
}
```

### 16.3 Goal / Aim 拡張

既存 `Goal` / `Aim` に Person 用 kind を追加する。

```ts
type GoalKind =
  | PolityGoalKind
  | HouseGoalKind
  | PersonGoalKind

type AimKind =
  | PolityAimKind
  | HouseAimKind
  | PersonAimKind
```

既存 `DecisionSubjectRef` は Person / House / Polity に対応する設計であるため、Person owner を実動させる。

### 16.4 AimTarget 拡張

既存 Aim.target に Person Aim 用の variant を追加する。

```ts
type AimTarget =
  // 既存（Polity / House Aim 用）
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
  | { kind: 'province'; id: ProvinceId }
  | { kind: 'holding'; id: HoldingId }
  | { kind: 'land_contract'; id: LandContractId }

  // v0.23 追加（Person Aim 用）
  | { kind: 'aim'; id: AimId }
  | { kind: 'office'; organization: PoliticalActorRef; role: OfficeRole }
  | { kind: 'ability'; ability: AbilityKey }
```

`office.organization` は `PoliticalActorRef`（polity / house）とする。
Person が organization になることはないため、`DecisionSubjectRef` ではなく `PoliticalActorRef` を使う。

`support_organization_aim` は Phase A では生成しないが、`{ kind: 'aim' }` 型は Phase B で必要になるため型定義には含める。

### 16.5 能力訓練経験（abilityTrainingExperience）

`abilityTrainingExperience` は Person に直接持たせず、WorldState の別マップで管理する。

理由: trainingExperience は人物の恒久的な属性ではなく、成長判定用の一時的な蓄積値であるため。

```ts
type AbilityTrainingExperience = Partial<Record<AbilityKey, number>>

type WorldState = {
  ...
  personTrainingExperience: Record<PersonId, AbilityTrainingExperience>
}
```

improve_ability 系 Task 完了時に加算する。

```ts
addPersonTrainingExperience(state, personId, ability, amount)
```

personGrowthSystem が年次成長判定時に bonus として参照し、判定後に減衰させる（§19 参照）。

### 16.6 DiplomaticPlay 拡張

DiplomaticPlay に §10.2 のフィールドを追加する。

---

## 17. Cleanup / Archive 方針

### 17.1 v0.23

v0.23 では archive は実装しない。

ただし、以下を守る。

```text
- Aim / Intent / DiplomaticPlay / ActivityLog は安定 ID を持つ
- ID は再利用しない
```

### 17.2 Task（ephemeral）

Task は完了・失敗・キャンセル時に state から削除する。

```text
active Task のみ state.tasks に保持。
terminal Task は ActivityLog 作成後に即削除。
```

これにより、Task 累積によるパフォーマンス劣化を防ぐ。

### 17.3 ActivityLog

ActivityLog は person ごとに保持件数制限を設ける（§12.3 参照）。

---

## 18. 既存システムの Person 対応要件

v0.23 で Person owner の Goal / Aim / Task を追加するにあたり、既存システムの改修が必要である。

### 18.1 改修一覧

```text
goalMaintenanceSystem:
  Person Goal の review / 差し替えをスキップする処理を追加。
  現行は Polity / House のみループしている。
  → Person Goal は PersonGoalMaintenanceSystem で個別管理するため、
     goalMaintenanceSystem では owner.kind === 'person' をスキップ。

aimMaintenanceSystem:
  Person Aim の生成・失効チェックを追加する必要がある。
  → PersonAimMaintenanceSystem として別 system にするか、
     既存 aimMaintenanceSystem 内で分岐するかは実装判断。
  → pickAimForGoal / isTargetValid に Person 対応を追加。

aimToIntentGenerationSystem:
  Person Aim は対象外とする。
  → owner.kind === 'person' の Aim はスキップ。

aimOutcomeSystem:
  Person Aim の outcome 処理を追加。
  → getOwnerNameKey に person 対応を追加。

goalOutcomeSystem:
  Person Goal の progress 更新を追加。
  → getOwnerNameKey に person 対応を追加。

cleanupTerminalDecisions:
  Person owner の Goal / Aim cleanup を追加。
  → 既存ロジックは owner kind に依存しないため、大きな変更不要。

cleanupTerminalDiplomacy:
  isDecisionSubjectActive() を Person 対応にする。
  → person: exists && alive && kind !== 'placeholder'

generateWorld.ts:
  初期 Person Goal / Aim 生成処理を追加。
```

### 18.2 House 移籍時の Person Aim / Task 処理（将来課題）

v0.23 では House 移籍時の Aim / Task 自動キャンセル処理は未実装。
移籍後、旧 House を対象とする Aim は TaskSystem の自動キャンセル判定（§7.10）や
PersonAimMaintenanceSystem の deadline / validity チェックで自然に失効する。

将来バージョンで以下の即時処理を追加する。

```text
Person Goal:
  維持する。house_loyalty Goal の場合でも、loyalty の対象は現在所属 House と解釈する。

旧 House を target または owner とする active Person Aim:
  abandoned とする。

abandoned にした Aim に紐づく active Task:
  cancelled とする。

次回 PersonAimMaintenanceSystem:
  新 House を前提に Person Aim を再生成する。
```

対象 PersonAimKind。

```text
increase_house_influence:
  旧 House の影響力拡大は abandoned。新 House で再生成されうる。

obtain_office / retain_office:
  旧 House の office を対象とする場合は abandoned。
  Polity office を対象とする場合は影響なし。

support_organization_aim（Phase B 以降）:
  旧 House の Aim を支援していた場合は abandoned。
```

---

## 19. improve_ability と personGrowthSystem の関係

### 19.1 方針

v0.23 では personGrowthSystem を残す。

Task-driven の能力訓練は直接 ability を上げず、WorldState.personTrainingExperience に蓄積する（§16.5 参照）。
personGrowthSystem が年次成長判定時に experience bonus として参照する。

```text
personGrowthSystem（年 1 回・既存）:
  abilities を aptitudes に向けて成長させる。
  personTrainingExperience がある場合、成長判定に bonus を加算。
  年次処理後、使用した ability の experience を 50% 減衰する。

improve_ability Task:
  完了時に personTrainingExperience[personId][targetAbility] を加算。
  即時の ability 変更は行わない。
```

減衰方式は 50% 減衰を推奨する。

```text
リセット（0 にする）:
  実装は簡単だが、年末直前に training した人物だけ得をしやすい。

50% 減衰（推奨）:
  過去の努力が少し残る。
  長期的な研鑽が表現しやすい。
```

これにより:

```text
- 自己研鑽する人物は年次成長判定が有利になるが、2 倍速にはならない
- 既存の personGrowthSystem の仕組みを壊さない
- aptitude を超えた成長には abilityExperience だけでは不十分
- 長期的な研鑽の効果が少しずつ蓄積される
```

---

## 20. Faction 連携

### 20.1 v0.23 での方針

v0.23 では Faction と Person Goal / Aim / Task の直接連携は行わない。
Faction 由来 Task も生成しない。

### 20.2 将来課題

```text
- personal_advancement と defection の関連
- house_loyalty と faction loyalty の競合
- faction leader からの Task 割当
- faction membership が Person Aim score に影響
```

---

## 21. UI

### 21.1 Person DetailPanel

Person 詳細に以下を追加する。

```text
- 人生目標
- fulfillment（currentFulfillment）
- 現在の Aim
- 現在の Task
- 最近の行動ログ
```

表示例。

```text
人生目標: 家門への献身
充足度: 42 / 100

現在の狙い:
House Arven の影響力拡大を支援している。

現在の仕事:
同家候補の Treasurer 任官に向けて支持を集めている。

最近の行動:
- 1532年 第3週: 任官支持を集めた
- 1532年 第2週: 家門の影響力工作を行った
```

### 21.2 Polity / House DetailPanel

既存 Goal / Aim 表示に Task 状態を追加する。

```text
- active Aim
- active Task
- 担当者
- waiting / blocked reason
```

### 21.3 DiplomaticPlay UI

DiplomaticPlay に以下を表示する。

```text
- initiator / target
- 各側の delegate
- preparation / leverage / commitment
- active Task
- tension / progress
```

---

## 22. i18n

以下のキーを追加する。

```text
goals.person.house_loyalty
goals.person.public_service
goals.person.personal_advancement
goals.person.wealth_building
goals.person.self_cultivation

aims.person.support_organization_aim
aims.person.increase_house_influence
aims.person.obtain_office
aims.person.retain_office
aims.person.accumulate_wealth
aims.person.improve_ability

tasks.support_organization_plan
tasks.promote_house_influence
tasks.perform_office_duties
tasks.seek_office_support
tasks.display_competence
tasks.defend_office_position
tasks.manage_accounts
tasks.seek_profitable_assignment
tasks.study_law
tasks.study_accounts
tasks.practice_arms
tasks.courtly_training
tasks.prepare_intent
tasks.secure_internal_support
tasks.secure_development_budget
tasks.supervise_holding_development
tasks.arrange_patronage
tasks.commission_chronicle_work
tasks.prepare_argument
tasks.gather_claim_evidence
tasks.negotiate_terms
tasks.pressure_counterparty
tasks.offer_compromise
tasks.undermine_counterparty_position

activity.task_completed
activity.task_failed
activity.task_cancelled

UI 表示用キー（detail.person.* namespace に配置）:
  detail.person.goal_fulfillment
  detail.person.aim_status_waiting
  detail.person.task_target_own_aim
  detail.person.task_target_house_aim
  detail.person.task_target_polity_aim
  detail.person.task_target_house_intent
  detail.person.task_target_polity_intent
  detail.person.task_target_house_play
  detail.person.task_target_polity_play

blocked / waiting キー（i18n キーとして定義）:
  blocked.no_assignee
  blocked.no_valid_polity
  blocked.invalid_target
  blocked.target_terminal
  waiting.waiting_for_appointment_cycle
```

NOTE: 仕様初版では `fulfillment.frustrated` 等の段階名をトップレベルキーとして定義していたが、
実装では `detail.person.*` namespace に統合した。

---

## 23. IntegrityCheck

以下を追加する。

### 23.1 Task integrity

```text
実装済み:
- assigneePersonId が存在する
- assignee が alive normal Person である
- active Task の target aim が terminal ではない
- active Task の target intent が存在し active である
- active Task の target diplomatic play が存在する

未実装（v0.24 以降）:
- taskIndex.byAssignee / byOwner / byTarget の同期検証
  （index は createTask / removeTask ヘルパーで一貫管理されており、ドリフトは未観測）
```

### 23.2 Aim integrity

```text
- Aim.owner.kind === 'person' の場合、owner Person が存在し alive normal
- Person active Aim は原則 1 つ以下
- activeTaskId がある場合、その Task が存在する
- activeTaskId / activeIntentId / activeDiplomaticPlayId は同時に 2 つ以上セットされない
- waitingFor がある場合、参照先 entity が存在する
```

### 23.3 Person Goal integrity

```text
実装済み:
- active Person Goal は 1 つ以下
- Person Goal の progress は 0..100

未実装（v0.24 以降）:
- adult normal Person が必ず 1 つの active Person Goal を持つ検証
  （生成タイミングのずれにより一時的に 0 になりうるため、v0.23 では ≤ 1 のみチェック）
- placeholder Person が Person Goal を持たない検証
```

### 23.4 DiplomaticPlay integrity

```text
- initiator / target が存在する
- initiatorDelegatePersonId がある場合、Person が存在し alive
- targetDelegatePersonId がある場合、Person が存在し alive
- initiatorActiveTaskIds の全 Task が存在する
- targetActiveTaskIds の全 Task が存在する
- DiplomaticPlay Task の targetRef は当該 DiplomaticPlay を指す
```

---

## 24. イベント

v0.23 で追加したイベント。

```text
PERSON_GOAL_CREATED
PERSON_AIM_CREATED
PERSON_AIM_SUCCEEDED
PERSON_AIM_FAILED
TASK_COMPLETED
TASK_FAILED
TASK_CANCELLED
```

以下は v0.23 では将来課題とした。

```text
DIPLOMATIC_TASK_COMPLETED   — 外交タスク完了は既存イベントと ActivityLog で十分カバーされるため保留
PERSON_GOAL_FULFILLMENT_CHANGED — fulfillment 変化イベントは頻度が高く、ノイズになるため保留
```

イベントは UI / debug / ActivityLog と重複しすぎないようにする。
低重要度 Task は ActivityLog のみに留め、event は重要 Task に限定してもよい。

---

## 25. 実装順序（Phase 分割）

### Phase A: Person Goal + Person Aim + Task entity + TaskSystem

```text
A-1. 型追加
  - PersonGoalKind（never → 5 種）
  - PersonAimKind
  - Task / TaskId / TaskKind / TaskStatus / TaskTargetRef
  - PersonActivityLog
  - WorldState に tasks / taskIndex / personActivityLogs / personTrainingExperience / nextTaskId 等追加
  - createTaskId() id generator

A-2. 既存システム Person 対応（最低限）
  - isDecisionSubjectActive() の Person 対応
  - goalMaintenanceSystem: owner.kind === 'person' スキップ
  - aimToIntentGenerationSystem: owner.kind === 'person' スキップ
  - aimOutcomeSystem / goalOutcomeSystem: getOwnerNameKey の Person 対応
  - cleanupTerminalDecisions: Person owner の cleanup 対応
  - generateWorld.ts: 初期 Person Goal / Aim 生成

A-3. PersonGoalMaintenanceSystem
  - 成人時に Person Goal 生成
  - Goal score 計算
  - fulfillment 初期値
  - getPersonGoalFulfillment() selector

A-4. PersonAimMaintenanceSystem
  - active Aim がない場合に Aim 生成
  - Phase A では support_organization_aim を除外（§6.5 参照）
  - Aim score 計算
  - Aim 作成時に initial Task 生成

A-5. TaskSystem
  - byAssignee index 管理
  - getPersonWeeklyActionCapacity() selector
  - effectivePriority 計算
  - effortDone 加算
  - Task 完了判定
  - onTaskCompleted(): outcome 解決 + ActivityLog 作成 + Task 削除
  - 次 Task 生成
  - Task 自動キャンセル

A-6. Aim Task-driven 化（Person Aim のみ）
  - Aim.activeTaskId
  - Task 完了で Aim.progress 更新
  - Aim succeeded / failed / waitingFor / blockedReasonKey

A-7. AppointmentSystem 接続
  - getAppointmentTaskModifier() selector
  - obtain_office / retain_office Aim の active 状態を参照
  - ActivityLog ベースの補正

A-8. CLI 整合性確認
  - 300 年 × 4 seed で violation なし
```

### Phase B: Polity / House Aim の Task-driven 化

```text
B-1. 組織 Task の assignee 選定ロジック
B-2. 組織 Aim に activeTaskId 追加
B-3. support_organization_aim の組織 Task 引き受け方式への移行
B-4. CLI 整合性確認
```

### Phase C: Intent の Task-driven 化

```text
C-1. ActorIntent に activeTaskId 追加
C-2. Action 系 Intent（develop_holding 等）の即時処理を Task 経由に移行
C-3. 旧処理が残る場合 TODO 明記
C-4. CLI 整合性確認
```

### Phase D: DiplomaticPlay の Task-driven 化

```text
D-1. DiplomaticPlay に delegate / preparation / leverage / commitment / TaskIds 追加
D-2. delegate 選定ロジック
D-3. DiplomaticPlay Task 生成・処理
D-4. structuralPower + playAdvantage 併用方式
D-5. 現行 acceptanceScore 進行を弱化
D-6. DiplomaticResolutionKind 導入
D-7. CLI 整合性確認
```

### Phase E: UI / i18n / IntegrityCheck

```text
E-1. Person DetailPanel（Goal / fulfillment / Aim / Task / ActivityLog）
E-2. Polity / House DetailPanel（Task 状態追加）
E-3. DiplomaticPlay UI（delegate / パラメータ表示）
E-4. i18n キー追加
E-5. IntegrityCheck 拡張
E-6. CLI 整合性確認（最終）
```

---

## 26. 受け入れ条件

### Phase A 完了条件

```text
1. adult normal Person が人生目標を持つ
2. Person Aim から Task が生成される
3. Person が weekly actionCapacity 内で Task を処理する
4. Task 完了で Aim が進む
5. Task 完了が ActivityLog に残る
6. obtain_office / retain_office 系 Aim / Task が AppointmentSystem に影響する
7. CLI 300 年 × 4 seed で fatal な整合性破綻がない
```

### 全 Phase 完了条件

```text
1〜7. Phase A 条件
8. Polity / House Aim も可能な限り Task-driven で進行する
9. Intent の即時処理が可能な限り Task 経由になる
10. DiplomaticPlay が delegate / Task + structuralPower で進行する
11. 旧 tick 自動 progress と新 Task progress が矛盾しない
12. Person DetailPanel で Goal / fulfillment / Aim / Task が見える
13. IntegrityCheck が Task / Person Goal / Aim / DiplomaticPlay の破損を検出する
14. CLI 300 年 × 4 seed で violation なし
```

---

## 27. 将来拡張メモ

### 27.1 War

War は将来、DiplomaticPlay と同じ複数主体型 Task-driven entity として実装する。

```text
War:
  participants / sides
  commander
  active war tasks
  structuralPower
  battlefield context
```

戦争系 Task は高 priority とする。
ただし、人物の性格・忠誠・利害によって例外的に他 Task を優先する余地を残す。

### 27.2 Project

Project は「予算と人を割り当てて何かを行う」entity として、Task-driven に実装する。

例。

```text
- 土地開発
- 城砦建設
- 記念碑
- 大規模政策
```

### 27.3 Archive / 年表 / 伝記

将来、完了済み DiplomaticPlay / War / Project は archive に保存する。

ActivityLog は archive entity への参照を持つ索引として使う。

```text
ActivityLog:
  人物がいつ何をしたか

Archive:
  その出来事の詳細
```

これにより、年表作成・伝記作成・年代記生成を実装できる。

### 27.4 DiplomaticPlay participants 配列化

第三者介入（supporter / mediator / opportunist）を実装する段階で、
initiator / target flat 構造から participants 配列への移行を検討する。

### 27.5 Faction 連携

Faction と Person Goal / Aim / Task の連携（§20.2 参照）。

---

## 28. 仕様上の注意

v0.23 は大きな設計変更である。

Phase 分割により段階的に実装するが、特に以下は各 Phase で重点確認する。

```text
Phase A:
- Person Goal が重複生成されないか
- isDecisionSubjectActive の Person 対応が漏れていないか
- Task の自動キャンセルで Aim が不整合にならないか

Phase B:
- 組織 Aim の Task 化で既存 Intent 経路と衝突しないか
- activeTaskId / activeIntentId の排他制御が正しいか

Phase C:
- IntentActionSystem の旧即時処理をどこまで Task 化できるか
- 旧処理が残る場合の TODO が明記されているか

Phase D:
- DiplomaticPlaySystem の旧 progress / tension 自動進行の弱化が正しいか
- structuralPower + playAdvantage のバランスが機能するか
- CleanupTerminalDiplomacy と Task / ActivityLog の参照が壊れないか
```

---

## 29. 実装時の決定事項（実装完了時に確定）

以下は仕様レビュー時に未決定だった項目の実装時の決定結果。

```text
- retain_office Aim の終了タイミング
  → targetProgress（2）到達で succeeded。次期 Aim は PersonAimMaintenanceSystem で生成。
  任官サイクルとの直接連動は v0.23 では見送り。

- Appointment modifier の具体的な数値
  → config.appointmentTaskModifierValue = 4
  → config.appointmentTaskModifierDurationWeeks = 16
  obtain_office / retain_office Aim active + 直近 ActivityLog で最大 +4 の補正。

- personTrainingExperience の加算量
  → config.taskTrainingExperienceGain = 2.0
  personGrowthSystem 側で hadRelevantExperience() を参照し gainChance に bonus 加算。
  年次処理後 50% 減衰（config.trainingExperienceDecayRate = 0.5）。
```

### 29.1 v0.24 以降の残課題

```text
- accumulate_wealth Aim の wealth 閾値チェック導入
  現在は targetProgress 到達のみで succeeded。
  wealth >= 作成時 wealth + threshold の条件を追加する。

- retain_office Aim と AppointmentSystem の連動
  任官サイクルで現職を維持した場合に succeeded とする仕組み。

- House 移籍時の Aim / Task 即時キャンセル（§18.2 参照）

- DiplomaticResolutionKind の導入（§10.6 参照）

- playAdvantage の finalScore 計算への統合（§10.5 参照）

- effectivePriority の attitudeBonus / reluctancePenalty 追加（§11.2 参照）

- Task progress の motivationModifier / officeModifier / difficultyPenalty 追加（§11.3 参照）

- DIPLOMATIC_TASK_COMPLETED / PERSON_GOAL_FULFILLMENT_CHANGED イベント（§24 参照）

- IntegrityCheck: taskIndex 同期検証、Person Goal 必須検証（§23 参照）
```

---

## 30. 決定済み事項（レビュー Q&A で確定）

以下はレビュー過程で未決定だったが、Q&A を経て確定した事項。

```text
1. obtain_office の AppointmentSystem 待ち
   waitingFor ではなく waitingReasonKey + nextReviewWeek で管理する（§8.6 参照）。
   AppointmentSystem は TaskTargetRef ではないため、
   waitingReasonKey = 'waiting.appointment_cycle' と nextReviewWeek で制御する。

2. abilityTrainingExperience の保存場所
   Person に直接持たせず、WorldState.personTrainingExperience 別マップで管理する（§16.5 参照）。
   年次成長判定後は 50% 減衰する（§19 参照）。

3. support_organization_aim の Phase A 動作
   Phase A では生成対象から除外する（§6.5 参照）。
   Phase B で Polity / House Aim の Task-driven 化と同時に有効化する。

4. Person Goal は succeeded にならない
   goalOutcomeSystem で owner.kind === 'person' の Goal を成功判定から除外する（§14.3 参照）。
   progress は baseFulfillment として 0..100 に clamp。

5. AimTarget union 拡張
   Person Aim 用に aim / office / ability variant を追加する（§16.4 参照）。

6. Person Aim の deadlineWeek
   各 PersonAimKind にデフォルト deadlineWeek を設定する（§6.7 参照）。

7. House 移籍時の Person Aim / Task 処理
   Goal は維持。旧 House を target とする Aim は abandoned、Task は cancelled（§18.2 参照）。
```

---

以上が v0.23 仕様書（レビュー反映版）です。
