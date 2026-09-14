import React from "react";
import ReactDOM from "react-dom/client";
import { MobileApp } from "./MobileApp";
import { applyTheme } from "../lib/theme";
import { loadSettings, subscribeSettings } from "../lib/settings";
import { installPasteInterceptor } from "../features/editor/clipboardHtml"; // 与桌面 src/main.tsx 一致：粘贴前先装 getData 升级拦截器
import "../features/editor/image-lightbox.css";
import "../features/attachment/attachment-preview.css";
import "../styles/tokens.css"; // 复用桌面设计令牌（--lake-*）+ focus-visible + reduced-motion
import "../b3/theme-daylight.css"; // 思源 daylight --b3-* 令牌（视觉层移植，AGPL-3.0）
import "../b3/theme-midnight.css"; // 思源 midnight 令牌，作用于 [data-theme="dark"]
import "../b3/siyuan.scss";         // 思源组件类 .b3-* / config-*（精仿思源，AGPL-3.0）
import "../styles/overlays.css";    // 浮层通用件（seg/badge/ln-*）：与桌面同序，须晚于 siyuan.scss（否则 seg 选中态被 b3-button--outline 压掉）
import "./editor/editor-dock.css";
import "./mobile-theme.css"; // 精仿思源调色板（--lake-* -> --b3-*），晚于 tokens.css 加载以覆盖其 :root 值
import "../styles/dialog.css"; // 浮层通用弹窗（属性等）：与桌面共用同一套样式

// M3：移动端深色模式——与桌面同语义：settings.theme 为权威（light=daylight / dark=midnight）。
// 启动即应用；saveSettings 的订阅回调让设置面板切换立即生效（桌面此前一直如此，移动端曾缺失
// 导致「点深色没反应」：设置已持久化但 data-theme 不变）。
applyTheme(loadSettings().theme);
subscribeSettings((settings) => applyTheme(settings.theme));

// 与桌面一致：必须在编辑器创建前安装粘贴拦截器（原生 paste 的 clipboardData 只读，getData 需包一层升级）
installPasteInterceptor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>
);
