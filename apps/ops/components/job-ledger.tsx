import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react'
import { getOpsSession } from '../../web/lib/ops-auth'
import type { JobQueueItem } from '../lib/reliability-data'
import { formatEnum, formatRelativeTime } from '../lib/work-items'
import { SourceCaseAction } from './source-case-action'
import { isReviewedDeadJob } from '../lib/job-review-state.mjs'

const recursiveJobs = new Set(['CREATE_OPS_ISSUE', 'SEND_OPS_SLACK', 'SEND_OPS_SLACK_DIGEST'])

export async function JobLedger({ jobs, returnTo }: { jobs: JobQueueItem[]; returnTo: string }) {
  const session = await getOpsSession()
  const canCreate = Boolean(session?.allowed && ['admin', 'engineering'].includes(session.role))
  return <div className="ops-domain-list">{jobs.map((job) => {
    const dead = job.status === 'DEAD'
    const reviewed = isReviewedDeadJob(job)
    const content = <><span className="ops-provider-icon" data-tone={reviewed ? 'healthy' : dead ? 'critical' : 'warning'}>
      {reviewed ? <CheckCircle2 size={16} /> : dead ? <AlertTriangle size={16} /> : <Clock3 size={16} />}</span>
      <div><strong>{formatEnum(job.type)}</strong><small>Job {job.id} · created {formatRelativeTime(job.createdAt)}</small></div>
      <div><span className="ops-label">State</span><strong>{reviewed ? 'Reviewed terminal' : formatEnum(job.status)}</strong><small>{job.attempts} of {job.maxAttempts} attempts</small></div>
      <div><span className="ops-label">Review</span><strong>{job.linkedCaseNumber ?? (dead ? 'No linked case' : 'Processing automatically')}</strong><small>Updated {formatRelativeTime(job.updatedAt)}</small></div></>
    return <div key={job.id}>
      {job.linkedCaseNumber ? <Link className="ops-domain-row ops-domain-row-compact ops-domain-row-link"
        aria-label={`Open reliability case for job ${job.id}`}
        href={`/ops/cases/${job.linkedCaseNumber}?jobId=${encodeURIComponent(job.id)}&returnTo=${encodeURIComponent(returnTo)}`}>{content}</Link>
        : <div className="ops-domain-row ops-domain-row-compact">{content}</div>}
      {dead && !job.linkedCaseNumber ? recursiveJobs.has(job.type)
        ? <p className="ops-muted">Ops alert delivery failed. <Link href="/ops/incidents">Review System health</Link>; creating another alert case could repeat the failure.</p>
        : canCreate ? <details className="ops-panel-body"><summary>Open review for {formatEnum(job.type)} · {job.id.slice(0, 8)}</summary>
          <SourceCaseAction sourceType="job" sourceId={job.id} returnTo={returnTo} /></details>
          : <p className="ops-muted">Engineering or an administrator can open the missing Reliability case.</p>
        : null}
    </div>
  })}</div>
}
