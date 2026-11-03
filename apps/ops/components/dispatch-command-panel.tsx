'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Result = { ok?: boolean; error?: string; message?: string; correlationId?: string }

export function DispatchCommandPanel({ orderId, runStatus }: { orderId: string; runStatus: string | null }) {
  const router = useRouter()
  const [mode, setMode] = useState<'QUOTE' | 'EVENT'>(runStatus === 'QUOTE_REQUIRED' ? 'QUOTE' : 'EVENT')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Result | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true); setFeedback(null)
    const form = new FormData(event.currentTarget)
    form.set('action', mode); form.set('orderId', orderId)
    try {
      const response = await fetch('/api/actions/delivery', { method: 'POST', body: form, headers: { 'x-correlation-id': crypto.randomUUID() } })
      const result = await response.json() as Result
      setFeedback(result)
      if (response.ok) router.refresh()
    } catch { setFeedback({ ok: false, error: 'NETWORK_ERROR', message: 'The dispatch command was interrupted. Check the order before retrying.' }) }
    finally { setPending(false) }
  }
  return <section className="ops-panel" data-testid="dispatch-command-panel">
    <div className="ops-panel-head"><div><h2>Dispatch command</h2><p className="ops-muted">Current run: {runStatus ? runStatus.replaceAll('_', ' ').toLowerCase() : 'not initialized'}</p></div><div className="ops-button-row"><button type="button" className="ops-button" aria-pressed={mode === 'QUOTE'} onClick={() => setMode('QUOTE')}>Provider quote</button><button type="button" className="ops-button" aria-pressed={mode === 'EVENT'} onClick={() => setMode('EVENT')}>Custody update</button></div></div>
    <form className="ops-panel-body ops-form-stack" onSubmit={submit}>
      {mode === 'QUOTE' ? <>
        <label>Provider<input name="providerName" required maxLength={120} /></label>
        <label>Provider quote reference<input name="providerQuoteReference" maxLength={180} /></label>
        <label>Actual provider cost<input name="actualProviderCost" required inputMode="decimal" placeholder="15.00" /></label>
        <label>Tax<input name="shortfallTax" inputMode="decimal" placeholder="0.00" /></label>
        <label>Fee<input name="shortfallFee" inputMode="decimal" placeholder="0.00" /></label>
      </> : <>
        <label>Event<select name="eventType" required defaultValue="CARRIER_ACCEPTED"><option value="CARRIER_ACCEPTED">Carrier accepted custody</option><option value="COLLECTED">Collected</option><option value="IN_TRANSIT">In transit</option><option value="OUT_FOR_DELIVERY">Out for delivery</option><option value="DELIVERED">Delivered</option><option value="EXCEPTION">Exception</option></select></label>
        <label>Provider<input name="providerName" maxLength={120} /></label>
        <label>Service level<input name="serviceLevel" maxLength={80} /></label>
        <label>Provider reference<input name="providerReference" maxLength={180} /></label>
        <label>Tracking number<input name="trackingNumber" maxLength={180} /></label>
        <label>Tracking URL<input name="trackingUrl" type="url" maxLength={500} /></label>
      </>}
      <label>Operator note<textarea name="internalNote" maxLength={2000} /></label>
      <label>Customer note<textarea name="customerNote" maxLength={2000} /></label>
      <label>Private photo proof<input name="evidence" type="file" accept="image/jpeg,image/png,image/webp" required={mode === 'QUOTE'} /></label>
      {feedback ? <p role="status" className={feedback.ok ? 'ops-status-banner' : 'ops-status-banner'} data-tone={feedback.ok ? 'success' : 'critical'}>{feedback.ok ? 'Dispatch command recorded.' : feedback.message ?? 'The dispatch command could not be recorded.'}{feedback.correlationId ? ` Reference: ${feedback.correlationId}` : ''}</p> : null}
      <button className="ops-button" type="submit" disabled={pending}>{pending ? 'Saving…' : mode === 'QUOTE' ? 'Record provider quote' : 'Record custody update'}</button>
    </form>
  </section>
}
