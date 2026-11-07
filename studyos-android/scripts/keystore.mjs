// Creates the dedicated release keystore ONCE. Refuses to overwrite an existing one.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function createKeystore({ dir = path.join(root, 'keystore'), propsFile = path.join(root, 'keystore.properties'), keySize = 4096, quiet = false } = {}) {
  const jks = path.join(dir, 'studyos-release.jks');
  if (fs.existsSync(jks) || fs.existsSync(propsFile)) {
    throw new Error(`A keystore already exists (${fs.existsSync(jks) ? jks : propsFile}). Not overwriting: replacing it would stop updates from installing over the current app.`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const password = crypto.randomBytes(24).toString('base64url');
  const alias = 'studyos';
  const r = spawnSync('keytool', ['-genkeypair', '-keystore', jks, '-storetype', 'PKCS12', '-alias', alias, '-keyalg', 'RSA', '-keysize', String(keySize),
    '-validity', '36500', '-storepass:env', 'STUDYOS_KS_PASS', '-keypass:env', 'STUDYOS_KS_PASS', '-dname', 'CN=HunterHz, OU=StudyOS, O=HunterHz'],
  { env: { ...process.env, STUDYOS_KS_PASS: password }, encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error('keytool failed (is a JDK installed?): ' + (r.error?.message || r.stderr));
  fs.writeFileSync(propsFile, `storeFile=keystore/studyos-release.jks\nstorePassword=${password}\nkeyAlias=${alias}\nkeyPassword=${password}\n`, { mode: 0o600 });
  if (!quiet) {
    console.log(`\nCreated:\n  ${jks}\n  ${propsFile}\n`);
    console.log('IMPORTANT: back up BOTH files somewhere private (password manager / encrypted drive).');
    console.log('If you lose them you can never publish an update that installs over this app. Never commit them (they are git-ignored).\n');
  }
  return { jks, propsFile, alias };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { createKeystore(); } catch (e) { console.error(e.message); process.exit(1); }
}
