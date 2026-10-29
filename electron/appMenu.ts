/**
 * macOS 应用菜单（用户 261029：参考思源的做法做裁剪版）。
 *
 * 思源的做法（`app/electron/main.js` 的 applyMacAppMenu / setStartupApplicationMenu，
 * 以及 `app/electron/appMenu.test.js`）：只对 darwin 装自定义菜单；**role 打底、label 逐项覆盖**
 * （label 来自它自己的语言包）；「设置…（⌘,）」只 `webContents.send("siyuan-open-setting")`
 * 交给渲染层开，不在主进程自己造窗口；帮助菜单 = 使用指南（IPC）+ 反馈/官网/GitHub（openExternal）
 * + DevTools（仅开发版）；菜单本身有纯函数测试（断言每个 role 都有 label）。
 *
 * 我们单窗口、中文 UI、没有 i18n 框架 ⇒ 保留「role + 中文 label + 少量自定义项」，
 * **不做**多窗口切菜单 / 用户自定义热键 / 语言包（等真有需求再加，见 AGENTS §3#17）。
 */
import type { MenuItemConstructorOptions } from "electron";

export interface AppMenuActions {
  /** 产品名（显示为应用菜单标题/关于/退出文案）。 */
  appName: string;
  /** 开发版才挂「开发者工具」。 */
  isDev: boolean;
  /** 「设置…（⌘,）」→ 主进程发事件给渲染层打开设置面板。 */
  onOpenSettings: () => void;
  /** 使用文档（外部链接）。 */
  onOpenDocs: () => void;
  /** 反馈问题（外部链接）。 */
  onFeedback: () => void;
  /** 打开数据目录（userData，Finder 里打开；与设置页「打开数据目录」同语义）。 */
  onOpenDataFolder: () => void;
}

/** 纯函数：只产出 template，不碰 Electron 运行时（便于单测断言结构/role/label）。 */
export function buildAppMenuTemplate(actions: AppMenuActions): MenuItemConstructorOptions[] {
  const { appName, isDev } = actions;
  const helpItems: MenuItemConstructorOptions[] = [
    { label: "使用文档", click: () => actions.onOpenDocs() },
    { label: "反馈问题", click: () => actions.onFeedback() },
    { label: "打开数据目录", click: () => actions.onOpenDataFolder() },
  ];
  if (isDev) {
    helpItems.push({ type: "separator" }, { role: "toggleDevTools", label: "开发者工具" });
  }
  return [
    {
      role: "appMenu",
      label: appName,
      submenu: [
        { role: "about", label: "关于 " + appName },
        { type: "separator" },
        { label: "设置…", accelerator: "CmdOrCtrl+,", click: () => actions.onOpenSettings() },
        { type: "separator" },
        { role: "services", label: "服务" },
        { type: "separator" },
        { role: "hide", label: "隐藏 " + appName },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: "退出 " + appName },
      ],
    },
    {
      role: "editMenu",
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "pasteAndMatchStyle", label: "粘贴并匹配样式" },
        { type: "separator" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      role: "windowMenu",
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { role: "togglefullscreen", label: "切换全屏" },
        { type: "separator" },
        { role: "front", label: "全部置于顶层" },
      ],
    },
    { role: "help", label: "帮助", submenu: helpItems },
  ];
}
