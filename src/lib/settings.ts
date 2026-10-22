/**
 * 应用设置：本地偏好（localStorage 持久化，不参与同步）。
 * 参考 lake-editor-main 的配置项（defaultFontsize/toc/toolbar）+ 深色模式。
 */
import { DEFAULT_MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB_OPTIONS } from "../core/storeLimits.js";
import { DEFAULT_THEME_ID, isLakeThemeId, type LakeThemeId } from "./themes";
import { writeLocalStorage } from "./localStorageSafe";

/** 主题 id（主题即数据：见 src/lib/themes.ts；本轮 浅/深/暖色纸质 三套） */
export type ThemeMode = LakeThemeId;

export interface AppSettings {
  /** 正文默认字号（内核支持 12/13/14/15/16/19/22/24） */
  fontSize: number;
  /** 大纲增强：true=应用自建增强大纲（筛选/折叠/H 徽标/悬停/移动端大纲面板）；false=直接使用 Lake 原生大纲（对此不做任何改动）。 */
  outlineEnhance: boolean;
  /** 主题：见 src/lib/themes.ts 的 LAKE_THEMES（light/dark/warm），只本机、不跨端 */
  theme: ThemeMode;
  /** 最大同时打开标签数（0=不限；超限自动关闭最旧标签，当前标签与钉住标签除外）。 */
  maxOpenTabs: number;
  /** 附件上传大小上限（字节；档位 25/50/100 MiB，默认 25 MiB；仅影响本机上传校验，
   * 同步/下载侧用协议上限 MAX_ATTACHMENT_BYTES，跨端配置不同不会导致下载失败）。 */
  maxAttachmentBytes: number;
  /** 显示编辑器「固定工具栏」（内核顶部工具栏）。默认开。 */
  showToolbar: boolean;
  /** 浮动工具栏：选中文字/图片时在选区上方弹出格式浮框（桌面编辑态）。默认开。 */
  floatingToolbar: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 16,   // 内核正文字号默认（原 20 不在内核档位里）
  outlineEnhance: false,
  theme: "light",
  maxOpenTabs: 8,
  maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
  showToolbar: true,
  floatingToolbar: true,
};

/** 设置面板提供的附件大小档位（MiB）。 */
export const MAX_ATTACHMENT_MB_OPTIONS_SETTINGS = MAX_ATTACHMENT_MB_OPTIONS;

const STORAGE_KEY = "local-lakex-notes-v1.settings";
/** 正文字号档位（= 内核正文字号取值，bundle `R_`：12/13/14/15/16/19/22/24；不含 20）。 */
const FONT_SIZES = [12, 13, 14, 15, 16, 19, 22, 24];

/** V5 Phase 2：设置持久化注入点（桌面默认 = localStorage；移动端可注入 AsyncStorage 等）。 */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function localStorageStorage(): SettingsStorage {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => { writeLocalStorage(key, value); },
  };
}

const storage: SettingsStorage = localStorageStorage();
/** 设置面板提供的上限档位；不在档位内的历史/异常值归一到默认档。 */
const MAX_OPEN_TAB_OPTIONS = [0, 4, 6, 8, 12, 16, 24];

let cached: AppSettings | null = null;

export function loadSettings(): AppSettings {
  if (cached) return cached;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      const parsedMb = (parsed.maxAttachmentBytes ?? 0) / (1024 * 1024);
      cached = {
        fontSize: FONT_SIZES.includes(parsed.fontSize ?? -1) ? (parsed.fontSize as number) : DEFAULT_SETTINGS.fontSize,
        outlineEnhance: parsed.outlineEnhance === true,
        theme: isLakeThemeId(parsed.theme) ? parsed.theme : DEFAULT_THEME_ID,
        maxOpenTabs: MAX_OPEN_TAB_OPTIONS.includes(parsed.maxOpenTabs as number)
          ? (parsed.maxOpenTabs as number)
          : DEFAULT_SETTINGS.maxOpenTabs,
        maxAttachmentBytes: (MAX_ATTACHMENT_MB_OPTIONS as readonly number[]).includes(parsedMb)
          ? parsedMb * 1024 * 1024
          : DEFAULT_SETTINGS.maxAttachmentBytes,
        showToolbar: parsed.showToolbar !== false,
        floatingToolbar: parsed.floatingToolbar !== false,
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
