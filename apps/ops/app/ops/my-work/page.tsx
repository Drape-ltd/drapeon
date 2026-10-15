import { PageHead } from '../../../components/page-head'
import { WorkList } from '../../../components/work-list'
import { OpsMetricCell } from '../../../components/ops-metric-cell'
import { loadCanonicalOpsData } from '../../../lib/data'
import { buildOpsWorkItems, runtimeContract } from '../../../lib/work-items'
import { ShieldCheck } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function MyWorkPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const query = await searchParams
  const data = await loadCanonicalOpsData({ queuePage: query })
  const items = buildOpsWorkItems(data)
  const contract = runtimeContract(data.canonicalColumnsAvailable)
  if (!data.pageInfo) throw new Error('Authoritative queue totals are unavailable.')
  const metrics = data.pageInfo.summary
  const pendingTailorApprovals = metrics.approvals

  return (
    <>
      <PageHead
        eyebrow="Work / My Work"
        title="What needs attention now"
        description="One ordered queue across trust, privacy, orders, money, and reliability. Priority and SLA decide the order; departments do not compete for screen space."
        meta={<>Fresh authoritative read · {new Date(data.observedAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}</>}
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
        <OpsMetricCell metricKey="ops.urgent_cases" value={metrics.urgent} detail="Policy-ordered attention" ariaLabel={`Open ${metrics.urgent} P0 or P1 work items`} />
        <OpsMetricCell metricKey="ops.sla_breached" value={metrics.slaTracked > 0 ? metrics.breached : null} detail={metrics.slaTracked > 0 ? `${metrics.slaTracked} open cases with running authoritative deadlines` : 'No open running authoritative deadlines'} ariaLabel={metrics.slaTracked > 0 ? `Open ${metrics.breached} overdue work items` : 'Open the authoritative SLA queue'} />
        <OpsMetricCell metricKey="ops.unassigned_cases" value={metrics.unassigned} detail="Named claim needed; owning teams are set" ariaLabel={`Open ${metrics.unassigned} unassigned work items`} />
      </section>
      <WorkList items={items} pageInfo={data.pageInfo} />
      <section className="ops-panel" style={{ marginTop: 24 }} aria-labelledby="runtime-contract-title">
        <div className="ops-panel-head"><h2 id="runtime-contract-title">Runtime contract</h2><span className="ops-chip" data-tone={contract.environment === 'production' ? 'warning' : 'healthy'}>{contract.environment}</span></div>
        <div className="ops-panel-body">
          <dl className="ops-runtime">
            <div className="ops-runtime-row"><dt>Release</dt><dd>{contract.release}</dd></div>
            <div className="ops-runtime-row"><dt>Supabase target</dt><dd>{contract.projectRef}</dd></div>
            <div className="ops-runtime-row"><dt>Identity</dt><dd>{contract.accessMode}</dd></div>
            <div className="ops-runtime-row"><dt>Sensitive step-up</dt><dd>{contract.sensitiveAccess}</dd></div>
            <div className="ops-runtime-row"><dt>Database authority</dt><dd>{contract.databaseAuthority}</dd></div>
            <div className="ops-runtime-row"><dt>Communication mode</dt><dd>{contract.communications}</dd></div>
          </dl>
        </div>
      </section>
    </>
  )
}
