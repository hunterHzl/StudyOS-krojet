/* StudyOS Android — boot.
 * Replaces the plain <script src="app.js"> tag in the Android build. It never edits app.js.
 *
 * What it does (native Android only, unless noted):
 *   - detects the Capacitor shell and exposes window.StudyOSAndroid
 *   - keeps the web app's own storage (localStorage "studyos.v1.data") as the primary store, and mirrors every
 *     save to an atomic file in the app's private storage (a safety copy, never the primary store)
 *   - if app storage is EMPTY but a safety copy exists (Android cleared WebView data), ASKS before restoring it
 *   - stops the old service worker from serving cached files inside the packaged app
 *   - then loads app.js, the import assistant, the music layer and the Android features
 * If anything in the Android layer fails, app.js still loads.
 */
(function () {
  'use strict';

  var STORE_KEY = 'studyos.v1.data';
  var DECLINED_KEY = 'studyos.android.declinedRestore';
  var cap = window.Capacitor;
  var native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());

  var origGet = Storage.prototype.getItem;
  var origSet = Storage.prototype.setItem;
  var origRemove = Storage.prototype.removeItem;

  var plugin = null;
  if (native) {
    try { plugin = (cap.Plugins && cap.Plugins.StudyOSNative) || cap.registerPlugin('StudyOSNative'); } catch (e) { plugin = null; }
  }

  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function N(method, args) {
    if (!plugin || typeof plugin[method] !== 'function') return Promise.reject(new Error('native plugin unavailable'));
    return plugin[method](args || {});
  }

  var state = { blocked: false, timer: null, lastWritten: null };

  function stamp() { return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); }
  function today() { return new Date().toISOString().slice(0, 10).replace(/-/g, ''); }

  function flushMirror() {
    if (!native || !plugin) return Promise.resolve();
    var v = origGet.call(localStorage, STORE_KEY);
    if (v == null || v === state.lastWritten) return Promise.resolve();
    state.lastWritten = v;
    return N('safetyWrite', { name: 'current.json', content: v }).then(function () {
      // one dated copy per day, last 7 kept
      var name = 'daily-' + today() + '.json';
      return N('safetyArchive', { name: 'current.json', as: name }).then(function () {
        return N('safetyPrune', { prefix: 'daily-', keep: 7 });
      });
    }).catch(function () { state.lastWritten = null; });
  }

  function scheduleMirror() {
    clearTimeout(state.timer);
    state.timer = setTimeout(flushMirror, 1200);
  }

  Storage.prototype.setItem = function (k, v) {
    if (this === window.localStorage && k === STORE_KEY) {
      if (state.blocked) return; // an import is in progress: do not let the old in-memory copy overwrite it
      var r = origSet.apply(this, arguments);
      if (native && plugin) scheduleMirror();
      return r;
    }
    return origSet.apply(this, arguments);
  };

  if (native && plugin) {
    Storage.prototype.removeItem = function (k) {
      if (this === window.localStorage && k === STORE_KEY) {
        // The app asked to delete its data on purpose. Keep one archived copy; do not let the next launch "restore" it.
        N('safetyArchive', { name: 'current.json', as: 'removed-' + stamp() + '.json' })
          .then(function () { return N('safetyWrite', { name: 'current.json', content: '{}' }); })
          .then(function () { return N('safetyPrune', { prefix: 'removed-', keep: 3 }); })
          .catch(function () {});
      }
      return origRemove.apply(this, arguments);
    };
    document.addEventListener('visibilitychange', function () { if (document.hidden) flushMirror(); });
    window.addEventListener('pagehide', flushMirror);
  }

  // ---- public surface for the other Android scripts ----
  window.StudyOSAndroid = {
    native: native,
    storeKey: STORE_KEY,
    call: N,
    hasPlugin: !!plugin,
    plugin: plugin,
    rawGet: function (k) { return origGet.call(localStorage, k); },
    rawSet: function (k, v) { return origSet.call(localStorage, k, v); },
    blockAppWrites: function () { state.blocked = true; },
    flushMirror: flushMirror,
    stamp: stamp
  };

  // ---- restore prompt ----
  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text) e.textContent = text;
    return e;
  }

  function askRestore(info) {
    return new Promise(function (resolve) {
      var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
      var bg = dark ? '#1d1b20' : '#ffffff', fg = dark ? '#e6e0e9' : '#1d1b20', mut = dark ? '#cac4d0' : '#625b71';
      var wrap = el('div', 'position:fixed;inset:0;z-index:100000;background:rgba(10,8,14,.62);display:grid;place-items:center;padding:20px;font-family:system-ui,sans-serif');
      var box = el('div', 'width:min(420px,100%);background:' + bg + ';color:' + fg + ';border-radius:24px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.4)');
      box.appendChild(el('h2', 'margin:0 0 8px;font-size:19px', 'Restore your StudyOS data?'));
      box.appendChild(el('p', 'margin:0 0 10px;font-size:14px;line-height:1.5;color:' + mut,
        'StudyOS found a safety copy of your data saved on this device on ' + info.when + '. The app’s own storage is empty, which can happen if Android cleared the app’s data.'));
      box.appendChild(el('p', 'margin:0 0 16px;font-size:13px;line-height:1.5;color:' + mut, info.summary));
      var row = el('div', 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap');
      var no = el('button', 'padding:11px 16px;border-radius:100px;border:1px solid ' + mut + ';background:transparent;color:' + fg + ';font:600 14px system-ui', 'Start fresh');
      var yes = el('button', 'padding:11px 18px;border-radius:100px;border:0;background:#304a35;color:#fff;font:700 14px system-ui', 'Restore my data');
      no.onclick = function () { wrap.remove(); resolve(false); };
      yes.onclick = function () { wrap.remove(); resolve(true); };
      row.appendChild(no); row.appendChild(yes); box.appendChild(row);
      wrap.appendChild(box); document.body.appendChild(wrap);
    });
  }

  function summarize(parsed) {
    var keys = [['subjects', 'subjects'], ['tasks', 'tasks'], ['sessions', 'study sessions'], ['notes', 'notes'], ['mindMaps', 'mind maps'], ['pastPapers', 'past papers']];
    var parts = [];
    keys.forEach(function (p) { if (Array.isArray(parsed[p[0]]) && parsed[p[0]].length) parts.push(parsed[p[0]].length + ' ' + p[1]); });
    return parts.length ? 'Contains ' + parts.join(', ') + '.' : '';
  }

  function checkRecovery() {
    if (!native || !plugin) return Promise.resolve();
    if (origGet.call(localStorage, STORE_KEY) != null) return Promise.resolve(); // data exists: nothing to restore
    return withTimeout(N('safetyRead', { name: 'current.json' }), 3500).then(function (snap) {
      if (!snap || !snap.exists) return;
      var parsed;
      try { parsed = JSON.parse(snap.content); } catch (e) { return; }
      if (!parsed || !Array.isArray(parsed.subjects) || !parsed.profile) return;
      if (origGet.call(localStorage, DECLINED_KEY) === String(snap.modified)) return;
      return askRestore({ when: new Date(snap.modified).toLocaleString(), summary: summarize(parsed) }).then(function (yes) {
        if (yes) {
          origSet.call(localStorage, STORE_KEY, snap.content);
          state.lastWritten = snap.content;
        } else {
          origSet.call(localStorage, DECLINED_KEY, String(snap.modified));
          // keep the old copy: the next save would otherwise replace it
          return N('safetyArchive', { name: 'current.json', as: 'declined-' + stamp() + '.json' }).catch(function () {});
        }
      });
    }).catch(function () { /* never block start-up */ });
  }

  // ---- service worker: not wanted inside the packaged app (assets already ship with the APK) ----
  if (native && 'serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });
      if (window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); });
      navigator.serviceWorker.register = function () { return Promise.resolve(); };
    } catch (e) { /* ignore */ }
  }

  // ---- script loading ----
  function load(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(true); };
      s.onerror = function () { console.error('StudyOS: could not load ' + src); resolve(false); };
      document.body.appendChild(s);
    });
  }

  function start() {
    // music modules first (they only define APIs; the widget in app.js polls them immediately), then the app, then UI layers
    var pre = ['android/music-kv.js', 'android/music-session.js', 'android/music-art.js', 'android/music-lyrics.js', 'android/android-import-core.js'];
    var post = ['android/music-widget.js', 'android/android-features.js'];
    function seq(list) { return list.reduce(function (p, src) { return p.then(function () { return load(src); }); }, Promise.resolve()); }
    return seq(pre).then(function () { return load('app.js'); }).then(function (ok) { if (ok) return seq(post); });
  }

  var go = native ? checkRecovery().then(start, start) : start();
  go.catch(function (e) { console.error('StudyOS boot error', e); });
})();
