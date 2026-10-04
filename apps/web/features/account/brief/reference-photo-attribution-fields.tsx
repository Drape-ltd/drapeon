'use client'

import {
  CUSTOM_ORDER_STYLE_ATTRIBUTES,
  REFERENCE_PHOTO_MAX_ATTRIBUTES,
  REFERENCE_PHOTO_NOTE_MAX_CHARS,
  sanitizeReferencePhotoAttributions,
} from '@drape/shared'

export type ReferencePhotoAttributionDraft = { attributes: string[]; note: string }
export type ReferencePhotoAttributionDrafts = Record<number, ReferencePhotoAttributionDraft>

const EMPTY_DRAFT: ReferencePhotoAttributionDraft = { attributes: [], note: '' }

/**
 * Maps index-keyed drafts onto the uploaded URLs the brief is about to submit. Upload
 * order matches `photos` order, which is what makes the index a valid join key.
 */
export function referencePhotoAttributionPayload(uploadedUrls: string[], drafts: ReferencePhotoAttributionDrafts) {
  return sanitizeReferencePhotoAttributions(
    uploadedUrls.map((photo, index) => ({ photo, ...(drafts[index] ?? EMPTY_DRAFT) })),
    uploadedUrls,
  )
}

/**
 * Binds the shared style vocabulary to each individual reference photo so a tailor can
 * tell which photo is about the neckline and which is only about sleeve length.
 *
 * Drafts are keyed by position in `photos`; the brief uploads photos sequentially, so
 * that index is what maps an attribution onto its uploaded URL at submit time.
 */
export function ReferencePhotoAttributionFields({
  photos,
  value,
  onChange,
}: {
  photos: File[]
  value: ReferencePhotoAttributionDrafts
  onChange: (next: ReferencePhotoAttributionDrafts) => void
}) {
  if (photos.length === 0) return null

  const update = (index: number, patch: Partial<ReferencePhotoAttributionDraft>) => {
    const existing = value[index] ?? EMPTY_DRAFT
    onChange({ ...value, [index]: { ...existing, ...patch } })
  }

  return (
    <div className="grid gap-3 rounded-[12px] border border-ink/10 bg-bone/35 p-4">
      <div>
        <p className="text-sm font-semibold text-ink">What should the tailor take from each photo?</p>
        <p className="mt-1 text-xs leading-5 text-ink/60">
          Optional, but it saves a lot of back and forth. Tag up to {REFERENCE_PHOTO_MAX_ATTRIBUTES} things per photo so
          the tailor knows which one is about the neckline and which is only about sleeve length.
        </p>
      </div>
      {photos.map((photo, index) => {
        const entry = value[index] ?? EMPTY_DRAFT
        const atLimit = entry.attributes.length >= REFERENCE_PHOTO_MAX_ATTRIBUTES
        return (
          <div
            key={`${photo.name}-${index}`}
            className="grid gap-2 border-t border-ink/8 pt-3 first:border-t-0 first:pt-0"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-needle">
              Photo {index + 1}
              <span className="ml-2 font-medium normal-case tracking-normal text-ink/52">{photo.name}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {CUSTOM_ORDER_STYLE_ATTRIBUTES.map((attribute) => {
                const selected = entry.attributes.includes(attribute)
                return (
                  <button
                    key={attribute}
                    type="button"
                    aria-pressed={selected}
                    disabled={!selected && atLimit}
                    onClick={() =>
                      update(index, {
                        attributes: selected
                          ? entry.attributes.filter((item) => item !== attribute)
                          : [...entry.attributes, attribute],
                      })
                    }
                    className={
                      selected
                        ? 'rounded-full border border-needle bg-needle px-3 py-1.5 text-xs font-semibold text-white'
                        : 'rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/72 disabled:cursor-not-allowed disabled:opacity-40'
                    }
                  >
                    {attribute}
                  </button>
                )
              })}
            </div>
            {atLimit ? (
              <p className="text-xs text-ink/52">
                {REFERENCE_PHOTO_MAX_ATTRIBUTES} is the limit for one photo. Deselect one to choose another.
              </p>
            ) : null}
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-ink/72">Note for this photo (optional)</span>
              <input
                value={entry.note}
                maxLength={REFERENCE_PHOTO_NOTE_MAX_CHARS}
                placeholder="Neckline only — not the sleeve length"
                onChange={(event) => update(index, { note: event.target.value })}
                className="rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
              />
            </label>
          </div>
        )
      })}
    </div>
  )
}
