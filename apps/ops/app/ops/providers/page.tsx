import { AlertTriangle, CheckCircle2, Clock3, Radio, RotateCcw } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { PageHead } from '../../../components/page-head'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { loadReliabilityData } from '../../../lib/reliability-data'
import { groupJobsByType } from '../../../lib/job-groups.mjs'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { formatEnum, formatRelativeTime } from '../../../lib/work-items'

export const dynamic = 'force-dynamic'


function tone(value: string) {
  const normalized = value.toUpperCase()
  if (normalized.includes('OPEN') || normalized.includes('FAILED') || normalized.includes('CRITICAL') || normalized === 'DEAD') return 'critical'
  if (normalized.includes('DEGRADED') || normalized.includes('WARNING') || normalized.includes('RETRY') || normalized === 'PENDING') return 'warning'
  if (normalized.includes('HEALTHY') || normalized.includes('CLOSED') || normalized === 'OK') return 'healthy'
  return 'neutral'
}


export default async function ProvidersPage({ searchParams }: { searchParams: Promise<{ providerState?: string; jobState?: string; jobType?: string; page?: string; caseNumber?: string }> }) {
  if (!(await hasOpsAreaAccess('providers'))) return <OpsPermissionRestriction area="Providers & Jobs" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Providers & Jobs" />
  const query = await searchParams
  const data = await loadReliabilityData(query)
  const degradedProviders = data.providers.filter((provider) => !['HEALTHY', 'CLOSED', 'OK'].includes(provider.status.toUpperCase()))
  const selectedProviderState = query.providerState === 'degraded' ? 'degraded' : null
  const selectedJobState = data.jobPage.jobState
  const visibleProviders = selectedProviderState ? degradedProviders : data.providers
  const stateJobs = data.jobItems
  const selectedJobType = data.jobPage.jobType
  const groups = groupJobsByType(stateJobs)
  const { page: jobPage, pageCount: jobPageCount, pageSize: jobPageSize, total: jobTotal } = data.jobPage
  const visibleJobs = data.jobItems
  const jobHref = (type: string | null, page = 1) => `/ops/providers?${new URLSearchParams({ ...(query.caseNumber ? { caseNumber: query.caseNumber } : {}), ...(selectedProviderState ? { providerState: selectedProviderState } : {}), ...(selectedJobState ? { jobState: selectedJobState } : {}), ...(type ? { jobType: type } : {}), page: String(page) }).toString()}#job-ledger` as Route
  const pageHref = (page: number) => jobHref(selectedJobType, page)
  const clearStateHref = `/ops/providers?${new URLSearchParams({ ...(data.jobPage.caseNumber ? { caseNumber: data.jobPage.caseNumber } : {}), ...(selectedProviderState ? { providerState: selectedProviderState } : {}), ...(selectedJobType ? { jobType: selectedJobType } : {}) }).toString()}#job-ledger` as Route
  const queueRisk = data.jobs.dead + data.jobs.retryable
  const jobsMissingCases = data.jobItems.filter((job) => job.status === 'DEAD' && !job.linkedCaseNumber).length

  return (
    <>
      <PageHead eyebrow="Reliability / Providers" title="Providers & jobs" description="Provider circuits, queue pressure, callbacks, and Drapeon-owned synthetic paths. A green vendor status page is never treated as workflow proof." meta={`Observed ${formatRelativeTime(data.observedAt)}`} />
      <section className="ops-summary-grid" aria-label="Provider and queue summary">
        <Link className="ops-summary-cell ops-summary-link" href="/ops/providers?providerState=degraded#provider-lanes"><div className="ops-summary-label">Degraded lanes</div><div className="ops-summary-value">{degradedProviders.length}</div><div className="ops-summary-detail">Provider-operation circuits needing attention</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/providers?jobState=PENDING#job-ledger"><div className="ops-summary-label">Pending jobs</div><div className="ops-summary-value">{data.jobs.pending}</div><div className="ops-summary-detail">Oldest {data.jobs.oldestPendingAt ? formatRelativeTime(data.jobs.oldestPendingAt) : 'not recorded'}</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/providers?jobState=RETRYABLE#job-ledger"><div className="ops-summary-label">Retryable</div><div className="ops-summary-value">{data.jobs.retryable}</div><div className="ops-summary-detail">Bounded recovery candidates</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/providers?jobState=DEAD#job-ledger"><div className="ops-summary-label">Needs review</div><div className="ops-summary-value">{data.jobs.dead}</div><div className="ops-summary-detail">{data.jobs.reviewedDead ? `${data.jobs.reviewedDead} reviewed terminal record${data.jobs.reviewedDead === 1 ? '' : 's'} retained` : 'Unreviewed dead-letter jobs'}</div></Link>
      </section>

      {queueRisk > 0 ? <div className="ops-status-banner ops-banner-after-grid" data-tone={data.jobs.dead > 0 ? 'critical' : 'warning'} role="alert"><AlertTriangle size={16} /><span>The job queue has {data.jobs.dead} dead and {data.jobs.retryable} retryable job{queueRisk === 1 ? '' : 's'}.{jobsMissingCases ? ` ${jobsMissingCases} visible dead jobs predate automatic Reliability ownership.` : ''} <Link href="/ops/queues/reliability">Open Reliability</Link> before replaying anything.</span></div> : null}

      <section className="ops-section-block" id="provider-lanes">
        <div className="ops-section-head"><div><p className="ops-action-label">Circuit state</p><h2>{selectedProviderState ? 'Degraded provider lanes' : 'Provider lanes'}</h2></div><div className="ops-section-actions">{selectedProviderState ? <Link className="ops-button" href="/ops/providers#provider-lanes">Clear filter</Link> : null}<span className="ops-muted">Provider + operation, not one vague vendor light</span></div></div>
        {visibleProviders.length > 0 ? (
          <div className="ops-provider-grid">
            {visibleProviders.map((provider) => (
              <article className="ops-provider-card" key={`${provider.provider}:${provider.operation}`}>
                <div className="ops-provider-head"><span className="ops-provider-icon" data-tone={tone(provider.status)}>{['HEALTHY', 'CLOSED', 'OK'].includes(provider.status.toUpperCase()) ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</span><span className="ops-chip" data-tone={tone(provider.status)}>{formatEnum(provider.status)}</span></div>
                <p className="ops-action-label">{formatEnum(provider.provider)}</p>
                <h3>{formatEnum(provider.operation)}</h3>
                <dl className="ops-mini-facts">
                  <div><dt>Failures</dt><dd>{provider.failureCount}</dd></div>
                  <div><dt>Circuit</dt><dd>{provider.circuitOpenUntil ? `Until ${new Date(provider.circuitOpenUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Closed'}</dd></div>
                  <div><dt>Last update</dt><dd>{provider.updatedAt ? formatRelativeTime(provider.updatedAt) : 'Never'}</dd></div>
                </dl>
                {provider.hasRecordedError ? <p className="ops-provider-error">Failure detail is retained in the linked incident and provider logs.</p> : <p className="ops-provider-ok"><CheckCircle2 size={13} />No active provider error recorded</p>}
              </article>
            ))}
          </div>
        ) : <div className="ops-empty"><Radio size={20} /><h2>{selectedProviderState ? 'No degraded provider lane' : 'No provider circuit observations yet'}</h2><p>{selectedProviderState ? 'The current authoritative provider set has no degraded operation.' : 'This is live state. A provider-operation lane appears after the authoritative circuit breaker records a success or failure.'}</p></div>}
      </section>

      <section className="ops-section-block" id="job-ledger">
        {data.jobPage.caseNumber ? <p className="ops-muted">Jobs linked to {data.jobPage.caseNumber}, including completed jobs. All matching records are available through the pages below. <Link href={`/ops/cases/${encodeURIComponent(data.jobPage.caseNumber)}`}>Back to case</Link> · <Link href="/ops/providers#job-ledger">Show all jobs</Link></p> : null}
        <div className="ops-section-head"><div><p className="ops-action-label">Find repeated failures</p><h2>Job types on this page</h2><p className="ops-muted">Counts below cover the {stateJobs.length} jobs on this page{selectedJobState ? ` in ${formatEnum(selectedJobState).toLowerCase()} state` : ''}. Selecting a type searches all matching records, not just this page. Matching types do not necessarily share a root cause.</p></div></div>
        <div className="ops-toolbar" aria-label="Job type filters">
          <Link className="ops-button" aria-current={!selectedJobType ? 'true' : undefined} href={jobHref(null)}>All types</Link>
          {groups.map((group) => <Link className="ops-button" aria-current={selectedJobType === group.type ? 'true' : undefined} href={jobHref(group.type)} key={group.type}>{formatEnum(group.type)} · {group.count}{group.missingCases ? ` · ${group.missingCases} without a case` : ''}</Link>)}
        </div>
        {selectedJobType ? <p className="ops-muted">Showing {formatEnum(selectedJobType)}. <Link href={jobHref(null)}>Clear type filter</Link></p> : null}
        <div className="ops-section-head"><div><p className="ops-action-label">Queue source set</p><h2>{selectedJobState ? `${formatEnum(selectedJobState)} jobs` : data.jobPage.caseNumber ? 'Linked job ledger' : 'Actionable job ledger'}</h2></div><div className="ops-section-actions">{selectedJobState ? <Link className="ops-button" href={clearStateHref}>Clear state filter</Link> : null}<Link className="ops-button" href="/ops/queues/reliability">Open reliability cases</Link><span className="ops-muted">Payloads and raw errors are excluded</span></div></div>
        {visibleJobs.length > 0 ? <><JobLedger jobs={visibleJobs} returnTo={pageHref(jobPage)} /><nav className="ops-pagination" aria-label="Job ledger pages"><span>{(jobPage - 1) * jobPageSize + 1}–{Math.min(jobPage * jobPageSize, jobTotal)} of {jobTotal}</span><div>{jobPage > 1 ? <Link className="ops-button" href={pageHref(jobPage - 1)}>Previous</Link> : <span className="ops-button" aria-disabled="true">Previous</span>}<span>Page {jobPage} of {jobPageCount}</span>{jobPage < jobPageCount ? <Link className="ops-button" href={pageHref(jobPage + 1)}>Next</Link> : <span className="ops-button" aria-disabled="true">Next</span>}</div></nav></> : <div className="ops-empty"><CheckCircle2 size={20} /><h2>No matching jobs</h2><p>{data.jobPage.caseNumber ? 'No jobs linked to this case match the selected filters.' : 'No active or dead-letter jobs match the selected filters. Completed jobs remain available from their linked case.'}</p></div>}
      </section>

      <section className="ops-section-block" id="synthetic-paths">
        <div className="ops-section-head"><div><p className="ops-action-label">Drapeon-owned proof</p><h2>Synthetic paths</h2></div><span className="ops-muted">Freshness threshold: 12 minutes</span></div>
        {data.monitors.length > 0 ? <div className="ops-monitor-list">{data.monitors.map((monitor) => {
          const stale = Date.now() - new Date(monitor.checkedAt).getTime() > 12 * 60_000
          return <article className="ops-monitor-row" key={monitor.id}><span className="ops-provider-icon" data-tone={stale || !monitor.healthy ? 'critical' : 'healthy'}>{stale ? <Clock3 size={17} /> : monitor.healthy ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</span><div><h3>{monitor.targetName}</h3><p>{monitor.detail}</p></div><div><strong>{monitor.httpStatus || 'No HTTP'}</strong><span>{monitor.latencyMs} ms · {formatRelativeTime(monitor.checkedAt)}</span></div></article>
        })}</div> : <div className="ops-empty"><RotateCcw size={20} /><h2>No durable synthetic signal yet</h2><p>The Cloudflare monitor must authenticate to the reliability ingest function. Missing configuration is a failed monitor, not a green state.</p></div>}
      </section>
    </>
  )
}
import { JobLedger } from '../../../components/job-ledger'
