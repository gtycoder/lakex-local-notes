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
    // 默认仍只收 node 环境的 .test.ts；额外两条例外各自最小：
    // - src/**/*.render.test.tsx：DT-04 桌面行为护栏试点（文件头用 @vitest-environment jsdom 逐文件切换环境，
    //   不改变全局 node 默认；扩展方式 = 复制该命名 + 只在文件内 render，不要引入 testing-library）；
    // - scripts/**/*.test.ts：只收 CSS 审计等脚本的自证用例（同样是 node 环境）。
    include: ["electron/**/*.test.ts", "src/**/*.test.ts", "src/**/*.render.test.tsx", "scripts/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/mobile/testSetup.ts"],
  },
});
