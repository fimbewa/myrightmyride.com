# Qindiaglobal Android app

A small Android app that opens https://qindiaglobal.com full screen. Because it shows the live
site, every website change (blog, community, pledges, languages) appears in the app with no new upload.

- Pages of qindiaglobal.com stay in the app; WhatsApp, Facebook, email, phone and news links open in their own apps.
- Photo uploads, downloads (posters, Excel, backup), Share buttons and the phone's Back button work.
- Package name: `com.qindiaglobal.app` (permanent once published on Play).

## Build

GitHub → Actions → "Build Android app (Play Store AAB)" → Run workflow. When it finishes, open the run
and download the file under "Artifacts". Each run gets a higher version number automatically.

## Signing

The workflow signs with the upload key stored in GitHub Actions secrets:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` (optional: `ANDROID_KEY_ALIAS`, default `upload`;
`ANDROID_KEY_PASSWORD`, default same as the keystore password). Never commit the key or passwords.
Use Play App Signing (the default in Play Console), so a lost upload key can be reset by Google.
