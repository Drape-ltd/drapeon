'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function MarketplaceCategoryControl({ profileId, current }: { profileId: string; current: string }) {
  const router = useRouter(); const [category, setCategory] = useState(current); const [reason, setReason] = useState(''); const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('')
  async function submit() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/actions/marketplace-category', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId, category, reason, idempotencyKey: crypto.randomUUID() }) })
      const payload = await response.json().catch(() => ({})) as { error?: string; code?: string }
      if (!response.ok) { setMessage(payload.code === 'PLACEMENT_REQUIRES_CUSTOM_ORDERS' ? `Not eligible for Tailors: ${payload.error ?? 'custom orders are off.'}` : payload.error ?? 'The decision could not be saved.'); return }
      setConfirming(false); setReason(''); setMessage('Explore placement updated.'); router.refresh()
    } catch {
      setMessage('The response was interrupted. Reload to confirm the current placement before retrying.')
    } finally {
      setBusy(false)
    }
  }
  return <section className="ops-panel ops-section-block"><div className="ops-panel-head"><h2>Explore placement</h2></div><div className="ops-panel-body">
    <p>Currently listed in: <strong>{current === 'READY_TO_WEAR' ? 'Ready-to-wear' : 'Tailors'}</strong></p>
    <label className="ops-field"><span>Placement</span><select value={category} onChange={(event) => { setCategory(event.target.value); setConfirming(false) }}><option value="TAILORING">Tailors</option><option value="READY_TO_WEAR">Ready-to-wear</option></select></label>
    <label className="ops-field"><span>Required reason</span><textarea value={reason} minLength={12} maxLength={500} onChange={(event) => { setReason(event.target.value); setConfirming(false) }} /></label>
    {!confirming ? <><button className="ops-button" disabled={category === current || reason.trim().length < 12} onClick={() => setConfirming(true)}>Review decision</button>{category === current ? <p className="ops-muted">Choose a different placement to move this seller.</p> : reason.trim().length < 12 ? <p className="ops-muted">Add a reason of at least 12 characters.</p> : null}</> : <div><p>Confirm moving this profile to <strong>{category === 'READY_TO_WEAR' ? 'Ready-to-wear' : 'Tailors'}</strong>.</p><button className="ops-button" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Confirm change'}</button> <button className="ops-button" onClick={() => setConfirming(false)}>Cancel</button></div>}
    {message ? <p role="status">{message}</p> : null}
  </div></section>
}
