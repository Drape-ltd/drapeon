'use client'
import { useEffect, useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'

type ExceptionCase = { id: string; caseNumber: string; recordVersion: number; status: string; snapshotStale?: boolean; metadata: Record<string, unknown> }
type ProfileRequirements = { name: boolean; phone: boolean; avatar: boolean; specialties: boolean; portfolio: boolean }
type ActionResponse = { ok?: unknown; error?: unknown; code?: unknown; correlationId?: unknown; case?: ExceptionCase | null; receiptId?: unknown; profileRequirements?: ProfileRequirements | null }
const WAIVER_REQUEST_TIMEOUT_MS = 20_000
function isInterruptedRequest(error: unknown) {
  return error instanceof Error && ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)
}
function responseMessage(data: ActionResponse, fallback: string) {
  const message = typeof data.error === 'string' ? data.error : fallback
  const code = typeof data.code === 'string' ? ` (${data.code})` : ''
  const reference = typeof data.correlationId === 'string' ? ` Reference: ${data.correlationId}.` : ''
  return `${message}${code}${reference}`
}
export function TrustExceptionPanel({ profileId, protectedAccess, checkpoint }: { profileId: string; protectedAccess: boolean; checkpoint: string }) {
  const [record,setRecord] = useState<ExceptionCase | null>(null)
  const [profileRequirements,setProfileRequirements] = useState<ProfileRequirements | null>(null)
  const [loaded,setLoaded] = useState(false)
  const [loading,setLoading] = useState(protectedAccess)
  const [reason,setReason] = useState('')
  const [reference,setReference] = useState('')
  const [reviewed,setReviewed] = useState(false)
  const [acknowledged,setAcknowledged] = useState(false)
  const [pending,setPending] = useState(false)
  const [needsReread,setNeedsReread] = useState(false)
  const [message,setMessage] = useState('')
  const [reloadCount,setReloadCount] = useState(0)
  const command = useIdempotentCommand('ops-trust-exception')
  useEffect(() => {
    if (!protectedAccess) return
    let cancelled = false
    fetch('/api/actions/trust-exception',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'READ',profileId}),signal:AbortSignal.timeout(WAIVER_REQUEST_TIMEOUT_MS)})
      .then(async response => {
        const data = await response.json().catch(() => null) as ActionResponse | null
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Waiver state response was invalid. Retry the current case before deciding.')
        if (!response.ok) throw new Error(responseMessage(data, 'Exception state unavailable.'))
        if (data.ok !== true) throw new Error('Waiver state response was incomplete. Retry the current case before deciding.')
        if (cancelled) return
        setRecord(data.case ?? null)
        setProfileRequirements(data.profileRequirements ?? null)
        setReason(String(data.case?.metadata?.reason ?? ''))
        setReference(String(data.case?.metadata?.evidenceReference ?? ''))
        setReviewed(false)
        setAcknowledged(false)
        setMessage('')
        setNeedsReread(false)
        setLoaded(true)
      }).catch(error => { if (!cancelled) setMessage(isInterruptedRequest(error) ? 'Waiver state could not be read in time. Retry the current case before deciding.' : String(error instanceof Error ? error.message : 'Exception state unavailable.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  },[profileId,protectedAccess,reloadCount])
  const terminal = record?.status === 'RESOLVED' || record?.status === 'CLOSED'
  const valid = reason.trim().length >= 20 && reference.trim().length >= 8 && loaded && !pending && !needsReread
  const profileReady = profileRequirements !== null && Object.values(profileRequirements).every(Boolean)
  async function submit(action: 'REQUEST' | 'APPROVE' | 'REJECT' | 'REFRESH') {
    if (!valid || terminal || (action !== 'REQUEST' && (!reviewed || !acknowledged || !record)) || (action === 'APPROVE' && (!profileReady || record?.snapshotStale === true))) return
    const fingerprint = idempotencyFingerprint([profileId,record?.id,record?.recordVersion,action,reason.trim(),reference.trim()])
    const attempt = command.begin(fingerprint)
    setPending(true)
    try {
      const response = await fetch('/api/actions/trust-exception',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        profileId,action,reason:reason.trim(),evidenceReference:reference.trim(),issueId:record?.id,
        expectedRecordVersion:record?.recordVersion,idempotencyKey:attempt.key,
        publicEvidenceReviewed:reviewed,videoWaiverAcknowledged:acknowledged,
      }),signal:AbortSignal.timeout(WAIVER_REQUEST_TIMEOUT_MS)})
      const data = await response.json().catch(() => null) as ActionResponse | null
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        setNeedsReread(true)
        throw new Error('Decision response was invalid. Reload the current case before retrying the same action.')
      }
      setProfileRequirements(data.profileRequirements ?? null)
      if (!response.ok) {
        if (response.status >= 500) setNeedsReread(true)
        throw new Error(responseMessage(data, 'Decision not completed.'))
      }
      if (data.ok !== true || !data.case?.id) {
        setNeedsReread(true)
        throw new Error('Decision response was incomplete. Reload the current case before retrying the same action.')
      }
      command.complete(fingerprint)
      if (data.case) setRecord(data.case)
      if (action === 'REFRESH') { setReviewed(false); setAcknowledged(false) }
      setMessage(action === 'REFRESH'
        ? 'Evidence snapshot refreshed. Storefront unchanged. Review the current evidence and tick both acknowledgements again before approving.'
        : `Persisted receipt ${data.receiptId ?? 'recovered'} · ${data.case?.caseNumber ?? 'case status unavailable'}. No email or push delivery is claimed.`)
    } catch(error) {
      if (isInterruptedRequest(error)) setNeedsReread(true)
      setMessage(isInterruptedRequest(error)
        ? 'Response interrupted. Reload the current case before retrying the same action with unchanged inputs.'
        : error instanceof Error ? error.message : 'Response interrupted. Reload the current case before retrying the same action with unchanged inputs.')
    }
    finally { setPending(false) }
  }
  function reloadCase() {
    setLoaded(false)
    setLoading(true)
    setMessage('')
    setReloadCount(value => value + 1)
  }
  return <section className="ops-panel"><div className="ops-panel-head"><h2>Administrator video exception</h2></div><div className="ops-panel-body ops-trust-stack">
    <p>This explicitly waives the missing video; it does not certify that one was reviewed. Payout eligibility and existing media-safety cases remain independent.</p>
    {message ? <p role="status">{message}</p> : null}
    {!protectedAccess ? <a className="ops-button" href={checkpoint}>Verify protected access</a> : !loaded ? <><p role="status">{loading ? 'Loading the current waiver state… No decision is enabled yet.' : 'The waiver state could not be loaded. No decision is enabled.'}</p>{!loading ? <button className="ops-button" type="button" onClick={reloadCase}>Retry waiver state</button> : null}</> : null}
    {record && loaded ? <p><a href={`/ops/cases/${encodeURIComponent(record.caseNumber)}`}>{record.caseNumber}</a> · {terminal ? (record.metadata.decision === 'APPROVE' ? 'Waiver approved' : record.metadata.decision === 'REJECT' ? 'Waiver rejected' : 'Waiver decided') : 'Awaiting administrator decision'}</p> : null}
    {protectedAccess && loaded && !terminal ? <>
      {record ? <button className="ops-button" type="button" disabled={pending} onClick={reloadCase}>Reload current case and profile state</button> : null}
      <label className="ops-field">Reason for this recruitment exception<textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} /></label>
      <label className="ops-field">Recruitment evidence or approval reference<input maxLength={500} value={reference} onChange={e=>setReference(e.target.value)} /></label>
      {record ? <>
        {record.snapshotStale ? <p role="alert">This profile changed after the waiver request. Review the current photos, then refresh the evidence snapshot. Refreshing does not approve the waiver.</p> : null}
        <div aria-live="polite">
          <h3>Profile requirements for approval</h3>
          {profileRequirements ? <>
            <ul>{([['name','Tailor name'],['phone','Account phone number'],['avatar','Profile photo'],['specialties','At least one specialty'],['portfolio','At least one portfolio item']] as const).map(([key,label]) => <li key={key}>{profileRequirements[key] ? '✓' : 'Missing'} {label}</li>)}</ul>
            {!profileRequirements.phone ? <p role="alert">Ask the tailor to save their real phone number in account settings, then reload this case before approving.</p> : null}
            <p className="ops-muted">This confirms an account phone number is present. It does not verify phone ownership.</p>
          </> : <p role="alert">Could not verify required profile details. Reload before deciding; approval stays disabled.</p>}
        </div>
        <label className="ops-check-row"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} />I reviewed this profile and its public portfolio evidence.</label>
        <label className="ops-check-row"><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} />No challenge video was reviewed. I explicitly accept or reject the requested waiver.</label>
        {record.snapshotStale ? <button className="ops-button" disabled={!valid || !reviewed || !acknowledged} onClick={()=>submit('REFRESH')}>Refresh reviewed evidence snapshot</button> : null}
        <div className="ops-decision-row"><button className="ops-button ops-button-primary" disabled={!valid || !reviewed || !acknowledged || !profileReady || record.snapshotStale === true} onClick={()=>submit('APPROVE')}>Approve waiver and activate storefront</button><button className="ops-button ops-button-danger" disabled={!valid || !reviewed || !acknowledged} onClick={()=>submit('REJECT')}>Reject waiver; keep storefront hidden</button></div>
      </> : <button className="ops-button" disabled={!valid} onClick={()=>submit('REQUEST')}>Record exception request</button>}
      <p className="ops-muted">A reason of at least 20 characters and an evidence reference of at least 8 characters are required. The server rejects stale cases and preserves replay receipts.</p>
    </> : terminal ? <p>The persisted decision is terminal. Reloading does not reopen the action.</p> : null}
  </div></section>
}
