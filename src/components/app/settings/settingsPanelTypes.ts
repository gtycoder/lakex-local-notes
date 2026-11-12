// 261112 R2-S7：从 SettingsPanel.tsx 原样搬出的公共类型/常量（纯搬移，零行为变化）。
import type { AppSettings } from "../../../lib/settings";
import type { S3Settings, SyncSettings } from "../../../lib/types";

/** 把归类后的中文错误贴到对应字段：Key 类 → apiKey；端点/模型类 → baseUrl+model；其余整条。 */
export function fieldErrorFor(message: string, retryable?: boolean): Record<string, string> {
  // 先判可重试：断网/限流的文案里也可能出现 "Base URL" 字样，若先按文案匹配会误贴到字段上。
  if (retryable) return {};
  if (/API Key|无权访问|额度/.test(message)) return { apiKey: message };
  if (/模型名不被支持/.test(message)) return { model: message };
  if (/模型不存在|Base URL/.test(message)) return { baseUrl: message, model: message };
  return message ? { all: message } : {};
}

/** 关于页「技术身份」：vendored Lake 内核与 React wrapper 是固定 pin。
 *  机器可读版本未进 sysInfo（wrapper 在 package.json 里是 file: 依赖），内核升级时同步
 *  vendor/lakex-doc-react/package.json 与 docs/LAKEX-CONTRACT.md。 */
export const LAKE_KERNEL_VERSION = "1.99.0";
export const LAKE_WRAPPER_VERSION = "0.1.3";
/** sysInfo.deps 的版本值可能带 ^/~；file: 依赖不是版本号，按本地 vendor 显示。 */
export function depVersion(deps: Record<string, string> | undefined, name: string): string {
  const raw = deps?.[name];
  if (!raw) return "—";
  return raw.startsWith("file:") ? "本地 vendor" : raw.replace(/^[~^>=<\s]+/, "");
}
// DT-13：异步动作的 busy/提示统一走共用原语（不再逐组手写 setBusy/setMsg/try/catch/finally）

/**
 * 设置分类（261105 用户验收重组）：「常规（编辑器/标签页/附件）/ 外观 / 快捷键 / 云端与同步 / 备份与恢复 /
 * 数据与历史 / 数据维护（数据体检、重建数据、回收站、全文搜索、浏览器端、应用日志）/ AI / 关于」。
 * 备份与恢复是**独立分类**（从云端恢复也放这里：它同样是恢复动作，只是需要云端配置）。
 */
export type SettingsCategory = "editor" | "appearance" | "shortcuts" | "history" | "maintenance" | "sync" | "backup" | "ai" | "browser" | "update" | "about";

export interface SettingsPanelProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onChange: (patch: Partial<AppSettings>) => void;
  /** 打开设置时默认定位的分类，适合从具体功能的引导入口跳转。 */
  openCategory?: SettingsCategory;
  onS3SettingsChanged?: (settings: S3Settings) => void;
  onSyncSettingsChanged?: (settings: SyncSettings) => void;
  /** 云端是否已配置 / 是否启用（与顶栏状态灯同一来源，判"离线"用）。 */
  cloudConfigured?: boolean;
  cloudEnabled?: boolean;
}

export const S3_DEFAULTS: S3Settings = { endpoint: "", region: "cn-east-1", bucket: "", prefix: "lakex-local-notes", accessKeyId: "", secretAccessKey: "", forcePathStyle: false };

/** 让浏览器先把 data URL 解码好再上屏：<img> 换 src 的那一帧若未解码完会画空白（闪烁的另一半来源）。 */
