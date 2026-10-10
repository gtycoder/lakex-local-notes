import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import { lakexAlipayLocal, lakexGwUrlLocalPostcss } from "./scripts/lakexLocalize";

/** V5 §5.6 全本地化：lakex 编辑器 CSS/JS 内 gw.alipayobjects.com 资源（字体/图标 SVG/动态加载脚本）
 * 已本地镜像：public/vendor/lakex/alipay/（字体/图标）+ vendor/cdn/（katex/CodeMirror，复用现有本地）。
 * dev/build 统一重写为本地绝对路径，CSP 不再放行外部域。 */
// 镜像映射表 + CSS 兜底 + transform 都在 scripts/lakexLocalize.ts（**桌面与移动端共用一份**，改一处两端生效）。
/** V5 §5.6：dev/prod 双 CSP（构建期注入，避免 .env 依赖）。
 * dev：vite/react-refresh 内联 preamble 需要 unsafe-inline；
 * prod：script-src 无 unsafe-inline，内联 KITCHEN_URL 脚本用 sha256 hash 放行。
 * 全部资源已本地化（public/vendor/lakex/alipay/ + vendor/cdn/），不放行任何外部域。 */
// 附件内联预览依赖：PDF 走 <embed>（object-src 需放行本地资产服务器）、音视频走 <audio>/<video>
// （media-src 需放行本地资产服务器）。127.0.0.1:* 仅指向本机资产服务器（带 token 校验，非任意站点）。
// connect-src 里的 `data:`（260920）：画板引擎的导出/预览会把画布里的 <img> 转 base64（`fetch(url)` → blob →
// FileReader），而画板的内存口径是 data URL（磁盘口径是资产 URL）⇒ 不放行 data: 时 fetch 被 CSP 拦掉、
// 「导出 PNG/SVG」静默失败。data: 无网络来源，放行它不构成外发通道（img-src/font-src 早已放行 data:）。
const DEV_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' http://127.0.0.1:*; style-src 'self' 'unsafe-inline' http://127.0.0.1:*; img-src 'self' data: blob: http://127.0.0.1:*; font-src 'self' data: http://127.0.0.1:*; connect-src 'self' data: http://127.0.0.1:* ws://127.0.0.1:1421; media-src 'self' data: blob: http://127.0.0.1:*; worker-src 'self' blob:; object-src http://127.0.0.1:*; frame-src http://127.0.0.1:*; base-uri 'none'; form-action 'none'";
const PROD_CSP = "default-src 'self'; script-src 'self' 'sha256-r1Dc4EBzntnjCYkAEc8BC4xSaA3dOE5dL5hlL2pG/6s='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://127.0.0.1:*; font-src 'self' data: http://127.0.0.1:*; connect-src 'self' data: http://127.0.0.1:*; media-src 'self' data: blob: http://127.0.0.1:*; worker-src 'self' blob:; object-src http://127.0.0.1:*; frame-src http://127.0.0.1:*; base-uri 'none'; form-action 'none'";

/** 移动端/桌面共用的本地化实现见 scripts/lakexLocalize.ts（见该文件头注释与「未结项」登记）。 */

/** 主进程运行期依赖（package.json dependencies）：派生 external，而不是逐个硬编码。
 *  硬编码的旧写法（better-sqlite3/sharp/electron-log/@aws-sdk…）在新增原生依赖或传递依赖时
 *  会漏项 —— 漏项 = 该依赖被打进 bundle，打包后才炸。@smithy 是 @aws-sdk 的传递依赖，仍需显式列出。 */
const mainPkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string> };
const mainRuntimeDeps = Object.keys(mainPkg.dependencies ?? {});
function isMainProcessExternal(id: string): boolean {
  if (id.startsWith("node:") || id === "electron" || id.startsWith("electron/")) return true;
  if (id.startsWith("@smithy/")) return true; // @aws-sdk/client-s3 的传递依赖
  return mainRuntimeDeps.some((dep) => id === dep || id.startsWith(dep + "/"));
}

export default defineConfig({
  plugins: [
    lakexAlipayLocal({ csp: (mode) => (mode === "development" ? DEV_CSP : PROD_CSP), name: "lakex-alipay-local" }),
    react(),
    electron([
      {
        entry: "electron/main.ts",
        vite: { build: { outDir: "dist-electron", rollupOptions: { external: isMainProcessExternal } } },
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
  css: { postcss: { plugins: [lakexGwUrlLocalPostcss()] } },
  // lakex CSS 含 alipay 外部 URL，需走源码 transform（lakexAlipayLocal）本地化 → 排除依赖预构建
  optimizeDeps: {
    // 必须把「被 exclude 的 vendor 包内部按需 import 的重型依赖」全部预打包。
    // Vite 不扫描被 exclude 依赖（@dlient/lakex-doc-react）的 import，所以这些依赖若只出现在
    // 该包内部（画板 @plait/*、思维导图 @xiangfa/*、文本绘图 mermaid/flowchart.ts/@viz-js/viz/@plantuml），
    // 启动时不会被预构建；等到「第一次真正用到」（首次打开画板/思维导图/文本绘图卡）才被发现
    // → Vite 重优化依赖并发整页 reload（dev 表现为：界面白屏数秒，且 bootstrap 只重开
    // lastOpenedNoteId ⇒ 其余已打开标签被关掉，仅剩当前文档）。
    // 放进 include 后启动即预打包，懒加载不再触发运行期重优化。
    include: [
      "lakex-drawnix",
      "@plait/core",
      "@plait/common",
      "@plait/draw",
      "@plait/mind",
      "@plait/text-plugins",
      "@xiangfa/mindmap",
      "@xiangfa/mindmap/viewer",
      "mermaid",
      "flowchart.ts",
      "@viz-js/viz",
      "@plantuml/core/plantuml.js",
      "@plantuml/core/viz-global.js",
    ],
    exclude: ["@dlient/lakex-doc-react"],
    force: true,
  },
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
  build: {
    target: "chrome120",
    outDir: "dist",
    sourcemap: false,
    // 260923 移除手工 rolldown codeSplitting（原把 lakex-drawnix|@plait 拆成 "drawnix" chunk）：
    // 该分组会拆坏 vendor 内部绑定 —— 生产构建下画板（内联 drawing-drawnix 卡与 kind=board 文档）
    // 抛 "TypeError: Wt is not a function"，画布完全不渲染（test:packaged 的 drawnix smoke 必现）。
    // A/B 实测：删掉该分组后画板恢复；且 index chunk 体积几乎不变（6.615MB→6.614MB）——
    // 它既没省首屏又引入崩溃。画板引擎仍由 BoardEditor/DrawnixBoardCore 的动态 import 懒加载。
  },
});
