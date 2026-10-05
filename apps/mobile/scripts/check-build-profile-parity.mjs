import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { buildProfileParityErrors } from './build-profile-parity.mjs'

const mobileRoot = fileURLToPath(new URL('..', import.meta.url))
const easConfig = JSON.parse(await readFile(new URL('../eas.json', import.meta.url), 'utf8'))
const featureFlagSource = await readFile(new URL('../lib/feature-flags.ts', import.meta.url), 'utf8')
const webWorkerConfig = JSON.parse(await readFile(new URL('../../web/wrangler.jsonc', import.meta.url), 'utf8'))

const errors = buildProfileParityErrors(easConfig, webWorkerConfig, featureFlagSource)

if (errors.length > 0) {
  console.error(`Mobile build-profile parity failed in ${mobileRoot}:`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Release UI flags agree across development, preview, TestFlight, production mobile, and production web.')
