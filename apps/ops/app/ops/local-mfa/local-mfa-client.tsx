'use client'

import { useState } from 'react'

type Result = { ok?: boolean; error?: string; qrCode?: string; factorId?: string; needsMfa?: boolean; message?: string }

export function LocalMfaClient() {
  const [result, setResult] = useState<Result>({})
  const [factorId, setFactorId] = useState('')
  const submit = async (form: HTMLFormElement, action?: string) => {
    const data = new FormData(form)
    if (action) data.set('action', action)
    const response = await fetch('/api/local-mfa-session', { method: 'POST', body: data })
    const body = await response.json() as Result
    setResult(body)
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
      <button className="ops-button ops-button-primary" type="submit" name="action" value="sign-in">Sign in</button>
      <button className="ops-button" type="submit" name="action" value="sign-up">Create this Dev Auth user</button>
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
