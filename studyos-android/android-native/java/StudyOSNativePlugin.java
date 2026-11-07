package com.hunterhz.studyos;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.view.Window;

import androidx.activity.result.ActivityResult;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.regex.Pattern;

/**
 * StudyOS native helpers that are not music related:
 *  - "safety" files: an atomic on-device mirror of the web data (never the primary store)
 *  - save-as export for JSON backups (WebView cannot download blob: links by itself)
 *  - system bar colours
 *  - app/OS version info
 * No permissions are needed for any of this.
 */
@CapacitorPlugin(name = "StudyOSNative")
public class StudyOSNativePlugin extends Plugin {

    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9._-]{1,80}");

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("sdk", Build.VERSION.SDK_INT);
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            r.put("versionName", pi.versionName);
            r.put("packageName", getContext().getPackageName());
        } catch (Exception ignored) {
        }
        call.resolve(r);
    }

    private static byte[] readAll(File f) throws Exception {
        try (InputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    // ------------------------------------------------------------------ safety files (data mirror)

    private File safetyDir() {
        File d = new File(getContext().getFilesDir(), "studyos-safety");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    private boolean badName(PluginCall call, String name) {
        if (name == null || !SAFE_NAME.matcher(name).matches()) {
            call.reject("Invalid file name");
            return true;
        }
        return false;
    }

    /** Atomic write: temp file -> fsync -> rename; the previous version is kept as NAME.prev. */
    @PluginMethod
    public void safetyWrite(PluginCall call) {
        final String name = call.getString("name");
        final String content = call.getString("content");
        if (badName(call, name)) return;
        if (content == null) {
            call.reject("No content");
            return;
        }
        new Thread(() -> {
            try {
                File dir = safetyDir();
                File tmp = new File(dir, name + ".tmp");
                File dst = new File(dir, name);
                File prev = new File(dir, name + ".prev");
                try (FileOutputStream fos = new FileOutputStream(tmp)) {
                    fos.write(content.getBytes(StandardCharsets.UTF_8));
                    fos.getFD().sync();
                }
                if (dst.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    prev.delete();
                    //noinspection ResultOfMethodCallIgnored
                    dst.renameTo(prev);
                }
                if (!tmp.renameTo(dst)) {
                    if (prev.exists()) //noinspection ResultOfMethodCallIgnored
                        prev.renameTo(dst);
                    call.reject("Could not finalise file");
                    return;
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Write failed: " + e.getMessage());
            }
        }, "studyos-safety").start();
    }

    @PluginMethod
    public void safetyRead(PluginCall call) {
        final String name = call.getString("name");
        if (badName(call, name)) return;
        new Thread(() -> {
            try {
                File dir = safetyDir();
                File f = new File(dir, name);
                String source = "current";
                if (!f.exists() || f.length() == 0) {
                    f = new File(dir, name + ".prev");
                    source = "prev";
                }
                JSObject r = new JSObject();
                if (f.exists() && f.length() > 0) {
                    r.put("exists", true);
                    r.put("source", source);
                    r.put("modified", f.lastModified());
                    r.put("content", new String(readAll(f), StandardCharsets.UTF_8));
                } else {
                    r.put("exists", false);
                }
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Read failed: " + e.getMessage());
            }
        }, "studyos-safety").start();
    }

    /** Copies NAME to AS (e.g. a dated daily copy, or a copy taken just before an import). */
    @PluginMethod
    public void safetyArchive(PluginCall call) {
        final String name = call.getString("name");
        final String as = call.getString("as");
        if (badName(call, name) || badName(call, as)) return;
        new Thread(() -> {
            try {
                File src = new File(safetyDir(), name);
                if (!src.exists()) {
                    JSObject r = new JSObject();
                    r.put("archived", false);
                    call.resolve(r);
                    return;
                }
                File dst = new File(safetyDir(), as);
                try (InputStream in = new FileInputStream(src); FileOutputStream out = new FileOutputStream(dst)) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    out.getFD().sync();
                }
                JSObject r = new JSObject();
                r.put("archived", true);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Archive failed: " + e.getMessage());
            }
        }, "studyos-safety").start();
    }

    /** Keeps only the newest KEEP files whose names start with PREFIX. Never touches other files. */
    @PluginMethod
    public void safetyPrune(PluginCall call) {
        final String prefix = call.getString("prefix");
        final int keep = call.getInt("keep", 7);
        if (prefix == null || !SAFE_NAME.matcher(prefix).matches() || prefix.equals("current")) {
            call.reject("Invalid prefix");
            return;
        }
        new Thread(() -> {
            File[] files = safetyDir().listFiles((dir, n) -> n.startsWith(prefix) && !n.endsWith(".tmp"));
            if (files != null && files.length > keep) {
                Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
                for (int k = keep; k < files.length; k++) {
                    //noinspection ResultOfMethodCallIgnored
                    files[k].delete();
                }
            }
            call.resolve();
        }, "studyos-safety").start();
    }

    @PluginMethod
    public void safetyList(PluginCall call) {
        File[] files = safetyDir().listFiles();
        JSArray arr = new JSArray();
        if (files != null) {
            for (File f : files) {
                JSObject o = new JSObject();
                o.put("name", f.getName());
                o.put("size", f.length());
                o.put("modified", f.lastModified());
                arr.put(o);
            }
        }
        JSObject r = new JSObject();
        r.put("files", arr);
        call.resolve(r);
    }

    // ------------------------------------------------------------------ save-as export

    @PluginMethod
    public void exportFile(PluginCall call) {
        String filename = call.getString("filename", "studyos-backup.json");
        String mime = call.getString("mime", "application/json");
        if (call.getString("text") == null && call.getString("base64") == null) {
            call.reject("No data");
            return;
        }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, i, "exportResult");
    }

    @ActivityCallback
    private void exportResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            r.put("saved", false);
            call.resolve(r);
            return;
        }
        Uri dest = result.getData().getData();
        try {
            String b64 = call.getString("base64");
            byte[] bytes = b64 != null ? Base64.decode(b64, Base64.DEFAULT)
                    : call.getString("text", "").getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = getContext().getContentResolver().openOutputStream(dest, "wt")) {
                if (os == null) throw new IllegalStateException("Could not open destination");
                os.write(bytes);
                os.flush();
            }
            r.put("saved", true);
            r.put("uri", dest.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not save the file: " + e.getMessage());
        }
    }

    // ------------------------------------------------------------------ system bars

    @PluginMethod
    public void setChrome(PluginCall call) {
        final String color = call.getString("color");
        final boolean lightBackground = call.getBoolean("lightBackground", true);
        if (getActivity() == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Window w = getActivity().getWindow();
                if (color != null) w.getDecorView().setBackgroundColor(Color.parseColor(color));
                WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
                c.setAppearanceLightStatusBars(lightBackground);
                c.setAppearanceLightNavigationBars(lightBackground);
            } catch (Exception ignored) {
            }
            call.resolve();
        });
    }
}
