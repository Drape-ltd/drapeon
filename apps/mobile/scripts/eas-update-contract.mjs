import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export function easUpdateContractErrors(appConfig, easConfig, packageConfig) {
  const errors = []
  const projectId = appConfig.expo?.extra?.eas?.projectId
  if (!packageConfig.dependencies?.['expo-updates']) errors.push('expo-updates must be a mobile dependency')
  if (!projectId || appConfig.expo?.updates?.url !== `https://u.expo.dev/${projectId}`) {
    errors.push('updates.url must match the Expo project ID')
  }
  if (appConfig.expo?.runtimeVersion?.policy !== 'appVersion') {
    errors.push('runtimeVersion must use the appVersion policy')
  }
  if (appConfig.expo?.updates?.checkAutomatically !== 'ON_LOAD') {
    errors.push('updates must be checked on app launch')
  }

  const channels = {
    development: 'development',
    'development-device': 'development',
    preview: 'preview',
    testflight: 'staging',
    production: 'production',
  }
  for (const [profile, channel] of Object.entries(channels)) {
    if (easConfig.build?.[profile]?.channel !== channel) {
      errors.push(`${profile} must use the ${channel} update channel`)
    }
  }
  if (easConfig.build?.testflight?.env?.EXPO_PUBLIC_SUPABASE_ENV !== 'production' ||
      easConfig.build?.production?.env?.EXPO_PUBLIC_SUPABASE_ENV !== 'production') {
    errors.push('store builds must use the production Supabase environment')
  }
  return errors
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [appConfig, easConfig, packageConfig] = await Promise.all(
    ['../app.json', '../eas.json', '../package.json'].map(async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')))
  )
  const errors = easUpdateContractErrors(appConfig, easConfig, packageConfig)
  for (const error of errors) console.error(`[EAS Update] ${error}`)
  if (errors.length) process.exitCode = 1
  else console.log('EAS Update runtime, URL, environment, and channels are configured for the next build.')
}
