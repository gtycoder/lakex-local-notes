/**
 * 全局唯一的 AI 助手渲染点（261107 P2；261110 改多份挂起）。
 *
 * 每个**作用域**一份 Dialog：一次全渲染，切走的那份自己隐藏（不卸载 ⇒ 对话/输入/钉住态不丢），
 * 切回来原样恢复。入口只通过 openAiAssistant 提供 request，不自己渲染面板。
 */
import type { ReactElement } from "react";
import { AiAssistantDialog } from "./AiAssistantDialog";
import { useAiAssistantSessions } from "./aiAssistantSession";

export function AiAssistantHost(): ReactElement | null {
  const sessions = useAiAssistantSessions();
  if (sessions.length === 0) return null;
  return (
    <>
      {sessions.map((session) => (
        <AiAssistantDialog key={session.scope} open request={session.request} scope={session.scope} onClose={() => session.dismiss()} />
      ))}
    </>
  );
}