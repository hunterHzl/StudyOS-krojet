// Build helper: node scripts/build.mjs <sync|debug|release|verify>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareWeb } from './prepare-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const androidDir = path.join(root, 'android');
const dist = path.join(root, 'dist');
const sh = (cmd, args, cwd = root, capture = false) =>
  spawnSync(cmd, args, { cwd, shell: win, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
const fail = (m) => { console.error('\n' + m); process.exit(1); };

function needAndroid() { if (!fs.existsSync(androidDir)) fail('android/ not found. Run `npm run setup` first.'); }
function sync() { needAndroid(); prepareWeb(); if (sh('npx', ['cap', 'sync', 'android']).status !== 0) fail('cap sync failed'); }
function gradle(task, extra = []) {
  const wrapper = path.join(androidDir, win ? 'gradlew.bat' : 'gradlew');
  if (!win) { try { fs.chmodSync(wrapper, 0o755); } catch {} }
  const r = sh(wrapper, [task, ...extra], androidDir);
  if (r.status !== 0) fail(`Gradle task ${task} failed.`);
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function findApksigner() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const bt = path.join(sdk, 'build-tools');
  if (!fs.existsSync(bt)) return null;
  const vs = fs.readdirSync(bt).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse();
  for (const v of vs) { const p = path.join(bt, v, win ? 'apksigner.bat' : 'apksigner'); if (fs.existsSync(p)) return p; }
  return null;
}

function verify(apk, { release }) {
  const signer = findApksigner();
  if (!signer) fail('apksigner not found (install Android SDK build-tools and set ANDROID_HOME).');
  const r = sh(signer, ['verify', '--verbose', '--print-certs', '--min-sdk-version', '24', apk], root, true);
  const out = (r.stdout || '') + (r.stderr || '');
  console.log(out);
  if (r.status !== 0) fail('APK signature verification FAILED.');
  const v2 = /v2 scheme[^\n]*: true/.test(out), v3 = /v3 scheme[^\n]*: true/.test(out);
  if (!v2 || !v3) fail(`Signature schemes: v2=${v2} v3=${v3}. Both are required.`);
  const fp = (/certificate SHA-256 digest: ([0-9a-f]+)/i.exec(out) || [])[1];
  if (release) {
    if (/Android Debug/i.test(out)) fail('Release APK is signed with the DEBUG key.');
    const pin = path.join(root, 'release-cert.sha256');
    if (fp) {
      if (!fs.existsSync(pin)) { fs.writeFileSync(pin, fp + '\n'); console.log('Pinned release certificate fingerprint in release-cert.sha256 (commit this file; it is public).'); }
      else if (fs.readFileSync(pin, 'utf8').trim() !== fp) fail('Signing certificate DIFFERS from the pinned one (release-cert.sha256). An APK signed with a different key cannot update the installed app.');
      else console.log('Certificate matches the pinned fingerprint: updates will install over earlier releases.');
    }
  }
  console.log('Signature OK (v2 + v3).');
}

const cmd = process.argv[2];
if (cmd === 'sync') sync();
else if (cmd === 'debug') {
  sync(); gradle('assembleDebug');
  const apk = path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
  if (!fs.existsSync(apk)) fail('Debug APK not found after build.');
  fs.mkdirSync(dist, { recursive: true });
  fs.copyFileSync(apk, path.join(dist, 'StudyOS-debug.apk'));
  console.log('\nBuilt dist/StudyOS-debug.apk (installs as "StudyOS Debug", separate from the real app and its data).');
} else if (cmd === 'release') {
  if (!fs.existsSync(path.join(root, 'keystore.properties')) && !process.env.STUDYOS_KEYSTORE_FILE) fail('No signing configuration. Run `npm run keystore` once first.');
  sync(); gradle('assembleRelease', process.argv.slice(3));
  const apk = path.join(androidDir, 'app/build/outputs/apk/release/app-release.apk');
  if (!fs.existsSync(apk)) fail('Signed release APK not found (an app-release-unsigned.apk means signing was not applied).');
  fs.mkdirSync(dist, { recursive: true });
  const target = path.join(dist, 'StudyOS-release.apk');
  fs.copyFileSync(apk, target);
  verify(target, { release: true });
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), `${sha256(target)}  StudyOS-release.apk\n`);
  console.log('\nBuilt dist/StudyOS-release.apk');
} else if (cmd === 'verify') {
  const f = path.join(dist, 'StudyOS-release.apk');
  if (!fs.existsSync(f)) fail('dist/StudyOS-release.apk not found.');
  verify(f, { release: true });
} else fail('Usage: node scripts/build.mjs <sync|debug|release|verify>');
