# Web and server rollout, 2026-10-04

Status: preparation only. No production database, Edge Function, Worker, or native build change has been made by this release branch.

## Scope and order

1. Keep the mixed working tree untouched. Assemble only reviewed web, shared, database, and Edge changes in this isolated release worktree.
2. Compare every candidate migration with Drape-PROD's schema and migration ledger. Development verification and migration linting precede production. Apply at most five identified migrations per batch; verify each batch before continuing. Never use `--include-all` or mark a version applied without proving its effect exists.
3. Deploy only the Edge Functions required by the approved schema and shared-code changes; record their production versions and exercise affected actions.
4. Run the launch contract, relevant typechecks/tests, web build, diff check, and live browser checks on the exact release commit.
5. Promote that commit through a reviewed pull request to `main`, which is the currently wired production branch. Never implement directly on `main` or push a broad worktree snapshot.
6. Verify the Cloudflare build corresponds to the merged commit. Smoke-test public and authenticated production paths, including signup, tailor setup, briefs, diary/passport, Studio, and Ops paths actually included in the release.
7. Watch Cloudflare, Supabase, Sentry, provider outcomes, and queue health. Stop promotion on a critical regression; roll forward with a focused corrective change.

## Current gates

- A read-only October 4 comparison found Drape-PROD at `20260928230000` (457 applied versions) and Drape-DEV at `20261002130000` (484 applied versions). Eight older local versions from September 15-20 are absent from production despite versions after them being present; newer feature migrations are pending too. Their real effects and dependency order require reconciliation before a production database write. The two ledgers are not safely interchangeable.
- The older gap is not merely missing ledger rows: Drape-PROD lacks `survey_responses`, `survey_invites`, `communication_marketing_topic_preferences`, `email_provider_events`, and the marketing audience/recipient functions. The exact `Not set` location backfill currently matches zero non-live tailor profiles. The marketing/survey migrations are a distinct release unit, not an automatic prerequisite to the customer Studio/diary rollout.
- The existing production readiness monitor has reported overdue tax-policy reviews and dead-lettered jobs. A read-only production queue-health check on October 4 returned five actionable dead jobs, nine total dead jobs (four already reviewed), and five pending jobs, with the oldest pending since October 2. These are pre-existing health failures, not proof of this release's health. Review them separately; do not clear or relabel them merely to make rollout green.
- The local mixed worktree contains over 200 modified/untracked paths and generated Next outputs. Promote an exact allowlist only.
- Drape-PROD's current Edge inventory has existing `claim-passport` and `diary-entry-action` functions, but no `studio-collection-action`, `studio-order-action`, or `education-action`. Those must not be assumed live merely because their development source exists. Coordinate their first deployment with their schema and web consumers.
- The Sketch Room source currently includes an interactive Figure/croquis guide in its active editor. The attempted isolated Studio package staging was rejected because the release instruction excludes Try On code. No Studio editor package files were retained in this release branch. Do not deploy the Studio migrations or Edge functions until the Figure scope is resolved and the exact web bundle is reviewed; do not quietly route around this gate.

## Staged migration candidates, not applied

The isolated worktree contains only the two additive reference-photo migration candidates, with a scoped web/shared/Edge implementation that does not import Studio or Try On. Their source copies were compared with the mixed working tree. The five Studio migration candidates were reviewed and then removed from the release branch while the editor bundle is excluded. No candidate may be applied without its paired client/Edge dependency and release-gate review.

The scoped reference-photo slice passed 20 shared tests, web TypeScript and targeted ESLint (zero errors; three pre-existing warnings in the order detail), Deno Edge typecheck with the repository's `--sloppy-imports` setting, and a production Next build. A live development-only brief preview rendered the per-photo tags and note after a local image was selected. The baseline `pnpm launch:contracts` passed before this slice; rerun it on the exact final release commit. This is not production proof. The current production database lacks the new column, so deploy the additive column first, verify it, then deploy the Edge function and web consumer; do not reverse that order.

## Explicit exclusions

- No Try On route, package, mobile screen, asset, generated engine document, test, lockfile importer, or navigation entry goes to production. `packages/drape-tryon`, `apps/web/app/try-on`, `apps/mobile/features/try-on`, `apps/mobile/app/(customer)/try-on`, and their references are experimental. Sketch Room/Studio is a separate intended feature and must not be mistaken for Try On.
- No iOS or Android build or submission in this rollout. Mobile source may be reviewed for later release, but web/server promotion does not make native UI changes visible to installed apps.
- No automatic change to production interaction-system, quote-negotiation, or chat-order-actions flags.

## Native build-profile review (future build only)

| Flag | TestFlight | Production profile | Reach |
| --- | --- | --- | --- |
| Interaction system v1 | on | off | Customer and tailor tab/navigation presentation |
| Quote negotiation v1 | on | off | Customer quote review and tailor order quote controls |
| Chat order actions v1 | on | off | Message-thread order action UI |
| Drape Vision UI v2 | on | on in local WIP, off on current `main` | Vision presentation, not the capture engine |
| Group Orders v1 | off | off | No change |
| Dark Theme v1 | off | off | No change |

Keep the first three production flags off until each flow is reviewed and tested separately. The local Vision flag correction belongs to a later native build, not this web/server rollout. Production omits the native Turnstile site key; the hosted challenge route reads its server-configured key when no client key is supplied. Validate that hosted route in the future native release, including its test-key handling.
