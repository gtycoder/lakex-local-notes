import { defineConfig } from "vitest/config";

// 独立 vitest 配置：不加载 vite.config.ts 里的 react/electron 插件，
// 避免测试阶段触发 electron 构建副作用
export default defineConfig({
  // 独立 vitest 配置：不加载 vite.config.ts 里的 react/electron 插件，
  // 避免测试阶段触发 electron 构建副作用。
  // better-sqlite3 13.x 为 N-API 单二进制（Node/Electron 通用），无需双 ABI alias。
  test: {
    include: ["electron/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/mobile/testSetup.ts"],
  },
});
