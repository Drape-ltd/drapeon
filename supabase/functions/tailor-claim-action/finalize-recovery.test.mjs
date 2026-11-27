import assert from 'node:assert/strict'
import test from 'node:test'
import { publicClaimMediaObject, terminalFinalizeFailure } from './finalize-recovery.mjs'

test('only stable terminal SQLSTATEs reset a finalize receipt', () => {
  assert.equal(terminalFinalizeFailure({ code: 'P1101' }), 'FINALIZE_READINESS_CHANGED')
  assert.equal(terminalFinalizeFailure({ code: 'P1103' }), 'FINALIZE_MEDIA_CHANGED')
  assert.equal(terminalFinalizeFailure({ code: '40001' }), null)
  assert.equal(terminalFinalizeFailure({ code: 'PGRST301' }), null)
})

test('cleanup derives the same public object path as promotion', () => {
  assert.deepEqual(
    publicClaimMediaObject('profile-id', {
      id: 'media-id', storagePath: 'private/media-id', kind: 'PHOTO', contentType: 'image/webp',
    }),
    {
      draftMediaId: 'media-id', sourcePath: 'private/media-id', kind: 'PHOTO',
      contentType: 'image/webp', bucket: 'portfolio-photos',
      objectPath: 'claims/profile-id/media-id.webp',
    }
  )
  assert.equal(publicClaimMediaObject('profile-id', { kind: 'PHOTO' }), null)
})
