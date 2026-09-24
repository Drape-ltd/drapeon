# Account Monolith Deconstruction Plan

## Objective

Reduce the ownership, review, and regression surface of `apps/web/components/account-app-surface.tsx` through behavior-preserving, independently verifiable extractions. Apply the same method to `NativeDrapeVisionScreen.tsx` only after the web account path has proven the process.

This is a strangler refactor. It is not permission to rewrite workflows, redesign screens, change authoritative transitions, or delete code solely because a static-analysis tool reports it.

## Baseline

- `account-app-surface.tsx`: 29,441 lines before Phase 0; 366 top-level declarations.
- Largest internal blocks include `TailorOrderActions` (2,190 lines), `RenderMessages` (1,944), `CustomerOrderActions` (1,185), `MessageComposer` (1,065), and `SellerItemManager` (949).
- `NativeDrapeVisionScreen.tsx`: 14,706 lines.
- The initial web Knip run reports 11 candidate unused files, 19 candidate unused exports, 9 candidate unused exported types, and dependency findings. These are review candidates, not deletion instructions.
- The initial lint run reported two missing hook dependency warnings in the account surface. Phase 0 replaces the unstable values with memoized/callback dependencies and requires live validation before those changes are accepted.

## Non-negotiable safety rules

1. Extract one dependency-closed slice at a time. A slice must be small enough to review and revert independently.
2. Preserve DOM structure, class names, component props, query keys, mutation payloads, loading states, and error copy unless a separately approved product change says otherwise.
3. Do not mix extraction with feature work, database changes, design changes, dependency upgrades, or cleanup of unrelated warnings.
4. Never use `localStorage.clear()`. Authentication cleanup may remove only the explicit keys or Supabase cookies owned by the affected flow.
5. No candidate reported by Knip is deleted until its runtime entrypoints, dynamic imports, package exports, tests, scripts, and deployment configuration are checked manually.
6. Platform-neutral domain contracts may move to `packages/shared`. React components, browser storage, Next.js routing, Supabase browser clients, and web-only layout values stay inside `apps/web`.
7. Drapeon Vision work requires its dedicated design and regression runbook plus fresh physical-device validation. A simulator alone cannot close the Vision phase.

## Per-slice gate

Every extraction must have one evidence record containing:

1. Before/after line counts and the exact symbols moved.
2. An import/dependency map showing the slice does not create a cycle.
3. `git diff --check`, web lint, web typecheck, and relevant unit/e2e results.
4. Live browser evidence at mobile (390×844), tablet (768×1024), and desktop (1440×900).
5. Authenticated customer and tailor coverage when the slice is role-sensitive.
6. Interaction checks for loading, empty, success, validation, error, retry, and re-entry states applicable to the slice.
7. A statement confirming DOM order, focus behavior, scroll position, responsive visibility, and state persistence did not change.
8. A rollback boundary: one commit or patch containing only that extraction.

No new slice starts while the prior slice has an open regression.

## Phase 0 — diagnostics and harnesses

### Static analysis

- Keep `knip.json` explicit per workspace.
- Run both `pnpm knip` and `pnpm knip:production`; compare results rather than merging them blindly.
- Classify each finding as confirmed dead, framework entrypoint, runtime/dynamic reference, public package API, test-only, or unresolved.
- Store the reviewed baseline in the extraction evidence log. Initial output must not delete files.

### Lint and compiler baseline

- Resolve the two existing hook dependency warnings using stable memoized values and callbacks.
- Record remaining warnings separately. Do not combine image optimization or React Compiler compatibility changes with an extraction.
- Keep typecheck and lint at least as clean as the pre-slice baseline.

### Account preview harness

Create a development-only `/account-preview` harness with deterministic fixtures for:

- customer and tailor roles;
- mobile, tablet, and desktop layouts;
- loading, empty, populated, validation, success, failure, and retry states;
- long names, long currency values, media failures, and overflowing message content;
- order stages used by each action matrix;
- payout unavailable, pending, enabled, held, and failed states.

The harness must not contact production, write to Supabase, or expose real customer data. It must fail closed with `notFound()` outside development, remain non-indexable, and never be linked from production navigation.

### Route verification matrix

Add Playwright coverage for every `/account/*` route with:

- signed-out redirect and preserved `next` URL;
- authenticated customer authorization;
- authenticated tailor authorization;
- direct URL entry, reload, back/forward navigation, and narrow viewport overflow;
- explicit fixtures or mocked gateways instead of shared mutable production data.

## Phase 1 — leaf-node extraction

Extract in this order:

1. Pure account types and domain constants already shared by mobile and web.
2. Pure formatting and normalization rules with table-driven unit tests.
3. Web-only presentation helpers into `apps/web/features/account/shared`.
4. Supabase query/select definitions and response mapping into domain data modules under the web feature.
5. Independent primitives smaller than 250 lines with no mutation ownership.

Before moving a helper into `packages/shared`, prove that it has no React, DOM, Next.js, browser storage, or Supabase client dependency and add shared-package tests.

## Phase 2 — domain slices

Preferred extraction sequence:

1. Messages: presentation helpers, thread list, composer, media/voice controls, then the workspace coordinator.
2. Orders: customer actions and tailor actions as separate slices, followed by common timelines and evidence panels.
3. Payouts: settlement presentation, provider states, payout actions, then the workspace coordinator.
4. Shop and checkout.
5. Profile, support, saved items, and remaining account shells.

Each domain should expose a small public surface from its folder. Cross-domain imports must go through explicit contracts rather than reaching into another domain's internal component files.

## Phase 3 — route ownership and monolith retirement

- Route workspaces become the composition boundary.
- `AccountAppSurface` temporarily delegates to extracted workspaces and shrinks without changing its public props.
- Remove a legacy branch only after its replacement has passed the complete route and viewport matrix.
- Retire `AccountAppSurface` only when no route imports it and Knip, route tests, and live inspection agree.

## Phase 4 — Drapeon Vision

Treat Vision as a separate program after the web process is stable:

1. Read and follow `docs/drapeon-vision-design-and-regression-runbook.md`.
2. Extract pure geometry, measurement, and state-machine logic before UI.
3. Preserve native module versions, worklets, camera lifecycle, orientation handling, and capture buffers.
4. Validate the first, second, and third scan on fresh iOS and Android development builds.
5. Record physical-device screenshots/video, crash logs, measurement output parity, retake behavior, background/resume, and permission recovery.

## Stop conditions

Stop and revert the current slice if any of the following occurs:

- DOM or responsive layout drift;
- an interaction loses pending input or state on remount;
- new hook, hydration, compiler, or accessibility warnings;
- route authorization or deep-link behavior changes;
- bundle cycles or unexpected client/server boundary changes;
- a mutation payload, idempotency key, realtime subscription, or cache invalidation changes;
- the required authenticated fixture or physical device is unavailable.

## Completion criteria

The program is complete when no production route depends on the monolith, all extracted domains have explicit contracts and tests, static analysis has a reviewed baseline with no unexplained high-confidence findings, and every affected route has live customer/tailor evidence across the three viewport classes.
