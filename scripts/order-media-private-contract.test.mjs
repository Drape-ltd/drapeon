import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
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

test('private order-media bucket migration follows its authorization policies', async () => {
  const migrationDirectory = 'supabase/migrations'
  const migrations = await readdir(migrationDirectory)
  const names = [
    '20261123190000_order_photo_private_party_read.sql',
    '20261123193000_order_photo_private_evidence_prefixes.sql',
    '20261123195000_make_order_photos_private.sql',
  ]

  for (const name of names) {
    assert.equal(migrations.includes(name), true, `missing order-media migration: ${name}`)
  }

  const [partyRead, evidencePrefixes, privateBucket] = names.map((name) => Number(name.slice(0, 14)))
  assert.ok(partyRead < privateBucket, 'private bucket must follow party-read policy')
  assert.ok(evidencePrefixes < privateBucket, 'private bucket must follow evidence-prefix policy')
})
