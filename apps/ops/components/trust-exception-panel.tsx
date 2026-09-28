'use client'
import { useEffect, useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'

type ExceptionCase = { id: string; caseNumber: string; recordVersion: number; status: string; metadata: Record<string, unknown> }
export function TrustExceptionPanel({ profileId, protectedAccess, checkpoint }: { profileId: string; protectedAccess: boolean; checkpoint: string }) {
  const [record,setRecord] = useState<ExceptionCase | null>(null)
  const [loaded,setLoaded] = useState(false)
  const [reason,setReason] = useState('')
  const [reference,setReference] = useState('')
  const [reviewed,setReviewed] = useState(false)
  const [acknowledged,setAcknowledged] = useState(false)
  const [pending,setPending] = useState(false)
  const [message,setMessage] = useState('')
  const command = useIdempotentCommand('ops-trust-exception')
  useEffect(() => {
    if (!protectedAccess) return
    let cancelled = false
    fetch('/api/actions/trust-exception',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'READ',profileId})})
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'Exception state unavailable.')
        if (cancelled) return
        setRecord(data.case ?? null)
        setReason(String(data.case?.metadata?.reason ?? ''))
        setReference(String(data.case?.metadata?.evidenceReference ?? ''))
        setLoaded(true)
      }).catch(error => { if (!cancelled) setMessage(String(error.message)) })
    return () => { cancelled = true }
  },[profileId,protectedAccess])
  const terminal = record?.status === 'RESOLVED' || record?.status === 'CLOSED'
  const valid = reason.trim().length >= 20 && reference.trim().length >= 8 && loaded && !pending
  async function submit(action: 'REQUEST' | 'APPROVE' | 'REJECT') {
    if (!valid || terminal || (action !== 'REQUEST' && (!reviewed || !acknowledged || !record))) return
    const fingerprint = idempotencyFingerprint([profileId,record?.id,record?.recordVersion,action,reason.trim(),reference.trim()])
    const attempt = command.begin(fingerprint)
    setPending(true)
    try {
      const response = await fetch('/api/actions/trust-exception',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        profileId,action,reason:reason.trim(),evidenceReference:reference.trim(),issueId:record?.id,
        expectedRecordVersion:record?.recordVersion,idempotencyKey:attempt.key,
        publicEvidenceReviewed:reviewed,videoWaiverAcknowledged:acknowledged,
      })})
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Decision not completed.')
      command.complete(fingerprint)
      setRecord(data.case)
      setMessage(`Persisted receipt ${data.receiptId ?? 'recovered'} · ${data.case.caseNumber}. No email or push delivery is claimed.`)
    } catch(error) { setMessage(error instanceof Error ? error.message : 'Response interrupted. Retry unchanged to recover the same receipt.') }
    finally { setPending(false) }
  }
  return <section className="ops-panel"><div className="ops-panel-head"><h2>Administrator video exception</h2></div><div className="ops-panel-body ops-trust-stack">
    <p>This explicitly waives the missing video; it does not certify that one was reviewed. Payout eligibility and existing media-safety cases remain independent.</p>
    {message ? <p role="status">{message}</p> : null}
    {!protectedAccess ? <a className="ops-button" href={checkpoint}>Verify protected access</a> : !loaded ? <p>Exception state unavailable or loading. No decision is enabled.</p> : null}
    {record ? <p><a href={`/ops/cases/${encodeURIComponent(record.caseNumber)}`}>{record.caseNumber}</a> · {terminal ? (record.metadata.decision === 'APPROVE' ? 'Waiver approved' : record.metadata.decision === 'REJECT' ? 'Waiver rejected' : 'Waiver decided') : 'Awaiting administrator decision'}</p> : null}
    {protectedAccess && loaded && !terminal ? <>
      <label className="ops-field">Reason for this recruitment exception<textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} /></label>
      <label className="ops-field">Recruitment evidence or approval reference<input maxLength={500} value={reference} onChange={e=>setReference(e.target.value)} /></label>
      {record ? <>
        <label className="ops-check-row"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} />I reviewed this profile and its public portfolio evidence.</label>
        <label className="ops-check-row"><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} />No challenge video was reviewed. I explicitly accept or reject the requested waiver.</label>
        <div className="ops-decision-row"><button className="ops-button ops-button-primary" disabled={!valid || !reviewed || !acknowledged} onClick={()=>submit('APPROVE')}>Approve waiver and activate storefront</button><button className="ops-button ops-button-danger" disabled={!valid || !reviewed || !acknowledged} onClick={()=>submit('REJECT')}>Reject waiver; keep storefront hidden</button></div>
      </> : <button className="ops-button" disabled={!valid} onClick={()=>submit('REQUEST')}>Record exception request</button>}
      <p className="ops-muted">A reason of at least 20 characters and an evidence reference of at least 8 characters are required. The server rejects stale cases and preserves replay receipts.</p>
    </> : terminal ? <p>The persisted decision is terminal. Reloading does not reopen the action.</p> : null}
  </div></section>
}
