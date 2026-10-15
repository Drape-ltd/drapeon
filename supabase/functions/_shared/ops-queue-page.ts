// Shared by the local development read bridge and the verified Edge broker.
// Identity is supplied by those callers, never by the browser's filters.
export type OpsQueuePage = {
  ids: string[]
  total: number
  page: number
  pages: number
  summary: { open: number; urgent: number; unassigned: number; slaTracked: number; breached: number; approvals: number }
}

export type OpsQueueFilters = Partial<Record<'scope' | 'queue' | 'priority' | 'phase' | 'caseType' | 'ownership' | 'q' | 'page', string>>

export async function readOpsQueuePage(
  client: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> },
  environment: string,
  principal: { roles: string[]; email: string },
  filters: unknown,
): Promise<OpsQueuePage> {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('Invalid queue filters.')
  const result = await client.rpc('ops_queue_page', {
    p_environment: environment,
    p_roles: principal.roles,
    p_actor_email: principal.email,
    p_filters: filters,
  })
  if (result.error) throw new Error(`Ops queue pagination is unavailable: ${result.error.message}`)
  const page = result.data as OpsQueuePage | null
  if (!page || !Array.isArray(page.ids) || page.ids.length > 20 || !Number.isInteger(page.total)
    || !Number.isInteger(page.page) || !Number.isInteger(page.pages) || page.page < 1 || page.page > page.pages
    || !page.summary) throw new Error('Invalid authoritative queue page.')
  return page
}
