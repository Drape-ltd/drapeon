'use client'

import Link from 'next/link'
import type { Route } from 'next'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, MapPin, Share2, Star } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { friendlyActionError } from '@drape/shared/action-errors'
import { normalizePhoneForStorage, deriveTailorSetupProgress, formatMoney, validatePhoneForProfile, TailorSetupStep } from '@drape/shared'
import { safeEntityName } from '../../../lib/safe-display'
import type { ProfileRenderData, SettingsRenderData } from '../shared/account-data-contracts'
import { invokeAccountFunction, stringList } from '../shared/account-data-queries'
import { ActionNotice, EmptyState, reencodeImageFile, safeMediaUrl } from '../messages/account-messages-surface'
import { OpenAppButton } from '../../../components/open-app-button'
import { Button } from '../../../components/ui/button'
import { OnboardingPhoneField } from '../tailor-onboarding/onboarding-phone-field'
import { TrustBlockedNotice, OnboardingOutstandingItem } from '../tailor-onboarding/onboarding-progress'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { minorUnitsInput, uploadPublicFile } from '../orders/account-order-actions'
import { payoutStatusLabel } from '../payouts/account-payout-surfaces'
import { SellerItemManager, deriveWebTailorReadiness } from '../shop/account-shop-surface'
import { IdentityHandoffCard, PROFILE_IMAGE_REJECTION_MESSAGE, TAILOR_SETUP_DRAFT_VERSION, isInvalidProfileImageRejected, tailorWebSetupDraftKey } from './identity-handoff-card'
import { MESSAGE_PHOTO_CONTENT_TYPES, PortfolioManager } from './portfolio-manager'
import { TailorSellingSetupEditor } from './tailor-selling-setup-editor'

const AVATAR_MAX_BYTES = 10 * 1024 * 1024

function isHeicFile(file: File) {
  const type = file.type.toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  return /\.(heic|heif)$/iu.test(file.name)
}

/**
 * Validation written for profile photos.
 *
 * This used to borrow `validateMessagePhoto`, so a tailor picking a photo for
 * her own profile was told to "choose a JPEG, PNG, or WebP image" in wording
 * meant for chat attachments — and an ordinary iPhone photo (HEIC) was rejected
 * without saying what to do about it.
 */
function validateAvatarFile(file: File) {
  if (file.size > AVATAR_MAX_BYTES) {
    return 'That photo is over 10 MB. Choose a smaller one, or take a new photo at a lower resolution.'
  }
  const type = file.type.toLowerCase()
  if (isHeicFile(file)) return null
  if (!MESSAGE_PHOTO_CONTENT_TYPES.has(type)) {
    return 'That file is not a photo Drapeon can read. Choose a JPG, PNG, WebP, or an iPhone photo.'
  }
  return null
}

function avatarPrepareErrorMessage(file: File) {
  if (isHeicFile(file)) {
    // Safari decodes HEIC; Chrome and Firefox do not. iOS normally converts on
    // pick, so this is mostly a desktop path — say what actually works.
    return 'This browser cannot open iPhone HEIC photos. Send yourself the photo as JPEG, or add it from your phone.'
  }
  return 'That photo could not be prepared. Try a different one.'
}

export function AvatarUploadPanel({
  data,
  session,
  onRefresh,
  onPendingChange,
}: {
  data: Pick<SettingsRenderData, 'userId' | 'customerProfile' | 'tailorProfile'>
  session: Session | null
  onRefresh: () => void
  onPendingChange?: (pending: boolean) => void
}) {
  const role = data.tailorProfile ? 'TAILOR' : 'CUSTOMER'
  const currentAvatar = safeMediaUrl(
    data.tailorProfile?.avatar_url ?? data.customerProfile?.avatar_url,
    'avatars'
  )
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const avatarReviewKey = `${data.tailorProfile?.avatar_url ?? ''}:${data.tailorProfile?.id_verification_rejected_at ?? ''}:${data.tailorProfile?.id_verification_status ?? ''}`
  const [localRejectedAvatarState, setLocalRejectedAvatarState] = useState<{
    key: string
    cleared: boolean
  } | null>(null)
  const avatarPreviewKey = `${data.userId ?? ''}:${role}`
  const [savedAvatarPreview, setSavedAvatarPreview] = useState<{ key: string; url: string } | null>(
    null
  )
  const fileRef = useRef<HTMLInputElement | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const savedAvatarUrl =
    savedAvatarPreview?.key === avatarPreviewKey ? savedAvatarPreview.url : null
  const displayAvatar = previewUrl ?? savedAvatarUrl ?? currentAvatar
  const profileImageRejectedFromData = data.tailorProfile
    ? isInvalidProfileImageRejected(data.tailorProfile)
    : false
  const localRejectedAvatarCleared =
    localRejectedAvatarState?.key === avatarReviewKey ? localRejectedAvatarState.cleared : false
  const profileImageRejected = profileImageRejectedFromData && !localRejectedAvatarCleared

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [])

  function setSelectedAvatarFile(nextFile: File | null) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setFile(nextFile)
    onPendingChange?.(Boolean(nextFile))
    if (!nextFile) {
      setPreviewUrl(null)
      return
    }
    if (profileImageRejectedFromData)
      setLocalRejectedAvatarState({ key: avatarReviewKey, cleared: true })
    const nextPreviewUrl = URL.createObjectURL(nextFile)
    previewUrlRef.current = nextPreviewUrl
    setPreviewUrl(nextPreviewUrl)
  }

  /**
   * Chosen means saved.
   *
   * The photo used to sit as a local preview until a separate "Save profile
   * photo" click, which the screen had to explain in a three-step list — and
   * which tailors still missed, then hit "photo selected but not saved yet" on
   * the next step.
   */
  async function saveAvatar(selected?: File | null) {
    setError(null)
    setSuccess(null)
    const target = selected ?? file
    if (!data.userId || !target) {
      setError('Choose a profile photo first.')
      return
    }
    const photoError = validateAvatarFile(target)
    if (photoError) {
      setError(photoError)
      setSelectedAvatarFile(null)
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setBusy(true)
    try {
      let prepared: File
      try {
        prepared = await reencodeImageFile(target)
      } catch {
        throw new Error(avatarPrepareErrorMessage(target))
      }
      const avatarUrl = await uploadPublicFile('avatars', data.userId, prepared)
      await invokeAccountFunction('account-profile-action', {
        action: 'update-avatar',
        role,
        avatarUrl,
      })
      setSavedAvatarPreview({
        key: avatarPreviewKey,
        url: safeMediaUrl(avatarUrl, 'avatars') ?? avatarUrl,
      })
      setSelectedAvatarFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setSuccess(
        profileImageRejectedFromData
          ? 'Profile photo replacement submitted for review.'
          : 'Profile photo updated.'
      )
      setLocalRejectedAvatarState({ key: avatarReviewKey, cleared: true })
      onRefresh()
    } catch (avatarError) {
      setError(friendlyActionError(avatarError, 'Profile photo could not update.'))
      // Drop the local preview: a file the browser could not decode renders as a
      // broken image, which looks like the upload half-worked.
      setSelectedAvatarFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } finally {
      setBusy(false)
    }
  }

  return (
    <Surface
      id="profile-photo"
      className={profileImageRejected ? 'border-rust/24 bg-rust/8 p-5' : 'p-5'}
    >
      <div className="grid gap-5 md:grid-cols-[120px_1fr] md:items-center">
        <div
          className={
            profileImageRejected
              ? 'relative h-28 w-28 overflow-hidden rounded-[8px] border-2 border-rust bg-bone ring-4 ring-rust/12'
              : 'relative h-28 w-28 overflow-hidden rounded-[8px] border border-ink/8 bg-bone'
          }
        >
          {displayAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayAvatar}
              alt={previewUrl ? 'Selected profile preview' : 'Current profile'}
              className="h-full w-full object-cover"
            />
          ) : null}
          {profileImageRejected ? (
            <span className="absolute inset-x-2 bottom-2 rounded-full bg-rust px-2 py-1 text-center text-[0.68rem] font-semibold text-white">
              Rejected / Invalid
            </span>
          ) : previewUrl ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-ink/72 px-2 py-1 text-[0.68rem] font-semibold text-white">
              Preview
            </span>
          ) : null}
        </div>
        <div className="grid gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
            Profile photo
          </p>
          <h2 className="text-xl font-semibold text-ink">
            {profileImageRejected ? 'Replace rejected avatar' : 'Update avatar'}
          </h2>
          <p className="text-sm leading-6 text-ink/64">
            A clear photo of you or your shopfront. Customers see it on your profile, in messages,
            and on every order. It saves as soon as you choose it.
          </p>
          {profileImageRejected ? (
            <div className="rounded-[8px] border border-rust/20 bg-white p-4 text-sm leading-6 text-rust">
              {PROFILE_IMAGE_REJECTION_MESSAGE}
            </div>
          ) : null}
          <ActionNotice error={error} success={success} />
          {busy ? (
            <p role="status" className="text-sm font-semibold leading-6 text-needle">
              Saving your photo…
            </p>
          ) : null}
          <input
            ref={fileRef}
            id="profile-photo-input"
            type="file"
            // HEIC is the iPhone default. iOS converts on pick when JPEG is
            // offered; listing it anyway means a HEIC that reaches us gets a
            // real explanation instead of "not a supported format".
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null
              setError(null)
              setSuccess(null)
              setSelectedAvatarFile(chosen)
              if (chosen) void saveAvatar(chosen)
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="w-fit"
            >
              {busy ? 'Saving…' : displayAvatar ? 'Change photo' : 'Add photo'}
            </Button>
            <span className="text-xs leading-5 text-ink/52">JPG, PNG, WebP or an iPhone photo</span>
          </div>
        </div>
      </div>
    </Surface>
  )
}

export function RenderProfile({
  data,
  session,
  onRefresh,
}: {
  data: ProfileRenderData
  session: Session | null
  onRefresh: () => void
}) {
  const [copied, setCopied] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const setupFlow = searchParams.get('setup') === '1'
  const requestedSetupStep = Number(searchParams.get('step'))
  const [setupStep, setSetupStep] = useState<0 | 1 | 2 | 3>(
    requestedSetupStep === 1 || requestedSetupStep === 2 || requestedSetupStep === 3
      ? requestedSetupStep
      : 0
  )
  const [setupError, setSetupError] = useState<string | null>(null)
  const profile = data.tailorProfile
  if (!profile) {
    return (
      <EmptyState
        title="Tailor profile not found."
        body="Customer accounts can still use orders, messages, measurements, and saved items. Tailor profile editing appears after tailor access is approved and setup is started."
        action={
          <Link href="/account/choose-role?next=%2Faccount%2Fprofile%3Fsetup%3D1" className="font-semibold text-needle">
            Apply as a tailor
          </Link>
        }
      />
    )
  }
  const setupProfile = profile

  const profileId = profile.id
  async function handleShareProfile() {
    const url = `https://drapeon.co/tailors/${profileId}`
    const shareData = {
      title: `${setupProfile.display_name || setupProfile.business_name || 'My profile'} on Drapeon`,
      text: 'Explore my work and request custom clothing through Drapeon.',
      url,
    }
    try {
      if (navigator.share) {
        await navigator.share(shareData)
        return
      }
      await navigator.clipboard?.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      await navigator.clipboard?.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const availPillStyle =
    profile.availability === 'OPEN'
      ? 'bg-bone text-ink'
      : profile.availability === 'LIMITED'
        ? 'bg-amber-400/15 text-amber-700'
        : 'bg-rust/10 text-rust'
  const availText =
    profile.availability === 'OPEN'
      ? 'Available'
      : profile.availability === 'LIMITED'
        ? 'Limited'
        : 'Fully booked'
  const readiness = deriveWebTailorReadiness(profile)
  const identityStatus = profile.id_verification_status ?? 'NOT_SUBMITTED'
  const trustReviewSubmitted = readiness.identityVerified || identityStatus === 'PENDING'
  const identityLabel = readiness.identityVerified
    ? 'Verified'
    : identityStatus === 'PENDING'
      ? 'In review'
      : identityStatus === 'REJECTED'
        ? 'Needs resubmission'
        : 'Not submitted'

  const normalizedSellerType =
    profile.seller_type === 'BOUTIQUE' || profile.seller_type === 'TAILOR_SHOP'
      ? profile.seller_type
      : 'TAILOR'
  const businessTypeLabel =
    normalizedSellerType === 'BOUTIQUE'
      ? 'Boutique'
      : normalizedSellerType === 'TAILOR_SHOP'
        ? 'Tailor shop'
        : 'Tailor'
  const priceGuideLabel =
    profile.price_range_min && profile.price_range_max
      ? `${formatMoney(profile.price_range_min, profile.currency)}–${formatMoney(profile.price_range_max, profile.currency)}`
      : 'Price needed'
  const portfolioProofCount =
    data.portfolioItems.filter((item) => Boolean(item.image_url)).length +
    stringList(profile.portfolio_video_urls).length
  const readyMadeProofCount = data.sellerItems.length
  const proofChecklistLabel =
    normalizedSellerType === 'BOUTIQUE'
      ? 'Ready-made listing'
      : normalizedSellerType === 'TAILOR_SHOP'
        ? 'Portfolio + ready-made item'
        : 'Portfolio sample'
  const proofChecklistValue =
    normalizedSellerType === 'BOUTIQUE'
      ? readyMadeProofCount > 0
        ? `${readyMadeProofCount} ready-made item${readyMadeProofCount === 1 ? '' : 's'}`
        : 'Needed'
      : normalizedSellerType === 'TAILOR_SHOP'
        ? portfolioProofCount > 0 && readyMadeProofCount > 0
          ? [`${portfolioProofCount} portfolio`, `${readyMadeProofCount} ready-made`].join(' · ')
          : portfolioProofCount > 0
            ? 'Need ready-made item'
            : readyMadeProofCount > 0
              ? 'Need portfolio sample'
              : 'Needed'
        : portfolioProofCount > 0
          ? `${portfolioProofCount} portfolio item${portfolioProofCount === 1 ? '' : 's'}`
          : 'Needed'
  const sellingSetupRows = [
    {
      label: 'Contact + public profile',
      value: readiness.profileCompleted ? 'Complete' : 'Setup in progress',
    },
    { label: 'Business type + pricing', value: `${businessTypeLabel} · ${priceGuideLabel}` },
    { label: proofChecklistLabel, value: proofChecklistValue },
    {
      label: 'Identity & payout readiness',
      value: `${identityLabel} · ${payoutStatusLabel(profile)}`,
    },
  ]

  function currentSetupProgress(options?: {
    includeDraft?: boolean
    idDocumentPresent?: boolean
  }) {
    let draft: Record<string, unknown> = {}
    if (data.userId && options?.includeDraft !== false) {
      try {
        const stored = window.localStorage.getItem(tailorWebSetupDraftKey(data.userId))
        const parsed = stored ? JSON.parse(stored) as Record<string, unknown> : null
        if (parsed?.version === TAILOR_SETUP_DRAFT_VERSION) draft = parsed
      } catch {
        draft = {}
      }
    }

    const draftString = (key: string, fallback: string) =>
      typeof draft[key] === 'string' ? String(draft[key]) : fallback
    const draftStrings = (key: string, fallback: string[]) =>
      Array.isArray(draft[key])
        ? (draft[key] as unknown[]).filter((value): value is string => typeof value === 'string')
        : fallback
    const draftBoolean = (key: string, fallback: boolean) =>
      typeof draft[key] === 'boolean' ? Boolean(draft[key]) : fallback
    const phone = normalizePhoneForStorage(String(session?.user.user_metadata?.phone ?? ''))
    const setupSellerType = draftString('sellerType', normalizedSellerType)

    const persistedProfilePhotoPresent = Boolean(safeMediaUrl(setupProfile.avatar_url, 'avatars'))
    const progress = deriveTailorSetupProgress({
      displayName: draftString('displayName', setupProfile.display_name || setupProfile.business_name || ''),
      phone,
      phoneError: phone ? validatePhoneForProfile(phone) : null,
      profilePhotoPresent: persistedProfilePhotoPresent,
      location: draftString('location', setupProfile.location ?? ''),
      bio: draftString('bio', setupProfile.bio ?? ''),
      languages: draftStrings('languages', stringList(setupProfile.languages)),
      specialties: draftStrings('specialties', stringList(setupProfile.specialty_tags)),
      priceMin: draftString('priceMin', setupProfile.price_range_min ? minorUnitsInput(setupProfile.price_range_min) : ''),
      priceMax: draftString('priceMax', setupProfile.price_range_max ? minorUnitsInput(setupProfile.price_range_max) : ''),
      currency: draftString('currency', setupProfile.currency ?? 'USD'),
      portfolioItemCount: data.portfolioItems.filter((item) => Boolean(item.image_url)).length + stringList(setupProfile.portfolio_video_urls).length,
      readyMadeItemCount: data.sellerItems.length,
      sellerType: setupSellerType,
      supportsCustomOrders: draftBoolean('supportsCustomOrders', setupProfile.supports_custom_orders !== false),
      supportsReadyMade: draftBoolean('supportsReadyMade', setupProfile.supports_ready_made === true),
      pickupAvailable: draftBoolean('pickupAvailable', setupProfile.pickup_available === true),
      deliveryAvailable: draftBoolean('deliveryAvailable', setupProfile.delivery_available === true),
      shippingAvailable: draftBoolean('shippingAvailable', setupProfile.shipping_available === true),
      pickupAddress: draftString('pickupAddress', data.pickupDetails?.pickup_address ?? ''),
      idDocumentPresent:
        options?.idDocumentPresent ??
        // Derived from the review status, which the client may read; the
        // storage path column itself is service-role only.
        trustReviewSubmitted,
    })
    // The photo now uploads the moment it is chosen, so there is no "selected
    // but unsaved" state left to warn about.
    return progress
  }

  function openSetupStep(target: TailorSetupStep) {
    const showStep = (step: TailorSetupStep) => {
      setSetupStep(step)
      router.replace(`/account/profile?setup=1&step=${step}` as Route, { scroll: false })
    }
    if (target > setupStep) {
      const progress = currentSetupProgress()
      const blocked = ([0, 1, 2, 3] as TailorSetupStep[])
        .filter((step) => step < target)
        .find((step) => !progress.stepValid[step])
      if (blocked != null) {
        const message = Object.values(progress.stepErrors[blocked])[0]
        showStep(blocked)
        setSetupError(message ?? 'Complete this section before continuing.')
        // The notice renders at the top of the step while Continue sits at the
        // bottom, so pressing a blocked Continue looked like a dead button.
        // Bring the reason into view and give it focus.
        window.setTimeout(() => {
          const notice = document.getElementById('tailor-setup-error')
          notice?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          notice?.focus({ preventScroll: true })
        }, 60)
        return
      }
    }
    setSetupError(null)
    showStep(target)
  }

  function openProfilePhotoReplacement() {
    setSetupError(null)
    setSetupStep(0)
    router.replace('/account/profile?setup=1&step=0#profile-photo' as Route, { scroll: false })
    window.setTimeout(() => {
      const photoSection = document.getElementById('profile-photo')
      photoSection?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      photoSection?.querySelector<HTMLInputElement>('input[type="file"]')?.focus()
    }, 100)
  }

  function openPortfolioReplacement() {
    setSetupError(null)
    setSetupStep(2)
    router.replace('/account/profile?setup=1&step=2#portfolio' as Route, { scroll: false })
    window.setTimeout(() => {
      document.getElementById('portfolio')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  const setupSellerType = (() => {
    if (!setupFlow || !data.userId || typeof window === 'undefined') return normalizedSellerType
    try {
      const stored = window.localStorage.getItem(tailorWebSetupDraftKey(data.userId))
      const parsed = stored ? JSON.parse(stored) as Record<string, unknown> : null
      const draftSellerType = parsed?.version === TAILOR_SETUP_DRAFT_VERSION
        ? parsed.sellerType
        : null
      return draftSellerType === 'BOUTIQUE' || draftSellerType === 'TAILOR_SHOP'
        ? draftSellerType
        : 'TAILOR'
    } catch {
      return normalizedSellerType
    }
  })()

  if (setupFlow) {
    const persistedSetupBeforeTrust = currentSetupProgress({
      includeDraft: false,
      idDocumentPresent: true,
    })
    const outstandingSetupItems: OnboardingOutstandingItem[] = (() => {
    const progress = currentSetupProgress()
    return ([0, 1, 2, 3] as TailorSetupStep[]).flatMap((step) =>
      Object.entries(progress.stepErrors[step])
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        // The trust video is the thing this list stands in front of. Listing it
        // as a prerequisite for recording it reads as a loop.
        .filter(([field]) => field !== 'idDocument')
        .map(([field, message]) => ({ step, field, message }))
    )
  })()

  const setupSavedForTrust = ([0, 1, 2, 3] as TailorSetupStep[]).every(
      (step) => persistedSetupBeforeTrust.stepValid[step],
    )
    const sections = [
      {
        title: 'Your identity',
        body: 'Build the public profile customers use to recognize and understand your studio.',
      },
      {
        title: 'What you make',
        body: 'Choose the same controlled specialties, business type, currency, and price guide used in the app.',
      },
      {
        title:
          setupSellerType === 'BOUTIQUE'
            ? 'Ready-made proof'
            : setupSellerType === 'TAILOR_SHOP'
              ? 'Portfolio + ready-made proof'
              : 'Portfolio',
        body:
          setupSellerType === 'BOUTIQUE'
            ? 'Add the ready-made work that proves what customers can buy.'
            : setupSellerType === 'TAILOR_SHOP'
              ? 'Add a real work sample and one ready-made item for setup review.'
              : 'Add at least one real work sample and control how every image is framed.',
      },
      {
        title: 'Setup & verification',
        body: 'Confirm order modes, handoff options, consultation policy, and the private randomized trust video.',
      },
    ] as const
    const active = sections[setupStep]

    return (
      <div className="grid gap-5">
        <Surface className="p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">
                Tailor setup · {setupStep + 1} of 4
              </p>
              <h2 className="mt-2 text-3xl text-ink">{active.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/62">{active.body}</p>
            </div>
          </div>
          <div className="mt-5 flex gap-2" aria-label={`Tailor setup step ${setupStep + 1} of 4`}>
            {sections.map((section, index) => (
              <button
                key={section.title}
                type="button"
                aria-label={`Open step ${index + 1}: ${section.title}`}
                aria-current={setupStep === index ? 'step' : undefined}
                onClick={() => openSetupStep(index as TailorSetupStep)}
                className={`h-1.5 flex-1 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/30 ${index === setupStep ? 'bg-needle' : 'bg-ink/12'}`}
              />
            ))}
          </div>
          {setupError ? (
            <p
              id="tailor-setup-error"
              tabIndex={-1}
              role="alert"
              className="mt-4 rounded-[8px] border border-rust/30 bg-rust/8 px-4 py-3 text-sm font-medium leading-6 text-rust-700 outline-none"
            >
              {setupError}
            </p>
          ) : null}
        </Surface>

        {setupStep === 0 ? (
          <>
            <AvatarUploadPanel
              data={{ userId: data.userId, tailorProfile: profile, customerProfile: null }}
              session={session}
              onRefresh={onRefresh}
            />
            {/* The phone is set and confirmed here, in the step that requires
                it. The previous "Update" link pointed at /account/settings,
                which the account runtime redirects back to setup while the
                profile is incomplete — so it looped, and the change behind it
                needed a password a social-signup tailor never had. */}
            <Surface className="p-4">
              <OnboardingPhoneField
                session={session}
                displayName={setupProfile.display_name || setupProfile.business_name || ''}
                role="TAILOR"
                onSaved={onRefresh}
              />
            </Surface>
          </>
        ) : null}

        {setupStep === 2 ? (
          <>
            {setupSellerType !== 'BOUTIQUE' ? (
              <PortfolioManager data={data} onRefresh={onRefresh} />
            ) : null}
            {setupSellerType !== 'TAILOR' ? (
              <SellerItemManager data={data} onRefresh={onRefresh} onboardingProofMode />
            ) : null}
          </>
        ) : (
          <Surface className="px-5 pb-5">
            <TailorSellingSetupEditor data={data} onRefresh={onRefresh} focusSection={setupStep as 0 | 1 | 3} />
          </Surface>
        )}

        {setupStep === 3 ? (
          setupSavedForTrust || trustReviewSubmitted ? (
            <IdentityHandoffCard
              userId={data.userId}
              profile={profile}
              onRefresh={onRefresh}
              onReplaceProfilePhoto={openProfilePhotoReplacement}
              onUpdatePortfolio={openPortfolioReplacement}
            />
          ) : (
            // Every outstanding requirement, not just the first one. A tailor
            // used to be told a single missing detail at a time — and could
            // record a video only to be sent back for something unrelated.
            <TrustBlockedNotice
              outstanding={outstandingSetupItems}
              onOpenField={(item) => openSetupStep(item.step)}
            />
          )
        ) : null}

        {setupError ? (
          <p className="rounded-[8px] border border-rust/30 bg-rust/8 px-4 py-3 text-sm font-medium leading-6 text-rust-700">
            {setupError}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3 rounded-[8px] border border-ink/8 bg-white/84 p-3 shadow-sm">
          <Button
            variant="secondary"
            disabled={setupStep === 0}
            onClick={() => openSetupStep(Math.max(0, setupStep - 1) as TailorSetupStep)}
          >
            Back
          </Button>
          {setupStep < 3 ? (
            <Button onClick={() => openSetupStep(Math.min(3, setupStep + 1) as TailorSetupStep)}>
              Continue
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      {/* ── Hero card ── */}
      <Surface className="overflow-hidden">
        <div className="flex items-start gap-5 p-6 pb-4">
          {/* Avatar with live dot */}
          <div className="relative shrink-0">
            <div className="h-[76px] w-[76px] overflow-hidden rounded-full border border-ink/10 bg-needle/10">
              {safeMediaUrl(profile.avatar_url, 'avatars') ? (
                <Image
                  src={safeMediaUrl(profile.avatar_url, 'avatars') ?? ''}
                  alt=""
                  width={76}
                  height={76}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-bold text-needle">
                  {(profile.business_name || profile.display_name || '?')[0]?.toUpperCase() ?? '?'}
                </div>
              )}
            </div>
            <span
              className={`absolute left-1 top-1 h-3 w-3 rounded-full border-2 border-white ${profile.is_live ? 'bg-emerald-500' : 'bg-ink/30'}`}
            />
          </div>

          {/* Name, location, status pills */}
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="truncate text-2xl text-ink">
              {safeEntityName(profile.business_name || profile.display_name, 'Tailor profile')}
            </h2>
            {profile.location ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-ink/52">
                <MapPin className="size-3.5 shrink-0" />
                {profile.location}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip status={availText} className={availPillStyle} />
              <StatusChip status={profile.is_live ? 'LIVE' : 'NOT_LIVE'} />
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-px border-t border-ink/6 bg-ink/6">
          <div className="bg-white/84 px-4 py-3 text-center">
            <p className="text-xl font-semibold text-ink">
              {(profile.avg_rating ?? 0) > 0 ? (profile.avg_rating ?? 0).toFixed(1) : '—'}
            </p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink/48">
              <Star className="size-3 fill-current" /> Rating
            </p>
          </div>
          <div className="bg-white/84 px-4 py-3 text-center">
            <p className="text-xl font-semibold text-ink">{profile.total_reviews ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink/48">Reviews</p>
          </div>
          <div className="bg-white/84 px-4 py-3 text-center">
            <p className="text-xl font-semibold text-ink">{profile.total_orders ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink/48">Orders</p>
          </div>
        </div>
      </Surface>

      {/* ── Readiness ── */}
      <Surface
        className={`p-5 ${
          readiness.tone === 'success'
            ? 'border-needle/14 bg-needle/6'
            : readiness.tone === 'warning'
              ? 'border-amber-300/35 bg-amber-400/8'
              : 'border-ink/8 bg-white/84'
        }`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">
              Go-live status
            </p>
            <h3 className="mt-2 text-xl font-semibold text-ink">{readiness.title}</h3>
            <p className="mt-2 text-sm leading-6 text-ink/64">{readiness.body}</p>
          </div>
          {readiness.actionHref ? (
            <Button asChild className="shrink-0">
              <Link href={readiness.actionHref}>{readiness.actionLabel ?? 'Review'}</Link>
            </Button>
          ) : readiness.actionLabel ? (
            <OpenAppButton
              label={readiness.actionLabel}
              className="inline-flex shrink-0 justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
            />
          ) : null}
        </div>
      </Surface>

      {!readiness.identityVerified ? (
        <IdentityHandoffCard userId={data.userId} profile={profile} onRefresh={onRefresh} />
      ) : null}

      {/* ── Selling setup ── */}
      <Surface>
        <SurfaceHeader
          title="Go-live checklist"
          description="The profile, proof, identity, and payout gates that control customer access."
        />
        <div className="divide-y divide-ui-border px-5">
          {sellingSetupRows.map((row) => (
            <div
              key={row.label}
              className="grid gap-1 py-3 sm:grid-cols-[minmax(12rem,0.65fr)_minmax(0,1fr)] sm:items-start"
            >
              <span className="text-xs font-semibold text-ui-subtle">{row.label}</span>
              <span className="break-words text-sm font-semibold text-ink sm:text-right">
                {row.value}
              </span>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5">
          <TailorSellingSetupEditor data={data} onRefresh={onRefresh} />
        </div>
      </Surface>

      {/* ── Portfolio ── */}
      <PortfolioManager data={data} onRefresh={onRefresh} />

      {/* ── Action list ── */}
      <Surface className="overflow-hidden">
        {profile.is_live ? (
          <button
            type="button"
            onClick={handleShareProfile}
            className="flex min-h-[52px] w-full items-center justify-between gap-3 border-b border-ink/6 px-5 py-3.5 text-left text-sm font-semibold text-ink transition hover:bg-bone/60"
          >
            {copied ? 'Link copied!' : 'Share my live profile'}
            <Share2 className="size-4 text-ui-subtle" />
          </button>
        ) : null}
        <Link
          href="/account/payout"
          className="flex min-h-[52px] items-center justify-between gap-3 border-b border-ink/6 px-5 py-3.5 text-sm font-semibold text-ink transition hover:bg-bone/60"
        >
          Review payout setup
          <ChevronRight className="size-4 text-ui-subtle" />
        </Link>
        <Link
          href="/account/earnings"
          className="flex min-h-[52px] items-center justify-between gap-3 px-5 py-3.5 text-sm font-semibold text-ink transition hover:bg-bone/60"
        >
          View earnings
          <ChevronRight className="size-4 text-ui-subtle" />
        </Link>
      </Surface>

      {/* ── App-only trust steps ── */}
      <Surface className="border-needle/12 bg-needle/6 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">
          Trust steps
        </p>
        <p className="mt-2 text-sm leading-6 text-ink/66">
          Body scans, push permissions, and stronger reauth flows still work best in the app.
          Identity review now starts from this secure smartphone handoff.
        </p>
        <div className="mt-4">
          <OpenAppButton
            label="Open app trust flows"
            className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
          />
        </div>
      </Surface>
    </div>
  )
}
