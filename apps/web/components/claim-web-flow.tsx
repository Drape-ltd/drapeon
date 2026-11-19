'use client'

import { FormEvent, useMemo, useState } from 'react'
import {
  claimActionServerError,
  DRAPEON_ANDROID_STORE_URL,
  DRAPEON_IOS_STORE_URL,
} from '@drape/shared'
import { PHONE_COUNTRIES } from '@drape/shared/phone-countries'
import { createClient } from '../lib/supabase'
import { StructuredAddressSearch } from './structured-address-search'

type Step = 'email' | 'code' | 'password' | 'details' | 'complete'
type ClaimMedia = {
  id: string
  label: string
  kind: string
  cover: boolean
  previewUrl: string | null
}
type ClaimProfile = {
  displayName: string | null
  businessName: string | null
  bio: string | null
  location: string | null
  languages: string[] | null
  specialties: string[] | null
  priceMin: number | null
  priceMax: number | null
  currency: string | null
}

const POSTCODE_OPTIONAL_COUNTRIES = new Set(['GH', 'NG'])

function postcodeRequired(countryCode: string) {
  return !POSTCODE_OPTIONAL_COUNTRIES.has(countryCode.trim().toUpperCase())
}

export function ClaimWebFlow({ token }: { token: string }) {
  const supabase = useMemo(() => createClient({ isSingleton: false }), [])
  const [step, setStep] = useState<Step>('email')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [phone, setPhone] = useState('')
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [countryCode, setCountryCode] = useState('US')
  const [consent, setConsent] = useState(false)
  const [media, setMedia] = useState<ClaimMedia[]>([])
  const [profile, setProfile] = useState<ClaimProfile | null>(null)
  const [profileMessage, setProfileMessage] = useState('')
  const [consentVersion, setConsentVersion] = useState('')
  const [claimSessionId, setClaimSessionId] = useState('')
  const [manualAddress, setManualAddress] = useState(false)
  const [addressConfirmed, setAddressConfirmed] = useState(false)

  async function invokeClaimAction(body: Record<string, unknown>) {
    const result = await supabase.functions.invoke('tailor-claim-action', { body })
    return { ...result, serverError: await claimActionServerError(result) }
  }

  async function sendCode(event?: FormEvent) {
    event?.preventDefault()
    setBusy(true)
    setMessage('')
    const normalized = email.trim().toLowerCase()
    const result = await invokeClaimAction({
      action: 'REQUEST_EMAIL_CODE',
      token,
      email: normalized,
    })
    setBusy(false)
    if (result.error || result.data?.sent !== true) {
      setMessage(
        result.serverError === 'EMAIL_LOCKED'
          ? 'Email codes are locked for this link. Use Apple in the Drapeon app or contact Drapeon.'
          : result.serverError === 'UNAVAILABLE'
            ? 'This claim link is expired, revoked, or already used.'
            : 'We could not send a code. Try again.'
      )
      return
    }
    setEmail(normalized)
    setStep('code')
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const verified = await invokeClaimAction({ action: 'VERIFY_EMAIL_CODE', token, email, code })
    if (verified.error || verified.data?.verified !== true) {
      setBusy(false)
      setMessage(
        verified.serverError === 'ACCOUNT_CONFLICT'
          ? 'That email belongs to another Drapeon account. Use a different email.'
          : verified.serverError === 'CODE_EXPIRED'
            ? 'That code expired. Request a new code.'
            : verified.serverError === 'EMAIL_LOCKED'
              ? 'Email codes are locked for this link. Finish in the app with Apple or contact Drapeon.'
              : 'That code is invalid or expired.'
      )
      return
    }
    const bootstrap = await invokeClaimAction({
      action: 'BOOTSTRAP_EMAIL_SESSION',
      token,
      email,
      code,
    })
    const session = bootstrap.data?.session
    if (
      bootstrap.error ||
      typeof session?.claimSessionId !== 'string' ||
      typeof session?.accessToken !== 'string' ||
      typeof session?.refreshToken !== 'string'
    ) {
      setBusy(false)
      setMessage(
        bootstrap.serverError === 'ACCOUNT_CONFLICT'
          ? 'That email belongs to another Drapeon account. Use a different email.'
          : bootstrap.serverError === 'BOOTSTRAP_ALREADY_STARTED'
            ? 'This claim is already open on another device. Return to that device or wait for it to expire.'
            : 'We could not open the secure claim session. Try again.'
      )
      return
    }
    const installed = await supabase.auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    })
    if (installed.error) {
      setBusy(false)
      setMessage('The secure claim session could not be verified. Request a new code.')
      return
    }
    const context = await invokeClaimAction({ action: 'GET_CLAIM_CONTEXT', token })
    setBusy(false)
    if (
      context.error ||
      context.data?.available !== true ||
      !Array.isArray(context.data?.media) ||
      !context.data?.profile
    ) {
      setMessage('The shop details could not be loaded. Try again.')
      return
    }
    setMedia(context.data.media)
    setProfile(context.data.profile)
    setConsentVersion(context.data.consentTextVersion)
    setClaimSessionId(session.claimSessionId)
    setStep('password')
  }

  async function claim(event: FormEvent) {
    event.preventDefault()
    if (!consent || !claimSessionId) {
      setMessage('Confirm that Drapeon may publish the listed media.')
      return
    }
    setBusy(true)
    setMessage('')
    if (!(await saveProfile())) {
      setBusy(false)
      return
    }
    const pickupAddress = [line1, line2, city, region, postalCode, countryCode]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ')
    const result = await invokeClaimAction({
      action: 'CLAIM',
      token,
      email,
      password,
      phone,
      idempotencyKey: `tailor-claim:${claimSessionId}`,
      pickupAddress,
      pickupAddressLine1: [line1, line2].filter(Boolean).join(', '),
      pickupCity: city,
      pickupRegion: region,
      pickupPostalCode: postalCode,
      pickupCountryCode: countryCode.toUpperCase(),
      consentAccepted: true,
      consentTextVersion: consentVersion,
      consentMediaManifest: media.map((item) => item.id),
    })
    if (result.error || result.data?.claimed !== true) {
      setBusy(false)
      setMessage(
        result.serverError === 'ACCOUNT_CONFLICT'
          ? 'That email belongs to another Drapeon account.'
          : result.serverError === 'CONSENT_MANIFEST_STALE'
            ? 'Staff updated the media. Reload this private link and review it again.'
            : result.serverError === 'PHONE_ALREADY_IN_USE'
              ? 'That phone number belongs to another Drapeon account. Use a different number.'
              : 'The claim could not be completed. Try again.'
      )
      return
    }
    await supabase.auth.signOut({ scope: 'local' })
    setBusy(false)
    setStep('complete')
  }

  async function saveProfile() {
    if (!profile) {
      setProfileMessage('Your shop details are still loading.')
      return false
    }
    setProfileMessage('')
    const result = await invokeClaimAction({
      action: 'UPDATE_CLAIM_PROFILE',
      token,
      displayName: profile.displayName,
      businessName: profile.businessName,
      bio: profile.bio,
      location: profile.location,
      languages: profile.languages,
      specialties: profile.specialties,
      currency: profile.currency,
      priceMin: profile.priceMin,
      priceMax: profile.priceMax,
    })
    if (result.error || result.data?.updated !== true) {
      setProfileMessage(
        typeof result.data?.detail === 'string'
          ? result.data.detail
          : result.serverError === 'PROFILE_INVALID'
            ? 'Check the shop name, bio, location, specialties, currency, and price range.'
            : 'Your shop changes could not be saved. Check the fields and try again.'
      )
      return false
    }
    return true
  }

  async function removeMedia(mediaId: string) {
    if (busy) return
    if (!window.confirm('Remove this photo or video from the shop?')) return
    setBusy(true)
    setMessage('')
    const result = await invokeClaimAction({ action: 'REMOVE_CLAIM_MEDIA', token, mediaId })
    setBusy(false)
    if (result.error || result.data?.removed !== true) {
      setMessage(
        result.serverError === 'AVATAR_REQUIRED'
          ? 'Keep one profile photo to continue.'
          : result.serverError === 'COVER_REQUIRED'
            ? 'Choose a different cover before removing this photo.'
            : result.serverError === 'PHOTO_REQUIRED'
              ? 'Keep one approved portfolio photo to continue.'
              : 'This media could not be removed. Try again.'
      )
      return
    }
    setMedia((current) => current.filter((item) => item.id !== mediaId))
    setConsent(false)
    setMessage('Media removed. Review the remaining work and confirm consent again.')
  }

  const input =
    'w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle'
  const button =
    'w-full rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:opacity-50'
  const stepNumber =
    step === 'email' || step === 'code' || step === 'password' ? 2 : step === 'details' ? 3 : 4
  const stepLabel =
    stepNumber === 2 ? 'Sign in' : stepNumber === 3 ? 'Contact & pickup' : 'Verify phone'
  const claimDisabledReason =
    step !== 'details'
      ? ''
      : !phone.trim()
        ? 'Add your phone number to continue.'
        : !line1.trim()
          ? 'Add your pickup street address to continue.'
          : !city.trim()
            ? 'Add your pickup city to continue.'
            : !region.trim()
              ? 'Add your state or region to continue.'
              : postcodeRequired(countryCode) && !postalCode.trim()
                ? 'Add your postal code to continue.'
                : countryCode.length !== 2
                  ? 'Choose your pickup country to continue.'
                  : !consent
                    ? 'Confirm that the listed work is yours to continue.'
                    : ''
  return (
    <section
      id="claim-on-web"
      className="mx-auto mt-5 max-w-2xl rounded-[1.75rem] border border-ink/10 bg-white/90 p-5 shadow-sm sm:p-7"
    >
      <div className="mb-5">
        <p className="text-xs font-semibold text-needle">
          Step {stepNumber} of 5 · {stepLabel}
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10">
          <div className="h-full rounded-full bg-needle" style={{ width: `${stepNumber * 20}%` }} />
        </div>
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-needle">
        Claim on the web
      </p>
      <h2 className="mt-2 font-serif text-2xl text-ink">
        {step === 'complete' ? 'Your shop is claimed.' : 'Secure your shop account'}
      </h2>
      {step === 'email' ? (
        <form className="mt-5 space-y-3" onSubmit={sendCode}>
          <label className="grid gap-1.5 text-xs font-semibold text-ink">
            Email address
            <input
              aria-label="Claim email"
              autoComplete="email"
              className={input}
              required
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className={button} disabled={busy} type="submit">
            Send email code
          </button>
        </form>
      ) : null}
      {step === 'code' ? (
        <form className="mt-5 space-y-3" onSubmit={verifyCode}>
          <p className="text-sm text-ink/60">Enter the six-digit code sent to {email}.</p>
          <label className="grid gap-1.5 text-xs font-semibold text-ink">
            Six-digit email code
            <input
              aria-label="Six-digit claim code"
              autoComplete="one-time-code"
              className={input}
              inputMode="numeric"
              maxLength={6}
              required
              pattern="[0-9]{6}"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/gu, ''))}
            />
          </label>
          <button className={button} disabled={busy} type="submit">
            Verify and continue
          </button>
          <button
            className="text-sm font-semibold text-needle underline underline-offset-4"
            disabled={busy}
            type="button"
            onClick={() => void sendCode()}
          >
            Resend code
          </button>
          <button
            className="text-sm font-semibold text-needle underline underline-offset-4"
            type="button"
            onClick={() => {
              setCode('')
              setMessage('')
              setStep('email')
            }}
          >
            Use a different email
          </button>
        </form>
      ) : null}
      {step === 'password' ? (
        <form
          className="mt-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (password.length >= 10) setStep('details')
          }}
        >
          <div className="grid gap-1.5">
            <label htmlFor="claim-new-password" className="text-xs font-semibold text-ink">
              Create password
            </label>
            <div className="relative">
              <input
                id="claim-new-password"
                aria-describedby="claim-password-rule"
                autoComplete="new-password"
                className={`${input} pr-16`}
                minLength={10}
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-3 text-xs font-semibold text-needle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <p
              id="claim-password-rule"
              className={`text-xs ${password.length >= 10 ? 'text-needle' : 'text-ink/52'}`}
            >
              {password.length >= 10 ? '✓ ' : ''}10+ characters
            </p>
          </div>
          <button className={button} disabled={busy || password.length < 10} type="submit">
            Continue to contact details
          </button>
          {password.length < 10 ? (
            <p className="text-xs text-ink/52">
              Create a password with at least 10 characters to continue.
            </p>
          ) : null}
        </form>
      ) : null}
      {step === 'details' ? (
        <form className="mt-5 space-y-3" onSubmit={claim}>
          <div className="rounded-2xl bg-needle/10 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-needle">
              Shop review
            </p>
            <h3 className="mt-1 font-serif text-2xl text-ink">
              {profile?.displayName ?? 'Your shop'}
            </h3>
            {profile?.location ? <p className="text-sm text-ink/60">{profile.location}</p> : null}
            {profile?.bio ? (
              <p className="mt-2 text-sm leading-6 text-ink/70">{profile.bio}</p>
            ) : null}
            {profile?.priceMin != null && profile?.priceMax != null ? (
              <p className="mt-2 text-sm font-semibold text-needle">
                {profile.currency} {profile.priceMin}–{profile.priceMax}
              </p>
            ) : null}
          </div>
          <fieldset className="space-y-3 rounded-2xl border border-ink/10 p-4">
            <legend className="px-2 text-sm font-semibold text-ink">Make the shop yours</legend>
            <label className="grid gap-1.5 text-xs font-semibold text-ink">
              Shop name
              <input
                aria-label="Shop name"
                className={input}
                required
                value={profile?.displayName ?? ''}
                onChange={(event) =>
                  setProfile((current) =>
                    current ? { ...current, displayName: event.target.value } : current
                  )
                }
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink">
              Public location
              <input
                aria-label="Public location"
                className={input}
                required
                placeholder="City, country"
                value={profile?.location ?? ''}
                onChange={(event) =>
                  setProfile((current) =>
                    current ? { ...current, location: event.target.value } : current
                  )
                }
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink">
              Shop bio
              <textarea
                aria-label="Shop bio"
                className={`${input} min-h-28`}
                required
                placeholder="Tell customers about your work"
                value={profile?.bio ?? ''}
                onChange={(event) =>
                  setProfile((current) =>
                    current ? { ...current, bio: event.target.value } : current
                  )
                }
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink">
              Languages
              <input
                aria-label="Languages"
                className={input}
                required
                placeholder="English, Yoruba"
                value={(profile?.languages ?? []).join(', ')}
                onChange={(event) =>
                  setProfile((current) =>
                    current
                      ? {
                          ...current,
                          languages: event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        }
                      : current
                  )
                }
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink">
              Specialties
              <input
                aria-label="Specialties"
                className={input}
                required
                placeholder="Bridal, alterations, menswear"
                value={(profile?.specialties ?? []).join(', ')}
                onChange={(event) =>
                  setProfile((current) =>
                    current
                      ? {
                          ...current,
                          specialties: event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        }
                      : current
                  )
                }
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1.5 text-xs font-semibold text-ink">
                Currency
                <input
                  aria-label="Currency"
                  className={input}
                  maxLength={3}
                  required
                  placeholder="USD"
                  value={profile?.currency ?? ''}
                  onChange={(event) =>
                    setProfile((current) =>
                      current ? { ...current, currency: event.target.value.toUpperCase() } : current
                    )
                  }
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-ink">
                Minimum price
                <input
                  aria-label="Minimum price"
                  className={input}
                  inputMode="numeric"
                  required
                  placeholder="Minimum"
                  value={profile?.priceMin ?? ''}
                  onChange={(event) =>
                    setProfile((current) =>
                      current
                        ? {
                            ...current,
                            priceMin:
                              event.target.value.replace(/\D/gu, '') === ''
                                ? null
                                : Number(event.target.value.replace(/\D/gu, '')),
                          }
                        : current
                    )
                  }
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-ink">
                Maximum price
                <input
                  aria-label="Maximum price"
                  className={input}
                  inputMode="numeric"
                  required
                  placeholder="Maximum"
                  value={profile?.priceMax ?? ''}
                  onChange={(event) =>
                    setProfile((current) =>
                      current
                        ? {
                            ...current,
                            priceMax:
                              event.target.value.replace(/\D/gu, '') === ''
                                ? null
                                : Number(event.target.value.replace(/\D/gu, '')),
                          }
                        : current
                    )
                  }
                />
              </label>
            </div>
            {profileMessage ? (
              <p className="text-sm text-red-700" role="alert">
                {profileMessage}
              </p>
            ) : null}
          </fieldset>
          <label className="grid gap-1.5 text-xs font-semibold text-ink">
            Phone number
            <input
              aria-label="Phone number"
              autoComplete="tel"
              className={input}
              required
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          {!manualAddress && !addressConfirmed ? (
            <div className="space-y-2">
              <StructuredAddressSearch
                label="Pickup address"
                value={line1}
                countryCode={countryCode}
                onManualFallback={() => setManualAddress(true)}
                onSelect={(address) => {
                  setLine1(address.line1 || address.displayValue)
                  setCity(address.city)
                  setRegion(address.stateRegion)
                  setPostalCode(address.postcode)
                  if (address.countryCode) setCountryCode(address.countryCode.toUpperCase())
                  setAddressConfirmed(true)
                  if (
                    !address.city.trim() ||
                    !address.stateRegion.trim() ||
                    (postcodeRequired(address.countryCode || countryCode) &&
                      !address.postcode.trim())
                  ) {
                    setManualAddress(true)
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setManualAddress(true)}
                className="text-sm font-semibold text-needle underline"
              >
                Enter manually
              </button>
            </div>
          ) : addressConfirmed && !manualAddress ? (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-ink/10 bg-bone p-4">
              <div>
                <p className="text-sm font-semibold text-ink">Confirm your address</p>
                <p className="mt-1 text-sm text-ink/60">
                  {[line1, line2, city, region, postalCode, countryCode].filter(Boolean).join(', ')}
                </p>
              </div>
              <button
                type="button"
                className="text-sm font-semibold text-needle underline"
                onClick={() => setManualAddress(true)}
              >
                Edit
              </button>
            </div>
          ) : null}
          {addressConfirmed && !manualAddress ? (
            <label className="grid gap-1.5 text-xs font-semibold text-ink">
              Apartment / unit (optional)
              <input
                className={input}
                autoComplete="address-line2"
                value={line2}
                onChange={(event) => setLine2(event.target.value)}
              />
            </label>
          ) : null}
          {manualAddress ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-semibold text-ink sm:col-span-2">
                Street address
                <input
                  className={input}
                  required
                  autoComplete="address-line1"
                  value={line1}
                  onChange={(event) => setLine1(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-ink sm:col-span-2">
                Apartment / unit (optional)
                <input
                  className={input}
                  autoComplete="address-line2"
                  value={line2}
                  onChange={(event) => setLine2(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-ink">
                City
                <input
                  className={input}
                  required
                  autoComplete="address-level2"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-ink">
                State / region
                <input
                  className={input}
                  required
                  autoComplete="address-level1"
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-ink">
                Postal code{postcodeRequired(countryCode) ? '' : ' (optional)'}
                <input
                  className={input}
                  required={postcodeRequired(countryCode)}
                  autoComplete="postal-code"
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-ink">
                Country
                <select
                  className={input}
                  required
                  value={countryCode}
                  onChange={(event) => setCountryCode(event.target.value)}
                >
                  {PHONE_COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.flag} {country.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <div className="rounded-xl bg-bone p-4">
            <p className="text-sm font-semibold text-ink">Media Drapeon will publish</p>
            <label className="mt-3 flex items-start gap-3 text-sm leading-5 text-ink/70">
              <input
                className="mt-1"
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              These photos are my work and I&apos;m happy for Drapeon to show them.{' '}
              <a
                className="underline underline-offset-2"
                href="/terms"
                target="_blank"
                rel="noreferrer"
              >
                Full terms
              </a>
            </label>
            <ul className="mt-3 grid grid-cols-2 gap-3 text-sm text-ink/60 sm:grid-cols-3">
              {media.map((item) => (
                <li key={item.id} className="relative space-y-1">
                  {item.previewUrl && item.kind !== 'VIDEO' ? (
                    <img
                      className="aspect-[4/5] w-full rounded-xl object-cover"
                      src={item.previewUrl}
                      alt=""
                    />
                  ) : (
                    <div className="flex aspect-[4/5] items-center justify-center rounded-xl bg-ink/5 text-xs font-semibold">
                      {item.kind === 'VIDEO' ? 'VIDEO' : 'PHOTO'}
                    </div>
                  )}
                  <span className="block">
                    {item.label}
                    {item.cover ? ' · Cover' : ''}
                  </span>
                  <button
                    aria-label={`Remove ${item.label}`}
                    className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-ink/80 text-lg text-white"
                    type="button"
                    onClick={() => void removeMedia(item.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {claimDisabledReason ? (
            <p className="text-xs text-red-700" role="alert">
              {claimDisabledReason}
            </p>
          ) : null}
          <button className={button} disabled={busy || !!claimDisabledReason} type="submit">
            Claim my shop
          </button>
        </form>
      ) : null}
      {step === 'complete' ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm leading-6 text-ink/60">
            Finish in the Drapeon app. Sign in with this email and password, verify your phone, and
            Drapeon will run the final readiness check before publishing.
          </p>
          <a className={button} href="drape://profile/setup">
            Open Drapeon to finish
          </a>
          <div className="flex flex-wrap gap-4 text-sm font-semibold text-ink">
            <a className="underline underline-offset-4" href={DRAPEON_IOS_STORE_URL}>
              Download for iPhone
            </a>
            <a className="underline underline-offset-4" href={DRAPEON_ANDROID_STORE_URL}>
              Download for Android
            </a>
          </div>
        </div>
      ) : null}
      {message ? (
        <p className="mt-3 text-sm text-ink/65" role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}
