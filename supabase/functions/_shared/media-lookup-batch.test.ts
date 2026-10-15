import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findBlockedMediaUrlsInBatches } from './media-lookup-batch.ts'

test('deduplicates and checks every media URL in bounded batches', async () => {
  const seen: string[][] = []
  const urls = Array.from({ length: 95 }, (_, index) => `https://example.com/${index}`)
  const blocked = await findBlockedMediaUrlsInBatches(
    [...urls, urls[0], ` ${urls[1]} `],
    async (batch) => {
      seen.push(batch)
      return new Set(batch.filter((url) => url.endsWith('/0') || url.endsWith('/94')))
    },
  )

  assert.deepEqual(seen.map((batch) => batch.length), [24, 24, 24, 23])
  assert.equal(new Set(seen.flat()).size, 95)
  assert.deepEqual([...blocked].sort(), [urls[0], urls[94]].sort())
})

test('handles empty input without making a lookup', async () => {
  let calls = 0
  const blocked = await findBlockedMediaUrlsInBatches([], async () => {
    calls++
    return new Set<string>()
  })
  assert.equal(calls, 0)
  assert.equal(blocked.size, 0)
})
