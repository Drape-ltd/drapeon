# Mobile over-the-air releases

Version 1.0.2 was built without `expo-updates` and cannot receive EAS Updates. Version 1.0.3 is the first OTA-capable binary. Users must install it from the store before an OTA can reach them. Do not publish an update expecting it to repair 1.0.2.

## Channel contract

| Build profile | Update channel | Backend |
| --- | --- | --- |
| `development`, `development-device` | `development` | D-DEV |
| `preview` | `preview` | D-DEV |
| `testflight` | `staging` | Production |
| `production` | `production` | Production |

The runtime version follows the app version. An OTA for 1.0.3 can reach only a compatible 1.0.3 binary on its channel. Bump the app version and ship a new store build for native dependencies, config plugins, permissions, or other native-runtime changes.

## Publish procedure after 1.0.3 is installed

1. Use clean `main` matching `origin/main`; run the release-source, UI-gate, EAS Update, and build-profile checks.
2. Publish to `staging` first, using the **production** EAS environment and the `testflight` profile's public build-time variables. Open the TestFlight app and verify the update ID, critical navigation, authentication, and backend target.
3. Publish the same reviewed change to `production`, using the **production** EAS environment and the `production` profile's public build-time variables. Observe adoption and Sentry after release.

Do not run a bare `eas update --channel production`: EAS Update does **not** inherit `eas.json` build-profile `env` values. In particular, the app variant and shipped UI flags must be supplied explicitly or the OTA bundle may differ from the store build. A guarded publish command should be added and tested before the first production OTA. Until then, treat OTA publishing as a manual release requiring an explicit environment/flag audit.

Use the EAS dashboard to roll back an unhealthy update or repoint a channel to the last known-good update. A rollback does not repair a binary missing the `expo-updates` native library.
