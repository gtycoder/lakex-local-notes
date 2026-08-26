package com.lakenotes.mobile;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * 最小原生插件：用系统默认应用打开本地文件（ACTION_VIEW + FileProvider）。
 * 供移动端附件预览「打开」使用（PDF/Office 等走系统阅读器，WebView 无法内嵌渲染）。
 * 用法：Capacitor.Plugins.OpenFile.open({ path: "/abs/path/file.pdf" })
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
