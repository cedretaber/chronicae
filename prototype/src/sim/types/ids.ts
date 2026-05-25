type Branded<T, B> = T & { readonly _brand: B }

export type ProvinceId = Branded<string, 'ProvinceId'>
export type PolityId = Branded<string, 'PolityId'>
export type HouseId = Branded<string, 'HouseId'>
export type PersonId = Branded<string, 'PersonId'>
export type PlotId = Branded<string, 'PlotId'>
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

export function createPlotId(prefix: string, n: number): PlotId {
  return (prefix + '-' + n) as PlotId
}

export function createEventId(prefix: string, n: number): EventId {
  return (prefix + '-' + n) as EventId
}

export function newPopGroupId(value: string): PopGroupId {
  return value as PopGroupId
}

export type OrganizationShareId = Branded<string, 'OrganizationShareId'>
export type OfficeAssignmentId = Branded<string, 'OfficeAssignmentId'>
export type LandContractId = Branded<string, 'LandContractId'>

export function createOrganizationShareId(n: number): OrganizationShareId {
  return ('os-' + n) as OrganizationShareId
}

export function createOfficeAssignmentId(n: number): OfficeAssignmentId {
  return ('of-' + n) as OfficeAssignmentId
}

export function createLandContractId(n: number): LandContractId {
  return ('lc-' + n) as LandContractId
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

export function createDiplomaticPlayId(n: number): DiplomaticPlayId {
  return ('dp-' + n) as DiplomaticPlayId
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
