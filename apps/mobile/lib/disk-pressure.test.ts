import assert from 'node:assert/strict'
import test from 'node:test'
import { isDiskFullManifestError, selectTransientCacheRemovals } from './disk-pressure-policy.ts'

test('recognizes only disk-full manifest failures', () => {
  assert.equal(isDiskFullManifestError(new Error('manifest.json: No space left on device')), true)
  assert.equal(isDiskFullManifestError('Failed to write manifest: ENOSPC'), true)
  assert.equal(isDiskFullManifestError('No space left on device while writing photo.jpg'), false)
  assert.equal(isDiskFullManifestError('manifest.json failed validation'), false)
})

test('keeps the newest bounded transient files', () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    uri: `file://${index}`,
    size: 4_000_000,
    modifiedAt: index,
  }))

  assert.deepEqual(
    selectTransientCacheRemovals(entries).map(({ uri }) => uri),
    ['file://1', 'file://0'],
  )
})

test('removes the entry that crosses the byte cap and every older entry', () => {
  const entries = [
    { uri: 'file://new', size: 12_000_000, modifiedAt: 3 },
    { uri: 'file://middle', size: 10_000_000, modifiedAt: 2 },
    { uri: 'file://old', size: 1_000_000, modifiedAt: 1 },
  ]

  assert.deepEqual(
    selectTransientCacheRemovals(entries).map(({ uri }) => uri),
    ['file://middle', 'file://old'],
  )
})
