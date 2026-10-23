import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installPasteInterceptor } from "./features/editor/clipboardHtml";
import { installImageCopyBridge } from "./features/editor/imageCopyBridge";
import { loadSettings } from "./lib/settings";
import { applyTheme } from "./lib/theme";
import "./styles/index.css";   // 样式单入口：@layer 层序 + 旧样式整体入 legacy 层（见 docs/DESIGN.md §3.1）
import "./styles/vendor-focus.css";   // 261023：第三方编辑器 UI 的焦点视觉归属（unlayered，压过 vendor 层）

// 首帧前应用主题，避免闪烁（App 挂载后的 settings 订阅会继续跟随变化）
applyTheme(loadSettings().theme);

// 开发期字体试用切换器（P3：试用后定默认；不进设置项、不落盘、仅 dev）
if (import.meta.env.DEV) void import("./lib/fontTrial").then((m) => m.installFontTrial());

// 开发期「未分层全局 CSS」探针（261021）：第三方 CSS 若绕过 @layer 进文档，控制台立刻可见；
// 判据与产物审计共用 src/lib/cssLayerScan.ts。e2e 可调 window.__cssLayerProbe() 取命中。
if (import.meta.env.DEV) void import("./lib/cssLayerProbe").then((m) => m.installCssLayerProbe());

// 开发期「第三方控件叠了全局焦点环」探针（261023）：表格/内核弹窗里的输入框若又出现两层边框，
// 聚焦时控制台立刻报；e2e 可调 window.__vendorFocusProbe() 取命中（空数组 = 干净）。
if (import.meta.env.DEV) void import("./lib/vendorFocusProbe").then((m) => m.installVendorFocusProbe());

// 必须在编辑器创建前安装：拦截粘贴时对 text/html 的读取（原生 paste 的 DataTransfer 只读）
installPasteInterceptor();

// 内核图片卡「复制」按钮改走我们的复制入口（写真实图片字节；内核私有 ne-clipboard 里的本地 canonical
// URL 粘到外部应用拿不到图片）。见 imageCopyBridge.ts。
installImageCopyBridge();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
