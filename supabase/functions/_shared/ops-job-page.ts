export type JobPageInput = { caseNumber?: unknown; jobState?: unknown; jobType?: unknown; page?: unknown }
type Row = Record<string, unknown>
type Result = { data: Row[] | null; count: number | null; error: { message: string } | null }
type Query = PromiseLike<Result> & {
  eq(column: string, value: string): Query
  in(column: string, values: string[]): Query
  order(column: string, options: { ascending: boolean }): Query
  range(from: number, to: number): Query
}
type Client = { from(table: string): { select(columns: string, options: { count: 'exact'; head?: boolean }): unknown } }
const states = ['PENDING', 'RETRYABLE', 'PROCESSING', 'DEAD']
const pageSize = 25

export function parseJobPage(input: JobPageInput) {
  const caseNumber = typeof input.caseNumber === 'string' ? input.caseNumber.trim().toUpperCase() : null
  if (caseNumber && !/^OPS-[A-Z0-9-]{1,60}$/u.test(caseNumber)) throw new Error('Invalid case number.')
  const jobState = typeof input.jobState === 'string' && states.includes(input.jobState.toUpperCase()) ? input.jobState.toUpperCase() : null
  const jobType = typeof input.jobType === 'string' ? input.jobType.trim().toUpperCase() : null
  if (jobType && !/^[A-Z][A-Z0-9_]{0,99}$/u.test(jobType)) throw new Error('Invalid job type.')
  const rawPage = typeof input.page === 'string' || typeof input.page === 'number' ? Number(input.page) : 1
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 1000000) : 1
  return { caseNumber: caseNumber || null, jobState, jobType: jobType || null, page }
}

/** Filters and ranges belong in the database, not in a truncated UI array. */
export async function loadJobPage(client: Client, environment: string, input: JobPageInput) {
  if (!['DEVELOPMENT', 'PRODUCTION'].includes(environment)) throw new Error('Invalid job environment.')
  const filters = parseJobPage(input)
  const read = async (page: number, head = false) => {
    let query = client.from(filters.caseNumber ? 'ops_grouped_job_items' : 'job_queue')
      .select('id,job_type,status,attempt_count,max_attempts,run_at,created_at,updated_at', { count: 'exact', head }) as Query
    if (filters.caseNumber) query = query.eq('environment', environment).eq('case_number', filters.caseNumber)
    else query = query.in('status', states)
    if (filters.jobState) query = query.eq('status', filters.jobState)
    if (filters.jobType) query = query.eq('job_type', filters.jobType)
    const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
    if (result.error) throw new Error(`Job ledger is unavailable: ${result.error.message}`)
    if ((!head && !result.data) || result.count === null) throw new Error('Job ledger returned no authoritative total.')
    return result
  }
  // Count before requesting an offset: PostgREST rejects out-of-range ranges
  // with 416, so a stale bookmark cannot be clamped after that request.
  const countResult = await read(1, true)
  const pageCount = Math.max(1, Math.ceil(countResult.count! / pageSize))
  const page = Math.min(filters.page, pageCount)
  const result = countResult.count === 0 ? { ...countResult, data: [] } : await read(page)
  return { data: result.data!, error: null, pageInfo: { ...filters, page, pageSize, total: result.count!, pageCount: Math.max(1, Math.ceil(result.count! / pageSize)) } }
}
