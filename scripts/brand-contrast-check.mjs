#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const source = read('packages/shared/src/design-system.ts')
const errors = []

function token(name, occurrence = 0) {
  const matches = [...source.matchAll(new RegExp(`\\b${name}:\\s*'([^']+)'`, 'gu'))]
  return matches[occurrence]?.[1] ?? null
}

function hexToRgb(value) {
  const hex = value.replace('#', '')
  if (hex.length === 3) return [...hex].map((part) => Number.parseInt(`${part}${part}`, 16))
  if (hex.length !== 6) return null
  return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
}

function luminance(value) {
  const rgb = hexToRgb(value)
  if (!rgb) return null
  return rgb.reduce((sum, channel, index) => {
    const linear = channel / 255 <= 0.03928
      ? channel / 255 / 12.92
      : ((channel / 255 + 0.055) / 1.055) ** 2.4
    return sum + linear * [0.2126, 0.7152, 0.0722][index]
  }, 0)
}

function contrast(foreground, background) {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  if (foregroundLuminance === null || backgroundLuminance === null) return null
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

const colors = {
  background: token('background', 0),
  surface: token('surface', 0),
  primary: token('primary', 0),
  textPrimary: token('textPrimary', 0),
  textSecondary: token('textSecondary', 0),
  textInverse: token('textInverse', 0),
  accent: token('accent', 0),
}
const darkColors = {
  background: token('background', 1),
  primary: token('primary', 1),
  textPrimary: token('textPrimary', 1),
  textSecondary: token('textSecondary', 1),
  textInverse: token('textInverse', 1),
}
const rustScale = source.match(/rust:\s*\{([\s\S]*?)\n  \}/u)?.[1] ?? ''
const rustText = rustScale.match(/600:\s*'([^']+)'/u)?.[1] ?? null

const pairs = [
  ['light body text on canvas', colors.textPrimary, colors.background, 4.5],
  ['light secondary text on canvas', colors.textSecondary, colors.background, 4.5],
  ['light inverse text on primary action', colors.textInverse, colors.primary, 4.5],
  ['rust text-safe shade on canvas', rustText, colors.background, 4.5],
  ['dark body text on canvas', darkColors.textPrimary, darkColors.background, 4.5],
  ['dark secondary text on canvas', darkColors.textSecondary, darkColors.background, 4.5],
  ['dark inverse text on primary action', darkColors.textInverse, darkColors.primary, 4.5],
]

for (const [name, foreground, background, minimum] of pairs) {
  if (!foreground || !background) {
    errors.push(`${name} is missing a canonical token.`)
    continue
  }
  const ratio = contrast(foreground, background)
  if (ratio === null || ratio < minimum) {
    errors.push(`${name} must meet ${minimum}:1 contrast (found ${ratio?.toFixed(2) ?? 'invalid'}:1).`)
  }
}

if (colors.accent && colors.surface) {
  const accentRatio = contrast(colors.accent, colors.surface)
  if (accentRatio !== null && accentRatio >= 4.5) {
    errors.push('Kanté rust is currently safe as an accent; keep body-text usage on the rust-safe shade contract instead.')
  }
}

if (errors.length) {
  console.error('Brand contrast check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Brand contrast check passed.')
for (const [name, foreground, background] of pairs) {
  console.log(`- ${name}: ${contrast(foreground, background)?.toFixed(2)}:1`)
}
console.log('- Kanté rust remains accent-only on light surfaces; use the rust-600 shade for text.')
