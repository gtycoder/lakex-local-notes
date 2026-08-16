import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installPasteInterceptor } from "./features/editor/clipboardHtml";
import "lakex-editor-react-component/style.css";
import "./styles.css";
import "./features/outline/outline.css";
// 思源视觉层移植：令牌（daylight/midnight）→ 基础接线（覆盖层，最后加载）
import "./b3/theme-daylight.css";
import "./b3/theme-midnight.css";
import "./b3/base.css";
import "./b3/components.css";
import "./b3/siyuan.scss";

// 必须在编辑器创建前安装：拦截粘贴时对 text/html 的读取（原生 paste 的 DataTransfer 只读）
installPasteInterceptor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
