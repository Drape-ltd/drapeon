#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const withSupabase = process.argv.includes('--with-supabase')
const evidenceRootArg = process.argv.find((arg) => arg.startsWith('--evidence-root='))
const promotionRun = /^(1|true)$/iu.test(process.env.RELEASE_PROMOTION ?? '')

if (promotionRun && !evidenceRootArg) {
  console.error('Promotion launch checks require --evidence-root with happy, negative, and visual results.')
  process.exit(1)
}

const evidenceCheckArgs = ['scripts/release-evidence-check.mjs']
if (evidenceRootArg) evidenceCheckArgs.push(evidenceRootArg)

function edgeFunctionEntrypoints() {
  const functionsDir = join(root, 'supabase', 'functions')
  return readdirSync(functionsDir)
    .map((name) => join(functionsDir, name))
    .filter((path) => statSync(path).isDirectory())
    .map((path) => join(path, 'index.ts'))
    .filter((path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    })
    .sort()
}

const checks = [
  ['pnpm', ['studio:build']],
  ['node', ['scripts/release-contract-check.mjs']],
  ['node', ['--test', 'scripts/job-worker-wake-contract.test.mjs']],
  ['node', ['--test', 'apps/web/scripts/cf-build-mode.test.mjs']],
  ['node', ['--test', 'apps/web/scripts/worker-source-encoding.test.mjs']],
  ['node', ['--test', 'apps/web/worker/public-page-cache.test.mjs']],
  ['node', ['apps/web/scripts/check-worker-source-regex.mjs']],
  ['node', ['--test', 'apps/web/scripts/worker-build-env.test.mjs']],
  ['node', ['--test', 'apps/web/scripts/studio-preview-assets.test.mjs']],
  ['node', ['--test', 'apps/web/lib/stripe-payout-refresh-contract.test.mjs']],
  ['node', ['--test', 'apps/web/lib/money-desk-target-retry.test.mjs']],
  ['node', ['--test', 'scripts/money-desk-payout-refresh-contract.test.mjs']],
  ['node', ['--test', 'scripts/money-desk-notice-events-contract.test.mjs']],
  ['node', ['--test', 'apps/ops/scripts/failed-refund-journal-case-binding.test.mjs']],
  ['node', ['--test', 'scripts/stripe-release-callers.test.mjs']],
  ['node', ['--test', 'apps/web/lib/ops-local-session-policy.test.mjs']],
  ['node', ['--test', 'apps/ops/scripts/ops-session-context.test.mjs']],
  ['node', ['--test', 'apps/web/tests/refund-order-payments-request.test.mjs']],
  ['node', ['--test', 'apps/web/lib/recovery-mfa.test.mjs']],
  ['node', ['--test', 'apps/mobile/lib/reset-password-error.test.mjs']],
  ['node', ['--experimental-strip-types', '--test', 'apps/web/tests/dispute-refund-resolution.test.ts']],
  ['node', ['scripts/lifecycle-marketing-contract-check.mjs']],
  ['node', ['scripts/marketing-topic-parity-check.mjs']],
  ['deno', ['test', '--sloppy-imports', 'supabase/functions/submit-survey/policy_test.ts', 'supabase/functions/_shared/marketing-topic_test.ts']],
  ['deno', ['test', '--sloppy-imports', 'supabase/functions/_shared/paystack_retirement_test.ts']],
  ['deno', ['test', 'supabase/functions/_shared/failed-refund-journal-recovery_test.ts']],
  ['pnpm', ['--filter', '@drape/shared', 'test', '--runInBand', 'failed-refund-journal-preparation.test.ts']],
  ['deno', ['test', 'packages/shared/src/ops-money-approver_test.ts']],
  ['deno', ['test', 'packages/shared/src/stripe-release-readiness_test.ts']],
  ['deno', ['test', 'packages/shared/src/reviewed-claimed-tranche-retry_test.ts', 'supabase/functions/_shared/claimed-tranche-payout_test.ts', 'supabase/functions/_shared/claimed-payout-execution_test.ts', 'supabase/functions/_shared/reviewed-claimed-tranche-monitor_test.ts', 'supabase/functions/_shared/reviewed-claimed-tranche-failure_test.ts']],
  ['deno', ['test', 'packages/shared/src/payout-claim-retry-preparation_test.ts']],
  ['deno', ['test', 'supabase/functions/_shared/stripe-release-preflight_test.ts']],
  ['deno', ['test', 'supabase/functions/_shared/payment-expiry-safety_test.ts']],
  ['deno', ['test', '--allow-env', 'supabase/functions/_shared/settlement-eligibility-scan_test.ts', 'supabase/functions/_shared/ops-issues_test.ts']],
  ['deno', ['test', 'supabase/functions/_shared/unstarted-tranche-abort_test.ts', 'supabase/functions/_shared/stale-reserved-payout_test.ts']],
  ['deno', ['test', 'packages/shared/src/payout-pre-provider-abort_test.ts']],
  ['deno', ['test', 'supabase/functions/_shared/stripe-payout-profile-readiness_test.ts', 'supabase/functions/_shared/stripe-payout-destination_test.ts']],
  ['deno', ['test', 'supabase/functions/_shared/stripe-connect-onboarding_test.ts']],
  ['deno', ['test', 'packages/shared/src/provider-bank-payouts_test.ts', 'packages/shared/src/staged-earnings_test.ts', 'supabase/functions/_shared/bank-payout-projection_test.ts']],
  ['git', ['diff', '--check']],
  ['node', evidenceCheckArgs],
  ['node', ['scripts/mobile-release-target-guard.mjs']],
  ['node', ['apps/mobile/scripts/check-build-profile-parity.mjs']],
  ['node', ['--test', 'apps/mobile/scripts/build-profile-parity.test.mjs']],
  ['node', ['apps/mobile/scripts/check-android-minify-prebuild.mjs']],
  ['node', ['--test', 'apps/mobile/scripts/publish-ota.test.mjs']],
  ['node', ['--experimental-strip-types', '--test', 'apps/mobile/lib/read-gateway-cache-policy.test.ts']],
  ['node', ['--experimental-strip-types', '--test', 'apps/mobile/lib/stripe-return-url.test.ts']],
  ['node', ['--experimental-strip-types', '--test', 'packages/shared/src/payment-return-scheme.test.ts']],
  ['pnpm', ['--filter', '@drape/db', 'exec', 'tsx', '--test', join(root, 'apps/mobile/lib/marketplace-schema-skew.test.ts'), join(root, 'apps/mobile/lib/payout-attempts.test.ts'), join(root, 'apps/mobile/lib/earnings-weeks.test.ts'), join(root, 'apps/mobile/lib/money-history-staged-breakdown.test.ts'), join(root, 'apps/mobile/features/orders/customer/pickup-area.test.ts'), join(root, 'apps/web/features/account/profile/__tests__/marketplace-category-skew.test.ts')]],
  ['node', ['--test', 'apps/ops/lib/marketplace-category-skew.test.mjs', 'apps/ops/lib/payout-retry-schema-skew.test.mjs']],
  ['node', ['--experimental-strip-types', '--test', 'supabase/functions/_shared/media-lookup-batch.test.ts']],
  ['node', ['apps/mobile/scripts/check-app-identity.mjs']],
  ['pnpm', ['--dir', 'apps/mobile', 'typecheck']],
  ['pnpm', ['--dir', 'apps/mobile', 'lint']],
  ['pnpm', ['--dir', 'apps/ops', 'typecheck']],
  ['pnpm', ['--dir', 'apps/ops', 'lint']],
  ['pnpm', ['--dir', 'apps/ops', 'test']],
  ['pnpm', ['--dir', 'apps/ops', 'ui:verify']],
  ['deno', ['test', 'supabase/functions/_shared/ops-route-access-policy_test.ts']],
  ['deno', ['test', '--allow-env', 'supabase/functions/_shared/ops-slack-digest_test.ts', 'supabase/functions/_shared/slack-ops_test.ts', 'supabase/functions/_shared/job-failure-cause_test.ts', 'supabase/functions/_shared/ops-job-case-links_test.ts', 'supabase/functions/_shared/ops-job-page_test.ts']],
  ['deno', ['test', '--sloppy-imports', 'supabase/functions/ops-trust-exception-action/broker-policy_test.ts', 'supabase/functions/_shared/ops-money-read_test.ts', 'supabase/functions/_shared/ops-queue-page_test.ts', 'supabase/functions/_shared/ops-search_test.ts', 'supabase/functions/_shared/ops-read-policy_test.ts']],
  ['deno', ['test', 'packages/shared/src/payout-retry-schema-skew_test.ts']],
  ['deno', ['test', 'supabase/functions/_shared/ops-dispatch-execution_test.ts']],
  ['deno', ['test', '--allow-env', '--sloppy-imports', 'packages/shared/src/refund-receipt_test.ts', 'packages/shared/src/dispatch-refund-retry-result_test.ts', 'supabase/functions/_shared/order-cancellation-refund_test.ts', 'supabase/functions/_shared/payment-refunds_test.ts', 'supabase/functions/_shared/drapeon-dispatch-refund_test.ts', 'supabase/functions/_shared/drapeon-dispatch-refund-webhook_test.ts', 'supabase/functions/_shared/commercial-ledger-refund-replay_test.ts', 'supabase/functions/_shared/refund-failure-ledger-alert_test.ts']],
  ['deno', ['test', 'supabase/functions/_shared/notify_receipt_audit_test.ts']],
  ['deno', ['test', '--allow-env', 'supabase/functions/_shared/money-push-failure-alert_test.ts', 'supabase/functions/_shared/expo-push-receipts_test.ts', 'supabase/functions/_shared/ops-notifications-idempotency_test.ts']],
  ['node', ['--experimental-strip-types', '--test', 'apps/web/tests/cancellation-refund-source.test.ts']],
  ['node', ['--experimental-strip-types', '--test', 'apps/web/tests/cancellation-refund-recovery.test.ts']],
  ['node', ['--test', 'scripts/cancellation-finalizer-migration-contract.test.mjs']],
  ['node', ['--test', 'scripts/payout-block-reason-contract.test.mjs']],
  // Generate Next's typed-route declarations first. next-env.d.ts imports the
  // gitignored .next/types/routes.d.ts; without it TypeScript silently skips
  // that side-effect import, so typed <Link href> errors pass this gate while
  // the Cloudflare production build (which generates routes) fails.
  ['pnpm', ['--dir', 'apps/web', 'exec', 'next', 'typegen']],
  // Keep the contract checker hermetic: Next's default incremental typecheck
  // writes tsconfig.tsbuildinfo, which is unnecessary for a release gate and
  // can be blocked in read-only CI workspaces.
  ['pnpm', ['--dir', 'apps/web', 'exec', 'tsc', '--noEmit', '--incremental', 'false']],
  ['pnpm', ['--dir', 'apps/web', 'lint']],
  ['pnpm', ['--filter', '@drape/shared', 'test']],
  // Shared workspace packages use TypeScript's extensionless imports. Deno's
  // sloppy-import compatibility mode resolves those imports the same way the
  // package compiler and production bundler do.
  ['deno', ['check', '--sloppy-imports', ...edgeFunctionEntrypoints()]],
]

if (withSupabase) {
  checks.push([
    'supabase',
    ['db', 'lint', '--linked', '--schema', 'public,util', '--fail-on', 'error'],
  ])
}

for (const [command, args] of checks) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nLaunch contract checks passed.')
