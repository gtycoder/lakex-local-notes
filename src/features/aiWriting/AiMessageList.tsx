/**
 * AI 写作 · 消息列表（261116 P1-2 渲染边界）。
 *
 * 为什么单独成件：流式 delta 合帧后仍会以帧频更新 `stream`；如果父级把 `stream` 原样传给每一条
 * 消息，memo 全部失效。这里把 `stream` **只传给 messageId 命中的那条**（其余恒为 null），
 * 并让本组件整体 memo（input 打字等与消息无关的父级更新也不会重渲染历史列表）。
 *
 * 约定：所有回调由父级 useCallback 稳定；改动时先看 `AiMessageList.render.test.tsx` 的渲染次数回归。
 */
import { memo } from "react";
import type { AiWritingMessage } from "../../core/aiWriting";
import { AiMessageView } from "./AiMessageView";
import type { AiWritingStream } from "./useAiWriting";

export interface AiMessageListProps {
  messages: readonly AiWritingMessage[];
  stream: AiWritingStream | null;
  busy: boolean;
  onRegenerate: () => void;
  onCopy: (content: string) => void;
  onCopyAsLake: (content: string) => Promise<boolean>;
  onPublish: (content: string) => void;
  onSaveQuickNote: (content: string) => void;
}

export const AiMessageList = memo(function AiMessageList({
  messages, stream, busy, onRegenerate, onCopy, onCopyAsLake, onPublish, onSaveQuickNote,
}: AiMessageListProps) {
  return (
    <div className="aiw-thread">
      {messages.map((message) => (
        <AiMessageView
          key={message.id}
          message={message}
          // 只有正在流式的那条拿到 stream；其余恒 null（memo 才能 bail out）。
          stream={stream !== null && stream.messageId === message.id ? stream : null}
          busy={busy}
          onRegenerate={onRegenerate}
          onCopy={onCopy}
          onCopyAsLake={onCopyAsLake}
          onPublish={onPublish}
          onSaveQuickNote={onSaveQuickNote}
        />
      ))}
    </div>
  );
});
