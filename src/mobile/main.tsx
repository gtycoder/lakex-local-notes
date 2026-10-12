import React from "react";
import ReactDOM from "react-dom/client";
import { MobileApp } from "./MobileApp";
import { applyTheme } from "../lib/theme";
import { loadSettings, subscribeSettings } from "../lib/settings";
import { applySystemBarTheme } from "./systemBars";
import { installPasteInterceptor } from "../features/editor/clipboardHtml"; // 与桌面 src/main.tsx 一致：粘贴前先装 getData 升级拦截器
import "../features/editor/image-lightbox.css";
import "../features/attachment/attachment-preview.css";
// ── W2：安卓 UI 全量重做 —— 颜色统一走**自有设计系统**（--lake-*），不再用思源调色板。
// 思源样式层（src/b3/**）已整体删除；仅 .b3-* / fn__* 类名保留，规则在 compat.css（值走 --lake-*）。
import "../styles/fonts/misans/misans.css"; // 内置 MiSans（简中+Latin，官方切片子集）
import "../styles/fonts/jetbrains-mono/jetbrains-mono.css"; // 内置等宽 JetBrains Mono
// P1（261012）：移动端令牌/皮肤改由 src/mobile/theme/** 提供（自有取值层）。
// 桌面 themes/** 不再是移动端契约；护栏 src/mobile/mobileIndependence.test.ts 卡住回退。
import "./theme/index.css";
import "./editor-dark.css"; // 自写：桌面同源深色桥（已去 --b3-*，走 --lake-*）
import "./editor/editor-dock.css";
import "../styles/app/quick-notes.css"; // 小记编辑器容器 + 卡片只读预览（与桌面同一套类）
import "./kit.css"; // P2：移动端自有原语库 mb-*（触屏密度；一个交互语义只有一套）
import "./floating.css"; // P3：浮层原语（mb-sheet / mb-actionsheet / mb-toast / mb-menusheet + 遮罩）

// 内核的浮层（插入面板/卡片工具栏/下拉）**portal 到 body 下的 .ne-overlay-container**（不在我们的组件树里），
// 所以移动端要覆盖它们必须有一个 body 级标记（260923 W2 起只有组件树内样式，够不到浮层）。
document.body.classList.add("lake-mobile");

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
