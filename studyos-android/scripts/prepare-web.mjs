// Composes www/ = untouched web-src/ + the Android layer. web-src is never modified.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'web-src');
const layer = path.join(root, 'android-web');
const out = path.join(root, 'www');

const must = (cond, msg) => { if (!cond) throw new Error('prepare-web: ' + msg + ' (web-src changed? update scripts/prepare-web.mjs and android-native/patches)'); };
const count = (hay, needle) => hay.split(needle).length - 1;

/** Android build only: replaces the foobar2000/Beefweb "bridge" code in the Now Playing widget with Android media-session code.
 *  web-src/app.js (the desktop original) is never modified; www/app.js is a derived file. */
export function patchApp(js) {
  const poll = fs.readFileSync(path.join(root, 'android-native/patches/np-poll.js.txt'), 'utf8').trimEnd();
  const control = fs.readFileSync(path.join(root, 'android-native/patches/np-control.js.txt'), 'utf8').trimEnd();

  const bridgeConst = "const NP_BRIDGE='http://127.0.0.1:8765';";
  must(count(js, bridgeConst) === 1, 'NP_BRIDGE constant not found exactly once');
  js = js.replace(bridgeConst, '');

  const s1 = js.indexOf('async function npPoll(){');
  const s2 = js.indexOf('async function npControl(action){');
  must(s1 > 0 && s2 > s1 && count(js, 'async function npPoll(){') === 1 && count(js, 'async function npControl(action){') === 1, 'npPoll/npControl not found');
  const e2 = js.indexOf('\n', s2);
  js = js.slice(0, s1) + poll + '\n  ' + control + js.slice(e2);

  const about = '<li>Playback controls for foobar2000 through the optional local StudyOS bridge and Beefweb component.</li>';
  must(count(js, about) === 1, 'About list item not found');
  js = js.replace(about, '<li>Controls for the music app playing on your Android device, through Android media sessions. No second player is built in.</li>');
  const comment = '// Now Playing: foobar2000 metadata is supplied by the optional local StudyOS bridge.';
  must(count(js, comment) === 1, 'Now Playing comment not found');
  js = js.replace(comment, '// Now Playing: track data comes from the active Android media session (see android/music-session.js).');
  return js;
}

export function prepareWeb() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'android'), { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f === 'sw.js') continue; // the packaged app ships its own assets; no service worker needed
    fs.cpSync(path.join(src, f), path.join(out, f), { recursive: true });
  }
  for (const f of fs.readdirSync(layer)) fs.copyFileSync(path.join(layer, f), path.join(out, 'android', f));

  fs.writeFileSync(path.join(out, 'app.js'), patchApp(fs.readFileSync(path.join(src, 'app.js'), 'utf8')));
  let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');

  // 1. Native padding handles safe areas; avoid double insets from viewport-fit=cover.
  const vp = /(<meta[^>]+name=["']viewport["'][^>]*content=["'])([^"']*)(["'])/i;
  must(vp.test(html), 'viewport meta not found');
  html = html.replace(vp, (m, a, c, z) => a + c.replace(/,?\s*viewport-fit=cover/i, '') + z);

  // 2. Android stylesheet after the app stylesheet.
  const css = /(<link[^>]+href=["']styles\.css["'][^>]*>)/i;
  must(css.test(html), 'styles.css link not found');
  html = html.replace(css, '$1\n<link rel="stylesheet" href="android/android.css">');

  // 3. app.js is loaded by the boot script (which also loads the Android features afterwards).
  const app = /<script[^>]+src=["']app\.js["'][^>]*><\/script>/i;
  must(app.test(html), 'app.js script tag not found');
  html = html.replace(app, '<script src="android/android-boot.js"></script>');

  // 4. Remove foobar2000 wording from the popover.
  must(html.includes('Powered by foobar2000 + LRCLIB') && html.includes('>Retry connection<'), 'popover text not found');
  must(html.includes('Connect foobar2000') && html.includes('Open foobar2000 to begin'), 'initial widget text not found');
  html = html.replace('Powered by foobar2000 + LRCLIB', 'Controls your active music app · lyrics by LRCLIB').replace('>Retry connection<', '>Refresh<')
    .replace('Connect foobar2000', 'Connect music app').replace('Open foobar2000 to begin', 'Start a song in your music app');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  // The Android build must contain no trace of the desktop music integration.
  for (const f of ['app.js', 'index.html']) {
    const t = fs.readFileSync(path.join(out, f), 'utf8');
    const hit = /foobar|beefweb|127\.0\.0\.1:8765|NP_BRIDGE|studyos bridge/i.exec(t);
    must(!hit, `${f} still references the desktop music bridge ("${hit && hit[0]}")`);
  }
  fs.writeFileSync(path.join(out, 'android', 'build-info.json'), JSON.stringify({ built: new Date().toISOString() }, null, 2));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('www/ ready:', prepareWeb());
}
