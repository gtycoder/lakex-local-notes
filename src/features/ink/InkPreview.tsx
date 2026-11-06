/**
 * 手写板（kind=ink）只读画布预览 —— 历史快照 / 标签空间共用（261106）。
 *
 * 为什么直接复用 InkPad：它本身就有 `readOnly` 档（落笔/擦除/导入/翻页写回/撤销都在内部按 readOnly 早退，
 * 移动端/锁定文档已长期走这条路）⇒ 不另写渲染器，也不必复制矢量墨迹的绘制逻辑。
 *
 * 三条约束：
 *  1. **不写任何东西**：readOnly + 不传 onChange；也**不传 noteId** —— InkPad 会把当前页写进设备本地
 *     导航键（`lakex-local-notes-v3.ink-nav.<noteId>`，见 inkNav.ts），预览若带上 noteId 会把用户文档的
 *     当前页读/写串台。
 *  2. **懒加载**：本模块由调用方 `lazy(() => import(...))` 引入（InkPad + 手写板 CSS 不进首屏/主 chunk）。
 *  3. 容器由调用方给（`.history-editor-preview` / 标签预览槽），本组件只负责把画布铺满，不新写滚动容器。
 */
import InkPad from "./InkPad";
import "./inkPad.shared.css";
import "./inkPad.desktop.css";
import "./inkPreview.css";

export interface InkPreviewProps {
  /** 手写板正文（inkDoc JSON，与历史快照 / 文档正文同一格式）。 */
  content: string;
}

export function InkPreview({ content }: InkPreviewProps) {
  return (
    <div className="ink-preview" role="group" aria-label="手写板只读预览">
      <InkPad content={content} readOnly variant="desktop" active />
    </div>
  );
}

export default InkPreview;
