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
  /** 自定义 CSS（思源「代码片段」式自定义 UI；data-theme=dark 下也可覆盖） */
  customCss: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 18,
  paragraphSpacing: false,
  showToc: true,
  showToolbar: true,
  theme: "light",
  customCss: "",
};

const STORAGE_KEY = "lake-notes-v1.settings";
const FONT_SIZES = [12, 13, 14, 15, 16, 19, 22, 24];

let cached: AppSettings | null = null;

export function loadSettings(): AppSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      cached = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        fontSize: FONT_SIZES.includes(parsed.fontSize ?? -1) ? (parsed.fontSize as number) : DEFAULT_SETTINGS.fontSize,
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
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
