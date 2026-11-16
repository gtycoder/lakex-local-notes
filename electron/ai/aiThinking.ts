import {
  AI_THINKING_MODES,
  aiProviderDef,
  type AiProviderConfig,
  type AiThinkingMode,
} from "../../src/core/aiProviders.js";

/**
 * 「深度思考」请求级开关的判据（261116 用户裁决：从强制开启改成可开关）。
 *
 * 出处：docs/ARCHITECTURE.md §4.1（IPC 通道四面契约）/ AGENTS §7.6（IPC 三处同步）。
 *
 * ## 职责边界（为什么集中在这一个纯模块）
 * - `parseThinkingOverride`：**IPC 入口**把渲染层给的任意 JSON 收敛成合法枚举（坏值/不传一律 undefined，
 *   不抛错——旧版渲染层照常工作，也避免历史设置里的脏值变成对话失败）；
 * - `resolveThinkingMode`：**请求组装处**（electron/ai/aiClient.ts 的 aiChat）决定本次真正要发的值。
 *   两条不变量：① 不传覆盖 ⇒ 原样返回 provider.thinking（改动前行为逐字节不变）；
 *   ② 供应商不支持 thinking ⇒ 忽略覆盖（**不伪造** `thinking` 参数，否则兼容端点可能直接 400）。
 *
 * 这里不读设置、不落盘、不碰网络：纯函数才能被单测穷尽（见 electron/ai/aiThinking.test.ts）。
 */

/** provider（按目录 id 查定义）是否支持思考模式开关。未知 id（历史/自定义）一律视为不支持。 */
export function aiProviderSupportsThinking(provider: Pick<AiProviderConfig, "id">): boolean {
  return aiProviderDef(provider.id)?.supportsThinking === true;
}

/**
 * 解析 IPC 第三参（`{ thinking?: AiThinkingMode }`）。
 * 任何非法形态（非对象 / 非字符串 / 不在枚举内 / 缺字段）都返回 undefined = 「本次不覆盖」。
 */
export function parseThinkingOverride(options: unknown): AiThinkingMode | undefined {
  if (!options || typeof options !== "object") return undefined;
  const raw = (options as { thinking?: unknown }).thinking;
  if (typeof raw !== "string") return undefined;
  return (AI_THINKING_MODES as readonly string[]).includes(raw) ? (raw as AiThinkingMode) : undefined;
}

/**
 * 本次请求真正要发送的 thinking 值。
 *
 * - `override` 缺省 ⇒ provider.thinking（**不传必须与现状逐字节一致**）；
 * - 供应商不支持 ⇒ 忽略 override，仍发 provider.thinking（通常是 undefined）；
 * - 支持且给了 override ⇒ override（用户开关生效）。
 */
export function resolveThinkingMode(
  provider: AiProviderConfig,
  override?: AiThinkingMode,
): AiThinkingMode | undefined {
  if (!override) return provider.thinking;
  if (!aiProviderSupportsThinking(provider)) return provider.thinking;
  return override;
}
