import Link from 'next/link'
import type { Route } from 'next'
import { PageHead } from '../../../components/page-head'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { loadOpsSearch } from '../../../lib/search-data'

export const dynamic = 'force-dynamic'

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Cross-workspace search" />
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q.trim() : ''
  const valid = query.length >= 2 && query.length <= 160 && !/[\x00-\x1f]/u.test(query)
  const data = valid ? await loadOpsSearch(query) : null
  const returnTo = `/ops/search?q=${encodeURIComponent(query)}`
  return <>
    <PageHead eyebrow="Operations" title="Search Ops" description="Find open or closed cases, order references, customer names or emails, and tailor names. Only workspaces you can access are searched." />
    <form className="ops-global-search-form" action="/ops/search" method="get">
      <label className="ops-field" htmlFor="ops-search-query">Search
      <input id="ops-search-query" name="q" type="search" defaultValue={query} minLength={2} maxLength={160} required placeholder="Case, order reference, or person" /></label>
      <button className="ops-button ops-button-primary" type="submit">Search</button>
    </form>
    {!valid ? <p>Enter 2–160 characters to search.</p> : data?.groups.map((group) => <section className="ops-section-block" key={group.label}>
      <div className="ops-section-head"><h2>{group.label}</h2><span>{group.total === undefined ? `${group.results.length} shown · up to 20` : `${group.total} matching case${group.total === 1 ? '' : 's'}`}</span></div>
      {group.results.length ? <div className="ops-domain-list">{group.results.map((result) => <article className="ops-domain-row" key={result.id}><Link className="ops-case-link" href={`${result.href}?returnTo=${encodeURIComponent(returnTo)}` as Route}>{result.label}</Link></article>)}</div> : <p>No matches in this workspace.</p>}
      {group.total !== undefined && group.total > group.results.length ? <Link className="ops-button" href={`/ops/queues/all?scope=all&q=${encodeURIComponent(query)}` as Route}>View all matching cases</Link> : null}
    </section>)}
  </>
}
