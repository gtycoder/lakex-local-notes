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
/** 少数非 gw host 的运行期图片：镜像后按完整 URL 精确重写（basename 有撞名风险，故用整串精确匹配）。 */
const MIRROR_EXACT: Record<string, string> = {
  "https://mdn.alipayobjects.com/huamei_0prmtq/afts/img/A*KA8xSYmgiYgAAAAAAAAAAAAADvuFAQ/original": "/vendor/lakex/misc/drawnix-default.jpg",
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
  // 本地资源服务（http://127.0.0.1:19876）是 canonical URL 的真实来源：img/media 都要放行
  "img-src 'self' data: blob: https://localhost http://127.0.0.1:*; " +
  "font-src 'self' data:; " +
  "connect-src 'self' blob: https://localhost https://*.s3.cn-north-1.qiniucs.com https://s3.cn-north-1.qiniucs.com http://127.0.0.1:* ws://127.0.0.1:*; " +
  "media-src 'self' data: blob: http://127.0.0.1:*; " +
  "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";

/** 浏览器移动预览宿主页：把 App 包在 390×844 竖屏手机框里（居中、窗口过小自动等比缩放）。
 * 仅用于开发预览，不做发布入口（Capacitor 用 index.html）。生成到 dist-mobile/preview.html。 */
const MOBILE_PREVIEW_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Lake Notes 移动端预览</title>
<style>
  html,body{margin:0;height:100vh;height:100dvh;background:#2b2b30;overflow:hidden;}
  .stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;}
  .phone{width:390px;height:844px;background:#000;border-radius:30px;box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden;flex:none;transform-origin:center center;}
  .phone iframe{width:100%;height:100%;border:0;display:block;background:#fff;}
  .hint{position:fixed;bottom:10px;left:0;right:0;text-align:center;color:#9a9aa0;font:12px/1.4 -apple-system,system-ui,sans-serif;pointer-events:none;}
</style>
</head>
<body>
  <div class="stage"><div class="phone"><iframe src="index.html" allow="clipboard-read; clipboard-write"></iframe></div></div>
  <div class="hint">Lake Notes 移动端预览 · 390×844 · DevTools 设备模式可调试</div>
  <script>
    function fit(){
      const p=document.querySelector('.phone');
      const s=Math.min(1,(window.innerWidth-24)/390,(window.innerHeight-40)/844);
      p.style.transform='scale('+Math.max(0.2,s)+')';
    }
    window.addEventListener('resize',fit);fit();
  </script>
</body>
</html>
`;

function lakexAlipayLocalMobile(): Plugin {
  return {
    name: "lakex-alipay-local-mobile",
    enforce: "pre",
    transformIndexHtml(html) {
      // 正则强替换 CSP meta content（兼容占位符或已被处理成旧值——与桌面同款修复：
      // vite8 收到的 html 里 %VITE_CSP% 可能已消失，字面 replace 不匹配导致旧 CSP 残留）
      return html.replace(
        /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/,
        `$1${MOBILE_CSP}$2`
      );
    },
    /** Capacitor webDir 入口必须是 index.html：构建后复制 mobile.html → index.html；并生成浏览器预览宿主页 */
    closeBundle() {
      fs.copyFileSync("dist-mobile/mobile.html", "dist-mobile/index.html");
      fs.writeFileSync("dist-mobile/preview.html", MOBILE_PREVIEW_HTML);
    },
    transform(code, id) {
      if (!id.includes("lakex-doc-react")) return;
      for (const [from, to] of Object.entries(MIRROR_EXACT)) {
        if (code.includes(from)) code = code.replaceAll(from, to);
      }
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
      return code;
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
  optimizeDeps: { exclude: ["@dlient/lakex-doc-react"] },
  build: {
    target: "chrome120",
    outDir: "dist-mobile",
    sourcemap: false,
    rolldownOptions: {
      input: { mobile: "mobile.html" },
      // 不手动把 Drawnix 合并为共享 chunk：文档页是懒加载路由，
      // 手动分组会让 Drawnix 被首页 HTML modulepreload，抵消懒加载收益。
    },
  },
});
