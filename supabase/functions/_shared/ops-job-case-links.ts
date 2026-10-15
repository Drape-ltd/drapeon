type LinkRow = Record<string, unknown>
type LinkResult = { data: LinkRow[] | null; error: { message: string } | null }
type LinkClient = { from(table: string): { select(columns: string): unknown } }

/** Resolve only the displayed jobs, never a global recent-case window. */
export async function loadJobCaseLinks(client: LinkClient, environment: string, jobIds: string[]) {
  if (!['DEVELOPMENT', 'PRODUCTION'].includes(environment)) throw new Error('Invalid job case environment.')
  const ids = [...new Set(jobIds)]
  if (ids.length > 300) throw new Error('Job case lookup exceeds the page budget.')
  const latest = new Map<string, LinkRow>()
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50)
    let complete = false
    for (let page = 0; page < 10; page++) {
      // Deliberately narrow the SDK builder here; inspecting its recursive generic
      // schema type across the web and Edge SDKs exhausts TypeScript instantiation.
      const query = client.from('ops_job_case_links')
        .select('case_number,issue_number,canonical_status,status,related_entity_id,updated_at,dead_job_disposition') as LinkQuery
      const result = await query
        .eq('related_entity_type', 'job_queue').eq('environment', environment)
        .in('related_entity_id', batch)
        .order('updated_at', { ascending: false }).order('case_number', { ascending: true })
        .range(page * 500, page * 500 + 499)
      if (result.error) throw new Error(`Job recovery cases are unavailable: ${result.error.message}`)
      if (!result.data) throw new Error('Job recovery cases returned no data.')
      for (const row of result.data) {
        const id = String(row.related_entity_id ?? '')
        if (batch.includes(id) && !latest.has(id)) latest.set(id, row)
      }
      if (result.data.length < 500) { complete = true; break }
    }
    if (!complete) throw new Error('Job recovery case history exceeds the lookup budget. Narrow the job page.')
  }
  return { data: [...latest.values()], error: null }
}

type LinkQuery = PromiseLike<LinkResult> & {
  eq(column: string, value: string): LinkQuery
  in(column: string, values: string[]): LinkQuery
  order(column: string, options: { ascending: boolean }): LinkQuery
  range(from: number, to: number): LinkQuery
}
