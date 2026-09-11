package com.lakenotes.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 最小原生插件：打开 / 另存为 本地文件。
 * - open：ACTION_VIEW + FileProvider，用系统默认应用打开。
 * - saveAs：把应用私有目录里的附件“另存为”到**用户可见**位置——
 *     图片（image/*）→ MediaStore Pictures（直接进相册，Android 10+）；
 *     其它附件 → SAF ACTION_CREATE_DOCUMENT（系统“保存到”面板，用户自选位置）。
 *   这是 Android 10+ Scoped Storage 下唯一合规的“写公共可见区域”方式（思源是甩浏览器下载，体验糙）。
 * 用法：Capacitor.Plugins.OpenFile.open({ path: "/abs/path" })
 *      Capacitor.Plugins.OpenFile.saveAs({ path: "/abs/path", name: "报告.pdf", mime: "application/pdf" })
 */
@CapacitorPlugin(name = "OpenFile")
public class OpenFilePlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path required");
            return;
        }
        File file = new File(path);
        if (!file.exists()) {
            call.reject("file not found: " + path);
            return;
        }
        try {
            String mime = mimeFor(file);
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no app can open this file: " + e.getMessage());
        } catch (Exception e) {
            call.reject("open failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveAs(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path required");
            return;
        }
        File src = new File(path);
        if (!src.exists()) {
            call.reject("file not found: " + path);
            return;
        }
        String name = call.getString("name");
        if (name == null || name.trim().isEmpty()) name = src.getName();
        String mime = call.getString("mime");
        if (mime == null || mime.isEmpty()) mime = mimeFor(src);

        // 图片走相册（系统图库立即可见，最接近小红书/知乎）；低版本或非图片走 SAF。
        if (mime.startsWith("image/") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveImageToGallery(call, src, name, mime);
        } else {
            saveViaSaf(call, src, name, mime);
        }
    }

    /** 图片保存到系统相册（MediaStore Pictures）。 */
    private void saveImageToGallery(PluginCall call, File src, String name, String mime) {
        Uri uri = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            uri = getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("insert into MediaStore failed");
                return;
            }
            try (InputStream in = new FileInputStream(src); OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                copy(in, out);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContext().getContentResolver().update(uri, done, null, null);
            call.resolve();
        } catch (Exception e) {
            if (uri != null) {
                try { getContext().getContentResolver().delete(uri, null, null); } catch (Exception ignored) { }
            }
            call.reject("save image failed: " + e.getMessage());
        }
    }

    /** 其它附件走 SAF：弹系统“保存到”面板，回调用户选中的 Uri 写文件。 */
    private void saveViaSaf(PluginCall call, File src, String name, String mime) {
        try {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mime);
            intent.putExtra(Intent.EXTRA_TITLE, name);
            startActivityForResult(call, intent, "safSaveResult");
        } catch (ActivityNotFoundException e) {
            call.reject("no file picker available: " + e.getMessage());
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void safSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri target = data != null ? data.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || target == null) {
            call.reject("canceled");
            return;
        }
        String path = call.getString("path");
        File src = path != null ? new File(path) : null;
        if (src == null || !src.exists()) {
            call.reject("source file missing");
            return;
        }
        try (InputStream in = new FileInputStream(src); OutputStream out = getContext().getContentResolver().openOutputStream(target)) {
            copy(in, out);
            call.resolve();
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        if (out == null) throw new Exception("cannot open output stream");
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.flush();
    }

    private static String mimeFor(File file) {
        String ext = file.getName();
        int dot = ext.lastIndexOf('.');
        if (dot >= 0) {
            String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.substring(dot + 1).toLowerCase());
            if (type != null) return type;
        }
        return "application/octet-stream";
    }
}
