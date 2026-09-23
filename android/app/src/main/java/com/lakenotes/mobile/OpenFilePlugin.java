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

    /**
     * 路径围栏：只允许 app 私有目录（filesDir / externalFilesDir）下的文件。
     * WebView 侧参数不可信——防止插件被诱导打开任意绝对路径（如 /data/data/其他包/…）。
     */
    /**
     * 扩展名围栏（与桌面 isSafeShellOpenFilename 对齐，DS 复核 A4：native 侧也拦，防 WebView 被控绕过 TS 层）。
     * 执行类 + svg（CSP 在 file:// 无效）+ 未知扩展名 fail-closed。
     */
    static boolean isSafeShellOpenName(String name) {
        int dot = name.lastIndexOf('.');
        if (dot <= 0 || dot == name.length() - 1) return false;
        String ext = name.substring(dot + 1).toLowerCase(java.util.Locale.ROOT);
        switch (ext) {
            case "exe": case "com": case "bat": case "cmd": case "ps1": case "psm1":
            case "vbs": case "vbe": case "js": case "jse": case "wsf": case "wsh":
            case "msi": case "msp": case "scr": case "pif": case "hta": case "cpl":
            case "jar": case "apk": case "app": case "command": case "sh": case "bash":
            case "zsh": case "dll": case "so": case "dylib": case "bin": case "run":
            case "out": case "appimage": case "deb": case "rpm": case "dmg": case "pkg":
            case "svg":
                return false;
            default:
                // 未知扩展名拒绝；常见文档/媒体/压缩包放行
                switch (ext) {
                    case "pdf": case "doc": case "docx": case "xls": case "xlsx": case "ppt": case "pptx":
                    case "txt": case "md": case "csv": case "rtf": case "epub": case "key": case "pages": case "numbers":
                    case "zip": case "rar": case "7z": case "tar": case "gz": case "bz2": case "xz":
                    case "mp3": case "wav": case "m4a": case "aac": case "flac": case "ogg": case "wma":
                    case "mp4": case "mov": case "mkv": case "avi": case "webm": case "m4v": case "wmv": case "flv":
                    case "json": case "png": case "jpg": case "jpeg": case "gif": case "webp": case "avif":
                    case "apng": case "bmp": case "ico": case "tiff": case "tif":
                        return true;
                    default:
                        return false;
                }
        }
    }

    private boolean isUnderAppSandbox(File file) {
        try {
            String canonical = file.getCanonicalPath();
            File[] roots = new File[] {
                getContext().getFilesDir(),
                getContext().getExternalFilesDir(null),
            };
            for (File root : roots) {
                if (root == null) continue;
                String rootPath = root.getCanonicalPath();
                if (canonical.equals(rootPath) || canonical.startsWith(rootPath + File.separator)) {
                    return true;
                }
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path required");
            return;
        }
        File file = new File(path);
        if (!isUnderAppSandbox(file)) {
            call.reject("path outside app sandbox");
            return;
        }
        if (!isSafeShellOpenName(file.getName())) {
            call.reject("file type not allowed for shell open");
            return;
        }
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
        if (!isUnderAppSandbox(src)) {
            call.reject("path outside app sandbox");
            return;
        }
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
        if (src == null || !isUnderAppSandbox(src) || !src.exists()) {
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
