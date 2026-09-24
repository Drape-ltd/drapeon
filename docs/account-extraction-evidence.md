# Account Extraction Evidence

## Slice 001 — account route boundary states

Date: 2026-09-23

### Scope

- Extracted the signed-out account state into `features/account/shared/account-route-states.tsx`.
- Extracted the account loading skeleton into the same leaf module.
- Kept `AuthRequiredCard` and `LoadingCard` as temporary compatibility wrappers inside `account-app-surface.tsx`.
- Added a deterministic development preview at `/account-preview` with signed-out and loading controls.
- Added an explicit production middleware guard returning HTTP 404 for `/account-preview`.

No Supabase query, mutation payload, authentication cleanup, local storage, realtime subscription, route authorization, or business workflow changed.

### Dependency boundary

The extracted module depends only on Next.js `Link`/`Route` and the existing Drapeon `Button` primitive. It has no Supabase, browser storage, mutation, realtime, or domain-data dependency. The legacy surface imports the module; the module does not import the legacy surface, so no cycle was introduced.

### Size

- Legacy surface before this slice: 29,441 lines at the Phase 0 baseline.
- Legacy surface after this slice: 29,413 lines.
- New route-state module: 58 lines.
- New preview harness: 55 lines.

The purpose of this slice is to prove the extraction and verification mechanism; it is not presented as a material reduction by itself.

### Automated verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- `git diff --check`: passed.
- Production Next.js build: passed. The existing missing `eslint-plugin-react-hooks` build-time warning remains unchanged; standalone ESLint succeeds.
- Preview Playwright test: 3/3 passed for mobile 375, tablet 768, and desktop 1440.
- Web Knip result: unchanged from the Phase 0 baseline; the new modules are reachable and not reported unused.
- Production HTTP check: `/account-preview` returns 404; `/account/orders` returns 200.

### Live browser verification

- Mobile 390×844: signed-out and loading states inspected; controls wrap without clipping and actions remain full-width where expected.
- Tablet 768×1024: signed-out state inspected; card width, spacing, typography, and horizontal overflow are unchanged.
- Desktop 1440×900: responsive viewport reported `innerWidth=1440`, `clientWidth=1440`, and `scrollWidth=1440`.
- Sign-in link preserved `/sign-in?next=%2Faccount%2Forders`.
- Create-account link preserved `/sign-up`.

### Known baseline conditions

- The development account route still reports the previously observed CSP nonce hydration warning from the root public-environment script. This slice neither introduces nor resolves it.
- Authenticated customer and tailor states are not claimed by this slice because these two leaf states do not render after authentication. Future authenticated slices remain blocked on deterministic role fixtures.

### Rollback boundary

Revert the preview route, preview harness, route-state module, middleware preview guard, and the two compatibility-wrapper edits together. No database or external rollback is required.

## Slice 002 — shared action-error presentation

Date: 2026-09-23

### Scope

- Extracted the pure action-error classification and user-safe message formatting helpers from `account-app-surface.tsx` into `packages/shared/src/action-errors.ts`.
- Published the helper module through the `@drape/shared/action-errors` package subpath.
- Replaced the legacy surface's local helpers with imports from the shared package.
- Added focused unit coverage for machine codes, generic server failures, validation leaks, connectivity failures, safe provider messages, `FunctionsHttpError` wrappers, and caller fallbacks.

No rendering markup, styles, hook ordering, Supabase request, mutation payload, authentication behavior, browser storage, realtime subscription, or route authorization changed.

### Dependency boundary

The new module is framework-independent TypeScript and has no React, Next.js, Supabase, browser, or native dependency. The web surface depends on the shared leaf module; the shared module does not depend on the web application, so no cycle was introduced. Equivalent error handling remains elsewhere in the repository and will be migrated only in later isolated slices.

### Size

- Legacy surface before this slice: 29,413 lines.
- Legacy surface after this slice: 29,336 lines.
- New shared action-error module: 88 lines.
- New focused test file: 56 lines.

### Automated verification

- Shared action-error tests: 12/12 passed.
- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- `git diff --check` for the slice: passed.
- Preview Playwright regression: 3/3 passed for mobile 375, tablet 768, and desktop 1440.
- Web Knip result: unchanged from the Phase 0 baseline at 11 candidate unused files, 19 unused exports, and 9 unused exported types. The new shared module is reachable and is not reported unused.
- Knip requires the repository's Node 22 runtime; the default Node 18 shell cannot run Knip 6 because `node:util.styleText` is unavailable there.

### Live browser verification

- Mobile 390×844: signed-out and loading route states inspected with no clipping, spacing change, or action-layout regression.
- Tablet 768×1024: signed-out route state inspected with unchanged card sizing and button layout.
- Desktop 1440×900: signed-out route state inspected with no new visual drift.
- Because this slice changes only error presentation helpers and the preview states do not trigger actions, the responsive pass is a rendering-regression check; the helper behavior is covered directly by unit tests.

### Known baseline conditions

- The existing development CSP nonce hydration issue remains visible in the Next.js development issue badge. This slice neither introduces nor resolves it.
- No existing Knip candidate was deleted or modified based on the baseline report.

### Rollback boundary

Revert the shared helper module and tests, the shared package export entries, and the corresponding imports/removal in `account-app-surface.tsx` together. No database or external rollback is required.

## Slice 003 — realtime subscription identifiers and configuration

Date: 2026-09-23

### Scope

- Extracted realtime filter-value validation and order-ID deduplication into `packages/shared/src/realtime-identifiers.ts`.
- Extracted the web account surface set, row events, child-table list, and quote-negotiation feature-gated table additions into `features/account/shared/account-realtime-config.ts`.
- Replaced the legacy surface's local declarations with imports from those dependency-closed modules.
- Added table-driven coverage for valid identifiers, malformed and injection-like filter strings, stable deduplication, ordering, the default 60-ID cap, and explicit limits.

No subscription channel name, table name, event list, feature flag, filter expression, retry behavior, DOM output, hook order, Supabase mutation, authentication behavior, browser storage, or route authorization changed.

### Dependency boundary

The shared identifier module is framework-independent TypeScript with no React, Next.js, Supabase, DOM, or browser dependency. The web configuration module depends only on the existing `AccountSurface` type and environment feature flag. Neither module imports the legacy surface, so no cycle was introduced.

### Size

- Legacy surface before this slice: 29,336 lines.
- Legacy surface after this slice: 29,310 lines.
- New web realtime configuration module: 30 lines.
- New shared identifier module: 18 lines.
- New focused test file: 47 lines.

### Automated verification

- Shared realtime-identifier tests: 13/13 passed.
- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- `git diff --check` for the slice: passed.
- Preview Playwright regression: 3/3 passed for mobile 375, tablet 768, and desktop 1440.
- Web Knip result: unchanged from the Phase 0 baseline at 11 candidate unused files, 19 unused exports, and 9 unused exported types. Neither new module is reported unused.

### Live browser verification

- Mobile 390×844: signed-out preview inspected; DOM order, full-width mobile actions, spacing, focus behavior, and responsive visibility are unchanged.
- Tablet 768×1024: signed-out preview inspected; card sizing and inline action layout are unchanged.
- Desktop 1440×900: signed-out preview inspected. The in-app browser capture retains its known black right-side surface artifact; the Playwright desktop assertion independently confirms no document overflow.
- The preview retains the existing signed-out state across viewport changes. This slice owns no rendered loading, empty, validation, success, error, retry, scroll, or input-persistence state beyond the unchanged route regression surface.

### Known baseline conditions

- The existing development CSP nonce hydration issue remains visible in the Next.js development issue badge. This slice neither introduces nor resolves it.
- The in-app browser's 1440-pixel capture artifact remains limited to the capture surface and was already documented before this slice.
- No existing Knip candidate was deleted or modified based on the baseline report.

### Rollback boundary

Revert the shared identifier module and tests, shared package export entries, web realtime configuration module, and corresponding imports/removal in `account-app-surface.tsx` together. No database or external rollback is required.

## Slice 004 — ready-made size-guide editor contract

Date: 2026-09-23

### Scope

- Extracted the ready-made fit field types, labels, category recommendations, size-guide normalization, editable draft conversion, guide completeness check, numeric input sanitation, and compact field summary into `packages/shared/src/ready-made-size-guide-editor.ts`.
- Published the pure module through the `@drape/shared/ready-made-size-guide-editor` package subpath.
- Replaced the legacy surface's duplicated types, constants, and helper implementations with imports from the shared package.
- Added direct tests for malformed fields, duplicate fields, reversed ranges, invalid bounds, rounding, note trimming, draft round-tripping, empty ranges, category fallback, decimal sanitation, and compact summaries.

No JSX, DOM order, class name, hook order, state ownership, Supabase query or mutation, payload shape, authentication behavior, browser storage, route authorization, or user-facing copy changed.

### Dependency boundary

The new editor module is framework-independent TypeScript with no React, Next.js, Supabase, DOM, browser, or native dependency. It is exposed as an explicit shared-package subpath rather than merged into the existing recommendation module during this slice, avoiding a behavior-changing consolidation. The legacy surface imports the module; the module does not import the legacy surface, so no cycle was introduced.

### Size

- Legacy surface before this slice: 29,310 lines.
- Legacy surface after this slice: 28,999 lines.
- Net legacy-surface reduction: 311 lines.
- New shared editor contract: 321 lines.
- New focused test file: 100 lines.

### Automated verification

- Shared size-guide editor tests: 5/5 passed.
- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- `git diff --check` for the slice: passed.
- Preview Playwright regression: 3/3 passed for mobile 375, tablet 768, and desktop 1440.
- Web Knip result: unchanged from the Phase 0 baseline at 11 candidate unused files, 19 unused exports, and 9 unused exported types. The new shared module is reachable and is not reported unused.

### Live browser verification

- Mobile 390×844, tablet 768×1024, and desktop 1440×900 signed-out account boundaries were inspected with unchanged DOM order, focus behavior, responsive visibility, and action layout.
- State persistence across viewport changes remains unchanged.
- No rendering block was moved in this slice; the extracted behavior is covered directly by the focused unit suite.
- The authenticated tailor size-guide editor itself remains unverified in the live browser because the current deterministic preview harness does not yet provide a tailor shop fixture. Under the repository completion rules, this slice is structurally verified but not claimed as authenticated-route visual proof.

### Known baseline conditions

- The existing development CSP nonce hydration issue remains visible in the Next.js development issue badge. This slice neither introduces nor resolves it.
- No existing Knip candidate was deleted or modified based on the baseline report.

### Rollback boundary

Revert the shared editor contract and tests, its shared package subpath, and the corresponding imports/removal in `account-app-surface.tsx` together. No database or external rollback is required.

## Slice 005 — account data contracts

Date: 2026-09-23

### Scope

- Moved 66 compile-time account data contracts from `account-app-surface.tsx` into `features/account/shared/account-data-contracts.ts`.
- Covered base profiles and orders, commercial records, messages, measurements, shop and wishlist records, payouts, disputes, and every route-specific surface/render payload.
- Replaced local declarations with one type-only import boundary.

No runtime statement, JSX, DOM order, class name, hook, state initializer, query, mutation, subscription, cache key, authentication behavior, browser storage, route authorization, or user-facing copy changed.

### Dependency boundary

The extracted module contains only TypeScript declarations and type-only imports from `@drape/shared`. It emits no runtime dependency and cannot introduce a client bundle cycle. The legacy surface imports the contracts; the contract module does not import the legacy surface.

### Size

- Legacy surface before this slice: 28,999 lines.
- Legacy surface after this slice: 28,262 lines.
- Net legacy-surface reduction: 737 lines.
- New data-contract module: 883 lines containing 66 exported contracts.

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- `git diff --check`: passed.
- Preview Playwright regression: 3/3 passed for mobile 375, tablet 768, and desktop 1440.
- Web Knip result: unchanged from the Phase 0 baseline at 11 candidate unused files, 19 unused exports, and 9 unused exported types. The contract module is reachable and not reported unused.
- Live browser: signed-out account boundary inspected at 390×844, 768×1024, and 1440×900 with unchanged DOM order, focus behavior, responsive visibility, and state persistence.

### Known baseline conditions

- The existing development CSP nonce hydration issue remains visible in the Next.js development issue badge. This slice neither introduces nor resolves it.
- No authenticated rendering code moved in this slice; the change is erased by TypeScript at compile time.

### Rollback boundary

Revert `account-data-contracts.ts` and the corresponding type-only import/removal in `account-app-surface.tsx` together. No database or external rollback is required.

## Slice 006 — account data access layer

Date: 2026-09-23

### Scope

- Extracted all route data defaults into `features/account/shared/account-empty-data.ts`.
- Extracted the account Supabase read models, customer-profile hydration, negotiation reads, saved-tailor data access, payout readiness checks, and shared Edge-function invocation into `features/account/shared/account-data-queries.ts`.
- Kept the exact select strings, table names, filters, limits, ordering, warning copy, Edge-function names, and return shapes.
- The legacy surface now imports the data gateway and receives the same typed payloads.

No database schema, mutation payload, subscription, authentication cleanup, storage key, cache key, JSX, DOM order, class name, hook order, or route authorization changed.

### Dependency boundary

The data module depends on the existing Supabase browser client, action-error helper, realtime feature flag, empty-data values, and type-only account contracts. It does not import the legacy surface. The surface depends on the gateway through its exported functions, so no cycle was introduced.

### Size

- Legacy surface before this slice: 28,262 lines.
- Legacy surface after this slice: 26,746 lines.
- Net legacy-surface reduction: 1,516 lines.
- New account data-query module: 1,471 lines.
- New account empty-data module: 158 lines.

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- `git diff --check`: passed.
- Preview Playwright regression: 3/3 passed for mobile 375, tablet 768, and desktop 1440.
- Web Knip result: unchanged from the Phase 0 baseline at 11 candidate unused files, 19 unused exports, and 9 unused exported types. Both new modules are reachable and not reported unused.
- Live browser: signed-out account boundary inspected at 390×844, 768×1024, and 1440×900 with unchanged DOM order, focus behavior, responsive visibility, and state persistence.

### Verification limitation

- The current preview harness does not yet supply authenticated customer/tailor Supabase fixtures, so the extracted query gateway has compiler and structural coverage but not a live authenticated data-read pass. It is not claimed as authenticated-route proof.
- The existing development CSP nonce hydration issue remains unchanged.

### Rollback boundary

Revert the data-query and empty-data modules plus their corresponding imports/removals in `account-app-surface.tsx` together. No database or external rollback is required.

## Slice 007 — messaging surface

Date: 2026-09-23

### Scope

- Moved the complete messaging dependency cluster into `features/account/messages/account-messages-surface.tsx`.
- The extraction includes the core messaging layout, message composer, content and media presentation, reactions, call and order lifecycle cards, voice/media hooks, and their local helpers.
- Kept shared helpers consumed by the legacy surface as explicit exports from the new domain module.

No JSX ordering, class name, hook ordering, state initializer, mutation payload, subscription, storage key, authentication behavior, route authorization, or user-facing copy changed.

### Size

- Legacy surface before this slice: 26,746 lines.
- Legacy surface after this slice: 22,135 lines.
- Net legacy-surface reduction: 4,611 lines.
- New messaging module: 4,725 lines covering 68 top-level declarations.

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression: 3/3 passed for mobile 375, tablet 768, and desktop 1440.
- The live in-app preview rendered the signed-out boundary after reload without overflow or layout displacement.
- The current preview harness does not supply an authenticated populated-message fixture, so the populated conversation states are not claimed as live visual proof.

### Rollback boundary

Revert `account-messages-surface.tsx` and the corresponding imports/removals in `account-app-surface.tsx` together. No database or external rollback is required.

## Slice 008 — tailor order actions

Date: 2026-09-23

### Scope

- Moved `TailorOrderActions` and its complete 28-declaration dependency closure into `features/account/orders/account-order-actions.tsx`.
- The extracted closure covers stage transitions, cancellation and delivery reasons, scope changes, evidence preparation and uploads, measurement snapshot access, and the local evidence/photo primitives used by the tailor workflow.
- Preserved the exact component body and helper implementations; helpers still consumed by customer and order-detail code are explicitly imported back into the legacy surface.

No JSX ordering, class name, hook ordering, state initializer, Supabase operation, Edge-function name, mutation payload, storage behavior, authentication cleanup, route authorization, or user-facing copy changed.

### Dependency boundary

The order-actions module imports existing shared contracts, query helpers, messaging primitives, and the Supabase client. The messaging module does not import the order-actions module, and the legacy surface only consumes exported actions/helpers, so no circular domain dependency was introduced.

### Size

- Legacy surface before this slice: 22,135 lines.
- Legacy surface after this slice: 19,608 lines.
- Net legacy-surface reduction: 2,527 lines.
- New order-actions module: 2,569 lines containing 29 moved top-level declarations.
- Goal result: 392 lines below the 20,000-line ceiling.

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- `git diff --check` for the extracted surfaces: passed.
- Preview Playwright regression: 3/3 passed for mobile 375, tablet 768, and desktop 1440, including horizontal-overflow assertions.
- The live in-app preview was reloaded, and both signed-out and loading states rendered correctly at the active 672×863 viewport with document width equal to viewport width.
- The final Knip report contains the repository's existing candidates (11 unused files, 32 unused exports, and 12 unused exported types at this working-tree revision); neither extracted domain module nor any newly exported order helper is reported unused. No candidates were deleted.

### Verification limitation

The deterministic preview harness does not yet provide an authenticated tailor-order fixture. The exact populated tailor action matrix therefore has compiler and structural coverage, but is not claimed as authenticated-route live visual proof.

### Rollback boundary

Revert `account-order-actions.tsx` and its corresponding imports/removals in `account-app-surface.tsx` together. No database or external rollback is required.

## Slice 009 — authenticated account preview fixtures

Date: 2026-09-23

### Scope

- Extended the development-only `/account-preview` harness with deterministic populated-message, tailor-order, and customer-order states.
- Added representative customer, tailor, order, stage-update, and message records in `features/account/preview/account-preview-fixtures.ts`.
- Wrapped the message fixture in the production account context required by the composer.
- Expanded the responsive preview regression from 3 to 12 cases across mobile 375, tablet 768, and desktop 1440.

The fixture is development-only and performs no database write. No production route, authentication rule, storage key, or live account record changed.

### Verification

- Web typecheck: passed.
- Preview Playwright regression: 12/12 passed across the three configured viewports.
- Every fixture asserts document-width containment with no horizontal overflow.
- Live browser inspection completed for populated messages, tailor actions, and customer actions at 1280×720; each document width matched the viewport width.
- The existing development CSP nonce issue badge remains visible and unchanged.

## Slice 010 — customer order actions

Date: 2026-09-23

### Scope

- Moved `CustomerOrderActions` and its complete 13-declaration dependency closure into `features/account/orders/account-order-actions.tsx` beside the tailor action workflow.
- Covered customer cancellation and delivery reviews, scope changes, measurement confirmation, fabric tracking, receipt confirmation, aftercare, concern escalation, and emergency support states.
- Kept the exact component and helper bodies and reconnected the legacy surface through one domain import.

No JSX ordering, class name, hook ordering, state initializer, API name, mutation payload, media rule, authentication behavior, browser storage, route authorization, or user-facing copy changed.

### Size

- Legacy surface before this slice: 19,608 lines.
- Legacy surface after this slice: 18,326 lines.
- Net legacy-surface reduction: 1,282 lines.
- Consolidated order-actions module: 3,861 lines.
- Cumulative reduction from the 28,999-line phase baseline: 10,673 lines.

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression: 12/12 passed for signed-out, loading, populated messages, tailor actions, and customer actions at mobile 375, tablet 768, and desktop 1440.
- Live browser inspection confirmed the customer action disclosures, tailor production-stage controls, and populated message conversation render without document overflow.
- Knip remains at the current working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The preview fixture and consolidated order-actions module are reachable and are not reported unused.

### Rollback boundary

Revert the customer action declarations in `account-order-actions.tsx`, restore them in `account-app-surface.tsx`, and revert the preview fixture/harness/test changes together. No database or external rollback is required.

## Slice 011 — payout and earnings surfaces

Date: 2026-09-23

### Scope

- Moved the legacy payout destination setup and earnings/settlement ledger into `features/account/payouts/account-payout-surfaces.tsx`.
- The dependency closure includes payout readiness labels, blocked-payout recovery, transaction status derivation, CSV generation, stage pills, provider delivery status, bank settlement activity, and payout destination management.
- Added deterministic verified-payout and populated earnings fixtures to the development-only account preview.
- Added responsive regression coverage for the payout destination, transaction history, payout history, and settlement presentation.

No API name, Supabase table, provider action, payout payload, currency rule, authentication behavior, browser storage, route authorization, or user-facing copy changed during extraction.

### Size

- Legacy surface before this slice: 18,326 lines.
- Legacy surface after this slice: 16,992 lines.
- Net legacy-surface reduction: 1,334 lines.
- New payout-domain module: 1,372 lines containing 22 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 12,007 lines.

### Responsive defect found and fixed

The new authenticated fixture exposed a pre-existing 173-pixel document overflow on the 375-pixel earnings view. The transaction table itself already supported horizontal scrolling, but its containing earnings surface participated in grid intrinsic sizing and expanded the document. The transaction surface and its table boundary now use explicit `min-w-0`, `max-w-full`, and overflow containment, preserving table scrolling without widening the page.

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 18/18 passing cases across mobile 375, tablet 768, and desktop 1440.
- Every state asserts document-width containment. The earnings fixture now reports no mobile document overflow.
- Live browser inspection completed for the verified payout destination at 672×863 and the earnings/settlement ledger at 1280×720; document width matched viewport width in both views.
- Knip remains at the current working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The new payout-domain module and fixture are reachable and are not reported unused.

### Rollback boundary

Revert `account-payout-surfaces.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the payout/earnings preview fixture and test additions together. The responsive containment fix lives inside the extracted transaction surface. No database or external rollback is required.

## Slice 012 — shop and ready-made catalogue management

Date: 2026-09-23

### Scope

- Moved the authenticated tailor catalogue surface, ready-made listing editor, sortable media grid, media inspection overlay, publish-readiness rules, fit-guide handling, and marketplace shop rendering into `features/account/shop/account-shop-surface.tsx`.
- Preserved media limits, accepted content types, inventory parsing, size-guide normalization, payout and identity readiness checks, fulfillment requirements, listing actions, and customer marketplace filtering.
- Added a deterministic authenticated shop fixture with one published ready-made listing to the development-only account preview.
- Extended responsive preview coverage to catalogue metrics, listing creation, fit-guide controls, fulfillment settings, and existing-listing management.

No API name, storage bucket, media validation rule, listing payload, payout rule, identity rule, authentication behavior, browser storage, route authorization, or user-facing copy changed.

### Size

- Legacy surface before this slice: 16,992 lines.
- Legacy surface after this slice: 15,285 lines.
- Net legacy-surface reduction: 1,707 lines.
- New shop-domain module: 1,754 lines containing 24 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 13,714 lines.
- The 16,000-line milestone is exceeded by 715 lines.

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 21/21 passing cases across mobile 375, tablet 768, and desktop 1440.
- Every preview state asserts document-width containment.
- Live browser inspection completed for the authenticated shop at 672×863, covering metrics, listing inputs, fit-guide controls, fulfillment, and the published listing; document width matched viewport width.
- Knip remains at the current working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The shop-domain module and fixture are reachable and are not reported unused.

### Rollback boundary

Revert `account-shop-surface.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the shop preview fixture and test additions together. No database or external rollback is required.

## Slice 013 — identity handoff and trust review

Date: 2026-09-23

### Scope

- Moved the tailor identity handoff, trust-review status parsing, profile-photo rejection handling, and setup-draft resume helpers into `features/account/profile/identity-handoff-card.tsx`.
- Preserved the existing review states and the targeted replacement-photo flow without changing its API, storage, or authentication behavior.
- Added deterministic approved-review and rejected-profile-photo fixtures to the development-only account preview.
- Extended responsive regression coverage to the approval handoff and rejection recovery action.

No API name, verification code, upload rule, storage key, authentication behavior, route authorization, or user-facing copy changed.

### Size

- Legacy surface before this slice: 15,285 lines.
- Legacy surface after this slice: 14,604 lines.
- Net legacy-surface reduction: 681 lines.
- New profile-domain module: 706 lines containing 16 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 14,395 lines.

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 27/27 passing cases across mobile 375, tablet 768, and desktop 1440.
- Every preview state asserts document-width containment.
- Live browser inspection completed for both approved and rejected review states at 672×863; document width matched viewport width and the expected dashboard/replacement actions rendered.
- The repository-wide Knip report still exits non-zero for pre-existing candidates; the new identity module is reachable and is not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `identity-handoff-card.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the identity preview fixtures and tests together. No database or external rollback is required.

## Slice 014 — portfolio management

Date: 2026-09-23

### Scope

- Moved the authenticated portfolio manager and its complete dependency closure into `features/account/profile/portfolio-manager.tsx`.
- The slice includes image/video validation, video poster capture, portfolio uploads, ordering, cover selection, deletion, detail editing, inspection, crop/focal-point controls, accessibility descriptions, and marketplace presentation previews.
- Added a deterministic populated portfolio fixture using repository-owned editorial media.
- Extended responsive regression coverage to the upload surface, saved media tiles, and presentation editor.

No API name, storage bucket, upload limit, media validation rule, mutation payload, authentication behavior, route authorization, or user-facing copy changed.

### Size

- Legacy surface before this slice: 14,604 lines.
- Legacy surface after this slice: 13,637 lines.
- Net legacy-surface reduction: 967 lines.
- New profile-domain module: 996 lines containing 13 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 15,362 lines.

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 30/30 passing cases across mobile 375, tablet 768, and desktop 1440.
- Every preview state asserts document-width containment.
- Live browser inspection completed for the populated portfolio at 672×863. All seven rendered images loaded, saved portfolio tiles and presentation previews were visible, and document width matched viewport width.
- Web-scoped Knip remains at the established working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The new portfolio module is reachable and is not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `portfolio-manager.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the portfolio preview fixture and test additions together. No database or external rollback is required.

## Slice 015 — tailor selling setup

Date: 2026-09-23

### Scope

- Moved the authenticated tailor selling/setup editor into `features/account/profile/tailor-selling-setup-editor.tsx` with its seller-type option picker and option constants.
- Preserved identity, business, pricing, specialty, language, consultation, order-status, fulfillment, pickup, and setup-draft behavior.
- Added a deterministic populated selling-setup fixture to the development-only account preview.
- Extended responsive coverage across the complete expanded setup form.

No API name, validation rule, draft-storage key, mutation payload, authentication behavior, route authorization, or user-facing copy changed.

### Size

- Legacy surface before this slice: 13,637 lines.
- Legacy surface after this slice: 12,821 lines.
- Net legacy-surface reduction: 816 lines.
- New profile-domain module: 843 lines containing 3 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 16,178 lines (55.8%).

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 33/33 passing cases across mobile 375, tablet 768, and desktop 1440.
- Every preview state asserts document-width containment.
- Live browser inspection completed for the fully expanded selling setup at 672×863. Profile, pricing, consultation, order-status, fulfillment, and save controls rendered; document width matched viewport width.
- Web-scoped Knip remains at the established working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The new selling-setup module is reachable and is not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `tailor-selling-setup-editor.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the selling-setup preview fixture and tests together. No database or external rollback is required.

## Slice 016 — material advances and protected fabric funding

Date: 2026-09-23

### Scope

- Moved the material-advance workflow and its Stripe card-authorization dependency closure into `features/account/orders/material-advance-panel.tsx`.
- Preserved customer approval/decline, legacy separate payments, protected fabric-allowance releases, supplier evidence, receipt reconciliation, acquired-fabric proof, signed evidence viewing, and Stripe authorization behavior.
- Added a deterministic customer-facing requested-advance fixture to the development-only account preview.
- Extended responsive regression coverage to the approval and decline decision surface.

No API name, storage bucket, payment-provider behavior, funding rule, evidence rule, mutation payload, authentication behavior, route authorization, or user-facing copy changed.

### Size

- Legacy surface before this slice: 12,821 lines.
- Legacy surface after this slice: 11,836 lines.
- Net legacy-surface reduction: 985 lines.
- New order-domain module: 1,008 lines containing 9 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 17,163 lines (59.2%).

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 36/36 passing cases across mobile 375, tablet 768, and desktop 1440.
- Every preview state asserts document-width containment.
- Live browser inspection completed for customer material approval at 672×863. The requested amount, funding statuses, proof action, and approval/decline actions rendered; document width matched viewport width.
- Web-scoped Knip remains at the established working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The new material-advance module is reachable and is not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `material-advance-panel.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the material-advance preview fixture and tests together. No database or external rollback is required.

## Slice 017 — Drapeon Dispatch

Date: 2026-09-23

### Scope

- Moved the Drapeon Dispatch card and its complete eight-declaration dependency closure into `features/account/orders/account-dispatch-card.tsx`.
- Preserved delivery-method replacement, recipient/address capture, provider quote decisions, shortfall presentation, pickup recovery, tracking, event history, evidence viewing, realtime subscriptions, and exception handling.
- Updated the existing isolated order-detail workspace to import dispatch from its domain module instead of the legacy surface.
- Added an optional preview-state seam that bypasses remote loading and realtime subscriptions only when explicitly supplied; production callers retain the existing runtime path.
- Added a deterministic customer quote-decision fixture and responsive preview coverage.

No API name, database table, delivery rule, payment rule, mutation payload, authentication behavior, route authorization, or user-facing copy changed.

### Size

- Legacy surface before this slice: 11,836 lines.
- Legacy surface after this slice: 10,892 lines.
- Net legacy-surface reduction: 944 lines.
- New order-domain module: 973 lines containing 8 moved top-level declarations plus the preview-only state seam.
- Cumulative reduction from the 28,999-line phase baseline: 18,107 lines (62.4%).

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 39/39 passing cases across mobile 375, tablet 768, and desktop 1440.
- Every preview state asserts document-width containment.
- Live browser inspection completed for the expanded dispatch quote decision at 672×863. Provider, arrival, location, protected allowance, provider price, payment choice, alternative actions, and history rendered; document width matched viewport width.
- Web-scoped Knip remains at the established working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The dispatch module and preview state type are reachable and are not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `account-dispatch-card.tsx`, restore its declarations in `account-app-surface.tsx`, restore the prior isolated-workspace import, and revert the dispatch preview fixture and tests together. No database or external rollback is required.

## Slice 018 — ready-made checkout

Date: 2026-09-23

### Scope

- Moved the ready-made checkout form and its complete seven-declaration dependency closure into `features/account/checkout/ready-made-checkout-form.tsx`.
- Preserved size inventory, quantity limits, fit acknowledgement, pickup/delivery/shipping selection, recipient and address validation, tax preview freshness, stock holding, promotion reservation, benefit application, and secure-payment handoff.
- Added a deterministic ready-made checkout state using the existing populated catalogue fixture.
- Extended responsive regression coverage to size, quantity, fulfillment, fit review, recipient details, tax preview, and payment gating.

No API name, inventory rule, tax rule, promotion rule, checkout mutation payload, authentication behavior, route authorization, or user-facing copy changed.

### Size

- Legacy surface before this slice: 10,892 lines.
- Legacy surface after this slice: 9,929 lines.
- Net legacy-surface reduction: 963 lines.
- New checkout-domain module: 988 lines containing 7 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 19,070 lines (65.8%).
- This slice moves the legacy surface below 10,000 lines for the first time.

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 42/42 passing cases across mobile 375, tablet 768, and desktop 1440.
- Every preview state asserts document-width containment.
- Live browser inspection completed for delivery checkout at 672×863. Size and stock, quantity, fulfillment, fit acknowledgement, recipient inputs, tax preview, and payment gate rendered; document width matched viewport width.
- Web-scoped Knip remains at the established working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The new checkout module is reachable and is not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `ready-made-checkout-form.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the ready-made checkout preview/test additions together. No database or external rollback is required.

## Slice 019 — tailor profile surface

Date: 2026-09-23

### Scope

- Moved the tailor profile route surface and its complete six-declaration closure into `features/account/profile/account-profile-surface.tsx`.
- The slice includes the profile hero, readiness state, four-step setup coordinator, avatar validation/upload, go-live checklist, portfolio composition, selling setup composition, trust handoff, and profile actions.
- Preserved the already extracted portfolio, selling setup, identity, shop-proof, and onboarding components as domain imports rather than duplicating their implementations.
- Added a deterministic full profile-overview state and responsive regression coverage.
- Corrected the preview-only tailor data to represent an available, priced tailor instead of relying on fallback availability and pricing labels.

No API name, storage bucket, setup validation rule, draft key, mutation payload, authentication behavior, route authorization, or production user-facing copy changed.

### Size

- Legacy surface before this slice: 9,929 lines.
- Legacy surface after this slice: 9,076 lines.
- Net legacy-surface reduction: 853 lines.
- New profile-domain module: 884 lines containing 6 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 19,923 lines (68.7%).

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 45/45 passing cases across mobile 375, tablet 768, and desktop 1440.
- Every preview state asserts document-width containment.
- Live browser inspection completed for the full profile overview at 672×863. Profile identity, live/readiness state, statistics, go-live checklist, portfolio, and downstream actions rendered; all images loaded and document width matched viewport width.
- Web-scoped Knip remains at the established working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The new profile module is reachable and is not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `account-profile-surface.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the profile overview preview/test additions together. No database or external rollback is required.

## Safe-pass stopping boundary

After Slice 019, the remaining `RenderOrderDetail` closure is approximately 2,849 lines across 29 declarations and spans checkout authorization, adjustments, returns, refunds, tips, reviews, timeline, and dossier presentation. Extracting it as one unit would exceed the locked 700–2,200-line slice limit. It must first be split into independently previewed order-resolution and payment/review leaves before moving the route coordinator itself.

## Slice 020 — order resolution panels

Date: 2026-09-23

### Scope

- Moved the order tip, operational refund status, protected return resolution, commercial adjustment, and customer review panels with their complete 14-declaration dependency closure into `features/account/orders/order-resolution-panels.tsx`.
- Preserved all action endpoints, evidence uploads, payment handoffs, realtime refund subscriptions, remedy/adjustment state machines, review-media preparation, and production rendering behavior.
- Added a deterministic delivered-order preview that renders every extracted panel, including an injected preview-only refund resolution that bypasses the realtime lookup only inside the harness.
- Extended responsive regression coverage for the five extracted panels.

No API name, database table, storage bucket, mutation payload, payment behavior, authentication behavior, route authorization, or production user-facing copy changed.

### Size

- Legacy surface before this slice: 9,076 lines.
- Legacy surface after this slice: 7,629 lines.
- Net legacy-surface reduction: 1,447 lines.
- New order-resolution module: 1,486 lines containing 14 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 21,370 lines (73.7%).

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression: the prior 45 cases passed in the full run, and the corrected order-resolution case passed across mobile 375, tablet 768, and desktop 1440, yielding 48/48 passing cases.
- Live browser inspection completed for all five resolution panels at 375, 768, and 1440 pixels. Each viewport rendered the expected panels with zero document-width overflow.
- Web-scoped Knip remains at the established working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The new resolution module is reachable and is not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `order-resolution-panels.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the order-resolution preview/test additions together. No database or external rollback is required.

## Next safe boundary

After Slice 020, the complete remaining `RenderOrderDetail` closure is approximately 1,380 lines across 15 declarations. It now fits the locked 700–2,200-line slice limit and can be moved as the next independently previewed order-detail coordinator slice.

## Slice 021 — account order-detail surface

Date: 2026-09-23

### Scope

- Moved the complete legacy account order-detail coordinator and its 15-declaration closure into `features/account/orders/account-order-detail-surface.tsx`.
- The slice includes stage progression, order history, brief dossier presentation, checkout routing, commercial benefits, settlement and dispute summaries, production proof, messages, and composition of previously extracted action, dispatch, material, resolution, review, and tip panels.
- Added a deterministic full order-detail preview within the same account context used by production message composition.
- Extended responsive regression coverage for the complete coordinator.

No API name, storage bucket, mutation payload, order state transition, payment behavior, authentication behavior, route authorization, or production user-facing copy changed.

### Size

- Legacy surface before this slice: 7,629 lines.
- Legacy surface after this slice: 6,271 lines.
- Net legacy-surface reduction: 1,358 lines.
- New order-detail module: 1,395 lines containing 15 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 22,728 lines (78.4%).

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 51/51 passing cases across mobile 375, tablet 768, and desktop 1440.
- Live browser inspection completed for the complete order-detail coordinator at all three viewports. Stage progress, payments, messages, and brief dossier rendered with zero document-width overflow.
- Web-scoped Knip remains at the established working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The new order-detail module is reachable and is not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `account-order-detail-surface.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the order-detail preview/test additions together. No database or external rollback is required.

## Next safe boundary

The legacy surface is now 6,271 lines. Its remaining largest domain leaves are discovery/tailor detail, work/orders/checkout, saved items, and settings/support. `AccountAppSurface` itself is 793 lines and should remain until those route leaves are extracted, after which it can be reduced to the target thin coordinator.

## Slice 022 — account marketplace surfaces

Date: 2026-09-23

### Scope

- Moved Explore, saved collections, tailor detail, and ready-made item detail with their complete shared 12-declaration closure into `features/account/marketplace/account-marketplace-surfaces.tsx`.
- Preserved search/filter URL state, marketplace eligibility, saved-item behavior, tailor and item media, review presentation, inquiry creation, and checkout/profile routing.
- Added a populated marketplace preview that mounts all four extracted surfaces inside an authenticated customer context.
- Extended responsive regression coverage for all four surfaces.

No API name, marketplace eligibility rule, mutation payload, authentication behavior, route authorization, or production user-facing copy changed.

### Size

- Legacy surface before this slice: 6,271 lines.
- Legacy surface after this slice: 4,694 lines.
- Net legacy-surface reduction: 1,577 lines.
- New marketplace module: 1,609 lines containing 12 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 24,305 lines (83.8%).

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression: the prior 51 cases passed in the full run, and the corrected marketplace case passed across mobile 375, tablet 768, and desktop 1440, yielding 54/54 passing cases.
- Live browser inspection completed for Explore, saved items, tailor detail, and ready-made item detail at all three viewports with zero document-width overflow.
- Web-scoped Knip remains at the established working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. The new marketplace module is reachable and is not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `account-marketplace-surfaces.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the marketplace preview/test additions together. No database or external rollback is required.

## Next safe boundary

The legacy surface is now below 5,000 lines. The next bounded extraction should group work/orders/checkout (approximately 1,100 lines before shared helpers), followed by settings/support. The 793-line `AccountAppSurface` root remains last so route composition can be validated after its leaves move.

## Slice 023 — order lists, work queue, and checkout

Date: 2026-09-23

### Scope

- Moved customer order lists, the tailor work cockpit, and customer checkout with their complete nine-declaration closure into `features/account/orders/account-order-list-surfaces.tsx`.
- Preserved order visibility, filtering, sorting, action derivation, tailor readiness, work columns, checkout totals, tax presentation, and provider handoff behavior.
- Added a populated preview covering all three extracted surfaces.
- Corrected the order-table grid containment exposed at the 768-pixel breakpoint by using a zero-minimum grid track and an explicitly shrinkable table wrapper.

No API name, order visibility rule, payment mutation, tax behavior, authentication behavior, route authorization, or production user-facing copy changed.

### Size

- Legacy surface before this slice: 4,694 lines.
- Legacy surface after this slice: 3,644 lines.
- Net legacy-surface reduction: 1,050 lines.
- New order-list module: approximately 1,081 lines containing nine moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 25,355 lines (87.4%).

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression expanded to 57/57 passing cases across mobile 375, tablet 768, and desktop 1440.
- Live browser inspection completed for orders, tailor work, and checkout at all three viewports with zero document-width overflow after the tablet containment correction.

### Rollback boundary

Revert `account-order-list-surfaces.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the order-list preview/test additions together. No database or external rollback is required.

## Slice 024 — settings and support

Date: 2026-09-23

### Scope

- Moved account settings, profile/security controls, guarded reauthentication helpers, account deletion, FAQs, support requests, handoff help, and direct support contacts into `features/account/settings/account-settings-support-surfaces.tsx`.
- Preserved all session checks, security proof flows, profile updates, account deletion behavior, support mutations, and contact routes.
- Added a populated customer settings/support preview and responsive regression coverage.

No API name, security requirement, deletion workflow, mutation payload, authentication behavior, route authorization, or production user-facing copy changed.

### Size

- Legacy surface before this slice: 3,644 lines.
- Legacy surface after this slice: 2,288 lines.
- Net legacy-surface reduction: 1,356 lines.
- New settings/support module: 1,386 lines containing 15 moved top-level declarations.
- Cumulative reduction from the 28,999-line phase baseline: 26,711 lines (92.1%).

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Preview Playwright regression: the prior 57 cases passed in the full run, and the corrected settings/support case passed across mobile 375, tablet 768, and desktop 1440, yielding 60/60 passing cases.
- Live browser inspection completed for settings and support at all three viewports with zero document-width overflow.
- Web-scoped Knip remains at the established working-tree report of 11 candidate unused files, 32 unused exports, and 12 unused exported types. Both new modules are reachable and are not reported unused. No deletion was performed from the report.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Revert `account-settings-support-surfaces.tsx`, restore its declarations in `account-app-surface.tsx`, and revert the settings/support preview/test additions together. No database or external rollback is required.

## Final-root boundary

The legacy surface is now 2,288 lines. `AccountAppSurface` itself is 793 lines; the remainder consists of its route/runtime helpers plus a disconnected legacy shell and old local helpers. The final pass should first prove those declarations are unreachable, remove only the confirmed dead set, and then extract the remaining cache/realtime runtime so the file lands near the 500–800-line coordinator target without relocating the entire monolith under a new name.

## Slice 025 — final account coordinator

Date: 2026-09-23

### Scope

- Moved the live `AccountAppSurface` and its complete 18-declaration cache, shell-loading, realtime, notification, and route-composition closure into `features/account/account-app-coordinator.tsx`.
- Replaced `components/account-app-surface.tsx` with a three-line compatibility entrypoint so existing route imports remain stable.
- Did not carry the disconnected legacy route shell or the obsolete local editor, slideshow, and conversation helpers into the live coordinator module.
- Relocated the shared Stripe browser declaration beside the exported Stripe client type in `material-advance-panel.tsx`; this preserves the ambient type contract after removal of the legacy declaration host.

No API name, data query, cache TTL, realtime subscription, notification behavior, authentication behavior, route authorization, or production user-facing copy changed.

### Size

- Legacy surface before this slice: 2,288 lines.
- Compatibility entrypoint after this slice: 3 lines.
- Net reduction in `account-app-surface.tsx`: 2,285 lines.
- Focused account coordinator module: 1,095 lines containing 18 live top-level declarations.
- Cumulative reduction in the original 28,999-line file: 28,996 lines (effectively 100%).

### Verification

- Web typecheck: passed.
- Web lint: 0 errors; the established 18-warning baseline remains unchanged.
- Full preview Playwright regression: 60/60 passing across mobile 375, tablet 768, and desktop 1440.
- Live browser inspection confirmed the settings/support preview still renders after the coordinator move.
- Web-scoped Knip still reports 11 candidate unused files. The export audit increased from 32 to 38 candidate unused exports and from 12 to 14 candidate unused exported types because removal of the disconnected legacy shell exposed six previously hidden exports and two types. The new coordinator is reachable and is not reported unused; no follow-up deletion was performed without a separate review.
- Relevant-file `git diff --check`: passed.

### Rollback boundary

Restore the pre-slice `account-app-surface.tsx`, remove `account-app-coordinator.tsx`, and move the Stripe browser declaration back with it. Revert the three files together; no database or external rollback is required.

## Completion boundary

The original monolith is now a stable three-line entrypoint. The live coordinator is 1,095 lines and contains only route orchestration, cache/realtime lifecycle, and composition. Further reductions should be treated as ordinary focused hook extraction rather than monolith deconstruction. The newly exposed Knip candidates require a separate evidence-backed cleanup pass before deletion.
