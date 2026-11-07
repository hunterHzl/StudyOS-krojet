/* StudyOS Android music: LRCLIB lyrics cache.
 * The widget (app.js) still does the lookup, parsing, line highlighting and the mini lyric. This layer only makes the
 * requests cheaper and safer:
 *   - a track already looked up is served from the device, never downloaded again
 *   - "no lyrics" answers are remembered for 12 hours (so a missing track is not re-requested on every replay)
 *   - identical requests that are in flight at the same time share one download
 *   - offline: cached lyrics still work; otherwise the widget shows its normal "unavailable" message
 */
(function () {
  'use strict';
  var KV = window.StudyOSKV;
  var NEG_TTL = 12 * 3600 * 1000;
  var origFetch = window.fetch.bind(window);
  var inflight = {};

  function mk(c) { return new Response(c.body, { status: c.status || 200, headers: { 'Content-Type': 'application/json' } }); }
  function fresh(c) {
    var negative = c.status === 404 || String(c.body).trim() === '[]';
    return !negative || Date.now() - c.t < NEG_TTL;
  }

  function lookup(url, input, init) {
    return KV.cacheGet('lyrics', url).then(function (c) {
      if (c && fresh(c)) return mk(c);
      if (navigator.onLine === false) {
        if (c) return mk(c);
        throw new TypeError('Failed to fetch');
      }
      return origFetch(input, init).then(function (r) {
        if (r.ok || r.status === 404) {
          return r.clone().text().then(function (txt) {
            KV.cachePut('lyrics', url, { t: Date.now(), status: r.status, body: txt }, 400);
            return r;
          });
        }
        return r;
      }).catch(function (err) {
        if (c) return mk(c);
        throw err;
      });
    });
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/^https:\/\/lrclib\.net\/api\//.test(url)) return origFetch(input, init);
    if (!inflight[url]) {
      inflight[url] = lookup(url, input, init).then(function (r) { delete inflight[url]; return r; }, function (e) { delete inflight[url]; throw e; });
    }
    return inflight[url].then(function (r) { return r.clone(); });
  };
  window.StudyOSLyrics = { ttl: NEG_TTL };
})();
