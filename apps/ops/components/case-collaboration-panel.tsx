'use client'

import { AlertTriangle, CheckCircle2, LoaderCircle, NotebookPen, ShieldCheck, Siren, UserRoundCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'
import { validOpsRpcReceiptSuccess } from '../lib/protected-action-response'
import { caseActionFailure, caseActionSuccess, caseActionReference } from '../lib/case-action-feedback.mjs'

export function CaseCollaborationPanel({ issueId, status, assignee, recordVersion, authorizedForQueue, allowAcknowledge, allowAssign, allowEscalate, allowResolveDeadJob }: {
  issueId: string
  status: string
  assignee: string | null
  recordVersion: number | null
  authorizedForQueue: boolean
  allowAcknowledge: boolean
  allowAssign: boolean
  allowEscalate: boolean
  allowResolveDeadJob: boolean
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [escalationReason, setEscalationReason] = useState('')
  const [resolutionReason, setResolutionReason] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string; correlationId?: string } | null>(null)
  const command = useIdempotentCommand('ops-case-collaboration')
  const terminal = ['RESOLVED', 'CLOSED', 'CANCELLED'].includes(status.toUpperCase())

  async function act(action: 'ACKNOWLEDGE' | 'ASSIGN_SELF' | 'ADD_NOTE' | 'ESCALATE' | 'RESOLVE_DEAD_JOB') {
    if (pending || !recordVersion) return
    const reason = action === 'ADD_NOTE'
      ? note.trim()
      : action === 'ESCALATE'
        ? escalationReason.trim()
        : action === 'RESOLVE_DEAD_JOB'
          ? resolutionReason.trim()
          : ''
    const fingerprint = idempotencyFingerprint([issueId, action, reason, recordVersion])
    const attempt = command.begin(fingerprint)
    setPending(action)
    setResult(null)
    try {
      const response = await fetch('/api/actions/case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId,
          action,
          reason,
          expectedRecordVersion: recordVersion,
          idempotencyKey: attempt.key,
          correlationId: crypto.randomUUID(),
        }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      const correlationId = caseActionReference(payload)
      if (!response.ok) {
        setResult({ ok: false, message: caseActionFailure(response.status), correlationId })
        return
      }
      if (!validOpsRpcReceiptSuccess(payload)) {
        setResult({ ok: false, message: 'The case action response did not contain a successful durable receipt. Reread the case before retrying unchanged.', correlationId })
        return
      }
      command.complete(fingerprint)
      setResult({ ok: true, message: caseActionSuccess(action), correlationId })
      if (action === 'ADD_NOTE') setNote('')
      if (action === 'ESCALATE') setEscalationReason('')
      if (action === 'RESOLVE_DEAD_JOB') setResolutionReason('')
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The server response was interrupted. Your input is preserved; retry unchanged to recover the same idempotency receipt.' })
    } finally {
      setPending(null)
    }
  }

  if (terminal) return <p className="ops-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>This case is finished. Its history and action results remain available.</p>
  if (!authorizedForQueue) return <p className="ops-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>This queue is read-only for your workforce role. Its active queue policy does not authorize collaboration actions.</p>

  return (
    <div className="ops-deletion-actions">
      {!recordVersion ? <p role="alert" className="ops-muted">Actions are unavailable because the current case version could not be loaded. Refresh the case before making changes.</p> : null}
      {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}>{result.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{result.message}{result.correlationId ? <><br /><small>Reference {result.correlationId}</small></> : null}</span></div> : null}
      {allowAcknowledge && status.toUpperCase() === 'NEW' ? <button className="ops-button ops-button-primary" type="button" disabled={pending !== null || !recordVersion} onClick={() => act('ACKNOWLEDGE')}>{pending === 'ACKNOWLEDGE' ? <LoaderCircle className="ops-spin" size={15} /> : <CheckCircle2 size={15} />}Acknowledge</button> : null}
      {allowAssign && !assignee ? <button className="ops-button" type="button" disabled={pending !== null || !recordVersion} onClick={() => act('ASSIGN_SELF')}>{pending === 'ASSIGN_SELF' ? <LoaderCircle className="ops-spin" size={15} /> : <UserRoundCheck size={15} />}Assign to me</button> : null}
      <div className="ops-action-block">
        <p className="ops-action-label">Internal only</p>
        <h3>Add case note</h3>
        <p>Record facts, evidence reviewed, or a handoff. Notes do not notify the customer or change the domain outcome.</p>
        <label className="ops-field">Note<textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} /></label>
        <p className="ops-muted">Enter at least 8 characters to save a note.</p>
        <button className="ops-button" type="button" disabled={pending !== null || !recordVersion || note.trim().length < 8} onClick={() => act('ADD_NOTE')}>{pending === 'ADD_NOTE' ? <LoaderCircle className="ops-spin" size={15} /> : <NotebookPen size={15} />}Save internal note</button>
      </div>
      {allowEscalate ? <div className="ops-action-block ops-action-warning">
        <p className="ops-action-label">Queue escalation</p>
        <h3>Escalate to the backup team</h3>
        <p>Use this only when the owning team cannot safely resolve the case within policy. The reason, queue policy, backup team, and receipt are recorded together.</p>
        <label className="ops-field">Escalation reason<textarea value={escalationReason} maxLength={1000} onChange={(event) => setEscalationReason(event.target.value)} /></label>
        <p className="ops-muted">Enter at least 12 characters explaining why help is needed.</p>
        <button className="ops-button" type="button" disabled={pending !== null || !recordVersion || escalationReason.trim().length < 12} onClick={() => act('ESCALATE')}>{pending === 'ESCALATE' ? <LoaderCircle className="ops-spin" size={15} /> : <Siren size={15} />}Escalate case</button>
      </div> : null}
      {allowResolveDeadJob ? <div className="ops-action-block">
        <p className="ops-action-label">Terminal review</p>
        <h3>Close case without retrying the job</h3>
        <p>Use this only after reviewing the failed attempts and confirming that no further execution is needed. This closes the Reliability case, not the underlying payment, message, or other workflow. The failed job and its evidence are retained unchanged.</p>
        <label className="ops-field">Review outcome<textarea value={resolutionReason} maxLength={1000} onChange={(event) => setResolutionReason(event.target.value)} /></label>
        <p className="ops-muted">Enter at least 12 characters explaining why this job should not run again.</p>
        <button className="ops-button ops-button-primary" type="button" disabled={pending !== null || !recordVersion || resolutionReason.trim().length < 12} onClick={() => act('RESOLVE_DEAD_JOB')}>{pending === 'RESOLVE_DEAD_JOB' ? <LoaderCircle className="ops-spin" size={15} /> : <ShieldCheck size={15} />}Close without retry</button>
      </div> : null}
    </div>
  )
}
