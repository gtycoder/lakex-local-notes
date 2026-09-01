import React from "react";
import ReactDOM from "react-dom/client";
import { MobileApp } from "./MobileApp";
import "../features/editor/image-lightbox.css";
import "../features/attachment/attachment-preview.css";
import "../styles/tokens.css"; // 复用桌面设计令牌（--lake-*）+ focus-visible + reduced-motion
import "./editor/editor-dock.css";

// M3：移动端深色模式——跟随系统偏好设 data-theme，令 tokens.css 的深色令牌生效
const __mq = window.matchMedia?.("(prefers-color-scheme: dark)");
const __applyTheme = () => { document.documentElement.dataset.theme = __mq?.matches ? "dark" : "light"; };
__applyTheme();
__mq?.addEventListener?.("change", __applyTheme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>
);
