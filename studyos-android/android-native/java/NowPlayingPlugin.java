package com.hunterhz.studyos;

import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * "Now Playing" for StudyOS: shows and controls whatever music app currently has an active Android media
 * session (Spotify, YouTube Music, Poweramp, Samsung/Xiaomi players, ...). It plays no audio itself.
 *
 * Thin facade; the work is split into:
 *   MediaSessionMonitor  - finds sessions and reports changes
 *   TrackMetadata        - title / artist / album / duration
 *   ArtworkCache         - artwork from the session, cached on disk
 *   PlaybackControl      - play/pause/next/previous/seek/volume
 */
@CapacitorPlugin(name = "NowPlaying")
public class NowPlayingPlugin extends Plugin {
    private MediaSessionMonitor monitor;
    private ArtworkCache art;

    @Override
    public void load() {
        monitor = new MediaSessionMonitor(getContext());
        art = new ArtworkCache(getContext());
    }

    @Override
    protected void handleOnResume() {
        rebindListenerIfNeeded();
        monitor.start(this::emit);
        emit();
    }

    @Override
    protected void handleOnPause() {
        monitor.stop(); // no callbacks while StudyOS is in the background
    }

    private void emit() {
        try {
            notifyListeners("nowPlayingChanged", access());
        } catch (Exception ignored) {
        }
    }

    private void rebindListenerIfNeeded() {
        if (monitor.hasAccess() && !StudyOSNotificationListener.connected && Build.VERSION.SDK_INT >= 24) {
            try {
                NotificationListenerService.requestRebind(new ComponentName(getContext(), StudyOSNotificationListener.class));
            } catch (Exception ignored) {
            }
        }
    }

    private JSObject access() {
        JSObject o = new JSObject();
        o.put("granted", monitor.hasAccess());
        o.put("listenerConnected", StudyOSNotificationListener.connected);
        o.put("sdk", Build.VERSION.SDK_INT);
        o.put("manufacturer", Build.MANUFACTURER);
        return o;
    }

    private String label(String pkg) {
        try {
            PackageManager pm = getContext().getPackageManager();
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception e) {
            int dot = pkg.lastIndexOf('.');
            return dot >= 0 ? pkg.substring(dot + 1) : pkg;
        }
    }

    // ------------------------------------------------------------------ permission helpers

    @PluginMethod
    public void getAccess(PluginCall call) {
        rebindListenerIfNeeded();
        call.resolve(access());
    }

    @PluginMethod
    public void openAccessSettings(PluginCall call) {
        Intent i;
        if (Build.VERSION.SDK_INT >= 30) {
            i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS);
            i.putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                    new ComponentName(getContext(), StudyOSNotificationListener.class).flattenToString());
        } else {
            i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (ActivityNotFoundException | SecurityException e) {
            try {
                // some ROMs do not provide the per-app page: fall back to the general list
                getContext().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception e2) {
                call.reject("Could not open notification access settings");
                return;
            }
        }
        call.resolve();
    }

    /** Android 13+ blocks sideloaded apps from enabling special access until "Allow restricted settings" is chosen here. */
    @PluginMethod
    public void openAppInfo(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open app info");
        }
    }

    // ------------------------------------------------------------------ state

    @PluginMethod
    public void getNowPlaying(PluginCall call) {
        JSObject o = access();
        if (!monitor.hasAccess()) {
            o.put("hasSession", false);
            call.resolve(o);
            return;
        }
        monitor.start(this::emit);
        monitor.refresh();
        MediaController c = monitor.current();
        if (c == null) {
            o.put("hasSession", false);
            call.resolve(o);
            return;
        }
        MediaMetadata md = c.getMetadata();
        TrackMetadata t = TrackMetadata.from(md);
        android.media.session.PlaybackState ps = c.getPlaybackState();
        String pkg = c.getPackageName();
        o.put("hasSession", true);
        o.put("package", pkg);
        o.put("label", label(pkg));
        o.put("title", t.title);
        o.put("artist", t.artist);
        o.put("album", t.album);
        o.put("duration", t.durationMs / 1000.0);
        o.put("position", PlaybackControl.positionSec(ps, t.durationMs));
        o.put("playbackState", PlaybackControl.stateName(ps));
        boolean hasArt = md != null && (md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) != null
                || md.getBitmap(MediaMetadata.METADATA_KEY_ART) != null
                || md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON) != null
                || md.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI) != null
                || md.getString(MediaMetadata.METADATA_KEY_ART_URI) != null
                || md.getString(MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI) != null);
        o.put("hasArtwork", hasArt);
        o.put("artworkId", ArtworkCache.id(pkg, t.title, t.artist, t.album));
        JSObject caps = new JSObject();
        caps.put("playPause", PlaybackControl.has(ps, android.media.session.PlaybackState.ACTION_PLAY_PAUSE)
                || PlaybackControl.has(ps, android.media.session.PlaybackState.ACTION_PLAY)
                || PlaybackControl.has(ps, android.media.session.PlaybackState.ACTION_PAUSE));
        caps.put("next", PlaybackControl.has(ps, android.media.session.PlaybackState.ACTION_SKIP_TO_NEXT));
        caps.put("previous", PlaybackControl.has(ps, android.media.session.PlaybackState.ACTION_SKIP_TO_PREVIOUS));
        caps.put("seek", PlaybackControl.has(ps, android.media.session.PlaybackState.ACTION_SEEK_TO));
        o.put("caps", caps);
        JSObject vol = new JSObject();
        boolean vs = PlaybackControl.volumeSupported(c);
        vol.put("supported", vs);
        vol.put("remote", PlaybackControl.volumeIsRemote(c));
        if (vs) vol.put("level", PlaybackControl.volumeLevel(getContext(), c));
        o.put("volume", vol);
        call.resolve(o);
    }

    @PluginMethod
    public void getArtwork(PluginCall call) {
        final MediaController c = monitor.hasAccess() ? monitor.current() : null;
        new Thread(() -> {
            JSObject r = new JSObject();
            r.put("data", "");
            r.put("mime", "image/jpeg");
            if (c != null) {
                try {
                    MediaMetadata md = c.getMetadata();
                    TrackMetadata t = TrackMetadata.from(md);
                    String id = ArtworkCache.id(c.getPackageName(), t.title, t.artist, t.album);
                    if (!art.has(id)) {
                        Bitmap b = ArtworkCache.find(getContext(), md);
                        if (b != null) art.put(id, b);
                    }
                    String data = art.base64(id);
                    r.put("id", id);
                    if (data != null) r.put("data", data);
                } catch (Exception ignored) {
                }
            }
            call.resolve(r);
        }, "studyos-art").start();
    }

    // ------------------------------------------------------------------ control

    @PluginMethod
    public void control(PluginCall call) {
        String action = call.getString("action", "");
        if (!monitor.hasAccess()) {
            result(call, false, "no-access", null);
            return;
        }
        monitor.refresh();
        MediaController c = monitor.current();
        int code;
        switch (action) {
            case "play-pause":
                code = PlaybackControl.playPause(c);
                break;
            case "next":
                code = PlaybackControl.next(c);
                break;
            case "previous":
                code = PlaybackControl.previous(c);
                break;
            case "seek":
                code = PlaybackControl.seek(c, call.getDouble("value", 0.0));
                break;
            case "volume":
                try {
                    code = PlaybackControl.setVolume(getContext(), c, call.getDouble("value", 0.0));
                } catch (SecurityException e) {
                    code = PlaybackControl.UNSUPPORTED;
                }
                break;
            default:
                result(call, false, "unsupported", c != null ? label(c.getPackageName()) : null);
                return;
        }
        String lbl = c != null ? label(c.getPackageName()) : null;
        if (code == PlaybackControl.OK) result(call, true, null, lbl);
        else result(call, false, code == PlaybackControl.NO_SESSION ? "no-session" : "unsupported", lbl);
    }

    private void result(PluginCall call, boolean ok, String reason, String label) {
        JSObject r = new JSObject();
        r.put("ok", ok);
        if (reason != null) r.put("reason", reason);
        if (label != null) r.put("label", label);
        call.resolve(r);
    }

    @PluginMethod
    public void openPlayer(PluginCall call) {
        MediaController c = monitor.hasAccess() ? monitor.current() : null;
        if (c == null) {
            call.reject("No active player");
            return;
        }
        try {
            PendingIntent pi = c.getSessionActivity();
            if (pi != null) {
                pi.send();
            } else {
                Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(c.getPackageName());
                if (launch == null) {
                    call.reject("This player cannot be opened from here");
                    return;
                }
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(launch);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the player");
        }
    }
}
