import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installPasteInterceptor } from "./features/editor/clipboardHtml";
import "lakex-editor-react-component/style.css";
import "./styles.css";

// 必须在编辑器创建前安装：拦截粘贴时对 text/html 的读取（原生 paste 的 DataTransfer 只读）
installPasteInterceptor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
