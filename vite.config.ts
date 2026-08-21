import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "electron/main.ts",
        vite: { build: { outDir: "dist-electron", rollupOptions: { external: ["better-sqlite3", "sharp", /^electron-log/, /^@aws-sdk\//, /^@smithy\//] } } },
        // CDP 调试：LAKE_CDP_PORT 覆盖端口（默认 9222；开发调试保留，packaged 产物不带此参数）
        onstart: async ({ startup }) => { await startup([".", `--remote-debugging-port=${process.env.LAKE_CDP_PORT ?? "9222"}`]); },
      },
    ]),
  ],
  resolve: {
    alias: {
      "@plait-board/react-board": "lakex-drawnix-react-board",
      "@plait-board/react-text": "lakex-drawnix-react-text",
    },
  },
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
  build: {
    target: "chrome120",
    outDir: "dist",
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // 画板（drawnix + @plait）独立 chunk：不改变加载时机（仍随入口加载），
              // 只把 10MB 单 chunk 中的白板引擎拆出去，为后续懒加载留结构
              name: "drawnix",
              test: /node_modules\/(lakex-drawnix|@plait|@plait-board)/,
            },
          ],
        },
      },
    },
  },
});
