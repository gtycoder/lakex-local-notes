import { lazy, Suspense, useState } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";
import type { ResourceUploadOutput } from "../../lib/types";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";
import { addQuickNoteTagId, removeQuickNoteTagId } from "../../core/quickNoteTags";
import type { QuickNoteEditorApi } from "../../features/quickNotes/QuickNoteEditor";
import { QuickNoteTagPicker } from "../../features/quickNotes/QuickNoteTagPicker";
import type { DraftState } from "../model/quickNoteDraft";
// 仅写作时加载内核，工作区仍常驻以接收搜索定位。
const QuickNoteEditor = lazy(() => import("../../features/quickNotes/QuickNoteEditor").then(m => ({ default: m.QuickNoteEditor })));

interface ComposerProps {
  /** 编辑器版式：card＝小卡片（分块视图）；full＝文档样式（列表视图右侧）。 */
  ui?: "card" | "full";
  draft: DraftState;
  /** 工作区可见性：透传给内核实例的挂载开关（隐藏视图里不建实例，见 QuickNoteEditor.active）。 */
  active?: boolean;
  /** pane＝常驻写作面板（发布行在卡片外，仿语雀）；inline＝编辑既有小记（动作行留在卡片内） */
  variant: "pane" | "inline";
  saving: boolean;
  /** 「保存并同步」的网络阶段（与 saving 分开：保存是本地写、同步是维护域网络操作）。 */
  syncing: boolean;
  /** 云同步是否可用：false ⇒「保存并同步」置灰（判据由工作区透传，单一来源）。 */
  cloudReady: boolean;
  /** 图片上传落盘（写进该草稿的 staging 空间）。 */
  uploadResource(request: unknown): Promise<ResourceUploadOutput>;
  /** 已有标签选项（从全部有效小记派生）。 */
  tagOptions: QuickNoteTagSummary[];
  onTextChange(text: string): void;
  onTagIdsChange(tagIds: string[]): void;
  /** 新建标签（写标签表后返回 ID）；选择器与写作卡共用。 */
  onCreateTag(name: string): Promise<string>;
  onEditorReady(api: QuickNoteEditorApi | null): void;
  /** 只保存到本机（原有语义）。 */
  onSave(): void;
  /** 保存到本机，再按高优先级发起整轮 v3 同步。 */
  onSaveAndSync(): void;
  onCancel(): void;
}

export function QuickNoteComposer({ draft, saving, syncing, cloudReady, variant, ui = "card", active = true, uploadResource, tagOptions, onTextChange, onTagIdsChange, onCreateTag, onEditorReady, onSave, onSaveAndSync, onCancel }: ComposerProps) {
  const [tagPickerAnchor, setTagPickerAnchor] = useState<HTMLElement | null>(null);
  const tagNameOf = (id: string) => tagOptions.find((tag) => tag.id === id)?.name ?? "已删除标签";
  /** ⌘/Ctrl + Enter 触发主按钮（发布/保存）：编辑器可能吞键，故挂捕获阶段兜底。 */
  function publishOnShortcut(event: React.KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); onSave(); }
  }
  /** 本地写与网络推送两段都要禁用动作行（避免半途中重复提交）。 */
  const busy = saving || syncing;
  const publishLabel = variant === "pane" ? "小记一下" : "保存";
  /**
   * 主按钮**恒用强调色**（用户 261013 点单："桌面端的小记一下应该有颜色吧"）。
   * 旧口径（260915：新建空态＝中性描边、有内容才强调）作废 —— 动作行现在有**两个**同族描边按钮
   * （主按钮 +「保存并同步」），主按钮再走中性就分不出主次了。
   */
  const primary = (
    <button className="ln-btn ln-btn--primary quick-note-publish" disabled={busy} onClick={onSave}>
      {saving ? <LoaderCircle className="spin" size={15} /> : null}{saving ? "保存中" : publishLabel}
    </button>
  );
  /** 「保存并同步」= **普通按钮**（不强调，与「取消」同族的中性描边），夹在主按钮与取消之间（用户 261013 定稿）。 */
  const saveAndSync = (
    <button
      className="ln-btn ln-btn--secondary quick-note-publish"
      disabled={busy || !cloudReady}
      title={cloudReady ? undefined : "云同步已关闭：不会联网。可先「保存」到本机，开启云同步后再同步。"}
      aria-label={cloudReady ? "保存并同步" : "保存并同步（云同步已关闭，不可用）"}
      onClick={onSaveAndSync}
    >
      {syncing ? <LoaderCircle className="spin" size={15} /> : null}{syncing ? "同步中" : "保存并同步"}
    </button>
  );
  const cancel = <button className="ln-btn ln-btn--ghost quick-note-discard" disabled={busy} onClick={onCancel}>取消</button>;
  return <>
    <div className="quick-note-composer" onKeyDownCapture={publishOnShortcut}>
      {/* 写作区 = 一个 Lake 内核实例（编辑时挂、离开即销毁）；图片直接拖入或粘贴。
          P12：编辑器已 React.lazy ⇒ 首次打开时才加载内核 chunk，Suspense 给一个最小占位。 */}
      <Suspense fallback={<div className="empty-workspace-hint">正在加载编辑器…</div>}>
      <QuickNoteEditor
        ownerId={draft.id}
        initialBody={draft.body}
        ui={ui}
        active={active}
        uploadResource={uploadResource}
        onTextChange={onTextChange}
        onReady={onEditorReady}
      />
      </Suspense>
    </div>
    <div className="quick-note-tags">
      <button
        type="button"
        className="ln-chip ln-chip--add"
        disabled={busy}
        onClick={(event) => setTagPickerAnchor(event.currentTarget)}
      ><Plus size={12} /><span>添加标签</span></button>
      {draft.tagIds.map((tagId) => (
        <span className="ln-chip ln-chip--static" key={tagId}>
          <span className="ln-ellipsis">{tagNameOf(tagId)}</span>
          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label={`移除标签 ${tagNameOf(tagId)}`} disabled={busy} onClick={() => onTagIdsChange(removeQuickNoteTagId(draft.tagIds, tagId))}><X size={11} /></button>
        </span>
      ))}
    </div>
    <div className={`quick-note-composer-actions quick-note-composer-actions--${variant}`}>
      {variant === "pane" ? <>
        {/* 写作卡（新建）：主按钮在最左、次级动作跟在后面（仿评论框），快捷键提示退到最后。 */}
        {primary}
        {saveAndSync}
        {cancel}
      </> : <>
        {/* 编辑既有小记：整组靠右下（对齐对话框底栏惯例：次级在左、主按钮在右），不再分居两角 */}
        {cancel}
        {saveAndSync}
        {primary}
      </>}
    </div>
    {tagPickerAnchor && (
      <QuickNoteTagPicker
        anchor={tagPickerAnchor}
        options={tagOptions}
        selected={draft.tagIds}
        onAdd={(tagId) => onTagIdsChange(addQuickNoteTagId(draft.tagIds, tagId))}
        onCreate={onCreateTag}
        onClose={() => setTagPickerAnchor(null)}
      />
    )}
  </>;
}
