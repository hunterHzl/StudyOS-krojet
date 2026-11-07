/* StudyOS Android — features layered on top of the unchanged web app.
 *   1. clear offline / back-online status
 *   2. Android system Back button behaviour
 *   3. JSON backup "save as" (WebView cannot download blob: links by itself)
 *   4. Import Assistant (Settings): inspects ANY backup file, previews, takes safety copies, merges, reports
 *   5. system bar colours that follow the chosen theme/accent
 * Everything here is additive; it never edits app.js code and never writes StudyOS data without confirmation.
 */
(function () {
  'use strict';
  var A = window.StudyOSAndroid || { native: false, storeKey: 'studyos.v1.data', rawGet: function (k) { return localStorage.getItem(k); }, rawSet: function (k, v) { localStorage.setItem(k, v); }, call: function () { return Promise.reject(new Error('no native')); }, blockAppWrites: function () {}, flushMirror: function () { return Promise.resolve(); }, stamp: function () { return String(Date.now()); } };
  var Core = window.StudyOSImportCore;
  var native = !!A.native;
  var cap = window.Capacitor;
  var REPORT_KEY = 'studyos.android.lastImportReport';

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ------------------------------------------------------------------ small toast (independent of the app's own)
  var toastEl, toastT;
  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'aos-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 3200);
  }

  // ------------------------------------------------------------------ 1. offline / online status
  var bar;
  var backT;
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'aosOffline';
    bar.setAttribute('role', 'status');
    bar.hidden = true;
    var main = $('.main-area');
    var content = $('#content');
    if (main && content) main.insertBefore(bar, content); else document.body.prepend(bar);
    return bar;
  }
  function updateOnline(initial) {
    var online = navigator.onLine !== false;
    document.documentElement.classList.toggle('aos-offline', !online);
    var b = ensureBar();
    clearTimeout(backT);
    if (!online) {
      b.className = 'aos-offline-bar';
      b.innerHTML = '<strong>Offline.</strong> Planner, notes, mind maps, timer, grades and settings all keep working. Lyrics, cover-art lookups and web links need an internet connection.';
      b.hidden = false;
    } else if (!initial && !b.hidden) {
      b.className = 'aos-offline-bar back';
      b.innerHTML = '<strong>Back online.</strong>';
      backT = setTimeout(function () { b.hidden = true; }, 2500);
    } else {
      b.hidden = true;
    }
  }
  window.addEventListener('online', function () { updateOnline(false); });
  window.addEventListener('offline', function () { updateOnline(false); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="http"]');
    if (a && navigator.onLine === false) {
      e.preventDefault();
      toast('That link needs an internet connection.');
    }
  }, true);

  // ------------------------------------------------------------------ 2. Android Back button
  function clickIf(el) { if (el) { el.click(); return true; } return false; }
  function handleBack() {
    var confirmRoot = document.getElementById('confirmRoot');
    if (confirmRoot) {
      var cancel = Array.prototype.find.call(confirmRoot.querySelectorAll('button'), function (b) { return /cancel|no|close/i.test(b.textContent); });
      if (!clickIf(cancel)) confirmRoot.remove();
      return;
    }
    var report = document.getElementById('aosReportDialog');
    if (report) { report.remove(); return; }
    var modal = $('#modalRoot .modal');
    if (modal) {
      if (!clickIf(modal.querySelector('[data-action="close-modal"]'))) $('#modalRoot').innerHTML = '';
      return;
    }
    var pop = document.getElementById('nowPlayingPopover');
    if (pop && !pop.hidden) { clickIf(document.getElementById('nowPlayingTrigger')); return; }
    var overlay = document.getElementById('sidebarOverlay');
    if (overlay) { overlay.remove(); return; }
    var mmBack = $('.mm-head-title [data-view="tools"]');
    if (mmBack) { mmBack.click(); return; }
    var crumb = document.getElementById('pageCrumb');
    if (crumb && !/^home$/i.test(crumb.textContent.trim())) { clickIf($('.brand-home')); return; }
    // At Home: send the app to the background (music keeps playing) instead of killing it.
    var App = cap && cap.Plugins && cap.Plugins.App;
    if (App && App.minimizeApp) App.minimizeApp().catch(function () { if (App.exitApp) App.exitApp(); });
    else if (App && App.exitApp) App.exitApp();
  }
  if (native && cap && cap.Plugins && cap.Plugins.App) {
    try { cap.Plugins.App.addListener('backButton', handleBack); } catch (e) { /* default back behaviour remains */ }
  }

  // ------------------------------------------------------------------ 3. JSON backup "save as"
  function blobToPayload(blob) {
    var textual = /json|text|csv|xml/i.test(blob.type) || !blob.type;
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(fr.error); };
      if (textual) { fr.onload = function () { resolve({ text: fr.result }); }; fr.readAsText(blob); }
      else { fr.onload = function () { resolve({ base64: String(fr.result).split(',')[1] || '' }); }; fr.readAsDataURL(blob); }
    });
  }
  function interceptDownload(a) {
    var name = a.getAttribute('download') || 'studyos-backup.json';
    fetch(a.href).then(function (r) { return r.blob(); }).then(function (blob) {
      return blobToPayload(blob).then(function (p) {
        var args = { filename: name, mime: blob.type || 'application/json' };
        if (p.text != null) args.text = p.text; else args.base64 = p.base64;
        return A.call('exportFile', args);
      });
    }).then(function (res) {
      toast(res && res.saved ? 'Saved “' + name + '”.' : 'Save cancelled. No file was created.', 4000);
    }).catch(function () {
      toast('Could not save the file. Nothing was exported.', 5000);
    });
  }
  if (native && A.hasPlugin) {
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download') && /^blob:/.test(this.href)) { interceptDownload(this); return; }
      return origClick.apply(this, arguments);
    };
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[download]');
      if (a && /^blob:/.test(a.href)) { e.preventDefault(); interceptDownload(a); }
    }, true);
  }

  // ------------------------------------------------------------------ 5. system bar colours
  function parseRgb(s) {
    var m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(s || '');
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  var chromeT, lastChrome = '';
  function applyChrome() {
    if (!native || !A.hasPlugin) return;
    var rgb = parseRgb(getComputedStyle($('.topbar') || document.body).backgroundColor) ||
      parseRgb(getComputedStyle(document.body).backgroundColor) || [250, 248, 252];
    var hex = '#' + rgb.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
    var lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    var key = hex + (lum > 0.5);
    if (key === lastChrome) return;
    lastChrome = key;
    A.call('setChrome', { color: hex, lightBackground: lum > 0.5 }).catch(function () {});
  }
  function scheduleChrome() { clearTimeout(chromeT); chromeT = setTimeout(applyChrome, 150); }
  if (native) {
    new MutationObserver(scheduleChrome).observe(document.documentElement, { attributes: true });
    if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleChrome); } catch (e) { /* old webview */ } }
    setTimeout(applyChrome, 400);
    setTimeout(applyChrome, 2500); // after the intro splash
  }

  // ------------------------------------------------------------------ 4. Import Assistant
  var st = { text: '', parsed: null, info: null, current: null, plan: null, sourceLabel: '' };

  function readCurrent() {
    var raw = A.rawGet(A.storeKey);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function card() { return document.getElementById('aosImportCard'); }

  function insertCard() {
    var grid = $('.settings-grid');
    if (!grid || card()) return;
    var sec = document.createElement('section');
    sec.className = 'panel settings-card';
    sec.id = 'aosImportCard';
    sec.innerHTML =
      '<h2>Import assistant</h2>' +
      '<p>Bring in a StudyOS backup (.json) from the website or another device. The file is inspected first, you see exactly what would change, ' +
      'and a safety copy of your current data is saved before anything is written.</p>' +
      '<div class="aos-actions"><button type="button" class="button primary" data-aos="choose">Choose backup file…</button>' +
      '<input type="file" id="aosFile" accept=".json,application/json,text/plain" hidden></div>' +
      '<div id="aosImportBody" aria-live="polite"></div>' +
      '<div id="aosLast"></div>' +
      '<div id="aosSafety"></div>' +
      '<p class="aos-foot" id="aosBuild"></p>';
    grid.appendChild(sec);
    renderLast();
    renderSafety();
    buildInfo();
  }

  function buildInfo() {
    var el = document.getElementById('aosBuild');
    if (!el) return;
    if (native && A.hasPlugin) {
      A.call('getStatus').then(function (s) {
        el.textContent = 'Android build ' + (s.versionName || '') + ' · Android API ' + s.sdk + ' · Developed by HunterHz';
      }).catch(function () { el.textContent = 'Developed by HunterHz'; });
    } else el.textContent = 'Developed by HunterHz';
  }

  function renderLast() {
    var host = document.getElementById('aosLast');
    if (!host) return;
    var raw = A.rawGet(REPORT_KEY), r = null;
    try { r = raw ? JSON.parse(raw) : null; } catch (e) { r = null; }
    host.innerHTML = r ? '<details class="aos-details"><summary>Last import report · ' + esc(new Date(r.when).toLocaleString()) + '</summary><pre class="aos-pre">' + esc(r.text) + '</pre></details>' : '';
  }

  function renderSafety() {
    var host = document.getElementById('aosSafety');
    if (!host) return;
    if (!native || !A.hasPlugin) { host.innerHTML = ''; return; }
    A.call('safetyList').then(function (res) {
      var files = (res.files || []).filter(function (f) { return /\.json(\.prev)?$/.test(f.name); }).sort(function (a, b) { return b.modified - a.modified; });
      if (!files.length) { host.innerHTML = '<p class="aos-foot">No safety copies yet. One is written automatically after your data first changes.</p>'; return; }
      host.innerHTML = '<details class="aos-details"><summary>Safety copies on this device (' + files.length + ')</summary>' +
        '<p class="aos-foot">Automatic copies kept in the app’s private storage. “Review” loads one into the import assistant; nothing changes until you confirm.</p>' +
        files.map(function (f) {
          return '<div class="aos-file"><div><strong>' + esc(f.name) + '</strong><small>' + esc(new Date(f.modified).toLocaleString()) + ' · ' + Math.max(1, Math.round(f.size / 1024)) + ' KB</small></div>' +
            '<button type="button" class="button tonal small" data-aos="review" data-name="' + esc(f.name) + '">Review</button></div>';
        }).join('') + '</details>';
    }).catch(function () { host.innerHTML = ''; });
  }

  function body() { return document.getElementById('aosImportBody'); }

  function showError(msg) {
    var b = body();
    if (b) b.innerHTML = '<div class="aos-msg err"><strong>Nothing was changed.</strong> ' + esc(msg) + '</div>';
  }

  function handleText(text, label) {
    st = { text: text, parsed: null, info: null, current: readCurrent(), plan: null, sourceLabel: label };
    if (!Core) { showError('Import logic failed to load.'); return; }
    try { st.parsed = JSON.parse(text); }
    catch (e) { showError('“' + label + '” is not valid JSON (' + e.message + ').'); return; }
    st.info = Core.inspect(st.parsed, st.current);
    renderInspection();
  }

  function renderInspection() {
    var b = body(), info = st.info, cur = st.current;
    if (!b) return;
    var rows = info.topLevel.map(function (t) {
      var known = Core.KNOWN_ARRAYS.indexOf(t.key) >= 0 || Core.KNOWN_OBJECTS.indexOf(t.key) >= 0 || (cur && cur[t.key] !== undefined);
      var tag = Core.META_KEYS.indexOf(t.key) >= 0 ? 'info' : (known ? 'used' : 'unknown');
      return '<tr><td>' + esc(t.key) + '</td><td>' + esc(t.type) + (t.size != null ? ' · ' + t.size : '') + '</td><td><span class="aos-tag ' + tag + '">' +
        (tag === 'used' ? 'recognised' : tag === 'info' ? 'file info' : 'not used by this version') + '</span></td></tr>';
    }).join('');
    var html = '<div class="aos-msg"><strong>' + esc(st.sourceLabel) + '</strong> · ' + Math.max(1, Math.round(st.text.length / 1024)) + ' KB' +
      (info.format ? ' · ' + esc(info.format) : '') + (info.exportedAt ? ' · exported ' + esc(new Date(info.exportedAt).toLocaleString()) : '') + '</div>' +
      '<div class="aos-scroll"><table class="aos-table"><thead><tr><th>Found in file</th><th>Type</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    if (!info.recognised) {
      html += '<div class="aos-msg err"><strong>No StudyOS data recognised.</strong> None of the expected sections (subjects, tasks, sessions, notes…) were found at the top level or one level down, so nothing can be imported from this file. Nothing was changed.</div>';
      b.innerHTML = html; return;
    }
    html += '<p class="aos-foot">Data located at: <strong>' + esc(info.location) + '</strong>. ' +
      (cur ? 'This device already has saved StudyOS data.' : 'This device has no saved StudyOS data yet, so nothing can be overwritten.') + '</p>' +
      '<fieldset class="aos-modes"><legend>How should it be applied?</legend>' +
      '<label><input type="radio" name="aosMode" value="merge-keep" checked> <span><strong>Merge, keep what is on this device</strong><small>Adds records that are missing. If the same record exists but differs, the device version stays.</small></span></label>' +
      '<label><input type="radio" name="aosMode" value="merge-backup"> <span><strong>Merge, prefer the backup</strong><small>Adds missing records. If the same record differs, the backup version is used.</small></span></label>' +
      '<label><input type="radio" name="aosMode" value="replace"> <span><strong>Replace everything with the backup</strong><small>Same as the website’s import. Your current data is safety-copied first.</small></span></label></fieldset>' +
      '<div id="aosPreview"></div>';
    b.innerHTML = html;
    renderPreview();
  }

  function selectedMode() {
    var r = document.querySelector('input[name="aosMode"]:checked');
    return r ? r.value : 'merge-keep';
  }

  function renderPreview() {
    var host = document.getElementById('aosPreview');
    if (!host) return;
    var m = selectedMode();
    st.plan = Core.plan(st.info.payload, st.current, { mode: m === 'replace' ? 'replace' : 'merge', preferBackup: m === 'merge-backup', location: st.info.location });
    var r = st.plan.report, cur = st.current || {};
    var rows = r.collections.map(function (c) {
      return '<tr><td>' + esc(c.key) + '</td><td>' + (Array.isArray(cur[c.key]) ? cur[c.key].length : 0) + '</td><td>' + c.backup + '</td><td>' + c.added + '</td><td>' + c.duplicates + '</td><td>' +
        c.conflicts.length + '</td><td>' + c.skipped.length + '</td></tr>';
    }).join('');
    var html = '<h3 class="aos-h">Preview <small>nothing has been changed yet</small></h3>' +
      '<div class="aos-scroll"><table class="aos-table"><thead><tr><th>Section</th><th>On device</th><th>In backup</th><th>Added</th><th>Already there</th><th>Differ</th><th>Not imported</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    r.objects.forEach(function (o) {
      html += '<p class="aos-foot"><strong>' + esc(o.key) + '</strong>: ' + o.fieldsAdded.length + ' setting(s) added' + (o.conflicts.length ? ', ' + o.conflicts.length + ' differ (' + esc(o.conflicts.join(', ')) + ') → ' + (r.preferBackup ? 'backup used' : 'device kept') : '') + '.</p>';
    });
    if (r.unknownKeys.length) html += '<p class="aos-foot">Kept as-is, not used by this version: ' + esc(r.unknownKeys.map(function (u) { return u.key; }).join(', ')) + '.</p>';
    if (r.typeMismatches.length) html += '<div class="aos-msg err"><strong>Cannot be migrated:</strong> ' + esc(r.typeMismatches.map(function (t) { return t.key + ' (is ' + t.got + ', expected ' + t.expected + ')'; }).join('; ')) + '. Existing data for these stays untouched.</div>';
    r.warnings.forEach(function (w) { html += '<div class="aos-msg warn">' + esc(w) + '</div>'; });
    var needAck = m === 'replace' || (r.preferBackup && r.totals.conflicts > 0);
    html += (needAck ? '<label class="aos-ack"><input type="checkbox" id="aosAck"> <span>I understand ' + (m === 'replace' ? 'this replaces' : 'this overwrites ' + r.totals.conflicts + ' differing record(s) in') + ' the data currently in the app. A safety copy is saved first.</span></label>' : '') +
      '<div class="aos-actions"><button type="button" class="button primary" data-aos="apply"' + (needAck ? ' disabled' : '') + '>Apply import</button>' +
      '<button type="button" class="button tonal" data-aos="cancel">Cancel</button></div>';
    host.innerHTML = html;
    host._needAck = needAck;
  }

  function safetyCopies(stampStr) {
    if (!native || !A.hasPlugin) {
      var cur = A.rawGet(A.storeKey);
      if (cur != null) { try { A.rawSet('studyos.preImportBackup', cur); } catch (e) { return Promise.reject(new Error('Not enough storage for a safety copy.')); } }
      return Promise.resolve();
    }
    return A.flushMirror().then(function () {
      var haveCurrent = A.rawGet(A.storeKey) != null;
      return (haveCurrent ? A.call('safetyArchive', { name: 'current.json', as: 'pre-import-' + stampStr + '.json' }) : Promise.resolve())
        .then(function () { return A.call('safetyWrite', { name: 'import-raw-' + stampStr + '.json', content: st.text }); })
        .then(function () { return A.call('safetyPrune', { prefix: 'pre-import-', keep: 5 }); })
        .then(function () { return A.call('safetyPrune', { prefix: 'import-raw-', keep: 5 }); });
    });
  }

  function applyImport() {
    var b = body();
    var res = st.plan, report = res.report, stampStr = A.stamp();
    var host = document.getElementById('aosPreview');
    if (host && host._needAck && !(document.getElementById('aosAck') || {}).checked) return;
    var btn = document.querySelector('[data-aos="apply"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
    var serialized;
    try { serialized = JSON.stringify(res.result); } catch (e) { showError('The merged data could not be built: ' + e.message); return; }

    safetyCopies(stampStr).then(function () {
      var before = A.rawGet(A.storeKey);
      try { A.rawSet(A.storeKey, serialized); }
      catch (e) {
        // quota or storage error: restore exactly what was there and report
        if (before != null) { try { A.rawSet(A.storeKey, before); } catch (e2) { /* nothing more to do */ } }
        throw new Error('Not enough storage space to write the imported data. Your existing data was left as it was.');
      }
      var check;
      try { check = JSON.parse(A.rawGet(A.storeKey)); } catch (e) { check = null; }
      var ok = check && Core.KNOWN_ARRAYS.every(function (k) { return !Array.isArray(res.result[k]) || (Array.isArray(check[k]) && check[k].length === res.result[k].length); });
      if (!ok) {
        if (before != null) A.rawSet(A.storeKey, before);
        throw new Error('Verification failed after writing. Your previous data was restored.');
      }
      A.rawSet(REPORT_KEY, JSON.stringify({ when: Date.now(), text: Core.formatReport(report), source: st.sourceLabel }));
      try { sessionStorage.setItem('aos.showReport', '1'); } catch (e) { /* ignore */ }
      A.blockAppWrites(); // the page reloads next; stop the old in-memory copy from overwriting what was just written
      return A.flushMirror();
    }).then(function () {
      if (b) b.innerHTML = '<div class="aos-msg ok"><strong>Import complete.</strong> Reloading StudyOS to load your data…</div>';
      setTimeout(function () { location.reload(); }, 500);
    }).catch(function (e) {
      showError(e && e.message ? e.message : 'The import could not be completed.');
    });
  }

  function showReportDialog() {
    var raw = A.rawGet(REPORT_KEY), r = null;
    try { r = raw ? JSON.parse(raw) : null; } catch (e) { r = null; }
    if (!r) return;
    var wrap = document.createElement('div');
    wrap.id = 'aosReportDialog';
    wrap.className = 'modal-backdrop aos-report-backdrop';
    wrap.innerHTML = '<section class="modal aos-report" role="dialog" aria-modal="true" aria-label="Import report"><h2>Import complete</h2>' +
      '<p class="aos-foot">Here is exactly what was imported. Anything that could not be migrated is listed.</p><pre class="aos-pre">' + esc(r.text) + '</pre>' +
      '<div class="aos-actions"><button type="button" class="button tonal" data-aos="copy">Copy report</button><button type="button" class="button primary" data-aos="close-report">Done</button></div></section>';
    wrap.addEventListener('click', function (e) {
      var t = e.target.closest('[data-aos]');
      if (!t) return;
      if (t.dataset.aos === 'close-report') wrap.remove();
      if (t.dataset.aos === 'copy') {
        (navigator.clipboard ? navigator.clipboard.writeText(r.text) : Promise.reject()).then(function () { toast('Report copied.'); }, function () { toast('Could not copy. Select the text and copy it.'); });
      }
    });
    document.body.appendChild(wrap);
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#aosImportCard [data-aos]');
    if (!t) return;
    var act = t.dataset.aos;
    if (act === 'choose') { var f = document.getElementById('aosFile'); if (f) { f.value = ''; f.click(); } }
    else if (act === 'apply') applyImport();
    else if (act === 'cancel') { var b = body(); if (b) b.innerHTML = ''; st = { text: '', parsed: null, info: null, current: null, plan: null, sourceLabel: '' }; }
    else if (act === 'review') {
      A.call('safetyRead', { name: t.dataset.name }).then(function (r) {
        if (!r || !r.exists) { showError('That copy could not be read.'); return; }
        handleText(r.content, t.dataset.name);
        var bb = body(); if (bb) bb.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }).catch(function () { showError('That copy could not be read.'); });
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'aosFile') {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) { showError('That file is larger than 25 MB, which is far bigger than a StudyOS backup.'); return; }
      var fr = new FileReader();
      fr.onerror = function () { showError('The file could not be read.'); };
      fr.onload = function () { handleText(String(fr.result), file.name); };
      fr.readAsText(file);
    } else if (e.target && e.target.name === 'aosMode') {
      renderPreview();
    } else if (e.target && e.target.id === 'aosAck') {
      var ap = document.querySelector('[data-aos="apply"]');
      if (ap) ap.disabled = !e.target.checked;
    }
  });

  // The Settings page is re-rendered by the app on every visit: add the card whenever it appears.
  var content = document.getElementById('content');
  if (content) {
    new MutationObserver(function () { insertCard(); }).observe(content, { childList: true, subtree: false });
    insertCard();
  }

  updateOnline(true);
  try {
    if (sessionStorage.getItem('aos.showReport') === '1') {
      sessionStorage.removeItem('aos.showReport');
      setTimeout(showReportDialog, 900);
    }
  } catch (e) { /* ignore */ }
  window.StudyOSAndroidUI = { handleText: handleText, handleBack: handleBack, toast: toast };
})();
