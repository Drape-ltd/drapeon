#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const errors = []

function read(relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8')
  } catch {
    errors.push(`Missing media-health surface: ${relativePath}`)
    return ''
  }
}

function requireText(relativePath, needle) {
  if (!read(relativePath).includes(needle)) errors.push(`${relativePath} is missing ${needle}.`)
}

requireText('apps/web/components/public-media.tsx', 'reportPublicMediaFailure(src)')
requireText('apps/web/components/public-media.tsx', 'Media temporarily unavailable')
requireText('apps/web/components/public-media.tsx', 'export function PublicMediaVideo')
requireText('apps/web/components/public-media.tsx', 'video.networkState === 3')
requireText('apps/web/app/api/media-health/route.ts', 'export async function POST')
requireText('apps/web/app/api/media-health/route.ts', 'alert handoff failed')
requireText('supabase/functions/media-health-report/index.ts', 'createOrRefreshOpsIssue')
requireText('supabase/functions/media-health-report/index.ts', "const dedupeKey = `public-media:${host}:${path}`")
requireText('apps/web/app/media-health-preview/page.tsx', '<PublicMediaImage')
requireText('apps/web/app/media-health-preview/page.tsx', '<PublicMediaVideo')
requireText('apps/web/tests/e2e/media-health.spec.ts', "Media temporarily unavailable', { exact: true })).toHaveCount(2")

const contract = read('config/release-contract.json')
if (!contract.includes('"marketplace.media"')) errors.push('Release contract is missing marketplace.media.')

if (errors.length) {
  console.error('Media health surface check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Media health surface check passed.')
console.log('- Public fallback, safe reporting, deduped Ops handoff, and headed evidence are bound.')
