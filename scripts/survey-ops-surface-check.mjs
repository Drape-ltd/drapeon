#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const errors = []

function read(relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8')
  } catch {
    errors.push(`Missing survey Ops surface: ${relativePath}`)
    return ''
  }
}

const shared = read('packages/shared/src/lifecycle-surveys.ts')
const component = read('apps/web/components/survey-ops-preview.tsx')
const route = read('apps/web/app/survey-ops-preview/page.tsx')
const test = read('apps/web/tests/e2e/survey-ops-preview.spec.ts')

for (const [label, source, needles] of [
  ['shared survey contract', shared, ['SurveyOpsResponseRecord', 'summarizeSurveyResponses', 'negativeCount', 'reviewEligibleCount']],
  ['survey Ops preview', component, ['summarizeSurveyResponses', 'PREVIEW_RESPONSES', 'Negative routing', 'respondent identity', 'data-testid="survey-ops-preview"']],
  ['survey Ops route', route, ['process.env.NODE_ENV !== \'development\'', 'SurveyOpsPreview']],
  ['survey Ops evidence', test, ['/survey-ops-preview', 'Negative routing', 'respondent or transaction details']],
]) {
  for (const needle of needles) {
    if (!source.includes(needle)) errors.push(`${label} is missing ${needle}.`)
  }
}

if (errors.length > 0) {
  console.error('Survey Ops surface check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Survey Ops surface check passed.')
console.log('- Aggregated private survey signals, explicit routing states, and browser evidence are bound.')
