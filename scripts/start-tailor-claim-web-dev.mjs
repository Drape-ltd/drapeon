#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { dirname } from 'node:path'

const PROJECT_REF = 'pqptfuqogvrajozfsqzi'
const result = spawnSync('supabase', ['projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'], { encoding: 'utf8' })
if (result.status !== 0) throw new Error('Could not load development API keys.')
const keys = JSON.parse(result.stdout)
const publishableKey = keys.find((entry) => entry.name === 'default')?.api_key ?? keys.find((entry) => entry.name === 'anon')?.api_key
const serviceKey = keys.find((entry) => entry.name === 'service_role')?.api_key
if (!publishableKey || !serviceKey) throw new Error('Development API keys are unavailable.')

const child = spawn('pnpm', ['--filter', '@drape/web', 'dev'], {
  cwd: new URL('..', import.meta.url),
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
    DRAPEON_PUBLIC_SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
    DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    NEXT_PUBLIC_CLAIM_WEB_ORIGIN: 'http://127.0.0.1:3004',
  },
})
child.on('error', (error) => { console.error(error); process.exit(1) })
child.on('exit', (code, signal) => signal ? process.kill(process.pid, signal) : process.exit(code ?? 1))
