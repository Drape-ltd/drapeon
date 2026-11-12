import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const defaultMobileRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const mobileRoot = resolve(process.env.DRAPE_MOBILE_ROOT || defaultMobileRoot)
const scratchRoot = mkdtempSync(join(tmpdir(), 'drape-android-prebuild-'))

try {
  for (const name of ['app.json', 'app.config.js', 'package.json', 'assets', 'plugins']) {
    cpSync(join(mobileRoot, name), join(scratchRoot, basename(name)), { recursive: true })
  }
  symlinkSync(join(mobileRoot, 'node_modules'), join(scratchRoot, 'node_modules'), 'dir')

  const prebuild = spawnSync(
    process.execPath,
    [join(mobileRoot, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'android', '--no-install'],
    {
      cwd: scratchRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: '1',
        EXPO_PUBLIC_APP_VARIANT: 'development',
        EXPO_PUBLIC_SUPABASE_ENV: 'development',
        EXPO_PUBLIC_SUPABASE_PROJECT_REF: 'pqptfuqogvrajozfsqzi',
      },
    }
  )
  assert.equal(prebuild.status, 0, `Expo prebuild failed:\n${prebuild.stdout}\n${prebuild.stderr}`)

  const properties = readFileSync(join(scratchRoot, 'android/gradle.properties'), 'utf8')
  const gradle = readFileSync(join(scratchRoot, 'android/app/build.gradle'), 'utf8')
  assert.match(gradle, /minifyEnabled enableMinifyInReleaseBuilds/u)
  assert.match(gradle, /shrinkResources enableShrinkResources\.toBoolean\(\)/u)
  assert.equal(
    /^android\.enableShrinkResourcesInReleaseBuilds=true$/mu.test(properties),
    true,
    'Prebuild must enable Android resource shrinking.'
  )
  assert.equal(
    /^android\.enableMinifyInReleaseBuilds=true$/mu.test(properties),
    true,
    'Prebuild must enable R8 when resource shrinking is enabled.'
  )
  console.log('Android prebuild enables R8 and resource shrinking together.')
} finally {
  rmSync(scratchRoot, { recursive: true, force: true })
}
