import assert from 'node:assert/strict'
import test from 'node:test'
import { validateReleaseSource } from './release-source-guard.mjs'

const sha = 'a'.repeat(40)
const valid = { branch: 'main', status: '', head: sha, remoteHead: sha }

test('accepts only a clean checkout of the live main commit', () => {
  assert.deepEqual(validateReleaseSource(valid), [])
})

test('rejects daily development and staging branches', () => {
  assert.match(validateReleaseSource({ ...valid, branch: 'develop' }).join(' '), /require main/u)
  assert.match(validateReleaseSource({ ...valid, branch: 'staging' }).join(' '), /require main/u)
})

test('rejects dirty or stale release sources', () => {
  assert.match(validateReleaseSource({ ...valid, status: '?? apps/mobile/new.tsx' }).join(' '), /uncommitted/u)
  assert.match(validateReleaseSource({ ...valid, remoteHead: 'b'.repeat(40) }).join(' '), /does not match/u)
})

test('fails closed when the live main ref is unavailable', () => {
  assert.match(validateReleaseSource({ ...valid, remoteHead: '' }).join(' '), /live origin\/main/u)
})
