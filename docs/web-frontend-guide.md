# Drapeon Web Frontend Guide

Orientation for UI work in `apps/web`. Covers layout, deployment, the component
system, state, data loading, forms, and the traps that are specific to this
codebase.

Read alongside [design-foundation.md](./design-foundation.md) (brand and
component rules) and the repository `AGENTS.md` (completion gates).

---

## 1. Where things live

`apps/web` is a Next.js 15 App Router app on React 19, TypeScript, Tailwind 3,
Radix primitives, and Supabase. It is one of four apps in a pnpm + Turborepo
workspace:

| App | What it is |
| --- | --- |
| `apps/web` | Customer + tailor web app, `drapeon.co` |
| `apps/ops` | Separate Ops control plane, `ops.drapeon.co`, dev port 3005 |
| `apps/mobile` | Expo / React Native |
| `apps/health-monitor` | Scheduled Cloudflare Worker |

Inside `apps/web`:

```
app/          App Router routes, layouts, API handlers
components/   Shared components + components/ui primitives
features/     account/* — the authenticated app (see §5)
lib/          Supabase clients, caches, auth, ops, formatting helpers
hooks/        one hook today: use-session-timeout.ts
tests/e2e/    Playwright specs
scripts/      env verification, deploy wrapper, route smoke
```

The import alias `@/*` maps to the app root, but most existing files use
relative imports. Match whatever the file you're editing already does.

### Route groups

**Public marketing** — `/`, `/about`, `/how-it-works`, `/pricing`, `/tailors`,
`/customers`, `/explore`, `/vision`, `/faq`, `/help`, `/press`, `/careers`,
`/legal`, `/privacy`, `/terms`, `/security`, `/trust`, `/status`, `/join`,
`/apply`, `/partnerships`, `/payouts`, `/contact`.

Mostly **server components**. Data comes from
[lib/public-marketplace.ts](../apps/web/lib/public-marketplace.ts), which wraps
its readers in React `cache()` and uses the anon-key server client from
[lib/server-supabase.ts](../apps/web/lib/server-supabase.ts).

**Auth** — `/sign-in`, `/sign-up`, `/login`, `/auth/callback`,
`/auth/recover`, `/auth/mobile-challenge`, `/verify`, `/verify-handoff/[token]`.

**Account (authenticated)** — everything under `/account/*`. This is the real
application: orders, messages, measurements, brief, shop, checkout, saved,
work, earnings, payout, profile, clients, notifications, settings, support,
call. Fully client-rendered — see §5.

**Ops** — `/ops/*`, lives in this app but is redirected to port 3005 / the
`ops.drapeon.co` host by middleware. Ignore it for customer-facing UI work.

**API routes** — 9 handlers in [app/api/](../apps/web/app/api/):
`waitlist`, `tailor-application`, `auth/device-trust`, `auth/signup-media`,
`client-errors`, `media-health`, `share-card`, `web-push`, `public-env.js`.

---

## 2. Running it locally

```bash
pnpm install                      # from repo root, Node 22+
cp apps/web/.env.local.example apps/web/.env.local
pnpm --filter @drape/web dev      # http://127.0.0.1:3004
```

The dev script pins `--hostname 127.0.0.1 --port 3004` so it matches the
Playwright `baseURL`. A `prebuild` hook runs
`scripts/generate-brand-css.mjs` before every build — see §4.

Fill `.env.local` with real values first — the example ships placeholders only.
At minimum `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or
the account section cannot mount.

Checks:

```bash
pnpm --filter @drape/web typecheck     # tsc --noEmit
pnpm --filter @drape/web lint          # eslint
pnpm --filter @drape/web test:e2e      # Playwright, 3 viewports
pnpm --filter @drape/web smoke:public  # public route smoke
```

Before pushing anything that touches shared contracts, run the full gate from
the repo root — targeted commands do not substitute for it:

```bash
pnpm launch:contracts
```

### The `NEXT_DIST_DIR` split

[next.config.ts:98](../apps/web/next.config.ts#L98) sets
`distDir: process.env.NEXT_DIST_DIR || '.next'`, and the `build` script defaults
it to `.next-build`. A local production build therefore writes to `.next-build`
and will not clobber the chunks a running `next dev` is serving. Cloudflare
builds override it back to `.next`. Leave this alone.

---

## 3. How deployment works

Cloudflare Workers via **OpenNext** — not Vercel, not Cloudflare Pages.

```
next build  →  @opennextjs/cloudflare  →  .open-next/worker.js  →  wrangler deploy
```

- [open-next.config.ts](../apps/web/open-next.config.ts) — uses
  `defineCloudflareConfig` with an **R2-backed incremental cache**, cache
  interception on, and route preloading off. ISR/SSG and `unstable_cache`
  results are persisted to R2, not held in the Worker.
- **Tag cache is still `dummy`**, deliberately — the app has no
  `revalidateTag`/`revalidatePath` callers. The config comment is explicit: if
  you introduce on-demand revalidation, the tag cache must become real (D1/DO)
  in the same change as its binding and migration. Adding a `revalidateTag`
  call without that is a silent no-op.
- [wrangler.jsonc](../apps/web/wrangler.jsonc) — worker name `drape`, routes
  `drapeon.co/*` and `www.drapeon.co/*`, production vars, required secrets, the
  `NEXT_INC_CACHE_R2_BUCKET` → `drape-opennext-cache` binding, and a
  `WORKER_SELF_REFERENCE` service binding.

Two paths to production:

**Automatic** — push to `main`. Cloudflare's "Workers Builds: drape" GitHub
check builds and deploys. Wait for that check to go green before calling a
deploy done; if it fails, inspect the Cloudflare build and re-run, then smoke
`https://drapeon.co`.

**Manual** — run `cf:build` then `cf:deploy` with production env vars inlined
(see the "Web" section of the root [README.md](../README.md#L386-L408)).
`cf:deploy` without a fresh `cf:build` ships a stale `.open-next` bundle.

CI workflows in [.github/workflows/](../.github/workflows/):
`launch-contract.yml` (runs on every PR and push to `main`/`develop`),
`web-environment-contract.yml` (path-filtered to the env-critical files),
`beta-service-health.yml` (manual).

### Env and the production guard

Public Supabase config resolves through a fallback chain in
[lib/supabase-config.ts](../apps/web/lib/supabase-config.ts), and the browser
gets it three ways: inlined at build via `next.config.ts` `env`, injected as
`window.__DRAPEON_PUBLIC_ENV__` in the root layout, or fetched from
`/api/public-env.js` at runtime.

[lib/supabase-environment.ts](../apps/web/lib/supabase-environment.ts) enforces
that a production hostname only ever talks to project ref `wkfsrunetmgjdtcurmoj`.
It fails the build in `next.config.ts` and returns a 503 in `middleware.ts`.
If you see "Service configuration unavailable", that guard fired.

### Middleware

[middleware.ts](../apps/web/middleware.ts) runs on nearly every request and:

- validates the Supabase target on production hostnames,
- redirects `/ops/*` to the Ops host/port,
- bounces `/account/*` to `/sign-in?device=verify` when a
  `drapeon.deviceChallenge` cookie is present,
- generates a **CSP nonce** per request, sets `x-nonce`, and emits the CSP.

That nonce matters for UI work: any inline `<script>` you add must read
`(await headers()).get('x-nonce')` and pass it, the way
[app/layout.tsx](../apps/web/app/layout.tsx) does for its JSON-LD blocks.
Inline styles are permitted by the policy; inline scripts without the nonce are
not.

---

## 4. The design system

### Tokens

One source of truth: `packages/shared/src/design-system.ts`, consumed by both
web and mobile. Tailwind imports it directly in
[tailwind.config.ts](../apps/web/tailwind.config.ts), so brand colors are
available as semantic utilities:

| Utility | Meaning |
| --- | --- |
| `drape-green` / `needle-*` | Primary `#2D6A4F` + 50–900 ramp |
| `rust-*` | Accent `#D85A30` + ramp |
| `ink` | Primary text `#2C2C2A` |
| `bone` | Background `#F9F7F3` |
| `ui-canvas` `ui-surface` `ui-surface-dark` `ui-muted` `ui-border` `ui-subtle` | Surfaces and chrome |
| `illustration-*` | Named anchors for decorative/dark art |

### The generated CSS token layer

`app/brand-tokens.css` is **generated, not hand-edited**. `scripts/generate-brand-css.mjs`
parses `packages/shared/src/design-system.ts` and emits `--drapeon-*` custom
properties; it runs automatically via the `prebuild` hook, or on demand with
`pnpm brand:tokens` (which also runs a parity check).

`app/globals.css` imports it and aliases them:

```css
@import './brand-tokens.css';
:root {
  --background: var(--drapeon-background);
  --foreground: var(--drapeon-text-primary);
  --primary:    var(--drapeon-primary);
  --danger:     var(--drapeon-status-error);
}
```

So there is exactly one source of color truth — `design-system.ts` — reaching
CSS two ways: Tailwind utilities via `tailwind.config.ts`, and custom
properties via the generated file. **Never hardcode a hex in CSS or a Tailwind
arbitrary value.** `button.tsx` recently swapped `hover:bg-[#235d45]` for
`hover:bg-needle-600` for exactly this reason, and `pnpm brand:tokens` /
`pnpm brand:language` enforce it.

`globals.css` also holds the `--space-section-*` scale and the component
classes `.app-surface`, `.app-panel`, `.viewport-safe-shell`,
`.public-section`, `.public-section-editorial`, `.skip-link`.

Two font variables: `--font-body` (Inter) for everything, `--font-display`
(Fraunces) auto-applied to `h1`–`h4`. Don't put display type on dense labels,
helper text, or body copy.

> ⚠️ **Tailwind content globs.** The config scans `app/`, `components/`,
> `features/`, `lib/`. `features/` was once missing and every utility used only
> in account workspaces silently failed to generate — a header asked for
> `bg-ui-surface-dark/96` and rendered transparent. If you add a new top-level
> directory with JSX, add it to `content` or your classes won't exist.

### Primitives — `components/ui/`

Extend these before writing screen-local markup:

| File | Exports |
| --- | --- |
| `button.tsx` | `Button` — variants `primary \| secondary \| outline \| ghost \| destructive \| link`, sizes `sm \| md \| lg \| icon \| icon-sm`, `asChild` via Radix Slot |
| `icon-button.tsx` | `IconButton` — requires `label`, sets `aria-label` + `title` + `sr-only` text |
| `input.tsx` `textarea.tsx` `native-select.tsx` | Form controls |
| `field.tsx` | `Field` — label / hint / error wrapper (`<label>` based) |
| `phone-number-field.tsx` | Country-aware phone input |
| `money-input.tsx` (in `components/`) | Currency-aware amount input |
| `surface.tsx` | `Surface`, `SurfaceHeader` (eyebrow / title / description / action) |
| `metric-card.tsx` | `MetricCard` — label, value, hint, icon |
| `badge.tsx` | `Badge` — tones `neutral \| success \| warning \| danger \| info` |
| `status-chip.tsx` | `StatusChip` — **use this for any status**, see below |
| `segmented-control.tsx` | `SegmentedControl<T>` — tablist with counts |
| `dialog.tsx` | Radix dialog set |
| `media-viewer-dialog.tsx` | `MediaViewerDialog` |
| `table.tsx` `data-table.tsx` | Table primitives + TanStack `DataTable` |
| `avatar.tsx` `separator.tsx` `switch.tsx` `scroll-area.tsx` `tooltip.tsx` | Radix wrappers |
| `ui-provider.tsx` | `UiProvider` — `TooltipProvider`, mounted in the root layout |

Styling convention: `cva` for variants, `cn()` from
[lib/cn.ts](../apps/web/lib/cn.ts) (clsx + tailwind-merge) for merging. Radius is
`rounded-[8px]` almost everywhere. Buttons are `h-10` by default.

> **Never render a raw database enum.** `StatusChip` calls
> `resolveStatusDisplay()` from `@drape/shared` to get a human label and tone.
> It takes a `domain` so the same string reads correctly per context.

### Shells

- [components/marketing-shell.tsx](../apps/web/components/marketing-shell.tsx) —
  `MarketingShell` (eyebrow / title / description / cta / visual), plus
  `SectionTitle` and `MarketingCard`. Wraps public pages with header + footer.
- [components/public-site-header.tsx](../apps/web/components/public-site-header.tsx) —
  public nav, `tone="light" | "overlay"`, session-aware.
- [components/site-header.tsx](../apps/web/components/site-header.tsx) — the
  older/simpler header. Both exist; `PublicSiteHeader` is the current one.
- [components/site-footer.tsx](../apps/web/components/site-footer.tsx).
- [features/account/account-workspace-shell.tsx](../apps/web/features/account/account-workspace-shell.tsx) —
  the authenticated shell: dark collapsible sidebar, mobile drawer, identity
  card, sign-out with a 3-second confirm, surface header copy.

### Dock rule

`AGENTS.md` requires persistent primary CTAs to float in an **inset capsule
dock**, never an edge-to-edge footer slab, with one dominant full-width action
and enough content clearance beneath. Mobile has `DrapeFloatingActionDock`;
web has **no equivalent primitive yet**. If your change needs a persistent CTA,
build the inset capsule (compacts on scroll, restores near the top) rather than
a sticky slab — and reserve the clearance.

---

## 5. Architecture: two very different halves

This is the single most important thing to internalize.

**Public pages are server components.** Async page functions, `cache()`-wrapped
Supabase reads, `buildMetadata()` from [lib/metadata.ts](../apps/web/lib/metadata.ts)
exported as `metadata`. Fast, SEO-indexed, no session.

**The account section is a client-side SPA.** `app/account/layout.tsx` is four
lines; it renders `PersistentAccountRuntime`. Every `/account/*` `page.tsx` is a
thin metadata shell that renders one client workspace from `features/account/`:

```tsx
export const metadata: Metadata = buildMetadata({ ... })

export default function AccountOrdersPage() {
  return <OrdersWorkspace />
}
```

125 of 245 components carry `'use client'`. There are effectively **no server
actions** — only `app/ops/action/route.ts` and `lib/money-desk-execution.ts`.
All account mutations go through the Supabase browser client or
`supabase.functions.invoke(...)` against Edge Functions.

### Request boundaries and the CSP nonce

Route groups that need the middleware nonce declare
`export const dynamic = 'force-dynamic'` and re-export
[RequestBoundaryLayout](../apps/web/components/request-boundary-layout.tsx),
which simply `await headers()`. That makes the route request-bound so Next
applies the nonce to framework scripts — without forcing the public root layout
dynamic. In place for `/sign-in`, `/sign-up`, `/auth`, `/account`, `/ops`,
`/referral`, `/verify`, `/verify-handoff`. Add a route that needs the nonce and
it needs this layout too.

The root layout was slimmed accordingly: its JSON-LD moved to
[components/site-structured-data.tsx](../apps/web/components/site-structured-data.tsx).

### `AccountRouteRuntime` — the render-prop gate

[features/account/account-route-runtime.tsx](../apps/web/features/account/account-route-runtime.tsx)
(635 lines) is the spine. Every workspace wraps itself in it:

```tsx
return (
  <AccountRouteRuntime surface="saved">
    {({ session, identity }) => <SavedRoute userId={session.user.id} />}
  </AccountRouteRuntime>
)
```

It owns: Supabase session subscription, identity loading (role, display name,
avatar, active-order count, unread messages/notifications, payout and setup
flags), role-based surface gating via
[navigation-contract.ts](../apps/web/features/account/navigation-contract.ts),
redirect to `/account/profile?setup=1` for incomplete tailors, and the shared
loading / signed-out / error screens.

Your workspace's children only render once `status === 'ready'`, so `session`
is always non-null inside the render prop.

### The two contracts

- [surface-contract.ts](../apps/web/features/account/surface-contract.ts) — the
  `AccountSurface` union and the eyebrow / title / body copy for each surface,
  with tailor-specific overrides. **Header copy changes belong here**, not in
  the workspace.
- [navigation-contract.ts](../apps/web/features/account/navigation-contract.ts) —
  `accountHomeRoute()`, `accountNavigation()` (sidebar groups + badges),
  `accountSurfaceAllowedForRole()`, `isAccountRouteActive()`. **Nav changes
  belong here.** Note the home routes differ: tailors land on `/account/work`,
  customers on `/account/orders`.

### The account surface layout (post-refactor)

`components/account-app-surface.tsx` used to be a 29,519-line monolith. As of
`d257f8f refactor(web): deconstruct account surface` it is **three lines** — a
`'use client'` re-export of `features/account/account-app-coordinator`. Old
import paths still work; the code moved.

The shape now:

```
features/account/
  account-app-coordinator.tsx      1095  orchestrates surfaces, realtime, context
  account-route-runtime.tsx         635  session + identity gate
  account-workspace-shell.tsx       467  sidebar, header, drawer
  shared/
    account-data-contracts.ts            all Account* row types
    account-data-queries.ts        1392  fetch<Surface>SurfaceData() per surface
    account-empty-data.ts                empty<Surface>SurfaceData defaults
    account-realtime-config.ts           which surfaces/tables subscribe
    account-route-states.tsx             auth-required + loading skeletons
  orders/  messages/  marketplace/  payouts/  profile/  shop/  settings/  checkout/
```

Each domain folder holds `Render<Surface>` components the coordinator composes.
Largest are `messages/account-messages-surface.tsx` (4,725) and
`orders/account-order-actions.tsx` (3,861).

**The data layer is the part worth learning.** `account-data-queries.ts`
exports one loader per surface — `fetchOrdersSurfaceData`,
`fetchMessagesSurfaceData`, `fetchProfileSurfaceData`, and so on — each
returning a typed contract from `account-data-contracts.ts` with a matching
empty default. If you add a field to a surface, you touch the contract, the
empty default, and the query together.

Realtime is now declarative: `account-realtime-config.ts` lists
`ORDER_REALTIME_SURFACES` and `ORDER_REALTIME_CHILD_TABLES` rather than
scattering `.channel()` calls. Note `QUOTE_NEGOTIATION_UI_ENABLED` — gated on
`NEXT_PUBLIC_QUOTE_NEGOTIATION_V1`, it conditionally adds `order_quotes`,
`quote_revision_requests`, and `order_events` to the subscription set.

> ⚠️ **There is now a hard file-size gate.** `scripts/check-source-file-size.mjs`
> runs as part of `pnpm lint` and reads `config/source-size-baseline.json`:
> **1,200 lines max for any new file**, a warning at 800, and a frozen
> `legacyCaps` map for files that already exceed it. The caps are a ratchet —
> the script tells you plainly, "Extract a domain module; do not raise a legacy
> cap to make this check pass." If you grow `settings-workspace.tsx` (capped at
> 1,411) by one line, lint fails.

---

## 6. State

No Redux, Zustand, Jotai, or React Query. The whole app is `useState` +
`useEffect`. Measured usage across `app/`, `components/`, `features/`:

```
useState    1159
useEffect    247
useRef       148
useMemo      102
useCallback   83
```

Zero `useReducer`, `useTransition`, `useActionState`, `useOptimistic`. If you
introduce one, you are setting a new precedent — fine, but do it deliberately.

Four mechanisms carry cross-component state:

**1. React context — three, all narrower than they look.**

| Context | Provider | Scope |
| --- | --- | --- |
| `AccountRuntimeContext` | `account-route-runtime.tsx` | all of `/account/*` |
| `PersistentCallSessionContext` | `call/persistent-call-session.tsx` | inside the account shell |
| `AccountContext` | **`account-app-coordinator.tsx` only** | coordinator subtree |

> ⚠️ `useAccountContext()` reads like an app-wide identity hook, but the only
> real `AccountContextProvider` is mounted inside the coordinator (plus the
> preview harness). Today only `messages/account-messages-surface.tsx` and
> `marketplace/account-marketplace-surfaces.tsx` consume it. Call it from a
> workspace outside that subtree and it throws. Use the `AccountRouteRuntime`
> render prop for identity instead.

`AccountRouteRuntime` first checks `useContext(AccountRuntimeContext)` and, when
a value is inherited, becomes a passthrough. Since `app/account/layout.tsx`
wraps everything in `PersistentAccountRuntime`, a workspace's own
`<AccountRouteRuntime surface="orders">` reuses the already-loaded session — so
the shell, sidebar, and any in-progress call survive navigation.

**2. Module-level TTL caches.**
[lib/account-data-cache.ts](../apps/web/lib/account-data-cache.ts) gives
`readAccountData(key, load, ttl)` — a 20-second cache with in-flight request
deduplication — and `invalidateAccountData(prefix?)`. Two more live alongside
it: the runtime's 45-second `identityCache`, and the coordinator's own
`_shellCache` (`SHELL_CACHE_TTL = 45_000`, keyed by user id) behind
`fetchAccountShellDataCached()`. All three are plain module scope, so they
outlive unmounts and are shared across the tab.

**3. Custom `window` events** for cross-tree invalidation, defined in
[lib/web-account-cache-events.ts](../apps/web/lib/web-account-cache-events.ts):

| Event | Helper |
| --- | --- |
| `drapeon:web-account-cache-invalidate` | `invalidateWebAccountCaches(reason)` |
| `drapeon:web-notification-unread-count` | `publishWebNotificationUnreadCount(n)` |
| `drapeon:web-account-identity-update` | `publishWebAccountIdentityUpdate({ avatarUrl })` |

This is how a profile save updates the sidebar avatar without a reload. After a
mutation that changes a badge count or the identity card, fire the matching
event — otherwise the UI shows stale data for up to 45 seconds.

**4. `sessionStorage` / `localStorage`**, always inside `try/catch` (private
browsing throws), read through `useSyncExternalStore` where it needs to be
reactive.

### Data loading shape

```tsx
const [data, setData] = useState<Data>(emptyData)
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)

const load = useCallback(async () => {
  const supabase = createClient()
  const { data, error } = await supabase.from('...').select('...').eq(...)
  ...
}, [userId])

useEffect(() => { void load() }, [load])
```

Client Supabase comes from [lib/supabase.ts](../apps/web/lib/supabase.ts)
(`createClient()`, `createPagesBrowserClient` under the hood, asserts the
production target). Server-side use `createPublicServerClient()` or
`createServiceRoleClient()` from `lib/server-supabase.ts` — that file is
`server-only` and will hard-error if imported into a client component.

---

## 7. Forms

**No form library.** No react-hook-form, no Formik, no zod on web. Every form is
controlled `useState` fields + a manual `onSubmit`.

The canonical shape, from
[components/waitlist-form.tsx](../apps/web/components/waitlist-form.tsx):

```tsx
const [status, setStatus] = useState<'idle'|'submitting'|'success'|'error'>('idle')
const [message, setMessage] = useState('')

async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault()
  if (status === 'submitting') return
  setStatus('submitting')
  try {
    const response = await fetch('/api/waitlist', { ... })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error ?? 'fallback copy')
    setStatus('success')
  } catch (error) {
    setStatus('error')
    setMessage(error instanceof Error ? error.message : 'fallback copy')
  }
}
```

Rules that apply to every form here:

- **Copy primitive values synchronously.** `AGENTS.md` forbids retaining React
  synthetic events across an `await`. Read `event.target.value` before the
  async call, never after.
- Guard re-entry with the `submitting` status.
- Validation helpers live in `@drape/shared` — `validation`, `phone`, `address`,
  `money-input`, `form-foundation`. Use them instead of local regexes so mobile
  and web agree.
- A disabled primary action needs a concise nearby explanation naming the
  missing requirement.
- Success state must be a **durable receipt**, not a local boolean: reference
  ID, human status, submitted time, what happens next. On reload or deep-link
  re-entry the page must read authoritative state and must not offer the
  submission form again if the request already exists.
- Don't claim an email/SMS/push/payment was delivered without a recorded
  terminal outcome.

---

## 8. Routing and links

`typedRoutes: true` is on. `Link href` values are checked against real routes,
so dynamic strings need the `Route` type:

```tsx
import type { Route } from 'next'
const href = `/account/orders/${id}` as Route
```

Contextual exits are a product contract, not a detail. Back / X / cancel /
swipe / hardware back / save-completion must all return to the actual source
screen. Use sanitized `returnTo` params —
[lib/account-return-path.ts](../apps/web/lib/account-return-path.ts) has the
helpers. Never fall back to the homepage from an order, message, measurement,
onboarding, shop, payout, or verification child flow.

---

## 9. Images, media, icons

- `images.unoptimized: true` — Next's optimizer is off (Workers runtime).
  `next/image` still handles layout, but sizing is on you.
- `remotePatterns` allows the configured Supabase storage host plus
  `**.supabase.co/storage/v1/object/public/**`. A new image host needs a
  `next.config.ts` change **and** a redeploy.
- Icons: `lucide-react`. Icon-only controls must use `IconButton` (label →
  `aria-label` + tooltip).
- Never leave a broken image frame; render an intentional placeholder.
- Media helpers: [components/public-media.tsx](../apps/web/components/public-media.tsx),
  `components/ui/media-viewer-dialog.tsx`, and the media grids now under
  `features/account/profile/portfolio-manager.tsx` and the orders surfaces.

---

## 10. Previewing states without real data

The refactor added **dev-only preview harnesses**. Every one calls `notFound()`
unless `NODE_ENV === 'development'` and sets `robots: { index: false }`, so they
never exist in production. This is the fastest way to iterate on a surface
whose real state is hard to reach.

| Route | Renders |
| --- | --- |
| `/account-preview?state=…` | any account surface from fixtures |
| `/signup-preview?state=…` | tailor onboarding steps |
| `/lifecycle-preview/{welcome,leads,order-start,order-timeline,fit-profile,profile}` | lifecycle emails/surfaces |
| `/survey-preview`, `/survey-preview/submitted`, `/survey-preview/suppressed` | survey states |
| `/survey-ops-preview`, `/marketing-topics-preview` | ops + marketing surfaces |
| `/email-preview`, `/media-health-preview` | email templates, media health |
| `/whats-new`, `/analytics-debug` | product updates, analytics panel |

`/account-preview` accepts ~20 states — `loading`, `auth-required`, `messages`,
`tailor-order`, `customer-order`, `payout`, `earnings`, `shop`, `portfolio`,
`selling-setup`, `material-advance`, `dispatch`, `ready-made-checkout`,
`profile-overview`, `order-resolution`, `order-detail`,
`marketplace-surfaces`, `order-list-surfaces`, `settings-support`,
`identity-approved`, `identity-rejected` — driven by
[preview/account-preview-fixtures.ts](../apps/web/features/account/preview/account-preview-fixtures.ts).

Two caveats: a harness proves **rendering**, not the workflow. `AGENTS.md` still
requires the live authenticated pass against real state before a change is
complete, and several e2e specs assert these preview routes, so changing a
fixture can fail `tests/e2e/*-preview.spec.ts`.

---

## 11. Before you call a UI change done

From `AGENTS.md` — these are gates, not suggestions:

1. `pnpm --filter @drape/web typecheck` and `lint`. Note `pnpm lint` at the repo
   root now runs `check-source-file-size.mjs` **first** — a file over its cap
   fails the whole lint task before ESLint even starts.
2. `pnpm launch:contracts` from the repo root, on Node 22+, before pushing.
3. `git diff --check`.
4. **Every web change must be inspected in a live browser** against the exact
   affected public or authenticated state. Compilation, tests, and screenshots
   are supporting evidence, not substitutes. If you can't reach the required
   role or fixture state, record the path as unverified and don't call it
   complete.
5. Exercise the adjacent path most likely to break.
6. Check narrow mobile (375px), tablet, and desktop — Playwright is configured
   for exactly those three viewports.
7. Report what was verified, on which surface, and what remains unverified.

Additional repo-level checks that now exist and are worth running when your
change touches their area:

| Command | Catches |
| --- | --- |
| `pnpm check:source-size` | files over the 1,200-line cap / 800-line warning |
| `pnpm brand:tokens` | generated CSS out of sync with `design-system.ts` |
| `pnpm brand:language` | brand copy/terminology drift |
| `pnpm knip:web` | unused files, exports, and dependencies in web |

`scripts/` also gained `brand-contrast-check.mjs`,
`illustration-inventory-check.mjs`, `public-route-contract-check.mjs`,
`order-lifecycle-surface-check.mjs`, `lifecycle-event-surface-check.mjs`,
`marketing-topic-parity-check.mjs`, `product-update-surface-check.mjs`, and
`survey-ops-surface-check.mjs`.

Cross-platform reminder: a workflow's default scope is iOS, Android, customer
web, tailor web, Ops, shared contracts, database/Edge, realtime, and
notifications. A change that starts on one web screen does not narrow that
scope — if a surface is intentionally out of scope, say why.

---

## 12. Quick reference

| I want to… | Go to |
| --- | --- |
| Change account header copy | `features/account/surface-contract.ts` |
| Change sidebar nav or badges | `features/account/navigation-contract.ts` |
| Change the authenticated shell | `features/account/account-workspace-shell.tsx` |
| Change session/identity/redirect logic | `features/account/account-route-runtime.tsx` |
| Add a brand color | `packages/shared/src/design-system.ts`, then `pnpm brand:tokens` |
| Add a global CSS class | `app/globals.css` under `@layer components` (never `brand-tokens.css`) |
| Add a button variant | `components/ui/button.tsx` (`cva`) |
| Render a status | `components/ui/status-chip.tsx` |
| Add a public marketing page | `app/<route>/page.tsx` + `MarketingShell` + `buildMetadata` |
| Add an account page | `app/account/<route>/page.tsx` + workspace in `features/account/<route>/` |
| Add/change an account surface's data | `features/account/shared/` — contract + empty default + query, together |
| Change what realtime listens to | `features/account/shared/account-realtime-config.ts` |
| Change an account loading/auth screen | `features/account/shared/account-route-states.tsx` |
| Fetch public data server-side | `lib/public-marketplace.ts`, `lib/server-supabase.ts` |
| Fetch account data client-side | `lib/supabase.ts` + `lib/account-data-cache.ts` |
| Refresh a badge after a mutation | `lib/web-account-cache-events.ts` |
| Add an inline script | pass the `x-nonce` header value |
| Add a route needing the nonce | `components/request-boundary-layout.tsx` + `dynamic = 'force-dynamic'` |
| Add an image host | `next.config.ts` → `images.remotePatterns` |
