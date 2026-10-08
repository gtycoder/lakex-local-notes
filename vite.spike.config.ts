import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Univer 技术验证 spike（分支 spike/univer-sheet）——独立 vite 配置，不碰应用构建。
 * CSP 字符串与 vite.config.ts 的 DEV_CSP / PROD_CSP 保持一致（spike 独立于应用，故此处复制一份；
 * 正式接入时应改用同一来源，避免漂移）。
 */
const DEV_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' http://127.0.0.1:*; style-src 'self' 'unsafe-inline' http://127.0.0.1:*; img-src 'self' data: blob: http://127.0.0.1:*; font-src 'self' data: http://127.0.0.1:*; connect-src 'self' data: http://127.0.0.1:* ws://127.0.0.1:1422; media-src 'self' data: blob: http://127.0.0.1:*; worker-src 'self' blob:; object-src http://127.0.0.1:*; frame-src http://127.0.0.1:*; base-uri 'none'; form-action 'none'";
const PROD_CSP = "default-src 'self'; script-src 'self' 'sha256-r1Dc4EBzntnjCYkAEc8BC4xSaA3dOE5dL5hlL2pG/6s='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://127.0.0.1:*; font-src 'self' data: http://127.0.0.1:*; connect-src 'self' data: http://127.0.0.1:*; media-src 'self' data: blob: http://127.0.0.1:*; worker-src 'self' blob:; object-src http://127.0.0.1:*; frame-src http://127.0.0.1:*; base-uri 'none'; form-action 'none'";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "spike-csp",
      transformIndexHtml(html: string) {
        const csp = mode === "development" ? DEV_CSP : PROD_CSP;
        return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/, `$1${csp}$2`);
      },
    },
  ],
  server: { host: "127.0.0.1", port: 1422, strictPort: true },
  build: {
    target: "chrome120",
    outDir: "dist-spike",
    sourcemap: false,
    rollupOptions: { input: "spike-univer.html" },
  },
}));
