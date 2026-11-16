/**
 * 应用设置：本地偏好（localStorage 持久化，不参与同步）。
 * 参考 lake-editor-main 的配置项（defaultFontsize/toc/toolbar）+ 深色模式。
 */
import { DEFAULT_MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB_OPTIONS } from "../core/storeLimits.js";
import { normalizeNoteInsertPosition, type NoteInsertPosition } from "../core/treeRules.js";
import { DEFAULT_THEME_ID, isLakeThemeId, type LakeThemeId } from "./themes";
import { writeLocalStorage } from "./localStorageSafe";

/** 主题 id（主题即数据：见 src/lib/themes.ts；本轮 浅/深/暖色纸质 三套） */
export type ThemeMode = LakeThemeId;

export interface AppSettings {
  /** 正文默认字号（内核支持 12/13/14/15/16/19/22/24） */
  fontSize: number;
  /** 大纲增强：true=应用自建增强大纲（筛选/折叠/H 徽标/悬停/移动端大纲面板）；false=直接使用 Lake 原生大纲（对此不做任何改动）。 */
  outlineEnhance: boolean;
  /** 纯黑（OLED）档（261107 移动端 v2）：仅在 theme=dark 时生效；桌面主题选择器不暴露该开关。 */
  oled: boolean;
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
  /** 退出时关闭全部标签：true = 下次启动不恢复上次打开的标签（并清掉存档）；false = 恢复。
   * 仅本机偏好（localStorage），不进正文/不参与 S3，两端各自独立。 */
  clearTabsOnExit: boolean;
  /** 新建文档位置（261117 用户点单）：顶部新增 / 末尾追加，默认末尾追加。
   * 作用范围 = 同级插入：文档（含表格/多维表/画板/手写板）、分组、笔记本；子级同样按此规则。 */
  newNotePosition: NoteInsertPosition;
}

/** 「最大同时打开标签数」的**平台默认**（261116 用户点单）：桌面 8（既有口径不变）、移动端 6。 */
export const MAX_OPEN_TABS_DESKTOP_DEFAULT = 8;
export const MAX_OPEN_TABS_MOBILE_DEFAULT = 6;

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 16,   // 内核正文字号默认（原 20 不在内核档位里）
  outlineEnhance: false,
  oled: false,
  theme: "light",
  /** 桌面默认 8（移动端默认 6，见 platformDefaultMaxOpenTabs：无存档时按运行时平台取）。 */
  maxOpenTabs: MAX_OPEN_TABS_DESKTOP_DEFAULT,
  maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
  showToolbar: true,
  floatingToolbar: true,
  clearTabsOnExit: false,
  newNotePosition: "bottom",
};

/** 设置面板提供的附件大小档位（MiB）。 */
export const MAX_ATTACHMENT_MB_OPTIONS_SETTINGS = MAX_ATTACHMENT_MB_OPTIONS;

const STORAGE_KEY = "lakex-local-notes-v1.settings";
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
/**
 * 最大同时打开标签数：**只提供 ≤16 的档位**（261110 用户定稿：最多 16 个，不能再多；
 * 撤掉旧的「不限(0)」与 24 档）。上限按空间独立计算（文档/日记各算各的，见 core/tabLimit）。
 */
export const MAX_OPEN_TAB_OPTIONS = [4, 6, 8, 12, 16] as const;
/** 硬上限：加载/保存都夹（手改 localStorage 或旧存档里的 0/24 一律收敛）。 */
export const MAX_OPEN_TABS_CAP = 16;

/**
 * 平台默认的判据 = 移动端入口在模块求值时给 body 加的 `lake-mobile` 标记
 * （见 src/mobile/main.tsx；与移动端覆盖内核浮层用的是同一个 body 级标记，桌面永远没有它）。
 * 为什么不在模块常量里判断：lib/settings 在移动端入口的 import 阶段就被求值，那时 class 还没加 ⇒
 * 默认值必须在**读取时**算（normalize / loadSettings 两处），不能冻结进 DEFAULT_SETTINGS。
 */
function platformDefaultMaxOpenTabs(): number {
  try {
    if (document.body.classList.contains("lake-mobile")) return MAX_OPEN_TABS_MOBILE_DEFAULT;
  } catch { /* 无 DOM（纯 Node 测试）⇒ 桌面默认 */ }
  return MAX_OPEN_TABS_DESKTOP_DEFAULT;
}

/** 归一 maxOpenTabs：旧「不限」(≤0) 与超限值夹到硬上限，其余取整数并夹在 1..16。 */
export function normalizeMaxOpenTabs(value: unknown): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return platformDefaultMaxOpenTabs();
  if (n <= 0) return MAX_OPEN_TABS_CAP;
  return Math.min(MAX_OPEN_TABS_CAP, Math.max(1, Math.floor(n)));
}

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
        oled: parsed.oled === true,
        theme: isLakeThemeId(parsed.theme) ? parsed.theme : DEFAULT_THEME_ID,
        maxOpenTabs: normalizeMaxOpenTabs(parsed.maxOpenTabs),
        maxAttachmentBytes: (MAX_ATTACHMENT_MB_OPTIONS as readonly number[]).includes(parsedMb)
          ? parsedMb * 1024 * 1024
          : DEFAULT_SETTINGS.maxAttachmentBytes,
        showToolbar: parsed.showToolbar !== false,
        floatingToolbar: parsed.floatingToolbar !== false,
        clearTabsOnExit: parsed.clearTabsOnExit === true,
        // 旧存档没有该字段 / 非法值 ⇒ 末尾追加（用户 261117 点单的默认值）。
        newNotePosition: normalizeNoteInsertPosition(parsed.newNotePosition),
      };
      return cached;
    }
  } catch { /* 损坏数据回退默认 */ }
  // 没有存档（新装库）⇒ 用平台默认档（桌面 8 / 移动 6）；其余字段仍是 DEFAULT_SETTINGS。
  cached = { ...DEFAULT_SETTINGS, maxOpenTabs: platformDefaultMaxOpenTabs() };
  return cached;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  // 硬上限（261110）：任何入口写入都夹到 ≤16，别让「不限」再从旧调用点漏进来。
  next.maxOpenTabs = normalizeMaxOpenTabs(next.maxOpenTabs);
  // 261117：任何入口写入都归一（手改 localStorage / 旧调用点传非法值都回"bottom"）。
  next.newNotePosition = normalizeNoteInsertPosition(next.newNotePosition);
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
