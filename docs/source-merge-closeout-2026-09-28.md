# Existing-work source merge — 2026-09-28

Prepared against current remote main `00605b29735e4e6ff5776345ec0d6322dad09786` in an isolated checkout. The original dirty checkout was preserved. This is source integration, not a mobile release or a fresh refactoring phase.

## Included

- Remaining mobile customer/tailor order and tailor-setup extractions, preserving route controllers and domain leaf modules. Customer order controller: 9,040 → 4,892 lines; tailor order controller: 8,511 → 3,876; setup: 4,969 → 3,390.
- Web messaging/order-action extractions, with compatibility exports of 9 and 5 lines. The actual UI/logic remains in domain modules; small adapter files do not mean the feature has disappeared or that runtime bundle size was measured.
- Confirmed phone persistence, server-owned OTP policy, canonical web readback and retry-state preview. The server implementation preserves current main's existing contact-change protections.
- Fulfillment-origin validation for all enabled methods, cross-platform brief draft compatibility and clearer retry errors, reference-upload path/diagnostics, and safe old-client customer-supplied fabric-quote compatibility. Tailor-sourced allocation is never guessed.
- Already-promoted protected recruitment-waiver source, exact three migration files, Ops review/media-policy work, and operational case documentation. Migrations are recorded, not reapplied by this merge.
- Public approved-profile rendering when media is withheld; moderation filters remain intact.

Current main's newer role-isolation, identity/bootstrap and lifecycle work is retained. No native dependency, lockfile, app identity, Vision component, production account state, notification delivery or migration backlog is changed by this source merge.

## Verification and limits

- Exact `pnpm launch:contracts` passed on Node 24 on the combined scope: mobile/web typechecks, lint with warnings but no errors, 83 shared suites / 708 tests, and all Edge entrypoint typechecks. One initial run had a Jest worker SIGSEGV rather than an assertion failure; the full unchanged rerun passed. Ops typecheck passed separately.
- Phone/trust policy tests: 20 passed. Ops media CSP tests: 2 passed. Protected Ops broker boundary check passed.
- Existing account-preview suite: 60 passed at 375×812, 768×1024 and 1440×1000. Initial unconfigured-preview run failed; it was stopped and rerun with local-only dummy configuration, not production credentials.
- Connected in-app-browser review covered populated messaging, customer/tailor actions and selling setup at the three widths. Delivery/shipping-only setup displayed origin fields and rejected an empty origin. The phone-save retry notice was inspected. These are synthetic visual states, not authenticated persistence/notification E2E.
- No fresh physical-device runtime pass, native build, store submission, web deployment or production migration/Edge deployment is performed by this source merge. Prior deployments and their limitations remain in the phone/waiver evidence documents.
- The global source-size check is still red: mobile brief (5,123 / cap 5,073), customer home (2,316 / 2,289), excluded Vision (14,706 / 9,388), and the afternoon fabric-workflow panel (1,663 / 1,649) exceed existing caps. Caps were not raised. Selected order/setup caps were lowered and `apps/mobile/features` is now covered; every new extraction module stays below 1,200 lines. This is not a claim that all repository monoliths or all lint warnings are resolved.

The owner explicitly deferred mobile builds. Delivering new mobile behavior to installed clients requires a later approved app release; merging source alone does not update those clients.

## Separate-chat afternoon repairs reconciled

The owner supplied the September 28 quote-compatibility and fabric-card proof records during final review. Mobile `TailorQuoteModal` and web `tailor-order-actions` already match those scoped local sources. The portable order-ID and quote-draft hunks were added to `order-detail-workspace` without replacing current main's role isolation. Fabric-card changes were transferred as reviewed hunks with the shared stage/role rule and regression matrix.

The supplied release evidence records `tailor-order-action` production version 50. Migration histories `20260928220000` and `20260928230000` are included as already-applied production repairs, not reapplied. `20260928210000_customer_receipt_upload_contract.sql` is intentionally excluded: it remains development-only and its rehearsal/promotion is pending. No blanket migration push or Edge redeployment is authorized by this merge.

The supplied proof documents establish bounded prior iOS/web checks, not a new production client release or full counterpart notification/realtime certification. Web fabric-card UI remains undeployed and mobile UI needs a future approved client release.
