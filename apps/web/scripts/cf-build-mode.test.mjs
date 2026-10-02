import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCloudflareBuildMode } from './cf-build-mode.mjs'

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
