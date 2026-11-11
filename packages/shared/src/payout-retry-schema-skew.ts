export type PayoutRetrySchemaTable =
  | 'payout_claims'
  | 'payout_provider_operations'
  | 'payout_claim_retry_authorizations'
  | 'payouts'
  | 'order_settlement_tranches'

export type PayoutRetryQueryScope = {
  table: PayoutRetrySchemaTable
  columns: readonly string[]
}

export type PayoutRetryQueryResult<T> = {
  data: T[] | null
  error: unknown
}

function errorText(error: unknown) {
  if (!error || typeof error !== 'object') return ''
  const value = error as { message?: unknown; details?: unknown }
  return [value.message, value.details]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object') return ''
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code.toUpperCase() : ''
}

function relationPattern(table: string) {
  return new RegExp(`(?:public\\.)?${table}`, 'i')
}

function missingTable(error: unknown, table: PayoutRetrySchemaTable) {
  const code = errorCode(error)
  const message = errorText(error)
  const relation = relationPattern(table).source
  if (code === '42P01') return new RegExp(`relation\\s+["']?${relation}["']?\\s+does not exist`, 'i').test(message)
  if (code === 'PGRST205') return new RegExp(`could not find the table\\s+["']?${relation}["']?\\s+in the schema cache`, 'i').test(message)
  return false
}

function missingColumn(error: unknown, table: PayoutRetrySchemaTable, columns: readonly string[]) {
  const code = errorCode(error)
  if (code !== '42703' && code !== 'PGRST204') return false
  const message = errorText(error)
  return columns.some((column) => {
    const quotedColumn = `(?:["']?${column}["']?)`
    if (code === 'PGRST204') {
      const qualified = new RegExp(`could not find the ${quotedColumn} column of ["'](?:public\\.)?${table}["'] in the schema cache`, 'i')
      return qualified.test(message)
    }
    const postgres = new RegExp(`column\\s+(?:(?:public\\.)?${table}\\.)?${quotedColumn}\\s+does not exist`, 'i')
    return postgres.test(message)
  })
}

export function isPayoutRetrySchemaUnavailable(error: unknown, scope: PayoutRetryQueryScope) {
  return missingTable(error, scope.table) || missingColumn(error, scope.table, scope.columns)
}

/**
 * Payout retry data is optional while its migrations are pending. Suppress only
 * exact missing-table/column errors for the queried schema slice so the Ops
 * Money Desk still renders without exposing a retry control. Other failures
 * remain visible to the caller.
 */
export function optionalPayoutRetryRows<T>(
  result: PayoutRetryQueryResult<T>,
  scope: PayoutRetryQueryScope,
  label: string,
) {
  if (!result.error) return { supported: true, rows: result.data ?? [] }
  if (isPayoutRetrySchemaUnavailable(result.error, scope)) return { supported: false, rows: [] as T[] }
  const message = result.error && typeof result.error === 'object'
    ? (result.error as { message?: unknown }).message
    : null
  throw new Error(`${label} is unavailable: ${typeof message === 'string' ? message : 'unknown database error'}`)
}
