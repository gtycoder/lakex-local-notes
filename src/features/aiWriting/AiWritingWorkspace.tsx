/**
 * AI 写作空间（桌面，v1）：左栏历史 + 主区对话。
 *
 * 语雀同款交互；落点全部本地：
 * - 会话/消息 = 本地 SQLite（不进 S3）；
 * - 生成文档 = 选知识库（笔记本）→ Markdown 转 Lake 正文 → 新建文档；
 * - 保存到小记 = 既有小记（含正文转换）；复制 = 复制 Markdown 原文。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileStack, Settings2, Sparkles } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { convertAiMarkdown } from "./convertAiMarkdown";
import { markdownToPlainText } from "../../core/markdown";
import { isSaveConflict } from "../../lib/types";
import { aiWritingTitleFrom } from "../../core/aiWriting";
import { AiWritingSidebar } from "./AiWritingSidebar";
import { AiComposer } from "./AiComposer";
import { AiMessageView } from "./AiMessageView";
import { PublishDocDialog } from "./PublishDocDialog";
import { SaveQuickNoteDialog } from "./SaveQuickNoteDialog";
import { AI_WRITING_SUGGESTIONS, aiWritingChatTitle, aiWritingDocsTitle } from "./aiWritingPrompts";
import { useAiWriting } from "./useAiWriting";
import { SplitPane } from "../../components/ui/SplitPane";


/** 「生成文档」的默认标题：首行摘要；摘要为空/兜底文案时用固定名。 */
function publishTitleOf(markdown: string): string {
  const title = aiWritingTitleFrom(markdown);
  return title && title !== "新的对话" ? title : "AI 生成文档";
}

export interface AiWritingWorkspaceProps {
  active: boolean;
  treeNodes: readonly TreeNode[];
  /** 共享顶栏左侧（空间切换 + 同步段）由 App 注入（与小记同构）。 */
  topbarLeading: ReactNode;
  onOpenSettings: () => void;
  onNotice: (text: string, action?: { label: string; onClick: () => void }) => void;
  onOpenNote: (noteId: string) => void;
}

export function AiWritingWorkspace({ active, treeNodes, topbarLeading, onOpenSettings, onNotice, onOpenNote }: AiWritingWorkspaceProps) {
  const controller = useAiWriting({ active });
  const [publish, setPublish] = useState<{ open: boolean; content: string; busy: boolean; error: string | null }>({ open: false, content: "", busy: false, error: null });
  const [quickNote, setQuickNote] = useState<{ open: boolean; content: string; busy: boolean; error: string | null }>({ open: false, content: "", busy: false, error: null });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 转换在途的取消句柄（弹窗「取消」/关闭要真的停下来，别把内核队列堵住）。 */
  const publishAbortRef = useRef<AbortController | null>(null);
  const quickNoteAbortRef = useRef<AbortController | null>(null);

  // 流式/新消息时贴底（用户手动上翻时不强制——只在接近底部时跟随）。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [controller.messages, controller.stream]);

  const title = useMemo(() => {
    if (controller.mode === "docs") return aiWritingDocsTitle(controller.docRefs);
    return aiWritingChatTitle(controller.providerLabel);
  }, [controller.mode, controller.docRefs, controller.providerLabel]);

  const copyContent = useCallback((content: string) => {
    void navigator.clipboard.writeText(content)
      .then(() => onNotice("复制完成"))
      .catch(() => onNotice("复制失败，请手动选择文本"));
  }, [onNotice]);

  const closePublish = useCallback(() => {
    publishAbortRef.current?.abort();
    publishAbortRef.current = null;
    setPublish({ open: false, content: "", busy: false, error: null });
  }, []);

  const closeQuickNote = useCallback(() => {
    quickNoteAbortRef.current?.abort();
    quickNoteAbortRef.current = null;
    setQuickNote({ open: false, content: "", busy: false, error: null });
  }, []);

  const publishDoc = useCallback(async (notebookId: string) => {
    setPublish((prev) => ({ ...prev, busy: true, error: null }));
    const controller = new AbortController();
    publishAbortRef.current = controller;
    try {
      const markdown = publish.content;
      const converted = await convertAiMarkdown(markdown, undefined, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const parsedTitle = aiWritingTitleFrom(markdown);
      const docTitle = parsedTitle && parsedTitle !== "新的对话" ? parsedTitle : "AI 生成文档";
      const note = await native.createNoteIn(notebookId, docTitle);
      const saved = await native.saveNote(note.id, docTitle, converted.body);
      if (isSaveConflict(saved)) throw new Error("正文写入被拦截（磁盘已有改动）");
      closePublish();
      onNotice("已生成文档：" + docTitle, { label: "打开", onClick: () => onOpenNote(note.id) });
    } catch (error) {
      if (controller.signal.aborted) return;
      setPublish((prev) => ({ ...prev, busy: false, error: getNativeErrorMessage(error) || "生成文档失败" }));
    } finally {
      if (publishAbortRef.current === controller) publishAbortRef.current = null;
    }
  }, [publish.content, closePublish, onNotice, onOpenNote]);

  const saveQuickNote = useCallback(async (text: string) => {
    setQuickNote((prev) => ({ ...prev, busy: true, error: null }));
    const controller = new AbortController();
    quickNoteAbortRef.current = controller;
    try {
      const converted = await convertAiMarkdown(text, undefined, { signal: controller.signal });
      if (controller.signal.aborted) return;
      await native.createQuickNote({
        // 小记的纯文本镜像 = 去 Markdown 标记的正文（列表/标题等不该以 "## " 形式出现在卡片预览里）。
        text: markdownToPlainText(text).trim() || text,
        body: converted.body || undefined,
        draftId: "aiw-" + Date.now().toString(36),
        stagedImageIds: [],
      });
      closeQuickNote();
      onNotice("小记成功");
    } catch (error) {
      if (controller.signal.aborted) return;
      setQuickNote((prev) => ({ ...prev, busy: false, error: getNativeErrorMessage(error) || "保存小记失败" }));
    } finally {
      if (quickNoteAbortRef.current === controller) quickNoteAbortRef.current = null;
    }
  }, [closeQuickNote, onNotice]);

  const modeSwitch = (
    <span className="ln-segment aiw-mode" role="group" aria-label="写作模式">
      <button type="button" className={"ln-segment__item" + (controller.mode === "chat" ? " is-active" : "")} onClick={() => controller.setMode("chat")}>
        <Sparkles size={14} aria-hidden="true" /> 对话写作
      </button>
      <button type="button" className={"ln-segment__item" + (controller.mode === "docs" ? " is-active" : "")} onClick={() => controller.setMode("docs")}>
        <FileStack size={14} aria-hidden="true" /> 多文档推理
      </button>
    </span>
  );

  const aiGate = !controller.aiEnabled
    ? { title: "AI 助手已关闭", desc: "AI 写作依赖 AI 助手：开启后才会向你的供应商发起请求。", action: "去开启" }
    : { title: "还没有配置 AI 供应商", desc: "到「设置 → AI 助手」填好服务地址、模型与 API Key 后即可使用。", action: "去配置" };

  return (
    <>
      <header className="tab-bar desktop-only" aria-label="顶栏">
        <div className="tabbar-leading">
          {/* 槽位归属由 App 包裹（features 不得反向 import desktop，check-arch 门禁）。 */}
          {topbarLeading}
        </div>
      </header>
      {/* 左栏可拖（SplitPane：与日记/回收站同一分隔条实现；宽度设备本地记忆）。 */}
      <SplitPane
        ariaLabel="调整 AI 写作侧栏宽度"
        storageKey="ai-writing-side"
        minWidth={160}
        maxWidth={520}
        minRight={480}
        className="aiw"
      >
      <AiWritingSidebar
        conversations={controller.conversations}
        activeId={controller.activeConversation?.id ?? null}
        onNew={controller.newConversation}
        onSelect={controller.selectConversation}
        onRename={(id, value) => { void controller.renameConversation(id, value); }}
        onDelete={(id) => { void controller.deleteConversation(id); }}
      />
      <main className="aiw-main">
        {!controller.ready ? (
          <div className="aiw-gate">
            <span className="aiw-gate__icon" aria-hidden="true"><Settings2 size={22} /></span>
            <h1 className="aiw-gate__title">{aiGate.title}</h1>
            <p className="aiw-gate__desc">{aiGate.desc}</p>
            <button type="button" className="ln-btn ln-btn--primary" onClick={onOpenSettings}>{aiGate.action}</button>
          </div>
        ) : (
          <>
            <div className="aiw-scroll" ref={scrollRef}>
              {controller.loadError && <p className="aiw-banner" role="alert">{controller.loadError}</p>}
              {controller.messages.length === 0 && !controller.loading ? (
                <div className="aiw-empty">
                  {modeSwitch}
                  <h1 className="aiw-empty__title">{title}</h1>
                  <AiComposer
                    mode={controller.mode}
                    input={controller.input}
                    busy={controller.busy}
                    promptText={controller.promptText}
                    docRefs={controller.docRefs}
                    treeNodes={treeNodes}
                    onInput={controller.setInput}
                    onSend={() => controller.send()}
                    onStop={controller.stop}
                    onSetPrompt={controller.setPromptText}
                    onSetDocRefs={controller.setDocRefs}
                  />
                  <div className="aiw-suggest">
                    <p className="aiw-suggest__label">点一点试试：</p>
                    <div className="aiw-suggest__chips">
                      {AI_WRITING_SUGGESTIONS[controller.mode].map((item) => (
                        <button key={item.label} type="button" className="aiw-suggest__chip" onClick={() => controller.send(item.prompt)}>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="aiw-thread">
                  {controller.messages.map((message) => (
                    <AiMessageView
                      key={message.id}
                      message={message}
                      stream={controller.stream}
                      busy={controller.busy}
                      onRegenerate={controller.regenerate}
                      onCopy={copyContent}
                      onPublish={(content) => setPublish({ open: true, content, busy: false, error: null })}
                      onSaveQuickNote={(content) => setQuickNote({ open: true, content, busy: false, error: null })}
                    />
                  ))}
                </div>
              )}
            </div>
            {controller.messages.length > 0 && (
              <div className="aiw-dock">
                <AiComposer
                  mode={controller.mode}
                  input={controller.input}
                  busy={controller.busy}
                  promptText={controller.promptText}
                  docRefs={controller.docRefs}
                  treeNodes={treeNodes}
                  onInput={controller.setInput}
                  onSend={() => controller.send()}
                  onStop={controller.stop}
                  onSetPrompt={controller.setPromptText}
                  onSetDocRefs={controller.setDocRefs}
                />
              </div>
            )}
          </>
        )}
      </main>
      </SplitPane>

      <PublishDocDialog
        open={publish.open}
        title={publishTitleOf(publish.content)}
        notebooks={treeNodes}
        busy={publish.busy}
        error={publish.error}
        onConfirm={(notebookId) => { void publishDoc(notebookId); }}
        onClose={closePublish}
      />
      <SaveQuickNoteDialog
        open={quickNote.open}
        content={quickNote.content}
        busy={quickNote.busy}
        error={quickNote.error}
        onConfirm={(text) => { void saveQuickNote(text); }}
        onClose={closeQuickNote}
      />
    </>
  );
}
