# Role isolation fix evidence

- Commit: `e91844e`
- Branch: `codex/role-isolation-fix`
- Base: `c0510ac` (`origin/main` at verification time)
- Environment: isolated local web preview (`http://localhost:3018`)
- Production, Supabase production functions, and EAS were not changed.

This bundle covers the fixes from the role-isolation triage: role-scoped order/message loading, role-aware notification destinations, and non-disruptive account identity refreshes.

Evidence files:

- [`automated-checks.md`](./automated-checks.md) — typecheck, lint, shared tests, and edge-function checks.
- [`headed-browser.md`](./headed-browser.md) — headed browser visual/accessibility traces.
- [`manifest.json`](./manifest.json) — commit-matched evidence index.

Native visual proof is intentionally marked pending: no Android device was connected (`adb devices` returned no devices) and CoreSimulator was unavailable during this run. A native build is not being promoted from this evidence bundle.
