/* StudyOS Android music: artwork.
 *  1. Artwork from the player's own media session: fetched natively (cached on disk there) and handed to the widget once
 *     per track, so a cover that arrives a moment after the title is still picked up.
 *  2. If the player offers no artwork, the widget's existing online cover lookup (iTunes) is used; its result is
 *     stored on the device so previously seen covers still show offline.
 */
(function () {
  'use strict';
  var KV = window.StudyOSKV;
  var deliveredId = null;

  function deliver(state) {
    var M = window.StudyOSMedia;
    if (!M || !M.plugin || !state.hasArtwork) { deliveredId = null; return Promise.resolve(null); }
    if (state.artworkId === deliveredId) return Promise.resolve(null);
    return M.plugin.getArtwork().then(function (r) {
      if (r && r.data) { deliveredId = r.id; return { data: r.data, mime: r.mime || 'image/jpeg', id: r.id }; }
      return null;
    }).catch(function () { return null; });
  }

  // ---- remote cover lookups, cached on device ----
  var origFetch = window.fetch.bind(window);
  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function inline(txt) {
    var d;
    try { d = JSON.parse(txt); } catch (e) { return txt; }
    var item = d && d.results && d.results[0];
    if (!item || !item.artworkUrl100 || item.artworkUrl100.indexOf('data:') === 0) return txt;
    return origFetch(item.artworkUrl100.replace('100x100bb', '600x600bb'))
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) {
        if (!b || b.size > 600 * 1024) return txt;
        return blobToDataUrl(b).then(function (u) { item.artworkUrl100 = u; return JSON.stringify(d); });
      }).catch(function () { return txt; });
  }
  function json(body, status) { return new Response(body, { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/^https:\/\/itunes\.apple\.com\/search/.test(url)) return origFetch(input, init);
    var offline = navigator.onLine === false;
    return KV.cacheGet('itunes', url).then(function (c) {
      if (c && c.body) return json(c.body);                       // already looked up: no repeat download
      if (offline) throw new TypeError('Failed to fetch');
      return origFetch(input, init).then(function (r) {
        if (!r.ok) return r;
        return r.clone().text().then(function (txt) {
          return Promise.resolve(inline(txt)).then(function (out) {
            KV.cachePut('itunes', url, { t: Date.now(), body: out }, 300);
            return json(out);
          });
        });
      });
    });
  };

  window.StudyOSArt = { deliver: deliver };
})();
