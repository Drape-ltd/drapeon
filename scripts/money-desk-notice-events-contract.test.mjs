import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const migration = readFileSync(new URL('supabase/migrations/20261112001443_money_desk_approval_notice_events.sql', root), 'utf8')
const writers = [
  'apps/ops/app/ops/api/actions/money/route.ts',
  'supabase/functions/ops-money-action/index.ts',
  'supabase/functions/notify-money-approval/index.ts',
]

test('the Money Desk event constraint accepts every approval email outcome written by Ops', () => {
  const emitted = new Set()
  for (const path of writers) {
    const source = readFileSync(new URL(path, root), 'utf8')
    for (const match of source.matchAll(/FOUNDER_APPROVAL_EMAIL_[A-Z_]+/gu)) emitted.add(match[0])
  }
  assert.deepEqual([...emitted].sort(), [
    'FOUNDER_APPROVAL_EMAIL_FAILED',
    'FOUNDER_APPROVAL_EMAIL_SENT',
    'FOUNDER_APPROVAL_EMAIL_SKIPPED',
  ])
  for (const event of emitted) assert.match(migration, new RegExp(`'${event}'`))
})
