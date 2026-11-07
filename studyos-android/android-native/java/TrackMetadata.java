package com.hunterhz.studyos;

import android.media.MediaMetadata;

/** Track information as exposed by another app's media session. Nothing here is invented or defaulted to fake data. */
final class TrackMetadata {
    final String title;
    final String artist;
    final String album;
    final long durationMs;

    private TrackMetadata(String title, String artist, String album, long durationMs) {
        this.title = title;
        this.artist = artist;
        this.album = album;
        this.durationMs = durationMs;
    }

    static TrackMetadata from(MediaMetadata md) {
        if (md == null) return new TrackMetadata("", "", "", 0);
        String title = first(md, MediaMetadata.METADATA_KEY_TITLE, MediaMetadata.METADATA_KEY_DISPLAY_TITLE);
        String artist = first(md, MediaMetadata.METADATA_KEY_ARTIST, MediaMetadata.METADATA_KEY_ALBUM_ARTIST,
                MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE);
        String album = first(md, MediaMetadata.METADATA_KEY_ALBUM);
        long dur = md.getLong(MediaMetadata.METADATA_KEY_DURATION);
        return new TrackMetadata(title, artist, album, Math.max(0, dur));
    }

    private static String first(MediaMetadata md, String... keys) {
        for (String k : keys) {
            CharSequence v = md.getText(k);
            if (v != null && v.toString().trim().length() > 0) return v.toString().trim();
        }
        return "";
    }

    boolean isEmpty() {
        return title.isEmpty() && artist.isEmpty() && album.isEmpty();
    }
}
