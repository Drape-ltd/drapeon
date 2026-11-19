'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'

export function DataAccessActionPanel({ issueId, exportId, status, recordVersion, protectedAccess, protectedCheckpoint }: {
  issueId: string
  exportId: string | null
  status: string
  recordVersion: number | null
  protectedAccess: boolean
  protectedCheckpoint: string
}) {
  const router = useRouter()
  const command = useIdempotentCommand('ops-data-access-release')
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const terminal = ['RESOLVED', 'CLOSED'].includes(status.toUpperCase())

  async function act(action: 'INSPECT' | 'RELEASE') {
    if (busy || !exportId || !protectedAccess || recordVersion === null) return
    setBusy(true)
    setMessage(null)
    const fingerprint = idempotencyFingerprint([issueId, exportId, action, reason.trim(), recordVersion])
    const attempt = command.begin(fingerprint)
    try {
      const response = await fetch('/api/actions/data-access', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, exportId, action, reason: reason.trim(),
          expectedRecordVersion: recordVersion, idempotencyKey: attempt.key, correlationId: crypto.randomUUID() }) })
      const result = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) {
        setMessage(response.status === 409 ? 'Case or export changed. Reload before acting.' : String(result.error ?? 'Protected action failed.'))
        return
      }
      const receipt = result.receipt && typeof result.receipt === 'object' ? result.receipt as Record<string, unknown> : {}
      if (action === 'INSPECT') {
        setPreview(receipt.exportPackage && typeof receipt.exportPackage === 'object' ? receipt.exportPackage as Record<string, unknown> : null)
        setExportStatus(typeof receipt.exportStatus === 'string' ? receipt.exportStatus : null)
        setReviewed(false)
        setMessage('Evidence access was audited. Review every section and generation warning before release.')
      } else if (receipt.receiptOutcome === 'SUCCEEDED') {
        command.complete(fingerprint)
        setPreview(null)
        setReviewed(false)
        setMessage('Reviewed export released. The case stays open until the requester downloads it.')
        router.refresh()
      } else {
        setMessage('No successful release receipt was returned. Reload and inspect the case.')
      }
    } catch {
      setMessage('Response interrupted. Reload and check the receipt before retrying.')
    } finally {
      setBusy(false)
    }
  }

  if (!exportId) return <p className="ops-muted">This case has no linked export package. Escalate to Privacy Ops; do not close it.</p>
  if (terminal) return <p className="ops-muted">This data-access case is resolved. Its delivery receipt remains in the timeline.</p>
  return <div className="ops-deletion-actions">
    <div className="ops-action-block">
      <h3>Review the requester’s export</h3>
      <p>The full package is private. Opening it requires fresh protected access and records an evidence access audit.</p>
      {protectedAccess ? <button className="ops-button" type="button" disabled={busy || recordVersion === null}
        onClick={() => void act('INSPECT')}>{busy ? 'Opening…' : 'Open audited export'}</button>
        : <a className="ops-button" href={protectedCheckpoint}>Verify protected access first</a>}
      {preview ? <details open><summary>Export package and generation warnings</summary>
        <pre style={{ maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(preview, null, 2)}</pre>
      </details> : null}
    </div>
    {preview && exportStatus === 'IN_REVIEW' ? <div className="ops-action-block">
      <h3>Release reviewed export</h3>
      <p>Only release a complete, current package for this requester. A package with generation warnings is refused by the database.</p>
      <label className="ops-field">Decision reason<textarea value={reason} maxLength={1000}
        onChange={(event) => setReason(event.target.value)} placeholder="State what sections and warnings you reviewed." /></label>
      <label className="ops-field"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed the complete export and its warnings.</label>
      <button className="ops-button ops-button-primary" type="button"
        disabled={busy || !reviewed || reason.trim().length < 12 || recordVersion === null}
        onClick={() => void act('RELEASE')}>{busy ? 'Releasing…' : 'Release for requester download'}</button>
    </div> : null}
    {message ? <p role="status" className="ops-muted">{message}</p> : null}
  </div>
}
