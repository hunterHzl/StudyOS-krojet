/* StudyOS Android — import core.
 * Pure functions (no DOM, no storage) so they can be unit-tested in Node.
 *
 * Nothing here assumes how a backup file is laid out. It
 *   1. looks for the data object in the file (top level, or one level down),
 *   2. compares what it finds with the schema the app currently uses,
 *   3. builds a merged result + a report. It never mutates its inputs.
 * Records keep their ids, timestamps and every field exactly as they were in the backup.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StudyOSImportCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Collections / objects the current app (4.3.6) is known to use (taken from its normalize() and defaultData()).
  // At run time this is unioned with whatever keys the live data actually has.
  var KNOWN_ARRAYS = ['subjects', 'assessments', 'tasks', 'exams', 'sessions', 'topics', 'notes', 'events',
    'flashcards', 'mistakes', 'formulas', 'pastPapers', 'mindMaps'];
  var KNOWN_OBJECTS = ['profile', 'settings', 'timetable'];
  // Written by the export function, not user data.
  var META_KEYS = ['exportedAt', 'format'];
  var WRAPPER_KEYS = ['data', 'payload', 'backup', 'studyos', 'state', 'store'];

  function isPlain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function typeOf(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; }

  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (isPlain(v)) return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function deepEqual(a, b) { return canon(a) === canon(b); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function label(rec) {
    if (!isPlain(rec)) return String(rec);
    return String(rec.title || rec.name || rec.text || rec.id || '(untitled)').slice(0, 60);
  }
  function hasId(rec) { return isPlain(rec) && (typeof rec.id === 'string' || typeof rec.id === 'number') && String(rec.id) !== ''; }

  function schemaKeys(current) {
    var s = {};
    KNOWN_ARRAYS.concat(KNOWN_OBJECTS).forEach(function (k) { s[k] = true; });
    if (isPlain(current)) Object.keys(current).forEach(function (k) { s[k] = true; });
    return s;
  }

  /** Finds the object holding the StudyOS data inside a parsed file. Returns {payload, path} or null. */
  function locatePayload(parsed, current) {
    if (!isPlain(parsed)) return null;
    var known = schemaKeys(current);
    function score(o) {
      if (!isPlain(o)) return 0;
      return Object.keys(o).filter(function (k) { return known[k] && META_KEYS.indexOf(k) < 0; }).length;
    }
    var best = { payload: parsed, path: '(top level)', s: score(parsed) };
    WRAPPER_KEYS.forEach(function (k) {
      var s = score(parsed[k]);
      if (s > best.s) best = { payload: parsed[k], path: k, s: s };
    });
    return best.s >= 2 ? { payload: best.payload, path: best.path } : null;
  }

  function expectedKind(key, current) {
    if (isPlain(current) && current[key] !== undefined) return typeOf(current[key]);
    if (KNOWN_ARRAYS.indexOf(key) >= 0) return 'array';
    if (KNOWN_OBJECTS.indexOf(key) >= 0) return 'object';
    return null;
  }

  function newReport(mode, preferBackup, location) {
    return {
      ok: true, location: location, mode: mode, preferBackup: !!preferBackup, meta: {},
      collections: [], objects: [], scalars: [], unknownKeys: [], typeMismatches: [], missingInBackup: [], warnings: [],
      totals: { added: 0, duplicates: 0, conflicts: 0, skipped: 0 }
    };
  }

  function mergeArray(key, backupArr, currentArr, preferBackup) {
    var out = clone(currentArr) || [];
    var byId = {}, seen = {};
    out.forEach(function (r, i) { if (hasId(r)) byId[String(r.id)] = i; seen[canon(r)] = true; });
    var c = { key: key, backup: backupArr.length, added: 0, duplicates: 0, conflicts: [], replaced: 0, skipped: [] };
    backupArr.forEach(function (rec, idx) {
      if (rec === null || rec === undefined || rec === false || rec === '') { c.skipped.push({ index: idx, reason: 'empty entry' }); return; }
      var copy = clone(rec);
      if (hasId(rec)) {
        var id = String(rec.id);
        if (byId[id] !== undefined) {
          if (deepEqual(out[byId[id]], rec)) { c.duplicates++; return; }
          c.conflicts.push({ id: id, label: label(rec) });
          if (preferBackup) { out[byId[id]] = copy; c.replaced++; }
          return;
        }
        byId[id] = out.length; seen[canon(rec)] = true; out.push(copy); c.added++;
      } else {
        var k = canon(rec);
        if (seen[k]) { c.duplicates++; return; }
        seen[k] = true; out.push(copy); c.added++;
      }
    });
    return { value: out, summary: c };
  }

  function mergeObject(key, backupObj, currentObj, preferBackup) {
    var out = clone(currentObj) || {};
    var s = { key: key, fieldsAdded: [], fieldsSame: 0, conflicts: [], replaced: 0 };
    Object.keys(backupObj).forEach(function (f) {
      if (out[f] === undefined) { out[f] = clone(backupObj[f]); s.fieldsAdded.push(f); return; }
      if (deepEqual(out[f], backupObj[f])) { s.fieldsSame++; return; }
      s.conflicts.push(f);
      if (preferBackup) { out[f] = clone(backupObj[f]); s.replaced++; }
    });
    return { value: out, summary: s };
  }

  /**
   * plan(payload, current, {mode:'merge'|'replace', preferBackup:boolean, location})
   * Returns {result, report}. `current` may be null/undefined (nothing stored yet).
   */
  function plan(payload, current, opts) {
    opts = opts || {};
    var mode = opts.mode === 'replace' ? 'replace' : 'merge';
    var prefer = !!opts.preferBackup || mode === 'replace';
    var report = newReport(mode, prefer, opts.location || '(top level)');
    var cur = isPlain(current) ? current : {};
    var known = schemaKeys(cur);
    var result;

    if (mode === 'replace') { result = {}; } else { result = clone(cur); }

    Object.keys(payload).forEach(function (key) {
      var bv = payload[key];
      if (META_KEYS.indexOf(key) >= 0) { report.meta[key] = bv; return; }

      if (!known[key]) {
        // Not used by this version of the app: kept exactly as-is so nothing is thrown away.
        result[key] = clone(bv);
        report.unknownKeys.push({ key: key, type: typeOf(bv), size: Array.isArray(bv) ? bv.length : (isPlain(bv) ? Object.keys(bv).length : null) });
        return;
      }

      var expect = expectedKind(key, cur);
      var got = typeOf(bv);
      if (expect && expect !== got && !(expect === 'object' && got === 'object')) {
        report.typeMismatches.push({ key: key, expected: expect, got: got });
        report.totals.skipped += 1;
        return; // keep whatever is on the device
      }

      if (got === 'array') {
        if (mode === 'replace') {
          var rc = { key: key, backup: bv.length, added: 0, duplicates: 0, conflicts: [], replaced: 0, skipped: [] };
          result[key] = [];
          bv.forEach(function (r, i) {
            if (r === null || r === undefined || r === false || r === '') { rc.skipped.push({ index: i, reason: 'empty entry' }); return; }
            result[key].push(clone(r)); rc.added++;
          });
          report.collections.push(rc);
        } else {
          var m = mergeArray(key, bv, Array.isArray(cur[key]) ? cur[key] : [], prefer);
          result[key] = m.value; report.collections.push(m.summary);
        }
      } else if (got === 'object') {
        if (mode === 'replace') {
          result[key] = clone(bv);
          report.objects.push({ key: key, fieldsAdded: Object.keys(bv), fieldsSame: 0, conflicts: [], replaced: 0 });
        } else {
          var o = mergeObject(key, bv, isPlain(cur[key]) ? cur[key] : {}, prefer);
          result[key] = o.value; report.objects.push(o.summary);
        }
      } else {
        // scalar at top level
        var had = cur[key] !== undefined;
        if (mode === 'replace' || !had || prefer) { result[key] = clone(bv); report.scalars.push({ key: key, took: 'backup' }); }
        else report.scalars.push({ key: key, took: 'existing' });
      }
    });

    if (mode === 'replace') {
      KNOWN_ARRAYS.concat(KNOWN_OBJECTS).forEach(function (k) {
        if (payload[k] === undefined) report.missingInBackup.push(k);
      });
      if (report.missingInBackup.length) {
        report.warnings.push('The backup does not contain: ' + report.missingInBackup.join(', ') +
          '. StudyOS fills those with its built-in defaults (which can include sample data). Use Merge to avoid this.');
      }
    }

    report.collections.forEach(function (c) {
      report.totals.added += c.added;
      report.totals.duplicates += c.duplicates;
      report.totals.conflicts += c.conflicts.length;
      report.totals.skipped += c.skipped.length;
    });
    return { result: result, report: report };
  }

  /** Quick structural summary of a parsed file, before any decision is made. */
  function inspect(parsed, current) {
    var loc = locatePayload(parsed, current);
    var info = { recognised: !!loc, location: loc ? loc.path : null, topLevel: [], format: null, exportedAt: null };
    if (isPlain(parsed)) {
      Object.keys(parsed).forEach(function (k) {
        var v = parsed[k];
        info.topLevel.push({ key: k, type: typeOf(v), size: Array.isArray(v) ? v.length : (isPlain(v) ? Object.keys(v).length : null) });
      });
      var holder = loc ? loc.payload : parsed;
      info.format = typeof holder.format === 'string' ? holder.format : (typeof parsed.format === 'string' ? parsed.format : null);
      info.exportedAt = typeof holder.exportedAt === 'string' ? holder.exportedAt : (typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null);
    }
    info.payload = loc ? loc.payload : null;
    return info;
  }

  /** Plain-text report, suitable for display or copying. */
  function formatReport(r) {
    var L = [];
    L.push('StudyOS import report');
    L.push('Mode: ' + (r.mode === 'replace' ? 'Replace everything with the backup' :
      (r.preferBackup ? 'Merge (backup wins when a record differs)' : 'Merge (existing data wins when a record differs)')));
    L.push('Data found in file at: ' + r.location);
    if (r.meta && r.meta.format) L.push('Backup format: ' + r.meta.format);
    if (r.meta && r.meta.exportedAt) L.push('Exported at: ' + r.meta.exportedAt);
    L.push('');
    r.collections.forEach(function (c) {
      var line = c.key + ': ' + c.backup + ' in backup → ' + c.added + ' added';
      if (c.duplicates) line += ', ' + c.duplicates + ' already present';
      if (c.conflicts.length) line += ', ' + c.conflicts.length + ' differed (' + (r.preferBackup ? c.replaced + ' replaced by backup' : 'kept existing') + ')';
      if (c.skipped.length) line += ', ' + c.skipped.length + ' could not be imported (empty entries)';
      L.push(line);
    });
    r.objects.forEach(function (o) {
      var line = o.key + ': ' + o.fieldsAdded.length + ' field(s) added';
      if (o.conflicts.length) line += ', ' + o.conflicts.length + ' differed [' + o.conflicts.join(', ') + '] (' + (r.preferBackup ? 'backup used' : 'kept existing') + ')';
      L.push(line);
    });
    if (r.unknownKeys.length) {
      L.push('');
      L.push('Not used by this version of StudyOS (kept as-is, not discarded): ' + r.unknownKeys.map(function (u) { return u.key + ' (' + u.type + ')'; }).join(', '));
    }
    if (r.typeMismatches.length) {
      L.push('');
      L.push('Could NOT be migrated (wrong type, existing data kept): ' + r.typeMismatches.map(function (t) { return t.key + ' is ' + t.got + ', expected ' + t.expected; }).join('; '));
    }
    r.warnings.forEach(function (w) { L.push(''); L.push('Warning: ' + w); });
    L.push('');
    L.push('Totals: ' + r.totals.added + ' added, ' + r.totals.duplicates + ' duplicates skipped, ' + r.totals.conflicts + ' conflicts, ' + r.totals.skipped + ' not migrated.');
    return L.join('\n');
  }

  return {
    KNOWN_ARRAYS: KNOWN_ARRAYS, KNOWN_OBJECTS: KNOWN_OBJECTS, META_KEYS: META_KEYS,
    locatePayload: locatePayload, inspect: inspect, plan: plan, formatReport: formatReport,
    deepEqual: deepEqual, canon: canon
  };
});
