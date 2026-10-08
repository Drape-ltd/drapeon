# Android R8 optimization for the next store build

Play Console flagged Drapeon 1.0.3 for low DEX obfuscation (2%). The managed Expo
config now enables R8 minification and resource shrinking for Android release
builds. This is a native-build setting; an EAS Update cannot change the existing
1.0.3 bundle or clear its Play Console warning.

Before the next Android production submission:

1. Build an Android preview/release candidate with the same release settings.
2. Smoke-test startup, sign-in, Explore, Vision, Sketch Room, image/video upload,
   orders, payments, chat, and push notifications on a physical Android device.
3. Check the build's `mapping.txt` availability and deobfuscation in Sentry/Play
   Console before relying on minified native crash traces.
4. Submit the new app bundle, then confirm Play Console's DEX optimization score
   for that bundle. Do not assume this configuration alone clears the warning.

If a native flow breaks, inspect R8's missing-class warnings and add targeted keep
rules; do not disable shrinking globally or add broad package-wide keep rules.
