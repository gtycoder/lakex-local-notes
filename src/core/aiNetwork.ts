/**
 * AI 出网判据（261023 D1）——**与云同步完全解耦**。
 *
 * 云同步看 cloudStateOf()/canTouchNetwork()；AI 只看本文件：
 *  · 关闭 AI（设置页开关）⇒ 任何路径不出网，与「关闭云同步 = 完全没配置」同语义；
 *  · 离线 ⇒ 不可用，但**不改变**开关值（回网后立即可用）。
 * 两个判据不得合并（AGENTS §3#20 的口径改法见 docs/MOBILE-AI.md §10.5）。
 */
export interface AiNetworkState {
  /** 设置页「AI 助手」开关（默认关；未配置也视为关）。 */
  aiEnabled: boolean;
  /** 浏览器 / WebView 侧的网络可达性（不依赖平台 API）。 */
  online: boolean;
}

/** 唯一判据：能不能为 AI 出网。 */
export function aiCanTouchNetwork(state: AiNetworkState): boolean {
  return state.aiEnabled && state.online;
}

/** UI 文案（单一来源；移动端一行可见说明，没有 hover）。 */
export function aiNetworkHint(state: AiNetworkState): string {
  if (!state.aiEnabled) return "AI 助手已关闭：任何路径都不出网";
  if (!state.online) return "当前离线：AI 助手暂不可用";
  return "";
}
