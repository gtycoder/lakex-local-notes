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
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
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
    /** Capacitor 当前配置 androidScheme=http，页面固定 origin 是 http://localhost。 */
    private static final String ALLOWED_ORIGIN = "http://localhost";

    private static volatile ServerSocket sServerSocket;
    private static volatile ExecutorService sExecutor;
    private static volatile String sToken;
    private static final AtomicBoolean sAccepting = new AtomicBoolean(false);

    private AssetServer() {}

    /** 幂等启动（MainActivity.onCreate 调用；daemon 线程随进程退出自动结束）。 */
    public static synchronized String start(Context context) {
        if (sServerSocket != null) return sToken;
        String token = randomToken();
        try {
            ServerSocket ss = new ServerSocket(PORT, BACKLOG, InetAddress.getByName("127.0.0.1"));
            sServerSocket = ss;
            sToken = token;
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
            return token;
        } catch (IOException e) {
            Log.e(TAG, "asset server start failed: " + e.getMessage(), e);
            sServerSocket = null;
            sToken = null;
            return null;
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
            boolean isHead = "HEAD".equalsIgnoreCase(parts[0]);
            if (parts.length < 2 || (!"GET".equalsIgnoreCase(parts[0]) && !isHead)) {
                writeError(out, 405, "method not allowed");
                return;
            }
            // 读取剩余请求头（捕获 Range——音频/视频 seek 需要 206 部分响应）
            String rangeHeader = null;
            String originHeader = null;
            for (;;) {
                String line = reader.readLine();
                if (line == null || line.isEmpty()) break;
                if (line.regionMatches(true, 0, "Range:", 0, 6)) rangeHeader = line.substring(6).trim();
                if (line.regionMatches(true, 0, "Origin:", 0, 7)) originHeader = line.substring(7).trim();
            }
            String target = parts[1];
            // 用 URI.getPath() 解码路径：URLDecoder 会把 '+' 解码成空格（小记文件名可能含 '+'），
            // URI.getPath() 保留 '+' 且自动剥离 query 段
            String decoded;
            try {
                URI uri = new URI(target);
                decoded = uri.getPath() != null ? uri.getPath() : target;
                if (!isAuthorized(uri, originHeader)) {
                    writeError(out, 403, "forbidden");
                    return;
                }
            } catch (Exception e) {
                decoded = target;
                writeError(out, 403, "forbidden");
                return;
            }
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
            String mime = mimeFor(file.getName());
            if ("application/octet-stream".equals(mime)) {
                String sniffed = sniffMime(file);
                if (sniffed != null) mime = sniffed;
            }
            // Range 支持（音频/视频 seek、PDF 分页）：浏览器 seek 需要 206 Partial Content + Accept-Ranges，
            // 否则 seekable 只有 [0,0]，进度条无法拖动。解析 bytes=start-end / bytes=-N / bytes=start-
            long start = -1;
            long end = -1;
            if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                String spec = rangeHeader.substring(6).trim();
                int dash = spec.indexOf('-');
                if (dash >= 0) {
                    String s = spec.substring(0, dash).trim();
                    String e = spec.substring(dash + 1).trim();
                    if (!s.isEmpty()) {
                        try { start = Long.parseLong(s); } catch (NumberFormatException ex) { start = -2; }
                    }
                    if (!e.isEmpty()) {
                        try { end = Long.parseLong(e); } catch (NumberFormatException ex) { end = -2; }
                    }
                }
            }
            boolean isRange = start >= 0 || end >= 0;
            if (isRange && start == -1) {
                // bytes=-N → 最后 N 字节
                long n = end;
                if (n > 0) { start = Math.max(0, length - n); end = length - 1; }
                else { isRange = false; }
            }
            if (isRange && start == -2) { isRange = false; } // 非法 start
            // bytes=start-（end 未指定/-1/-2）→ 到文件末尾。此前 end 保持 -1 时
            // Content-Length = end-start+1 = 0 → 媒体元素拿到 0 字节 → SRC_NOT_SUPPORTED
            if (isRange && end < 0) { end = length - 1; }
            if (isRange && start >= length) {
                // 范围越界 → 416（Content-Range: bytes */length）
                writeErrorWithRange(out, length);
                return;
            }
            if (isRange && end >= length) end = length - 1;
            StringBuilder head = new StringBuilder(256);
            if (isRange) {
                head.append("HTTP/1.1 206 Partial Content\r\n");
                head.append("Content-Range: bytes ").append(start).append("-").append(end).append("/").append(length).append("\r\n");
                head.append("Content-Length: ").append(end - start + 1).append("\r\n");
            } else {
                head.append("HTTP/1.1 200 OK\r\n");
                head.append("Content-Length: ").append(length).append("\r\n");
            }
            head.append("Content-Type: ").append(mime).append("\r\n");
            // CORS：仅放行本应用 WebView 的固定 origin；无 Origin 的媒体/图片请求由 token 保护。
            head.append("Access-Control-Allow-Origin: ").append(ALLOWED_ORIGIN).append("\r\n");
            head.append("Access-Control-Allow-Methods: GET, HEAD\r\n");
            head.append("Accept-Ranges: bytes\r\n");
            // 文件名含唯一时间戳后缀，可长缓存（WebView 磁盘缓存，二次加载秒开）
            head.append("Cache-Control: public, max-age=31536000, immutable\r\n");
            head.append("Connection: close\r\n\r\n");
            out.write(head.toString().getBytes(StandardCharsets.UTF_8));
            if (!isHead) {
                if (isRange) {
                    // 部分读取（seek 场景），跳过 start 字节后流式输出 end-start+1 字节
                    try (FileInputStream in = new FileInputStream(file)) {
                        long skip = start;
                        while (skip > 0) {
                            long s = in.skip(skip);
                            if (s <= 0) break;
                            skip -= s;
                        }
                        long remaining = end - start + 1;
                        byte[] buf = new byte[BUFFER_SIZE];
                        int n;
                        while (remaining > 0 && (n = in.read(buf, 0, (int) Math.min(BUFFER_SIZE, remaining))) != -1) {
                            out.write(buf, 0, n);
                            remaining -= n;
                        }
                    }
                } else {
                    try (FileInputStream in = new FileInputStream(file); BufferedInputStream bin = new BufferedInputStream(in, BUFFER_SIZE)) {
                        byte[] buf = new byte[BUFFER_SIZE];
                        int n;
                        while ((n = bin.read(buf)) != -1) out.write(buf, 0, n);
                    }
                }
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
        head.append("Content-Length: ").append(body.length).append("\r\n");
        head.append("Connection: close\r\n\r\n");
        out.write(head.toString().getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    /** 416 Range Not Satisfiable（范围越界）：带 Content-Range: bytes 星号/分号 {size}。 */
    private static void writeErrorWithRange(OutputStream out, long size) throws IOException {
        byte[] body = "range not satisfiable".getBytes(StandardCharsets.UTF_8);
        StringBuilder head = new StringBuilder(128);
        head.append("HTTP/1.1 416 Range Not Satisfiable\r\n");
        head.append("Content-Type: text/plain; charset=utf-8\r\n");
        head.append("Content-Range: bytes */").append(size).append("\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        head.append("Connection: close\r\n\r\n");
        out.write(head.toString().getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static boolean isAuthorized(URI uri, String origin) {
        if (sToken == null) return false;
        String token = queryParameter(uri, "token");
        if (token == null) return false;
        boolean tokenMatches = MessageDigest.isEqual(
            token.getBytes(StandardCharsets.UTF_8),
            sToken.getBytes(StandardCharsets.UTF_8)
        );
        return tokenMatches && (origin == null || ALLOWED_ORIGIN.equals(origin));
    }

    private static String queryParameter(URI uri, String name) {
        String query = uri.getRawQuery();
        if (query == null) return null;
        for (String pair : query.split("&")) {
            int equals = pair.indexOf('=');
            String key = equals >= 0 ? pair.substring(0, equals) : pair;
            if (!name.equals(key)) continue;
            String value = equals >= 0 ? pair.substring(equals + 1) : "";
            try {
                return URLDecoder.decode(value, "UTF-8");
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }

    private static String randomToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        StringBuilder token = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) token.append(String.format("%02x", value));
        return token.toString();
    }

    /** Android MimeTypeMap 对部分音频返回 x- 变体（如 wav → audio/x-wav），WebView <audio> 不识别，
     * 导致音频无 source 不加载——按标准 MIME 覆盖（与桌面 assetServer MIME_MAP 对齐）。 */
    private static final java.util.Map<String, String> MIME_OVERRIDES = java.util.Map.ofEntries(
        java.util.Map.entry("wav", "audio/wav"),
        java.util.Map.entry("mp3", "audio/mpeg"),
        java.util.Map.entry("m4a", "audio/mp4"),
        java.util.Map.entry("aac", "audio/aac"),
        java.util.Map.entry("flac", "audio/flac"),
        java.util.Map.entry("ogg", "audio/ogg"),
        java.util.Map.entry("oga", "audio/ogg"),
        java.util.Map.entry("mp4", "video/mp4"),
        java.util.Map.entry("m4v", "video/mp4"),
        java.util.Map.entry("mov", "video/quicktime"),
        java.util.Map.entry("webm", "video/webm"),
        java.util.Map.entry("mkv", "video/x-matroska"),
        java.util.Map.entry("avi", "video/x-msvideo"),
        java.util.Map.entry("pdf", "application/pdf")
    );

    private static String mimeFor(String name) {
        int dot = name.lastIndexOf('.');
        if (dot >= 0) {
            String ext = name.substring(dot + 1).toLowerCase();
            String override = MIME_OVERRIDES.get(ext);
            if (override != null) return override;
            String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (type != null) return type;
        }
        return "application/octet-stream";
    }

    /** 图片魔数嗅探（对齐桌面 assetServer.sniffMime）：扩展名缺失/异常时按文件头判断，
     * 保证 <img> 渲染正确（WebView 按 Content-Type 决定图片解码路径）。 */
    private static String sniffMime(File file) {
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] head = new byte[16];
            int n = in.read(head);
            if (n >= 8) {
                int b0 = head[0] & 0xFF;
                if (b0 == 0x89 && head[1] == 'P' && head[2] == 'N' && head[3] == 'G') return "image/png";
                if (b0 == 0xFF && (head[1] & 0xFF) == 0xD8 && (head[2] & 0xFF) == 0xFF) return "image/jpeg";
                if (head[0] == 'G' && head[1] == 'I' && head[2] == 'F' && head[3] == '8') return "image/gif";
                if (head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F'
                        && head[8] == 'W' && head[9] == 'E' && head[10] == 'B' && head[11] == 'P') return "image/webp";
                if (head[4] == 'f' && head[5] == 't' && head[6] == 'y' && head[7] == 'p' && n >= 12) {
                    String brand = new String(head, 8, 4, StandardCharsets.US_ASCII);
                    if ("avif".equals(brand) || "avis".equals(brand)) return "image/avif";
                }
            }
            String ascii = new String(head, 0, Math.max(0, n), StandardCharsets.US_ASCII);
            if (ascii.startsWith("<svg") || ascii.startsWith("<?xml")) return "image/svg+xml";
        } catch (IOException e) {
            Log.w(TAG, "mime sniff failed: " + e.getMessage());
        }
        return null;
    }
}
