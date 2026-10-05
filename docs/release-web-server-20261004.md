# Web and server rollout, 2026-10-04

Status: partial production rollout. The scoped reference-photo schema and Edge action and five diary/passport migrations are live; the web consumers, remaining features, and native builds are not confirmed live. No native build has been made.

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
- The Sketch Room source currently includes an interactive Figure/croquis guide in its active editor. The user confirmed that Figure is intended Sketch Room scope, but wants to inspect it before any app builds; they are away from home. The attempted isolated Studio package staging was rejected because the release instruction excludes Try On code. No Studio editor package files were retained in this release branch. Re-review the exact web bundle before Studio promotion; never include the separate Try On experiment. No native build before the user's visual inspection.

## Staged migration candidates, not applied

The isolated worktree contains the two reference-photo migrations, a forward privilege-revoke migration, and the two historical order-photo migrations already applied to PROD, with a scoped web/shared/Edge implementation that does not import Studio or Try On. Source copies of the historical migrations were compared with the mixed working tree; the PROD migration ledger and public `order-photos` bucket were checked read-only. The five Studio migration candidates were reviewed and then removed from the release branch while the editor bundle is excluded. No candidate may be applied without its paired client/Edge dependency and release-gate review.

The scoped reference-photo slice passed 20 shared tests, web TypeScript and targeted ESLint (zero errors; three pre-existing warnings in the order detail), Deno Edge typecheck with the repository's `--sloppy-imports` setting, and a production Next build. A live development-only brief preview rendered the per-photo tags and note after a local image was selected. The baseline `pnpm launch:contracts` passed before this slice; rerun it on the exact final release commit. This is not a production customer-flow test. The schema and Edge function were deployed in that order; the web consumer is still pending.

The exact two reference-photo migration versions (`20260929090000`, `20260929091000`) were confirmed in Drape-DEV's migration ledger and absent from Drape-PROD's ledger in the Supabase SQL Editor. The eight older September 15-20 versions were also absent from Drape-PROD. The production CLI link now works. An exact PROD dry run with `--include-all` listed eight pending migrations: six older survey/marketing/guard versions and the two reference-photo versions. That is **not** an approved apply batch: it exceeds the five-migration batch cap and includes survey scheduling that needs a separate scope decision. Never run the broad push merely because its dry run succeeds.

The earlier reference-photo grant (`20260929091000`) was already applied in DEV. Review found that it allows both customer and tailor order participants to directly update attribution labels under the current non-terminal `orders` RLS policies, although the clients only create labels via `custom-order-action`. A forward migration (`20261004120000`) revokes that unnecessary column grant without changing the server-role write path. It was applied as the **only** pending version in an isolated Drape-DEV migration workspace after an exact dry run. SQL verification returned `authenticated` table UPDATE=false, attribution-column UPDATE=false, `service_role` attribution-column UPDATE=true, and the forward version present in the DEV ledger.

The PROD migration batch used a temporary workspace fetched from PROD's own applied migration ledger, with exactly the three reference-photo versions added. Its dry run listed only `20260929090000`, `20260929091000`, and `20261004120000`; the actual push applied these three together. Post-push SQL verification returned three versions present, column present, `authenticated` column UPDATE=false, `service_role` column UPDATE=true, and zero orders with populated attributions. Linked PROD schema lint passed. The six older survey/marketing/guard migrations were **not** applied.

The live PROD `custom-order-action` v49 source was downloaded and compared with the Git candidate. The Git bundle also contained different tax and fulfillment shared modules, so it was not deployed wholesale. A temporary deployment bundle was made from the downloaded live v49 source plus only the reference-photo attribution import, schema, sanitizer, insert field, two constants, and new shared sanitizer. The first upload failed bundling because the new sanitizer's import lacked `.ts`; the production function remained v49. After correcting that import in both the release source and temporary bundle, Deno check passed and a scoped retry deployed `custom-order-action` v50, ACTIVE, with `verify_jwt=false` unchanged. PROD schema lint passed again. This temporary-bundle provenance is important: do not redeploy the full Git function until its tax/fulfillment dependency drift is independently reviewed.

The explicit `.ts` import required by the Edge bundler also needed TypeScript opt-in in mobile and the shared Jest transform. Mobile typecheck passed; the focused shared Jest suite passed 20/20; `pnpm launch:contracts` passed using the required Node 22 runtime (the default Node 18 cannot run Jest 30); and the production Next build passed. This is source verification only; the web consumer has not yet been promoted or smoke-tested in production.

On October 4, a second isolated migration workspace was fetched from Drape-PROD's ledger and contained exactly five pending diary/passport versions: `20260930170000`, `20260930180000`, `20260930181000`, `20260930182000`, and `20261001120000`. The read-only dry run listed only those five. Production preflight confirmed all required diary and measurement columns, the domain-event enqueue function, no pre-existing `diary-photos` bucket, and no live invite statuses outside the new constraint. The five migrations then applied successfully. Postcheck returned five ledger versions, one private bucket, three attachment-table policies, three storage-object policies, authenticated RPC execute=false, and service-role execute=true. Linked schema lint passed with only pre-existing settlement-function warnings. Their exact source (matching SHA-256 hashes) is committed separately at `e4a5983` on `release/20261004-diary-passport`; that branch has not been pushed while Cloudflare branch deployment behavior is under review. The web/mobile diary consumers and two Edge Functions have not been promoted in this batch.

PR #23 for the isolated reference-photo web slice has passing static-contract and Cloudflare checks but remains open and blocked by required review. The Cloudflare bot linked a `production/builds` URL for its release-branch commit without a separate preview URL. Do not infer that the public Worker was or was not activated from that comment alone; verify the active Worker deployment and branch settings before any further branch push or merge.

The active Sketch Room sketch-pad source contains a Figure button with three traceable croquis builds (feminine, masculine, fuller). The guide is editing-only and excluded from the exported sheet by default. `packages/drape-studio/README.md` is stale where it says the active editor has no figure. The separate legacy `studio.html` figure/wardrobe editor and `packages/drape-tryon` remain outside this decision. Include the traceable guide in Sketch Room scope only after checking the exact built web bundle; defer native builds until the user can inspect it visually.

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
