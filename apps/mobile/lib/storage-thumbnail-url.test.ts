import assert from 'node:assert/strict'
import test from 'node:test'
import { publicStorageThumbnailUrl } from './storage-thumbnail-url.ts'

const projectOrigin = 'https://auth.example.com'
const canonicalOrigin = 'https://abcdefghijklmnopqrst.supabase.co'
const original = `${projectOrigin}/storage/v1/object/public/portfolio-photos/tailor/look.png`

test('converts only a matching public portfolio image', () => {
  assert.equal(
    publicStorageThumbnailUrl(original, 'portfolio-photos', projectOrigin, canonicalOrigin, 360),
    `${projectOrigin}/storage/v1/render/image/public/portfolio-photos/tailor/look.png?width=360&quality=72`,
  )
  assert.match(
    publicStorageThumbnailUrl(original.replace(projectOrigin, canonicalOrigin), 'portfolio-photos', projectOrigin, canonicalOrigin, 360),
    /\/render\/image\/public\/portfolio-photos\//,
  )
})

test('preserves external, signed, queried, and other-bucket URLs', () => {
  for (const url of [
    original.replace(projectOrigin, 'https://unrelated.example.com'),
    original.replace('/object/public/', '/object/sign/'),
    `${original}?token=private`,
    original.replace('/portfolio-photos/', '/order-photos/'),
  ]) {
    assert.equal(publicStorageThumbnailUrl(url, 'portfolio-photos', projectOrigin, canonicalOrigin, 360), url)
  }
})
