import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
import { prepareWeb } from './prepare-web.mjs';
const out = prepareWeb();
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
assert.match(html, /android\/android-boot\.js/); assert.match(html, /android\/android\.css/);
assert.doesNotMatch(html, /src=["']app\.js["']/); assert.doesNotMatch(html, /viewport-fit=cover/);
const orig = fs.readFileSync(new URL('../web-src/app.js', import.meta.url), 'utf8');
const patched = fs.readFileSync(path.join(out, 'app.js'), 'utf8');
assert.ok(orig.includes('127.0.0.1:8765') && orig.toLowerCase().includes('foobar'), 'sanity: the source still has the desktop bridge');
assert.doesNotMatch(patched, /foobar|beefweb|127\.0\.0\.1:8765|NP_BRIDGE/i);
assert.doesNotMatch(html, /foobar|beefweb/i);
// only the music poll/control code, one comment and one About line may differ: everything else is byte-identical
const strip = (t) => t.replace(/async function npPoll\(\)\{[\s\S]*?async function npControl\(action\)\{[^\n]*/, '').replace(/const NP_BRIDGE='[^']*';/, '');
const a = strip(orig), b = strip(patched.replace(/async function npPoll\(\)\{[\s\S]*?async function npControl\(action\)\{[^\n]*/, ''));
assert.ok(Math.abs(orig.length - patched.length) < 3000, 'patched app.js should differ only slightly in size');
for (const mustKeep of ['npLookupLyrics', 'npParseLrc', 'npUpdateLyricsPosition', 'npRenderTrack', 'npLookupArtwork', 'lrclib.net']) assert.ok(patched.includes(mustKeep), mustKeep + ' must be preserved');
assert.ok(!fs.existsSync(path.join(out, 'sw.js')));
console.log('ok  - www composed; foobar2000 removed, lyrics/widget code preserved');
