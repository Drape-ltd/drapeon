# Mobile owner-RPC release plan

## Scope

PR #219 moves the tailor account surfaces to the owner-scoped
`get_my_tailor_account_profile()` RPC. The affected mobile screens are Orders,
Profile edit, Portfolio, Trust & access, Shop, New item, money history, and
the account/profile query helpers. The change is JavaScript-only: it adds no
native dependency, permission, entitlement, or app-config change.

The supporting RPC and staged B0 revokes are already present in Production.
The later **B** migration, which would revoke the remaining 19
mobile-dependent `tailor_profiles` columns from `authenticated`, is
intentionally not in this PR and is not scheduled by this plan.

## Release units

1. **Web release:** merge #219 only after its separate browser postflight has
   been completed. The normal `main` web deployment then uses the already-live
   owner RPC. Check dashboard, profile, profile edit, payout, earnings, shop,
   portfolio, and settings as an authenticated tailor; no raw permission error
   may reach the UI.
2. **Mobile staging:** from clean merged `main`, publish the reviewed
   JavaScript bundle to EAS's `staging` channel using the guarded
   `apps/mobile/scripts/publish-ota.mjs` workflow and the `testflight` profile.
   Verify the received update on one iOS and one Android production-shaped
   device with the tailor surfaces above.
3. **Mobile production:** only after staging evidence and explicit release
   approval, publish the identical reviewed commit to EAS's `production`
   channel. `app.json` currently uses app version `1.0.4` with runtime version
   derived from that app version, so this JavaScript-only change can reach
   compatible 1.0.4 store binaries through OTA. Do not bump the native version
   unless a native/configuration change is introduced.
4. **Observe:** for fourteen days, check mobile Sentry and the owner-RPC error
   rate for `permission denied for column`, missing-RPC, and account-screen
   failures. Keep B unavailable throughout.

These are separate releases. This document authorises none of them.

## Proposed B minimum-version/adoption gate

The current app has no server-observable capability signal that can prove an
active tailor has received the owner-RPC client. A store version alone is not
enough: compatible 1.0.4 binaries may receive an OTA at different times, and
older installed clients still select the remaining private columns directly.

Before proposing B, add and verify a privacy-minimal, owner-scoped capability
heartbeat that records only:

- authenticated tailor account ID;
- platform;
- app version and EAS update/runtime ID;
- a boolean that the owner-RPC client successfully loaded.

It must update one current row per account/platform, retain no customer or
profile payload, and be writeable only for the authenticated owner through a
dedicated RPC/Edge path. Release reporting must use aggregate counts only.

**Recommended gate:**

- 100% of tailor accounts active in the preceding 30 days have a successful
  owner-RPC capability heartbeat from the released mobile client or current
  web client;
- both iOS and Android have passed the production-shaped owner-screen matrix;
- zero relevant mobile or owner-RPC errors for 14 consecutive days after the
  production OTA; and
- a separate founder approval accepts the B migration's exact column list and
  the observation evidence.

If any active account lacks the heartbeat, do not substitute a percentage
threshold or revoke its direct-read fields. Either keep B deferred or first
ship a separately reviewed update-required mechanism that handles unsupported
clients without exposing a database permission error.

## Evidence to attach before release

- merged-main SHA and web deployment build ID;
- iOS and Android staging update IDs and production update ID;
- screen-level pass/fail matrix for the tailored account surfaces;
- Sentry/owner-RPC aggregate error review; and
- adoption aggregate for the capability heartbeat.
