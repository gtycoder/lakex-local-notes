/**
 * AI 助手会话（261107 P2 单会话 → 261110 按作用域挂起）。
 *
 * 作用域 = 当前一级空间 + 当前活动文档（tab）。规则（用户 261110 定稿）：
 * - 每个作用域最多一份会话；在 B 打开是 **B 自己的新会话**，A 的不受影响；
 * - 钉住的面板在切走时**挂起**（对话/输入/钉住态都保留，只是不显示），切回来**原样恢复**；
 * - 未钉住的由面板自己关闭（AiAssistantDialog 判定）；
 * - 文档 / tab 被关掉 ⇒ 这一份跟着丢弃（面板侧按 data-note-id 消失判定）。
 *
 * Host 一次渲染所有会话（每个一份 Dialog 挂在 DOM 里但隐藏），所以挂起不丢 React 状态；
 * 入口只调用 openAiAssistant(request, onDismiss)，不自己渲染面板。
 */
import { useSyncExternalStore } from "react";
import type { AiAssistantRequest } from "./aiAssistantRequest";

export interface AiAssistantSession {
  request: AiAssistantRequest;
  /** 归属作用域（readAiScope() 的结果：空间态 + 活动文档 id）。 */
  scope: string;
  /** 关闭这一份（幂等；只清自己，不影响别的作用域）。 */
  dismiss(): void;
}

/** 活动编辑器宿主（与 features/editor/activeEditor.ts 同口径：只认 EXPLICIT 的 data-active）。 */
const SCOPE_EDITOR_SELECTOR = '.lake-editor-tab[data-active="true"]';

/** 一级空间在壳层上的状态类（与 src/App.tsx 的 workspace-view 类同源）。 */
const SPACE_CLASSES = /(ai-writing-active|quick-notes-active|diary-space-active|tags-space-active|trash-space-active|resources-space-active)/;

/**
 * 读当前作用域：空间态类 + 活动编辑器的 data-active / data-note-id。
 * 判据全部取**显式信号**、不读几何（与 features/editor/activeEditor.ts 同口径）。
 */
export function readAiScope(): string {
  const shell = typeof document === "undefined" ? null : document.querySelector(".app-shell");
  const space = shell?.className.match(SPACE_CLASSES)?.[0] ?? "library";
  const activeTab = typeof document === "undefined" ? null : document.querySelector<HTMLElement>(SCOPE_EDITOR_SELECTOR);
  return space + "::" + (activeTab?.getAttribute("data-note-id") ?? "");
}

/** 作用域里的文档 id（空间作用域 = 空串）。 */
export function aiScopeNoteId(scope: string): string {
  const index = scope.indexOf("::");
  return index < 0 ? "" : scope.slice(index + 2);
}

let sessions: AiAssistantSession[] = [];
const EMPTY: AiAssistantSession[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 当前全部会话（每个作用域一份；含被挂起隐藏的）。 */
export function getAiAssistantSessions(): readonly AiAssistantSession[] {
  return sessions;
}

/** 当前作用域的会话（无 = null）。 */
export function getAiAssistantSession(): AiAssistantSession | null {
  const scope = readAiScope();
  return sessions.find((session) => session.scope === scope) ?? null;
}

/**
 * 在**当前作用域**打开 AI 助手（同名作用域会替换掉旧的那份并触发它的清理）。
 * 返回的 handle 只用于关闭自己；被替换后它的 dismiss 仍只清自己的资源。
 */
export function openAiAssistant(request: AiAssistantRequest, onDismiss: () => void = () => {}): AiAssistantSession {
  const scope = readAiScope();
  const previous = sessions.find((session) => session.scope === scope);
  const entry: AiAssistantSession = {
    request,
    scope,
    dismiss: () => {
      const index = sessions.indexOf(entry);
      if (index >= 0) {
        sessions = [...sessions.slice(0, index), ...sessions.slice(index + 1)];
        emit();
      }
      onDismiss();
    },
  };
  sessions = [...sessions.filter((session) => session.scope !== scope), entry];
  emit();
  previous?.dismiss();
  return entry;
}

/** 关闭**当前作用域**的会话（切换入口的「AI 按钮再点一下」走这里；别的作用域不受影响）。 */
export function closeAiAssistant(): void {
  getAiAssistantSession()?.dismiss();
}

/** 关闭全部会话（退出/测试用）。 */
export function closeAllAiAssistants(): void {
  for (const session of sessions.slice()) session.dismiss();
}

/** 订阅全部会话（Host 用）。 */
export function useAiAssistantSessions(): readonly AiAssistantSession[] {
  return useSyncExternalStore(subscribe, getAiAssistantSessions, () => EMPTY);
}