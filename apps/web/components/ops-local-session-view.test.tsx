import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import * as React from 'react'
import { OpsLocalSessionView } from './ops-local-session-view'

test('expired local MFA session points to Dev Ops sign-in without claiming identity is valid', () => {
  const markup = renderToStaticMarkup(<OpsLocalSessionView reason="session-expired" />)

  assert.match(markup, /Your Ops session expired/)
  assert.match(markup, /http:\/\/127\.0\.0\.1:3006\/local-mfa/)
  assert.doesNotMatch(markup, /identity is valid|Cloudflare Access|Ops data could not load/)
})

test('an active local MFA session with unavailable data offers a retry', () => {
  const markup = renderToStaticMarkup(<OpsLocalSessionView reason="data-unavailable" />)

  assert.match(markup, /Ops data could not load/)
  assert.match(markup, /href="\/ops"/)
  assert.doesNotMatch(markup, /session expired|Cloudflare Access/)
})
