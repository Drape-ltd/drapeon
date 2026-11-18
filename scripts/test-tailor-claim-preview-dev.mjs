#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const PROJECT_REF = 'pqptfuqogvrajozfsqzi'
const token = process.argv[2]
if (!/^[A-Za-z0-9_-]{40,60}$/u.test(token ?? '')) throw new Error('Pass a valid development claim token.')

const linkedRef = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
if (linkedRef !== PROJECT_REF) throw new Error(`Refusing non-development project ${linkedRef}.`)
const keyResult = spawnSync('supabase', ['projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'], { encoding: 'utf8' })
if (keyResult.status !== 0) throw new Error('Could not load development API keys.')
const keys = JSON.parse(keyResult.stdout)
const key = keys.find((entry) => entry.name === 'default')?.api_key ?? keys.find((entry) => entry.name === 'anon')?.api_key
if (!key) throw new Error('Development publishable key is unavailable.')
const url = `https://${PROJECT_REF}.supabase.co`

const response = await fetch(`${url}/functions/v1/tailor-claim-action`, {
  method: 'POST',
  headers: { apikey: key, 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'RESOLVE', token }),
})
const body = await response.json()
if (!response.ok || body.actionable !== true || !body.preview?.profile || !Array.isArray(body.preview?.media)) {
  throw new Error(`Development preview failed (${response.status}): ${JSON.stringify(body)}`)
}
if (body.preview.media.some((item) => !/^preview-\d+$/u.test(item.id))) {
  throw new Error('Public preview leaked a database media identifier.')
}
if (!body.preview.media.some((item) => item.kind === 'AVATAR') || !body.preview.media.some((item) => item.kind === 'PHOTO')) {
  throw new Error('Public preview is missing required storefront media.')
}
console.log(JSON.stringify({
  result: 'tailor_claim_preview_passed',
  status: response.status,
  displayNamePresent: typeof body.preview.profile.displayName === 'string',
  mediaCount: body.preview.media.length,
  coverCount: body.preview.media.filter((item) => item.cover === true).length,
  identifiersAreOpaque: true,
}))
