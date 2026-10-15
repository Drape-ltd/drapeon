'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { JobRecoveryContext } from '../lib/job-recovery-data'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'
import { caseActionFailure } from '../lib/case-action-feedback.mjs'

export function JobRecoveryPanel({ context, issueId, recordVersion, terminal, protectedAccess, protectedCheckpoint }: {
  context: JobRecoveryContext; issueId: string; recordVersion: number | null; terminal: boolean
  protectedAccess: boolean; protectedCheckpoint: string
}) {
  const router = useRouter()
  const command = useIdempotentCommand('ops-job-recovery')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const pending = context.attempts.some((attempt) => attempt.outcome === 'PENDING')
  const recovered = context.attempts.some((attempt) => attempt.outcome === 'RECOVERED')
  const supported = ['RECONCILE_PAYMENT_WEBHOOK', 'RECONCILE_DELIVERY_WEBHOOK'].includes(context.jobType)
  const eligible = supported && context.jobStatus === 'DEAD' && !terminal && !pending && !recovered && context.attempts.length < 3
  const labels: Record<string, string> = { PENDING: 'Recovery pending', RECOVERED: 'Reconciliation matched', FAILED: 'Recovery failed', REVIEW_REQUIRED: 'Manual review required' }

  async function retry() {
    if (busy || !eligible || !protectedAccess || !recordVersion || reason.trim().length < 12) return
    const fingerprint = idempotencyFingerprint([issueId, context.jobId, recordVersion, reason.trim()])
    const attempt = command.begin(fingerprint)
    setBusy(true); setFeedback('')
    try {
      const response = await fetch('/api/actions/case', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'RETRY_JOB', issueId, jobId: context.jobId, reason: reason.trim(),
          expectedRecordVersion: recordVersion, idempotencyKey: attempt.key, correlationId: crypto.randomUUID() }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) { setFeedback(caseActionFailure(response.status)); return }
      const receipt = payload?.receipt
      if (payload?.ok !== true || typeof receipt?.receiptId !== 'string'
        || !['PENDING', 'SUCCEEDED', 'FAILED'].includes(receipt.receiptOutcome)) {
        setFeedback('The request could not be confirmed. Your reason is preserved. Refresh or retry unchanged to recover its receipt.'); return
      }
      command.complete(fingerprint)
      setFeedback(`Recovery request recorded. See Action results for its current outcome. Reference ${receipt.receiptId}.`)
      setReason(''); router.refresh()
    } catch {
      setFeedback('The response was interrupted. Your reason is preserved; retry unchanged to recover the same request.')
    } finally { setBusy(false) }
  }

  return <section className="ops-action-block">
    <h3>{supported ? 'Retry reconciliation' : 'Job recovery'}</h3>
    <p>{supported ? 'Recheck this job’s webhook evidence without repeating a payment, payout, refund, or notification. The original failure stays in the ledger.' : 'This job is not a read-only reconciliation. Review its cause and intended recipient or workflow before considering any further execution.'}</p>
    <p className="ops-muted">Job {context.jobId}</p>
    {context.attempts.map((attempt) => <p key={attempt.jobId}>{labels[attempt.outcome] ?? 'Unknown recovery state — review required'} · {new Date(attempt.requestedAt).toLocaleString()}<br /><small>Receipt {attempt.receiptId}</small></p>)}
    {pending ? <p role="status">Recovery is still pending. Wait for a terminal result before closing the case. <button className="ops-button" onClick={() => router.refresh()}>Refresh result</button></p> : null}
    {feedback ? <p role="status">{feedback}</p> : null}
    {!eligible ? <p className="ops-muted">{pending ? 'Another retry is blocked while this attempt runs.' : recovered ? 'Evidence matched. Review the case before resolving it.' : terminal ? 'This case is finished.' : context.attempts.length >= 3 ? 'Three recovery requests have been used. Engineering must investigate before further execution.' : 'This job requires manual investigation; automatic replay is not available.'}</p>
      : !protectedAccess ? <a className="ops-button" href={protectedCheckpoint}>Verify protected access to retry</a>
      : <><label className="ops-field">What changed or was checked?<textarea maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <p className="ops-muted">Enter at least 12 characters. Each recovery job is limited to three worker attempts.</p>
        <button className="ops-button" disabled={busy || !recordVersion || reason.trim().length < 12} onClick={retry}>{busy ? 'Recording recovery…' : 'Retry read-only reconciliation'}</button></>}
  </section>
}
