'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EXPLORE_SECTION_CONTROL_LABEL, placementLabel, type MarketplaceCategory } from '@drape/shared'

export function MarketplaceCategoryControl({ profileId, current, supportsCustomOrders }: { profileId: string; current: MarketplaceCategory; supportsCustomOrders: boolean }) {
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
  return <section className="ops-panel ops-section-block"><div className="ops-panel-head"><h2>{EXPLORE_SECTION_CONTROL_LABEL}</h2></div><div className="ops-panel-body">
    <p>Currently listed in: <strong>{placementLabel(current)}</strong></p>
    <label className="ops-field"><span>{EXPLORE_SECTION_CONTROL_LABEL}</span><select value={category} onChange={(event) => { setCategory(event.target.value as MarketplaceCategory); setConfirming(false) }}><option value="TAILORING" disabled={!supportsCustomOrders}>{placementLabel('TAILORING')}</option><option value="READY_TO_WEAR">{placementLabel('READY_TO_WEAR')}</option></select></label>
    {!supportsCustomOrders ? <p className="ops-muted">Tailors is unavailable while custom orders are off.</p> : null}
    <label className="ops-field"><span>Required reason</span><textarea value={reason} minLength={12} maxLength={500} onChange={(event) => { setReason(event.target.value); setConfirming(false) }} /></label>
    {!confirming ? <><button className="ops-button" disabled={category === current || (category === 'TAILORING' && !supportsCustomOrders) || reason.trim().length < 12} onClick={() => setConfirming(true)}>Review decision</button>{category === current ? <p className="ops-muted">Choose a different section to move this seller.</p> : reason.trim().length < 12 ? <p className="ops-muted">Add a reason of at least 12 characters.</p> : null}</> : <div><p>Confirm moving this profile to <strong>{placementLabel(category as MarketplaceCategory)}</strong>.</p><button className="ops-button" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Confirm change'}</button> <button className="ops-button" onClick={() => setConfirming(false)}>Cancel</button></div>}
    {message ? <p role="status">{message}</p> : null}
  </div></section>
}
