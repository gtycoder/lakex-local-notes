import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installPasteInterceptor } from "./features/editor/clipboardHtml";
import { loadSettings } from "./lib/settings";
import { applyTheme } from "./lib/theme";
import "./styles/index.css";   // 样式单入口：@layer 层序 + 旧样式整体入 legacy 层（见 docs/UI-REDESIGN-260921/README.md §3.1）

// 首帧前应用主题，避免闪烁（App 挂载后的 settings 订阅会继续跟随变化）
applyTheme(loadSettings().theme);

// 开发期字体试用切换器（P3：试用后定默认；不进设置项、不落盘、仅 dev）
if (import.meta.env.DEV) void import("./lib/fontTrial").then((m) => m.installFontTrial());

// 必须在编辑器创建前安装：拦截粘贴时对 text/html 的读取（原生 paste 的 DataTransfer 只读）
installPasteInterceptor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
