'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  TAILOR_CLAIM_STATUS_PRESENTATION,
  TAILOR_LANGUAGE_GROUPS,
  TAILOR_SPECIALTY_GROUPS,
  tailorClaimStatusPresentation,
} from '@drape/shared'
import {
  type Draft,
  type Media,
  type Profile,
  type UploadChoice,
  claimWebOrigin,
  digestDraftUpload,
  formatDraftDate,
  replayKey,
  sanitizeDraftUpload,
} from './tailor-draft/model'
import { DraftApproval, DraftSummary, SharePanel } from './tailor-draft/presentation'
const languages = TAILOR_LANGUAGE_GROUPS.flatMap((group) => group.items),
  specialties = TAILOR_SPECIALTY_GROUPS.flatMap((group) => group.items)
const statuses = TAILOR_CLAIM_STATUS_PRESENTATION
const status = tailorClaimStatusPresentation
const date = formatDraftDate
function Choices({ name, items, selected }: { name: string; items: string[]; selected: string[] }) {
  return (
    <div className="ops-chip-grid">
      {Array.from(new Set([...items, ...selected])).map((value) => (
        <label className="ops-choice-chip" key={value}>
          <input
            type="checkbox"
            name={name}
            value={value}
            defaultChecked={selected.includes(value)}
          />
          <span>{value}</span>
        </label>
      ))}
    </div>
  )
}

export function TailorDraftBuilder({ initialDrafts }: { initialDrafts: Draft[] }) {
  const [drafts, setDrafts] = useState(initialDrafts),
    [selected, setSelected] = useState(initialDrafts[0]?.id ?? ''),
    [message, setMessage] = useState(''),
    [rawToken, setRawToken] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('ALL'),
    [uploads, setUploads] = useState<UploadChoice[]>([]),
    [reviewed, setReviewed] = useState(false),
    [waiver, setWaiver] = useState(false),
    [reason, setReason] = useState(''),
    [evidence, setEvidence] = useState(''),
    [copied, setCopied] = useState(false),
    [previewMode, setPreviewMode] = useState<'phone' | 'desktop'>('phone')
  const active = useMemo(
      () => drafts.find((item) => item.id === selected) ?? null,
      [drafts, selected]
    ),
    visible = useMemo(
      () =>
        drafts.filter(
          (d) =>
            (filter === 'ALL' || d.status === filter) &&
            (d.tailor_profiles?.display_name ?? '').toLowerCase().includes(query.toLowerCase())
        ),
      [drafts, query, filter]
    )
  async function act(payload: Record<string, unknown>) {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/actions/tailor-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, idempotencyKey: replayKey() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Action failed')
      if (data.token) {
        setRawToken(data.token)
        setCopied(false)
      }
      setMessage(data.correlationId ? `Saved · ${data.correlationId}` : 'Saved')
      return data
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed')
      return null
    } finally {
      setBusy(false)
    }
  }
  async function create(form: FormData) {
    const payload = {
      action: 'CREATE',
      displayName: form.get('displayName'),
      location: form.get('location'),
      bio: form.get('bio'),
      languages: form.getAll('languages'),
      specialties: form.getAll('specialties'),
      currency: form.get('currency'),
      priceMin: Number(form.get('priceMin')),
      priceMax: Number(form.get('priceMax')),
      sourceHandle: form.get('sourceHandle'),
      sourceUrl: form.get('sourceUrl'),
    }
    const data = await act(payload)
    if (!data?.inviteId) return
    const next: Draft = {
      id: data.inviteId,
      status: 'DRAFT',
      created_at: new Date().toISOString(),
      expires_at: null,
      tailor_profile_id: data.profileId,
      tailor_profiles: {
        display_name: String(payload.displayName),
        location: String(payload.location),
        bio: String(payload.bio),
        languages: payload.languages.map(String),
        specialty_tags: payload.specialties.map(String),
        currency: String(payload.currency),
        price_range_min: payload.priceMin,
        price_range_max: payload.priceMax,
        lifecycle_state: 'DRAFT',
      },
    }
    setDrafts((items) => [next, ...items])
    setSelected(next.id)
  }
  async function edit(form: FormData) {
    if (!active) return
    const patch = {
      displayName: form.get('draftDisplayName'),
      businessName: form.get('businessName'),
      bio: form.get('draftBio'),
      location: form.get('draftLocation'),
      languages: form.getAll('draftLanguages'),
      specialties: form.getAll('draftSpecialties'),
      currency: form.get('draftCurrency'),
      priceMin: Number(form.get('draftPriceMin')),
      priceMax: Number(form.get('draftPriceMax')),
    }
    if (await act({ action: 'EDIT', inviteId: active.id, ...patch }))
      setDrafts((items) =>
        items.map((item) =>
          item.id === active.id
            ? {
                ...item,
                tailor_profiles: {
                  ...item.tailor_profiles,
                  display_name: String(patch.displayName),
                  business_name: String(patch.businessName ?? ''),
                  bio: String(patch.bio),
                  location: String(patch.location),
                  languages: patch.languages.map(String),
                  specialty_tags: patch.specialties.map(String),
                  currency: String(patch.currency),
                  price_range_min: patch.priceMin,
                  price_range_max: patch.priceMax,
                },
              }
            : item
        )
      )
  }
  function queue(files: FileList | File[]) {
    setUploads((items) => [
      ...items,
      ...Array.from(files).map(
        (file) =>
          ({
            file,
            kind: file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO',
            key: crypto.randomUUID(),
          }) as UploadChoice
      ),
    ])
  }
  async function uploadAll() {
    if (!active) return
    const firstSortOrder = active.tailor_draft_media?.length ?? 0
    const failed = new Set<string>()
    for (const [uploadIndex, choice] of uploads.entries()) {
      let registered: { assetId?: string; uploadToken?: string; storagePath?: string } | null = null
      try {
        const file = await sanitizeDraftUpload(choice.file)
        registered = await act({
          action: 'REGISTER_MEDIA',
          inviteId: active.id,
          mediaKind: choice.kind,
          contentType: file.type,
          byteSize: file.size,
          sha256: await digestDraftUpload(file),
          sortOrder: firstSortOrder + uploadIndex,
          isCover: false,
        })
        if (!registered?.assetId || !registered.uploadToken || !registered.storagePath)
          throw new Error('Private upload could not be prepared.')
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
          key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!url || !key) throw new Error('Private upload client is unavailable.')
        const uploaded = await createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
          .storage.from('tailor-draft-media')
          .uploadToSignedUrl(registered.storagePath, registered.uploadToken, file, {
            contentType: file.type,
            cacheControl: '0',
          })
        if (uploaded.error) throw uploaded.error
        if (
          !(await act({
            action: 'CONFIRM_MEDIA',
            inviteId: active.id,
            assetId: registered.assetId,
          }))
        )
          throw new Error('Private upload validation failed.')
        const item: Media = {
          id: registered.assetId,
          media_kind: choice.kind,
          content_type: file.type,
          sort_order: firstSortOrder + uploadIndex,
          is_cover: false,
          focal_x: 0.5,
          focal_y: 0.5,
          moderation_status: 'PENDING',
          confirmed_at: new Date().toISOString(),
          preview_url: URL.createObjectURL(file),
        }
        setDrafts((items) =>
          items.map((d) =>
            d.id === active.id
              ? { ...d, tailor_draft_media: [...(d.tailor_draft_media ?? []), item] }
              : d
          )
        )
      } catch (error) {
        if (registered?.assetId) {
          await fetch('/api/actions/tailor-draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'DELETE_MEDIA',
              inviteId: active.id,
              assetId: registered.assetId,
              idempotencyKey: replayKey(),
            }),
          }).catch(() => undefined)
        }
        const detail =
          error instanceof Error
            ? error.message
            : 'This file was rejected. Check its format and try again.'
        failed.add(choice.key)
        setUploads((items) =>
          items.map((item) => (item.key === choice.key ? { ...item, error: detail } : item))
        )
      }
    }
    setUploads((items) => items.filter((item) => failed.has(item.key)))
  }
  async function mediaAction(item: Media, payload: Record<string, unknown>) {
    if (!active) return
    if (await act({ inviteId: active.id, assetId: item.id, ...payload })) {
      if (payload.action === 'DELETE_MEDIA')
        setDrafts((items) =>
          items.map((d) =>
            d.id === active.id
              ? {
                  ...d,
                  tailor_draft_media: (d.tailor_draft_media ?? []).filter((m) => m.id !== item.id),
                }
              : d
          )
        )
      else
        setDrafts((items) =>
          items.map((d) =>
            d.id === active.id
              ? {
                  ...d,
                  tailor_draft_media: (d.tailor_draft_media ?? []).map((m) =>
                    m.id === item.id
                      ? {
                          ...m,
                          sort_order: Number(payload.sortOrder ?? m.sort_order),
                          is_cover: payload.isCover === true,
                          focal_x: Number(payload.focalX ?? m.focal_x),
                          focal_y: Number(payload.focalY ?? m.focal_y),
                          moderation_status:
                            payload.action === 'MODERATE_MEDIA'
                              ? payload.decision === 'APPROVE'
                                ? 'APPROVED'
                                : 'BLOCKED'
                              : m.moderation_status,
                        }
                      : payload.isCover === true
                        ? { ...m, is_cover: false }
                        : m
                  ),
                }
              : d
          )
        )
    }
  }
  const profile = active?.tailor_profiles,
    media = active?.tailor_draft_media ?? [],
    avatar = media.find((m) => m.media_kind === 'AVATAR'),
    portfolio = media
      .filter((m) => m.media_kind !== 'AVATAR')
      .sort((a, b) => a.sort_order - b.sort_order),
    cover = portfolio.find((item) => item.is_cover) ?? portfolio[0]
  const ready = {
      details: Boolean(
        profile?.display_name &&
        profile.location &&
        (profile.bio?.length ?? 0) >= 80 &&
        profile.languages?.length &&
        profile.specialty_tags?.length &&
        profile.currency &&
        profile.price_range_min &&
        profile.price_range_max
      ),
      avatar: avatar?.moderation_status === 'APPROVED',
      portfolio: portfolio.some(
        (m) => m.moderation_status === 'APPROVED' && m.media_kind === 'PHOTO'
      ),
      approval: Boolean(active?.approved_at),
    },
    missing = [
      !ready.details && 'complete valid details',
      !ready.avatar && 'approve an avatar',
      !ready.portfolio && 'approve a portfolio photo',
      !ready.approval && 'capture administrator pre-approval',
    ].filter(Boolean) as string[]
  const origin = claimWebOrigin()
  const link = rawToken && origin ? `${origin}/claim/${rawToken}` : ''
  const mediaEditable = active?.status === 'DRAFT'
  return (
    <div className="ops-draft-workspace">
      <section className="ops-panel">
        <div className="ops-panel-head">
          <div>
            <p className="ops-action-label">New private storefront</p>
            <h2>Create draft</h2>
          </div>
        </div>
        <div className="ops-panel-body">
          <form action={create} className="ops-form-stack">
            <div className="ops-form-grid">
              <label className="ops-field">
                Display name
                <input name="displayName" required minLength={2} />
              </label>
              <label className="ops-field">
                Location
                <input name="location" required />
              </label>
            </div>
            <fieldset className="ops-fieldset">
              <legend>Languages</legend>
              <Choices name="languages" items={languages} selected={['English']} />
            </fieldset>
            <fieldset className="ops-fieldset">
              <legend>Specialties</legend>
              <Choices name="specialties" items={specialties} selected={[]} />
            </fieldset>
            <div className="ops-price-row">
              <label className="ops-field">
                Currency
                <select name="currency" required defaultValue="">
                  <option value="" disabled>
                    Choose
                  </option>
                  {['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD'].map((code) => (
                    <option key={code}>{code}</option>
                  ))}
                </select>
              </label>
              <label className="ops-field">
                Minimum
                <input name="priceMin" type="number" required />
              </label>
              <label className="ops-field">
                Maximum
                <input name="priceMax" type="number" required />
              </label>
            </div>
            <label className="ops-field">
              Bio <small>Minimum 80 characters</small>
              <textarea name="bio" rows={6} minLength={80} required />
            </label>
            <div className="ops-form-grid">
              <label className="ops-field">
                Instagram handle
                <input name="sourceHandle" />
              </label>
              <label className="ops-field">
                Source URL
                <input name="sourceUrl" type="url" />
              </label>
            </div>
            <button className="ops-button ops-button-primary" disabled={busy}>
              Create private draft
            </button>
          </form>
        </div>
      </section>
      <section className="ops-panel ops-draft-list">
        <div className="ops-panel-head">
          <h2>Private claim profiles</h2>
        </div>
        <div className="ops-panel-body">
          <div className="ops-list-filters">
            <label className="ops-field">
              Search
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tailor name"
              />
            </label>
            <label className="ops-field">
              Status
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="ALL">All statuses</option>
                {Object.entries(statuses).map(([value, item]) => (
                  <option value={value} key={value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Tailor</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Expires</th>
                  <th>Activity</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <tr
                    key={d.id}
                    data-selected={d.id === selected}
                    onClick={() => setSelected(d.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelected(d.id)
                      }
                    }}
                  >
                    <td data-label="Tailor">
                      <strong>{d.tailor_profiles?.display_name}</strong>
                    </td>
                    <td data-label="Status">
                      <span className="ops-status-pill" data-tone={status(d.status).tone}>
                        {status(d.status).label}
                      </span>
                    </td>
                    <td data-label="Location">{d.tailor_profiles?.location}</td>
                    <td data-label="Expires">{date(d.expires_at)}</td>
                    <td data-label="Activity">{date(d.updated_at ?? d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      {active ? (
        <section className="ops-panel ops-draft-editor">
          <div className="ops-panel-head">
            <div>
              <p className="ops-action-label">Storefront workflow</p>
              <h2>{profile?.display_name}</h2>
              <p className="ops-muted">
                Created {date(active.created_at)} · Updated {date(active.updated_at)}
              </p>
            </div>
            <span className="ops-status-pill" data-tone={status(active.status).tone}>
              {status(active.status).label}
            </span>
          </div>
          <div className="ops-panel-body">
            <nav className="ops-stepper" aria-label="Draft workflow">
              {[
                ['1', 'Details', ready.details],
                ['2', 'Media', ready.avatar && ready.portfolio],
                ['3', 'Pre-approval', ready.approval],
                ['4', 'Send link', ['INVITED', 'OPENED'].includes(active.status)],
              ].map(([n, label, done]) => (
                <a href={`#draft-step-${n}`} key={String(n)} data-done={done === true}>
                  <span>{done ? '✓' : n}</span>
                  {label}
                </a>
              ))}
            </nav>
            <section id="draft-step-1" className="ops-workflow-card">
              <h3>1. Details</h3>
              {active.status === 'DRAFT' ? (
                <form key={active.id} action={edit} className="ops-form-stack">
                  <div className="ops-form-grid">
                    <label className="ops-field">
                      Display name
                      <input
                        name="draftDisplayName"
                        defaultValue={profile?.display_name}
                        required
                      />
                    </label>
                    <label className="ops-field">
                      Business name
                      <input name="businessName" defaultValue={profile?.business_name ?? ''} />
                    </label>
                    <label className="ops-field">
                      Location
                      <input name="draftLocation" defaultValue={profile?.location} required />
                    </label>
                  </div>
                  <fieldset className="ops-fieldset">
                    <legend>Languages</legend>
                    <Choices
                      name="draftLanguages"
                      items={languages}
                      selected={profile?.languages ?? []}
                    />
                  </fieldset>
                  <fieldset className="ops-fieldset">
                    <legend>Specialties</legend>
                    <Choices
                      name="draftSpecialties"
                      items={specialties}
                      selected={profile?.specialty_tags ?? []}
                    />
                  </fieldset>
                  <div className="ops-price-row">
                    <label className="ops-field">
                      Currency
                      <select name="draftCurrency" defaultValue={profile?.currency ?? ''} required>
                        {['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD'].map((code) => (
                          <option key={code}>{code}</option>
                        ))}
                      </select>
                    </label>
                    <label className="ops-field">
                      Minimum
                      <input
                        name="draftPriceMin"
                        type="number"
                        defaultValue={profile?.price_range_min}
                        required
                      />
                    </label>
                    <label className="ops-field">
                      Maximum
                      <input
                        name="draftPriceMax"
                        type="number"
                        defaultValue={profile?.price_range_max}
                        required
                      />
                    </label>
                  </div>
                  <label className="ops-field">
                    Bio <small>{profile?.bio?.length ?? 0} characters · minimum 80</small>
                    <textarea
                      name="draftBio"
                      defaultValue={profile?.bio ?? ''}
                      rows={7}
                      minLength={80}
                      required
                    />
                  </label>
                  <button className="ops-button" disabled={busy}>
                    Save details
                  </button>
                </form>
              ) : (
                <DraftSummary profile={profile} />
              )}
            </section>
            <section id="draft-step-2" className="ops-workflow-card">
              <h3>2. Media</h3>
              {!mediaEditable ? (
                <p className="ops-muted">Media is read-only after the claim link is issued.</p>
              ) : null}
              <div
                className="ops-upload-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (mediaEditable) queue(e.dataTransfer.files)
                }}
              >
                <strong>Drop photos or videos here</strong>
                <span>Images are sanitized before upload. Rejected files show a clear reason.</span>
                <label className="ops-button">
                  Choose files
                  <input
                    className="ops-visually-hidden"
                    type="file"
                    disabled={!mediaEditable}
                    multiple
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                    onChange={(e) => e.target.files && queue(e.target.files)}
                  />
                </label>
              </div>
              {uploads.length ? (
                <div className="ops-upload-queue">
                  {uploads.map((choice) => (
                    <div className="ops-upload-item" key={choice.key}>
                      <label className="ops-field">
                        {choice.file.name}
                        <select
                          value={choice.kind}
                          onChange={(e) =>
                            setUploads((items) =>
                              items.map((item) =>
                                item.key === choice.key
                                  ? {
                                      ...item,
                                      kind: e.target.value as UploadChoice['kind'],
                                      error: undefined,
                                    }
                                  : item
                              )
                            )
                          }
                        >
                          <option value="AVATAR">Avatar</option>
                          <option value="PHOTO">Portfolio photo</option>
                          <option value="VIDEO">Portfolio video</option>
                        </select>
                      </label>
                      {choice.error ? <p className="ops-error">{choice.error}</p> : null}
                      <button
                        className="ops-button"
                        type="button"
                        onClick={() =>
                          setUploads((items) => items.filter((item) => item.key !== choice.key))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    className="ops-button ops-button-primary"
                    disabled={busy || !mediaEditable}
                    onClick={uploadAll}
                  >
                    Upload {uploads.length} file{uploads.length === 1 ? '' : 's'}
                  </button>
                </div>
              ) : null}
              {avatar ? (
                <div className="ops-avatar-slot">
                  <MediaTile
                    item={avatar}
                    index={0}
                    total={1}
                    busy={busy}
                    locked={!mediaEditable}
                    onAction={mediaAction}
                  />
                </div>
              ) : (
                <p className="ops-muted">Add and approve one avatar.</p>
              )}
              <div className="ops-media-grid">
                {portfolio.map((item, index) => (
                  <MediaTile
                    key={item.id}
                    item={item}
                    index={index}
                    total={portfolio.length}
                    busy={busy}
                    locked={!mediaEditable}
                    onAction={mediaAction}
                    onReorder={
                      mediaEditable
                        ? async (from, to) => {
                            const ordered = [...portfolio]
                            const [moved] = ordered.splice(from, 1)
                            if (!moved) return
                            ordered.splice(to, 0, moved)
                            const allMedia = avatar ? [avatar, ...ordered] : ordered
                            if (
                              !(await act({
                                action: 'REORDER_MEDIA',
                                inviteId: active.id,
                                assetIds: allMedia.map((media) => media.id),
                              }))
                            )
                              return
                            setDrafts((items) =>
                              items.map((draft) =>
                                draft.id === active.id
                                  ? {
                                      ...draft,
                                      tailor_draft_media: allMedia.map((media, sortOrder) => ({
                                        ...media,
                                        sort_order: sortOrder,
                                      })),
                                    }
                                  : draft
                              )
                            )
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>
            <section className="ops-workflow-card">
              <div className="ops-preview-head">
                <h3>Live storefront preview</h3>
                <div className="ops-button-row">
                  <button
                    className="ops-button"
                    aria-pressed={previewMode === 'phone'}
                    onClick={() => setPreviewMode('phone')}
                  >
                    Phone
                  </button>
                  <button
                    className="ops-button"
                    aria-pressed={previewMode === 'desktop'}
                    onClick={() => setPreviewMode('desktop')}
                  >
                    Desktop
                  </button>
                </div>
              </div>
              <div className="ops-live-preview" data-mode={previewMode}>
                {cover?.preview_url ? (
                  <img
                    src={cover.preview_url}
                    alt="Draft storefront cover"
                    style={{
                      objectPosition: `${(cover.focal_x ?? 0.5) * 100}% ${(cover.focal_y ?? 0.5) * 100}%`,
                    }}
                  />
                ) : (
                  <div className="ops-preview-placeholder">Portfolio cover</div>
                )}
                <div>
                  {avatar?.preview_url ? (
                    <img
                      className="ops-preview-avatar"
                      src={avatar.preview_url}
                      alt="Draft avatar"
                    />
                  ) : null}
                  <p>Your shop, ready when you are</p>
                  <h3>{profile?.display_name}</h3>
                  <span>{profile?.location}</span>
                  <p>
                    {profile?.currency} {profile?.price_range_min}–{profile?.price_range_max}
                  </p>
                  <p>{profile?.specialty_tags?.join(' · ')}</p>
                  <p>{profile?.languages?.join(' · ')}</p>
                  <p>{profile?.bio}</p>
                </div>
              </div>
            </section>
            <section id="draft-step-3" className="ops-workflow-card">
              <h3>3. Administrator pre-approval</h3>
              {active.approved_at ? (
                <DraftApproval draft={active} />
              ) : (
                <form
                  action={async (form) => {
                    const data = await act({
                      action: 'PREAPPROVE',
                      inviteId: active.id,
                      reason: form.get('reason'),
                      evidenceRef: form.get('evidenceRef'),
                      placement: form.get('placement'),
                      publicEvidenceReviewed: reviewed,
                      videoWaiverAcknowledged: waiver,
                    })
                    if (data)
                      setDrafts((items) =>
                        items.map((d) =>
                          d.id === active.id
                            ? {
                                ...d,
                                approved_at: new Date().toISOString(),
                                approval_reason: reason,
                                evidence_ref: evidence,
                                marketplace_placement: String(form.get('placement')),
                              }
                            : d
                        )
                      )
                  }}
                  className="ops-form-stack"
                >
                  <label className="ops-field">
                    Approval reason <small>{reason.length}/20 minimum</small>
                    <textarea
                      name="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={20}
                      rows={4}
                      required
                    />
                  </label>
                  <label className="ops-field">
                    Evidence reference <small>{evidence.length}/8 minimum</small>
                    <input
                      name="evidenceRef"
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                      minLength={8}
                      required
                    />
                  </label>
                  <label className="ops-field">
                    Explore placement
                    <select name="placement">
                      <option value="TAILORING">Tailoring</option>
                      <option value="READY_TO_WEAR">Ready to wear</option>
                    </select>
                  </label>
                  <label className="ops-check-row">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    I reviewed this profile and its public portfolio evidence.
                  </label>
                  <label className="ops-check-row">
                    <input
                      type="checkbox"
                      checked={waiver}
                      onChange={(e) => setWaiver(e.target.checked)}
                    />
                    No challenge video was reviewed. I acknowledge this approval does not certify
                    one.
                  </label>
                  <button
                    className="ops-button"
                    disabled={
                      busy ||
                      reason.trim().length < 20 ||
                      evidence.trim().length < 8 ||
                      !reviewed ||
                      !waiver
                    }
                  >
                    Capture administrator pre-approval
                  </button>
                </form>
              )}
            </section>
            <section id="draft-step-4" className="ops-workflow-card">
              <h3>4. Send private link</h3>
              <div className="ops-readiness">
                <h4>{missing.length ? 'Before sending' : 'Ready to send'}</h4>
                <ul>
                  {Object.entries({
                    Details: ready.details,
                    'Approved avatar': ready.avatar,
                    'Approved portfolio photo': ready.portfolio,
                    'Administrator pre-approval': ready.approval,
                  }).map(([label, done]) => (
                    <li key={label} data-ready={done}>
                      <span>{done ? '✓' : '!'}</span>
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
              {['DRAFT', 'INVITED', 'OPENED'].includes(active.status) ? (
                <button
                  className={
                    active.status === 'DRAFT' ? 'ops-button ops-button-primary' : 'ops-button'
                  }
                  disabled={busy || missing.length > 0}
                  onClick={async () => {
                    if (
                      active.status !== 'DRAFT' &&
                      !window.confirm(
                        'Regenerate this link? The current link stops working immediately.'
                      )
                    )
                      return
                    const data = await act({ action: 'ISSUE', inviteId: active.id })
                    if (data?.token)
                      setDrafts((items) =>
                        items.map((d) =>
                          d.id === active.id
                            ? { ...d, status: 'INVITED', expires_at: data.expiresAt }
                            : d
                        )
                      )
                  }}
                >
                  {active.status === 'DRAFT' ? 'Generate private link' : 'Regenerate link'}
                </button>
              ) : null}
              {missing.length ? <p className="ops-muted">Missing: {missing.join(' · ')}</p> : null}
              {rawToken ? (
                <SharePanel
                  link={link}
                  draft={active}
                  profile={profile}
                  copied={copied}
                  onCopy={async () => {
                    await navigator.clipboard.writeText(link)
                    setCopied(true)
                  }}
                />
              ) : null}
            </section>
            {['DRAFT', 'INVITED', 'OPENED'].includes(active.status) ? (
              <section className="ops-danger-zone">
                <h3>Danger zone</h3>
                <p>These actions immediately stop or remove access.</p>
                <div className="ops-button-row">
                  <button
                    className="ops-button ops-button-danger"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm('Revoke this link? It stops working immediately.')) return
                      if (await act({ action: 'REVOKE', inviteId: active.id }))
                        setDrafts((items) =>
                          items.map((d) => (d.id === active.id ? { ...d, status: 'REVOKED' } : d))
                        )
                    }}
                  >
                    Revoke link
                  </button>
                  <button
                    className="ops-button ops-button-danger"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          'Decline this draft? Its private media will be scheduled for purge.'
                        )
                      )
                        return
                      if (await act({ action: 'DECLINE', inviteId: active.id }))
                        setDrafts((items) =>
                          items.map((d) => (d.id === active.id ? { ...d, status: 'DECLINED' } : d))
                        )
                    }}
                  >
                    Decline and schedule purge
                  </button>
                </div>
              </section>
            ) : null}
            {message ? (
              <p className="ops-status-banner" role="status">
                {message}
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="ops-empty">
          <h2>Select a draft</h2>
          <p>Choose a storefront from the table.</p>
        </section>
      )}
    </div>
  )
}

function MediaTile({
  item,
  index,
  total,
  busy,
  locked,
  onAction,
  onReorder,
}: {
  item: Media
  index: number
  total: number
  busy: boolean
  locked: boolean
  onAction: (item: Media, payload: Record<string, unknown>) => Promise<void>
  onReorder?: (from: number, to: number) => Promise<void>
}) {
  const [focal, setFocal] = useState({ x: item.focal_x ?? 0.5, y: item.focal_y ?? 0.5 })
  const focalSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (focalSave.current) clearTimeout(focalSave.current)
    },
    []
  )
  const update = (payload: Record<string, unknown>) =>
    onAction(item, {
      action: 'UPDATE_MEDIA',
      sortOrder: item.sort_order,
      isCover: item.is_cover,
      focalX: item.focal_x ?? 0.5,
      focalY: item.focal_y ?? 0.5,
      ...payload,
    })
  const queueFocalSave = (next: { x: number; y: number }) => {
    setFocal(next)
    if (focalSave.current) clearTimeout(focalSave.current)
    focalSave.current = setTimeout(() => {
      void update({ focalX: next.x, focalY: next.y })
    }, 350)
  }
  return (
    <article
      className="ops-media-tile"
      draggable={Boolean(onReorder)}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const from = Number(e.dataTransfer.getData('text/plain'))
        if (onReorder && Number.isInteger(from) && from !== index) void onReorder(from, index)
      }}
    >
      <button
        className="ops-focal-image"
        type="button"
        aria-label={`Set focal point for ${item.media_kind.toLowerCase()}`}
        aria-valuetext={`Focal point ${Math.round(focal.x * 100)}% across, ${Math.round(focal.y * 100)}% down`}
        disabled={locked}
        onClick={(e) => {
          if (e.detail === 0) return
          const box = e.currentTarget.getBoundingClientRect()
          const clamp = (value: number) => Math.max(0, Math.min(1, value))
          queueFocalSave({
            x: clamp((e.clientX - box.left) / box.width),
            y: clamp((e.clientY - box.top) / box.height),
          })
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02
          const x = focal.x
          const y = focal.y
          const next =
            e.key === 'ArrowLeft'
              ? { x: Math.max(0, x - step), y }
              : e.key === 'ArrowRight'
                ? { x: Math.min(1, x + step), y }
                : e.key === 'ArrowUp'
                  ? { x, y: Math.max(0, y - step) }
                  : e.key === 'ArrowDown'
                    ? { x, y: Math.min(1, y + step) }
                    : null
          if (next) {
            e.preventDefault()
            queueFocalSave(next)
          }
        }}
      >
        {item.content_type.startsWith('video/') ? (
          <video src={item.preview_url ?? undefined} muted playsInline />
        ) : (
          <img
            src={item.preview_url ?? undefined}
            alt="Private storefront media"
            style={{
              objectPosition: `${focal.x * 100}% ${focal.y * 100}%`,
            }}
          />
        )}
        <span
          className="ops-focal-crosshair"
          style={{
            left: `${focal.x * 100}%`,
            top: `${focal.y * 100}%`,
          }}
        >
          +
        </span>
        {item.is_cover ? <span className="ops-cover-badge">Cover</span> : null}
      </button>
      <div className="ops-media-meta">
        <span
          className="ops-status-pill"
          data-tone={
            item.moderation_status === 'APPROVED'
              ? 'healthy'
              : item.moderation_status === 'BLOCKED'
                ? 'critical'
                : 'warning'
          }
        >
          {item.moderation_status === 'APPROVED'
            ? 'Approved'
            : item.moderation_status === 'BLOCKED'
              ? 'Blocked'
              : 'Pending'}
        </span>
        <span>
          {item.media_kind === 'AVATAR'
            ? 'Avatar'
            : item.media_kind === 'VIDEO'
              ? 'Video'
              : 'Photo'}
          {item.duration_ms ? ` · ${Math.round(item.duration_ms / 1000)}s` : ''}
        </span>
      </div>
      <div className="ops-button-row">
        {onReorder ? (
          <>
            <button
              className="ops-button"
              title="Move earlier"
              aria-label="Move earlier"
              disabled={busy || index === 0}
              onClick={() => onReorder(index, index - 1)}
            >
              ←
            </button>
            <button
              className="ops-button"
              title="Move later"
              aria-label="Move later"
              disabled={busy || index === total - 1}
              onClick={() => onReorder(index, index + 1)}
            >
              →
            </button>
          </>
        ) : null}
        {!item.is_cover && item.media_kind !== 'AVATAR' ? (
          <button className="ops-button" disabled={busy} onClick={() => update({ isCover: true })}>
            Make cover
          </button>
        ) : null}
        {item.moderation_status === 'PENDING' ? (
          <>
            <button
              className="ops-button"
              disabled={busy}
              onClick={() =>
                onAction(item, {
                  action: 'MODERATE_MEDIA',
                  decision: 'APPROVE',
                  reason: 'Staff reviewed private storefront media.',
                })
              }
            >
              Approve
            </button>
            <button
              className="ops-button ops-button-danger"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('Why is this media blocked? (at least 12 characters)')
                if (reason?.trim() && reason.trim().length >= 12)
                  void onAction(item, {
                    action: 'MODERATE_MEDIA',
                    decision: 'BLOCK',
                    reason: reason.trim(),
                  })
              }}
            >
              Block
            </button>
          </>
        ) : null}
        <button
          className="ops-button ops-button-danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Delete this private media item? This cannot be undone.'))
              void onAction(item, { action: 'DELETE_MEDIA' })
          }}
        >
          Delete
        </button>
      </div>
    </article>
  )
}
