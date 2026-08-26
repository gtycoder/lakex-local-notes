import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";

/** V5 §5.6 全本地化：lakex 编辑器 CSS/JS 内 gw.alipayobjects.com 资源（字体/图标 SVG/动态加载脚本）
 * 已本地镜像：public/vendor/lakex/alipay/（字体/图标）+ vendor/cdn/（katex/CodeMirror，复用现有本地）。
 * dev/build 统一重写为本地绝对路径，CSP 不再放行外部域。 */
const ALIPAY_JS_REUSE: Record<string, string> = {
  // 动态加载脚本 → 复用 index.html/vendor 已在用的本地文件
  "https://gw.alipayobjects.com/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js": "/vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js",
  "https://gw.alipayobjects.com/render/p/yuyan_v/180020010000005484/7.1.27/CodeMirror.js": "/vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js",
  "https://gw.alipayobjects.com/os/lib/katex/0.16.8/dist/katex.min.js": "/vendor/cdn/os/lib/katex/0.16.8/dist/katex.min.js",
  "https://gw.alipayobjects.com/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js": "/vendor/cdn/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js",
};
/** V5 §5.6：dev/prod 双 CSP（构建期注入，避免 .env 依赖）。
 * dev：vite/react-refresh 内联 preamble 需要 unsafe-inline；
 * prod：script-src 无 unsafe-inline，内联 KITCHEN_URL 脚本用 sha256 hash 放行。
 * 全部资源已本地化（public/vendor/lakex/alipay/ + vendor/cdn/），不放行任何外部域。 */
// 附件内联预览依赖：PDF 走 <embed>（object-src 需放行本地资产服务器）、音视频走 <audio>/<video>
// （media-src 需放行本地资产服务器）。127.0.0.1:* 仅指向本机资产服务器（带 token 校验，非任意站点）。
const DEV_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' http://127.0.0.1:*; style-src 'self' 'unsafe-inline' http://127.0.0.1:*; img-src 'self' data: blob: http://127.0.0.1:*; font-src 'self' data: http://127.0.0.1:*; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:1421; media-src 'self' data: blob: http://127.0.0.1:*; worker-src 'self' blob:; object-src http://127.0.0.1:*; base-uri 'none'; form-action 'none'";
const PROD_CSP = "default-src 'self'; script-src 'self' 'sha256-r1Dc4EBzntnjCYkAEc8BC4xSaA3dOE5dL5hlL2pG/6s='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://127.0.0.1:*; font-src 'self' data: http://127.0.0.1:*; connect-src 'self' http://127.0.0.1:*; media-src 'self' data: blob: http://127.0.0.1:*; worker-src 'self' blob:; object-src http://127.0.0.1:*; base-uri 'none'; form-action 'none'";

function lakexAlipayLocal(): Plugin {
  return {
    name: "lakex-alipay-local",
    enforce: "pre",
    transformIndexHtml(html, ctx) {
      const csp = ctx.mode === "development" ? DEV_CSP : PROD_CSP;
      // 正则强替换 CSP meta 的 content（兼容占位符 %VITE_CSP% 或已被其它步骤写成的旧值——
      // 实测 vite8 收到的 html 里占位符已消失，字面 replace 不匹配导致旧 CSP 残留）
      return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/, `$1${csp}$2`);
    },
    transform(code, id) {
      if (!id.includes("lakex-editor-react-component")) return;
      // JS 模块 id 带 ?v= query，先剥离再判扩展名
      const cleanId = id.split("?")[0];
      if (cleanId.endsWith(".css")) {
        return code.replace(/url\(https:\/\/gw\.alipayobjects\.com\/[^)]+\)/g, (m) => {
          const name = m.slice(4, -1).split("/").pop()!;
          return `url(/vendor/lakex/alipay/${name})`;
        });
      }
      if (cleanId.endsWith(".js") || cleanId.endsWith(".mjs")) {
        return code.replace(/https:\/\/gw\.alipayobjects\.com\/[^"'`\s)]+/g, (m) => {
          const reuse = ALIPAY_JS_REUSE[m];
          if (reuse) return reuse;
          const name = m.split("/").pop()!;
          return `/vendor/lakex/alipay/${name}`;
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    lakexAlipayLocal(),
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
  // lakex CSS 含 alipay 外部 URL，需走源码 transform（lakexAlipayLocal）本地化 → 排除依赖预构建
  optimizeDeps: {
    // Drawnix is loaded on first board use. Pre-bundle it during Vite startup
    // so the lazy import does not race a late dependency optimization and get
    // a stale 504 "Outdated Optimize Dep" response.
    include: ["lakex-drawnix"],
    exclude: ["lakex-editor-react-component"],
    force: true,
  },
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
