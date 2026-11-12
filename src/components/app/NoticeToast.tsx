/**
 * 操作提示 toast（261112 task-93，**唯一实现**）。
 *
 * 背景：`showNotice` 的提示此前只由 DesktopStatusBar 渲染，而状态栏只在知识库空间挂载
 * （App：`showDocumentStats={desktopWorkspace === "library"}`）⇒ 日记 / 小记 / AI 写作 / 标签 / 回收站 / 资源
 * 空间里的「已转为文档」「已转为小记」「同步提示」全都看不见（task-91 现场发现）。
 *
 * 现在提示的标记只有这一份：知识库空间由状态栏渲染（DOM 与位置跟以前完全一致），其余空间由状态栏组件
 * 在 `!showDocumentStats` 分支渲染同一份（那里状态栏自身不渲染，不会多一个空底栏）。
 *
 * 位置沿用 `styles/document-status.css` 的 `.document-notice-toast`：absolute 贴 `.workspace` 底边 42px、
 * 在 `.workspace` 内水平居中；所有空间都是同一个工作区壳 ⇒ 不引入第二种几何；z 序同为
 * `--lake-z-statusbar-popover`（低于浮层、高于状态栏）。
 */
/** 操作提示的形状（与 useDesktopShell 的 notice 状态同形；动作可选）。 */
export interface StatusBarNotice {
  text: string;
  action?: { label: string; onClick: () => void };
}

export function NoticeToast({ notice }: { notice: StatusBarNotice | null }) {
  if (!notice) return null;
  return (
    <div className="document-notice-toast" role="status" aria-live="polite">
      <span>{notice.text}</span>
      {notice.action && (
        <button type="button" className="ln-btn ln-btn--link ln-btn--compact" onClick={notice.action.onClick}>
          {notice.action.label}
        </button>
      )}
    </div>
  );
}
