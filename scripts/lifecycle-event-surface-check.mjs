#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const errors = []

function read(relativePath) {
  const absolutePath = path.join(root, relativePath)
  try {
    return fs.readFileSync(absolutePath, 'utf8')
  } catch {
    errors.push(`Missing lifecycle surface: ${relativePath}`)
    return ''
  }
}

function requireText(label, source, needle) {
  if (!source.includes(needle)) errors.push(`${label} is missing ${needle}.`)
}

const registry = read('packages/shared/src/lifecycle-events.ts')
const releaseContract = read('config/release-contract.json')

// These are the event surfaces that currently have a real emitter and a
// headed-browser evidence test (plus the native education emitter where
// applicable). This guard intentionally does not claim that every registry
// entry is implemented or that device replay is complete; it prevents the
// proven subset from silently drifting away from its registry or evidence test.
const requiredEvents = [
  {
    name: 'marketing_page_viewed',
    emitter: ['apps/web/components/web-analytics.tsx', "trackLifecycleEvent('marketing_page_viewed'"],
    evidence: ['apps/web/tests/e2e/analytics-consent.spec.ts', 'marketing_page_viewed'],
  },
  {
    name: 'marketing_cta_clicked',
    emitter: ['apps/web/components/web-analytics.tsx', "trackLifecycleEvent('marketing_cta_clicked'"],
    surface: ['apps/web/app/pricing/page.tsx', 'data-analytics-event="primary_cta_click"'],
    evidence: ['apps/web/tests/e2e/analytics-consent.spec.ts', 'marketing_cta_clicked.v1'],
  },
  {
    name: 'product_update_opened',
    emitter: ['apps/web/components/web-analytics.tsx', "trackLifecycleEvent('product_update_opened'"],
    nativeEmitter: ['apps/mobile/components/ProductUpdatesScreen.tsx', "captureLifecycleEvent('product_update_opened'"],
    evidence: ['apps/web/tests/e2e/analytics-consent.spec.ts', 'product_update_opened'],
  },
  {
    name: 'tailor_profile_viewed',
    emitter: [
      'apps/web/components/lifecycle-profile-view-tracker.tsx',
      "trackLifecycleEvent('tailor_profile_viewed'",
    ],
    evidence: ['apps/web/tests/e2e/lifecycle-profile-analytics.spec.ts', 'tailor_profile_viewed'],
  },
  {
    name: 'fit_profile_completed',
    emitter: [
      'apps/web/features/account/measurements/measurements-content.tsx',
      "trackLifecycleEvent('fit_profile_completed'",
    ],
    preview: ['apps/web/components/lifecycle-fit-preview.tsx', "trackLifecycleEvent('fit_profile_completed'"],
    evidence: ['apps/web/tests/e2e/lifecycle-fit-preview.spec.ts', 'fit_profile_completed'],
  },
  {
    name: 'order_started',
    emitter: [
      'apps/web/features/account/brief/brief-form.tsx',
      "trackLifecycleEvent('order_started'",
    ],
    preview: ['apps/web/components/lifecycle-order-preview.tsx', "trackLifecycleEvent('order_started'"],
    evidence: ['apps/web/tests/e2e/lifecycle-order-preview.spec.ts', 'order_started'],
  },
  {
    name: 'guide_started',
    emitter: ['apps/web/components/web-analytics.tsx', "trackLifecycleEvent('guide_started'"],
    surface: ['apps/web/components/education-guide-card.tsx', 'data-analytics-event="guide_started"'],
    nativeEmitters: [
      [
        "apps/mobile/app/(customer)/profile/help.tsx",
        [
          "captureLifecycleEvent('guide_started'",
          "guide_id: 'customer-start-here'",
          "role: 'CUSTOMER'",
          "entry_surface: Platform.OS === 'android' ? 'android' : 'ios'",
          'guide_version: 1',
        ],
      ],
      [
        "apps/mobile/app/(tailor)/profile/help.tsx",
        [
          "captureLifecycleEvent('guide_started'",
          "guide_id: 'tailor-start-here'",
          "role: 'TAILOR'",
          "entry_surface: Platform.OS === 'android' ? 'android' : 'ios'",
          'guide_version: 1',
        ],
      ],
    ],
    evidence: ['apps/web/tests/e2e/help-guides.spec.ts', 'guide_started.v1'],
  },
  {
    name: 'guide_completed',
    emitter: ['apps/web/components/education-guide-card.tsx', "trackLifecycleEvent('guide_completed'"],
    evidence: ['apps/web/tests/e2e/help-guides.spec.ts', 'guide_completed.v1'],
  },
  {
    name: 'tailor_application_submitted',
    emitter: ['apps/web/components/tailor-application-form.tsx', "trackLifecycleEvent('tailor_application_submitted'"],
    preview: ['apps/web/components/lifecycle-lead-preview.tsx', "trackLifecycleEvent('tailor_application_submitted'"],
    evidence: ['apps/web/tests/e2e/lifecycle-leads-preview.spec.ts', 'tailor_application_submitted.v1'],
  },
  {
    name: 'waitlist_joined',
    emitter: ['apps/web/components/waitlist-form.tsx', "trackLifecycleEvent('waitlist_joined'"],
    preview: ['apps/web/components/lifecycle-lead-preview.tsx', "trackLifecycleEvent('waitlist_joined'"],
    evidence: ['apps/web/tests/e2e/lifecycle-leads-preview.spec.ts', 'waitlist_joined.v1'],
  },
]

for (const requirement of requiredEvents) {
  requireText(`${requirement.name} registry`, registry, `name: '${requirement.name}'`)

  for (const [kind, pair] of Object.entries(requirement)) {
    if (kind === 'nativeEmitters') {
      for (const [relativePath, needles] of pair) {
        const source = read(relativePath)
        for (const needle of needles) {
          requireText(`${requirement.name} native emitter (${relativePath})`, source, needle)
        }
      }
      continue
    }
    if (!Array.isArray(pair)) continue
    const [relativePath, needle] = pair
    const source = read(relativePath)
    requireText(`${requirement.name} ${kind} (${relativePath})`, source, needle)
  }
}

for (const flow of ['auth.sign-in', 'auth.sign-up', 'auth.recovery', 'account.onboarding', 'commerce.payment']) {
  requireText('release contract', releaseContract, `"${flow}"`)
}

if (errors.length) {
  console.error('Lifecycle event surface check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Lifecycle event surface check passed.')
console.log(`- ${requiredEvents.length} consent-aware event surfaces are bound to emitters and evidence tests.`)
console.log('- Registry coverage is explicit; unimplemented registry entries remain non-production claims.')
