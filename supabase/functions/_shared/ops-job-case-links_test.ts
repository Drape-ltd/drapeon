import { loadJobCaseLinks } from './ops-job-case-links.ts'

function fakeClient(rows: Record<string, unknown>[], failure = false) {
  const calls: Array<{ ids: string[]; environment: string; from: number }> = []
  return { calls, from() { return { select() {
    let ids: string[] = []; let environment = ''; let from = 0; let to = 0
    const query = {
      eq(column: string, value: string) { if (column === 'environment') environment = value; return query },
      in(_column: string, value: string[]) { ids = value; return query },
      order() { return query },
      range(start: number, end: number) { from = start; to = end; return query },
      then(resolve: (value: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => unknown) {
        calls.push({ ids, environment, from })
        return Promise.resolve(resolve(failure ? { data: null, error: { message: 'unavailable' } } : {
          data: rows.filter((row) => ids.includes(String(row.related_entity_id)) && row.environment === environment).slice(from, to + 1), error: null,
        }))
      },
    }
    return query
  } } } }
}
function check(value: unknown, message: string) { if (!value) throw new Error(message) }

Deno.test('old job links survive unrelated recent history and stay environment scoped', async () => {
  const rows = Array.from({ length: 1200 }, (_, index) => ({ related_entity_id: `unrelated-${index}`, environment: 'DEVELOPMENT', case_number: `OPS-${index}` }))
  rows.push({ related_entity_id: 'target', environment: 'PRODUCTION', case_number: 'OPS-WRONG' })
  rows.push({ related_entity_id: 'target', environment: 'DEVELOPMENT', case_number: 'OPS-OLD' })
  const client = fakeClient(rows)
  const result = await loadJobCaseLinks(client, 'DEVELOPMENT', ['target', 'target'])
  check(result.data.length === 1 && result.data[0].case_number === 'OPS-OLD', 'Exact old case missing')
  check(client.calls.length === 1 && client.calls[0].ids.length === 1, 'Expected deduplicated scoped query')
})
Deno.test('filtered history is paged without losing later job links', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({ related_entity_id: 'many', environment: 'DEVELOPMENT', case_number: `OPS-${index}` }))
  rows.push({ related_entity_id: 'later', environment: 'DEVELOPMENT', case_number: 'OPS-LATER' })
  const client = fakeClient(rows)
  const result = await loadJobCaseLinks(client, 'DEVELOPMENT', ['many', 'later'])
  check(result.data.length === 2 && result.data[0].case_number === 'OPS-0', 'Latest case or later job lost')
  check(client.calls.length === 2 && client.calls[1].from === 500, 'Expected second history page')
})
Deno.test('empty lookup makes no query; errors and oversized input fail closed', async () => {
  const empty = fakeClient([])
  await loadJobCaseLinks(empty, 'DEVELOPMENT', [])
  check(empty.calls.length === 0, 'Empty lookup queried all cases')
  for (const run of [
    () => loadJobCaseLinks(fakeClient([], true), 'DEVELOPMENT', ['target']),
    () => loadJobCaseLinks(empty, 'UNKNOWN', ['target']),
    () => loadJobCaseLinks(empty, 'DEVELOPMENT', Array.from({ length: 301 }, (_, index) => String(index))),
  ]) {
    let failed = false
    try { await run() } catch { failed = true }
    check(failed, 'Unsafe lookup did not fail closed')
  }
})

Deno.test('job IDs are batched and excessive matching history never becomes a missing-case result', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ related_entity_id: String(index), environment: 'DEVELOPMENT', case_number: `OPS-${index}` }))
  const client = fakeClient(rows)
  const result = await loadJobCaseLinks(client, 'DEVELOPMENT', rows.map((row) => row.related_entity_id))
  check(result.data.length === 51 && client.calls.length === 2, 'Expected bounded ID batches')
  const crowded = fakeClient(Array.from({ length: 5000 }, () => ({ related_entity_id: 'target', environment: 'DEVELOPMENT' })))
  let failed = false
  try { await loadJobCaseLinks(crowded, 'DEVELOPMENT', ['target']) } catch { failed = true }
  check(failed && crowded.calls.length === 10, 'Truncated lookup must fail explicitly')
})
