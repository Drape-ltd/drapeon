import { draftPriceMajor, formatDraftDate, type Draft, type Profile } from './model'

export function DraftSummary({ profile }: { profile: Profile | null | undefined }) {
  return (
    <dl className="ops-summary-grid">
      <div>
        <dt>Name</dt>
        <dd>{profile?.display_name}</dd>
      </div>
      <div>
        <dt>Location</dt>
        <dd>{profile?.location}</dd>
      </div>
      <div>
        <dt>Languages</dt>
        <dd>{profile?.languages?.join(' · ')}</dd>
      </div>
      <div>
        <dt>Specialties</dt>
        <dd>{profile?.specialty_tags?.join(' · ')}</dd>
      </div>
      <div>
        <dt>Price</dt>
        <dd>
          {profile?.currency} {draftPriceMajor(profile?.price_range_min)}–
          {draftPriceMajor(profile?.price_range_max)}
        </dd>
      </div>
      <div className="ops-summary-wide">
        <dt>Bio</dt>
        <dd>{profile?.bio}</dd>
      </div>
    </dl>
  )
}

export function DraftApproval({ draft }: { draft: Draft }) {
  return (
    <dl className="ops-summary-grid">
      <div>
        <dt>Approved by</dt>
        <dd>{draft.approved_by_label ?? 'Not yet approved'}</dd>
      </div>
      <div>
        <dt>Approved</dt>
        <dd>{formatDraftDate(draft.approved_at)}</dd>
      </div>
      <div>
        <dt>Placement</dt>
        <dd>{draft.marketplace_placement === 'READY_TO_WEAR' ? 'Ready to wear' : 'Tailoring'}</dd>
      </div>
      <div>
        <dt>Evidence</dt>
        <dd>{draft.evidence_ref}</dd>
      </div>
      <div className="ops-summary-wide">
        <dt>Reason</dt>
        <dd>{draft.approval_reason}</dd>
      </div>
    </dl>
  )
}

export function SharePanel({
  link,
  draft,
  profile,
  copied,
  onCopy,
}: {
  link: string
  draft: Draft
  profile: Profile | null | undefined
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="ops-share-card">
      <strong>Copy now — shown once</strong>
      <p className="break-all">{link}</p>
      <p>Expires {formatDraftDate(draft.expires_at)}</p>
      <div className="ops-button-row">
        <button className="ops-button ops-button-primary" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy private link'}
        </button>
        <a className="ops-button" href={link} target="_blank" rel="noreferrer">
          Open exact preview
        </a>
      </div>
      <label className="ops-field">
        Ready-to-send Instagram / WhatsApp message
        <textarea
          readOnly
          rows={5}
          value={`Hi ${profile?.display_name}, Drapeon has prepared a private preview of your shop: ${link}\n\nOpen it to review how your work will appear. This private link expires ${formatDraftDate(draft.expires_at)}.`}
        />
      </label>
    </div>
  )
}
