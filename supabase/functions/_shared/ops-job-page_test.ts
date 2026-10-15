import { loadJobPage, parseJobPage } from './ops-job-page.ts'
function check(value: unknown, message: string) { if (!value) throw new Error(message) }
const rows = Array.from({ length: 231 }, (_, index) => ({ id: String(index).padStart(4, '0'), status: index === 230 ? 'SUCCEEDED' : 'DEAD', job_type: index % 2 ? 'EMAIL' : 'CHECK', environment: 'DEVELOPMENT', case_number: 'OPS-GROUP' }))
function client(source = rows, noCount = false) {
  return { from(table: string) { return { select(_columns: string, options: { head?: boolean }) {
    let selected = [...source]
    const query = {
      eq(key: string, value: string) { selected = selected.filter((row) => row[key as keyof typeof row] === value); return query },
      in(key: string, values: string[]) { selected = selected.filter((row) => values.includes(row[key as keyof typeof row])); return query },
      order() { return query },
      range(from: number, to: number) {
        check(['job_queue', 'ops_grouped_job_items'].includes(table), 'Unexpected source')
        if (!options.head && from >= selected.length && from > 0) return Promise.resolve({ data: null, count: selected.length, error: { message: 'Requested range not satisfiable' } })
        return Promise.resolve({ data: options.head ? null : selected.slice(from, to + 1), count: noCount ? null : selected.length, error: null })
      },
    }
    return query
  } } } }
}
Deno.test('job pages reach records past 200 with exact totals and no overlaps', async () => {
  const first = await loadJobPage(client(), 'DEVELOPMENT', {})
  const second = await loadJobPage(client(), 'DEVELOPMENT', { page: '2' })
  const ninth = await loadJobPage(client(), 'DEVELOPMENT', { page: '9' })
  check(first.pageInfo.total === 230 && first.pageInfo.pageCount === 10, 'Total truncated')
  check(second.data[0].id === '0025' && ninth.data[0].id === '0200', 'Page not applied at source')
  check(!second.data.some((row) => first.data.some((previous) => previous.id === row.id)), 'Page overlap')
})
Deno.test('group includes completed jobs, filters before pagination, and clamps stale pages', async () => {
  const grouped = await loadJobPage(client(), 'DEVELOPMENT', { caseNumber: 'ops-group', page: '999999' })
  check(grouped.pageInfo.total === 231 && grouped.pageInfo.page === 10 && grouped.data.at(-1)?.status === 'SUCCEEDED', 'Group truncated or terminal record hidden')
  const filtered = await loadJobPage(client(), 'DEVELOPMENT', { jobType: 'email', jobState: 'dead', page: '2' })
  check(filtered.pageInfo.total === 115 && filtered.data[0].id === '0051', 'Filter applied after pagination')
  const other = await loadJobPage(client(), 'PRODUCTION', { caseNumber: 'OPS-GROUP' })
  check(other.pageInfo.total === 0, 'Cross-environment group leak')
})
Deno.test('invalid input and missing totals cannot produce misleading pagination', async () => {
  check(parseJobPage({ page: 'bad' }).page === 1, 'Invalid page fallback')
  check(parseJobPage({ page: '-1' }).page === 1, 'Negative page fallback')
  for (const run of [
    () => loadJobPage(client([], true), 'DEVELOPMENT', {}),
    () => loadJobPage(client(), 'UNKNOWN', {}),
    () => loadJobPage(client(), 'DEVELOPMENT', { caseNumber: 'not a case' }),
    () => loadJobPage(client(), 'DEVELOPMENT', { jobType: 'unsafe,filter' }),
  ]) {
    let failed = false
    try { await run() } catch { failed = true }
    check(failed, 'Expected fail-closed result')
  }
})
