import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 独立 vitest 配置：不加载 vite.config.ts 里的 react/electron 插件，
// 避免测试阶段触发 electron 构建副作用
export default defineConfig({
  // Store 层 DB 测试需要 better-sqlite3 的 Node ABI 构建（仓库内 node_modules 是
  // Electron ABI，@electron/rebuild 后 Node 无法加载）。双 ABI 方案：test-node-abi/
  // 里单独装一份 Node ABI 构建（见 README/交接文档），测试时 alias 过去。
  resolve: {
    alias: {
      "better-sqlite3": fileURLToPath(new URL("./test-node-abi/node_modules/better-sqlite3", import.meta.url)),
    },
  },
  test: {
    include: ["electron/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
