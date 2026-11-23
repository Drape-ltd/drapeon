import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const orderMediaWriters = [
  'apps/web/features/account/brief/brief-form.tsx',
  'apps/web/features/account/orders/order-action-helpers.tsx',
  'apps/web/features/account/orders/order-detail-workspace.tsx',
  'apps/web/features/account/studio-workspace/studio-workspace.tsx',
  'apps/mobile/lib/storage-upload.ts',
  'apps/mobile/app/(customer)/brief/[tailorId].tsx',
  'supabase/functions/studio-order-action/index.ts',
]

test('order-media writers do not persist a public object URL', async () => {
  for (const file of orderMediaWriters) {
    const source = await readFile(file, 'utf8')
    const directOrderPhotoPublicUrl = /from\(['"]order-photos['"]\)\.getPublicUrl\(/u.test(source)
    assert.equal(directOrderPhotoPublicUrl, false, `${file} creates a public order-media URL`)
  }
})
