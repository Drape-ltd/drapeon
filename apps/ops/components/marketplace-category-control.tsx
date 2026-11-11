'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function MarketplaceCategoryControl({ profileId, current }: { profileId: string; current: string }) {
  const router = useRouter(); const [category, setCategory] = useState(current); const [reason, setReason] = useState(''); const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('')
  async function submit() {
    setBusy(true); setMessage('')
    const response = await fetch('/api/actions/marketplace-category', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId, category, reason, idempotencyKey: crypto.randomUUID() }) })
    const payload = await response.json().catch(() => ({})) as { error?: string }; setBusy(false)
    if (!response.ok) { setMessage(payload.error ?? 'The decision could not be saved.'); return }
    setConfirming(false); setReason(''); setMessage('Marketplace section updated.'); router.refresh()
  }
  return <section className="ops-panel ops-section-block"><div className="ops-panel-head"><h2>Marketplace section</h2></div><div className="ops-panel-body">
    <p>Currently listed in: <strong>{current === 'READY_TO_WEAR' ? 'Ready-to-wear' : 'Tailors'}</strong></p>
    <label className="ops-field"><span>Section</span><select value={category} onChange={(event) => { setCategory(event.target.value); setConfirming(false) }}><option value="TAILORING">Tailors</option><option value="READY_TO_WEAR">Ready-to-wear</option></select></label>
    <label className="ops-field"><span>Required reason</span><textarea value={reason} minLength={12} maxLength={500} onChange={(event) => { setReason(event.target.value); setConfirming(false) }} /></label>
    {!confirming ? <button className="ops-button" disabled={category === current || reason.trim().length < 12} onClick={() => setConfirming(true)}>Review decision</button> : <div><p>Confirm moving this profile to <strong>{category === 'READY_TO_WEAR' ? 'Ready-to-wear' : 'Tailors'}</strong>.</p><button className="ops-button" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Confirm change'}</button> <button className="ops-button" onClick={() => setConfirming(false)}>Cancel</button></div>}
    {message ? <p role="status">{message}</p> : null}
  </div></section>
}
