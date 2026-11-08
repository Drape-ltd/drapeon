const assert = require('node:assert/strict')
const test = require('node:test')

const { ensureReleaseMinifyProperty } = require('./with-android-release-minify')

test('release shrinking also enables the Gradle template minifier property', () => {
  const result = ensureReleaseMinifyProperty([
    { type: 'property', key: 'android.enableShrinkResourcesInReleaseBuilds', value: 'true' },
    { type: 'property', key: 'android.enableProguardInReleaseBuilds', value: 'true' },
    { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'false' },
  ])

  assert.deepEqual(result.filter((entry) => entry.key === 'android.enableMinifyInReleaseBuilds'), [
    { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'true' },
  ])
  assert.equal(result.find((entry) => entry.key === 'android.enableShrinkResourcesInReleaseBuilds')?.value, 'true')
})
