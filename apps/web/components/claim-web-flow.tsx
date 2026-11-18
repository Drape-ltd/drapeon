'use client'

import { FormEvent, useMemo, useState } from 'react'
import {
  claimActionServerError,
  DRAPEON_ANDROID_STORE_URL,
  DRAPEON_IOS_STORE_URL,
} from '@drape/shared'
import { createClient } from '../lib/supabase'

type Step = 'email' | 'code' | 'details' | 'complete'
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

export function ClaimWebFlow({ token }: { token: string }) {
  const supabase = useMemo(() => createClient({ isSingleton: false }), [])
  const [step, setStep] = useState<Step>('email')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [line1, setLine1] = useState('')
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

  async function invokeClaimAction(body: Record<string, unknown>) {
    const result = await supabase.functions.invoke('tailor-claim-action', { body })
    return { ...result, serverError: await claimActionServerError(result) }
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault()
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
    setStep('details')
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
    const pickupAddress = [line1, city, region, postalCode, countryCode]
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
      pickupAddressLine1: line1,
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
  const stepNumber = step === 'email' || step === 'code' ? 2 : step === 'details' ? 3 : 4
  const stepLabel =
    stepNumber === 2 ? 'Sign in' : stepNumber === 3 ? 'Contact & pickup' : 'Verify phone'
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
          <input
            aria-label="Claim email"
            className={input}
            required
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button className={button} disabled={busy} type="submit">
            Send email code
          </button>
        </form>
      ) : null}
      {step === 'code' ? (
        <form className="mt-5 space-y-3" onSubmit={verifyCode}>
          <p className="text-sm text-ink/60">Enter the six-digit code sent to {email}.</p>
          <input
            aria-label="Six-digit claim code"
            className={input}
            inputMode="numeric"
            maxLength={6}
            required
            pattern="[0-9]{6}"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/gu, ''))}
          />
          <button className={button} disabled={busy} type="submit">
            Verify and continue
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
            <input
              aria-label="Shop name"
              className={input}
              required
              placeholder="Shop name"
              value={profile?.displayName ?? ''}
              onChange={(event) =>
                setProfile((current) =>
                  current ? { ...current, displayName: event.target.value } : current
                )
              }
            />
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
            <div className="grid gap-3 sm:grid-cols-3">
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
                      ? { ...current, priceMin: Number(event.target.value.replace(/\D/gu, '')) }
                      : current
                  )
                }
              />
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
                      ? { ...current, priceMax: Number(event.target.value.replace(/\D/gu, '')) }
                      : current
                  )
                }
              />
            </div>
            {profileMessage ? (
              <p className="text-sm text-red-700" role="alert">
                {profileMessage}
              </p>
            ) : null}
          </fieldset>
          <input
            aria-label="Phone number"
            className={input}
            required
            placeholder="Phone number"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <input
            aria-label="Pickup street address"
            className={input}
            required
            placeholder="Pickup street address"
            value={line1}
            onChange={(event) => setLine1(event.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              aria-label="Pickup city"
              className={input}
              required
              placeholder="City"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
            <input
              aria-label="Pickup region"
              className={input}
              required
              placeholder="State / region"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <input
              aria-label="Pickup postal code"
              className={input}
              required
              placeholder="Postal code"
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
            />
            <input
              aria-label="Pickup country code"
              className={input}
              maxLength={2}
              required
              placeholder="US"
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
            />
          </div>
          <input
            aria-label="Claim account password"
            className={input}
            minLength={10}
            required
            type="password"
            placeholder="Create a password (10+ characters)"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
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
          <button className={button} disabled={busy} type="submit">
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
