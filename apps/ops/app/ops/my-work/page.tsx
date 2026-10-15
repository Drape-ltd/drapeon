import { PageHead } from '../../../components/page-head'
import { WorkList } from '../../../components/work-list'
import { OpsMetricCell } from '../../../components/ops-metric-cell'
import { loadCanonicalOpsData } from '../../../lib/data'
import { buildOpsWorkItems } from '../../../lib/work-items'
import { ShieldCheck } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function MyWorkPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const query = await searchParams
  const data = await loadCanonicalOpsData({ queuePage: query })
  const items = buildOpsWorkItems(data)
  if (!data.pageInfo) throw new Error('Authoritative queue totals are unavailable.')
  const metrics = data.pageInfo.summary
  const pendingTailorApprovals = metrics.approvals
  const personalInbox = query.ownership === 'mine'

  return (
    <>
      <PageHead
        eyebrow={personalInbox ? 'Work / Inbox' : 'Work / My Work'}
        title={personalInbox ? 'Your assigned cases' : 'What needs attention now'}
        description={personalInbox
          ? 'The list below shows your assignments. Summary totals cover all permitted queues; use All cases to find and claim team work.'
          : "Review your team's cases, claim work, and follow up on approaching deadlines. Use Assigned to me to focus on your own cases."}
        meta={<>Updated {new Date(data.observedAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}</>}
      />
      {pendingTailorApprovals > 0 ? (
        <section className="ops-status-banner" data-tone="warning" role="alert" aria-label="Tailor approvals needed">
          <ShieldCheck size={20} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>{pendingTailorApprovals} tailor {pendingTailorApprovals === 1 ? 'approval needs' : 'approvals need'} review</strong>
            <p style={{ margin: '4px 0 0' }}>Review the private challenge video and onboarding proof before marketplace access is granted.</p>
          </div>
          <Link className="ops-button ops-button-primary" href="/ops/queues/trust?caseType=TAILOR_VERIFICATION">Review now</Link>
        </section>
      ) : null}
      <section className="ops-summary-grid" aria-label="Work summary">
        <OpsMetricCell metricKey="ops.open_cases" value={metrics.open} detail="Across all permitted queues" ariaLabel={`Open all ${metrics.open} work items`} />
        <OpsMetricCell metricKey="ops.urgent_cases" value={metrics.urgent} detail="Critical and high-priority cases" ariaLabel={`Open ${metrics.urgent} P0 or P1 work items`} />
        <OpsMetricCell metricKey="ops.sla_breached" value={metrics.slaTracked > 0 ? metrics.breached : null} detail={metrics.slaTracked > 0 ? `${metrics.slaTracked} open cases have active deadlines` : 'No open cases with active deadlines'} ariaLabel={metrics.slaTracked > 0 ? `Open ${metrics.breached} overdue work items` : 'Open cases with deadlines'} />
        <OpsMetricCell metricKey="ops.unassigned_cases" value={metrics.unassigned} detail="An owning team is set; a person still needs to claim" ariaLabel={`Open ${metrics.unassigned} unassigned work items`} />
      </section>
      <WorkList items={items} pageInfo={data.pageInfo} />
    </>
  )
}
