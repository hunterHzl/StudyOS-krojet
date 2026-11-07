# StudyOS for Android (Capacitor) — build guide

Developed by HunterHz · https://github.com/hunterHzl · app id `com.hunterhz.studyos`

`web-src/` is your StudyOS 4.3.6 web app, untouched. `npm run prepare:web` builds `www/` from it plus the Android layer in
`android-web/`. In `www/app.js` only the Now Playing poll/control code is swapped (see "Music"); everything else is byte-identical.

## Build (on a machine with the Android SDK)
Prerequisites: Node 20+, JDK 17+ (21 recommended), Android SDK (platform 35, build-tools) with `ANDROID_HOME` set.
```
npm install
npm run setup          # generates android/, applies the StudyOS overlay, syncs web assets
npm run build:debug    # dist/StudyOS-debug.apk  (installs as "StudyOS Debug", separate data, safe for testing)
npm run keystore       # ONCE: creates keystore/ + keystore.properties (git-ignored). BACK THEM UP.
npm run build:release  # dist/StudyOS-release.apk, signed (v1+v2+v3), verified with apksigner, cert fingerprint pinned
```
Raise `versionCode` in `version.properties` for every release you want to install over an older one.
Always use the SAME keystore: a different key cannot update an installed app. R8 stays off until you test `-PenableR8=true`.
Install: `adb install -r dist/StudyOS-release.apk`, or copy the file to the phone.

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

## Verification status — read this
Done here (`npm test`, plus a headless-browser run with **test doubles** for the two native plugins): import logic, keystore creation,
web composition (foobar2000 removed, widget/lyrics code preserved), widget states and controls, permission explanation, lyrics cache,
artwork flow, offline behaviour, data mirror + restore prompt, import flow, phone/tablet layout.
**NOT done (no Android SDK / device available here):** compiling the Java, Gradle build, APK signing, installing, and every test on the
Redmi Turbo 3 / HyperOS. The Java was written carefully but has never been compiled: expect to fix small compile errors on first build.
Do not treat the APK as verified until you have built, installed and tested it. Checklist: phone + tablet/landscape layouts, airplane-mode
use of planner/notes/mind maps/timer, close and reopen (data persists), export/import/restore, grant notification access and control a
real player, revoke access and confirm the app recovers, update-install a second build over the first (same signature).
