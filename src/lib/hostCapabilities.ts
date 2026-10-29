import { native } from "./native";

/**
 * 宿主能力矩阵（浏览器端 P1）。
 *
 * 背景：Web 客户端（浏览器打开 http://127.0.0.1:<port>/）与桌面端共用同一批 React 组件，
 * 但两者能做的事不同（浏览器没有系统目录选择框、没有窗口控制、不能重启本机应用）。
 * 旧代码在 UI 里散着判 `native.capabilities.nativeDialog`，语义含糊（"没有原生对话框"
 * 被当成"不能整库备份 / 不能导出"）。这里把桥接层下发的原始标志**归一成显式字段**，
 * UI 只按字段名判断，不再各自解释 nativeDialog。
 *
 * 判据仍是桥接层下发的 `native.capabilities`（桌面 preload / Web shim / 移动端），
 * 未声明的字段按"非浏览器 = 桌面"兜底，行为与旧实现一致。
 */
export interface HostCapabilityFlags {
  /** 是否是浏览器 Web 客户端（HTTP shim 注入）。 */
  browserClient?: boolean;
  /** 本机文件系统直通：系统目录选择框、整库备份、在文件夹中显示、打开资源管理器。 */
  localFileSystem?: boolean;
  /** 文件导入导出：导出到文件（Web 端走 /download 下载路由）、从文件导入。 */
  importExport?: boolean;
  /** 原生系统对话框（目录选择、另存为、确认框）。 */
  nativeDialog?: boolean;
  /** 窗口控制：最小化/最大化/关闭、全屏事件。 */
  windowControls?: boolean;
  /** 应用级全局快捷键（⌘K 之外的宿主组合键）。 */
  globalShortcuts?: boolean;
}

/** 归一后的能力矩阵：字段全部必填，UI 不需要再写 `?? true`。 */
export interface HostCapabilities {
  browserClient: boolean;
  localFileSystem: boolean;
  importExport: boolean;
  nativeDialog: boolean;
  windowControls: boolean;
  globalShortcuts: boolean;
}

/**
 * 原始标志 → 能力矩阵（纯函数，可单测）。
 * 缺省兜底按"桌面/移动原生"处理（与 `native.capabilities` 的旧缺省一致）；
 * 显式声明的字段优先（Web shim 会显式写 false / true）。
 */
export function hostCapabilitiesFrom(raw: HostCapabilityFlags | undefined): HostCapabilities {
  const browserClient = raw?.browserClient === true;
  const fallback = !browserClient;
  return {
    browserClient,
    localFileSystem: raw?.localFileSystem ?? fallback,
    // 文件导入导出入口：桌面/移动原生可用；Web 端只有导出可用（主进程生成产物 → /download），
    // 由 shim 显式声明（不靠兜底推断），导入仍不在 P1 范围。
    importExport: raw?.importExport ?? fallback,
    nativeDialog: raw?.nativeDialog ?? fallback,
    windowControls: raw?.windowControls ?? fallback,
    globalShortcuts: raw?.globalShortcuts ?? fallback,
  };
}

/** 当前宿主能力（每次调用都读桥接层，桥接未就绪时与旧代码一样抛错）。 */
export function hostCapabilities(): HostCapabilities {
  return hostCapabilitiesFrom(native.capabilities);
}
