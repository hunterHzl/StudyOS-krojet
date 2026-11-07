/* StudyOS Android music: tiny IndexedDB key/value store + bounded caches.
 * Music data lives here, never in localStorage, so it cannot compete with the main StudyOS data for space. */
(function () {
  'use strict';
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var r = indexedDB.open('studyos-android', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
    return dbp;
  }
  function get(k) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var q = d.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error); };
      });
    }).catch(function () { return undefined; });
  }
  function set(k, v) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function () { return false; });
  }
  function del(k) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(k);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }
  // keeps the most recent `max` entries of a namespace
  function cachePut(ns, key, value, max) {
    var idxKey = 'idx:' + ns;
    return get(idxKey).then(function (idx) {
      idx = Array.isArray(idx) ? idx.filter(function (k) { return k !== key; }) : [];
      idx.push(key);
      var drop = idx.length > max ? idx.splice(0, idx.length - max) : [];
      return set(ns + ':' + key, value)
        .then(function () { return Promise.all(drop.map(function (k) { return del(ns + ':' + k); })); })
        .then(function () { return set(idxKey, idx); });
    });
  }
  function cacheGet(ns, key) { return get(ns + ':' + key); }
  window.StudyOSKV = { get: get, set: set, del: del, cachePut: cachePut, cacheGet: cacheGet };
})();
