import React from "react";
import ReactDOM from "react-dom/client";
import { MobileApp } from "./MobileApp";
import { applyTheme } from "../lib/theme";
import { loadSettings, subscribeSettings } from "../lib/settings";
import { applySystemBarTheme } from "./systemBars";
import { installPasteInterceptor } from "../features/editor/clipboardHtml"; // 与桌面 src/main.tsx 一致：粘贴前先装 getData 升级拦截器
import "../features/editor/image-lightbox.css";
import "../features/attachment/attachment-preview.css";
// ── W2：安卓 UI 全量重做 —— 颜色统一走**自有设计系统** themes/*（--lake-*），不再用思源调色板。
// 迁移期仍加载 b3 主题/组件（未迁移的 .b3-* 屏幕还需要 --b3-*），随各屏迁移逐步下线。
import "../styles/themes/base.css";
import "../styles/themes/light.css";
import "../styles/themes/dark.css";
import "../styles/themes/warm.css";
import "../styles/tokens.css"; // 非令牌基础规则（关键帧/焦点环/reduced-motion）
import "./editor-dark.css"; // 自写：桌面同源深色桥（已去 --b3-*，走 --lake-*）
import "../styles/compat.css"; // 复用桌面兼容层（config-*/b3-label/b3-switch/fn__*，值走 --lake-*）
import "../styles/kit.css"; // 自有组件库（ln-* 14 件）——新 UI 组件来源
import "../styles/components.css"; // 共用浮层件（seg/badge/ln-*），须晚于 siyuan.scss（seg 选中态要压过 b3-button--outline）
import "./editor/editor-dock.css";
import "../styles/app/quick-notes.css"; // 小记编辑器容器 + 卡片只读预览（与桌面同一套类）
import "../styles/dialog.css"; // 浮层通用弹窗（属性等）：与桌面共用同一套样式
import "./mobile-kit.css"; // 移动端 kit 密度层（触屏点按目标 / 常驻动作）

// M3：移动端深色模式——与桌面同语义：settings.theme 为权威（light=daylight / dark=midnight）。
// 启动即应用；saveSettings 的订阅回调让设置面板切换立即生效（桌面此前一直如此，移动端曾缺失
// 导致「点深色没反应」：设置已持久化但 data-theme 不变）。
// 系统栏（状态栏/导航栏）也跟着主题：深色下否则会留一条近白硬边（见 systemBars.ts）。
const applyThemeEverywhere = (theme: ReturnType<typeof loadSettings>["theme"]): void => {
  applyTheme(theme);
  applySystemBarTheme(theme);
};
applyThemeEverywhere(loadSettings().theme);
subscribeSettings((settings) => applyThemeEverywhere(settings.theme));

// 与桌面一致：必须在编辑器创建前安装粘贴拦截器（原生 paste 的 clipboardData 只读，getData 需包一层升级）
installPasteInterceptor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>
);
