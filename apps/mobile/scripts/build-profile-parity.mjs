export function buildProfileParityErrors(easConfig, webWorkerConfig, featureFlagSource) {
  const shippedUiFlags = [
    'EXPO_PUBLIC_DRAPE_INTERACTION_SYSTEM_V1',
    'EXPO_PUBLIC_QUOTE_NEGOTIATION_V1',
    'EXPO_PUBLIC_CHAT_ORDER_ACTIONS_V1',
    'EXPO_PUBLIC_DRAPE_VISION_UI_V2',
  ]
  const profiles = ['development', 'development-device', 'preview', 'testflight', 'production']
  const defaultOffFlags = ['EXPO_PUBLIC_DARK_THEME_V1', 'EXPO_PUBLIC_GROUP_ORDERS_V1']
  const errors = []

  for (const profileName of profiles) {
    const profile = easConfig.build?.[profileName]
    for (const flag of shippedUiFlags) {
      if (profile?.env?.[flag] !== 'true') {
        errors.push(`${profileName} must set ${flag}="true"`)
      }
    }
    for (const flag of defaultOffFlags) {
      if (profile?.env?.[flag] !== 'false') {
        errors.push(`${profileName} must set ${flag}="false" until the feature is enabled`)
      }
    }
  }

  if (webWorkerConfig.vars?.NEXT_PUBLIC_QUOTE_NEGOTIATION_V1 !== 'true') {
    errors.push('production web must enable NEXT_PUBLIC_QUOTE_NEGOTIATION_V1 alongside mobile quote negotiation')
  }

  if (/drapeVisionUiV2:\s*__DEV__/.test(featureFlagSource)) {
    errors.push('drapeVisionUiV2 must not use __DEV__; EAS profiles own shipped UI behavior')
  }

  return errors
}
