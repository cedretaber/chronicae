type Branded<T, B> = T & { readonly _brand: B }

export type ProvinceId = Branded<string, 'ProvinceId'>
export type PolityId = Branded<string, 'PolityId'>
export type HouseId = Branded<string, 'HouseId'>
export type PersonId = Branded<string, 'PersonId'>
export type EventId = Branded<string, 'EventId'>
export type PopGroupId = Branded<string, 'PopGroupId'>

export function createProvinceId(prefix: string, n: number): ProvinceId {
  return (prefix + '-' + n) as ProvinceId
}

export function createPolityId(prefix: string, n: number): PolityId {
  return (prefix + '-' + n) as PolityId
}

export function createHouseId(prefix: string, n: number): HouseId {
  return (prefix + '-' + n) as HouseId
}

export function createPersonId(prefix: string, n: number): PersonId {
  return (prefix + '-' + n) as PersonId
}

export function createEventId(prefix: string, n: number): EventId {
  return (prefix + '-' + n) as EventId
}

export function newPopGroupId(value: string): PopGroupId {
  return value as PopGroupId
}

// v0.42c: OrganizationShareId → HouseShareId (polity share 全廃に伴い house 専用に縮小。
// prefix は旧 'os-' を維持する — 既存 fixture/ID 連番との互換のため。spec §4.1 の 'hs-' は
// 新規 prefix だが、ID はセーブ互換要件が無く表示にも使われないため旧 prefix 据え置きを選択)
export type HouseShareId = Branded<string, 'HouseShareId'>
export type OfficeAssignmentId = Branded<string, 'OfficeAssignmentId'>
export type LandContractId = Branded<string, 'LandContractId'>

export function createHouseShareId(n: number): HouseShareId {
  return ('os-' + n) as HouseShareId
}

export function createOfficeAssignmentId(n: number): OfficeAssignmentId {
  return ('of-' + n) as OfficeAssignmentId
}

export function createLandContractId(n: number): LandContractId {
  return ('lc-' + n) as LandContractId
}

export type ClanId = Branded<string, 'ClanId'>

export function createClanId(n: number): ClanId {
  return ('cl-' + n) as ClanId
}

export type FactionId = Branded<string, 'FactionId'>
export type FactionMembershipId = Branded<string, 'FactionMembershipId'>

export function createFactionId(n: number): FactionId {
  return ('f-' + n) as FactionId
}

export function createFactionMembershipId(n: number): FactionMembershipId {
  return ('fm-' + n) as FactionMembershipId
}

export type DiplomaticPlayId = Branded<string, 'DiplomaticPlayId'>

// prefix は `dpl-`。runtime polity (makePolityId, context.ts) が `dp-` を使うため、`dp-` を共有すると
// ID が世界全体で一意でなくなる (現状は別 map なので実衝突しないが、`dp-` は紛らわしく潜在的衝突源)。
// `dp-` は polity 専用に残し、diplomatic play は `dpl-` で区別する。
export function createDiplomaticPlayId(n: number): DiplomaticPlayId {
  return ('dpl-' + n) as DiplomaticPlayId
}

export type DiplomaticOfferId = Branded<string, 'DiplomaticOfferId'>

export function createDiplomaticOfferId(n: number): DiplomaticOfferId {
  return ('do-' + n) as DiplomaticOfferId
}

export type WarId = Branded<string, 'WarId'>

export function createWarId(n: number): WarId {
  return ('w-' + n) as WarId
}

export type StateRegionId = Branded<string, 'StateRegionId'>

export function createStateRegionId(n: number): StateRegionId {
  return ('sr-' + n) as StateRegionId
}

export type HoldingId = Branded<string, 'HoldingId'>

export function createHoldingId(n: number): HoldingId {
  return ('hl-' + n) as HoldingId
}

export type HoldingOfficeAssignmentId = Branded<string, 'HoldingOfficeAssignmentId'>

export function createHoldingOfficeAssignmentId(n: number): HoldingOfficeAssignmentId {
  return ('ho-' + n) as HoldingOfficeAssignmentId
}

export type HoldingImprovementId = Branded<string, 'HoldingImprovementId'>

export function createHoldingImprovementId(n: number): HoldingImprovementId {
  return ('hi-' + n) as HoldingImprovementId
}

export type ProjectId = Branded<string, 'ProjectId'>

export function createProjectId(n: number): ProjectId {
  return ('pr-' + n) as ProjectId
}

// v0.48 Crisis: 対処を要する局所的事態 (災害・戦災・反乱前段)。prefix `cr-`。
export type CrisisId = Branded<string, 'CrisisId'>

export function createCrisisId(n: number): CrisisId {
  return ('cr-' + n) as CrisisId
}

export type GoalId = Branded<string, 'GoalId'>
export type AimId = Branded<string, 'AimId'>
export type DecisionReasonId = Branded<string, 'DecisionReasonId'>
export type PressureId = Branded<string, 'PressureId'>

export function createPressureId(n: number): PressureId {
  return ('ps-' + n) as PressureId
}

export function createGoalId(n: number): GoalId {
  return ('go-' + n) as GoalId
}

export function createAimId(n: number): AimId {
  return ('am-' + n) as AimId
}

export function createDecisionReasonId(n: number): DecisionReasonId {
  return ('dr-' + n) as DecisionReasonId
}

export type TaskId = Branded<string, 'TaskId'>
export type PersonActivityLogId = Branded<string, 'PersonActivityLogId'>

export function createTaskId(n: number): TaskId {
  return ('tk-' + n) as TaskId
}

export function createPopGroupId(n: number): PopGroupId {
  return ('pg-' + n) as PopGroupId
}

export function createPersonActivityLogId(n: number): PersonActivityLogId {
  return ('al-' + n) as PersonActivityLogId
}

// v0.36 Regiment / Battle
export type RegimentId = Branded<string, 'RegimentId'>
export type BattleId = Branded<string, 'BattleId'>

export function createRegimentId(n: number): RegimentId {
  return ('rg-' + n) as RegimentId
}

export function createBattleId(n: number): BattleId {
  return ('bt-' + n) as BattleId
}

// v0.49 BattleLog — 後年参照用の恒久戦場ログ。prefix `bl-`。
export type BattleLogId = Branded<string, 'BattleLogId'>

export function createBattleLogId(n: number): BattleLogId {
  return ('bl-' + n) as BattleLogId
}

// v0.38 Chronicle System
export type ChronicleEntryId = Branded<string, 'ChronicleEntryId'>

export function createChronicleEntryId(n: number): ChronicleEntryId {
  return ('ch-' + n) as ChronicleEntryId
}

// v0.42 PoliticalRight
export type PoliticalRightId = Branded<string, 'PoliticalRightId'>

export function createPoliticalRightId(n: number): PoliticalRightId {
  return ('prg-' + n) as PoliticalRightId
}

// v0.44 PersonReputation
export type PersonReputationId = Branded<string, 'PersonReputationId'>

export function createPersonReputationId(n: number): PersonReputationId {
  return ('rep-' + n) as PersonReputationId
}

// v0.51 InfluenceModifier (陰謀リファイン): 影響力の符号付き・期限付き修正項。
// prefix は `im-` (PoliticalRight の `prg-` 等と衝突しない単調カウンタ慣習)。
export type InfluenceModifierId = Branded<string, 'InfluenceModifierId'>

export function createInfluenceModifierId(n: number): InfluenceModifierId {
  return ('im-' + n) as InfluenceModifierId
}

// v0.52 RealEstateAsset: Holding 内部の具体的不動産。prefix `re-`。
export type RealEstateAssetId = Branded<string, 'RealEstateAssetId'>

export function createRealEstateAssetId(n: number): RealEstateAssetId {
  return ('re-' + n) as RealEstateAssetId
}
