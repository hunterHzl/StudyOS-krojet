package com.hunterhz.studyos;

import android.content.Context;
import android.media.AudioManager;
import android.media.session.MediaController;
import android.media.session.PlaybackState;
import android.os.SystemClock;

/**
 * Sends transport commands to the player that owns the media session. It never plays audio itself.
 * A command is only sent when the player advertises the matching action; otherwise the caller is told
 * the player does not support it (instead of pretending it worked).
 */
final class PlaybackControl {
    static final int OK = 0, NO_SESSION = 1, UNSUPPORTED = 2;

    private PlaybackControl() {
    }

    static boolean has(PlaybackState ps, long action) {
        return ps != null && (ps.getActions() & action) != 0;
    }

    static boolean isPlaying(PlaybackState ps) {
        return ps != null && (ps.getState() == PlaybackState.STATE_PLAYING || ps.getState() == PlaybackState.STATE_BUFFERING);
    }

    static String stateName(PlaybackState ps) {
        if (ps == null) return "stopped";
        switch (ps.getState()) {
            case PlaybackState.STATE_PLAYING:
                return "playing";
            case PlaybackState.STATE_BUFFERING:
            case PlaybackState.STATE_CONNECTING:
                return "buffering";
            case PlaybackState.STATE_PAUSED:
                return "paused";
            default:
                return "stopped";
        }
    }

    /** Position in seconds, advanced from the player's last report while it is playing. */
    static double positionSec(PlaybackState ps, long durationMs) {
        if (ps == null || ps.getPosition() < 0) return 0;
        double pos = ps.getPosition();
        if (ps.getState() == PlaybackState.STATE_PLAYING) {
            long since = SystemClock.elapsedRealtime() - ps.getLastPositionUpdateTime();
            if (since > 0) pos += since * (double) (ps.getPlaybackSpeed() == 0 ? 1f : ps.getPlaybackSpeed());
        }
        if (durationMs > 0) pos = Math.min(pos, durationMs);
        return Math.max(0, pos) / 1000.0;
    }

    static int playPause(MediaController c) {
        if (c == null) return NO_SESSION;
        PlaybackState ps = c.getPlaybackState();
        MediaController.TransportControls t = c.getTransportControls();
        if (isPlaying(ps)) {
            if (!(has(ps, PlaybackState.ACTION_PAUSE) || has(ps, PlaybackState.ACTION_PLAY_PAUSE))) return UNSUPPORTED;
            t.pause();
        } else {
            if (!(has(ps, PlaybackState.ACTION_PLAY) || has(ps, PlaybackState.ACTION_PLAY_PAUSE))) return UNSUPPORTED;
            t.play();
        }
        return OK;
    }

    static int next(MediaController c) {
        if (c == null) return NO_SESSION;
        if (!has(c.getPlaybackState(), PlaybackState.ACTION_SKIP_TO_NEXT)) return UNSUPPORTED;
        c.getTransportControls().skipToNext();
        return OK;
    }

    static int previous(MediaController c) {
        if (c == null) return NO_SESSION;
        if (!has(c.getPlaybackState(), PlaybackState.ACTION_SKIP_TO_PREVIOUS)) return UNSUPPORTED;
        c.getTransportControls().skipToPrevious();
        return OK;
    }

    static int seek(MediaController c, double sec) {
        if (c == null) return NO_SESSION;
        if (!has(c.getPlaybackState(), PlaybackState.ACTION_SEEK_TO)) return UNSUPPORTED;
        c.getTransportControls().seekTo((long) (Math.max(0, sec) * 1000));
        return OK;
    }

    /** True if volume can be changed: remote sessions that allow it, or the device media volume for local players. */
    static boolean volumeSupported(MediaController c) {
        MediaController.PlaybackInfo pi = c.getPlaybackInfo();
        if (pi == null) return false;
        if (pi.getPlaybackType() == MediaController.PlaybackInfo.PLAYBACK_TYPE_REMOTE) {
            return pi.getVolumeControl() != android.media.VolumeProvider.VOLUME_CONTROL_FIXED && pi.getMaxVolume() > 0;
        }
        return true;
    }

    static boolean volumeIsRemote(MediaController c) {
        MediaController.PlaybackInfo pi = c.getPlaybackInfo();
        return pi != null && pi.getPlaybackType() == MediaController.PlaybackInfo.PLAYBACK_TYPE_REMOTE;
    }

    static double volumeLevel(Context ctx, MediaController c) {
        MediaController.PlaybackInfo pi = c.getPlaybackInfo();
        if (volumeIsRemote(c)) return pi.getMaxVolume() > 0 ? pi.getCurrentVolume() / (double) pi.getMaxVolume() : 0;
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        return max > 0 ? am.getStreamVolume(AudioManager.STREAM_MUSIC) / (double) max : 0;
    }

    static int setVolume(Context ctx, MediaController c, double level) {
        if (c == null) return NO_SESSION;
        if (!volumeSupported(c)) return UNSUPPORTED;
        level = Math.max(0, Math.min(1, level));
        if (volumeIsRemote(c)) {
            c.setVolumeTo((int) Math.round(level * c.getPlaybackInfo().getMaxVolume()), 0);
        } else {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            am.setStreamVolume(AudioManager.STREAM_MUSIC, (int) Math.round(level * am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)), 0);
        }
        return OK;
    }
}
