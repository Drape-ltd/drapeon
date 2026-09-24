#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

// These are deliberately narrow, high-signal rules. Policy documents may
// discuss phrases to avoid; this check only audits canonical user-facing copy
// sources that ship through the product or email renderer.
const rules = [
  {
    key: 'urgency-theatre',
    pattern: /\bhurry\b/iu,
    guidance: 'Use a calm next action and an authoritative date instead of urgency theatre.',
  },
  {
    key: 'unsupported-refund-guarantee',
    pattern: /\bguaranteed\s+refund\b/iu,
    guidance: 'Describe the actual protection or help path; do not promise an automatic refund.',
  },
  {
    key: 'repeated-exclamation',
    pattern: /!!+/u,
    guidance: 'Use calm punctuation; repeated exclamation marks are not part of Drapeon voice.',
  },
]

const auditedPaths = [
  'packages/shared/src/lifecycle-welcome.ts',
  'packages/shared/src/product-updates.ts',
  'packages/shared/src/education-guides.ts',
  'packages/shared/src/marketing-topics.ts',
  'supabase/functions/_shared/email-template.ts',
]

const findings = []
for (const relativePath of auditedPaths) {
  const filePath = path.join(root, relativePath)
  let contents
  try {
    contents = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    findings.push(`${relativePath}: could not read audited copy source (${error.message})`)
    continue
  }

  contents.split('\n').forEach((line, index) => {
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        findings.push(`${relativePath}:${index + 1}: ${rule.key}: ${rule.guidance}`)
      }
    }
  })
}

if (findings.length > 0) {
  console.error('Brand language contract failed:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log('Brand language contract passed.')
console.log('- Canonical welcome, education, marketing-topic, and email copy is free of banned urgency and guarantee patterns.')
