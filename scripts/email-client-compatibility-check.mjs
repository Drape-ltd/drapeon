#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const errors = []

const rendererPath = 'supabase/functions/_shared/email-template.ts'
const renderer = read(rendererPath)
const orderEmailPath = 'supabase/functions/_shared/order-email.ts'
const orderEmail = read(orderEmailPath)

for (const marker of [
  'mso-table-lspace:0pt',
  'mso-table-rspace:0pt',
  '-ms-interpolation-mode:bicubic',
  '@media screen and (max-width:600px)',
  '.drapeon-email-gutter',
  '.drapeon-email-card',
  'drapeon-email-detail-label',
  'drapeon-email-detail-value',
  'drapeon-email-media',
  'bgcolor="${light.surface}"',
]) {
  if (!renderer.includes(marker)) errors.push(`${rendererPath} is missing ${marker}.`)
}

for (const forbidden of ['display:grid', 'position:fixed', '@import']) {
  if (renderer.includes(forbidden)) errors.push(`${rendererPath} contains unsupported email CSS: ${forbidden}.`)
}

for (const forbidden of ['prefers-color-scheme', 'color-scheme']) {
  if (renderer.includes(forbidden)) {
    errors.push(`${rendererPath} declares a dark palette Gmail mobile can partially invert: ${forbidden}.`)
  }
}

if (!orderEmail.includes("displayName = 'Drapeon Orders'")) {
  errors.push(`${orderEmailPath} must use the Drapeon Orders sender identity.`)
}

const templatesDir = path.join(root, 'supabase', 'templates')
for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.html')) continue
  const relativePath = path.join('supabase/templates', entry.name)
  const html = read(relativePath)
  for (const marker of [
    "Georgia,'Times New Roman',serif",
    'drapeon-auth-email-footer',
  ]) {
      if (!html.includes(marker)) errors.push(`${relativePath} is missing ${marker}.`)
  }
  for (const forbidden of ['prefers-color-scheme', 'color-scheme']) {
    if (html.includes(forbidden)) {
      errors.push(`${relativePath} declares a dark palette Gmail mobile can partially invert: ${forbidden}.`)
    }
  }
}

if (errors.length) {
  console.error('Email client compatibility check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Email client compatibility check passed.')
console.log('- Shared renderer includes mobile and Outlook-safe table fallbacks without a Gmail-unsafe dark palette.')
console.log('- Supabase auth templates use the same single high-contrast source palette and serif fallback.')
