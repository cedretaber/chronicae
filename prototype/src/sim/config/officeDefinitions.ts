import type { OrganizationKind, OfficeRole, OfficeDefinition } from '@sim/types/office'

type OfficeKey = `${OrganizationKind}:${OfficeRole}`

export const OFFICE_DEFINITIONS: Record<OfficeKey, OfficeDefinition> = {
  'country:leader': {
    organizationKind: 'country',
    role: 'leader',
    displayName: 'Ruler',
    maxHolders: 1,
    baseSalary: 0,
    baseAuthorityPower: 80,
    baseDignityPower: 100,
    adminLoad: 0,
    coordinationLoad: 0,
  },
  'country:administrator': {
    organizationKind: 'country',
    role: 'administrator',
    displayName: 'Chancellor',
    maxHolders: 3,
    baseSalary: 30,
    baseAuthorityPower: 70,
    baseDignityPower: 50,
    adminLoad: 5,
    coordinationLoad: 10,
  },
  'country:treasurer': {
    organizationKind: 'country',
    role: 'treasurer',
    displayName: 'Treasurer',
    maxHolders: 3,
    baseSalary: 30,
    baseAuthorityPower: 65,
    baseDignityPower: 45,
    adminLoad: 5,
    coordinationLoad: 10,
  },
  'country:military': {
    organizationKind: 'country',
    role: 'military',
    displayName: 'General',
    maxHolders: 5,
    baseSalary: 25,
    baseAuthorityPower: 70,
    baseDignityPower: 60,
    adminLoad: 3,
    coordinationLoad: 8,
  },
  'country:advisor': {
    organizationKind: 'country',
    role: 'advisor',
    displayName: 'Court Advisor',
    maxHolders: 5,
    baseSalary: 10,
    baseAuthorityPower: 20,
    baseDignityPower: 40,
    adminLoad: 2,
    coordinationLoad: 5,
  },
  'house:leader': {
    organizationKind: 'house',
    role: 'leader',
    displayName: 'House Head',
    maxHolders: 1,
    baseSalary: 0,
    baseAuthorityPower: 75,
    baseDignityPower: 80,
    adminLoad: 0,
    coordinationLoad: 0,
  },
  'house:administrator': {
    organizationKind: 'house',
    role: 'administrator',
    displayName: 'Steward',
    maxHolders: 2,
    baseSalary: 10,
    baseAuthorityPower: 55,
    baseDignityPower: 30,
    adminLoad: 3,
    coordinationLoad: 6,
  },
  'house:treasurer': {
    organizationKind: 'house',
    role: 'treasurer',
    displayName: 'House Treasurer',
    maxHolders: 1,
    baseSalary: 10,
    baseAuthorityPower: 50,
    baseDignityPower: 30,
    adminLoad: 3,
    coordinationLoad: 4,
  },
  'house:military': {
    organizationKind: 'house',
    role: 'military',
    displayName: 'Guard Captain',
    maxHolders: 2,
    baseSalary: 10,
    baseAuthorityPower: 55,
    baseDignityPower: 45,
    adminLoad: 2,
    coordinationLoad: 5,
  },
  'house:advisor': {
    organizationKind: 'house',
    role: 'advisor',
    displayName: 'House Advisor',
    maxHolders: 3,
    baseSalary: 5,
    baseAuthorityPower: 15,
    baseDignityPower: 35,
    adminLoad: 1,
    coordinationLoad: 3,
  },
}

export function getOfficeDefinition(
  kind: OrganizationKind,
  role: OfficeRole,
): OfficeDefinition | undefined {
  return OFFICE_DEFINITIONS[`${kind}:${role}`]
}

export function isValidOfficeRole(kind: OrganizationKind, role: OfficeRole): boolean {
  return `${kind}:${role}` in OFFICE_DEFINITIONS
}
