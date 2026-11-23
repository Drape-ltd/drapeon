import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { trustDecisionDisabledReason } from './trust-decision-readiness.ts'
import { EXPLORE_SECTION_CONTROL_LABEL, parseMarketplaceCategory, placementLabel, suggestedExploreSection } from '../../../packages/shared/src/marketplace-category.ts'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../../', import.meta.url))

function loadComponent(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText
  const compiledModule = { exports: {} }
  runInNewContext(compiled, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: (specifier) => dependencies[specifier] ?? require(specifier),
  })
  return compiledModule.exports
}

const icon = () => null
const icons = { ExternalLink: icon, ImageIcon: icon, ShieldCheck: icon, Video: icon,
  AlertTriangle: icon, CheckCircle2: icon, LoaderCircle: icon, XCircle: icon }

test('audited evidence opens in this tab with a way back to the case', () => {
  const { TrustCasePanel } = loadComponent('../components/trust-case-panel.tsx', {
    'lucide-react': icons,
    'next/image': { __esModule: true, default: () => null },
    '../lib/work-items': { formatEnum: (value) => value, formatRelativeTime: (value) => value },
    '@drape/shared': { parseMarketplaceCategory, placementLabel },
    './trust-decision-panel': { TrustDecisionPanel: () => null },
  })
  const html = renderToStaticMarkup(createElement(TrustCasePanel, {
    context: {
      avatarUrl: null, portfolioPhotoUrls: [], proofItems: [], hasChallengeVideo: true,
      displayName: 'QA tailor', location: null, specialties: [], submittedAt: null,
      reviewStatus: 'APPROVED', payoutAccountVerified: false, challengeText: null,
      challengeId: null, profileId: 'profile-1',
      placement: { supported: true, current: 'READY_TO_WEAR', sellerType: 'BOUTIQUE', supportsCustomOrders: true,
        decisions: [{ id: 'decision-1', from: 'TAILORING', to: 'READY_TO_WEAR', reason: 'Curated after review', actor: 'ops', createdAt: 'now' }] },
    },
    caseNumber: 'OPS-1234', issueId: 'issue-1', recordVersion: 1,
    protectedAccess: true, protectedCheckpoint: '/ops/sensitive',
  }))
  const form = html.match(/<form\b[^>]*>/u)?.[0]
  assert.ok(form)
  assert.match(form, /method="post"/u)
  assert.match(form, /action="\/ops\/sensitive\/evidence\/trust\/profile-1"/u)
  assert.doesNotMatch(form, /target=/u)
  assert.match(html, /Return to case/u)
  assert.match(html, /Tailors → Ready-made/u)
  assert.match(html, /Curated after review/u)

  const viewer = readFileSync(`${root}/apps/web/app/ops/identity-document/[profileId]/route.ts`, 'utf8')
  assert.match(viewer, /<a href="\$\{escapeHtml\(caseHref\)\}">Return to case<\/a>/u)
  assert.doesNotMatch(viewer, /Close tab/u)
})

const ready = {
  evidenceReady: true, evidenceReviewed: true, protectedAccess: true,
  recordVersion: 1, pending: null, placementReady: true, rejectionReasonValid: true,
}

test('decision readiness identifies each blocking requirement', () => {
  const cases = [
    [{ evidenceReady: false }, 'Private challenge evidence missing'],
    [{ evidenceReviewed: false }, 'Tick the evidence review box'],
    [{ protectedAccess: false }, 'Protected access expired: verify again'],
    [{ recordVersion: null }, 'Record version missing'],
    [{ pending: 'APPROVE' }, 'Decision in progress'],
    [{ placementReady: false }, 'Choose an Explore placement'],
  ]
  for (const [change, expected] of cases) {
    assert.equal(trustDecisionDisabledReason({ ...ready, decision: 'APPROVE', ...change }), expected)
  }
  assert.equal(trustDecisionDisabledReason({ ...ready, decision: 'REJECT', rejectionReasonValid: false }), 'Enter at least 8 characters for rejection')
  assert.equal(trustDecisionDisabledReason({ ...ready, decision: 'APPROVE' }), null)
  assert.equal(trustDecisionDisabledReason({ ...ready, decision: 'REJECT' }), null)
})

test('disabled decision buttons show their reasons beside the controls', () => {
  const { TrustDecisionPanel } = loadComponent('../components/trust-decision-panel.tsx', {
    'lucide-react': icons,
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '../lib/use-idempotent-command': { idempotencyFingerprint: () => 'test', useIdempotentCommand: () => ({ begin: () => ({ key: 'test' }), complete() {} }) },
    '../lib/protected-action-response': { validProtectedActionSuccess: () => true },
    '../lib/trust-decision-readiness': { trustDecisionDisabledReason },
    '@drape/shared': { EXPLORE_SECTION_CONTROL_LABEL, placementLabel, suggestedExploreSection },
  })
  const props = {
    issueId: 'issue-1', profileId: 'profile-1', tailorUserId: 'user-1',
    recordVersion: 1, evidenceReady: true, protectedAccess: true,
    protectedCheckpoint: '/ops/sensitive',
  }
  const html = renderToStaticMarkup(createElement(TrustDecisionPanel, props))
  assert.match(html, /Approve trust<\/button><p[^>]*>Tick the evidence review box<\/p>/u)
  assert.match(html, /Reject with reason<\/button><p[^>]*>Tick the evidence review box<\/p>/u)

  const expired = renderToStaticMarkup(createElement(TrustDecisionPanel, { ...props, protectedAccess: false }))
  assert.match(expired, /Verify protected access again/u)
  assert.match(expired, /Protected access expired: verify again/u)

  const suggested = renderToStaticMarkup(createElement(TrustDecisionPanel, {
    ...props,
    placement: { supported: true, current: 'TAILORING', sellerType: 'BOUTIQUE', supportsCustomOrders: true },
  }))
  assert.match(suggested, /Suggested: Ready-made \(boutique\)/u)
  assert.match(suggested, /checked="" value="READY_TO_WEAR"/u)
})

test('the Ops move control explains why Tailors is unavailable', () => {
  const { MarketplaceCategoryControl } = loadComponent('../components/marketplace-category-control.tsx', {
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@drape/shared': { EXPLORE_SECTION_CONTROL_LABEL, placementLabel },
  })
  const html = renderToStaticMarkup(createElement(MarketplaceCategoryControl, {
    profileId: 'profile-1', current: 'READY_TO_WEAR', supportsCustomOrders: false,
  }))
  assert.match(html, /<option value="TAILORING" disabled=""/u)
  assert.match(html, /Tailors is unavailable while custom orders are off/u)
})
