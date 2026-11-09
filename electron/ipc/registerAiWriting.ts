import type { IpcRegistrar } from "./registrar.js";
import { Store } from "../store.js";
import { IpcInputError } from "../ipcLimits.js";
import type {
  AiWritingComposerPatch,
  AiWritingConversationCreateInput,
  AiWritingDocRef,
  AiWritingMessageAppendInput,
  AiWritingMessagePatch,
  AiWritingMode,
} from "../../src/core/aiWriting.js";

/**
 * AI 写作空间 IPC（261109，桌面本地）：会话/消息 CRUD。
 *
 * 边界：
 * - 数据只在本机 metadata.sqlite3（仓库 = electron/aiWritingRepository.ts），**不进 S3/树/搜索**；
 * - 网络（模型调用）仍走既有 ai_chat（Key 只出主进程），这里不碰供应商；
 * - 输入设上限（标题/正文/资料引用数），坏输入抛 IpcInputError（registrar 统一编码）。
 */

const MAX_TITLE = 200;
const MAX_CONTENT = 1_000_000;
const MAX_REASONING = 1_000_000;
const MAX_DOC_REFS = 200;
const MODES: readonly AiWritingMode[] = ["chat", "docs"];

function readString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new IpcInputError(field + " 必须是字符串");
  if (value.length > max) throw new IpcInputError(field + " 超长");
  return value;
}

function readMode(value: unknown): AiWritingMode {
  if (typeof value !== "string" || !(MODES as readonly string[]).includes(value)) {
    throw new IpcInputError("mode 无效");
  }
  return value as AiWritingMode;
}

function readDocRefs(value: unknown): AiWritingDocRef[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new IpcInputError("docRefs 必须是数组");
  if (value.length > MAX_DOC_REFS) throw new IpcInputError("资料数量超限");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new IpcInputError("docRefs 项无效");
    const row = item as Record<string, unknown>;
    const kind = row.kind === "quick-note" ? "quick-note" : row.kind === "note" ? "note" : null;
    if (!kind) throw new IpcInputError("docRefs.kind 无效");
    return {
      kind,
      id: readString(row.id, "docRefs.id", 200),
      title: typeof row.title === "string" ? readString(row.title, "docRefs.title", 500) : "未命名",
    };
  });
}

/** 耗时：非负整数毫秒；其它（含 null）落 null。 */
function readDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

export function registerAiWritingIpc(ipc: IpcRegistrar, store: Store): void {
  const repo = () => store.getAiWritingRepository();

  ipc.handle("ai_writing_list", () => repo().listConversations());

  ipc.handle("ai_writing_get", (id: unknown) => {
    const conversationId = readString(id, "会话 id", 200);
    const conversation = repo().getConversation(conversationId);
    if (!conversation) return null;
    return { conversation, messages: repo().listMessages(conversationId) };
  });

  ipc.handle("ai_writing_create", (input: unknown) => {
    if (!input || typeof input !== "object") throw new IpcInputError("参数无效");
    const row = input as Record<string, unknown>;
    const body: AiWritingConversationCreateInput = {
      mode: readMode(row.mode),
      title: readString(row.title, "标题", MAX_TITLE),
      promptText: row.promptText === undefined || row.promptText === null ? null : readString(row.promptText, "提示词", 20_000),
      docRefs: readDocRefs(row.docRefs),
    };
    return repo().createConversation(body);
  });

  ipc.handle("ai_writing_rename", (id: unknown, title: unknown) => {
    return repo().renameConversation(readString(id, "会话 id", 200), readString(title, "标题", MAX_TITLE));
  });

  ipc.handle("ai_writing_composer", (id: unknown, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new IpcInputError("参数无效");
    const row = patch as Record<string, unknown>;
    const body: AiWritingComposerPatch = {
      promptText: row.promptText === undefined ? undefined : row.promptText === null ? null : readString(row.promptText, "提示词", 20_000),
      docRefs: row.docRefs === undefined ? undefined : readDocRefs(row.docRefs),
      mode: row.mode === undefined ? undefined : readMode(row.mode),
    };
    return repo().updateConversationComposer(readString(id, "会话 id", 200), body);
  });

  ipc.handle("ai_writing_delete", (id: unknown) => {
    repo().deleteConversation(readString(id, "会话 id", 200));
    return { ok: true };
  });

  ipc.handle("ai_writing_append_message", (input: unknown) => {
    if (!input || typeof input !== "object") throw new IpcInputError("参数无效");
    const row = input as Record<string, unknown>;
    const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
    if (!role) throw new IpcInputError("role 无效");
    const body: AiWritingMessageAppendInput = {
      conversationId: readString(row.conversationId, "会话 id", 200),
      role,
      content: typeof row.content === "string" ? readString(row.content, "正文", MAX_CONTENT) : "",
      reasoning: row.reasoning === undefined || row.reasoning === null ? null : readString(row.reasoning, "思考内容", MAX_REASONING),
      durationMs: readDuration(row.durationMs),
      stopped: row.stopped === true,
      error: row.error === undefined || row.error === null ? null : readString(row.error, "错误信息", 4000),
    };
    return repo().appendMessage(body);
  });

  ipc.handle("ai_writing_update_message", (id: unknown, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new IpcInputError("参数无效");
    const row = patch as Record<string, unknown>;
    const body: AiWritingMessagePatch = {
      content: row.content === undefined ? undefined : readString(row.content, "正文", MAX_CONTENT),
      reasoning: row.reasoning === undefined ? undefined : row.reasoning === null ? null : readString(row.reasoning, "思考内容", MAX_REASONING),
      durationMs: row.durationMs === undefined ? undefined : readDuration(row.durationMs),
      stopped: row.stopped === undefined ? undefined : row.stopped === true,
      error: row.error === undefined ? undefined : row.error === null ? null : readString(row.error, "错误信息", 4000),
    };
    return repo().updateMessage(readString(id, "消息 id", 200), body);
  });

  ipc.handle("ai_writing_delete_last_assistant", (conversationId: unknown) => {
    repo().deleteLastAssistantMessage(readString(conversationId, "会话 id", 200));
    return { ok: true };
  });
}
