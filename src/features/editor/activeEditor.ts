/**
 * 「当前正在显示的编辑器」的**唯一来源**（261005）。
 *
 * 背景：多标签 keep-alive 下 DOM 里同时存在多个编辑器实例。历史上有多处用**几何**
 * （rect.width/height > 0、`style.display === "none"`、`getComputedStyle().display`）反推
 * 「哪个是活动的」—— 那等于把「怎么藏」这一实现细节当成了契约。这个契约**换过两次**：
 * display:none（尺寸为 0）→ 保留布局的 opacity+visibility（尺寸正常，261005 定稿，
 * 为修内核 fit-width 表格切标签重排）。隐藏方式一变，那些几何判断就**静默失准**
 * （拿到隐藏实例的几何，浮栏/AI 面板/滚动归零就会作用于错的文档）。
 *
 * 现在统一走显式信号：各编辑器宿主（doc `EditorTab` / `SheetEditor` / `BitableEditor` /
 * `BoardEditor`）只在**正在显示**时带 data-active="true"，这里只认这个属性，不再看几何。
 * 拿不到就返回 null（调用方各自回退），绝不退回去猜几何。
 */

/** 当前显示中的编辑器宿主（可能是 doc/sheet/bitable/board 任意一种）。 */
export function activeEditorHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-active="true"]') ?? null;
}

/** 当前显示中的编辑器挂载点（.lake-editor-mount，仅 doc 态有）。 */
export function activeEditorMount(): HTMLElement | null {
  const host = activeEditorHost();
  if (!host) return null;
  // is-outgoing = 锁/解锁切换时留下的「延迟销毁」旧层，不算活动实例（与历史语义一致）。
  return host.querySelector<HTMLElement>(".lake-editor-mount:not(.is-outgoing)") ?? null;
}
