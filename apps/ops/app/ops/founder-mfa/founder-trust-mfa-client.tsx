'use client'

import { useState } from 'react'
import Image from 'next/image'
import { TurnstileChallenge } from '../../../../web/components/turnstile-challenge'

type Result = {
  ok?: boolean
  error?: string
  factorId?: string
  qrCode?: string
  redirectTo?: string
  message?: string
}

export function FounderTrustMfaClient({
  returnTo,
  turnstileSiteKey,
}: {
  returnTo: string
  turnstileSiteKey: string | null
}) {
  const [result, setResult] = useState<Result>({})
  const [factorId, setFactorId] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const [pending, setPending] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)

  async function submit(form: HTMLFormElement, action: string) {
    if (pending) return
    setPending(true)
    setResult({})
    const data = new FormData(form)
    data.set('action', action)
    data.set('returnTo', returnTo)
    if (action === 'sign-in' && captchaToken) data.set('captchaToken', captchaToken)
    try {
      const response = await fetch('/api/founder-trust-mfa-session', { method: 'POST', body: data })
      const body = await response.json() as Result
      setResult(body)
      if (action === 'sign-in') {
        setCaptchaToken(null)
        setCaptchaResetKey((current) => current + 1)
        if (body.ok) setSignedIn(true)
      }
      if (body.factorId) setFactorId(body.factorId)
      if (body.ok && body.redirectTo) window.location.assign(body.redirectTo)
    } catch {
      setResult({ error: 'The protected session request was interrupted. Try again.' })
    } finally {
      setPending(false)
    }
  }

  const handler = (action: string) => (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit(event.currentTarget, action)
  }

  return <div style={{ display: 'grid', gap: 20, marginTop: 20 }}>
    {!signedIn ? <form onSubmit={handler('sign-in')} style={{ display: 'grid', gap: 12 }}>
      <label>Founder password<input name="password" type="password" required autoComplete="current-password" /></label>
      <TurnstileChallenge
        key={captchaResetKey}
        action="ops-auth"
        appearance="always"
        siteKey={turnstileSiteKey}
        onTokenChange={setCaptchaToken}
      />
      <button className="ops-button ops-button-primary" type="submit" disabled={pending || Boolean(turnstileSiteKey) && !captchaToken}>
        {pending ? 'Checking…' : 'Continue to authenticator'}
      </button>
      <a href="https://drapeon.co/account/recovery">Forgot the founder Supabase password?</a>
    </form> : <>
      {!factorId ? <form onSubmit={handler('enroll')}>
        <button className="ops-button" type="submit" disabled={pending}>Set up founder authenticator</button>
      </form> : null}
      {result.qrCode ? <div>
        <p>Scan this QR code in the founder authenticator. The secret stays in your authenticator and this browser.</p>
        <Image src={result.qrCode} alt="Founder TOTP enrollment QR code" width={240} height={240} unoptimized />
      </div> : null}
      <form onSubmit={handler('verify')} style={{ display: 'grid', gap: 12 }}>
        <input type="hidden" name="factorId" value={factorId} />
        <label>Authenticator code<input name="code" inputMode="numeric" pattern="[0-9]{6}" required autoComplete="one-time-code" /></label>
        <button className="ops-button ops-button-primary" type="submit" disabled={pending || !factorId}>
          {pending ? 'Verifying…' : 'Open trust review'}
        </button>
      </form>
    </>}
    {result.error ? <p role="alert">{result.error}</p> : null}
    {result.message ? <p role="status">{result.message}</p> : null}
  </div>
}
