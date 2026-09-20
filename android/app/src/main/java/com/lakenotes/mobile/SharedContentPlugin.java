package com.lakenotes.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

/**
 * 系统「分享 → Lake Notes」入口（ACTION_SEND）。
 *
 * 原生只做接住：文本原样交给 JS；图片/文件复制到 {@code filesDir/shared-inbox/<name>}
 * （JS 用 `capacitor/filesystem` 的 Directory.Data 读取），随后 JS 打开「小记」框预填。
 * 冷启动读 launch intent；已在运行时走 {@link #handleOnNewIntent}。
 */
@CapacitorPlugin(name = "SharedContent")
public class SharedContentPlugin extends Plugin {

    private static final String INBOX = "shared-inbox";
    private JSObject pending;
    /** 已处理的分享 URI + 复制出的文件名：load 与 onNewIntent 可能对同一次分享各触发一次，用它去重。 */
    private String lastUri;
    private String lastImageFilename;

    @Override
    public void load() {
        readIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        readIntent(intent);
        if (pending != null) {
            // 热启动：通知后清掉 pending，避免 JS 再 consume 到同一条（重复开框）
            notifyListeners("shared", pending, true);
            pending = null;
            lastUri = null;
            lastImageFilename = null;
        }
    }

    private void readIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        JSObject out = new JSObject();
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text != null && !text.isEmpty()) out.put("text", text);
        Uri uri = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri != null) {
            String mime = intent.getType();
            String name;
            if (uri.toString().equals(lastUri) && lastImageFilename != null) {
                name = lastImageFilename; // 同一次分享被两条路径触发：复用已复制的文件，不再复制
            } else {
                name = copyToInbox(uri, mime);
                if (name != null) {
                    lastUri = uri.toString();
                    lastImageFilename = name;
                }
            }
            if (name != null) {
                out.put("imageFilename", name);
                out.put("mimeType", mime == null ? "application/octet-stream" : mime);
            }
        }
        if (out.length() > 0) pending = out;
    }

    private String copyToInbox(Uri uri, String mime) {
        try {
            File dir = new File(getContext().getFilesDir(), INBOX);
            if (!dir.exists() && !dir.mkdirs()) return null;
            File out = new File(dir, UUID.randomUUID().toString().replace("-", "") + extensionFor(mime));
            try (InputStream in = getContext().getContentResolver().openInputStream(uri);
                 OutputStream os = new FileOutputStream(out)) {
                if (in == null) return null;
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            return out.getName();
        } catch (Exception e) {
            Log.w("SharedContentPlugin", "copyToInbox failed", e);
            return null;
        }
    }

    private String extensionFor(String mime) {
        if (mime == null) return ".bin";
        if (mime.startsWith("image/png")) return ".png";
        if (mime.startsWith("image/jpeg")) return ".jpg";
        if (mime.startsWith("image/gif")) return ".gif";
        if (mime.startsWith("image/webp")) return ".webp";
        if (mime.startsWith("image/avif")) return ".avif";
        return ".bin";
    }

    /** JS 启动/回前台时取一次性分享内容（取完即清）。 */
    @PluginMethod
    public void consume(PluginCall call) {
        JSObject result = pending;
        pending = null;
        lastUri = null;
        lastImageFilename = null;
        call.resolve(result != null ? result : new JSObject());
    }
}
