/* StudyOS Android music: widget panel.
 * The existing Now Playing widget (title, artist, cover, progress, buttons, lyrics) is untouched. This adds, inside its
 * popover, what Android needs on top:
 *   - a plain-language explanation BEFORE sending the user to Android's "Notification access" settings
 *   - clear states: access needed / revoked / nothing playing / controlling <player>
 *   - honest notes when a player does not offer a control to other apps
 *   - volume, only when the session or device allows it
 *   - live updates: reacts to Android media-session events and to returning from Settings, no reopening needed
 */
(function () {
  'use strict';
  var M = window.StudyOSMedia;
  if (!M) return;

  var GRANTED_KEY = 'studyos.android.mediaAccessGranted';
  var body, volTimer, dragT, dragging = false, lastHtml = '';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function wasGranted() { try { return localStorage.getItem(GRANTED_KEY) === '1'; } catch (e) { return false; } }
  function remember(g) { try { if (g) localStorage.setItem(GRANTED_KEY, '1'); } catch (e) { /* ignore */ } }

  function accessCard(s) {
    var acc = (s && s.access) || {};
    var revoked = wasGranted();
    var sdk = acc.sdk || 0;
    var maker = String(acc.manufacturer || '').toLowerCase();
    var html = '<div class="aos-access"><strong>' + (revoked ? 'Music access was turned off' : 'Connect your music app') + '</strong>';
    html += revoked
      ? '<p>Notification access for StudyOS is off, so StudyOS can no longer see or control your music. Turn it back on to reconnect.</p>'
      : '<p>StudyOS can show and control the song playing in your music app (Spotify, YouTube Music, Poweramp and others). Android calls the permission needed for this <b>Notification access</b>.</p>';
    html += '<ul><li>StudyOS only reads which song is playing (title, artist, cover, progress) and sends play, pause, next and previous.</li>' +
      '<li>It does <b>not</b> read, store or send the contents of your notifications.</li>' +
      '<li>The only internet use is looking up lyrics: the song title and artist are sent to LRCLIB.</li></ul>' +
      '<button type="button" data-aos-m="grant">Open notification access settings</button>';
    if (sdk >= 33) {
      html += '<details><summary>The switch is greyed out?</summary><p>StudyOS was installed from an APK file, and Android 13 or newer blocks this setting until you allow it: ' +
        'open App info, tap the ⋮ menu (top right), choose <b>Allow restricted settings</b>, then go back and enable StudyOS.</p>' +
        '<button type="button" data-aos-m="appinfo">Open App info</button></details>';
    }
    if (/xiaomi|redmi|poco/.test(maker)) {
      html += '<details><summary>Xiaomi / Redmi / HyperOS tips</summary><p>In App info set Battery saver to <b>No restrictions</b> and turn on <b>Autostart</b> for StudyOS. ' +
        'Otherwise the system may cut the link to your music app while StudyOS is in the background.</p></details>';
    }
    html += '<p class="aos-note">When you come back to StudyOS it checks again automatically.</p></div>';
    return html;
  }

  function capsNote(s) {
    var missing = [];
    var c = s.caps || {};
    if (!c.playPause) missing.push('play/pause');
    if (!c.next) missing.push('next');
    if (!c.previous) missing.push('previous');
    if (!missing.length) return '';
    return '<p class="aos-note">' + esc(s.label || 'This player') + ' does not offer ' + missing.join(', ') + ' to other apps, so those buttons cannot work with it.</p>';
  }

  function render(s) {
    if (!body) return;
    s = s || M.last || { status: M.available ? 'starting' : 'unavailable' };
    var html;
    if (s.status === 'unavailable') {
      html = '<p class="aos-note">Music control is available in the StudyOS Android app.</p>';
    } else if (s.status === 'no-access') {
      html = accessCard(s);
    } else if (s.status === 'no-session' || s.status === 'idle') {
      html = '<p class="aos-note"><b>No music app is playing right now.</b> Start a song in your music app and it will appear here' +
        (s.label ? ' (' + esc(s.label) + ' is connected but has nothing loaded)' : '') + '. Some players only share their session while a song is loaded.</p>';
    } else if (s.status === 'ok') {
      var v = s.volume || {};
      html = '<div class="aos-player"><span>Controlling <strong>' + esc(s.label || 'your music app') + '</strong></span>' +
        '<button type="button" data-aos-m="open">Open ' + esc(s.label || 'player') + '</button></div>';
      if (v.supported) {
        html += '<label class="aos-vol"><span>Volume</span><input id="aosVolume" type="range" min="0" max="100" step="1" value="' +
          Math.round((v.level || 0) * 100) + '" aria-label="Volume"></label>' +
          '<p class="aos-note">' + (v.remote ? 'Adjusts the player’s own volume.' : 'Adjusts your phone’s media volume.') + '</p>';
      } else {
        html += '<p class="aos-note">This player does not let other apps change its volume. Use your phone’s volume keys.</p>';
      }
      html += capsNote(s);
    } else if (s.status === 'error') {
      html = '<p class="aos-note">Could not read the music session right now. It will retry automatically.</p>';
    } else {
      html = '';
    }
    if (html !== lastHtml) {
      // do not rebuild the slider while the user is dragging it
      if (dragging && s.status === 'ok') return;
      body.innerHTML = html;
      lastHtml = html;
    }
  }

  function build() {
    var pop = document.getElementById('nowPlayingPopover');
    if (!pop || document.getElementById('aosMusic')) return;
    var panel = document.createElement('div');
    panel.id = 'aosMusic';
    panel.className = 'aos-music';
    panel.innerHTML = '<div id="aosMusicBody" aria-live="polite"></div>';
    pop.appendChild(panel);
    body = panel.querySelector('#aosMusicBody');

    panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-aos-m]');
      if (!b) return;
      var act = b.dataset.aosM;
      if (act === 'grant') M.openAccessSettings().catch(function () { toastMsg('Could not open settings. Open Settings → Notifications → Notification access manually.'); });
      else if (act === 'appinfo') M.openAppInfo().catch(function () { toastMsg('Could not open App info.'); });
      else if (act === 'open') M.openPlayer().catch(function () { toastMsg('This player cannot be opened from here.'); });
    });
    panel.addEventListener('input', function (e) {
      if (e.target.id !== 'aosVolume') return;
      dragging = true;
      clearTimeout(dragT);
      dragT = setTimeout(function () { dragging = false; }, 700); // never stay 'dragging' if touch-end/change is missed
      var level = Number(e.target.value) / 100;
      clearTimeout(volTimer);
      volTimer = setTimeout(function () {
        M.control('volume', level).then(function (r) { if (!r.ok) toastMsg('Volume could not be changed for this player.'); });
      }, 60);
    });
    render();
  }

  function toastMsg(m) { if (window.StudyOSAndroidUI && window.StudyOSAndroidUI.toast) window.StudyOSAndroidUI.toast(m, 4500); }

  // ---- live updates ----
  var pollT;
  function requestPoll() {
    clearTimeout(pollT);
    pollT = setTimeout(function () {
      if (window.StudyOSNowPlaying && window.StudyOSNowPlaying.requestPoll) window.StudyOSNowPlaying.requestPoll();
    }, 80);
  }
  var prevStatus = null;
  M.onPolled(function (s) {
    if (s.access && s.access.granted) { remember(true); }
    if (prevStatus === 'no-access' && s.status !== 'no-access' && s.status !== 'unavailable') toastMsg('Music connected.');
    prevStatus = s.status;
    render(s);
  });
  M.onChange(requestPoll); // media-session event from Android: refresh immediately instead of waiting for the next poll
  document.addEventListener('visibilitychange', function () { if (!document.hidden) requestPoll(); }); // back from Settings

  window.StudyOSMusicPanel = { render: render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
