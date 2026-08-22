import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import react from "@vitejs/plugin-react";

/** 移动端独立构建配置（M0 POC）：
 * - 入口 mobile.html → dist-mobile（桌面 vite.config.ts / dist 零改动，遵守「桌面行为零变化」红线）
 * - 无 electron 插件（Capacitor WebView 宿主）
 * - lakex alipay 资源本地化逻辑与 vite.config.ts 相同（POC 复制，正式迁移时抽共享模块）
 */

const ALIPAY_JS_REUSE: Record<string, string> = {
  "https://gw.alipayobjects.com/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js": "/vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js",
  "https://gw.alipayobjects.com/render/p/yuyan_v/180020010000005484/7.1.27/CodeMirror.js": "/vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js",
  "https://gw.alipayobjects.com/os/lib/katex/0.16.8/dist/katex.min.js": "/vendor/cdn/os/lib/katex/0.16.8/dist/katex.min.js",
  "https://gw.alipayobjects.com/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js": "/vendor/cdn/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js",
};

/** 移动端 CSP（M0 POC）：
 * - Capacitor Android WebView 默认 scheme：https://localhost（androidScheme=https）
 * - connect-src 放行七牛 S3 endpoint（https://s3.cn-north-1.qiniucs.com）与桌面资源端口（http://127.0.0.1:*）
 * - 资源全本地化（public/vendor + vendor/cdn），不放行外部 CDN
 * - POC 阶段 script-src 含 'unsafe-inline'（KITCHEN_URL 内联脚本）；正式版按桌面 prod 用 sha256 hash 收紧 */
const MOBILE_CSP =
  "default-src 'self' https://localhost capacitor://localhost; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://localhost capacitor://localhost; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https://localhost; " +
  "font-src 'self' data:; " +
  "connect-src 'self' https://localhost https://*.s3.cn-north-1.qiniucs.com https://s3.cn-north-1.qiniucs.com http://127.0.0.1:* ws://127.0.0.1:*; " +
  "media-src 'self' data: blob:; " +
  "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";

function lakexAlipayLocalMobile(): Plugin {
  return {
    name: "lakex-alipay-local-mobile",
    enforce: "pre",
    transformIndexHtml(html) {
      return html.replace(
        '<meta http-equiv="Content-Security-Policy" content="%VITE_CSP%" />',
        `<meta http-equiv="Content-Security-Policy" content="${MOBILE_CSP}" />`
      );
    },
    /** Capacitor webDir 入口必须是 index.html：构建后复制 mobile.html → index.html */
    closeBundle() {
      fs.copyFileSync("dist-mobile/mobile.html", "dist-mobile/index.html");
    },
    transform(code, id) {
      if (!id.includes("lakex-editor-react-component")) return;
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
  plugins: [lakexAlipayLocalMobile(), react()],
  resolve: {
    alias: {
      "@plait-board/react-board": "lakex-drawnix-react-board",
      "@plait-board/react-text": "lakex-drawnix-react-text",
    },
  },
  optimizeDeps: { exclude: ["lakex-editor-react-component"] },
  build: {
    target: "chrome120",
    outDir: "dist-mobile",
    sourcemap: false,
    rolldownOptions: {
      input: { mobile: "mobile.html" },
      output: {
        codeSplitting: {
          groups: [
            {
              name: "drawnix",
              test: /node_modules\/(lakex-drawnix|@plait|@plait-board)/,
            },
          ],
        },
      },
    },
  },
});
