import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createKeystore } from './keystore.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studyos-ks-'));
const opts = { dir: path.join(tmp, 'keystore'), propsFile: path.join(tmp, 'keystore.properties'), keySize: 2048, quiet: true };
const { jks } = createKeystore(opts);
const props = Object.fromEntries(fs.readFileSync(opts.propsFile, 'utf8').trim().split('\n').map(l => l.split(/=(.*)/s).slice(0, 2)));
const r = spawnSync('keytool', ['-list', '-keystore', jks, '-storepass:env', 'P'], { env: { ...process.env, P: props.storePassword }, encoding: 'utf8' });
assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /studyos/i);
assert.throws(() => createKeystore(opts), /already exists/);       // never overwrites
fs.rmSync(tmp, { recursive: true, force: true });
console.log('ok  - keystore created, listed with keytool, overwrite refused');
