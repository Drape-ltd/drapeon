#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (Number(process.versions.node.split('.')[0]) < 22) {
  throw new Error('Run the mobile development server with Node 22 or newer.')
}

const PROJECT_REF = 'pqptfuqogvrajozfsqzi'
const keyResult = spawnSync(
  'supabase',
  ['projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'],
  { encoding: 'utf8' }
)
if (keyResult.status !== 0) throw new Error('Could not load development API keys.')
const keys = JSON.parse(keyResult.stdout)
const publishableKey =
  keys.find((entry) => entry.name === 'default')?.api_key ??
  keys.find((entry) => entry.name === 'anon')?.api_key
if (!publishableKey) throw new Error('Development publishable key is unavailable.')

const expoArgs = process.argv.slice(2)
console.log(`Starting mobile development server for Supabase project ${PROJECT_REF}.`)
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('../apps/mobile/node_modules/expo/bin/cli', import.meta.url)),
    'start',
    '--dev-client',
    '--lan',
    ...expoArgs,
  ],
  {
    cwd: fileURLToPath(new URL('../apps/mobile', import.meta.url)),
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_PUBLIC_APP_VARIANT: 'development',
      EXPO_PUBLIC_SUPABASE_ENV: 'development',
      EXPO_PUBLIC_SUPABASE_PROJECT_REF: PROJECT_REF,
      EXPO_PUBLIC_SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      EXPO_PUBLIC_TAILOR_CLAIM_GOOGLE_ENABLED: 'false',
    },
  }
)

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
