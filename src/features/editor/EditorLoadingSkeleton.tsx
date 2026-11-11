/**
 * 编辑器懒加载骨架（261111，task-16）：Suspense fallback 的**同构轻占位**。
 *
 * 过去两处 fallback 都是一行「正在加载编辑器…」文字（MultiTabEditor 切/开文档、QuickNoteComposer
 * 首开写作卡），冷启动时视觉上是一下子闪一行灰字。这里换成与编辑器同构的静态块：顶栏条 + 正文行
 * （写作卡变体只留正文行），高度/宽度全部由宿主外壳决定（.tab-panels 的 grid 拉伸、.quick-note-editor
 * 的 flex:1 + min-height），**不写死大 px**，因此不会引发布局跳动。
 *
 * 约束：纯静态、无动画（DESIGN 红线：不做装饰性动效）；样式全在 src/styles/app/editor.css，走令牌。
 * 可访问性：根节点 role="status" + aria-busy，文案「正在加载编辑器…」保留为视觉隐藏节点（测试按它断言）。
 */
export function EditorLoadingSkeleton({ variant = "document" }: { variant?: "document" | "composer" }) {
  const composer = variant === "composer";
  return (
    <div
      className={"editor-skeleton" + (composer ? " editor-skeleton--composer" : "")}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="a11y-visually-hidden">正在加载编辑器…</span>
      {!composer && (
        <div className="editor-skeleton__toolbar" aria-hidden="true">
          <span className="editor-skeleton__pill" />
          <span className="editor-skeleton__pill editor-skeleton__pill--short" />
          <span className="editor-skeleton__spacer" />
          <span className="editor-skeleton__pill editor-skeleton__pill--tiny" />
        </div>
      )}
      <div className="editor-skeleton__body" aria-hidden="true">
        <span className="editor-skeleton__line editor-skeleton__line--title" />
        <span className="editor-skeleton__line" />
        <span className="editor-skeleton__line editor-skeleton__line--w90" />
        <span className="editor-skeleton__line" />
        {!composer && <span className="editor-skeleton__line editor-skeleton__line--w70" />}
        {!composer && <span className="editor-skeleton__line" />}
      </div>
    </div>
  );
}
