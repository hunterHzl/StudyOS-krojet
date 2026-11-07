package com.hunterhz.studyos;

import android.content.ComponentName;
import android.content.Context;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.NotificationManagerCompat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Discovers other apps' active media sessions through MediaSessionManager and tells the plugin when
 * playback starts, pauses, the track changes or the session ends.
 *
 * Requires the user to enable "Notification access" for StudyOS (see StudyOSNotificationListener).
 * Callbacks are only registered while the app is in the foreground (start/stop), to save battery.
 */
final class MediaSessionMonitor {
    interface Listener {
        void onChanged();
    }

    private final Context ctx;
    private final MediaSessionManager msm;
    private final ComponentName listenerComponent;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<MediaController> controllers = new ArrayList<>();
    private final Map<MediaController, MediaController.Callback> callbacks = new HashMap<>();
    private Listener listener;
    private boolean registered;

    private final Runnable fire = () -> {
        Listener l = listener;
        if (l != null) l.onChanged();
    };

    private final MediaSessionManager.OnActiveSessionsChangedListener sessionsChanged = list -> {
        synchronized (MediaSessionMonitor.this) {
            adopt(list, registered);
        }
        schedule();
    };

    MediaSessionMonitor(Context c) {
        ctx = c.getApplicationContext();
        msm = (MediaSessionManager) ctx.getSystemService(Context.MEDIA_SESSION_SERVICE);
        listenerComponent = new ComponentName(ctx, StudyOSNotificationListener.class);
    }

    boolean hasAccess() {
        try {
            return NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    synchronized void start(Listener l) {
        listener = l;
        if (registered || msm == null || !hasAccess()) return;
        try {
            msm.addOnActiveSessionsChangedListener(sessionsChanged, listenerComponent, main);
            registered = true;
            adopt(msm.getActiveSessions(listenerComponent), true);
        } catch (SecurityException e) {
            registered = false; // access revoked between the check and the call
        }
    }

    synchronized void stop() {
        if (registered && msm != null) {
            try {
                msm.removeOnActiveSessionsChangedListener(sessionsChanged);
            } catch (Exception ignored) {
            }
        }
        registered = false;
        listener = null;
        main.removeCallbacks(fire);
        adopt(null, false);
    }

    /** Re-reads the current list of sessions (cheap). Called on every poll so state is never stale. */
    synchronized void refresh() {
        if (msm == null || !hasAccess()) {
            adopt(null, false);
            return;
        }
        try {
            adopt(msm.getActiveSessions(listenerComponent), registered);
        } catch (SecurityException e) {
            adopt(null, false);
        }
    }

    private void adopt(List<MediaController> list, boolean withCallbacks) {
        for (Map.Entry<MediaController, MediaController.Callback> e : callbacks.entrySet()) {
            try {
                e.getKey().unregisterCallback(e.getValue());
            } catch (Exception ignored) {
            }
        }
        callbacks.clear();
        controllers.clear();
        if (list == null) return;
        for (MediaController c : list) {
            if (ctx.getPackageName().equals(c.getPackageName())) continue;
            controllers.add(c);
            if (!withCallbacks) continue;
            MediaController.Callback cb = new MediaController.Callback() {
                @Override
                public void onPlaybackStateChanged(PlaybackState state) {
                    schedule();
                }

                @Override
                public void onMetadataChanged(MediaMetadata metadata) {
                    schedule();
                }

                @Override
                public void onSessionDestroyed() {
                    schedule();
                }
            };
            try {
                c.registerCallback(cb, main);
                callbacks.put(c, cb);
            } catch (Exception ignored) {
            }
        }
    }

    private void schedule() {
        main.removeCallbacks(fire);
        main.postDelayed(fire, 120); // coalesce bursts (players often update state + metadata together)
    }

    /**
     * The session to show: the first one that is playing; otherwise the first one that has a track;
     * otherwise the first one. The system lists sessions most-recently-active first.
     */
    synchronized MediaController current() {
        MediaController withTrack = null;
        for (MediaController c : controllers) {
            PlaybackState ps = c.getPlaybackState();
            if (ps != null && (ps.getState() == PlaybackState.STATE_PLAYING || ps.getState() == PlaybackState.STATE_BUFFERING)) return c;
            if (withTrack == null && !TrackMetadata.from(c.getMetadata()).isEmpty()) withTrack = c;
        }
        if (withTrack != null) return withTrack;
        return controllers.isEmpty() ? null : controllers.get(0);
    }
}
