import React from "react";
import ReactDOM from "react-dom/client";
import { MobileApp } from "./MobileApp";
import { applyTheme } from "../lib/theme";
import { loadSettings, subscribeSettings } from "../lib/settings";
import { clearPersistedNotebookTabs } from "./notebook/tabSessionCleanup";
import { installSafeAreaInsets } from "./native/safeAreaInsets";
import { installDeviceProfile } from "./native/deviceProfile";
import { applySystemBarTheme } from "./native/systemBars";
import { isQuickNoteShortcutUrl, readLaunchUrlHint } from "./native/quickNoteShortcut";
import { installPasteInterceptor } from "../features/editor/clipboardHtml"; // 与桌面 src/main.tsx 一致：粘贴前先装 getData 升级拦截器
// ── W2：安卓 UI 全量重做 —— 颜色统一走**自有设计系统**（--lake-*），不再用思源调色板。
// 思源样式层（src/b3/**）已整体删除；移动端自 P5 起连 compat.css 也不再引（P0–P7 独立性批次）——
// 移动端 DOM 里没有任何 .b3-* / fn__* 类名（护栏恒为 0），样式全部来自 src/mobile/**。
import "../styles/fonts/misans/misans.css"; // 内置 MiSans（简中+Latin，官方切片子集）
import "../styles/fonts/jetbrains-mono/jetbrains-mono.css"; // 内置等宽 JetBrains Mono
// P1（261012）：移动端令牌/皮肤改由 src/mobile/theme/** 提供（自有取值层）。
// 桌面 themes/** 不再是移动端契约；护栏 src/mobile/mobileIndependence.test.ts 卡住回退。
import "./theme/index.css";
import "./editor-dark.css"; // 自写：桌面同源深色桥（已去 --b3-*，走 --lake-*）
import "./editor/editor-dock.css";
import "./kit.css"; // P2：移动端自有原语库 mb-*（触屏密度；一个交互语义只有一套）
import "./floating.css"; // P3：浮层原语（mb-sheet / mb-actionsheet / mb-toast / mb-menusheet + 遮罩）
import "./features.css"; // P6：图片 Lightbox / 附件预览的**移动端外观**（结构类名共享、视觉各端自有）
import "./quick-notes.css"; // P6b：小记编辑器宿主与只读预览的移动端外观（自桌面那份抽取移动端子集）
import "./ai/ai.css"; // 261023：AI 全屏功能页（布局 + Markdown），不进入口以外的作用域
// 编辑面里「内核按视口/按桌面写死的几何」的收口（doc/note 共用一份，宿主契约见该文件头）；
// 放最后引：它压的是内核注入的未分层样式（部分需 !important），排在所有自有样式之后语义最清楚。
import "./editor/edit-surface-kernel.css";

// 内核的浮层（插入面板/卡片工具栏/下拉）**portal 到 body 下的 .ne-overlay-container**（不在我们的组件树里），
// 所以移动端要覆盖它们必须有一个 body 级标记（260923 W2 起只有组件树内样式，够不到浮层）。
document.body.classList.add("lake-mobile");

// 261027：系统栏/刘海安全区（原生 WindowInsets → CSS 变量；env() 不靠谱的 ROM 走这里兜底）。
installSafeAreaInsets();
// 261027：平板/折叠屏形态（只切布局类，不改信息架构）。
installDeviceProfile();

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

// 「退出时关闭全部标签」（261027）：冷启动先清掉上次标签存档；进入工作区时的恢复逻辑就会读到空。
// 用「启动时清」而不是挂退出/后台回调：Android 杀进程没有可靠回调，切后台也不该清标签。
if (loadSettings().clearTabsOnExit) clearPersistedNotebookTabs();

// 与桌面一致：必须在编辑器创建前安装粘贴拦截器（原生 paste 的 clipboardData 只读，getData 需包一层升级）
installPasteInterceptor();

// 261022：冷启动首帧路由 —— 原生同步 hint 在 React 首帧前给出 launch URL，
// 是「长按图标新建小记」就直接进 capture 分支，不再先画首页骨架再整树切换（零等待）。
const initialCapture = isQuickNoteShortcutUrl(readLaunchUrlHint());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobileApp initialCapture={initialCapture} />
  </React.StrictMode>
);

// 261027：首屏看门狗报到 —— React 提交即算「JS 已起来」，不等网络/数据；
// 原生 30s 内没收到会 reload 一次（只兜白屏/卡死，不做业务判断）。
window.setTimeout(() => {
  try { (window as { lakeBoot?: { ready?: () => void } }).lakeBoot?.ready?.(); } catch { void 0; }
}, 0);
