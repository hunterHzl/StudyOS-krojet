import assert from 'node:assert';
import fs from 'node:fs'; import vm from 'node:vm';
const sandbox = { self: {} }; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../android-web/android-import-core.js', import.meta.url), 'utf8'), sandbox);
const Core = sandbox.self.StudyOSImportCore;
const t = (n, f) => { f(); console.log('ok  -', n); };

const current = { profile: { name: 'Student', theme: 'system' }, settings: { sampleData: true },
  subjects: [{ id: 's1', name: 'Maths' }], tasks: [{ id: 't1', title: 'A' }], notes: [], mindMaps: [] };

t('locates payload at top level and one level down', () => {
  assert.strictEqual(Core.locatePayload({ subjects: [], tasks: [], profile: {} }, current).path, '(top level)');
  assert.strictEqual(Core.locatePayload({ version: 1, data: { subjects: [], tasks: [] } }, current).path, 'data');
  assert.strictEqual(Core.locatePayload({ foo: 1, bar: [] }, current), null);
  assert.strictEqual(Core.locatePayload([1, 2], current), null);
});
t('merge keeps existing, adds missing, skips duplicates, flags conflicts', () => {
  const p = { subjects: [{ id: 's1', name: 'Maths' }, { id: 's1b', name: 'Bio' }, { id: 's1', name: 'DIFFERENT' }], tasks: [{ id: 't1', title: 'A' }], profile: { name: 'Hunter', theme: 'system', accent: 'teal' }, extra: [1] };
  const { result, report } = Core.plan(p, current, { mode: 'merge' });
  assert.deepEqual(result.subjects.map(s => s.id), ['s1', 's1b']);
  assert.strictEqual(result.subjects[0].name, 'Maths');            // existing wins
  assert.strictEqual(result.profile.name, 'Student');              // existing wins
  assert.strictEqual(result.profile.accent, 'teal');               // missing field added
  assert.deepEqual(result.extra, [1]);                       // unknown key preserved
  assert.strictEqual(report.totals.added, 1); assert.strictEqual(report.totals.conflicts, 1); assert.strictEqual(report.totals.duplicates, 2);
  assert.strictEqual(current.subjects.length, 1);                  // input not mutated
});
t('prefer-backup replaces differing records and fields', () => {
  const p = { subjects: [{ id: 's1', name: 'Renamed' }], profile: { name: 'Hunter' }, tasks: [] };
  const { result } = Core.plan(p, current, { mode: 'merge', preferBackup: true });
  assert.strictEqual(result.subjects[0].name, 'Renamed'); assert.strictEqual(result.profile.name, 'Hunter');
});
t('replace uses backup only and warns about missing sections', () => {
  const { result, report } = Core.plan({ subjects: [{ id: 'x' }, null], tasks: [], profile: {} }, current, { mode: 'replace' });
  assert.deepEqual(result.subjects, [{ id: 'x' }]);
  assert.strictEqual(report.collections.find(c => c.key === 'subjects').skipped.length, 1);
  assert.ok(report.warnings.length && report.missingInBackup.includes('notes'));
});
t('type mismatches are reported, device data untouched', () => {
  const { result, report } = Core.plan({ subjects: 'oops', tasks: [], profile: {} }, current, { mode: 'merge' });
  assert.strictEqual(report.typeMismatches[0].key, 'subjects'); assert.strictEqual(result.subjects.length, 1);
});
t('works with nothing stored yet and preserves ids/timestamps verbatim', () => {
  const rec = { id: 'abc', createdAt: '2024-02-03', n: 1 };
  const { result } = Core.plan({ tasks: [rec], subjects: [], profile: {}, exportedAt: 'x', format: 'StudyOS backup v1' }, null, { mode: 'merge' });
  assert.deepEqual(result.tasks[0], rec); assert.strictEqual(result.exportedAt, undefined);
});
t('records without ids dedupe by content', () => {
  const { report } = Core.plan({ notes: [{ t: 1 }, { t: 1 }, { t: 2 }], subjects: [], tasks: [] }, current, { mode: 'merge' });
  assert.strictEqual(report.totals.added, 2); assert.strictEqual(report.totals.duplicates, 1);
});
t('formatReport renders', () => {
  const { report } = Core.plan({ subjects: [{ id: 'n' }], tasks: [], profile: {} }, current, { mode: 'merge' });
  assert.match(Core.formatReport(report), /subjects: 1 in backup → 1 added/);
});
