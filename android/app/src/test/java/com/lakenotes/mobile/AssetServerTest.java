package com.lakenotes.mobile;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

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
}
