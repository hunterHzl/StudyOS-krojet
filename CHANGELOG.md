# StudyOS 4.4.0 — first public release (Android + web source)

Package id `com.hunterhz.studyos` · versionName 4.4.0 · versionCode 40400 · app label `StudyOS` (debug builds: "StudyOS Debug", separate app id).

## Changed in the app (web source, `web-src/`)
1. **Timetable** — new installs start completely blank (no sample lessons). Plain table: no fills or gradients. You can add a period, edit its time, type lessons into the grid and remove periods (with confirmation). Saved timetables of existing users are untouched. The Planner only shows a day's timetable when it has lessons.
2. **Music — lyrics window** — root cause: the scroll target used `offsetTop` of a non-positioned container, so it was measured from the popover and included the header height (≈ six 27px rows). Now measured relative to the lyric box and re-centred when the popover opens. Active-line detection and timing code are unchanged.
3. **Music — fixed layout** — fixed-size trigger (150×46), fixed popover width, fixed 28px lyric rows with ellipsis, fixed lyric window height; the active line stays bold and prominent. On phones ≤480px the trigger is icon-only.
4. **Mobile** — bottom bar now fits every phone width (it was 427px wide on a 360px screen and clipped "Insights"): Home, Academics, Tasks, Planner, Study Space and **More**. More (and ☰) open a sheet with all ten sections, now including Timetable, Tools and Settings. Safe-area and bar-height aware bottom padding, no sideways overflow at 320/360/393px (top bar and task rows fixed), 44px touch targets on touch screens.
5. **Scroll reveal** — blocks below the fold reveal once as they scroll into view (IntersectionObserver plus a scroll fallback so jumping past a block never leaves it hidden; keyboard focus and printing reveal instantly). Same entrance animation on every page.
6. **Palette** — new "Black + Grey" neutral palette (true grey, saturation 0) is the default for NEW profiles (theme: System, pure-black dark). Saved palettes, including Graphite, are never changed.
7. **Streak** — `xN` counter everywhere (home panel, Consistency tiles incl. longest), a real two-tone flame, colour by milestone: 1–6 yellow, 7–15 light orange → orange, 16–29 deepening orange, 30 red, 60 deep red, 100 blue, 200 purple, 300 green, 400+ white. Calculation untouched.
8. **Home order** — Daily study duration → Consistency & productivity → This week (beside Study streak) → Priority tasks + Upcoming exams → Subject performance + Quick actions. Daily study duration and Consistency & productivity were on **Insights**; they were *moved* (one instance each, no duplicates). The 7/30/90-day range control moved with the chart; Insights keeps its own range control for its remaining charts.
9. **Disable Animations** (Settings → App preferences → Animations) — one central switch (`html[data-motion="off"]` + `animationsOff()`): CSS animations, transitions, smooth scrolling and blur stop everywhere, JS effects (count-up, scroll reveal, splash) never start, applies instantly, persists on the device (`localStorage studyos.pref.animations`, not part of backups), default on, OS reduced-motion also respected. Timers, lyric sync, music and button press feedback are unaffected.
10. Version labels and Patch Notes updated to 4.4.0.

## Changed in the Android project
- **Official icon**: generated from `web-src/icon.svg` (the supplied `assets/icon-only` artwork is that same logo): legacy + round PNGs for 5 densities, adaptive icon (full-bleed #DCEBCF background, foreground inside the 66dp safe zone), Android 13 themed monochrome layer, 512px store icon, XML splash (replaces the Capacitor splash). The template's launcher/splash resources are removed during setup so the generic Capacitor icon cannot leak in. Source artwork is only read.
- **AAB**: `npm run build:release` now produces `dist/StudyOS-release.apk` and `dist/StudyOS-release.aab`, signed with your release key; checks signature (v2+v3), certificate pin, package id, version, label, non-debuggable, permissions (INTERNET, ACCESS_NETWORK_STATE only), launcher icon, and the AAB's signature/contents.
- **Backup policy**: Android cloud/auto backup of study data is disabled (no data leaves the phone); direct phone-to-phone transfer is allowed on Android 12+. Use StudyOS's JSON export for backups.
- Removed dev-only dependency `@capacitor/assets`; version/versionCode in `version.properties`; `npm test` now also checks icons and release hygiene (secrets, key material, cleartext/dev-server config).
- Earlier in this project (unchanged): Android media-session music control (no foobar2000), Import assistant, on-device safety mirror, notification-access guidance.

## Not changed on purpose
Study data, streak calculation, existing palettes and timetables, other features, the desktop `NowPlayingBridge` (not part of the Android build).
