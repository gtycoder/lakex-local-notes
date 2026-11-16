import { dialog } from "electron";
import type { IpcRegistrar } from "./registrar.js";
import { Store } from "../store.js";
import { IpcInputError } from "../ipcLimits.js";
import {
  AI_WRITING_MAX_ATTACHMENTS,
  aiWritingAttachmentModeError,
  aiWritingModeCapabilities,
  normalizeAiWritingAttachments,
  type AiWritingAttachment,
  type AiWritingComposerPatch,
  AiWritingConversationCreateInput,
  AiWritingDocRef,
  AiWritingMessageAppendInput,
  AiWritingMessagePatch,
  AiWritingMode,
} from "../../src/core/aiWriting.js";
import { registerPickedLocalFile, LOCAL_ATTACHMENT_IMAGE_EXTS, LOCAL_ATTACHMENT_PDF_EXTS, LOCAL_ATTACHMENT_TEXT_EXTS } from "../ai/localAttachments.js";

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

/**
 * 图片附件引用（261116 Phase 1）：只认 {noteId, filename, name?}；
 * 与渲染层/DB 共用 core 的 normalize（同一份形状判据），但 IPC 侧**不静默丢弃**：
 * 数量超限或存在坏项都直接报错（坏输入不该悄悄变成「少一张图」）。
 */
function readAttachments(value: unknown, role: "user" | "assistant"): AiWritingAttachment[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (role !== "user") throw new IpcInputError("只有用户消息可以带附件");
  if (!Array.isArray(value)) throw new IpcInputError("attachRefs 必须是数组");
  if (value.length > AI_WRITING_MAX_ATTACHMENTS) throw new IpcInputError("一次最多发送 " + AI_WRITING_MAX_ATTACHMENTS + " 个附件");
  const normalized = normalizeAiWritingAttachments(value);
  if (normalized.length !== value.length) throw new IpcInputError("attachRefs 项无效或重复");
  return normalized;
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
    const mode = readMode(row.mode);
    const body: AiWritingConversationCreateInput = {
      mode,
      title: readString(row.title, "标题", MAX_TITLE),
      promptText: row.promptText === undefined || row.promptText === null ? null : readString(row.promptText, "提示词", 20_000),
      // 对话写作 = 纯对话：不接受 docRefs（忽略而不是报错，旧渲染层也安全）。
      docRefs: aiWritingModeCapabilities(mode).docs ? readDocRefs(row.docRefs) : [],
    };
    return repo().createConversation(body);
  });

  ipc.handle("ai_writing_rename", (id: unknown, title: unknown) => {
    return repo().renameConversation(readString(id, "会话 id", 200), readString(title, "标题", MAX_TITLE));
  });

  ipc.handle("ai_writing_composer", (id: unknown, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new IpcInputError("参数无效");
    const row = patch as Record<string, unknown>;
    const conversationId = readString(id, "会话 id", 200);
    const current = repo().getConversation(conversationId);
    if (!current) return null;
    const nextMode = row.mode === undefined ? current.mode : readMode(row.mode);
    const body: AiWritingComposerPatch = {
      promptText: row.promptText === undefined ? undefined : row.promptText === null ? null : readString(row.promptText, "提示词", 20_000),
      mode: row.mode === undefined ? undefined : nextMode,
      // 对话写作 = 纯对话：docRefs 一律清空（切到 chat 的旧会话也在这里被收口）。
      // 多文档模式：没给 docRefs 就不动；给了就整组替换。
      docRefs: aiWritingModeCapabilities(nextMode).docs
        ? (row.docRefs === undefined ? undefined : readDocRefs(row.docRefs))
        : [],
    };
    return repo().updateConversationComposer(conversationId, body);
  });

  /**
   * 本机文件附件（261116 第四稿）：主进程 dialog 选文件，只回引用与元数据。
   * 渲染层从未接触绝对路径与字节；token 失效（重启/文件移动）由 resolver 明确报错。
   */
  ipc.handle("pick_ai_local_files", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择附件（图片 / 文本 / 代码 / PDF）",
      buttonLabel: "添加附件",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "图片 / 文本 / 代码 / PDF", extensions: [...LOCAL_ATTACHMENT_IMAGE_EXTS, ...LOCAL_ATTACHMENT_TEXT_EXTS, ...LOCAL_ATTACHMENT_PDF_EXTS] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    if (result.filePaths.length > AI_WRITING_MAX_ATTACHMENTS) {
      throw new IpcInputError("一次最多添加 " + AI_WRITING_MAX_ATTACHMENTS + " 个附件");
    }
    const picked = [];
    for (const filePath of result.filePaths) {
      // PDF 在这里解析一次（失败抛 AppError：加密/扫描件/坏文件的可执行中文提示）。
      const item = await registerPickedLocalFile(filePath);
      if (item) picked.push(item.ref);
    }
    if (picked.length === 0) throw new IpcInputError("所选文件无法作为附件（空文件/目录/无权限）");
    return picked;
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
    const conversationId = readString(row.conversationId, "会话 id", 200);
    const attachRefs = readAttachments(row.attachRefs, role);
    // 模式判据（纯函数单一来源）：多文档推理只收「已选文档里的附件」，本地文件只在对话写作。
    const conversation = repo().getConversation(conversationId);
    if (conversation && attachRefs && attachRefs.length > 0) {
      const modeError = aiWritingAttachmentModeError(conversation.mode, attachRefs, conversation.docRefs);
      if (modeError) throw new IpcInputError(modeError);
    }
    const body: AiWritingMessageAppendInput = {
      conversationId,
      role,
      content: typeof row.content === "string" ? readString(row.content, "正文", MAX_CONTENT) : "",
      attachRefs,
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
