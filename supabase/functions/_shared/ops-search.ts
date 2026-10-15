import { canReadOpsAction } from './ops-read-policy.ts'
import { readOpsQueuePage } from './ops-queue-page.ts'

type Row = Record<string, unknown>
type Result = { data: Row[] | null; error: { message?: string } | null }
type Query = PromiseLike<Result> & {
  eq(column: string, value: string): Query
  ilike(column: string, value: string): Query
  in(column: string, values: string[]): Query
  order(column: string): Query
  limit(count: number): Query
}
export type OpsSearchClient = Parameters<typeof readOpsQueuePage>[0] & {
  from(table: string): { select(columns: string): Query }
}
export type OpsSearchResult = { id: string; label: string; href: string }
export type OpsSearchGroup = { label: string; results: OpsSearchResult[]; total?: number }
export type OpsSearchData = { query: string; groups: OpsSearchGroup[] }

// Independent filters avoid interpolating user input into PostgREST OR grammar.
// SQL LIKE metacharacters are escaped so names/emails remain literal searches.
export function searchPattern(query: string) {
  return `%${query.replace(/[\\%_*]/gu, (value) => `\\${value}`)}%`
}

export async function readOpsSearch(client: OpsSearchClient, environment: string, principal: { roles: string[]; email: string }, input: unknown): Promise<OpsSearchData> {
  if (typeof input !== 'string' || input.trim().length < 2 || input.trim().length > 160 || /[\x00-\x1f]/u.test(input)) throw new Error('Search requires 2–160 characters.')
  if (!canReadOpsAction(principal.roles, 'search')) throw new Error('Search is not permitted.')
  const query = input.trim()
  const pattern = searchPattern(query)
  const groups: OpsSearchGroup[] = []
  async function rows(request: PromiseLike<Result>) {
    const result = await request
    if (result.error) throw new Error('Ops search is temporarily unavailable.')
    return result.data ?? []
  }
  const page = await readOpsQueuePage(client, environment, principal, { scope: 'all', q: query })
  const cases = page.ids.length ? await rows(client.from('ops_issues').select('id,case_number,title').eq('environment', environment).in('id', page.ids)) : []
  const byId = new Map(cases.map((row) => [String(row.id), row]))
  groups.push({ label: 'Cases · open and closed', total: page.total, results: page.ids.flatMap((id) => {
    const row = byId.get(id)
    return row?.case_number ? [{ id, label: `${row.case_number} · ${row.title}`, href: `/ops/cases/${encodeURIComponent(String(row.case_number))}` }] : []
  }) })
  async function group(label: string, table: string, columns: string, fields: string[], base: string, customer = false) {
    const matches = await Promise.all(fields.map((field) => {
      let request = client.from(table).select(columns).ilike(field, pattern).order('id').limit(20)
      if (customer) request = request.eq('role', 'CUSTOMER')
      return rows(request)
    }))
    const unique = [...new Map(matches.flat().map((row) => [String(row.id), row])).values()].sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, 20)
    groups.push({ label, results: unique.map((row) => ({ id: String(row.id), label: String(row.reference || row.display_name || row.business_name || 'Unnamed record'), href: `${base}/${row.id}` })) })
  }
  // Each category inherits the existing destination's read permission.
  if (canReadOpsAction(principal.roles, 'orders')) await group('Orders', 'orders', 'id,reference', ['reference'], '/ops/orders')
  if (canReadOpsAction(principal.roles, 'customers')) await group('Customers', 'users', 'id,display_name', ['display_name', 'email'], '/ops/customers', true)
  if (canReadOpsAction(principal.roles, 'tailors')) await group('Tailors', 'tailor_profiles', 'id,display_name,business_name', ['display_name', 'business_name'], '/ops/tailors')
  return { query, groups }
}
