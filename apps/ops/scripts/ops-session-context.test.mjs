import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { readOpsRequestContext, readOpsRouteRequestContext } from '../lib/ops-session-context.mjs'

test('local Ops mode reads cookies from its own Next runtime', async () => {
  const calls = []
  const cookieStore = { get: () => undefined, getAll: () => [] }
  const context = await readOpsRequestContext('local-supabase-mfa', {
    cookies: async () => { calls.push('cookies'); return cookieStore },
    headers: async () => { calls.push('headers'); return new Headers() },
  })
  assert.deepEqual(calls, ['cookies'])
  assert.equal(context.cookies, cookieStore)
  assert.equal(context.headers, undefined)
})

test('Cloudflare Access reads headers from its own Next runtime', async () => {
  const calls = []
  const headerStore = new Headers({ 'cf-access-jwt-assertion': 'test' })
  const context = await readOpsRequestContext('cloudflare-access', {
    cookies: async () => { calls.push('cookies'); return {} },
    headers: async () => { calls.push('headers'); return headerStore },
  })
  assert.deepEqual(calls, ['headers'])
  assert.equal(context.headers, headerStore)
  assert.equal(context.cookies, undefined)
})

test('Ops route handlers use the request cookie store without ambient Next state', () => {
  const cookieStore = { get: () => ({ value: 'opaque-session' }), getAll: () => [{ value: 'opaque-session' }] }
  const request = { headers: new Headers(), cookies: cookieStore }
  assert.equal(readOpsRouteRequestContext('local-supabase-mfa', request).cookies, cookieStore)
  assert.equal(readOpsRouteRequestContext('cloudflare-access', request).headers, request.headers)
})

test('a plain route Request parses cookies and rejects ambiguous or malformed values', () => {
  const request = new Request('http://localhost/ops', {
    headers: { cookie: 'session=valid%2Etoken; duplicate=first; duplicate=second; malformed=%ZZ' },
  })
  const store = readOpsRouteRequestContext('local-supabase-mfa', request).cookies
  assert.equal(store.get('session')?.value, 'valid.token')
  assert.equal(store.get('duplicate'), undefined)
  assert.equal(store.getAll('duplicate').length, 2)
  assert.equal(store.get('malformed'), undefined)
})

test('Ops call sites use the Ops request-context wrapper', () => {
  const root = resolve(import.meta.dirname, '..')
  const offenders = []
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.next')) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!/\.[cm]?tsx?$/u.test(entry.name) || path.endsWith('lib/ops-session.ts')) continue
      const source = readFileSync(path, 'utf8')
      if (source.includes('getOpsSession') && /from ['"][^'"]*web\/lib\/ops-auth['"]/u.test(source)) {
        offenders.push(relative(root, path))
      }
    }
  }
  walk(root)
  assert.deepEqual(offenders, [])
})

test('every Ops route session check passes its own request', () => {
  const root = resolve(import.meta.dirname, '..', 'app')
  const offenders = []
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (entry.name !== 'route.ts') continue
      const source = readFileSync(path, 'utf8')
      if (source.includes('getOpsSession(') && !source.includes('getOpsSession(request)')) {
        offenders.push(relative(root, path))
      }
    }
  }
  walk(root)
  assert.deepEqual(offenders, [])
})
