import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import react from "@vitejs/plugin-react";
import { lakexAlipayLocal, lakexGwUrlLocalPostcss } from "./scripts/lakexLocalize";

/** 移动端独立构建配置：
 * - 入口 mobile.html → dist-mobile（桌面 vite.config.ts / dist 零改动，遵守「桌面行为零变化」红线）
 * - 无 electron 插件（Capacitor WebView 宿主）
 * - lakex alipay 资源本地化（含 CSS @import 内联兜底）走 scripts/lakexLocalize.ts —— **与桌面共用一份**，改一处两端生效
 */


/** 移动端 CSP —— **唯一来源**（mobile.html 只留 %MOBILE_CSP% 占位符，构建期注入）：
 * - Capacitor Android WebView 默认 scheme：https://localhost（androidScheme=https）
 * - connect-src 放行七牛 S3 endpoint（https://s3.cn-north-1.qiniucs.com）与桌面资源端口（http://127.0.0.1:*）
 * - 资源全本地化（public/vendor + vendor/cdn），不放行外部 CDN
 * - script-src **已收紧（261010）**：不放开 unsafe-inline / unsafe-eval，内联 KITCHEN_URL 只按 sha256 hash 放行
 *   （hash 与桌面 prod 相同；漂移护栏见 src/mobile/mobileCspSingleSource.test.ts） */
const MOBILE_CSP =
  "default-src 'self' https://localhost capacitor://localhost; " +
  // 261010 收紧：内联脚本只放行 mobile.html 里那一句 KITCHEN_URL 的 sha256 hash（与桌面 prod 同款、hash 相同）；
  // 去掉 unsafe-inline 与 unsafe-eval —— 全产物 chunk 实测不含 new Function/eval，也没有第二个内联脚本。
  // hash 漂移护栏：src/mobile/mobileCspSingleSource.test.ts 会拿 mobile.html 的内联脚本重算并比对。
  "script-src 'self' 'sha256-r1Dc4EBzntnjCYkAEc8BC4xSaA3dOE5dL5hlL2pG/6s=' https://localhost capacitor://localhost; " +
  "style-src 'self' 'unsafe-inline'; " +
  // 本地资源服务（http://127.0.0.1:19876）是 canonical URL 的真实来源：img/media 都要放行
  "img-src 'self' data: blob: https://localhost http://127.0.0.1:*; " +
  "font-src 'self' data:; " +
  // data:（260920）：与桌面同因——画板/文档里的 data URL 图片在引擎导出/预览路径要 fetch 成 blob，不放行会静默失败。
  "connect-src 'self' data: blob: https://localhost https://*.s3.cn-north-1.qiniucs.com https://s3.cn-north-1.qiniucs.com http://127.0.0.1:* ws://127.0.0.1:*; " +
  "media-src 'self' data: blob: http://127.0.0.1:*; " +
  "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";

/** 浏览器移动预览宿主页：把 App 包在 390×844 竖屏手机框里（居中、窗口过小自动等比缩放）。
 * 仅用于开发预览，不做发布入口（Capacitor 用 index.html）。生成到 dist-mobile/preview.html。 */
const MOBILE_PREVIEW_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>LocalLakexNotes 移动端预览</title>
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
  <div class="hint">LocalLakexNotes 移动端预览 · 390×844 · DevTools 设备模式可调试</div>
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

/** 移动端构建收尾：Capacitor webDir 入口必须是 index.html；并生成浏览器预览宿主页。
 * ⚠️ 挂在 **writeBundle**（不是 closeBundle）：writeBundle 保证在产物落盘之后调用，语义上更贴合
 * 「拿写好的 mobile.html 再复制一份」。261012 排查过一次"构建失败"（ENOENT: dist-mobile/mobile.html），
 * 真因其实在上游 —— features.css 的注释里写了 `**` + `/*.css`（星号斜杠提前闭合注释）导致 lightningcss
 * 解析失败、**整次构建在写盘前就中止**；改成 writeBundle 是顺手加固，不是那次的根因。 */
function mobileBundleFinalize(): Plugin {
  return {
    name: "mobile-bundle-finalize",
    enforce: "post",
    writeBundle() {
      fs.copyFileSync("dist-mobile/mobile.html", "dist-mobile/index.html");
      fs.writeFileSync("dist-mobile/preview.html", MOBILE_PREVIEW_HTML);
    },
  };
}

export default defineConfig({
  plugins: [lakexAlipayLocal({ csp: MOBILE_CSP, name: "lakex-alipay-local-mobile" }), mobileBundleFinalize(), react()],
  // CSS @import 内联兜底（与桌面同款）：Vite 会把 vendor 样式内联进入口表、绕过按模块 id 的 transform
  css: { postcss: { plugins: [lakexGwUrlLocalPostcss()] } },
  resolve: {
    alias: {
      "@plait-board/react-board": "lakex-drawnix-react-board",
      "@plait-board/react-text": "lakex-drawnix-react-text",
    },
  },
  // 与桌面 vite.config.ts 同因同修：被 exclude 的 @dlient/lakex-doc-react 内部按需 import 的
  // 重型依赖（画板 @plait/*、思维导图 @xiangfa/*、文本绘图 mermaid/flowchart.ts/@viz-js/viz/@plantuml）
  // 不会被启动预构建 ⇒ 首次打开时 Vite 补优化并发整页 reload。显式 include 后启动即预打包（exclude 保留）。
  optimizeDeps: {
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
  },
  build: {
    target: "chrome120",
    outDir: "dist-mobile",
    sourcemap: false,
    rolldownOptions: {
      input: { mobile: "mobile.html" },
      // 不手动把 Drawnix 合并为共享 chunk：文档页是懒加载路由，
      // 手动分组会让 Drawnix 被首页 HTML modulepreload，抵消懒加载收益。
      //
      // ⚠️ 也不要给 @dlient/lakex-doc-react 加 codeSplitting 分组：实测会把 vendor 内部的
      // 懒加载 chunk（DrawnixBoardCore）的 export 绑定拆坏 —— 打开编辑器即
      // "SyntaxError: Export 'DrawnixBoardCore_..._exports' is not defined in module"、整页白屏。
      // 内核脱离入口的正确做法是**懒加载边界**（NotebookWorkspace / QuickNoteComposer / TrashPreviewPage
      // 都用 React.lazy），不需要手动分组。
    },
  },
});
