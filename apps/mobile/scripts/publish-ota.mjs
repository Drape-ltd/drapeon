#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { runReleaseSourceGuard } from '../../../scripts/release-source-guard.mjs'

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(mobileRoot, '../..')

export function otaPlan(config, channel, sha) {
  const profileName = { staging: 'testflight', production: 'production' }[channel]
  if (!profileName) throw new Error('Channel must be staging or production.')
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error('A full commit SHA is required.')
  const profile = config.build?.[profileName]
  if (profile?.channel !== channel || profile.environment !== 'production') {
    throw new Error(`${profileName} must use channel ${channel} and the production EAS environment.`)
  }
  if (profile.env?.EXPO_PUBLIC_SUPABASE_ENV !== 'production') {
    throw new Error(`${profileName} must target the production backend.`)
  }
  const publicEnv = Object.fromEntries(Object.entries(profile.env).filter(([key]) => key.startsWith('EXPO_PUBLIC_')))
  if (publicEnv.EXPO_PUBLIC_APP_VARIANT !== profileName) {
    throw new Error(`${profileName} app variant does not match its build profile.`)
  }
  return {
    profileName,
    channel,
    env: { ...publicEnv, EXPO_PUBLIC_RELEASE_SHA: sha },
    args: ['update', '--channel', channel, '--environment', 'production', '--platform', 'all', '--message', `Release ${sha.slice(0, 12)} (${channel})`, '--non-interactive'],
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`)
}

function main() {
  const [channel, approval, ...extra] = process.argv.slice(2)
  const dryRun = extra.length === 1 && extra[0] === '--dry-run'
  if (extra.length && !dryRun) throw new Error('Unexpected arguments.')
  if (channel === 'staging' && approval !== '--staging-build-installed') {
    throw new Error('Staging requires --staging-build-installed; verify the binary actually uses the staging channel.')
  }
  if (channel === 'production' && !['--staging-verified', '--direct-approved'].includes(approval)) {
    throw new Error('Production requires --staging-verified or --direct-approved.')
  }
  if (!runReleaseSourceGuard(repoRoot)) throw new Error('OTA source must be clean, live main.')
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const config = JSON.parse(readFileSync(resolve(mobileRoot, 'eas.json'), 'utf8'))
  const plan = otaPlan(config, channel, sha)
  run('node', ['apps/mobile/scripts/release-ui-gates.mjs'])
  run('node', ['apps/mobile/scripts/eas-update-contract.mjs'])
  run('node', ['apps/mobile/scripts/check-build-profile-parity.mjs'])
  run('pnpm', ['studio:build'])
  if (!runReleaseSourceGuard(repoRoot)) throw new Error('Preflight changed the source checkout.')
  if (dryRun) {
    console.log(`[OTA dry run] ${plan.profileName} -> ${plan.channel}, SHA ${sha}`)
    console.log(`[OTA dry run] ${plan.args.join(' ')}`)
    return
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('EXPO_PUBLIC_')))
  Object.assign(env, plan.env)
  const result = spawnSync('eas', plan.args, { cwd: mobileRoot, stdio: 'inherit', env })
  if (result.status !== 0) throw new Error(`EAS Update failed with exit code ${result.status ?? 'unknown'}.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(`[OTA] ${error.message}`); process.exitCode = 1 }
}
