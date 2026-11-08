const { withGradleProperties } = require('expo/config-plugins')

const MINIFY_PROPERTY = 'android.enableMinifyInReleaseBuilds'

function ensureReleaseMinifyProperty(properties) {
  return [
    ...properties.filter(
      (entry) => entry.type !== 'property' || entry.key !== MINIFY_PROPERTY
    ),
    { type: 'property', key: MINIFY_PROPERTY, value: 'true' },
  ]
}

module.exports = function withAndroidReleaseMinify(config) {
  return withGradleProperties(config, (modConfig) => {
    modConfig.modResults = ensureReleaseMinifyProperty(modConfig.modResults)
    return modConfig
  })
}

module.exports.ensureReleaseMinifyProperty = ensureReleaseMinifyProperty
