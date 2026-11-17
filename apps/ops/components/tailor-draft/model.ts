export type Profile = {
  display_name?: string
  business_name?: string | null
  bio?: string | null
  location?: string
  languages?: string[]
  specialty_tags?: string[]
  currency?: string
  price_range_min?: number
  price_range_max?: number
  lifecycle_state?: string
}

export type Media = {
  id: string
  media_kind: string
  content_type: string
  sort_order: number
  is_cover: boolean
  focal_x: number | null
  focal_y: number | null
  moderation_status: string
  confirmed_at: string | null
  preview_url?: string | null
  duration_ms?: number | null
}

export type Draft = {
  id: string
  status: string
  created_at?: string
  updated_at?: string
  expires_at: string | null
  approved_at?: string | null
  approval_reason?: string | null
  evidence_ref?: string | null
  marketplace_placement?: string | null
  tailor_profile_id: string
  tailor_profiles: Profile | null
  tailor_draft_media?: Media[]
  approved_by_label?: string | null
  created_by_label?: string | null
}

export type UploadChoice = {
  file: File
  kind: 'AVATAR' | 'PHOTO' | 'VIDEO'
  key: string
  error?: string
}

export const replayKey = () => crypto.randomUUID() + crypto.randomUUID()

export const formatDraftDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value)
      )
    : 'Not yet'

export function claimWebOrigin() {
  if (typeof window === 'undefined') return ''
  const configured = process.env.NEXT_PUBLIC_CLAIM_WEB_ORIGIN?.trim().replace(/\/+$/u, '')
  if (configured) return configured
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://127.0.0.1:3004'
    : ''
}

export async function sanitizeDraftUpload(file: File) {
  if (!file.type.startsWith('image/')) return file
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, file.type, file.type === 'image/png' ? undefined : 0.92)
  )
  if (!blob)
    throw new Error(
      'This photo could not be prepared. Export it without location data and try again.'
    )
  return new File([blob], file.name, { type: file.type, lastModified: Date.now() })
}

export async function digestDraftUpload(file: Blob) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')
}
