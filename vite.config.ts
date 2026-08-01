import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "electron/main.ts",
        vite: { build: { outDir: "dist-electron", rollupOptions: { external: ["better-sqlite3", "sharp", /^@aws-sdk\//, /^@smithy\//] } } },
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
  build: { target: "chrome120", outDir: "dist", sourcemap: false },
});
