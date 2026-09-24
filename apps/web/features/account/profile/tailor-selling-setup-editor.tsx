'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { MoneyInput } from '../../../components/money-input'
import { StructuredAddressSearch } from '../../../components/structured-address-search'
import { friendlyActionError } from '@drape/shared/action-errors'
import { TAILOR_LANGUAGE_GROUPS, TAILOR_SELLER_TYPE_OPTIONS, TAILOR_SPECIALTY_GROUPS, normalizeAccountCurrency, TAILOR_SETUP_VALIDATION } from '@drape/shared'
import { validateDisplayName } from '@drape/shared/contact-filter'
import type { ProfileRenderData } from '../shared/account-data-contracts'
import { invokeAccountFunction, stringList, uniqueValues } from '../shared/account-data-queries'
import { ActionNotice, assertNoContactLeak, parseMinorUnits } from '../messages/account-messages-surface'
import { Button } from '../../../components/ui/button'
import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { OnboardingField, useFieldHelp } from '../tailor-onboarding/onboarding-field'
import type { OnboardingHelpKey } from '../tailor-onboarding/help-content'
import { NativeSelect } from '../../../components/ui/native-select'
import { Switch } from '../../../components/ui/switch'
import { Textarea } from '../../../components/ui/textarea'
import { minorUnitsInput } from '../orders/account-order-actions'
import { isVerifiedIdentityStatus } from '../shop/account-shop-surface'
import { TAILOR_SETUP_DRAFT_VERSION, tailorWebSetupDraftKey } from './identity-handoff-card'

const SELLER_TYPE_WEB_OPTIONS = TAILOR_SELLER_TYPE_OPTIONS

function TailorSetupOptionPicker({
  label,
  values,
  groups,
  limit,
  onChange,
  helpKey,
}: {
  label: string
  values: string[]
  groups: readonly { label: string; items: readonly string[] }[]
  limit: number
  onChange: (values: string[]) => void
  helpKey?: OnboardingHelpKey
}) {
  const fieldHelp = useFieldHelp(label, helpKey)
  return (
    <div className="grid gap-2">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {label}
        {fieldHelp.button}
      </span>
      {fieldHelp.panel}
      <details className="group relative min-w-0">
        <summary className="flex h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-[8px] border border-ui-border bg-white px-3 text-sm outline-none marker:hidden focus:border-needle focus:ring-2 focus:ring-needle/15">
          <span className="truncate">
            {values.length
              ? `${values.length} selected · ${values.slice(0, 2).join(', ')}`
              : `Choose ${label.toLowerCase()}`}
          </span>
          <ChevronDown className="size-4 shrink-0 transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="relative z-40 mt-2 max-h-80 overflow-y-auto rounded-[8px] border border-ui-border bg-white p-2 shadow-xl md:absolute md:w-full md:min-w-[20rem]">
          {groups.map((group) => (
            <fieldset key={group.label} className="border-b border-ui-border py-2 last:border-0">
              <legend className="px-2 text-[0.68rem] font-semibold uppercase tracking-[.12em] text-ink/45">
                {group.label}
              </legend>
              <div className="mt-1 grid gap-0.5 sm:grid-cols-2">
                {group.items.map((option) => {
                  const active = values.includes(option)
                  const disabled = !active && values.length >= limit
                  return (
                    <label key={option} className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-sm hover:bg-ui-muted ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={active}
                        disabled={disabled}
                        onChange={() => onChange(active ? values.filter((value) => value !== option) : [...values, option])}
                      />
                      <span className={`grid size-5 place-items-center rounded-[5px] border ${active ? 'border-needle bg-needle text-white' : 'border-ui-border'}`}>
                        {active ? <Check className="size-3" aria-hidden="true" /> : null}
                      </span>
                      {option}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </details>
      {values.length ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <button key={value} type="button" onClick={() => onChange(values.filter((entry) => entry !== value))} className="rounded-full bg-needle/10 px-2.5 py-1 text-xs font-semibold text-needle">
              {value} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function TailorSellingSetupEditor({
  data,
  onRefresh,
  focusSection,
}: {
  data: ProfileRenderData
  onRefresh: () => void
  focusSection?: 0 | 1 | 3
}) {
  const profile = data.tailorProfile
  const [displayName, setDisplayName] = useState(
    profile?.display_name || profile?.business_name || ''
  )
  const [location, setLocation] = useState(profile?.location ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [languages, setLanguages] = useState(stringList(profile?.languages))
  const [specialties, setSpecialties] = useState(stringList(profile?.specialty_tags))
  const [currency, setCurrency] = useState(profile?.currency ?? 'USD')
  const [priceMin, setPriceMin] = useState(
    profile?.price_range_min ? minorUnitsInput(profile.price_range_min) : ''
  )
  const [priceMax, setPriceMax] = useState(
    profile?.price_range_max ? minorUnitsInput(profile.price_range_max) : ''
  )
  const [availability, setAvailability] = useState(
    profile?.availability === 'FULLY_BOOKED' || profile?.availability === 'LIMITED'
      ? profile.availability
      : 'OPEN'
  )
  const [sellerType, setSellerType] = useState(
    profile?.seller_type === 'BOUTIQUE' || profile?.seller_type === 'TAILOR_SHOP'
      ? profile.seller_type
      : 'TAILOR'
  )
  const [supportsCustomOrders, setSupportsCustomOrders] = useState(
    profile?.supports_custom_orders !== false
  )
  const [supportsReadyMade, setSupportsReadyMade] = useState(profile?.supports_ready_made === true)
  const [acceptsCustomOrdersNow, setAcceptsCustomOrdersNow] = useState(
    profile?.accepts_custom_orders_now !== false
  )
  const [shopPaused, setShopPaused] = useState(profile?.shop_paused === true)
  const [pickupAvailable, setPickupAvailable] = useState(profile?.pickup_available === true)
  const [deliveryAvailable, setDeliveryAvailable] = useState(profile?.delivery_available === true)
  const [shippingAvailable, setShippingAvailable] = useState(profile?.shipping_available === true)
  const [consultationMode, setConsultationMode] = useState(profile?.consultation_mode ?? 'FREE')
  const [consultationRequirement, setConsultationRequirement] = useState(
    profile?.consultation_requirement ?? 'OPTIONAL'
  )
  const [consultationFee, setConsultationFee] = useState(
    profile?.consultation_fee_amount ? minorUnitsInput(profile.consultation_fee_amount) : ''
  )
  const [consultationDuration, setConsultationDuration] = useState(
    String(profile?.consultation_duration_minutes ?? 30)
  )
  const [consultationCallType, setConsultationCallType] = useState(
    profile?.consultation_call_type ?? 'VIDEO'
  )
  const [consultationFeeCreditable, setConsultationFeeCreditable] = useState(
    profile?.consultation_fee_creditable === true
  )
  const [pickupAddress, setPickupAddress] = useState(data.pickupDetails?.pickup_address ?? '')
  const [pickupCity, setPickupCity] = useState(data.pickupDetails?.pickup_city ?? '')
  const [pickupRegion, setPickupRegion] = useState(data.pickupDetails?.pickup_region ?? '')
  const [pickupPostalCode, setPickupPostalCode] = useState(
    data.pickupDetails?.pickup_postal_code ?? ''
  )
  const [pickupCountryCode, setPickupCountryCode] = useState(
    data.pickupDetails?.pickup_country_code ?? ''
  )
  const [pickupInstructions, setPickupInstructions] = useState(
    data.pickupDetails?.pickup_instructions ?? ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const carriedSignupTrustRef = useRef<Record<string, unknown>>({})
  const showIdentity = focusSection == null || focusSection === 0
  const showBusiness = focusSection == null || focusSection === 1
  const showHandoff = focusSection == null || focusSection === 3
  const priceHelp = useFieldHelp('Typical project price range', 'priceRange')
  const consultationHelp = useFieldHelp('Consultations', 'consultations')
  const fulfillmentHelp = useFieldHelp('How customers receive orders', 'fulfillment')
  const initialSetupSubmission =
    focusSection != null &&
    !isVerifiedIdentityStatus(profile?.id_verification_status ?? '') &&
    profile?.is_verified !== true &&
    profile?.is_live !== true

  useEffect(() => {
    if (!profile || !data.userId || draftHydrated) return
    const userId = data.userId
    const frame = window.requestAnimationFrame(() => {
      try {
      const stored = window.localStorage.getItem(tailorWebSetupDraftKey(userId))
      if (stored) {
        const draft = JSON.parse(stored) as Record<string, unknown>
        if (draft.version === TAILOR_SETUP_DRAFT_VERSION) {
          carriedSignupTrustRef.current = {
            signupTrustVideoDraft: draft.signupTrustVideoDraft ?? null,
            signupTrustChallengeId: draft.signupTrustChallengeId ?? '',
            signupTrustChallengeText: draft.signupTrustChallengeText ?? '',
            signupTrustConsentGranted: draft.signupTrustConsentGranted === true,
            signupTrustHandoffToken: draft.signupTrustHandoffToken ?? '',
            signupTrustStoragePath: draft.signupTrustStoragePath ?? '',
          }
          if (typeof draft.displayName === 'string' && (draft.displayName.trim() || !profile.display_name)) setDisplayName(draft.displayName)
          // Older signups stored the literal "Not set" placeholder; drafts saved
          // in a browser before that fix would put it straight back into the
          // field, where it reads like a real answer.
          const draftLocation =
            typeof draft.location === 'string' && draft.location.trim() !== 'Not set'
              ? draft.location
              : ''
          if (draftLocation.trim() || !profile.location) setLocation(draftLocation)
          if (typeof draft.bio === 'string' && (draft.bio.trim() || !profile.bio)) setBio(draft.bio)
          if (Array.isArray(draft.languages) && (draft.languages.length > 0 || stringList(profile.languages).length === 0)) {
            setLanguages(draft.languages.filter((value): value is string => typeof value === 'string').slice(0, 12))
          }
          if (Array.isArray(draft.specialties) && (draft.specialties.length > 0 || stringList(profile.specialty_tags).length === 0)) {
            setSpecialties(draft.specialties.filter((value): value is string => typeof value === 'string').slice(0, 20))
          }
          if (typeof draft.currency === 'string') setCurrency(draft.currency)
          if (typeof draft.priceMin === 'string' && (draft.priceMin.trim() || !profile.price_range_min)) setPriceMin(draft.priceMin)
          if (typeof draft.priceMax === 'string' && (draft.priceMax.trim() || !profile.price_range_max)) setPriceMax(draft.priceMax)
          if (draft.availability === 'OPEN' || draft.availability === 'LIMITED' || draft.availability === 'FULLY_BOOKED') setAvailability(draft.availability)
          if (draft.sellerType === 'TAILOR' || draft.sellerType === 'BOUTIQUE' || draft.sellerType === 'TAILOR_SHOP') setSellerType(draft.sellerType)
          if (typeof draft.supportsCustomOrders === 'boolean') setSupportsCustomOrders(draft.supportsCustomOrders)
          if (typeof draft.supportsReadyMade === 'boolean') setSupportsReadyMade(draft.supportsReadyMade)
          if (typeof draft.acceptsCustomOrdersNow === 'boolean') setAcceptsCustomOrdersNow(draft.acceptsCustomOrdersNow)
          if (typeof draft.shopPaused === 'boolean') setShopPaused(draft.shopPaused)
          if (typeof draft.pickupAvailable === 'boolean') setPickupAvailable(draft.pickupAvailable)
          if (typeof draft.deliveryAvailable === 'boolean') setDeliveryAvailable(draft.deliveryAvailable)
          if (typeof draft.shippingAvailable === 'boolean') setShippingAvailable(draft.shippingAvailable)
          if (typeof draft.pickupAddress === 'string') setPickupAddress(draft.pickupAddress)
          if (typeof draft.pickupCity === 'string') setPickupCity(draft.pickupCity)
          if (typeof draft.pickupRegion === 'string') setPickupRegion(draft.pickupRegion)
          if (typeof draft.pickupPostalCode === 'string') setPickupPostalCode(draft.pickupPostalCode)
          if (typeof draft.pickupCountryCode === 'string') setPickupCountryCode(draft.pickupCountryCode)
          if (typeof draft.pickupInstructions === 'string') setPickupInstructions(draft.pickupInstructions)
          if (draft.consultationMode === 'UNAVAILABLE' || draft.consultationMode === 'FREE' || draft.consultationMode === 'PAID') setConsultationMode(draft.consultationMode)
          if (draft.consultationRequirement === 'OPTIONAL' || draft.consultationRequirement === 'REQUIRED') setConsultationRequirement(draft.consultationRequirement)
          if (typeof draft.consultationFee === 'string') setConsultationFee(draft.consultationFee)
          if (draft.consultationDuration === '15' || draft.consultationDuration === '30' || draft.consultationDuration === '45' || draft.consultationDuration === '60') setConsultationDuration(draft.consultationDuration)
          if (draft.consultationCallType === 'AUDIO' || draft.consultationCallType === 'VIDEO' || draft.consultationCallType === 'AUDIO_OR_VIDEO') setConsultationCallType(draft.consultationCallType)
          if (typeof draft.consultationFeeCreditable === 'boolean') setConsultationFeeCreditable(draft.consultationFeeCreditable)
          // Signup writes this draft itself, so a brand-new tailor was greeted
          // by "your saved draft was restored" for work she had never done.
          // Only say it when the draft actually carries something she typed.
          const restoredSomethingTyped = [draft.displayName, draftLocation, draft.bio, draft.priceMin, draft.priceMax, draft.pickupAddress]
            .some((value) => typeof value === 'string' && value.trim().length > 0) ||
            (Array.isArray(draft.specialties) && draft.specialties.length > 0)
          if (restoredSomethingTyped) setSuccess('Your saved setup draft was restored.')
        }
      }
      } catch {
        window.localStorage.removeItem(tailorWebSetupDraftKey(userId))
      } finally {
        setDraftHydrated(true)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [data.userId, draftHydrated, profile])

  useEffect(() => {
    if (!profile || !data.userId || !draftHydrated) return
    const draft = {
      ...carriedSignupTrustRef.current,
      version: TAILOR_SETUP_DRAFT_VERSION,
      displayName,
      location,
      bio,
      languages,
      specialties,
      currency,
      priceMin,
      priceMax,
      availability,
      sellerType,
      supportsCustomOrders,
      supportsReadyMade,
      acceptsCustomOrdersNow,
      shopPaused,
      pickupAvailable,
      deliveryAvailable,
      shippingAvailable,
      pickupAddress,
      pickupCity,
      pickupRegion,
      pickupPostalCode,
      pickupCountryCode,
      pickupInstructions,
      consultationMode,
      consultationRequirement,
      consultationFee,
      consultationDuration,
      consultationCallType,
      consultationFeeCreditable,
    }
    window.localStorage.setItem(tailorWebSetupDraftKey(data.userId), JSON.stringify(draft))
  }, [
    acceptsCustomOrdersNow, availability, bio, consultationCallType, consultationDuration,
    consultationFee, consultationFeeCreditable, consultationMode, consultationRequirement, currency,
    data.userId, deliveryAvailable,
    displayName, draftHydrated, languages, location, pickupAddress, pickupAvailable, pickupCity,
    pickupCountryCode, pickupInstructions, pickupPostalCode, pickupRegion, priceMax, priceMin,
    profile, sellerType, shippingAvailable, shopPaused, specialties, supportsCustomOrders,
    supportsReadyMade,
  ])

  if (!profile) return null

  function applySellerType(nextType: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP') {
    setSellerType(nextType)
    if (nextType === 'BOUTIQUE') {
      setSupportsCustomOrders(false)
      setSupportsReadyMade(true)
      setAcceptsCustomOrdersNow(false)
      setShopPaused(false)
    } else if (nextType === 'TAILOR_SHOP') {
      setSupportsCustomOrders(true)
      setSupportsReadyMade(true)
      setAcceptsCustomOrdersNow(true)
      setShopPaused(false)
    } else {
      setSupportsCustomOrders(true)
      setSupportsReadyMade(false)
      setAcceptsCustomOrdersNow(true)
      setShopPaused(true)
    }
  }

  async function saveSellingSetup() {
    setError(null)
    setSuccess(null)

    const parsedLanguages = uniqueValues(languages).slice(0, 12)
    const parsedSpecialties = uniqueValues(specialties).slice(0, 20)
    const leak = assertNoContactLeak(
      [
        displayName,
        location,
        bio,
        parsedLanguages.join('\n'),
        parsedSpecialties.join('\n'),
        pickupInstructions,
      ].join('\n'),
      "Selling setup can't include phone numbers, emails, or off-platform contact details."
    )
    if (leak) {
      setError(leak)
      return
    }
    const displayNameError = validateDisplayName(displayName)
    if (displayNameError) {
      setError(displayNameError)
      return
    }
    if (location.trim().length < 2) {
      setError(TAILOR_SETUP_VALIDATION.LOCATION_REQUIRED_MESSAGE)
      return
    }
    if (parsedSpecialties.length === 0) {
      setError(TAILOR_SETUP_VALIDATION.SPECIALTY_REQUIRED_MESSAGE)
      return
    }
    const parsedPriceMin = priceMin ? parseMinorUnits(priceMin) : null
    const parsedPriceMax = priceMax ? parseMinorUnits(priceMax) : null
    if (!parsedPriceMin || !parsedPriceMax || parsedPriceMax < parsedPriceMin) {
      setError('Add a valid minimum and maximum price, with the maximum at least the minimum.')
      return
    }
    if (!supportsCustomOrders && !supportsReadyMade) {
      setError(TAILOR_SETUP_VALIDATION.ORDER_MODE_REQUIRED_MESSAGE)
      return
    }
    if (!pickupAvailable && !deliveryAvailable && !shippingAvailable) {
      setError(TAILOR_SETUP_VALIDATION.FULFILLMENT_REQUIRED_MESSAGE)
      return
    }
    if (pickupAvailable && pickupAddress.trim().length < 8) {
      setError(TAILOR_SETUP_VALIDATION.PICKUP_ADDRESS_REQUIRED_MESSAGE)
      return
    }
    if (
      pickupAvailable &&
      (!pickupCity.trim() || !/^[A-Za-z]{2}$/u.test(pickupCountryCode.trim()))
    ) {
      setError('Add the pickup city and 2-letter country code before offering collection.')
      return
    }
    const parsedConsultationFee =
      consultationMode === 'PAID' ? parseMinorUnits(consultationFee) : null
    if (consultationMode === 'PAID' && (!parsedConsultationFee || parsedConsultationFee <= 0)) {
      setError('Enter a valid consultation fee.')
      return
    }

    setBusy(true)
    try {
      await invokeAccountFunction('tailor-profile-action', {
        action: initialSetupSubmission ? 'upsert-setup' : 'update-profile',
        profile: {
          displayName: displayName.trim(),
          location: location.trim(),
          bio: bio.trim() || null,
          languages: parsedLanguages,
          specialties: parsedSpecialties,
          priceRangeMin: parsedPriceMin,
          priceRangeMax: parsedPriceMax,
          currency,
          availability,
          sellerType,
          supportsCustomOrders,
          supportsReadyMade,
          acceptsCustomOrdersNow,
          shopPaused,
          pickupAvailable,
          pickupAddress: pickupAddress.trim() || null,
          pickupAddressLine1: pickupAddress.trim() || null,
          pickupCity: pickupCity.trim() || null,
          pickupRegion: pickupRegion.trim() || null,
          pickupPostalCode: pickupPostalCode.trim() || null,
          pickupCountryCode: pickupCountryCode.trim().toUpperCase() || null,
          pickupLocationVerificationSource: pickupAvailable ? 'TAILOR_CONFIRMED_STRUCTURED' : null,
          pickupLocationVerificationReference: null,
          pickupLocationVerifiedAt: pickupAvailable ? new Date().toISOString() : null,
          pickupInstructions: pickupInstructions.trim() || null,
          deliveryAvailable,
          shippingAvailable,
          consultationMode,
          consultationRequirement,
          consultationFeeAmount: parsedConsultationFee,
          consultationDurationMinutes: Number(consultationDuration),
          consultationCallType,
          consultationFeeCreditable: consultationMode === 'PAID' && consultationFeeCreditable,
          ...(initialSetupSubmission
            ? {
                portfolioPhotoUrls: data.portfolioItems
                  .map((item) => item.image_url)
                  .filter((url): url is string => typeof url === 'string' && url.length > 0),
                portfolioVideoUrls: stringList(profile!.portfolio_video_urls),
              }
            : {}),
        },
      })
      if (data.userId) window.localStorage.removeItem(tailorWebSetupDraftKey(data.userId))
      setSuccess(
        initialSetupSubmission
          ? 'Setup saved. Record the private trust video below to submit for review.'
          : 'Selling setup saved.'
      )
      onRefresh()
    } catch (setupError) {
      setError(friendlyActionError(setupError, 'Selling setup could not save.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="group mt-4 border-t border-ink/6 pt-4" open={focusSection != null || !profile.profile_completed ? true : undefined}>
      <summary className={focusSection == null ? 'flex cursor-pointer list-none items-center justify-between gap-4 marker:hidden' : 'sr-only'}>
        <span>
          <span className="block text-sm font-semibold text-ink">Edit setup on web</span>
          <span className="mt-1 block text-xs leading-5 text-ink/56">
            Update business type, order status, fulfillment, private pickup details, public bio,
            specialties, and languages.
          </span>
        </span>
        <ChevronDown
          className="size-5 shrink-0 text-ui-subtle transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-4 grid gap-4">
        <ActionNotice error={error} success={success} />
        {showIdentity ? <div className="grid gap-3 md:grid-cols-2">
          <OnboardingField
            label="Public display name"
            helpKey="displayName"
            htmlFor="tailor-setup-display-name"
            hint="Shown on your profile, in messages, and on every order."
          >
            <Input
              id="tailor-setup-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </OnboardingField>
          <StructuredAddressSearch
            label="City or base location"
            helpKey="location"
            value={location}
            placeholder="Search city or area"
            allowManualFallback
            className=""
            onSelect={(address) => {
              setLocation([address.city, address.stateRegion, address.country].filter(Boolean).join(', '))
              setError(null)
            }}
          />
          <OnboardingField
            label="About your work"
            helpKey="bio"
            htmlFor="tailor-setup-bio"
            className="md:col-span-2"
            hint={`${bio.trim().length} of 80 characters minimum`}
          >
            <Textarea
              id="tailor-setup-bio"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              rows={4}
            />
          </OnboardingField>
          <TailorSetupOptionPicker label="Languages" helpKey="languages" values={languages} groups={TAILOR_LANGUAGE_GROUPS} limit={12} onChange={setLanguages} />
        </div> : null}

        {showBusiness ? <div className="grid gap-3 md:grid-cols-2">
          <OnboardingField
            label="Profile currency"
            helpKey="currency"
            htmlFor="tailor-setup-currency"
            hint="Payout setup follows it, so choose one you can accept payouts in."
          >
            <NativeSelect
              id="tailor-setup-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </NativeSelect>
          </OnboardingField>
          <OnboardingField
            label="Availability"
            helpKey="availability"
            htmlFor="tailor-setup-availability"
            hint="Controls search visibility and whether customers see a slower-capacity notice."
          >
            <NativeSelect
              id="tailor-setup-availability"
              value={availability}
              onChange={(event) => setAvailability(event.target.value)}
            >
              <option value="OPEN">Open for orders</option>
              <option value="LIMITED">Limited availability</option>
              <option value="FULLY_BOOKED">Fully booked</option>
            </NativeSelect>
          </OnboardingField>
          <TailorSetupOptionPicker label="Specialties" helpKey="specialties" values={specialties} groups={TAILOR_SPECIALTY_GROUPS} limit={20} onChange={setSpecialties} />
          <div className="flex items-center gap-1.5 md:col-span-2">
            <span className="text-sm font-semibold text-ink">Typical project price range</span>
            {priceHelp.button}
          </div>
          {priceHelp.panel ? <div className="md:col-span-2">{priceHelp.panel}</div> : null}
          <MoneyInput
            id="tailor-profile-price-min"
            label="Typical project minimum"
            value={priceMin}
            onValueChange={setPriceMin}
            currency={normalizeAccountCurrency(currency) ?? 'USD'}
            required
          />
          <MoneyInput
            id="tailor-profile-price-max"
            label="Typical project maximum"
            value={priceMax}
            onValueChange={setPriceMax}
            currency={normalizeAccountCurrency(currency) ?? 'USD'}
            required
          />
        </div> : null}

        {showBusiness ? <div className="grid gap-3 md:grid-cols-3">
          {SELLER_TYPE_WEB_OPTIONS.map(({ value, label, hint }) => (
            <label
              key={value}
              className={`grid cursor-pointer gap-2 rounded-[8px] border px-4 py-3 text-sm font-semibold ${sellerType === value ? 'border-needle/24 bg-needle/10 text-needle' : 'border-ink/8 bg-white text-ink/68'}`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="seller-type"
                  checked={sellerType === value}
                  onChange={() => applySellerType(value)}
                />
                <span>{label}</span>
              </span>
              <span className="text-xs font-medium leading-5 text-ink/56">{hint}</span>
            </label>
          ))}
        </div> : null}

        {showHandoff && supportsCustomOrders ? (
          <div className="grid gap-4 rounded-[8px] border border-needle/12 bg-needle/6 p-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <p className="flex items-center gap-1.5 font-semibold text-ink">
                Consultation policy
                {consultationHelp.button}
              </p>
              {consultationHelp.panel}
              <p className="mt-1 text-xs leading-5 text-ink/56">
                Customers see these terms before starting a custom brief.
              </p>
            </div>
            <Field label="Availability">
              <NativeSelect
                value={consultationMode}
                onChange={(event) =>
                  setConsultationMode(event.target.value as 'UNAVAILABLE' | 'FREE' | 'PAID')
                }
              >
                <option value="UNAVAILABLE">Not offered</option>
                <option value="FREE">Free</option>
                <option value="PAID">Paid</option>
              </NativeSelect>
            </Field>
            {consultationMode !== 'UNAVAILABLE' ? (
              <Field label="Requirement">
                <NativeSelect
                  value={consultationRequirement}
                  onChange={(event) =>
                    setConsultationRequirement(event.target.value as 'OPTIONAL' | 'REQUIRED')
                  }
                >
                  <option value="OPTIONAL">Optional</option>
                  <option value="REQUIRED">Required before quote</option>
                </NativeSelect>
              </Field>
            ) : null}
            {consultationMode !== 'UNAVAILABLE' ? (
              <Field label="Duration">
                <NativeSelect
                  value={consultationDuration}
                  onChange={(event) => setConsultationDuration(event.target.value)}
                >
                  {['15', '30', '45', '60'].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            {consultationMode !== 'UNAVAILABLE' ? (
              <Field label="Call type">
                <NativeSelect
                  value={consultationCallType}
                  onChange={(event) =>
                    setConsultationCallType(
                      event.target.value as 'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO'
                    )
                  }
                >
                  <option value="AUDIO">Audio</option>
                  <option value="VIDEO">Video</option>
                  <option value="AUDIO_OR_VIDEO">Audio or video</option>
                </NativeSelect>
              </Field>
            ) : null}
            {consultationMode === 'PAID' ? (
              <MoneyInput
                id="tailor-profile-consultation-fee"
                label="Consultation fee"
                value={consultationFee}
                onValueChange={setConsultationFee}
                currency={normalizeAccountCurrency(currency) ?? 'USD'}
                required
              />
            ) : null}
            {consultationMode === 'PAID' ? (
              <label className="flex items-center justify-between gap-3 rounded-[8px] border border-ui-border bg-white px-4 py-3 text-sm font-semibold text-ink">
                <span>Credit fee toward accepted order</span>
                <Switch
                  checked={consultationFeeCreditable}
                  onCheckedChange={setConsultationFeeCreditable}
                  aria-label="Credit consultation fee toward accepted order"
                />
              </label>
            ) : null}
            {consultationMode !== 'UNAVAILABLE' ? (
              <p className="text-xs leading-5 text-ink/56 md:col-span-2">
                More than 24 hours: full refund. Inside 24 hours: 50%. Tailor cancellation or
                verified provider failure: full refund or agreed reschedule.
              </p>
            ) : null}
          </div>
        ) : null}

        {showHandoff ? <div className="grid gap-3 md:grid-cols-2">
          {supportsCustomOrders ? (
            <div className="grid gap-2 rounded-[8px] border border-ui-border bg-white px-4 py-3 text-sm text-ink">
              <span className="font-semibold">Custom order status</span>
              <span className="text-xs leading-5 text-ink/56">
                Controls whether customers can send new custom briefs.
              </span>
              <NativeSelect
                value={acceptsCustomOrdersNow ? 'OPEN' : 'PAUSED'}
                onChange={(event) => setAcceptsCustomOrdersNow(event.target.value === 'OPEN')}
              >
                <option value="OPEN">Taking custom orders</option>
                <option value="PAUSED">Custom orders paused</option>
              </NativeSelect>
            </div>
          ) : null}
          {supportsReadyMade ? (
            <div className="grid gap-2 rounded-[8px] border border-ui-border bg-white px-4 py-3 text-sm text-ink">
              <span className="font-semibold">Ready-made shop status</span>
              <span className="text-xs leading-5 text-ink/56">
                Controls checkout for live ready-made inventory.
              </span>
              <NativeSelect
                value={shopPaused ? 'PAUSED' : 'OPEN'}
                onChange={(event) => setShopPaused(event.target.value === 'PAUSED')}
              >
                <option value="OPEN">Shop checkout open</option>
                <option value="PAUSED">Shop checkout paused</option>
              </NativeSelect>
            </div>
          ) : null}
        </div> : null}

        {showHandoff ? (
          <div className="grid gap-1.5">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              How customers receive orders
              {fulfillmentHelp.button}
            </span>
            {fulfillmentHelp.panel}
          </div>
        ) : null}
        {showHandoff ? <div className="grid gap-3 md:grid-cols-3">
          {(
            [
              ['pickup', 'Pickup', pickupAvailable, setPickupAvailable],
              ['delivery', 'Delivery', deliveryAvailable, setDeliveryAvailable],
              ['shipping', 'Shipping', shippingAvailable, setShippingAvailable],
            ] as const
          ).map(([key, label, checked, setter]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 rounded-[8px] border border-ui-border bg-white px-4 py-3 text-sm font-semibold text-ink"
            >
              <span>{label}</span>
              <Switch
                checked={checked}
                onCheckedChange={setter}
                aria-label={`${label} available`}
              />
            </div>
          ))}
        </div> : null}

        {showHandoff && pickupAvailable ? (
          <div className="grid gap-3 rounded-[8px] border border-needle/10 bg-needle/6 p-4">
            <StructuredAddressSearch
              onSelect={(address) => {
                setPickupAddress(address.line1 || address.displayValue)
                setPickupCity(address.city)
                setPickupRegion(address.stateRegion)
                setPickupPostalCode(address.postcode)
                setPickupCountryCode(address.countryCode || '')
                setError(null)
              }}
            />
            <Field label="Private pickup address">
              <Textarea
                value={pickupAddress}
                onChange={(event) => setPickupAddress(event.target.value)}
                rows={3}
                placeholder="Full address customers unlock after collection is ready"
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Pickup city">
                <Input
                  value={pickupCity}
                  onChange={(event) => setPickupCity(event.target.value)}
                  placeholder="City"
                />
              </Field>
              <Field label="State / region">
                <Input
                  value={pickupRegion}
                  onChange={(event) => setPickupRegion(event.target.value)}
                  placeholder="State or region"
                />
              </Field>
              <Field label="Postcode / ZIP (optional)">
                <Input
                  value={pickupPostalCode}
                  onChange={(event) => setPickupPostalCode(event.target.value)}
                  placeholder="Postcode / ZIP"
                />
              </Field>
              <Field label="2-letter country code">
                <Input
                  value={pickupCountryCode}
                  onChange={(event) =>
                    setPickupCountryCode(event.target.value.toUpperCase().slice(0, 2))
                  }
                  placeholder="e.g. GH"
                />
              </Field>
            </div>
            <Field label="Pickup instructions">
              <Input
                value={pickupInstructions}
                onChange={(event) => setPickupInstructions(event.target.value)}
                placeholder="e.g. Bring your collection code"
              />
            </Field>
          </div>
        ) : null}

        {showHandoff ? <div className="flex flex-wrap items-center gap-3">
          <Button onClick={saveSellingSetup} disabled={busy}>
            {busy ? 'Saving...' : 'Save selling setup'}
          </Button>
          {supportsReadyMade ? (
            <Button asChild variant="ghost">
              <Link href="/account/shop">
                Manage ready-made shop <ChevronRight />
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href="/account/payout">
              Review payout <ChevronRight />
            </Link>
          </Button>
        </div> : null}
      </div>
    </details>
  )
}
