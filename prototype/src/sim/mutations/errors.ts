export type SimErrorCode =
  | 'PERSON_NOT_FOUND'
  | 'HOUSE_NOT_FOUND'
  | 'COUNTRY_NOT_FOUND'
  | 'PROVINCE_NOT_FOUND'
  | 'PERSON_DEAD'
  | 'HOUSE_INACTIVE'
  | 'COUNTRY_INACTIVE'
  | 'OFFICE_LIMIT_EXCEEDED'
  | 'CROSS_COUNTRY_TRANSFER'
  | 'INVALID_SHARE'
  | 'INTEGRITY_VIOLATION'

export type SimError = {
  code: SimErrorCode
  message: string
  context?: Record<string, unknown>
}
