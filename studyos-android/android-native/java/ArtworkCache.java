package com.hunterhz.studyos;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.net.Uri;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;

/**
 * Album artwork taken from the player's own media session, re-encoded small and cached on disk
 * (in the app cache directory, which Android may clear when space is low). No network access here:
 * remote artwork URIs are left to the web layer's optional cover lookup.
 */
final class ArtworkCache {
    private static final int MAX_EDGE = 600;
    private static final int MAX_FILES = 200;
    private final File dir;

    ArtworkCache(Context c) {
        dir = new File(c.getCacheDir(), "studyos-media-art");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    static String id(String pkg, String title, String artist, String album) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-1")
                    .digest((pkg + "|" + title + "|" + artist + "|" + album).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 8; i++) sb.append(String.format("%02x", h[i]));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString((pkg + title + artist + album).hashCode());
        }
    }

    boolean has(String id) {
        return new File(dir, id + ".jpg").exists();
    }

    String base64(String id) {
        File f = new File(dir, id + ".jpg");
        if (!f.exists()) return null;
        try (InputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    void put(String id, Bitmap bmp) {
        try {
            Bitmap b = bmp;
            int max = Math.max(bmp.getWidth(), bmp.getHeight());
            if (max > MAX_EDGE) {
                float s = MAX_EDGE / (float) max;
                b = Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(bmp.getWidth() * s)),
                        Math.max(1, Math.round(bmp.getHeight() * s)), true);
            }
            try (FileOutputStream fos = new FileOutputStream(new File(dir, id + ".jpg"))) {
                b.compress(Bitmap.CompressFormat.JPEG, 88, fos);
            }
            trim();
        } catch (Exception ignored) {
        }
    }

    private void trim() {
        File[] files = dir.listFiles();
        if (files == null || files.length <= MAX_FILES) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        for (int i = MAX_FILES; i < files.length; i++) {
            //noinspection ResultOfMethodCallIgnored
            files[i].delete();
        }
    }

    /** Best artwork the session exposes: embedded bitmaps first, then local (content/file) URIs. */
    static Bitmap find(Context ctx, MediaMetadata md) {
        if (md == null) return null;
        String[] bitmaps = {MediaMetadata.METADATA_KEY_ALBUM_ART, MediaMetadata.METADATA_KEY_ART, MediaMetadata.METADATA_KEY_DISPLAY_ICON};
        for (String k : bitmaps) {
            Bitmap b = md.getBitmap(k);
            if (b != null) return b;
        }
        String[] uris = {MediaMetadata.METADATA_KEY_ALBUM_ART_URI, MediaMetadata.METADATA_KEY_ART_URI, MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI};
        for (String k : uris) {
            String s = md.getString(k);
            if (s == null || s.isEmpty()) continue;
            Uri u = Uri.parse(s);
            String scheme = u.getScheme();
            if (!"content".equals(scheme) && !"file".equals(scheme) && !"android.resource".equals(scheme)) continue;
            try (InputStream in = ctx.getContentResolver().openInputStream(u)) {
                if (in == null) continue;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n, total = 0;
                while ((n = in.read(buf)) > 0 && total < 8 * 1024 * 1024) {
                    out.write(buf, 0, n);
                    total += n;
                }
                byte[] bytes = out.toByteArray();
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o);
                int sample = 1;
                while (o.outWidth / (sample * 2) >= MAX_EDGE && o.outHeight / (sample * 2) >= MAX_EDGE) sample *= 2;
                BitmapFactory.Options d = new BitmapFactory.Options();
                d.inSampleSize = sample;
                Bitmap b = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, d);
                if (b != null) return b;
            } catch (Exception ignored) {
                // the player did not grant us access to that URI: no artwork from it
            }
        }
        return null;
    }
}
