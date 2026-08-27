package com.lakenotes.mobile;

import android.content.Context;
import android.util.Log;
import android.webkit.MimeTypeMap;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 本地资产 HTTP 服务（本地优先：canonical URL http://127.0.0.1:19876/{noteId}/{file} 在本机可达）。
 *
 * 背景：移动端编辑/查看态图片原本靠「canonical → blob 注入」显示（127.0.0.1 不可达），但 Lake 的
 * 显示机制（_displayUrl 缓存、上传完成重写 value、临时预览 blob revoke）与注入对抗，反复出现
 * 「上传后图片空白」。本服务让 canonical URL 在手机本地可达 → Lake 原生渲染，与桌面端语义一致，
 * 彻底移除 blob 注入/还原逻辑。
 *
 * 实现：ServerSocket + 固定小线程池（纯 I/O 流式，空闲零资源）。目录 = app 私有 Data/note-assets
 * （与桌面 userData/note-assets 同构，src/mobile/assetFs.ts 写入）。
 * 进程内共享单例：首个 start() 启动 daemon 线程随进程存活，重复 start 幂等。
 */
public final class AssetServer {

    private static final String TAG = "LakeAssetServer";
    /** 与桌面端资源服务器一致的端口（lib/assetPort.ts ASSET_ORIGIN）。 */
    public static final int PORT = 19876;
    private static final int BACKLOG = 8;
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int POOL_SIZE = 4;

    private static volatile ServerSocket sServerSocket;
    private static volatile ExecutorService sExecutor;
    private static final AtomicBoolean sAccepting = new AtomicBoolean(false);

    private AssetServer() {}

    /** 幂等启动（MainActivity.onCreate 调用；daemon 线程随进程退出自动结束）。 */
    public static synchronized void start(Context context) {
        if (sServerSocket != null) return;
        try {
            ServerSocket ss = new ServerSocket(PORT, BACKLOG, InetAddress.getByName("127.0.0.1"));
            sServerSocket = ss;
            ExecutorService ex = Executors.newFixedThreadPool(POOL_SIZE, new ThreadFactory() {
                private final java.util.concurrent.atomic.AtomicInteger n = new java.util.concurrent.atomic.AtomicInteger();
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "lake-asset-" + n.incrementAndGet());
                    t.setDaemon(true);
                    return t;
                }
            });
            sExecutor = ex;
            sAccepting.set(true);
            Thread acceptor = new Thread(() -> acceptLoop(ss, ex, context.getApplicationContext()), "lake-asset-accept");
            acceptor.setDaemon(true);
            acceptor.start();
            Log.i(TAG, "asset server listening on http://127.0.0.1:" + PORT);
        } catch (IOException e) {
            Log.e(TAG, "asset server start failed: " + e.getMessage(), e);
            sServerSocket = null;
        }
    }

    private static void acceptLoop(ServerSocket ss, ExecutorService ex, Context appContext) {
        while (sAccepting.get() && !ss.isClosed()) {
            try {
                Socket socket = ss.accept();
                ex.execute(() -> handle(socket, appContext));
            } catch (IOException e) {
                if (sAccepting.get()) Log.e(TAG, "accept error: " + e.getMessage());
                break;
            }
        }
    }

    private static void handle(Socket socket, Context appContext) {
        try (Socket ignored = socket) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8), BUFFER_SIZE);
            OutputStream out = socket.getOutputStream();
            String requestLine = reader.readLine();
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2 || !"GET".equalsIgnoreCase(parts[0])) {
                writeError(out, 405, "method not allowed");
                return;
            }
            // 丢弃剩余请求头
            for (;;) {
                String line = reader.readLine();
                if (line == null || line.isEmpty()) break;
            }
            String target = parts[1];
            int q = target.indexOf('?');
            if (q >= 0) target = target.substring(0, q);
            String decoded = URLDecoder.decode(target, StandardCharsets.UTF_8.name());
            String rel = decoded.startsWith("/") ? decoded.substring(1) : decoded;
            if (rel.isEmpty()) { writeError(out, 404, "not found"); return; }

            File root = new File(appContext.getFilesDir(), "note-assets");
            File file = new File(root, rel);
            String rootCanonical = root.getCanonicalPath();
            String fileCanonical = file.getCanonicalPath();
            // 目录穿越防护：解析后的路径必须位于 note-assets 下
            if (!fileCanonical.startsWith(rootCanonical + File.separator)) {
                writeError(out, 403, "forbidden");
                return;
            }
            if (!file.isFile()) { writeError(out, 404, "not found"); return; }

            long length = file.length();
            StringBuilder head = new StringBuilder(256);
            head.append("HTTP/1.1 200 OK\r\n");
            head.append("Content-Type: ").append(mimeFor(file.getName())).append("\r\n");
            head.append("Content-Length: ").append(length).append("\r\n");
            // CORS：页面 origin 是 https://localhost（Capacitor 默认），本地资源跨源加载需要放行
            head.append("Access-Control-Allow-Origin: *\r\n");
            head.append("Access-Control-Allow-Methods: GET, HEAD\r\n");
            // 文件名含唯一时间戳后缀，可长缓存（WebView 磁盘缓存，二次加载秒开）
            head.append("Cache-Control: public, max-age=31536000, immutable\r\n");
            head.append("Connection: close\r\n\r\n");
            out.write(head.toString().getBytes(StandardCharsets.UTF_8));
            try (FileInputStream in = new FileInputStream(file); BufferedInputStream bin = new BufferedInputStream(in, BUFFER_SIZE)) {
                byte[] buf = new byte[BUFFER_SIZE];
                int n;
                while ((n = bin.read(buf)) != -1) out.write(buf, 0, n);
            }
            out.flush();
        } catch (Exception e) {
            Log.e(TAG, "handle error: " + e.getMessage(), e);
        }
    }

    private static void writeError(OutputStream out, int code, String msg) throws IOException {
        byte[] body = msg.getBytes(StandardCharsets.UTF_8);
        StringBuilder head = new StringBuilder(128);
        head.append("HTTP/1.1 ").append(code).append(" ").append(msg).append("\r\n");
        head.append("Content-Type: text/plain; charset=utf-8\r\n");
        head.append("Access-Control-Allow-Origin: *\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        head.append("Connection: close\r\n\r\n");
        out.write(head.toString().getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static String mimeFor(String name) {
        int dot = name.lastIndexOf('.');
        if (dot >= 0) {
            String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase());
            if (type != null) return type;
        }
        return "application/octet-stream";
    }
}
