'use client'

import Link from 'next/link'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'
import { caseActionFailure } from '../lib/case-action-feedback.mjs'
import { sourceCaseResult } from '../lib/source-case-result.mjs'

export function SourceCaseAction({ sourceType, sourceId, returnTo }: {
  sourceType: 'order' | 'job'; sourceId: string; returnTo: string
}) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ReturnType<typeof sourceCaseResult>>(null)
  const command = useIdempotentCommand('ops-source-case')

  async function createCase() {
    if (pending || reason.trim().length < 12) return
    const fingerprint = idempotencyFingerprint([sourceType, sourceId, reason.trim()])
    const attempt = command.begin(fingerprint)
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/actions/case', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CREATE_SOURCE_CASE', sourceType, sourceId,
          reason: reason.trim(), idempotencyKey: attempt.key, correlationId: crypto.randomUUID() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(response.status === 409 ? 'The source record changed. Refresh this page before opening a case.' : caseActionFailure(response.status))
        return
      }
      const saved = sourceCaseResult(payload)
      if (!saved) {
        setError('The response did not confirm a case. Your reason is preserved; retry unchanged to recover the same result.')
        return
      }
      command.complete(fingerprint)
      setResult(saved)
    } catch {
      setError('The connection was interrupted. Your reason is preserved; retry unchanged to recover the same result.')
    } finally { setPending(false) }
  }

  return <div className="ops-action-block">
    {result ? <div role="status"><p>{result.existing ? 'A case already exists for this record.' : 'Review case created. The source record is unchanged.'}</p>
      <Link className="ops-button ops-button-primary" href={`/ops/cases/${result.caseNumber}?returnTo=${encodeURIComponent(returnTo)}`}>Open {result.caseNumber}</Link>
      {result.receiptId ? <p className="ops-muted">Receipt {result.receiptId}</p> : null}</div>
      : <><p>Open a review case for this {sourceType === 'order' ? 'disputed order' : 'failed job'}. This does not move money, change the order, or retry a job.</p>
        <label className="ops-field">Why does this need review?<textarea value={reason} maxLength={1000} disabled={pending} onChange={(event) => setReason(event.target.value)} /></label>
        <p className="ops-muted">Enter at least 12 characters. If a case already exists, we’ll link to it.</p>
        {error ? <p role="alert">{error}</p> : null}
        <button className="ops-button ops-button-primary" type="button" disabled={pending || reason.trim().length < 12} onClick={createCase}>{pending ? 'Opening review…' : 'Open review case'}</button></>}
  </div>
}
