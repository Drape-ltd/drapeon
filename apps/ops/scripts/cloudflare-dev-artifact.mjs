import { existsSync, lstatSync, readFileSync, readlinkSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '..', '..')
const configPath = resolve(appDir, 'wrangler.dev.jsonc')
const artifactPath = resolve(appDir, '.open-next', 'cloudflare', 'next-env.mjs')
const devRef = 'pqptfuqogvrajozfsqzi'
const forbiddenKeys = [
  'DATABASE_URL', 'DIRECT_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'OPS_DASHBOARD_TOKEN', 'OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION',
  'OPS_LOCAL_WORKFORCE_DRY_RUN', 'OPS_LOCAL_SUPABASE_MFA',
  'BACHS_LIVE_API_KEY', 'PAYSTACK_SECRET_KEY', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'TURNSTILE_SECRET_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY',
]

const config = JSON.parse(readFileSync(configPath, 'utf8'))
if (config.name !== 'drape-ops-dev' || config.vars?.DRAPE_OPS_ENV !== 'development' ||
  config.vars?.DRAPE_EXPECTED_SUPABASE_PROJECT_REF !== devRef ||
  !String(config.vars?.NEXT_PUBLIC_SUPABASE_URL ?? '').includes(`${devRef}.supabase.co`)) {
  throw new Error('Dev Ops build configuration does not point only to Supabase Dev.')
}

const publicKey = process.env.DRAPE_DEV_SUPABASE_PUBLIC_KEY?.trim()
if (!publicKey) throw new Error('Dev Supabase public key is required for the Dev Ops build.')

const allowedHostKeys = [
  'CI', 'COREPACK_HOME', 'FORCE_COLOR', 'HOME', 'LANG', 'LC_ALL', 'LOGNAME',
  'NO_COLOR', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'PNPM_HOME',
  'SHELL', 'TERM', 'TMPDIR', 'USER',
]
const childEnv = Object.fromEntries(allowedHostKeys
  .filter((key) => typeof process.env[key] === 'string')
  .map((key) => [key, process.env[key]]))
childEnv.PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`
childEnv.NODE_ENV = 'production'
childEnv.NEXT_DIST_DIR = '.next'
childEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = publicKey
for (const [key, value] of Object.entries(config.vars)) {
  if (typeof value === 'string') childEnv[key] = value
}

const hidden = []
try {
  const dotenvNames = [
    '.env', '.env.local', '.env.production', '.env.production.local',
    '.env.development', '.env.development.local',
  ]
  for (const path of [appDir, repoDir].flatMap((dir) => dotenvNames.map((name) => resolve(dir, name)))) {
    if (!existsSync(path)) continue
    if (lstatSync(path).isSymbolicLink()) {
      const target = readlinkSync(path)
      unlinkSync(path)
      writeFileSync(path, '')
      hidden.push({ path, target })
    } else {
      const moved = `${path}.ops-dev-${process.pid}`
      if (existsSync(moved)) throw new Error('Temporary Dev Ops environment path already exists.')
      renameSync(path, moved)
      writeFileSync(path, '')
      hidden.push({ path, moved })
    }
  }
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('pnpm', ['exec', 'opennextjs-cloudflare', 'build', '--config', configPath], {
      cwd: appDir, env: childEnv, stdio: 'inherit',
    })
    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => signal
      ? rejectPromise(new Error(`Dev Ops build exited on signal ${signal}.`))
      : code === 0 ? resolvePromise() : rejectPromise(new Error(`Dev Ops build exited with code ${code ?? 1}.`)))
  })
  if (!existsSync(artifactPath)) throw new Error('Dev Ops OpenNext environment artifact is missing.')
  const artifact = readFileSync(artifactPath, 'utf8')
  if (forbiddenKeys.some((key) => artifact.includes(`"${key}"`)) ||
    artifact.includes('wkfsrunetmgjdtcurmoj') || artifact.includes('auth.drapeon.co')) {
    throw new Error('Dev Ops artifact contains a forbidden key or Production project reference.')
  }
  if (!artifact.includes(devRef)) throw new Error('Dev Ops artifact is missing the Dev project reference.')
} finally {
  for (const { path, moved, target } of hidden.reverse()) {
    if (existsSync(path)) unlinkSync(path)
    if (target) symlinkSync(target, path)
    else renameSync(moved, path)
  }
}
