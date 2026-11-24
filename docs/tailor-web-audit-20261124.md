# Tailor web workspace audit — 2026-11-24

Owner: Phase 4 agent (after #320, #318, #321). Mirrors issue #317.

Visual audit of the tailor web workspace on **drapeon.co**, 2026-11-24.
- **Account:** a real Production tailor account. It is Bachs-connected (NG, payout-ready), its trust review is pending, and it has no orders yet.
- **Setup:** desktop Chrome at 1483×812. Narrow mobile width and dark theme were not checked.
- **Pages:** Dashboard (`/account/work`), Orders, Shop, Earnings, Payout, Profile, Clients.

Ordered by impact. Each item names the page and what the tailor sees.

## P1: confusing or wrong for a new tailor
1. **Payout page offers "Continue to Bachs" after Bachs is connected** (`/account/payout`).
   - With an existing BACHS destination (capabilities ready, bank shown), the primary green CTA still reads "Continue to Bachs" under "Use an automated payout route". It looks like setup isn't done and invites a second onboarding.
   - **Fix:** when a destination exists, swap the section to "Connected" with a secondary **Update payout account** action. Keep "Refresh status" inline.
2. **Irrelevant provider rows** (`/account/payout`): "Stripe Connect: Not started" and "Manual bank: Not used" show for a Nigerian Bachs tailor.
   - **Fix:** show only the active provider's rows, plus a link for other options.
3. **Status vs Release contradiction** (`/account/payout`): Status says "Bachs first payout review" while Release says "Verification needed".
   - The tailor can't tell whether they owe an action.
   - **Fix:** one status, "Connected — Drapeon reviews your first payout before release. Nothing needed from you."
4. **Raw enum on the dashboard** (`/account/work`, Payout tile): it shows `BACHS`.
   - This breaks AGENTS "Never render raw database enum strings".
   - **Fix:** "Bachs · NGN" via the shared formatter.
5. **Internal jargon shown to tailors** (`/account/work`):
   - "LOCAL-COLLECTION PAID-ORDER ROUTE — This payment route is temporarily unavailable while Drapeon reviews it."
   - "Trust — Pending · Storefront setup recorded."
   - "Hidden" badge with no explanation.
   - **Fix:** plain language, e.g. "Paid orders open after Drapeon approves your profile." Explain "Hidden" as "Not visible to customers yet" and say why.
6. **`/account` and `/account/dashboard` land on Orders, not the Dashboard.**
   - The nav "Dashboard" link points to `/account/work`, but the account root goes to `/account/orders`.
   - **Fix:** the tailor root opens `/account/work`. AGENTS: a primary destination opens its root.
7. **Placeholder display name accepted.** Setup kept an auto-generated handle derived from the Apple private-relay email as the public display name. It now shows in the sidebar, cockpit and storefront.
   - **Fix:** setup step 1 must reject handle-like or relay-derived names and require a real business name.

## P2: polish
8. **Redundant "Orders" button** in the page header of Dashboard, Earnings, Shop, Payout, Profile and Clients. It duplicates the sidebar.
   - **Fix:** remove it, or replace it with each page's own primary action.
9. **Headings in internal voice:**
   - Payout: "Keep payout readiness explicit."
   - Earnings: "Pending, blocked, and paid at a glance." The body mentions "Drapeon Dispatch" and "controlled release review".
   - **Fix:** rewrite for tailors, e.g. "Get paid" and "Your earnings".
10. **"When earnings are released"** is one dense paragraph of percentages.
    - **Fix:** render the tranche schedule as two short lists (Shipped / Local collection), using the shared tranche policy formatter.
11. **"Contact payouts"** uses the destructive accent colour (orange/red outline) for a neutral support action.
12. **Shop empty state** ("Your drafts and published pieces will appear here.") gives no guidance. Explain what a ready-made piece is, add one example, and keep **Add piece** as the single CTA.
    - The browser tab title reads "Marketplace | Drapeon" while the page is "Shop".
13. **Orders empty state** has a "Back to work" link. It should point to the next useful action (share storefront / finish verification).

## Done means
- Each item is fixed or explicitly declined with a reason.
- Shared formatters are used for enums and tranche copy, and there are no screen-local strings for provider labels.
- Checked live in the in-app browser on drapeon.co as a tailor in these states:
  - Bachs-connected;
  - Stripe-connected;
  - no payout;
  - trust pending.
- Also checked at narrow iPhone width and in both themes.
- The mobile app equivalents (tailor home payout tile, payout setup) are checked for the same issues, since copy and enums are shared.
