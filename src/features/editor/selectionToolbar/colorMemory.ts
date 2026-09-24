/**
 * 浮动工具栏颜色控件 ↔ 内核「当前应用色」记忆（文字色 / 背景色）。
 *
 * 内核固定工具栏的颜色按钮（bundle `plugins/color`、`plugins/bg-color` 的
 * `*-toolbar-descriptor`）是「本体 + 下拉三角」两件：
 *   - 本体 `_clickHandler → onSelect(props.color)`：直接应用「当前色」，不弹面板；
 *   - 三角才打开调色板（`onSelect(e, false/true)`）。
 * `props.color` = 插件上下文（`pluginContext.getColor`）里保存的「上次使用色」，
 * 初值 = 内核主题令牌默认色：
 *   `editor.color.default`   文字色 light #DF2A3F / dark #CA3F4F
 *   `editor.bgColor.default` 背景色 light #FBDE28 / dark #C2AC19
 * 清除语义（内核 onEvent('select')）：
 *   文字色：所选 == `editor.text.color`（正文色）→ `clearColor`；
 *   背景色：所选 == `transparent` 或已等于当前 `bgColor` → `clearBgColor`。
 *
 * 浮动 = 固定栏换位置出现 ⇒ 必须共用同一份记忆：这里直接读写内核插件上下文
 * （`Doc.Plugins.Toolbar.IToolbarEditorService` → `service.plugin._toolbar`
 * `._descriptorDefines[color|bgColor].pluginContext`）。内核不可达时（固定栏
 * disabled ⇒ 颜色插件拿不到工具条服务、不建 pluginContext）退回「本编辑器内一份
 * 内存记忆 + 主题默认」：行为一致，只是不跨工具栏共享。
 */
import { Doc } from "@dlient/lakex-doc-react";
import type { LakeEditorInstance } from "../lakeRuntime";

export type ColorVariant = "text" | "bg";

/** 内核工具条 widget 名（bundle `EK.toolbar.color` / `xV.toolbar.bgColor`）。 */
const WIDGET_NAME: Record<ColorVariant, string> = { text: "color", bg: "bgColor" };
/** 内核默认色令牌（各插件 `Colors` 常量）。 */
const DEFAULT_TOKEN: Record<ColorVariant, string> = {
  text: "editor.color.default",
  bg: "editor.bgColor.default",
};
const DEFAULT_FALLBACK: Record<ColorVariant, { light: string; dark: string }> = {
  text: { light: "#DF2A3F", dark: "#CA3F4F" },
  bg: { light: "#FBDE28", dark: "#C2AC19" },
};
/** 正文色令牌（选择它 = 清除文字色）；bg 的「无填充」持久值。 */
const TEXT_COLOR_TOKEN = "editor.text.color";
const TEXT_COLOR_FALLBACK = { light: "#262626", dark: "#E2E2E2" };

export const TRANSPARENT = "transparent";

interface KernelTheme {
  getColorByToken?(name: string): unknown;
  toVisualValue?(value: unknown): unknown;
  toPersistentValue?(value: unknown): unknown;
}
interface KernelColorContext {
  getColor(): unknown;
  setColor(value: unknown): void;
}
type ServiceAwareEditor = LakeEditorInstance & {
  getService?(id: unknown): unknown;
  kernel?: LakeEditorInstance["kernel"] & { getService?(id: unknown): unknown };
  theme?: KernelTheme;
};
interface ToolbarServiceLike {
  plugin?: { _toolbar?: { _descriptorDefines?: Record<string, { pluginContext?: KernelColorContext }> } };
}

function serviceAware(editor: LakeEditorInstance): ServiceAwareEditor {
  return editor as ServiceAwareEditor;
}

function themeOf(editor: LakeEditorInstance): KernelTheme | undefined {
  return serviceAware(editor).theme;
}

function isDark(): boolean {
  try {
    return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  } catch {
    return false;
  }
}

/** 内核颜色插件上下文（「上次使用色」本体）；内核不可达返回 null。 */
function kernelContext(editor: LakeEditorInstance, variant: ColorVariant): KernelColorContext | null {
  try {
    const ns = Doc as unknown as {
      Plugins?: { Toolbar?: { IToolbarEditorService?: { ID?: unknown } } };
      IToolbarEditorService?: { ID?: unknown };
    };
    const Service = ns.Plugins?.Toolbar?.IToolbarEditorService ?? ns.IToolbarEditorService;
    const id: unknown = Service?.ID ?? { value: "IToolbarEditorService" };
    const self = serviceAware(editor);
    const svc = (self.getService?.(id) ?? self.kernel?.getService?.(id)) as ToolbarServiceLike | null | undefined;
    const ctx = svc?.plugin?._toolbar?._descriptorDefines?.[WIDGET_NAME[variant]]?.pluginContext;
    if (ctx && typeof ctx.getColor === "function" && typeof ctx.setColor === "function") return ctx;
  } catch {
    /* 内核结构变化：退回内存记忆 */
  }
  return null;
}

function toVisual(editor: LakeEditorInstance, value: unknown): unknown {
  try {
    const t = themeOf(editor);
    return t?.toVisualValue ? t.toVisualValue(value) : value;
  } catch {
    return value;
  }
}

function toPersistent(editor: LakeEditorInstance, value: unknown): unknown {
  try {
    const t = themeOf(editor);
    return t?.toPersistentValue ? t.toPersistentValue(value) : value;
  } catch {
    return value;
  }
}

function tokenColor(editor: LakeEditorInstance, token: string, fallback: { light: string; dark: string }): string {
  try {
    const v = themeOf(editor)?.getColorByToken?.(token);
    if (typeof v === "string" && v) return v;
  } catch {
    /* 无 theme：用内置回退 */
  }
  return isDark() ? fallback.dark : fallback.light;
}

/** 正文色（选择「默认」文字色时用它判定清除）。 */
export function normalTextColor(editor: LakeEditorInstance): string {
  return tokenColor(editor, TEXT_COLOR_TOKEN, TEXT_COLOR_FALLBACK);
}

/** 面板「默认 / 无填充色」行对应的内核取值（内核调色板 `defaultColor`）。 */
export function paletteDefaultValue(editor: LakeEditorInstance, variant: ColorVariant): string {
  return variant === "text" ? normalTextColor(editor) : TRANSPARENT;
}

/** 内核默认「当前色」（无任何历史时）。 */
export function defaultColor(editor: LakeEditorInstance, variant: ColorVariant): string {
  return tokenColor(editor, DEFAULT_TOKEN[variant], DEFAULT_FALLBACK[variant]);
}

/** 无内核上下文时的兜底记忆（每编辑器一份，尽量随内核 pluginContext 同步写）。 */
const fallbackMemory = new WeakMap<object, Partial<Record<ColorVariant, string>>>();

/** 当前应用色（A 本体直接点击时应用的值）：内核上次使用色 → 兜底记忆 → 内核默认。 */
export function currentColor(editor: LakeEditorInstance, variant: ColorVariant): string {
  const ctx = kernelContext(editor, variant);
  if (ctx) {
    try {
      const visual = toVisual(editor, ctx.getColor());
      if (typeof visual === "string" && visual && visual !== "null") return visual;
    } catch {
      /* 退回记忆/默认 */
    }
  }
  const remembered = fallbackMemory.get(editor)?.[variant];
  if (remembered) return remembered;
  return defaultColor(editor, variant);
}

/** 记录「上次使用色」（与固定栏共用：优先写内核 pluginContext）。 */
export function rememberColor(editor: LakeEditorInstance, variant: ColorVariant, visual: string): void {
  const memory = fallbackMemory.get(editor) ?? {};
  memory[variant] = visual;
  fallbackMemory.set(editor, memory);
  const ctx = kernelContext(editor, variant);
  if (!ctx) return;
  try {
    ctx.setColor(toPersistent(editor, visual));
  } catch {
    /* 内核拒绝则仅保留本地记忆 */
  }
}

/** 供 `execCommand('color'|'bgColor', …)` 使用的持久值（内核收持久值）。 */
export function persistentColor(editor: LakeEditorInstance, visual: string): unknown {
  return toPersistent(editor, visual);
}
