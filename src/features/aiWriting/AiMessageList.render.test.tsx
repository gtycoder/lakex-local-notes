// @vitest-environment jsdom
/**
 * P1-2 渲染次数回归：流式期间**历史消息不得重渲染**。
 *
 * 做法：用 MarkdownView 作为「AiMessageView 是否真的重渲染」的探针（助手消息每个渲染都会调它），
 * 记录每次渲染的 source；连发 50 个 delta 后，历史那条的 source 必须仍然只出现 1 次。
 * 同时锁：只有命中 messageId 的那条拿到 stream（否则 memo 浅比较必然失效）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiWritingMessage } from "../../core/aiWriting";
import type { AiWritingStream } from "./useAiWriting";

const h = vi.hoisted(() => ({ markdownRenders: [] as string[] }));

vi.mock("../../components/ui/markdown/MarkdownView", () => ({
  MarkdownView: ({ source }: { source: string }) => {
    h.markdownRenders.push(source);
    return <div className="md-mock">{source}</div>;
  },
}));
vi.mock("./AiAnswerViewer", () => ({ default: () => null }));
vi.mock("../editor/imagePreview", () => ({ openImagePreview: vi.fn() }));

import { AiMessageList, type AiMessageListProps } from "./AiMessageList";
import { AiMessageView } from "./AiMessageView";

const HISTORY_CONTENT = "历史回答：这一条在流式期间不允许重渲染。" ;

function message(id: string, content: string): AiWritingMessage {
  return { id, conversationId: "c1", role: "assistant", content, reasoning: null, durationMs: 100, stopped: false, error: null, sortOrder: 1, createdAt: "" };
}

const MESSAGES: AiWritingMessage[] = [message("history", HISTORY_CONTENT), message("streaming", "")];
const CALLBACKS = {
  onRegenerate: () => undefined,
  onCopy: () => undefined,
  onCopyAsLake: async () => true,
  onPublish: () => undefined,
  onSaveQuickNote: () => undefined,
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

function renderList(stream: AiWritingStream | null): AiMessageListProps {
  const props: AiMessageListProps = { messages: MESSAGES, stream, busy: true, ...CALLBACKS };
  act(() => { root!.render(<AiMessageList {...props} />); });
  return props;
}

const historyRenders = () => h.markdownRenders.filter((source) => source === HISTORY_CONTENT).length;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.markdownRenders = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  host.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("AiMessageList · 渲染边界（P1-2）", () => {
  it("流式 50 个 delta：历史消息 render 0 次，流式消息持续更新", () => {
    renderList({ messageId: "streaming", content: "a", reasoning: "" });
    const initialHistoryRenders = historyRenders();
    expect(initialHistoryRenders).toBe(1);

    for (let i = 0; i < 50; i += 1) {
      renderList({ messageId: "streaming", content: "a".repeat(i + 1), reasoning: "" });
    }

    // 历史条：初始 1 次，50 个 delta 期间 0 次新增。
    expect(historyRenders()).toBe(initialHistoryRenders);
    // 流式条确实在更新（不是整列表都被 memo 冻住）：渲染次数随 delta 增长。
    // 注意正文有 useThrottledMarkdown（同帧内不重复提交），所以断言「渲染次数」而不是「渲染内容」每帧都变。
    const streamingRowRenders = h.markdownRenders.length - initialHistoryRenders;
    expect(streamingRowRenders).toBeGreaterThan(10);
  });

  it("对照基线：旧接线（stream 原样传给所有行）下历史条会随 delta 重渲染 N 次", () => {
    // 旧实现把 controller.stream 原样传给每一行；memo 浅比较因 stream 引用变化全部失效。
    let current: AiWritingStream = { messageId: "streaming", content: "a", reasoning: "" };
    function OldWiring() {
      return (
        <div>
          {MESSAGES.map((message) => (
            <AiMessageView key={message.id} message={message} stream={current} busy={true} {...CALLBACKS} />
          ))}
        </div>
      );
    }
    act(() => { root!.render(<OldWiring />); });
    const baseline = historyRenders();
    expect(baseline).toBe(1);
    for (let i = 0; i < 50; i += 1) {
      current = { messageId: "streaming", content: "a".repeat(i + 1), reasoning: "" };
      act(() => { root!.render(<OldWiring />); });
    }
    // 旧接线：历史条 50 次 delta ⇒ 多渲染 50 次（改后 = 0）。
    expect(historyRenders() - baseline).toBe(50);
  });

  it("stream 只传给 messageId 命中的那条：给别的消息 id 时不更新任何行渲染", () => {
    renderList(null);
    const before = historyRenders();
    // 指向不存在的消息 id：两行都拿 null，列表 memo 下不应有任何 MarkdownView 重渲染。
    const beforeAll = h.markdownRenders.length;
    renderList({ messageId: "not-in-list", content: "zzz", reasoning: "" });
    expect(historyRenders()).toBe(before);
    expect(h.markdownRenders.length).toBe(beforeAll);
  });
});