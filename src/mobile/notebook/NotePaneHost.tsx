import { Suspense, lazy } from "react";
import type { LocalNote } from "../data/noteRepository";
import { DocumentEditor } from "../editor/DocumentEditor";
import { MobileBoardViewer } from "../board/MobileBoardViewer";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import type { NotebookTab } from "./useNotebookTabs";
import { EmptyState } from "../ui/EmptyState";
import { mobileReadonlyText } from "../lib/readonlyText";

/** 表格 / 多维表视图按需加载：只有真的打开这类文档才进分包（首屏不含它们）。 */
const MobileBitableViewer = lazy(() => import("../bitable/MobileBitableViewer").then((m) => ({ default: m.MobileBitableViewer })));
/** 表格（usheet）：与桌面同一套 Univer 内核的查看/编辑器（261020 起可编辑；运行时按需加载）。 */
const MobileUsheetViewer = lazy(() => import("../usheet/MobileUsheetViewer").then((m) => ({ default: m.MobileUsheetViewer })));
/** 手写板：共享 InkPad + perfect-freehand，按需分包。 */
const MobileInkPad = lazy(() => import("../ink/MobileInkPad").then((m) => ({ default: m.MobileInkPad })));

/**
 * 文档层 pane 列表（261103 P9-5b 拆件，原 NotebookWorkspace 内联 JSX，未改行为/DOM）：
 * 已挂载标签的 keep-alive 正文（board / ink / bitable / usheet / DocumentEditor 分支）
 * + 活动页未挂载时的骨架 / 无标签空态。纯展示组件：正文与写入动作全部由 props 注入，
 * 不在组件里读 store / ref（editorsRef / liveBodyCapturesRef 的读写由父层回调完成）。
 */
export interface NotePaneHostProps {
  tabs: NotebookTab[];
  active: NotebookTab | null;
  activeId: string | null;
  freshId: string | null;
  mountedIds: Set<string>;
  findOpen: boolean;
  /** 正文变化：父层负责 updateTab + 编辑态排自动保存（plain 仅 Lake 文档有）。 */
  onBodyChange: (tab: NotebookTab, content: string, plain?: string) => void;
  /** 只读文档里提交多维表表单：同一条写边界，父层负责 updateTab + bridge.saveNote。 */
  onPersistBitableNow: (tab: NotebookTab, content: string) => Promise<void>;
  /** 实例内正文 capture（board / usheet / ink）：父层写入 liveBodyCapturesRef。 */
  onCapture: (id: string, capture: (() => string | null) | null) => void;
  /** Lake 编辑器实例（父层写入 editorsRef，供大纲使用）。 */
  onEditorInstance: (id: string, editor: LakeEditorInstance | null) => void;
  /** 多维表记录详情等子页全屏请求（父层隐藏顶栏/胶囊）。 */
  onFullscreenChange: (fullscreen: boolean) => void;
  /** DocumentEditor 的查找条关闭（父层收 overlay）。 */
  onCloseFind: () => void;
}

export function NotePaneHost(props: NotePaneHostProps) {
  const { tabs, active, activeId, freshId, mountedIds, findOpen } = props;
  return (
    <>
    {/* ⚠️ 已挂载的 keep-alive 页**必须一直留在 DOM 里**（只允许非活动页 display:none）：
        旧实现是「活动页没挂载 ⇒ 用骨架替换整份 pane 列表」，于是打开一篇本会话还没挂载的文档时，
        别的标签的 pane 被一起卸载、scrollTop 归零（R2：切走再切回 752→0）。
        现在骨架只是**并列的占位层**，已挂载的 pane 照常渲染（非活动页隐藏但保留滚动位置）。 */}
    {tabs.map((t) => (!mountedIds.has(t.id) ? null : (
      <div key={t.id} className={"doc-pane" + (t.id === activeId ? " active" : "") + (t.id === freshId ? " doc-pane--fresh" : "")}>
        <>
        {/* 261112 task-56（N4）：编辑锁 = 只读横幅（桌面端锁定的文档在移动端也必须可见、可理解）。
            task-67：文案单一来源 = core/capabilities/readonlyReason（本端只换成「桌面端解锁」的动作措辞）。 */}
        {t.editLocked && (
          <div className="mobile-status-msg" role="status">
            {mobileReadonlyText({ locked: true })}
          </div>
        )}
        {/* 标题只在顶栏（思源 #toolbarName 口径）；正文区不再重复一个标题输入框 */}
        {t.kind === "board" ? (
          // 画板：移动端查看/编辑（同一套 Drawnix 引擎；正文只进画板实例，绝不喂 Lake 编辑器）
          <MobileBoardViewer
            noteId={t.id}
            content={t.content}
            active={t.id === activeId}
            editing={t.editing && !t.editLocked}
            onChange={(c) => { props.onBodyChange(t, c); }}
            onCapture={(capture) => { props.onCapture(t.id, capture); }}
          />
        ) : t.kind === "ink" ? (
          <Suspense fallback={<EmptyState>正在加载手写板…</EmptyState>}>
            <MobileInkPad
              noteId={t.id}
              content={t.content}
              active={t.id === activeId}
              readOnly={!t.editing || t.editLocked === true}
              onChange={(c) => props.onBodyChange(t, c)}
              // 与 board/usheet 同一条写边界：完成编辑/退出前现取实例正文（绕过 500ms 防抖）。
              onEditorCapture={(capture) => { props.onCapture(t.id, capture); }}
            />
          </Suspense>
        ) : t.kind === "bitable" ? (
          // 多维表：移动端查看/编辑（同一份 core 数据模型与写入纯函数；正文 JSON 绝不给 Lake 编辑器）。
          // 只有当前活动页可编辑：切走后自动收起记录/字段面板，回来再恢复编辑态。
          <Suspense fallback={<EmptyState>正在加载多维表…</EmptyState>}>
            <MobileBitableViewer
              noteId={t.id}
              content={t.content}
              editing={t.editing && t.id === activeId && !t.editLocked}
              onChange={(c) => { props.onBodyChange(t, c); }}
              // 只读文档里提交表单必须真正落盘（不走「编辑态才自动保存」的防抖路径）：
              // 与「完成编辑」同一条写边界（bridge.saveNote），失败抛出由 viewer 提示。
              onPersistNow={(c) => props.onPersistBitableNow(t, c)}
              // 记录详情 = 子页全屏：请求隐藏工作区顶栏/底部胶囊（单一入口，child 只声明状态）。
              onFullscreenChange={props.onFullscreenChange}
            />
          </Suspense>
        ) : t.kind === "usheet" ? (
          // 表格：移动端查看/编辑（同一套 Univer 内核；正文 JSON 绝不喂 Lake 编辑器）
          <Suspense fallback={<EmptyState>正在加载表格…</EmptyState>}>
            <MobileUsheetViewer
              noteId={t.id}
              content={t.content}
              active={t.id === activeId}
              editing={t.editing && !t.editLocked}
              onChange={(c) => { props.onBodyChange(t, c); }}
              onCapture={(capture) => { props.onCapture(t.id, capture); }}
            />
          </Suspense>
        ) : t.kind !== "doc" ? (
          // 兜底防腐坏（AGENTS §3）：未知类型的正文不是 Lake HTML，**绝不允许** Lake 编辑器打开/保存。
          <EmptyState>
            {t.title || "此文档"}：该类型暂不支持在移动端查看，请在桌面端打开。
          </EmptyState>
        ) : (
        <DocumentEditor
          note={{ id: t.id, title: t.title, content: t.content } as LocalNote}
          content={t.content}
          editing={t.editing && !t.editLocked}
          onContentChange={(c, plain) => props.onBodyChange(t, c, plain)}
          documents={[]}
          hidePanels
          findOpen={findOpen && t.id === activeId}
          onCloseFind={props.onCloseFind}
          onEditorInstance={(ed) => {
            // DS 复核 A2：卸载时 onEditorReady(noteId, null) —— 必须 delete，不能 set(null)
            // （否则 closeTab 里 delete 后又会被 set 写回键）。get(activeId) ?? null 已兼容 undefined。
            props.onEditorInstance(t.id, ed);
          }}
        />
        )}
        </>
      </div>
    )))}
    {/* 正在异步读回（刚点开、还没进 tabs）时先画骨架：避免转场落位后先闪一块空白再蹦出正文。
        只有「活动页自己还没挂载」才画；其余已挂载的 pane 在上一段里照常保留。 */}
    {!active || !mountedIds.has(active.id) ? (
      activeId ? (
        <div className="mb-doc-skeleton" aria-busy="true" aria-label="正在打开文档">
          <span className="mb-skel mb-doc-skeleton__title" />
          <span className="mb-skel mb-doc-skeleton__line" />
          <span className="mb-skel mb-doc-skeleton__line" />
          <span className="mb-skel mb-doc-skeleton__line" />
          <span className="mb-skel mb-doc-skeleton__line" />
          <span className="mb-skel mb-doc-skeleton__line mb-doc-skeleton__line--short" />
        </div>
      ) : (
        <EmptyState>暂无打开的文档，点底部「文档树」打开</EmptyState>
      )
    ) : null}
    </>
  );
}
