# Dev Explore-section notification proof (November 18–19, 2026)

Scope: Dev project only. No Production read, write, migration, or deployment was part of this pass. This worksheet depends on the QA fixture and notification-route changes in #256.

## Fixture and run

- The synthetic seller's Auth email is `delivered@resend.dev`; no founder or real-person inbox was used. A Dev Auth admin magic link with `redirect_to=drape-dev://callback` signed the seller into a freshly built Drapeon Dev client on the iPhone 17 Pro Max simulator. The client registered one non-quarantined development push token for `co.drapeon.app.dev`.
- The other synthetic fixture's invalid Auth row and `example.com` address were repaired by the guarded Dev-only script in #256. Its read-only fixture check passed. No password or credential was stored in the repository.
- The signed-in test seller was moved through `ops_set_marketplace_category` from Tailors to Ready-made and back. Both calls returned `changed: true`, created separate decision rows, and emitted one `explore_section_moved` event with exactly one push and one email job each. The seller ended in Tailors, live and verified, with custom orders on.
- Dev `process-job-queue` v185 processed all four targeted jobs through the normal worker path. `process-push-receipts` checked the Expo receipts.

| Move | Decision | Event | Channel | Job | Queue | Recorded provider outcome |
| --- | --- | --- | --- | --- | --- | --- |
| Tailors → Ready-made | `d276ffac-b9f1-4744-8b43-278073224817` | `91e40242-9389-4e9d-beff-3527e7260453` | Email | `5451dc0b-efea-48b7-b92d-261b1621f183` | SUCCEEDED | Resend `ACCEPTED`; provider reference recorded, no delivery event |
| Tailors → Ready-made | same | same | Push | `6a18a4c2-80bd-4581-8e36-ee4c34b63526` | SUCCEEDED | Expo ticket accepted, then receipt `DELIVERY_ERROR` / APNs `BadDeviceToken`; delivery outcome `DEAD` |
| Ready-made → Tailors | `f942a800-d246-4d1f-8f09-1ede67794aa1` | `9c1cdd6a-46fe-4a85-9019-58804f651a8a` | Email | `294f8fe7-7e70-49d9-81dc-30013f5abdbc` | SUCCEEDED | Resend `ACCEPTED`; provider reference recorded, no delivery event |
| Ready-made → Tailors | same | same | Push | `489f7a68-1f82-4f3b-ab34-63692dee26e1` | SUCCEEDED | Expo ticket accepted, then receipt `DELIVERY_ERROR` / APNs `BadDeviceToken`; delivery outcome `DEAD` |

## Open proof gates

The simulator did **not** receive a remote push, so arrival and tap-to-open are unproven. Both Expo receipts report APNs `BadDeviceToken` despite initial ticket acceptance. A physical Dev device with a valid token is needed for the end-to-end push and tap check; #256's four notification-route tests prove only local route selection.

Resend accepted both emails, but Dev has no matching `email_provider_events` rows and neither outcome is `DELIVERED`. A Resend delivery record or webhook outcome is still needed before calling email delivery proven. Queue `SUCCEEDED` and provider `ACCEPTED` alone do not meet that gate.

No Production change or Ops release is requested by this document.
