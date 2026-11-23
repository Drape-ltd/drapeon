# Android Push / FCM Runbook

Drape Android push requires two pieces that must point at the same Firebase project:

1. Firebase Android config file
   - Firebase project: `drape-mobile-4729` (`Drape`).
   - Firebase Android app package: `com.drape.app`.
   - Firebase Android app id: `1:803179901935:android:33f9faaf2a117d82bb3c1a`.
   - Local config path: `apps/mobile/google-services.json`; Expo prebuild copies it into `android/app`.
   - Existing native-folder rebuild path: place it at `apps/mobile/android/app/google-services.json` before rebuilding the current dev client.
   - Do not commit this file. It is ignored by git.
   - EAS file env var: `GOOGLE_SERVICES_JSON` is configured for `development`, `preview`, and `production` so cloud builds can receive the git-ignored config. The current Preview file does **not** contain an Android client for `com.drape.app.preview`; the Preview build remains blocked until it is replaced.
   - `apps/mobile/app.config.js` resolves `GOOGLE_SERVICES_JSON` first and falls back to the local file path for local rebuilds.

2. EAS Android push credentials
   - Upload/configure the Firebase Cloud Messaging V1 service account for the same Firebase project in EAS.
   - Current EAS status: an FCM V1 key is assigned for the existing Android application identifiers. Confirm assignment for the distinct Preview identifier `com.drape.app.preview` after registering that Firebase app.
   - Assigned Firebase project: `drape-mobile-4729`.
   - Assigned service account: `firebase-adminsdk-fbsvc@drape-mobile-4729.iam.gserviceaccount.com`.
   - Rebuild the Android dev client or release build after both credentials are present.

Verification:

1. Install the rebuilt Android app on Pixel and Samsung.
2. Open the app while signed in as customer and tailor.
3. Confirm `expo-notifications` returns an Expo push token with no `FirebaseApp is not initialized` log.
4. Confirm `push_tokens` has fresh rows for both users.
5. Run `service-health?check=ready` and confirm `androidPushRegistration` is `ok`.
6. Trigger a safe notification path:
   - customer sends a message to tailor
   - tailor updates a non-terminal order stage
7. Confirm notifications appear on both phones and tap through to fresh app data.

Observability note:

- Notification jobs can be queued and processed even while Android has no registered
  device token. In that case `process-job-queue` should log `push.skipped` with
  `NO_TOKEN` instead of treating the missing phone banner as a provider success.
- Real provider/API failures should retry through `job_queue`; a missing token means
  the app build or device registration path still needs fixing.

Latest dev validation:

- On 2026-05-21, the Firebase-enabled Android debug/dev-client build was installed on both QA devices:
  - Pixel customer device
  - Samsung A17 tailor device
- Both devices loaded the app through the local Metro dev-client.
- The previous native failure signature was no longer present in device logs.
- `push_tokens` contained fresh Android rows for both signed-in QA users.
- `service-health?check=ready` reported `androidPushRegistration` as `ok`.
- A harmless Expo QA push was sent to both registered Android tokens and appeared in the Pixel and Samsung notification managers.

Launch blocker:

- If `google-services.json` is missing from the build, Android push registration is expected to fail. The app can still run, but Android push is not launch-ready.
- If EAS FCM V1 credentials are missing, Android devices may register locally but Expo cannot reliably send production push notifications through FCM V1.
- Fixed failure signature on device:
  - `Default FirebaseApp failed to initialize because no default options were found`
  - `E_REGISTRATION_FAILED ... Default FirebaseApp is not initialized`
- Readiness should show `androidPushRegistration` as `ok` after a rebuilt Android app stores a fresh Android token.

Local QA note:

- If a plugged-in Android dev client cannot reach the LAN server after Wi-Fi changes, run:
  - `adb -s <device> reverse tcp:8081 tcp:8081`
  - Open `http://localhost:8081` from the Expo dev-client server list.

## Preview variant recovery — owner console handoff

The Preview build uses `com.drape.app.preview`, not the Development package `com.drape.app`. As of 2026-11-10, the Firebase CLI's saved login returns HTTP 401 and the browser is locked, so the app has not been registered. The existing EAS Preview config file lacks this client. No Production Firebase or EAS variable should be changed for this recovery.

1. In the [Firebase console](https://console.firebase.google.com/project/drape-mobile-4729/overview), open project `drape-mobile-4729`, then **Project settings → General → Your apps → Add app → Android**. Enter package `com.drape.app.preview`, nickname `Drapeon Preview`, and click **Register app**. Download the new `google-services.json`. Verify its `client` list includes `com.drape.app.preview` and `com.drape.app` (or use a Preview-specific file containing the Preview client). Do not commit the file.
2. In the [Expo project](https://expo.dev/accounts/dimowoope/projects/drape/environment-variables), open **Project settings → Environment variables**. Replace the `GOOGLE_SERVICES_JSON` **file** variable scoped to **preview** with the downloaded JSON. Leave the development and production scopes unchanged. This file is read by `apps/mobile/app.config.js` at build time.
3. In **Project settings → Credentials → Android**, select application identifier `com.drape.app.preview`. Under **Service credentials → FCM V1 service account key**, assign the existing key for Firebase project `drape-mobile-4729`; upload a key only if the existing one cannot be selected. Do not expose or commit the service-account JSON.
4. Rebuild the Android `preview` profile from merged main. Confirm the packaged app identifier, Firebase client and fresh push token; then send a Dev test push and tap it. A successful build alone does not prove notification delivery.

Firebase and Expo document the [Android app registration](https://firebase.google.com/docs/android/setup), [EAS file variable](https://docs.expo.dev/eas/environment-variables/manage/) and [FCM V1 credential assignment](https://docs.expo.dev/push-notifications/fcm-credentials/) steps.
