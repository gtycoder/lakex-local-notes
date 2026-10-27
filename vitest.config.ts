import { realpathSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// 独立 vitest 配置：不加载 vite.config.ts 里的 react/electron 插件，
// 避免测试阶段触发 electron 构建副作用
export default defineConfig({
  // 独立 vitest 配置：不加载 vite.config.ts 里的 react/electron 插件，
  // 避免测试阶段触发 electron 构建副作用。
  // better-sqlite3 13.x 为 N-API 单二进制（Node/Electron 通用），无需双 ABI alias。
  server: {
    fs: {
      // worktree 的 node_modules 通常是软链到主 clone；vite 默认拒绝软链外的文件，
      // 这里把真实路径加入 allow（否则 sql.js 的 ?url 资源会被 Denied ID，render 类用例整文件失败）。
      allow: [process.cwd(), realpathSync(path.join(process.cwd(), "node_modules"))],
    },
  },
  test: {
    include: ["electron/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/mobile/testSetup.ts"],
  },
});
