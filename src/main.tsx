import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installPasteInterceptor } from "./features/editor/clipboardHtml";
import { loadSettings } from "./lib/settings";
import { applyTheme } from "./lib/theme";
import "lakex-editor-react-component/style.css";
import "./styles.css";
import "./features/outline/outline.css";
// 思源视觉层移植：令牌（daylight/midnight）→ 基础接线（覆盖层，最后加载）
import "./b3/theme-daylight.css";
import "./b3/theme-midnight.css";
import "./b3/base.css";
import "./b3/components.css";
import "./b3/siyuan.scss";
import "./b3/dark.css";
import "./b3/animations.css";
import "./b3/layout.css";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/overlays.css";
import "./styles/editor-bridge.css";

// 首帧前应用主题，避免闪烁（App 挂载后的 settings 订阅会继续跟随变化）
applyTheme(loadSettings().theme);

// 必须在编辑器创建前安装：拦截粘贴时对 text/html 的读取（原生 paste 的 DataTransfer 只读）
installPasteInterceptor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
