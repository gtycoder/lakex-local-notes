/**
 * 应用设置：本地偏好（localStorage 持久化，不参与同步）。
 * 参考 lake-editor-main 的配置项（paragraphSpacing/defaultFontsize/toc/toolbar）+ 深色模式。
 */
export type ThemeMode = "light" | "dark";

export interface AppSettings {
  /** 正文默认字号（内核支持 12/13/14/15/16/19/22/24） */
  fontSize: number;
  /** 段间距（relax） */
  paragraphSpacing: boolean;
  /** 显示文档大纲（TOC） */
  showToc: boolean;
  /** 显示编辑器工具栏 */
  showToolbar: boolean;
  /** 主题：light=思源 daylight / dark=思源 midnight */
  theme: ThemeMode;
  /** 最大同时打开标签数（0=不限；超限自动关闭最旧标签，当前标签与钉住标签除外）。 */
  maxOpenTabs: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 18,
  paragraphSpacing: false,
  showToc: true,
  showToolbar: true,
  theme: "light",
  maxOpenTabs: 8,
};

const STORAGE_KEY = "lake-notes-v1.settings";
const FONT_SIZES = [12, 13, 14, 15, 16, 19, 22, 24];

/** V5 Phase 2：设置持久化注入点（桌面默认 = localStorage；移动端可注入 AsyncStorage 等）。 */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function localStorageStorage(): SettingsStorage {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  };
}

let storage: SettingsStorage = localStorageStorage();

export function setSettingsStorage(next: SettingsStorage): void {
  storage = next;
}
/** 设置面板提供的上限档位；不在档位内的历史/异常值归一到默认档。 */
const MAX_OPEN_TAB_OPTIONS = [0, 4, 6, 8, 12, 16, 24];

let cached: AppSettings | null = null;

export function loadSettings(): AppSettings {
  if (cached) return cached;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      cached = {
        fontSize: FONT_SIZES.includes(parsed.fontSize ?? -1) ? (parsed.fontSize as number) : DEFAULT_SETTINGS.fontSize,
        paragraphSpacing: parsed.paragraphSpacing === true,
        showToc: parsed.showToc !== false,
        showToolbar: parsed.showToolbar !== false,
        theme: parsed.theme === "dark" ? "dark" : "light",
        maxOpenTabs: MAX_OPEN_TAB_OPTIONS.includes(parsed.maxOpenTabs as number)
          ? (parsed.maxOpenTabs as number)
          : DEFAULT_SETTINGS.maxOpenTabs,
      };
      return cached;
    }
  } catch { /* 损坏数据回退默认 */ }
  cached = { ...DEFAULT_SETTINGS };
  return cached;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  cached = next;
  try { storage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
  notifySettingsChanged(next);
  return next;
}

export function fontSizeOptions(): number[] {
  return FONT_SIZES;
}

// ---- 简单订阅（设置变化时通知编辑器重建） ----
type Listener = (settings: AppSettings) => void;
const listeners = new Set<Listener>();

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifySettingsChanged(settings: AppSettings): void {
  for (const l of listeners) { try { l(settings); } catch { /* 忽略 */ } }
}
