# Phase 4 Bachs NGN live-readiness progress

This log records evidence for Phase 4. It is not authority to move money or
enable a route. Production writes, deployments, secrets, route rows,
enablement, and merges remain separately approved release units.

## Stage 0 — post-merge checks (2026-10-29)

- **Branch:** `codex/phase4-bachs-live`, created from `origin/main` at merge
  `c654fea0068998e00b28581a0559ba2d3d4600a0`. The prior Phase 3 worktree and
  its unrelated `deno.lock` edit were left untouched.
- **Edge parity:** the approved 41-function Production deployment ran from the
  reviewed branch head `288acd6cf0fa5106ed0ceb80a97e0b01a4c24571` between
  its 11:04 CDT commit and the 11:09 CDT evidence commit. The exact 41-function
  manifest is in `payments-phase3-production-release-plan.md`. A path-scoped
  `git diff --name-only 288acd6c c654fea0` across those 41 directories and
  `supabase/functions/_shared` returned no files. The merged source is therefore
  byte-identical for the deployed Edge scope.
- **Review range:** `git rev-list --count --first-parent
  750e23e5..fcc14a1e` returned 54. The post-merge review is in
  `payments-phase3-postmerge-review.md`.
- **Migration naming:** the two double-timestamp source files use applied
  versions `20261029131928` and `20261029132040` in both Dev and Production.
  Production names retain the double timestamp. Dev records only the suffix for
  both, so the history *names* are not identical even though the authoritative
  versions are. The first rollback also omits the embedded original timestamp;
  the second retains it. No history marker or filename was changed. The exact
  mapping and safe convention are documented in the post-merge review.
- **Route state:** no route was created or enabled during Stage 0.
- **Production writes:** none.

### Stage 0 commands/evidence

- `git diff --name-only 288acd6c c654fea0 -- <41 function dirs>
  supabase/functions/_shared` → empty.
- Supabase read-only migration inventories: Dev `pqptfuqogvrajozfsqzi` and
  Production `wkfsrunetmgjdtcurmoj`.
- `git diff --check` and documentation checks are run before the Stage 0 commit.

### Open operator gates

- Cloudflare dashboard branch/deployment controls must be checked by the account
  owner using this exact checklist:
  1. Workers & Pages → `drape` → Settings → Builds: Production branch is exactly
     `main`.
  2. Non-production branch builds are Preview builds only; they have no command,
     environment, or branch rule capable of deploying the Production Worker.
  3. Deployments → Production: the active version was built from merged `main`
     commit `c654fea0068998e00b28581a0559ba2d3d4600a0` (not PR-head
     `76021d8c`, `6d1471f0`, or another feature-branch SHA).
  4. The build command uses the repository's guarded build path and receives
     `WORKERS_CI_BRANCH=main`; no dashboard override bypasses it.
  5. Save screenshots of the Production-branch setting and active deployment
     SHA/version in the Phase 4 evidence pack. If any item differs, do not build
     or deploy; report the current value first.
- A second named Production Ops principal must be provisioned with independent
  MFA before any route-enable request. No account was created in Stage 0.

## Stage 1 — sandbox proof

### 2026-11-12 — Bachs support unblocked the country scope

- Bachs support ticket `#154675279` confirmed that requests without an explicit
  country fall back to the platform account country, which is `US` in sandbox
  and remains `US` in live mode until Bachs Compliance changes it.
- Drapeon must send `country: "NG"` in every
  `POST /v1/misc/bank-accounts/resolve` body and `?country=NG` in every bank-list
  request. The shared provider client now fails closed if either scope is
  omitted, and the permanent wrappers always add it.
- The current supported sandbox fixture is account ending `0000`, bank code
  `033`, expected name `Test Bank Account - Success`. The older account ending
  `6789` is retired and must not be used in fixtures or runbooks.
- **Dev proof:** the explicit-NG retry returned `resolved=true`,
  `lookup_supported=true`, bank-list country `NG`, bank code `033` present, and
  the expected account name matched. `bank_id` and `bank_account_id` were not
  returned by this resolver response and are recorded as `null`; no substitute
  identifiers were inferred.
- The temporary Dev-only probe was deleted and its token unset immediately after
  the proof. No Production or live-mode request was made.
- **Open external item:** Bachs Compliance still needs to change the live account
  country. This does not block Dev/sandbox proof; it remains a live-readiness
  gate before any Production route enablement.

### 2026-11-12 — Dev payout-setup continuation

- The existing audited NGN/Bachs Dev route was moved from `DISABLED` to
  `SANDBOX_ONLY` with the Phase 2 Ops RPC and a named Dev QA principal. It was
  not enabled, and no Production route changed.
- Reused the existing bound synthetic recipient account and destination rather
  than creating another provider account. Provider retrieval confirmed country
  `NG`, transfers `active`, payouts `active`, two onboarding requirements due,
  zero pending-verification requirements, and no external payout account yet.
- The destination sync persisted the same destination ID and provider account
  ID. It remains inactive with first-withdrawal review `PENDING`, as required
  until hosted onboarding and an external payout destination are complete.
- A fresh Bachs sandbox hosted-onboarding link opened successfully and reached
  Bachs' identity/KYC form. Drapeon did not collect identity documents and did
  not invent a person or upload a real document to sandbox. No approved Bachs
  sandbox identity/document fixture is published in the official docs, so the
  hosted KYC completion remains a provider-test-data item rather than an app
  integration failure.
- The temporary token-gated Dev helper and its secret were deleted immediately
  after the handoff proof. No Production or live-mode request was made.
- Focused provider tests passed `26/26`; strict Deno checks passed for the shared
  Bachs client, operations adapter, and `payout-account-action`; `git diff
  --check` passed. Only `payout-account-action` was redeployed to Supabase Dev so
  the verified country guard and current onboarding adapter are active there.

### 2026-11-12 — synthetic destination fallback

- Because the connected recipient is API-owned and not a normal Bachs portal
  login, the sandbox proof used Bachs' supplied synthetic Nigerian bank fixture
  directly through the account-scoped payout-destination API. This does not
  replace hosted KYC for real tailors and is forbidden in live mode.
- Bachs created destination `pd_xvxVN5HyuyMzeNzY` under connected account
  `acct_LPvacykCDo2YmEFW`. Provider evidence: type `bank_account`, currency
  `NGN`, status `approved`, `is_usable=true`.
- The platform and connected account both reported NGN available and pending
  balances of `0.00`; therefore no transfer or withdrawal was attempted. The
  next sandbox proof step is a synthetic collection that funds the platform,
  followed by the existing claim-backed transfer and an account-level
  withdrawal to this approved destination.
- The temporary destination probe and token were removed after the evidence was
  captured. Production and live mode were untouched.

### 2026-11-12 — API onboarding and destination activation

- The account-scoped provider read returned exactly one payout destination in
  Bachs' `destinations` envelope: `pd_xvxVN5HyuyMzeNzY`, type `bank_account`,
  currency `NGN`, approved and usable. This is authoritative sandbox API
  evidence even though the destination is not rendered in the Bachs portal.
- A temporary token-gated Dev helper submitted only the fictional sandbox name
  `Drapeon Sandbox` through Bachs' documented API-onboarding `fields.persons`
  shape. It submitted no real identity, address, phone, document or agreement.
  The provider moved the connected account from one currently-due requirement
  (`persons.name`) to zero due and zero pending-verification requirements.
- Bachs delivered signed `account.updated` event
  `evt_5f7b5c1df8ec3f600f6ba6d57c3ade41`; Dev processed it successfully. The
  resulting Drape payout destination stores provider account
  `acct_LPvacykCDo2YmEFW`, provider destination `pd_xvxVN5HyuyMzeNzY`, external
  account present, both capabilities active, and zero onboarding requirements.
- Dev Ops first-release review then cleared destination
  `3300fa5b-e261-4e1b-b59e-aa07f40f3e20`; the destination became active. The
  review evidence is tied to the exact provider account and destination IDs.
- The temporary helper and token were deleted immediately after the proof. No
  Production or live-mode request was made. The route remains `SANDBOX_ONLY`.
- The next proof step is a proper Drape order and Bachs sandbox card collection,
  followed by the claim-backed 80/20 transfer and account-level withdrawal.

### 2026-10-29 — original blocked attempt

- Deployed a temporary token-gated, Dev-only probe to Supabase Dev
  `pqptfuqogvrajozfsqzi`. It used the existing server-side Bachs sandbox key and
  called only the three required `POST /v1/misc/bank-accounts/resolve` fixtures.
  No key or full account number was returned or logged.
- Results:
  - bank code `058`, fixture ending `6789`: `resolved=false`, no account name,
    message `Account resolution is not supported for country US`;
  - bank code `101`, fixture ending `6789`: the same result;
  - bank code `999`, fixture ending `2223`: the same result.
- **Gate result:** zero of three fixtures resolved. Stage 1.1 explicitly says to
  stop when none resolves, so no QA recipient submission, route row, checkout,
  transfer, withdrawal, refund, or failure-path test was attempted.
- **Root cause evidence:** the Bachs sandbox organization/API-key context still
  defaults reference resolution to `US`, matching the account-country issue
  reported during business registration. The NG onboarding corridor cannot be
  proved from this sandbox context until Bachs changes the sandbox platform
  country to Nigeria or provides an authorized NG sandbox fixture/account scope.
- The temporary function was replaced with an HTTP 410 responder and its probe
  token was removed from Dev after the evidence was captured. Production was
  untouched and every route remains disabled.

### Superseded external resolution

Bachs supplied the explicit country rule and replacement sandbox fixture in
ticket `#154675279`. Stage 1.1 resumes with those documented inputs; no real
personal bank account is required.

