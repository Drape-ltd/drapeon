import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  assertCloudflareProductionBuildBranch,
  resolveCloudflareBuildMode,
} from './cf-build-mode.mjs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('local preview remains local without a Workers Build branch', () => {
  assert.equal(resolveCloudflareBuildMode({ forcedMode: undefined, workersCiBranch: null }), 'preview')
})

test('explicit production deploy is allowed on main', () => {
  assert.equal(resolveCloudflareBuildMode({ forcedMode: 'deploy', workersCiBranch: 'main' }), 'deploy')
})

test('explicit production deploy is rejected from non-production branches', () => {
  assert.throws(() => resolveCloudflareBuildMode({ forcedMode: 'deploy', workersCiBranch: 'codex/ops-waiver-20261002' }), /Refusing production deploy/u)
})

test('non-production Workers Builds finish without promoting or publishing', () => {
  assert.equal(resolveCloudflareBuildMode({ forcedMode: undefined, workersCiBranch: 'codex/ops-waiver-20261002' }), 'skip')
})

test('an explicit Workers Build preview is rejected until isolated resources exist', () => {
  assert.throws(() => resolveCloudflareBuildMode({ forcedMode: 'preview', workersCiBranch: 'codex/ops-waiver-20261002' }), /isolated preview resources/u)
})

test('a Workers Build can prepare the production bundle only on main', () => {
  assert.doesNotThrow(() => assertCloudflareProductionBuildBranch({
    workersCi: '1',
    workersCiBuildUuid: 'build-id',
    workersCiBranch: 'main',
  }))
  assert.throws(() => assertCloudflareProductionBuildBranch({
    workersCi: '1',
    workersCiBuildUuid: 'build-id',
    workersCiBranch: 'codex/phase3-bachs-integration',
  }), /only main may build/u)
})

test('a Workers Build with missing branch metadata fails closed before deployment', () => {
  assert.throws(() => assertCloudflareProductionBuildBranch({
    workersCi: '1',
    workersCiBuildUuid: 'build-id',
    workersCiBranch: undefined,
  }), /branch unknown/u)
})

test('a local manual production build remains available outside Workers Builds', () => {
  assert.doesNotThrow(() => assertCloudflareProductionBuildBranch({
    workersCi: undefined,
    workersCiBuildUuid: undefined,
    workersCiBranch: undefined,
  }))
})

test('the standard web build runs the Workers production-branch guard before building', () => {
  assert.match(packageJson.scripts.prebuild, /cf-build-branch-guard\.mjs/u)
  assert.match(packageJson.scripts['cf:build'], /cf-build\.mjs/u)
  assert.equal(existsSync(new URL('./cf-build-branch-guard.mjs', import.meta.url)), true)
})
