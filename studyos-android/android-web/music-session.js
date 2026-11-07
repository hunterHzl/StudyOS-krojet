/* StudyOS Android music: media-session client.
 * Talks to the native "NowPlaying" plugin, which reads the ACTIVE ANDROID MEDIA SESSION of whatever music app is
 * playing (Spotify, YouTube Music, Poweramp, ...). StudyOS plays no audio itself.
 * Nothing here is simulated: if there is no access, no session, or a player lacks a control, that is reported as such.
 */
(function () {
  'use strict';
  var A = window.StudyOSAndroid;
  var cap = window.Capacitor;
  var P = null;
  if (A && A.native && cap) {
    try { P = (cap.Plugins && cap.Plugins.NowPlaying) || cap.registerPlugin('NowPlaying'); } catch (e) { P = null; }
  }

  var pollListeners = [], changeListeners = [];
  var M = { available: !!P, plugin: P, last: null };

  function fire(list, arg) { list.forEach(function (cb) { try { cb(arg); } catch (e) { /* listener errors must not break polling */ } }); }

  /** Result shape the Now Playing widget understands (see the Android patch of npPoll). */
  M.poll = function () {
    if (!P) { M.last = { status: 'unavailable' }; fire(pollListeners, M.last); return Promise.resolve(M.last); }
    return P.getNowPlaying().then(function (s) {
      if (!s.granted) return { status: 'no-access', access: s };
      if (!s.hasSession) return { status: 'no-session', access: s };
      var base = { label: s.label, pkg: s.package, access: s, caps: s.caps || {}, volume: s.volume || {} };
      if (!s.title && !s.artist && !s.album) { base.status = 'idle'; return base; }
      base.status = 'ok';
      base.connected = true;
      base.playbackState = s.playbackState;
      base.position = s.position;
      base.duration = s.duration;
      base.track = { title: s.title, artist: s.artist, album: s.album };
      base.hasArtwork = !!s.hasArtwork;
      var art = window.StudyOSArt ? window.StudyOSArt.deliver(s) : Promise.resolve(null);
      return art.then(function (a) {
        if (a) { base.artwork = a.data; base.artworkMime = a.mime; base.artworkId = a.id; }
        return base;
      });
    }).catch(function () { return { status: 'error' }; }).then(function (o) {
      M.last = o;
      fire(pollListeners, o);
      return o;
    });
  };

  /** action: play-pause | next | previous | seek (value = seconds) | volume (value = 0..1). Resolves {ok, reason?, label?}. */
  M.control = function (action, value) {
    if (!P) return Promise.resolve({ ok: false, reason: 'unavailable' });
    return P.control({ action: action, value: value }).catch(function () { return { ok: false, reason: 'error' }; });
  };

  M.getAccess = function () { return P ? P.getAccess() : Promise.resolve({ granted: false }); };
  M.openAccessSettings = function () { return P ? P.openAccessSettings() : Promise.reject(new Error('unavailable')); };
  M.openAppInfo = function () { return P ? P.openAppInfo() : Promise.reject(new Error('unavailable')); };
  M.openPlayer = function () { return P ? P.openPlayer() : Promise.reject(new Error('unavailable')); };
  M.onPolled = function (cb) { pollListeners.push(cb); };
  M.onChange = function (cb) { changeListeners.push(cb); };

  if (P) {
    try { P.addListener('nowPlayingChanged', function (s) { fire(changeListeners, s); }); } catch (e) { /* polling still works */ }
  }
  window.StudyOSMedia = M;
})();
