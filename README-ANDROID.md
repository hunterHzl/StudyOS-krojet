# StudyOS 4.4.0 for Android (Capacitor) — build guide

Developed by HunterHz · https://github.com/hunterHzl · app id `com.hunterhz.studyos`

`web-src/` is your StudyOS 4.3.6 web app, untouched. `npm run prepare:web` builds `www/` from it plus the Android layer in
`android-web/`. In `www/app.js` only the Now Playing poll/control code is swapped (see "Music"); everything else is byte-identical.

## Build (on a machine with the Android SDK)
Prerequisites: Node 20+, JDK 17+ (21 recommended), Android SDK (platform 35, build-tools incl. apksigner + aapt2) with `ANDROID_HOME` set.
```
npm install
npm test               # unit + hygiene checks (no SDK needed)
npm run setup          # generates android/, applies the StudyOS overlay (official icon, manifest, signing, music plugin), syncs web assets
npm run build:debug    # dist/StudyOS-debug.apk   ("StudyOS Debug", separate app id + data, for testing)
npm run keystore       # ONCE: creates keystore/ + keystore.properties (git-ignored). BACK UP BOTH FILES.
npm run build:release  # dist/StudyOS-release.apk + dist/StudyOS-release.aab (signed) + SHA256SUMS.txt, then verifies them
npm run verify         # re-run the signature / icon / permission checks on dist/
```
**Signing:** credentials come from `keystore.properties` (git-ignored) or env vars `STUDYOS_KEYSTORE_FILE`, `STUDYOS_KEYSTORE_PASSWORD`, `STUDYOS_KEY_ALIAS`, `STUDYOS_KEY_PASSWORD`. A release build without them fails on purpose (never unsigned). The first release pins the certificate fingerprint in `release-cert.sha256`; later builds fail if the key differs (a different key cannot update installed apps). Never commit the keystore; losing it means no more updates under this app id. Google Play: upload the `.aab` and enrol in Play App Signing, or distribute the APK directly.
**Versions:** edit `version.properties` (`versionName`, `versionCode`); versionCode must rise with every release (4.4.0 → 40400).
**Icon:** official artwork from `web-src/icon.svg`; regenerate with `npm run icons` (needs python + playwright + pillow) — generated files are committed in `android-native/res`.
R8 stays off until you test `./gradlew assembleRelease -PenableR8=true` on a device. Install: `adb install -r dist/StudyOS-release.apk`.
**Data:** automatic Google backup is disabled by design; use Settings → export/import. See CHANGELOG.md and TESTING.md.

## Music (revised design)
StudyOS plays no audio. It reads and controls the **active Android media session** of whatever music app is playing.
* Needs **Notification access** (special access: Android cannot show a normal permission pop-up for it). The app explains why first,
  then opens the right Settings page. The listener service (`StudyOSNotificationListener`) is empty: it never reads notifications.
* Android 13+ and APK installs: the switch is greyed out until App info → ⋮ → **Allow restricted settings**. The panel says so.
* Xiaomi/Redmi/HyperOS: set Battery saver to *No restrictions* and enable *Autostart*, or the system may drop the link in the background.
* Shown: title, artist, album, cover, progress/duration, player name. Controls: play/pause, previous, next; volume when allowed.
* Limits (not hidden): a player must publish a media session; a control is only sent if the player advertises it (otherwise the app says
  "<player> does not offer that control"); some players give no cover or no duration; volume is the player's own for remote sessions
  and the phone's media volume otherwise; updates are push-based while StudyOS is open and paused while it is in the background.
* Lyrics: existing LRCLIB code and highlighting, plus a device cache (known tracks never re-downloaded; "no lyrics" remembered 12 h).
* Permissions in the manifest: INTERNET, ACCESS_NETWORK_STATE only. foobar2000/Beefweb is gone from the Android build
  (checked by `npm test`); the desktop `NowPlayingBridge` folder is not part of this project.

## Data
Primary store = the app's own `localStorage` (exactly as on the web). Every save is mirrored atomically to a private file; if Android
ever clears app storage, StudyOS **asks** before restoring it. Settings → Import assistant inspects any backup, previews, takes a
safety copy, merges (never silently overwrites), preserves ids/timestamps, keeps unknown keys, and reports what could not be migrated.
JSON export uses Android's "save as" picker; the existing website import still works.

## Verification status
See **TESTING.md**: browser-level tests pass; the Java, Gradle build, APK/AAB, signing and on-device behaviour have NOT been verified in this environment and must be checked on your phone before release.
