'use client'

import { useState } from 'react'
import { TurnstileChallenge } from '../../../../web/components/turnstile-challenge'

type Result = { ok?: boolean; error?: string; qrCode?: string; factorId?: string; needsMfa?: boolean; message?: string }

export function LocalMfaClient({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [result, setResult] = useState<Result>({})
  const [factorId, setFactorId] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const submit = async (form: HTMLFormElement, action?: string) => {
    const data = new FormData(form)
    if (action) data.set('action', action)
    if (action === 'sign-in' || action === 'sign-up') {
      if (!captchaToken) {
        setResult({ error: 'Complete the security check before continuing.' })
        return
      }
      data.set('captchaToken', captchaToken)
    }
    const response = await fetch('/api/local-mfa-session', { method: 'POST', body: data })
    const body = await response.json() as Result
    setResult(body)
    if (action === 'sign-in' || action === 'sign-up') {
      setCaptchaToken(null)
      setCaptchaResetKey((current) => current + 1)
    }
    if (body.factorId) setFactorId(body.factorId)
    if (body.ok && !body.qrCode && !body.needsMfa) window.location.assign('/ops/my-work')
  }
  const handler = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const action = (event.nativeEvent as SubmitEvent).submitter instanceof HTMLButtonElement
      ? ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement).value
      : undefined
    void submit(event.currentTarget, action)
  }
  return <div style={{ display: 'grid', gap: 20, marginTop: 20 }}>
    <form onSubmit={handler} style={{ display: 'grid', gap: 12 }}>
      <label>Email<input name="email" type="email" required autoComplete="username" /></label>
      <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
      <TurnstileChallenge
        key={captchaResetKey}
        action="ops-auth"
        appearance="always"
        siteKey={turnstileSiteKey}
        onTokenChange={setCaptchaToken}
      />
      <button className="ops-button ops-button-primary" type="submit" name="action" value="sign-in" disabled={!captchaToken}>Sign in</button>
      <button className="ops-button" type="submit" name="action" value="sign-up" disabled={!captchaToken}>Create this Dev Auth user</button>
    </form>
    <form onSubmit={handler}><input type="hidden" name="action" value="enroll" /><button className="ops-button" type="submit">Enroll a new TOTP authenticator</button></form>
    {result.qrCode ? <div><p>Scan this QR code as a separate authenticator entry.</p><img src={result.qrCode} alt="TOTP enrollment QR code" style={{ maxWidth: 240 }} /></div> : null}
    <form onSubmit={handler} style={{ display: 'grid', gap: 12 }}>
      <input type="hidden" name="action" value="verify" />
      <label>Factor ID<input name="factorId" required value={factorId} onChange={(event) => setFactorId(event.target.value)} /></label>
      <label>Authenticator code<input name="code" inputMode="numeric" pattern="[0-9]{6}" required autoComplete="one-time-code" /></label>
      <button className="ops-button ops-button-primary" type="submit">Verify MFA and continue</button>
    </form>
    {result.error ? <p role="alert">{result.error}</p> : null}
    {result.message ? <p>{result.message}</p> : null}
  </div>
}
