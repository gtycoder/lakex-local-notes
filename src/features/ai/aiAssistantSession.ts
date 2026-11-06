/**
 * AI 助手**单会话**（261107 P2）。
 *
 * 之前四个入口各自渲染一份 `AiAssistantDialog` ⇒ 理论上可同时打开多个面板，焦点/关闭/滚动归属不统一。
 * 现在：入口只调用 `openAiAssistant(request, onDismiss)`；全局只挂一个 `AiAssistantHost`。
 * 打开新的会先清理旧的（旧入口的 onDismiss 负责撤占位卡/清选区快照），不会误关新会话。
 */
import { useSyncExternalStore } from "react";
import type { AiAssistantRequest } from "./aiAssistantRequest";

export interface AiAssistantSession {
  request: AiAssistantRequest;
  /** 关闭当前会话（若已被替换则只做本地清理，不影响新会话）。 */
  dismiss(): void;
}

let current: AiAssistantSession | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 当前会话（无 = null）。React 外部可读；组件用 useAiAssistantSession。 */
export function getAiAssistantSession(): AiAssistantSession | null {
  return current;
}

/**
 * 打开 AI 助手（单会话）。返回的 handle 只用于当前会话自身关闭；被后续 open 替换时
 * 只执行 onDismiss 做本地清理，不会清掉新会话。
 */
export function openAiAssistant(request: AiAssistantRequest, onDismiss: () => void = () => {}): AiAssistantSession {
  const previous = current;
  const entry: AiAssistantSession = {
    request,
    dismiss: () => {
      const wasCurrent = current === entry;
      if (wasCurrent) { current = null; emit(); }
      onDismiss();
    },
  };
  current = entry;
  emit();
  // 关旧（若存在）：旧 dismiss 看到 current 已切换 → 只触发它的本地清理。
  previous?.dismiss();
  return entry;
}

/** 关闭当前会话（无会话 = no-op）。 */
export function closeAiAssistant(): void {
  current?.dismiss();
}

/** 订阅当前会话（Host 组件用；只允许一个）。 */
export function useAiAssistantSession(): AiAssistantSession | null {
  return useSyncExternalStore(subscribe, getAiAssistantSession, () => null);
}
