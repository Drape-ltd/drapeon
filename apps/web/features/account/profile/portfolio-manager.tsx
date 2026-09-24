'use client'

import Image from 'next/image'
import { useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { friendlyActionError } from '@drape/shared/action-errors'
import { marketplaceMediaObjectPosition, MarketplaceMedia } from '@drape/shared'
import { ALLOWED_VIDEO_CONTENT_TYPES, MEDIA_LIMITS_BYTES, MEDIA_LIMITS_SECONDS, MEDIA_CACHE_CONTROL_SECONDS, VIDEO_DURATION_LIMIT_MESSAGE } from '@drape/shared/media-policy'
import { createClient } from '../../../lib/supabase'
import { safeUserText } from '../../../lib/safe-display'
import type { PortfolioItem, ProfileRenderData } from '../shared/account-data-contracts'
import { invokeAccountFunction, stringList, uniqueValues } from '../shared/account-data-queries'
import { ActionNotice, assertNoContactLeak, portfolioVideoDuration, reencodeImageFile, safeMediaUrl } from '../messages/account-messages-surface'
import { Button } from '../../../components/ui/button'
import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { MediaUploadField, OnboardingMediaItem } from '../tailor-onboarding/media-upload-field'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { Textarea } from '../../../components/ui/textarea'
import { uploadPublicFile, uploadPublicFileWithLocation } from '../orders/account-order-actions'
import { MESSAGE_PHOTO_MAX_BYTES, MediaInspectionOverlay, SortableMediaEntry, moveMediaEntry } from '../shop/account-shop-surface'

export const MESSAGE_PHOTO_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const PORTFOLIO_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.portfolioVideo

const PORTFOLIO_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.portfolioVideo

const PORTFOLIO_VIDEO_CONTENT_TYPES = new Set<string>(ALLOWED_VIDEO_CONTENT_TYPES)

function validateMessagePhoto(file: File) {
  if (!MESSAGE_PHOTO_CONTENT_TYPES.has(file.type)) {
    return 'Choose a JPEG, PNG, or WebP image.'
  }
  if (file.size > MESSAGE_PHOTO_MAX_BYTES) {
    return 'Choose a photo under 10 MB.'
  }
  return null
}

function portfolioVideoContentType(file: File) {
  const normalized = file.type.split(';')[0]?.trim().toLowerCase()
  if (normalized && PORTFOLIO_VIDEO_CONTENT_TYPES.has(normalized)) return normalized
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return null
}

async function preparePortfolioVideoFile(file: File) {
  const contentType = portfolioVideoContentType(file)
  if (!contentType || !PORTFOLIO_VIDEO_CONTENT_TYPES.has(contentType)) {
    throw new Error('Choose an MP4 or MOV video.')
  }
  if (file.size > PORTFOLIO_VIDEO_MAX_BYTES) {
    throw new Error(
      `Choose a portfolio video under ${Math.round(PORTFOLIO_VIDEO_MAX_BYTES / (1024 * 1024))} MB.`
    )
  }

  const duration = await portfolioVideoDuration(file)
  if (Number.isFinite(duration) && duration > PORTFOLIO_VIDEO_MAX_SECONDS) {
    throw new Error(VIDEO_DURATION_LIMIT_MESSAGE)
  }

  return new File([file], file.name, {
    type: contentType,
    lastModified: file.lastModified,
  })
}

/**
 * Grabs a still from a video file for use as a tile poster.
 *
 * A grid of <video preload="metadata"> tiles asks the browser to range-fetch and
 * decode every clip just to show a thumbnail; Chromium throttles concurrent
 * decoders, so later tiles sit blank until one frees up. A real JPEG poster
 * renders instantly and costs nothing to paint.
 *
 * Returns null when the browser cannot decode the file — the caller simply
 * uploads without a poster and the tile falls back to decoding a frame.
 */
async function captureVideoPosterBlob(file: File): Promise<Blob | null> {
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'
  try {
    const frameReady = new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => {
        // Seek a little past zero: the very first frame is often black.
        video.currentTime = Math.min(0.1, Math.max(0, (video.duration || 1) / 10))
      }
      video.onseeked = () => resolve()
      video.onerror = () => reject(new Error('poster decode failed'))
      window.setTimeout(() => reject(new Error('poster decode timed out')), 8000)
    })
    video.src = objectUrl
    await frameReady
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return null
    const scale = Math.min(1, 640 / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72)
    })
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Posters live beside their video at the same path plus a suffix, so no schema
 * change is needed to find one. Videos uploaded before posters existed simply
 * have no object there, and the tile falls back to decoding a frame.
 */
function posterUrlForVideo(videoUrl: string) {
  return `${videoUrl}${VIDEO_POSTER_SUFFIX}`
}

const VIDEO_POSTER_SUFFIX = '.poster.jpg'

function MediaPresentationEditor({
  media,
  onRefresh,
}: {
  media: MarketplaceMedia[]
  onRefresh: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(media[0]?.id ?? null)
  const selected = media.find((item) => item.id === selectedId) ?? media[0] ?? null
  const [focalX, setFocalX] = useState(selected?.focalX ?? 0.5)
  const [focalY, setFocalY] = useState(selected?.focalY ?? 0.5)
  const [altText, setAltText] = useState(selected?.altText ?? '')
  const [posterSeconds, setPosterSeconds] = useState(selected?.kind === 'VIDEO' ? '0' : '')
  const [isPrimary, setIsPrimary] = useState(selected?.isPrimary ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!selected) {
    return (
      <div className="rounded-[8px] border border-ui-border bg-bone/55 p-4 text-sm leading-6 text-ink/62">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/50">
          Preview controls
        </p>
        <p className="mt-1">
          Add and save a portfolio image below first. Crop, cover-image, and accessibility controls
          will appear here after the upload is registered.
        </p>
      </div>
    )
  }

  function selectMedia(item: MarketplaceMedia) {
    setSelectedId(item.id)
    setFocalX(item.focalX)
    setFocalY(item.focalY)
    setAltText(item.altText ?? '')
    setPosterSeconds('0')
    setIsPrimary(item.isPrimary)
    setError(null)
    setSuccess(null)
  }

  async function savePresentation() {
    if (!selected) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('tailor-profile-action', {
        action: 'update-media-presentation',
        mediaAssetId: selected.id,
        focalX,
        focalY,
        altText: altText.trim() || null,
        posterTimestampMs:
          selected.kind === 'VIDEO'
            ? Math.round(Math.max(0, Number(posterSeconds) || 0) * 1000)
            : null,
        portfolioPosition: selected.position,
        isPrimary,
      })
      setSuccess('Presentation saved across Explore and your public profile.')
      onRefresh()
    } catch (cause) {
      setError(friendlyActionError(cause, 'Presentation settings could not save.'))
    } finally {
      setBusy(false)
    }
  }

  const objectPosition = marketplaceMediaObjectPosition({ focalX, focalY })
  const previewClass = selected.kind === 'VIDEO' ? 'object-contain bg-ink' : 'object-cover'
  const mediaPreview = (label: string, className: string) => (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/48">
        {label}
      </p>
      <div
        className={`relative overflow-hidden rounded-[8px] border border-ui-border bg-white ${className}`}
      >
        {selected.kind === 'VIDEO' ? (
          <video
            src={selected.url}
            poster={selected.posterUrl ?? undefined}
            muted
            playsInline
            className={`size-full ${previewClass}`}
            style={{ objectPosition }}
          />
        ) : (
          <Image
            src={selected.url}
            alt={altText || 'Portfolio preview'}
            fill
            unoptimized
            className={previewClass}
            style={{ objectPosition }}
            sizes="(max-width: 768px) 33vw, 180px"
          />
        )}
        <span
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-needle shadow"
          style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
        />
      </div>
    </div>
  )

  return (
    <div className="rounded-[12px] border border-ui-border bg-white p-4 shadow-[0_1px_0_rgba(18,19,20,0.02)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/45">
            Presentation
          </p>
          <h3 className="mt-1 text-base font-semibold text-ink">
            Choose the best frame for each piece
          </h3>
          <p className="mt-1 text-xs leading-5 text-ink/56">
            Set how each photo is cropped, and which frame of a video is shown as its cover.
          </p>
        </div>
        <span className="rounded-full border border-needle/15 bg-needle/8 px-2.5 py-1 text-xs font-semibold text-needle">
          {media.length} asset{media.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-4 rounded-[10px] border border-ui-border bg-ui-muted/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/50">Portfolio asset</p>
          {selected?.isPrimary ? (
            <span className="rounded-[6px] bg-needle/10 px-2 py-1 text-[10px] font-semibold text-needle">
              Cover photo
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Portfolio media">
          {media.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectMedia(item)}
              aria-pressed={item.id === selected.id}
              className={`group relative h-16 w-16 shrink-0 overflow-hidden rounded-[8px] border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle ${item.id === selected.id ? 'border-needle shadow-sm' : 'border-transparent hover:border-ink/20'}`}
            >
              {item.kind === 'VIDEO' ? (
                <video
                  src={item.url}
                  poster={item.posterUrl ?? undefined}
                  muted
                  playsInline
                  className="size-full object-cover"
                />
              ) : (
                <Image
                  src={item.url}
                  alt=""
                  fill
                  unoptimized
                  className="object-cover"
                  style={{ objectPosition: marketplaceMediaObjectPosition(item) }}
                  sizes="64px"
                />
              )}
              <span className="absolute inset-x-1 bottom-1 rounded bg-ink/75 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                {index + 1}
              </span>
              {/* This badge was hardcoded to "Image", so a video tile claimed to
                  be a photo — and the preview beside it rendered a broken
                  image. Say what the asset actually is. */}
              <span className="absolute left-1 top-1 rounded bg-white/85 px-1 text-[8px] font-semibold text-ink">
                {item.isPrimary ? 'Cover' : item.kind === 'VIDEO' ? 'Video' : 'Image'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <ActionNotice error={error} success={success} />

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-semibold text-ink">Horizontal crop</label>
              <span className="text-xs font-medium text-ink/55">{Math.round(focalX * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={focalX}
              onChange={(event) => setFocalX(Number(event.target.value))}
              className="accent-needle"
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-semibold text-ink">Vertical crop</label>
              <span className="text-xs font-medium text-ink/55">{Math.round(focalY * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={focalY}
              onChange={(event) => setFocalY(Number(event.target.value))}
              className="accent-needle"
            />
          </div>

          <label className="grid gap-2 text-sm font-semibold text-ink">
            Accessibility description
            <Textarea
              value={altText}
              onChange={(event) => setAltText(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Describe the garment, cut, fabric, and key detail"
            />
          </label>

          {selected.kind === 'VIDEO' ? (
            <label className="grid gap-2 text-sm font-semibold text-ink">
              Cover frame
              <Input
                type="number"
                min="0"
                step="0.1"
                value={posterSeconds}
                onChange={(event) => setPosterSeconds(event.target.value)}
              />
            </label>
          ) : null}

          <label className="flex items-start gap-3 rounded-[10px] border border-ui-border bg-ui-muted/30 p-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(event) => setIsPrimary(event.target.checked)}
              className="mt-0.5 size-4 accent-needle"
            />
            <span>
              <strong className="block">Use as cover image</strong>
              <span className="mt-0.5 block text-ink/58">
                This is the main visual customers see in your public profile and marketplace tiles.
              </span>
            </span>
          </label>

          <Button
            type="button"
            onClick={() => {
              void savePresentation()
            }}
            disabled={busy}
            className="w-fit"
          >
            {busy ? 'Saving…' : 'Save presentation'}
          </Button>
        </div>

        <div className="grid gap-3">
          <div className="rounded-[10px] border border-ui-border bg-ui-muted/30 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
              Preview
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {mediaPreview('Explore', 'aspect-[4/5]')}
              {mediaPreview('Profile', 'aspect-square')}
              {mediaPreview('Wide', 'aspect-[16/10]')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function titleFromFileName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/u, '').replace(/[_-]+/gu, ' ').trim()
  const cleaned = base.replace(/\s+/gu, ' ').slice(0, 60)
  if (!cleaned || /^(img|image|photo|dsc|screenshot)[\s\d]*$/iu.test(cleaned)) return 'Untitled piece'
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export function PortfolioManager({
  data,
  onRefresh,
}: {
  data: Pick<ProfileRenderData, 'userId' | 'tailorProfile' | 'portfolioItems' | 'portfolioMedia'>
  onRefresh: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingItem = data.portfolioItems.find((item) => item.id === editingId) ?? null
  const profileVideoUrls = stringList(data.tailorProfile?.portfolio_video_urls)
  const portfolioItemEntries: SortableMediaEntry[] = data.portfolioItems.flatMap((item, index) =>
    item.image_url
      ? [
          {
            id: item.id,
            url: item.image_url,
            label: safeUserText(item.title, `Portfolio ${index + 1}`),
          },
        ]
      : []
  )
  const profileVideoEntries: SortableMediaEntry[] = profileVideoUrls.map((url, index) => ({
    id: `portfolio-video-${index}-${url}`,
    url,
    label: `Portfolio video ${index + 1}`,
  }))
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [portfolioInspectIndex, setPortfolioInspectIndex] = useState<number | null>(null)
  const [portfolioVideoInspectIndex, setPortfolioVideoInspectIndex] = useState<number | null>(null)
  // Video problems belong beside the video picker. Routing them to the panel's
  // shared notice put "Videos must be 30 seconds or less" at the top of a very
  // tall panel, far off-screen from the control that caused it.
  const [videoError, setVideoError] = useState<string | null>(null)
  const [pendingUploads, setPendingUploads] = useState<
    Array<{ id: string; name: string; kind: 'IMAGE' | 'VIDEO'; status: 'uploading' | 'failed'; errorMessage?: string }>
  >([])
  const [detailItemId, setDetailItemId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const videoFileRef = useRef<HTMLInputElement | null>(null)
  const portfolioImageInputId = useId()
  const portfolioVideoInputId = useId()

  if (!data.tailorProfile) return null

  function startEdit(item: PortfolioItem) {
    setEditingId(item.id)
    setTitle(item.title ?? '')
    setCategory(item.category ?? '')
    setDescription(item.description ?? '')
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setCategory('')
    setDescription('')
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handlePortfolioVideoSelection(nextFile: File | null) {
    setError(null)
    setSuccess(null)
    if (!nextFile) {
      setVideoFile(null)
      return
    }

    setVideoError(null)
    try {
      await preparePortfolioVideoFile(nextFile)
      setVideoFile(nextFile)
    } catch (cause) {
      setVideoFile(null)
      if (videoFileRef.current) videoFileRef.current.value = ''
      setVideoError(
        friendlyActionError(cause, 'Choose an MP4 or MOV video under the portfolio limits.')
      )
    }
  }

  async function savePortfolioVideo() {
    setError(null)
    setVideoError(null)
    setSuccess(null)
    if (!data.userId) return
    if (!videoFile) {
      setVideoError('Choose a portfolio video.')
      return
    }
    if (profileVideoUrls.length >= 4) {
      setVideoError('You can include up to 4 portfolio videos.')
      return
    }

    setBusy('save-video')
    try {
      const preparedVideo = await preparePortfolioVideoFile(videoFile)
      const videoUrl = await uploadPublicFile(
        'portfolio-photos',
        `portfolio/${data.userId}/videos`,
        preparedVideo
      )
      const videoUrls = uniqueValues([...profileVideoUrls, videoUrl]).slice(0, 4)
      await invokeAccountFunction('tailor-profile-action', {
        action: 'update-portfolio-videos',
        videoUrls,
      })
      setVideoFile(null)
      if (videoFileRef.current) videoFileRef.current.value = ''
      setSuccess('Portfolio video added.')
      onRefresh()
    } catch (cause) {
      setVideoError(friendlyActionError(cause, 'Portfolio video could not save.'))
    } finally {
      setBusy(null)
    }
  }

  async function deletePortfolioVideo(videoUrl: string) {
    setError(null)
    setSuccess(null)
    setBusy(`delete-video:${videoUrl}`)
    try {
      await invokeAccountFunction('tailor-profile-action', {
        action: 'update-portfolio-videos',
        videoUrls: profileVideoUrls.filter((url) => url !== videoUrl),
      })
      setSuccess('Portfolio video removed.')
      onRefresh()
    } catch (cause) {
      setVideoError(friendlyActionError(cause, 'Portfolio video could not be removed.'))
    } finally {
      setBusy(null)
    }
  }

  async function reorderPortfolioVideos(nextEntries: SortableMediaEntry[]) {
    const videoUrls = nextEntries.map((entry) => entry.url)
    setError(null)
    setSuccess(null)
    setBusy('reorder-videos')
    try {
      await invokeAccountFunction('tailor-profile-action', {
        action: 'update-portfolio-videos',
        videoUrls,
      })
      setSuccess('Portfolio video order updated.')
      onRefresh()
    } catch (videoError) {
      setError(friendlyActionError(videoError, 'Portfolio video order could not save.'))
    } finally {
      setBusy(null)
    }
  }

  async function reorderPortfolioItems(nextEntries: SortableMediaEntry[]) {
    const itemIds = nextEntries.map((entry) => entry.id)
    setError(null)
    setSuccess(null)
    setBusy('reorder-items')
    try {
      await invokeAccountFunction('portfolio-item-action', {
        action: 'reorder-items',
        itemIds,
      })
      setSuccess('Portfolio order updated.')
      onRefresh()
    } catch (portfolioError) {
      setError(friendlyActionError(portfolioError, 'Portfolio order could not save.'))
    } finally {
      setBusy(null)
    }
  }

  async function savePortfolioItem() {
    setError(null)
    setSuccess(null)
    if (!data.userId) return
    const editingItemId = detailItemId ?? editingId
    const leak = assertNoContactLeak(
      [title, category, description].join('\n'),
      "Portfolio items can't include contact details."
    )
    if (leak) {
      setError(leak)
      return
    }
    if (!title.trim()) {
      setError('Add a portfolio title.')
      return
    }
    if (!editingItemId && !file) {
      setError('Choose a portfolio image file before adding this item.')
      return
    }
    if (file) {
      const photoError = validateMessagePhoto(file)
      if (photoError) {
        setError(photoError)
        return
      }
    }
    setBusy('save')
    try {
      const imageUrl = file
        ? await uploadPublicFile(
            'portfolio-photos',
            `portfolio/${data.userId}`,
            await reencodeImageFile(file)
          )
        : (data.portfolioItems.find((entry) => entry.id === editingItemId)?.image_url ??
           editingItem?.image_url)
      if (!imageUrl) throw new Error('Choose a portfolio image file before adding this item.')
      await invokeAccountFunction(
        'portfolio-item-action',
        editingItemId
          ? {
              action: 'update-item',
              itemId: editingItemId,
              item: {
                imageUrl,
                title: title.trim(),
                category: category.trim() || null,
                description: description.trim() || null,
              },
            }
          : {
              action: 'create-item',
              item: {
                imageUrl,
                title: title.trim(),
                category: category.trim() || null,
                description: description.trim() || null,
              },
            }
      )
      setSuccess(editingItemId ? 'Piece details saved.' : 'Portfolio item added.')
      resetForm()
      setDetailItemId(null)
      onRefresh()
    } catch (portfolioError) {
      setError(friendlyActionError(portfolioError, 'Portfolio item could not save.'))
    } finally {
      setBusy(null)
    }
  }

  async function runPortfolioAction(action: 'delete-item' | 'set-cover', itemId: string) {
    setError(null)
    setSuccess(null)
    setBusy(`${action}:${itemId}`)
    try {
      await invokeAccountFunction('portfolio-item-action', { action, itemId })
      setSuccess(action === 'set-cover' ? 'Cover photo updated.' : 'Portfolio item deleted.')
      if (editingId === itemId) resetForm()
      onRefresh()
    } catch (portfolioError) {
      setError(friendlyActionError(portfolioError, 'Portfolio action could not finish.'))
    } finally {
      setBusy(null)
    }
  }

  // Upload handling for the single portfolio uploader.
  //
  // Files upload the moment they are chosen. The old screen made the tailor fill
  // a title, pick a file, then press "Add portfolio item" — with a separate
  // picker and separate button for video — and said so in a three-step
  // instruction box. The instructions were a symptom; this removes the cause.
  async function handlePortfolioFiles(files: File[]) {
    if (!data.userId) return
    setError(null)
    setVideoError(null)
    setSuccess(null)

    const images = files.filter((file) => !file.type.startsWith('video/'))
    const videos = files.filter((file) => file.type.startsWith('video/'))
    const remainingVideoSlots = Math.max(0, 4 - profileVideoUrls.length)
    if (videos.length > remainingVideoSlots) {
      setVideoError(
        remainingVideoSlots === 0
          ? 'You already have 4 portfolio videos. Remove one to add another.'
          : `You can add ${remainingVideoSlots} more video${remainingVideoSlots === 1 ? '' : 's'}.`
      )
    }

    for (const file of images) {
      const uploadId = `pending-${crypto.randomUUID()}`
      setPendingUploads((current) => [
        ...current,
        { id: uploadId, name: file.name, kind: 'IMAGE', status: 'uploading' },
      ])
      try {
        const photoError = validateMessagePhoto(file)
        if (photoError) throw new Error(photoError)
        const imageUrl = await uploadPublicFile(
          'portfolio-photos',
          `portfolio/${data.userId}`,
          await reencodeImageFile(file)
        )
        await invokeAccountFunction('portfolio-item-action', {
          action: 'create-item',
          item: {
            imageUrl,
            // A title is never worth blocking an upload for. Seed it from the
            // file name and let her rename it in the details sheet.
            title: titleFromFileName(file.name),
            category: null,
            description: null,
          },
        })
        setPendingUploads((current) => current.filter((entry) => entry.id !== uploadId))
        onRefresh()
      } catch (cause) {
        setPendingUploads((current) =>
          current.map((entry) =>
            entry.id === uploadId
              ? {
                  ...entry,
                  status: 'failed',
                  errorMessage: friendlyActionError(cause, 'This photo could not upload.'),
                }
              : entry
          )
        )
      }
    }

    for (const file of videos.slice(0, remainingVideoSlots)) {
      const uploadId = `pending-${crypto.randomUUID()}`
      setPendingUploads((current) => [
        ...current,
        { id: uploadId, name: file.name, kind: 'VIDEO', status: 'uploading' },
      ])
      try {
        const prepared = await preparePortfolioVideoFile(file)
        const uploaded = await uploadPublicFileWithLocation(
          'portfolio-photos',
          `portfolio/${data.userId}/videos`,
          prepared
        )
        const videoUrl = uploaded.publicUrl
        // Best effort: a missing poster only means the tile decodes its own
        // frame, so a failure here must never fail the upload.
        try {
          const poster = await captureVideoPosterBlob(prepared)
          if (poster) {
            await createClient()
              .storage.from(uploaded.bucket)
              .upload(`${uploaded.path}${VIDEO_POSTER_SUFFIX}`, poster, {
                contentType: 'image/jpeg',
                cacheControl: MEDIA_CACHE_CONTROL_SECONDS.publicImmutable,
                upsert: true,
              })
          }
        } catch {
          // Ignored on purpose.
        }
        await invokeAccountFunction('tailor-profile-action', {
          action: 'update-portfolio-videos',
          videoUrls: uniqueValues([...profileVideoUrls, videoUrl]).slice(0, 4),
        })
        setPendingUploads((current) => current.filter((entry) => entry.id !== uploadId))
        onRefresh()
      } catch (cause) {
        setPendingUploads((current) =>
          current.map((entry) =>
            entry.id === uploadId
              ? {
                  ...entry,
                  status: 'failed',
                  errorMessage: friendlyActionError(cause, 'This video could not upload.'),
                }
              : entry
          )
        )
      }
    }
  }

  const savedImageItems: OnboardingMediaItem[] = data.portfolioItems
    .filter((item) => Boolean(item.image_url))
    .map((item, index) => ({
      id: item.id,
      kind: 'IMAGE' as const,
      previewUrl: safeMediaUrl(item.image_url, 'portfolio-photos') ?? item.image_url,
      status: 'added' as const,
      title: safeUserText(item.title, `Piece ${index + 1}`),
    }))
  const savedVideoItems: OnboardingMediaItem[] = profileVideoUrls.map((url, index) => {
    const safeUrl = safeMediaUrl(url, 'portfolio-photos') ?? url
    return {
      id: `video:${url}`,
      kind: 'VIDEO' as const,
      previewUrl: safeUrl,
      posterUrl: posterUrlForVideo(safeUrl),
      status: 'added' as const,
      title: `Video ${index + 1}`,
    }
  })
  const pendingItems: OnboardingMediaItem[] = pendingUploads.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    previewUrl: null,
    status: entry.status,
    title: entry.name,
    errorMessage: entry.errorMessage,
  }))
  const uploaderItems = [...savedImageItems, ...savedVideoItems, ...pendingItems]
  const detailItem = data.portfolioItems.find((item) => item.id === detailItemId) ?? null

  return (
    <Surface className="overflow-hidden">
      {portfolioInspectIndex != null ? (
        <MediaInspectionOverlay
          entries={portfolioItemEntries}
          initialIndex={portfolioInspectIndex}
          onClose={() => setPortfolioInspectIndex(null)}
        />
      ) : null}
      <SurfaceHeader
        eyebrow="Portfolio"
        title="Your work"
        description="The photos and clips customers look at before they choose you."
      />
      {/* `grid-cols-[minmax(0,1fr)]` keeps this column from growing to the width
          of its widest child. Without it the presentation editor's horizontal
          asset strip stretched the whole panel, and the Surface's overflow-hidden
          then sliced the tiles and headings off at the right edge. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5">
        <ActionNotice error={error} success={success} />

        <MediaUploadField
          items={uploaderItems}
          requiredCount={1}
          maxItems={12}
          maxVideos={4}
          maxVideoSeconds={PORTFOLIO_VIDEO_MAX_SECONDS}
          label="Photos and videos"
          emptyHint="Add at least one real photo or video of work you made."
          busy={Boolean(busy)}
          onSelectFiles={(files) => {
            void handlePortfolioFiles(files)
          }}
          onRetry={(id) => setPendingUploads((current) => current.filter((entry) => entry.id !== id))}
          onRemove={(id) => {
            if (id.startsWith('pending-')) {
              setPendingUploads((current) => current.filter((entry) => entry.id !== id))
              return
            }
            if (id.startsWith('video:')) {
              void deletePortfolioVideo(id.slice('video:'.length))
              return
            }
            void runPortfolioAction('delete-item', id)
          }}
          onMakeCover={(id) => {
            if (id.startsWith('pending-') || id.startsWith('video:')) return
            void runPortfolioAction('set-cover', id)
          }}
          onMove={(id, direction) => {
            if (id.startsWith('pending-')) return
            if (id.startsWith('video:')) {
              const url = id.slice('video:'.length)
              const from = profileVideoUrls.indexOf(url)
              const to = from + direction
              if (from < 0 || to < 0 || to >= profileVideoUrls.length) return
              void reorderPortfolioVideos(
                moveMediaEntry(profileVideoEntries, from, to)
              )
              return
            }
            const from = portfolioItemEntries.findIndex((entry) => entry.id === id)
            const to = from + direction
            if (from < 0 || to < 0 || to >= portfolioItemEntries.length) return
            void reorderPortfolioItems(moveMediaEntry(portfolioItemEntries, from, to))
          }}
          onOpenDetails={(id) => {
            if (id.startsWith('pending-') || id.startsWith('video:')) return
            const item = data.portfolioItems.find((entry) => entry.id === id)
            if (!item) return
            setDetailItemId(id)
            setTitle(item.title ?? '')
            setCategory(item.category ?? '')
            setDescription(item.description ?? '')
          }}
        />

        {videoError ? (
          <p
            role="alert"
            className="rounded-[8px] border border-rust/25 bg-rust/8 px-3 py-2 text-sm font-medium leading-6 text-rust-700"
          >
            {videoError}
          </p>
        ) : null}

        {/* Presentation controls describe media that exists, so they appear
            underneath it — not above the uploader, where they used to sit
            explaining that they would "unlock" later. */}
        {data.portfolioMedia.length > 0 ? (
          <MediaPresentationEditor media={data.portfolioMedia} onRefresh={onRefresh} />
        ) : null}
      </div>

      {detailItem ? (
        <div
          className="fixed inset-0 z-[130] grid items-end bg-black/40 sm:place-items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetailItemId(null)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Portfolio piece details"
            className="grid w-full gap-4 rounded-t-[20px] bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-[16px] sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-xl font-semibold text-ink">Piece details</h3>
              <button
                type="button"
                aria-label="Close details"
                onClick={() => setDetailItemId(null)}
                className="grid size-9 place-items-center rounded-full bg-bone text-ink hover:bg-ink/10"
              >
                <X className="size-4" />
              </button>
            </div>
            <Field label="Title">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="Category" hint="Optional. Helps customers browse your work.">
              <Input value={category} onChange={(event) => setCategory(event.target.value)} />
            </Field>
            <Field label="Description" hint="Optional. Fabric, cut, or the occasion it was made for.">
              <Textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  void savePortfolioItem()
                }}
                disabled={busy === 'save'}
              >
                {busy === 'save' ? 'Saving…' : 'Save details'}
              </Button>
              <Button variant="secondary" onClick={() => setDetailItemId(null)}>
                Cancel
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </Surface>
  )
}
