/**
 * 全局唯一的 AI 助手渲染点（261107 P2）：四个入口不再各自渲染 Dialog，只通过 openAiAssistant 提供 request。
 */
import type { ReactElement } from "react";
import { AiAssistantDialog } from "./AiAssistantDialog";
import { useAiAssistantSession } from "./aiAssistantSession";

export function AiAssistantHost(): ReactElement | null {
  const session = useAiAssistantSession();
  if (!session) return null;
  return <AiAssistantDialog open request={session.request} onClose={() => session.dismiss()} />;
}