package com.lakenotes.mobile;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class AssetServerTest {
    private static File tempFileWith(byte[] bytes) throws IOException {
        File file = File.createTempFile("lake-mime", ".bin");
        file.deleteOnExit();
        Files.write(file.toPath(), bytes);
        return file;
    }

    @Test
    public void webpSniffRequiresCompleteHeader() throws IOException {
        byte[] riffWithoutWebpBrand = {'R', 'I', 'F', 'F', 0, 0, 0, 0};
        assertNull(AssetServer.sniffMime(tempFileWith(riffWithoutWebpBrand)));
    }

    @Test
    public void webpSniffAcceptsCompleteHeader() throws IOException {
        byte[] webpHeader = {'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'E', 'B', 'P'};
        assertEquals("image/webp", AssetServer.sniffMime(tempFileWith(webpHeader)));
    }

    /** 与桌面 assetServer 同语义：<img> 等非 CORS 请求（无 Origin）不要求 token。 */
    @Test
    public void noOriginRequestIsAllowedWithoutToken() throws Exception {
        URI uri = new URI("/note-1/pic.jpg");
        assertTrue(AssetServer.isAuthorized(uri, null));
    }

    /** CORS 请求：本应用 origin 且缺 token → 拒绝（sToken 未设时同样拒绝）。 */
    @Test
    public void allowedOriginWithoutTokenIsRejected() throws Exception {
        URI uri = new URI("/note-1/pic.jpg");
        assertFalse(AssetServer.isAuthorized(uri, "http://localhost"));
    }

    /** CORS 请求：外部网页 origin（即使伪造 token）→ 拒绝。 */
    @Test
    public void foreignOriginIsRejected() throws Exception {
        URI uri = new URI("/note-1/pic.jpg?token=x");
        assertFalse(AssetServer.isAuthorized(uri, "http://evil.com"));
    }
}
