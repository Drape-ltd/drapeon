# Next app release: feature-flag contract

The October 4 release decision is to align the production native UI with the
already-enabled TestFlight UI. This file records intended configuration, not
proof that a new binary or backend setting is live. The founder reports that no
customer orders have flowed yet; the release should still verify the exact
production target before announcing a feature as available.

| Feature | Development / preview / TestFlight | Next production app | Web | Server / remote gate |
| --- | --- | --- | --- | --- |
| Interaction system v1 | On | On | Not applicable | No separate gate |
| Quote negotiation v1 | On | On | On in production build | Set `QUOTE_NEGOTIATION_V1=true` for Drape-PROD Edge Functions |
| Chat order actions v1 | On | On | Existing message actions | No separate gate |
| Vision UI v2 | On | On | Not applicable | Presentation only; not the Android capture gate |
| Group Orders v1 | Off | Off | Off | `GROUP_ORDERS_V1` stays unset/off |
| Dark Theme v1 | Off | Off | Not part of this release | No separate gate |
| Android Vision capture | Separate remote gate | Still off | Not applicable | `android_drape_vision` stays false until Android capture proof |

Other production remote flags do not become launch toggles by association:
`consultation_booking` and `ops_control_plane` are already on; `web_checkout`,
`sms_critical_updates`, and `ops_slack_daily_digest` remain off. The
`web_checkout` database flag is not referenced by the current web code, so
switching it would not enable checkout.

## Promotion order

1. Review the isolated flag PR. The launch contract now fails if production
   mobile differs from the approved shipped flags, web quote negotiation is
   off, or Group Orders / Dark Theme are turned on.
2. Set the Drape-PROD Edge secret `QUOTE_NEGOTIATION_V1=true` as a separate,
   recorded production operation. The October 4 read-only secret inventory did
   not list it. Supabase project secrets cannot be inferred from Git, so this
   needs a live post-change check; the static contract cannot certify it.
3. Merge the reviewed PR. Cloudflare's `main` build must inject
   `NEXT_PUBLIC_QUOTE_NEGOTIATION_V1=true` **during the Next build**, not just
   at Worker runtime. Both the standalone `cf:build` command and the
   `cf:deploy` wrapper inject Wrangler vars into their Next build subprocesses.
   The legacy `cf:deploy:built` command now uses the same guarded, rebuilding
   deploy path so an older `.open-next` bundle cannot bypass this contract.
   Confirm the merged commit deployed and the quote UI is visible in the
   actual production web bundle.
4. Build iOS and Android from the same reviewed commit using the `production`
   EAS profile. An EAS config change cannot change installed binaries. Verify
   the effective flags in each release artifact, then exercise quote review,
   message actions, tab navigation, and Vision presentation on the builds.
5. Keep the Android Vision capture, Group Orders, Dark Theme, SMS critical
   updates, and dormant ops digest gates off. Do not conflate Vision's UI-v2
   presentation flag with permission to enable Android camera capture.

Turning on the server quote flag changes `payment-action` for all custom
orders in `QUOTE_SENT`: it requires the active quote ID and version when
preparing payment. The new mobile client sends both; web does so only when its
build flag is on. If an older app remains installed, check its checkout path
before relying on the new server flag. No app build is made by this source PR.
