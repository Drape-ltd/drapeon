'use client'

import { useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, ImagePlus, RotateCcw, Star, Trash2, Video } from 'lucide-react'

export type OnboardingMediaStatus = 'uploading' | 'added' | 'failed'

export type OnboardingMediaItem = {
  id: string
  kind: 'IMAGE' | 'VIDEO'
  /** Object URL, data URL, or remote URL — the component only displays it. */
  previewUrl: string | null
  status: OnboardingMediaStatus
  /** 0–100, only meaningful while uploading. */
  progress?: number
  title?: string
  /** Still image shown while the video itself is not decoded. */
  posterUrl?: string | null
  durationSeconds?: number
  /** Why this item failed, in words the tailor can act on. */
  errorMessage?: string
}

/**
 * The single uploader for every kind of onboarding media.
 *
 * Files upload the moment they are chosen. There is no second "save" click to
 * forget, each tile carries its own progress and its own retry, and the
 * requirement is stated once at the top and counted live underneath — so a
 * tailor knows she has cleared the gate before she presses Continue.
 */
export function MediaUploadField({
  items,
  requiredCount = 1,
  maxItems = 12,
  maxVideos = 4,
  maxVideoSeconds = 30,
  label = 'Your work',
  emptyHint = 'Add at least one photo or video of work you made.',
  busy = false,
  onSelectFiles,
  onRetry,
  onRemove,
  onMakeCover,
  onMove,
  onOpenDetails,
}: {
  items: OnboardingMediaItem[]
  requiredCount?: number
  maxItems?: number
  maxVideos?: number
  maxVideoSeconds?: number
  label?: string
  emptyHint?: string
  busy?: boolean
  onSelectFiles?: (files: File[]) => void
  onRetry?: (id: string) => void
  onRemove?: (id: string) => void
  onMakeCover?: (id: string) => void
  onMove?: (id: string, direction: -1 | 1) => void
  onOpenDetails?: (id: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const videoCount = items.filter((item) => item.kind === 'VIDEO').length
  const addedCount = items.filter((item) => item.status === 'added').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const atItemCap = items.length >= maxItems
  const atVideoCap = videoCount >= maxVideos
  const requirementMet = addedCount >= requiredCount

  function handleFiles(files: FileList | null) {
    const chosen = Array.from(files ?? [])
    if (chosen.length) onSelectFiles?.(chosen)
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    if (atItemCap) return
    handleFiles(event.dataTransfer.files)
  }

  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-lg font-semibold text-ink">{label}</h3>
        <p className="text-sm leading-6 text-ink/62">
          {emptyHint} Up to {maxItems} items, including {maxVideos} videos of {maxVideoSeconds}{' '}
          seconds or less.
        </p>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!atItemCap) setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`grid gap-2 rounded-[12px] border border-dashed p-6 text-center transition-colors ${
          dragActive ? 'border-needle bg-needle/10' : 'border-needle/35 bg-needle/5'
        } ${atItemCap ? 'opacity-55' : ''}`}
      >
        <span className="mx-auto flex items-center gap-2 text-needle" aria-hidden="true">
          <ImagePlus className="size-6" />
          <Video className="size-6" />
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
          className="sr-only"
          onChange={(event) => handleFiles(event.target.files)}
        />
        <button
          type="button"
          disabled={atItemCap || busy}
          onClick={() => inputRef.current?.click()}
          className="mx-auto min-h-11 rounded-full bg-needle px-5 text-sm font-semibold text-white transition-colors hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/20"
        >
          {atItemCap ? `You have reached ${maxItems} items` : 'Choose photos or videos'}
        </button>
        <p className="text-xs leading-5 text-ink/52">
          {atItemCap
            ? 'Remove an item to add a different one.'
            : 'Or drop files here. They upload as soon as you choose them.'}
        </p>
      </div>

      <p
        role="status"
        className={`text-xs font-semibold ${
          failedCount ? 'text-rust-700' : requirementMet ? 'text-needle' : 'text-ink/58'
        }`}
      >
        {/* Once the minimum is met, counting against it reads oddly ("4 of 1
            required item added"), so switch to a plain total. */}
        {requirementMet
          ? `${addedCount} ${addedCount === 1 ? 'item' : 'items'} added`
          : `${addedCount} of ${requiredCount} required ${requiredCount === 1 ? 'item' : 'items'} added — keep going`}
        {videoCount > 0 ? ` · ${videoCount} of ${maxVideos} videos` : ''}
        {atVideoCap ? ' · video limit reached' : ''}
        {failedCount
          ? ` · ${failedCount} ${failedCount === 1 ? 'file needs' : 'files need'} another try`
          : ''}
      </p>

      {items.length ? (
        <ul
          className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3"
          aria-label={`${label} added so far`}
        >
          {items.map((item, index) => {
            const isCover = index === 0 && item.status === 'added'
            return (
              <li
                key={item.id}
                className={`relative overflow-hidden rounded-[10px] border ${
                  item.status === 'failed' ? 'border-rust bg-rust/8' : 'border-ink/10 bg-bone'
                }`}
              >
                <div className={`relative ${item.status === 'failed' ? 'aspect-[5/2]' : 'aspect-[4/3]'}`}>
                  {item.previewUrl && item.kind === 'VIDEO' ? (
                    // Seeking to 0.1s makes the browser paint a real frame;
                    // metadata alone leaves the tile black.
                    <video
                      src={`${item.previewUrl}#t=0.1`}
                      // The poster paints immediately. Seeking to 0.1s stays as
                      // the fallback for clips uploaded before posters existed,
                      // and for the moment a poster 404s.
                      poster={item.posterUrl ?? undefined}
                      muted
                      playsInline
                      preload="metadata"
                      aria-label={item.title || `Video ${index + 1}`}
                      className="size-full object-cover"
                    />
                  ) : item.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.previewUrl}
                      alt={item.title || `Photo ${index + 1}`}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div
                      className={`grid size-full place-items-center ${
                        item.status === 'failed' ? 'text-rust' : 'text-ink/35'
                      }`}
                      aria-hidden="true"
                    >
                      {item.status === 'failed' ? (
                        <AlertTriangle className="size-7" />
                      ) : item.kind === 'VIDEO' ? (
                        <Video className="size-7" />
                      ) : (
                        <ImagePlus className="size-7" />
                      )}
                    </div>
                  )}

                  {item.status === 'uploading' ? (
                    <div className="absolute inset-0 grid place-items-center bg-ink/55 px-3">
                      <div className="w-full">
                        <p className="text-center text-xs font-semibold text-white">
                          Uploading {Math.round(item.progress ?? 0)}%
                        </p>
                        <div
                          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/30"
                          role="progressbar"
                          aria-valuenow={Math.round(item.progress ?? 0)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Uploading ${item.title || 'item'}`}
                        >
                          <span
                            className="block h-full rounded-full bg-white transition-all"
                            style={{ width: `${Math.max(4, Math.min(100, item.progress ?? 0))}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {isCover ? (
                    <span className="absolute left-2 top-2 rounded-full bg-needle px-2 py-0.5 text-[11px] font-semibold text-white">
                      Cover
                    </span>
                  ) : null}
                  {item.kind === 'VIDEO' && item.status === 'added' ? (
                    <span className="absolute bottom-2 left-2 rounded-full bg-ink/75 px-2 py-0.5 text-[11px] font-semibold text-white">
                      Video{item.durationSeconds ? ` · ${Math.round(item.durationSeconds)}s` : ''}
                    </span>
                  ) : null}
                </div>

                {item.status === 'failed' ? (
                  <div className="grid gap-2 border-t border-rust/25 px-3 py-2.5">
                    <p className="text-xs font-semibold leading-5 text-rust-700">
                      {item.errorMessage ?? 'This file did not upload.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => onRetry?.(item.id)}
                      className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full border border-ink/12 bg-white px-3 text-xs font-semibold text-needle"
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" /> Try again
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-1 px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenDetails?.(item.id)}
                      className="truncate text-left text-xs font-semibold text-needle"
                    >
                      {item.title?.trim() || 'Add details'}
                    </button>
                    <span className="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        aria-label="Move earlier"
                        disabled={index === 0 || busy}
                        onClick={() => onMove?.(item.id, -1)}
                        className="grid size-7 place-items-center rounded-full text-ink/55 hover:bg-ink/8 disabled:opacity-30"
                      >
                        <ArrowLeft className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move later"
                        disabled={index === items.length - 1 || busy}
                        onClick={() => onMove?.(item.id, 1)}
                        className="grid size-7 place-items-center rounded-full text-ink/55 hover:bg-ink/8 disabled:opacity-30"
                      >
                        <ArrowRight className="size-3.5" />
                      </button>
                      {!isCover && item.status === 'added' ? (
                        <button
                          type="button"
                          aria-label="Make this the cover"
                          onClick={() => onMakeCover?.(item.id)}
                          className="grid size-7 place-items-center rounded-full text-ink/55 hover:bg-ink/8"
                        >
                          <Star className="size-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label="Remove"
                        onClick={() => onRemove?.(item.id)}
                        className="grid size-7 place-items-center rounded-full text-ink/55 hover:bg-rust/10 hover:text-rust"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-[8px] border border-ink/8 bg-bone/45 px-4 py-3 text-sm text-ink/58">
          Nothing added yet. Your first photo is the one customers look at longest.
        </p>
      )}
    </section>
  )
}
