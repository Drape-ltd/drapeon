import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const resolveAppConfig = require('../app.config.js')

const expected = {
  development: {
    name: 'Drapeon Dev',
    scheme: 'drape-dev',
    iosBundleIdentifier: 'co.drapeon.app.dev',
    androidPackage: 'com.drape.app',
  },
  preview: {
    name: 'Drapeon Preview',
    scheme: 'drape-preview',
    iosBundleIdentifier: 'co.drapeon.app.preview',
    androidPackage: 'com.drape.app.preview',
  },
  testflight: {
    name: 'Drapeon',
    scheme: 'drape',
    iosBundleIdentifier: 'co.drapeon.app',
    androidPackage: 'com.drape.app',
  },
  production: {
    name: 'Drapeon',
    scheme: 'drape',
    iosBundleIdentifier: 'co.drapeon.app',
    androidPackage: 'com.drape.app',
  },
}

const previousVariant = process.env.EXPO_PUBLIC_APP_VARIANT
const errors = []

for (const [variant, identity] of Object.entries(expected)) {
  process.env.EXPO_PUBLIC_APP_VARIANT = variant
  const config = resolveAppConfig()

  if (config.name !== identity.name) {
    errors.push(`${variant} app name must be "${identity.name}", received "${config.name}"`)
  }
  if (config.scheme !== identity.scheme) {
    errors.push(`${variant} scheme must be "${identity.scheme}", received "${config.scheme}"`)
  }
  if (config.ios?.bundleIdentifier !== identity.iosBundleIdentifier) {
    errors.push(
      `${variant} iOS bundle identifier must be "${identity.iosBundleIdentifier}", received "${config.ios?.bundleIdentifier}"`
    )
  }
  if (config.android?.package !== identity.androidPackage) {
    errors.push(
      `${variant} Android package must be "${identity.androidPackage}", received "${config.android?.package}"`
    )
  }
}

if (previousVariant === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT
else process.env.EXPO_PUBLIC_APP_VARIANT = previousVariant

if (errors.length > 0) {
  console.error('Mobile app identity checks failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Mobile identities are isolated across Dev, Preview, and Store installs.')
