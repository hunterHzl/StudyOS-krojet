# StudyOS 4.4.0 — test record

Environment used here: headless Chromium (Playwright) + Node 22 + JDK runtime (keytool). **No Android SDK, Gradle, javac, device or network.**
"Test double" = a stand-in for the Android plugin that feeds the real JavaScript; it cannot prove the Java works.

## Passed (automated, reproducible with the commands in tests/README.md)
| Area | Result | How |
|---|---|---|
| Unit: import logic, keystore creation, web composition (foobar2000 absent, widget/lyrics code kept), icon resources, release hygiene | 12/12 | `npm test` |
| Launch + navigation (10 sections), no console errors | pass | e2e_ui |
| Timetable: blank start, add/edit/remove period, persists after reload, plain styling | pass | e2e_ui |
| Home order, no duplicated widgets, Insights still renders | pass | e2e_ui |
| Streak: x-prefix and flame colour at 1, 7, 15, 29, 30, 60, 100, 200, 300, 400, and 0; Consistency tiles | pass | e2e_ui |
| Animations: default on, scroll reveal once (no re-trigger), Disable Animations immediate / persisted / splash skipped / OS reduced-motion / dark mode | pass | e2e_ui |
| Default palette Black + Grey (neutral), existing saved palette preserved, custom palettes selectable | pass | e2e_ui, e2e_data |
| Theme switching light/dark/system incl. live OS change | pass | e2e_data |
| Mobile 320/360/393px: bar fits, 10 sections reachable via More, last content clear of bar, no horizontal overflow | pass | e2e_ui |
| Lyrics: old build reproduced the bug (active line 156px ≈ 5.7 rows off-centre; widget 178→238px wide; long line wrapped to 81px); new build centred, fixed sizes, ellipsis | pass | e2e_lyrics (before/after) |
| Study timer counts down and auto-logs a session; streak/stats update | pass (fake clock) | e2e_data |
| Existing data: launching 4.4.0 leaves saved data byte-identical; streak of an old data set unchanged (45 days → x45); saved timetable/profile/tasks kept | pass | e2e_data (vs previous version) |
| Backup export + restore on a fresh device; persistence across restart | pass | e2e_data |
| Music widget with media-session test double: states, permission explanation, controls incl. unsupported, volume, artwork, LRCLIB cache (incl. no-lyrics and offline), mirror/restore prompt, import assistant | 31/31 | e2e_android |
| Icon resources: 5 densities, adaptive layers, themed layer, glyph inside safe zone (130px of 132px limit), preview under circle/squircle/square masks | pass | test-icons + preview |

## NOT done — must be checked on a real device (nothing below is claimed to work)
- Compiling the Java (never compiled here) and the Gradle build; producing the signed APK and AAB; `apksigner`/`aapt2`/`jarsigner` checks (scripted, never run).
- Installing the APK; update-installing a second build over the first.
- Launcher, app-settings, recents and installer icon appearance (resources verified, rendering not); Android 12+/13 splash and themed icon.
- Real music players via notification access on the Redmi Turbo 3 / HyperOS 3: permission screens, restricted-settings flow, controls, artwork, volume, background behaviour. (Android 16 specifics unverified.)
- Safe-area / gesture-bar / keyboard behaviour in the real WebView; performance of the animation switch on a low-end phone.
- Data persistence across an APK *update* and the notification-access flow after update.
