import 'server-only'
import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../web/lib/ops-edge-broker'
import { createServiceRoleClient } from '../../web/lib/server-supabase'

export type JobRecoveryContext = {
  jobId: string
  jobType: string
  jobStatus: string
  attempts: Array<{ jobId: string; outcome: string; requestedAt: string; completedAt: string | null; receiptId: string }>
}

export async function loadJobRecoveryContext(issueId: string, jobId: string): Promise<JobRecoveryContext | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return null
  if (requiresOpsEdgeBroker()) return invokeOpsReadBroker<JobRecoveryContext | null>('recovery-job', { issueId, jobId })
  const client = createServiceRoleClient()
  if (!client) throw new Error('Recovery context is unavailable.')
  const { data, error } = await client.rpc('get_ops_job_recovery_context', {
    p_issue_id: issueId, p_job_id: jobId, p_environment: 'DEVELOPMENT',
  })
  if (error) throw new Error('Recovery context could not be loaded.')
  return data as JobRecoveryContext | null
}
