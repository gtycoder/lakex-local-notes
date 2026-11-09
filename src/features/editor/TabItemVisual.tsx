/**
 * 标签的**视觉原子**（261109 小抽）：标题 / 自定义图标 / 钉住 / 脏点 / 已删除徽标 / 关闭。
 *
 * 为什么只抽这一层：多标签的**逻辑**（打开/关闭/激活/上限/淘汰/持久化）本来就共享在
 * `useTabLifecycle` + `useDocumentTabs`；两个空间真正重复的只有"一排标签长什么样"。
 * 拖拽排序 / 钉住交互 / 分屏 / 右键菜单**留在 MultiTabEditor**：那些是文档空间语义，
 * 日记空间不做（顺序=创建顺序、右键是「转为文档/转为小记」），强行合并会变成一堆开关。
 *
 * 结构契约（护栏 `tabItemVisual.test.ts` 钉住）：`.tab-item` > `.tab-title` + `.tab-close`，
 * 样式全部来自 `styles/app/tabs.css`，本组件**不带任何 CSS**。
 */
import type { ReactNode } from "react";
import { Pin, X } from "lucide-react";

export interface TabItemVisualProps {
  title: string;
  /** 自定义图标节点（调用方已渲染好；emoji 等）。 */
  icon?: ReactNode;
  dirty?: boolean;
  deleted?: boolean;
  /** 已钉住：显示图钉；`onClose` 仍由调用方决定是否给（钉住标签通常不给）。 */
  pinned?: boolean;
  /** 不传 = 不渲染关闭按钮。 */
  onClose?: () => void;
  /** 已删除徽标的悬停说明（不同空间文案可不同）。 */
  deletedTitle?: string;
}

export function TabItemVisual({ title, icon, dirty, deleted, pinned, onClose, deletedTitle }: TabItemVisualProps) {
  return (
    <>
      {pinned && <Pin size={12} className="tab-pin" aria-hidden="true" />}
      {icon && <span className="tab-custom-icon" aria-hidden="true">{icon}</span>}
      <span className="tab-title">{title || "无标题"}</span>
      {dirty && <span className="tab-dirty-dot" aria-label="有未保存更改" />}
      {deleted && (
        <span className="tab-deleted-badge" title={deletedTitle ?? "文档在回收站中：只读、编辑不会保存，恢复后才能继续写"}>
          已删除
        </span>
      )}
      {onClose && (
        <span
          className="tab-close"
          role="button"
          aria-label={"关闭" + (title || "无标题")}
          title={"关闭" + (title || "无标题")}
          onClick={(event) => { event.stopPropagation(); onClose(); }}
        >
          <X size={12} />
        </span>
      )}
    </>
  );
}
