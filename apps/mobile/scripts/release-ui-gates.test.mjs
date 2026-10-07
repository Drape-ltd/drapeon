import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseUiGateErrors } from './release-ui-gates.mjs'

const released = {
  'features/explore/ExploreCategoryChips.tsx': "{ id: 'studio', label: 'Sketch Room'",
  'features/studio/StudioEntry.tsx': 'Open Sketch Room',
  'features/studio/StudioScreen.tsx': 'Sign in to use Sketch Room',
  'features/user-education/EducationTools.tsx': 'Open Sketch Room',
}

test('required mobile release surfaces pass', () => {
  assert.deepEqual(releaseUiGateErrors(released), [])
})

test('Studio-style development gate blocks release', () => {
  const sources = { ...released, 'features/studio/availability.ts': 'export const enabled = __DEV__ && process.env.EXPO_PUBLIC_SUPABASE_ENV === \'development\'' }
  assert.match(releaseUiGateErrors(sources).join('\n'), /development-only gate/)
  assert.match(releaseUiGateErrors(sources).join('\n'), /environment-specific product UI gate/)
})

test('a removed release entry point blocks release', () => {
  const sources = { ...released, 'features/explore/ExploreCategoryChips.tsx': '' }
  assert.match(releaseUiGateErrors(sources).join('\n'), /required release surface is missing/)
})

test('another gate in a previously approved file still blocks release', () => {
  const sources = { ...released, 'app/_layout.tsx': '{__DEV__ && (\n{__DEV__ && (' }
  const baseline = { 'app/_layout.tsx': { '{__DEV__ && (': 1 } }
  assert.match(releaseUiGateErrors(sources, baseline).join('\n'), /new development-only gate/)
})
