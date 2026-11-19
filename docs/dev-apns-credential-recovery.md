# Drape-DEV iOS push credential recovery

The Dev queue snapshot on 2026-11-18 included 16 `SEND_PUSH` jobs that could not deliver because Expo had no APNs credential for the Dev iOS bundle ID `co.drapeon.app.dev`. This is a credential setup task, not a queue replay instruction.

1. The Apple Developer Account Holder or Admin checks that the `co.drapeon.app.dev` App ID has Push Notifications enabled. Create or restore an APNs authentication key for that topic, and retain its `.p8` file, Key ID, and Apple Team ID in the approved credential store. Do not commit or paste them into a PR. Apple documents [key creation](https://developer.apple.com/help/account/keys/create-a-private-key) and [App ID capabilities](https://developer.apple.com/help/account/identifiers/enable-app-capabilities).
2. The mobile release owner selects the Dev iOS build profile in `eas credentials`, then assigns the APNs key under **Push Notifications: Manage your Apple Push Notifications Key**. Verify that the Dev profile resolves to `co.drapeon.app.dev`, not the Store bundle ID. Expo documents [assigning an existing push key](https://docs.expo.dev/app-signing/app-credentials/).
3. Install a fresh Dev build on a physical iPhone, sign in with a Dev QA account, register a fresh Expo push token, send one synthetic QA notification, and verify both Expo ticket and APNs receipt plus the exact in-app destination. A simulator token or an Expo accepted ticket alone does not prove delivery.

Keep the 16 historical DEAD jobs untouched until a named Dev/Ops operator owns a reviewed recovery runbook. This repo fix does not add an APNs key or change push credentials.
