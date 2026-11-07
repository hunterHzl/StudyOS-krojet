// One-time (and re-runnable) setup: installs deps, generates the Capacitor Android project, applies the StudyOS overlay.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareWeb } from './prepare-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
};
const step = (m) => console.log(`\n=== ${m}`);

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) throw new Error('Node 20 or newer is required.');
const jv = spawnSync('java', ['-version'], { encoding: 'utf8', shell: win });
if (jv.error || jv.status !== 0) throw new Error('A JDK (17 or newer, 21 recommended) is required: `java -version` failed.');

step('Installing npm dependencies');
if (!fs.existsSync(path.join(root, 'node_modules', '@capacitor', 'cli'))) run('npm', ['install']);

step('Composing web assets (www/)');
prepareWeb();

const androidDir = path.join(root, 'android');
if (!fs.existsSync(androidDir)) { step('Generating the Android project'); run('npx', ['cap', 'add', 'android']); }

step('Applying the StudyOS native overlay');
const native = path.join(root, 'android-native');
const mainDir = path.join(androidDir, 'app', 'src', 'main');
const javaDir = path.join(mainDir, 'java', 'com', 'hunterhz', 'studyos');
fs.mkdirSync(javaDir, { recursive: true });
for (const f of fs.readdirSync(path.join(native, 'java'))) fs.copyFileSync(path.join(native, 'java', f), path.join(javaDir, f));
fs.copyFileSync(path.join(native, 'AndroidManifest.xml'), path.join(mainDir, 'AndroidManifest.xml'));
fs.copyFileSync(path.join(native, 'signing.gradle'), path.join(androidDir, 'app', 'signing.gradle'));
fs.copyFileSync(path.join(native, 'proguard-studyos.pro'), path.join(androidDir, 'app', 'proguard-studyos.pro'));

const gradleFile = path.join(androidDir, 'app', 'build.gradle');
let g = fs.readFileSync(gradleFile, 'utf8');
if (!g.includes("apply from: 'signing.gradle'")) {
  g += "\n// StudyOS overlay (signing, debug/release configs, media dependencies)\napply from: 'signing.gradle'\n";
  fs.writeFileSync(gradleFile, g);
}
// the stock template may ship its own MainActivity in the same package: ours has overwritten it.
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const lp = path.join(androidDir, 'local.properties');
if (sdk && !fs.existsSync(lp)) fs.writeFileSync(lp, `sdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`);
if (!sdk && !fs.existsSync(lp)) console.warn('WARNING: ANDROID_HOME is not set and android/local.properties is missing. Install the Android SDK (platform 35, build-tools) and set ANDROID_HOME.');

if (fs.existsSync(path.join(root, 'assets', 'icon-only.png'))) {
  step('Generating launcher icons (non-fatal if offline)');
  try { run('npx', ['capacitor-assets', 'generate', '--android', '--iconBackgroundColor', '#DCEBCF', '--iconBackgroundColorDark', '#304A35']); }
  catch { console.warn('Icon generation skipped.'); }
}

step('Syncing web assets into the Android project');
run('npx', ['cap', 'sync', 'android']);
console.log('\nSetup complete. Next: `npm run build:debug`, then `npm run keystore` (once) and `npm run build:release`.');
