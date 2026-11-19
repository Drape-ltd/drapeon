'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'
import { validOpsRpcReceiptSuccess } from '../lib/protected-action-response'

export function OrphanVerificationClosurePanel({ issueId, recordVersion, protectedAccess, protectedCheckpoint }: {
  issueId: string
  recordVersion: number | null
  protectedAccess: boolean
  protectedCheckpoint: string
}) {
  const router = useRouter()
  const command = useIdempotentCommand('ops-close-orphan-verification')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function close() {
    if (busy || !protectedAccess || recordVersion === null || reason.trim().length < 20) return
    const fingerprint = idempotencyFingerprint([issueId, 'CLOSE_ORPHAN_VERIFICATION', reason.trim(), recordVersion])
    const attempt = command.begin(fingerprint)
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/actions/case', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, action: 'CLOSE_ORPHAN_VERIFICATION', reason: reason.trim(),
          expectedRecordVersion: recordVersion, idempotencyKey: attempt.key, correlationId: crypto.randomUUID() }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok || !validOpsRpcReceiptSuccess(payload)) {
        setMessage(response.status === 409 ? 'Case changed or a source record exists. Reload and investigate.' : 'Closure was not confirmed. Check the case timeline before retrying.')
        return
      }
      command.complete(fingerprint)
      setMessage('Orphaned verification case closed with a receipt. No seller decision was made.')
      router.refresh()
    } catch {
      setMessage('Response interrupted. Reread the case and its receipt before retrying unchanged.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="ops-action-block ops-action-warning">
    <h3>Unavailable seller record</h3>
    <p>Use this only after checking the source account, profile and handoff. The database refuses closure if any source record still exists. This action does not approve or reject a seller.</p>
    <label className="ops-field">Orphan investigation and closure reason
      <textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
    </label>
    {protectedAccess ? <button className="ops-button" type="button" disabled={busy || recordVersion === null || reason.trim().length < 20}
      onClick={() => void close()}>{busy ? 'Closing…' : 'Close orphaned verification case'}</button>
      : <a className="ops-button" href={protectedCheckpoint}>Verify protected access first</a>}
    {message ? <p role="status">{message}</p> : null}
  </div>
}
