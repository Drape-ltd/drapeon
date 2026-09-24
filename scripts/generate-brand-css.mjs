#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve from the script location rather than the caller's cwd. Next/OpenNext
// runs package lifecycle scripts from apps/web, while local contract checks
// often run them from the monorepo root.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const designSystemPath = path.join(root, 'packages/shared/src/design-system.ts')
const outputPath = path.join(root, 'apps/web/app/brand-tokens.css')
const source = fs.readFileSync(designSystemPath, 'utf8')
const colorsBlock = source.match(/export const colors = \{([\s\S]*?)\n\} as const/u)?.[1]
const scalesBlock = source.match(/export const colorScales = \{([\s\S]*?)\n\} as const/u)?.[1]

if (!colorsBlock) {
  console.error(
    'Could not locate the canonical colors object in packages/shared/src/design-system.ts.'
  )
  process.exit(1)
}

const requiredTokens = [
  ['background', 'background'],
  ['surface', 'surface'],
  ['status-muted-bg', 'statusMutedBg'],
  ['text-primary', 'textPrimary'],
  ['text-secondary', 'textSecondary'],
  ['primary', 'primary'],
  ['primary-dark', 'primaryDark'],
  ['status-error', 'statusError'],
  ['border', 'border'],
]

const requiredIllustrationTokens = [['illustration-highlight', 'colorScales.needle.200']]

function resolveToken(sourceName) {
  if (sourceName.startsWith('colorScales.')) {
    const [, scaleName, shade] = sourceName.match(/^colorScales\.([^.]+)\.(\d+)$/u) ?? []
    const scale = scalesBlock?.match(new RegExp(`${shade}:\\s*'([^']+)'`, 'u'))?.[1]
    if (!scaleName || !scale) return null
    return scale
  }
  return colorsBlock?.match(new RegExp(`\\b${sourceName}:\\s*'([^']+)'`, 'u'))?.[1] ?? null
}

const values = Object.fromEntries(
  requiredTokens.map(([cssName, sourceName]) => {
    const value = resolveToken(sourceName)
    if (!value) {
      console.error(`Canonical brand token is missing: colors.${sourceName}`)
      process.exit(1)
    }
    return [cssName, value.toLowerCase()]
  })
)

const generated = `/* Generated from packages/shared/src/design-system.ts. Do not edit by hand. */
:root {
${requiredTokens.map(([cssName]) => `  --drapeon-${cssName}: ${values[cssName].toLowerCase()};`).join('\n')}
${requiredIllustrationTokens.map(([cssName, sourceName]) => `  --drapeon-${cssName}: ${resolveToken(sourceName).toLowerCase()};`).join('\n')}
}
`

const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : ''
if (current !== generated) fs.writeFileSync(outputPath, generated)

console.log(
  `${current === generated ? 'Brand CSS is current' : 'Generated brand CSS'}: ${path.relative(root, outputPath)}`
)
