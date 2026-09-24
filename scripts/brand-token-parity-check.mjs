#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const designSystem = read('packages/shared/src/design-system.ts')
const globals = read('apps/web/app/globals.css')
const generatedBrandCss = read('apps/web/app/brand-tokens.css')
const tailwind = read('apps/web/tailwind.config.ts')
const errors = []

const tokens = {
  background: /background:\s*'([^']+)'/u,
  surface: /surface:\s*'([^']+)'/u,
  textPrimary: /textPrimary:\s*'([^']+)'/u,
  textSecondary: /textSecondary:\s*'([^']+)'/u,
  primary: /primary:\s*'([^']+)'/u,
  primaryDark: /primaryDark:\s*'([^']+)'/u,
  border: /border:\s*'([^']+)'/u,
  statusMutedBg: /statusMutedBg:\s*'([^']+)'/u,
  danger: /statusError:\s*'([^']+)'/u,
}

const values = Object.fromEntries(
  Object.entries(tokens).map(([name, pattern]) => {
    const match = designSystem.match(pattern)
    if (!match) errors.push(`Shared design-system token is missing: ${name}`)
    return [name, match?.[1]?.toLowerCase()]
  })
)

const cssVariables = {
  background: ['--background', '--drapeon-background'],
  surface: ['--surface', '--drapeon-surface'],
  textPrimary: ['--foreground', '--drapeon-text-primary'],
  textSecondary: ['--text-subtle', '--drapeon-text-secondary'],
  primary: ['--primary', '--drapeon-primary'],
  primaryDark: ['--primary-strong', '--drapeon-primary-dark'],
  border: ['--border', '--drapeon-border'],
  danger: ['--danger', '--drapeon-status-error'],
}

for (const [token, [variable, generatedVariable]] of Object.entries(cssVariables)) {
  const match = globals.match(new RegExp(`${variable}:\\s*([^;]+);`, 'u'))
  if (!match || match[1].trim() !== `var(${generatedVariable})`) {
    errors.push(`${variable} must delegate to ${generatedVariable}.`)
  }
  const generatedMatch = generatedBrandCss.match(new RegExp(`${generatedVariable}:\\s*([^;]+);`, 'u'))
  const expectedValue = values[token]
  if (!generatedMatch || generatedMatch[1].trim().toLowerCase() !== expectedValue) {
    errors.push(`${generatedVariable} must match shared ${token} (${values[token] ?? 'missing'}).`)
  }
}

const illustrationHighlight = generatedBrandCss.match(/--drapeon-illustration-highlight:\s*([^;]+);/u)
if (!illustrationHighlight || illustrationHighlight[1].trim().toLowerCase() !== '#9fcfb5') {
  errors.push('--drapeon-illustration-highlight must match colorScales.needle.200 (#9fcfb5).')
}

const requiredTailwindBindings = {
  'drape-green': 'brandColors.primary',
  'needle.DEFAULT': 'brandColors.primary',
  'needle.50': 'colorScales.needle',
  'rust.DEFAULT': 'brandColors.accent',
  'rust.50': 'colorScales.rust',
  bone: 'brandColors.background',
  ink: 'brandColors.textPrimary',
  'ui.canvas': 'brandColors.background',
  'ui.surface': 'brandColors.surface',
  'ui.muted': 'brandColors.statusMutedBg',
  'ui.border': 'brandColors.border',
  'ui.subtle': 'brandColors.textSecondary',
  'illustration.canvas': 'illustrationColors.canvas',
  'illustration.surface': 'illustrationColors.surface',
  'illustration.highlight': 'illustrationColors.highlight',
  'illustration.highlight-soft': 'illustrationColors.highlightSoft',
  'illustration.frame-canvas': 'illustrationColors.frameCanvas',
  'illustration.frame-surface': 'illustrationColors.frameSurface',
  'illustration.camera-surface': 'illustrationColors.cameraSurface',
  'illustration.camera-canvas': 'illustrationColors.cameraCanvas',
  'illustration.deep-canvas': 'illustrationColors.deepCanvas',
  'illustration.overlay-canvas': 'illustrationColors.overlayCanvas',
  'illustration.label-surface': 'illustrationColors.labelSurface',
  'illustration.highlight-muted': 'illustrationColors.highlightMuted',
  'illustration.highlight-bright': 'illustrationColors.highlightBright',
  'illustration.landmark': 'illustrationColors.landmark',
  'illustration.highlight-pale': 'illustrationColors.highlightPale',
  'illustration.highlight-on': 'illustrationColors.highlightOn',
  'illustration.glow': 'illustrationColors.glow',
  'illustration.camera-overlay': 'illustrationColors.cameraOverlay',
  'illustration.camera-shadow': 'illustrationColors.cameraShadow',
  'illustration.landmark-border': 'illustrationColors.landmarkBorder',
}

for (const [name, binding] of Object.entries(requiredTailwindBindings)) {
  if (!tailwind.includes(binding)) errors.push(`Tailwind semantic token ${name} must bind to ${binding}.`)
}

const requiredIllustrationUses = {
  'apps/web/components/brand-entrance.tsx': ['bg-illustration-canvas', 'bg-illustration-surface'],
  'apps/web/components/product-story-showcase.tsx': ['bg-illustration-frame-canvas', 'bg-illustration-frame-surface', 'text-illustration-highlight-muted'],
  'apps/web/app/vision/page.tsx': ['bg-illustration-deep-canvas', 'bg-illustration-overlay-canvas', 'bg-illustration-glow', 'text-illustration-highlight'],
  'apps/web/components/vision-walkthrough.tsx': ['bg-illustration-camera-surface', 'bg-illustration-camera-canvas', 'bg-illustration-highlight', 'bg-illustration-camera-overlay', 'bg-illustration-camera-shadow', 'border-illustration-landmark-border'],
  'apps/web/app/tailors/page.tsx': ['bg-illustration-label-surface', 'bg-illustration-highlight-muted'],
  'apps/web/components/public-portfolio-gallery.tsx': ['bg-illustration-frame-canvas'],
  'apps/web/app/privacy/page.tsx': ['bg-ui-muted', 'bg-illustration-label-surface'],
  'apps/web/components/account-auth-form.tsx': ['bg-illustration-camera-surface'],
  'apps/web/components/signup-trust-video.tsx': ['bg-illustration-camera-surface'],
  'apps/web/app/opengraph-image.tsx': ['illustrationColors.deepCanvas', 'colors.background', 'colors.primary', 'colorScales.needle[400]'],
}

for (const [relativePath, needles] of Object.entries(requiredIllustrationUses)) {
  const contents = read(relativePath)
  for (const needle of needles) {
    if (!contents.includes(needle)) errors.push(`${relativePath} must use ${needle}.`)
  }
}

const requiredAccountShellUses = {
  'apps/web/features/account/account-workspace-shell.tsx': ['bg-ui-surface-dark', 'bg-rust'],
  'apps/web/components/account-app-surface.tsx': ['bg-ui-surface-dark', 'bg-rust'],
}
for (const [relativePath, needles] of Object.entries(requiredAccountShellUses)) {
  const contents = read(relativePath)
  for (const needle of needles) {
    if (!contents.includes(needle)) errors.push(`${relativePath} must use ${needle}.`)
  }
}

const publicRoots = ['apps/web/app', 'apps/web/components']
const staleCanvasPattern = /(?:bg-\[#(?:f4f0e8|faf8f3|f7f3ec|e7dfd0|faf6f0|f3ece1|f5f0e8|fbfaf7)\]|#(?:f4f0e8|faf8f3|f7f3ec|e7dfd0|faf6f0|f3ece1|f5f0e8|fbfaf7))/iu
for (const rootPath of publicRoots) {
  const absoluteRoot = path.join(root, rootPath)
  const pending = [absoluteRoot]
  while (pending.length) {
    const current = pending.pop()
    const stat = fs.statSync(current)
    if (stat.isDirectory()) {
      pending.push(...fs.readdirSync(current).map((entry) => path.join(current, entry)))
      continue
    }
    if (!/\.(?:tsx?|css)$/u.test(current) || /[\\/]account[\\/]|[\\/]ops[\\/]|[\\/]auth[\\/]/u.test(current)) continue
    const contents = fs.readFileSync(current, 'utf8')
    if (staleCanvasPattern.test(contents)) errors.push(`Stale one-off canvas color remains in ${path.relative(root, current)}.`)
  }
}

const emailTemplatesRoot = path.join(root, 'supabase/templates')
const staleEmailPalette = /#(?:f4f1eb|f5f3ee|2f7557|225d45|17211c|25322b|3d4942|6b716d|8a8f8b|e5e1d8)/iu
for (const entry of fs.readdirSync(emailTemplatesRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.html')) continue
  const relativePath = path.join('supabase/templates', entry.name)
  const contents = fs.readFileSync(path.join(root, relativePath), 'utf8')
  if (staleEmailPalette.test(contents)) errors.push(`Stale email palette remains in ${relativePath}.`)
  for (const token of ['#F9F7F3', '#2D6A4F', "Georgia,'Times New Roman',serif"]) {
    if (!contents.includes(token)) errors.push(`${relativePath} must include canonical email token ${token}.`)
  }
  // Keep auth emails on a single, high-contrast palette. Gmail mobile can
  // partially invert declared dark-mode palettes, so compatibility explicitly
  // rejects color-scheme and prefers-color-scheme declarations.
  for (const token of ['drapeon-auth-email-card', 'drapeon-auth-email-muted']) {
    if (!contents.includes(token)) errors.push(`${relativePath} must include email parity marker ${token}.`)
  }
}

const serverEmailSources = [
  'apps/web/lib/lead-notifications.ts',
  'apps/web/lib/ops-customer-email.ts',
  'apps/web/lib/ops-notifications.ts',
  'supabase/functions/_shared/ops-notifications.ts',
]
const rawEmailColor = /#[0-9a-f]{6}/iu
for (const relativePath of serverEmailSources) {
  const contents = read(relativePath)
  if (!contents.includes('colors.')) errors.push(`${relativePath} must consume shared Drapeon colors.`)
  if (rawEmailColor.test(contents)) errors.push(`${relativePath} must not embed a raw email color literal.`)
}

if (errors.length) {
  console.error('Brand token parity failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Brand token parity passed.')
console.log('- Shared design-system, web CSS variables, Tailwind aliases, and public canvas audit agree.')
