import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { readOpsRequestContext } from '../lib/ops-session-context.mjs'

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
