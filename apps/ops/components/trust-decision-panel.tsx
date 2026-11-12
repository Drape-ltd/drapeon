'use client'

import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldCheck, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'
import { validProtectedActionSuccess } from '../lib/protected-action-response'
import type { TrustPlacementContext } from '../lib/domain-data'

type Placement = 'TAILORING' | 'READY_TO_WEAR'
const PLACEMENT_LABEL: Record<Placement, string> = { TAILORING: 'Tailors', READY_TO_WEAR: 'Ready-to-wear' }
const SELLER_TYPE_LABEL: Record<string, string> = { TAILOR: 'Tailor', BOUTIQUE: 'Boutique', TAILOR_SHOP: 'Tailor shop' }

type ReceiptState = {
  tone: 'healthy' | 'warning' | 'critical'
  title: string
  detail: string
  correlationId?: string
}

export function TrustDecisionPanel({
  issueId,
  profileId,
  tailorUserId,
  recordVersion,
  evidenceReady,
  protectedAccess,
  protectedCheckpoint,
  placement = null,
}: {
  issueId: string
  profileId: string
  tailorUserId: string
  recordVersion: number | null
  evidenceReady: boolean
  protectedAccess: boolean
  protectedCheckpoint: string
  /** Present only when the database supports placement at approval. */
  placement?: TrustPlacementContext | null
}) {
  const router = useRouter()
  const [evidenceReviewed, setEvidenceReviewed] = useState(false)
  const [decisionNote, setDecisionNote] = useState('')
  const [rejectionCode, setRejectionCode] = useState('')
  const [chosenPlacement, setChosenPlacement] = useState<Placement | null>(null)
  const placementRequired = placement !== null
  const tailorsEligible = placement?.supportsCustomOrders !== false
  const placementReady = !placementRequired || chosenPlacement !== null
  const [pending, setPending] = useState<'APPROVE' | 'REJECT' | null>(null)
  const [receipt, setReceipt] = useState<ReceiptState | null>(null)
  const command = useIdempotentCommand('ops-trust-decision')
  const rejectionReasonValid = decisionNote.trim().length >= 8
  const canDecide = evidenceReady && evidenceReviewed && recordVersion !== null && protectedAccess && pending === null

  async function decide(decision: 'APPROVE' | 'REJECT') {
    if (!canDecide || (decision === 'REJECT' && !rejectionReasonValid) || (decision === 'APPROVE' && !placementReady)) return
    const reason = decisionNote.trim()
    const rejection = decision === 'REJECT' ? rejectionCode : ''
    const placementChoice = decision === 'APPROVE' && placementRequired ? chosenPlacement : null
    const fingerprint = idempotencyFingerprint([issueId, profileId, tailorUserId, decision, reason, rejection, placementChoice, recordVersion])
    const attempt = command.begin(fingerprint)
    setPending(decision)
    setReceipt(null)
    try {
      const response = await fetch('/api/actions/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId,
          profileId,
          tailorUserId,
          decision,
          reason,
          rejectionCode: rejection,
          ...(placementChoice ? { placement: placementChoice } : {}),
          expectedRecordVersion: recordVersion,
          idempotencyKey: attempt.key,
          correlationId: crypto.randomUUID(),
        }),
      })
      const result = await response.json().catch(() => ({})) as Record<string, unknown>
      const correlationId = typeof result.correlationId === 'string' ? result.correlationId : undefined
      if (!response.ok && response.status !== 207) {
        const placementBlocked = typeof result.error === 'string' && /custom orders|placement|Tailors or Ready-to-wear/i.test(result.error)
        setReceipt({
          tone: response.status === 409 ? 'warning' : 'critical',
          title: placementBlocked ? 'Placement not accepted' : response.status === 409 ? 'Case changed' : 'Decision not completed',
          detail: placementBlocked
            ? String(result.error)
            : response.status === 409
            ? 'Reload the authoritative case and review the newer evidence before deciding.'
            : String(result.error ?? 'The protected trust decision failed safely.'),
          correlationId,
        })
        return
      }
      if (!validProtectedActionSuccess(result)) {
        setReceipt({ tone: 'warning', title: 'Decision outcome unverified',
          detail: 'The response did not contain a successful durable receipt. Reread the case and receipt before retrying this decision.', correlationId })
        return
      }
      command.complete(fingerprint)
      setReceipt({
        tone: response.status === 207 ? 'warning' : 'healthy',
        title: response.status === 207 ? 'Decision saved; notification follow-up needed' : 'Trust decision recorded',
        detail: typeof result.warning === 'string'
          ? result.warning
          : 'The authoritative trust state and durable receipt are persisted. Refreshing the case now.',
        correlationId,
      })
      router.refresh()
    } catch {
      setReceipt({ tone: 'warning', title: 'Response interrupted', detail: 'Your reviewed decision is preserved. Retry unchanged to recover the same trust receipt.' })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="ops-action-block ops-trust-decision">
      <p className="ops-action-label">Protected decision</p>
      <h3>Complete trust review</h3>
      <p>Trust approval controls marketplace visibility. Payout-provider verification remains a separate gate.</p>
      {receipt ? (
        <div className="ops-status-banner" data-tone={receipt.tone} role={receipt.tone === 'critical' ? 'alert' : 'status'}>
          {receipt.tone === 'healthy' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span><strong>{receipt.title}</strong><br />{receipt.detail}{receipt.correlationId ? <><br /><small>Correlation {receipt.correlationId}</small></> : null}</span>
        </div>
      ) : null}
      {!evidenceReady ? <div className="ops-status-banner" data-tone="warning"><AlertTriangle size={16} />Private challenge evidence is missing. A decision is unavailable.</div> : null}
      {recordVersion === null ? <div className="ops-status-banner" data-tone="warning"><AlertTriangle size={16} />Canonical record version is missing. Repair the case projection before deciding.</div> : null}
      <label className="ops-check-row">
        <input type="checkbox" checked={evidenceReviewed} onChange={(event) => setEvidenceReviewed(event.target.checked)} />
        <span>I reviewed the profile, portfolio, and private randomized challenge video for this case.</span>
      </label>
      <label className="ops-field">Decision note
        <textarea value={decisionNote} maxLength={1000} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Record the evidence-based rationale. Required for rejection." />
      </label>
      {placement ? (
        <fieldset className="ops-field ops-placement-choice">
          <legend>Explore placement <span className="ops-muted">(required to approve)</span></legend>
          <p className="ops-muted" style={{ margin: '0 0 6px' }}>
            Seller says they are a {SELLER_TYPE_LABEL[placement.sellerType ?? ''] ?? 'seller'}{placement.supportsCustomOrders ? ' and accepts custom orders' : ' and does not accept custom orders'}. You decide where they appear.
          </p>
          {(['TAILORING', 'READY_TO_WEAR'] as const).map((value) => {
            const disabled = value === 'TAILORING' && !tailorsEligible
            return (
              <label key={value} className="ops-check-row" aria-disabled={disabled}>
                <input type="radio" name={`placement-${profileId}`} value={value} checked={chosenPlacement === value} disabled={disabled || pending !== null} onChange={() => setChosenPlacement(value)} />
                <span>
                  <strong>{PLACEMENT_LABEL[value]}</strong>
                  {value === 'TAILORING' ? ' — made-to-measure and custom orders' : ' — finished pieces customers buy as they are'}
                  {disabled ? <><br /><small>Not eligible: Tailors requires custom orders, and this shop has them turned off.</small></> : null}
                </span>
              </label>
            )
          })}
        </fieldset>
      ) : null}
      <label className="ops-field">Rejection category
        <select value={rejectionCode} onChange={(event) => setRejectionCode(event.target.value)}>
          <option value="">General evidence or policy issue</option>
          <option value="INVALID_PROFILE_IMAGE">Profile image does not meet requirements</option>
          <option value="INVALID_PORTFOLIO_MEDIA">Portfolio media needs replacement</option>
          <option value="NEEDS_LIVE_SELFIE_RETAKE">Private challenge video needs a retake</option>
          <option value="BUSINESS_IDENTITY_MISMATCH">Business identity does not match</option>
          <option value="LOCATION_MISMATCH">Business location does not match</option>
          <option value="OFF_PLATFORM_CONTACT">Off-platform contact details found</option>
          <option value="GENERAL_TRUST_REVIEW">Other trust-review correction</option>
        </select>
      </label>
      {!protectedAccess ? <a className="ops-button" href={protectedCheckpoint}><ShieldCheck size={15} />Verify protected access first</a> : (
        <div className="ops-decision-row">
          <button className="ops-button ops-button-primary" type="button" disabled={!canDecide || !placementReady} onClick={() => decide('APPROVE')}>
            {pending === 'APPROVE' ? <LoaderCircle className="ops-spin" size={15} /> : <CheckCircle2 size={15} />}
            {placementRequired && chosenPlacement ? `Approve into ${PLACEMENT_LABEL[chosenPlacement]}` : 'Approve trust'}
          </button>
          <button className="ops-button ops-button-danger" type="button" disabled={!canDecide || !rejectionReasonValid} onClick={() => decide('REJECT')}>
            {pending === 'REJECT' ? <LoaderCircle className="ops-spin" size={15} /> : <XCircle size={15} />}Reject with reason
          </button>
        </div>
      )}
      {protectedAccess && placementRequired && !chosenPlacement ? <p className="ops-muted" style={{ margin: 0, fontSize: 12 }}>Choose an Explore placement to enable approval.</p> : null}
      <p className="ops-muted" style={{ margin: 0, fontSize: 11 }}>The server rereads the case and profile, rejects stale versions, records a receipt, and preserves communication outcomes.</p>
    </div>
  )
}
