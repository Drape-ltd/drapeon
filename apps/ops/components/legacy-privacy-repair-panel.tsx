'use client'

import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'
import { validOpsRpcReceiptSuccess } from '../lib/protected-action-response'
import { caseActionFailure, caseActionReference } from '../lib/case-action-feedback.mjs'

export function LegacyPrivacyRepairPanel({ caseNumber, recordVersion }: { caseNumber: string; recordVersion: number }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; correlationId?: string } | null>(null)
  const command = useIdempotentCommand('ops-legacy-privacy-repair')

  async function repair() {
    if (pending || reason.trim().length < 12) return
    const fingerprint = idempotencyFingerprint([caseNumber, recordVersion, reason.trim()])
    const attempt = command.begin(fingerprint)
    setPending(true)
    setResult(null)
    try {
      const response = await fetch('/api/actions/privacy-repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRecordVersion: recordVersion,
          idempotencyKey: attempt.key,
          correlationId: crypto.randomUUID(),
          reason: reason.trim(),
        }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      const correlationId = caseActionReference(payload)
      if (!response.ok || !validOpsRpcReceiptSuccess(payload)) {
        setResult({ ok: false, message: response.ok ? 'The repair response did not contain a successful durable receipt. Reread the case before retrying unchanged.' : caseActionFailure(response.status), correlationId })
        return
      }
      command.complete(fingerprint)
      setResult({ ok: true, message: 'The QA case is restored to the Production privacy queue. Open it there and close it through the normal QA workflow.', correlationId })
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The server response was interrupted. Your input is preserved; retry unchanged to recover the same receipt.' })
    } finally {
      setPending(false)
    }
  }

  return <section className="ops-panel">
    <div className="ops-panel-head"><h2>Legacy QA privacy repair</h2><ShieldCheck size={16} color="var(--needle)" /></div>
    <div className="ops-panel-body ops-deletion-actions">
      <div className="ops-status-banner" data-tone="warning" role="alert"><AlertTriangle size={16} /><span>This one-time action restores only {caseNumber}, the legacy QA data-access case that was written with an unknown environment. It does not modify customer data or any other case.</span></div>
      <p>Review the case history after the receipt is recorded, then close it as QA through the usual privacy workflow.</p>
      {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}>{result.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{result.message}{result.correlationId ? <><br /><small>Reference {result.correlationId}</small></> : null}</span></div> : null}
      <label className="ops-field">Repair reason<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
      <p className="ops-muted">Enter at least 12 characters. Your identity, the before/after state, and a durable receipt are recorded.</p>
      <button className="ops-button ops-button-primary" type="button" disabled={pending || reason.trim().length < 12} onClick={repair}>{pending ? <LoaderCircle className="ops-spin" size={15} /> : <ShieldCheck size={15} />}{pending ? 'Restoring case…' : 'Restore QA case to privacy queue'}</button>
    </div>
  </section>
}
